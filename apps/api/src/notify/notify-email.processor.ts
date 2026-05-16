// FR-NOTIF-001 §6 — alert-dispatch consumer for email channel.
import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { Resend } from "resend";
import { renderAlertEmail } from "./render-alert-email";
import { alertIdem, dailyCount, reserveSend } from "./idempotency";
import { isSuppressed } from "./suppression";
import { DeeplinkService } from "../affiliate/deeplink.service";

export type AlertJobData = {
  userId: string;
  watchlistId: string;
  triggerKind: string;
  observedAt: Date | string;
};

const DAILY_CAP = 20;

let _resend: Resend | null = null;
function resend(): Resend | null {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

@Processor("alert-dispatch", { name: "email" })
export class NotifyEmailProcessor extends WorkerHost {
  private readonly log = new Logger(NotifyEmailProcessor.name);

  constructor(
    private readonly deeplink: DeeplinkService,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {
    super();
  }

  async process(job: Job<AlertJobData>): Promise<void> {
    const observedAt = job.data.observedAt instanceof Date ? job.data.observedAt : new Date(job.data.observedAt);
    const { userId, watchlistId, triggerKind } = job.data;

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: this.oid(userId) });
    if (!user) return;
    if (!user.notificationChannels?.email) return;
    if (await isSuppressed(user.email)) {
      this.posthog.capture("alert_suppressed", { reason: "suppression_list", channel: "email" });
      return;
    }
    if ((await dailyCount(userId)) >= DAILY_CAP) {
      this.posthog.capture("alert_deferred", { reason: "daily_cap", channel: "email" });
      return;
    }

    const idem = alertIdem({ userId, watchlistId, triggerKind, observedAt });
    if (!(await reserveSend({ userId, watchlistId, channel: "email", idem }))) {
      this.log.debug(`idem hit — skipping duplicate email ${idem.slice(0, 12)}`);
      return;
    }

    const watchlist = await mongo.db("salenoti").collection("watchlists").findOne({ _id: this.oid(watchlistId) });
    if (!watchlist) return;
    const m = String(watchlist.productId).match(/^(\d+)-(\d+)$/);
    if (!m) return;
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });
    if (!product) return;

    const last30dMin = await timescale.getLast30dMin(watchlist.productId).catch(() => null);
    const deepLinkResult = await this.deeplink.generate({
      userId,
      productId: watchlist.productId,
      source: "alert_email",
      watchlistId,
    });

    const { subject, html, text } = renderAlertEmail({
      productName: product.name ?? "Sản phẩm",
      imageUrl: product.imageUrl ?? null,
      currentPrice: product.currentPrice ?? 0,
      originalPrice: product.originalPrice ?? product.currentPrice ?? 0,
      currentDiscountPct: product.currentDiscountPct ?? 0,
      last30dMin,
      baselineAtTrack: watchlist.baselineAtTrack ?? product.currentPrice ?? 0,
      triggerKind,
      ctaUrl: deepLinkResult.url,
      unsubscribeUrl: `${process.env.APP_URL ?? "https://salenoti.vn"}/dashboard/watchlists/${watchlistId}?action=pause`,
    });

    const r = resend();
    if (!r) {
      this.log.warn(`[dev-stub] would send email to ${user.email}: ${subject}`);
    } else {
      const sendResult = await r.emails.send({
        from: "SaleNoti <alerts@salenoti.vn>",
        to: user.email,
        subject,
        html,
        text,
        tags: [
          { name: "fr", value: "FR-NOTIF-001" },
          { name: "trigger", value: triggerKind },
        ],
        headers: {
          "List-Unsubscribe": `<mailto:unsubscribe@salenoti.vn?subject=u-${userId}>, <${process.env.APP_URL}/api/notif/unsubscribe?u=${userId}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (sendResult.error) {
        this.sentry.captureException(new Error(sendResult.error.message), {
          tags: { fr: "FR-NOTIF-001", kind: "resend_error" },
        });
        throw new Error(sendResult.error.message);
      }
    }

    // FR-NOTIF-001 §1 #7 — write cooldown after successful send.
    await mongo.db("salenoti").collection("watchlists").updateOne(
      { _id: this.oid(watchlistId) },
      {
        $set: { [`triggerCooldowns.${triggerKind}`]: new Date(), lastTriggeredAt: new Date() },
      }
    );

    this.posthog.capture("alert_sent", {
      channel: "email",
      trigger: triggerKind,
      productId: watchlist.productId,
    });
  }

  private oid(id: string): ObjectId {
    // Job IDs are persisted as ObjectId hex strings. If the value isn't a valid hex,
    // we cannot match the row anyway — throwing here surfaces the schema bug fast.
    return new ObjectId(id);
  }
}
