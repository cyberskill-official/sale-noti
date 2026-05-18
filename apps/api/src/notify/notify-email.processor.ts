// FR-NOTIF-001 §6 — alert-dispatch consumer for email channel.
import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { Resend } from "resend";
import { renderAlertEmail } from "./render-alert-email";
import {
  alertIdem,
  dailyCount,
  emailHash,
  nextHoChiMinhNine,
  recordDeferred,
  reserveSend,
  setTriggerCooldown,
  unsubscribeToken,
} from "./idempotency";
import { isSuppressed } from "./suppression";
import { DeeplinkService } from "../affiliate/deeplink.service";

export type AlertJobData = {
  userId: string;
  watchlistId: string;
  triggerKind: string;
  observedAt: Date | string;
  observedPrice?: number;
  baseline?: number;
  baselineLow30d?: number;
  channels?: Array<"email" | "push" | "telegram">;
  jobMeta?: { enqueuedAt?: Date | string; correlationId?: string };
};

const DAILY_CAP = 20;

let _resend: Resend | null = null;
function resend(): Resend | null {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export function resetResendForTests(): void {
  _resend = null;
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
    const startedAt = Date.now();
    if (job.data.channels && !job.data.channels.includes("email")) return;
    const observedAt = job.data.observedAt instanceof Date ? job.data.observedAt : new Date(job.data.observedAt);
    const { userId, watchlistId, triggerKind } = job.data;
    const correlationId = job.data.jobMeta?.correlationId ?? job.id ?? `${userId}-${watchlistId}-${observedAt.toISOString()}`;

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: this.oid(userId) });
    if (!user) return;
    if (!user.notificationChannels?.email) {
      this.posthog.capture("alert_skipped_channel_disabled", { channel: "email", trigger: triggerKind });
      return;
    }
    const safeEmailHash = emailHash(user.email);
    if (await isSuppressed(user.email)) {
      await setTriggerCooldown(watchlistId, triggerKind);
      this.posthog.capture("alert_suppressed", { reason: "suppression_list", channel: "email" });
      return;
    }
    if ((await dailyCount(userId)) >= DAILY_CAP) {
      await recordDeferred({ userId, watchlistId, channel: "email", triggerKind, reason: "daily_cap", correlationId });
      await this.deferToNextMorning(job);
      this.posthog.capture("alert_deferred", { reason: "daily_cap", channel: "email" });
      return;
    }

    const idem = alertIdem({ userId, watchlistId, triggerKind, observedAt, channel: "email" });
    if (
      !(await reserveSend({
        userId,
        watchlistId,
        channel: "email",
        idem,
        triggerKind,
        observedAt,
        emailHash: safeEmailHash,
        correlationId,
      }))
    ) {
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
    const affiliateLink = await mongo
      .db("salenoti")
      .collection("affiliate_links")
      .findOne({ shortUrl: deepLinkResult.url });
    const affiliateLinkId = affiliateLink?._id ?? null;
    const unsubToken = unsubscribeToken(userId, watchlistId);
    const appUrl = process.env.APP_URL ?? "https://sale.cyber.skill";
    const unsubscribeUrl = `${appUrl}/unsubscribe?u=${encodeURIComponent(userId)}&watchlistId=${encodeURIComponent(watchlistId)}&t=${unsubToken}`;
    const observedPrice = job.data.observedPrice ?? product.currentPrice ?? 0;

    const { subject, html, text } = renderAlertEmail({
      productName: product.name ?? "Sản phẩm",
      imageUrl: product.imageUrl ?? null,
      currentPrice: observedPrice,
      originalPrice: product.originalPrice ?? observedPrice,
      currentDiscountPct: product.currentDiscountPct ?? 0,
      last30dMin: job.data.baselineLow30d ?? last30dMin,
      baselineAtTrack: job.data.baseline ?? watchlist.baselineAtTrack ?? product.currentPrice ?? 0,
      triggerKind,
      ctaUrl: deepLinkResult.url,
      unsubscribeUrl,
    });

    const r = resend();
    if (!r) {
      this.log.warn(`[dev-stub] would send email to ${safeEmailHash}: ${subject}`);
    } else {
      const sendResult = await r.emails.send({
        from: "SaleNoti <alerts@cyberskill.world>",
        to: user.email,
        subject,
        html,
        text,
        tags: [
          { name: "fr", value: "FR-NOTIF-001" },
          { name: "trigger", value: triggerKind },
          { name: "user_cohort", value: user.plan ?? "free" },
        ],
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@cyberskill.world?subject=u-${userId}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-PM-Message-Stream": "outbound",
        },
      });
      if (sendResult.error) {
        this.sentry.captureException(new Error(sendResult.error.message), {
          tags: { fr: "FR-NOTIF-001", kind: "resend_error" },
          contexts: { notify: { email_hash: safeEmailHash, affiliate_link_id: affiliateLinkId } },
        });
        throw new Error(sendResult.error.message);
      }
      const resendMessageId = (sendResult as any).data?.id ?? (sendResult as any).id ?? null;
      await mongo
        .db("salenoti")
        .collection("notifications")
        .updateOne({ idem, channel: "email" }, { $set: { resendMessageId, affiliateLinkId } });
    }

    // FR-NOTIF-001 §1 #7 — write cooldown after successful send.
    await setTriggerCooldown(watchlistId, triggerKind);

    this.posthog.capture("alert_sent", {
      channel: "email",
      trigger: triggerKind,
      productId: watchlist.productId,
    });
    this.posthog.capture("alert_dispatch_latency_ms", {
      channel: "email",
      trigger: triggerKind,
      latency_ms: Date.now() - startedAt,
    });
  }

  private oid(id: string): ObjectId {
    // Job IDs are persisted as ObjectId hex strings. If the value isn't a valid hex,
    // we cannot match the row anyway — throwing here surfaces the schema bug fast.
    return new ObjectId(id);
  }

  private async deferToNextMorning(job: Job<AlertJobData>): Promise<void> {
    const target = nextHoChiMinhNine();
    const delay = Math.max(0, target.getTime() - Date.now());
    await (job as any).queue?.add?.("alert", job.data, { delay, attempts: 3 });
  }
}
