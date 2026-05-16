// FR-NOTIF-002 §6 — Web Push processor.
import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ObjectId } from "mongodb";
import webpush from "web-push";
import { mongo } from "../db/mongo";
import { alertIdem, dailyCount, reserveSend } from "./idempotency";
import { DeeplinkService } from "../affiliate/deeplink.service";
import type { AlertJobData } from "./notify-email.processor";

const DAILY_CAP = 20;
let _initialized = false;

function ensureInit() {
  if (_initialized) return;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      `mailto:${process.env.DPO_EMAIL ?? "dpo@salenoti.vn"}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    _initialized = true;
  }
}

@Processor("alert-dispatch", { name: "push" })
export class NotifyPushProcessor extends WorkerHost {
  private readonly log = new Logger(NotifyPushProcessor.name);

  constructor(
    private readonly deeplink: DeeplinkService,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {
    super();
    ensureInit();
  }

  async process(job: Job<AlertJobData>): Promise<void> {
    if (!_initialized) {
      this.log.debug("[push] VAPID keys missing — skipping");
      return;
    }

    const observedAt = job.data.observedAt instanceof Date ? job.data.observedAt : new Date(job.data.observedAt);
    const { userId, watchlistId, triggerKind } = job.data;

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: this.oid(userId) });
    if (!user) return;
    if (!user.notificationChannels?.webPush) return;
    const subs: any[] = user.pushSubscriptions ?? [];
    if (subs.length === 0) return;
    if ((await dailyCount(userId)) >= DAILY_CAP) return;

    const idem = alertIdem({ userId, watchlistId, triggerKind, observedAt });
    if (!(await reserveSend({ userId, watchlistId, channel: "webPush", idem }))) return;

    const watchlist = await mongo.db("salenoti").collection("watchlists").findOne({ _id: this.oid(watchlistId) });
    if (!watchlist) return;
    const m = String(watchlist.productId).match(/^(\d+)-(\d+)$/);
    if (!m) return;
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });
    if (!product) return;

    const deepLinkResult = await this.deeplink.generate({
      userId,
      productId: watchlist.productId,
      source: "alert_push",
      watchlistId,
    });

    const payload = JSON.stringify({
      title: `🔥 ${(product.name ?? "Sản phẩm").slice(0, 60)}`,
      body: `Giảm ${product.currentDiscountPct ?? 0}% — ${new Intl.NumberFormat("vi-VN").format(product.currentPrice ?? 0)} ₫`,
      icon: "/icon-192.png",
      data: { url: `${deepLinkResult.url}?utm=push&idem=${idem}`, idem },
      tag: idem, // FR-NOTIF-002 §1 #4 — OS-level dedup
    });

    let removedCount = 0;
    let sentCount = 0;
    await Promise.all(
      subs.map(async (sub: any) => {
        try {
          await webpush.sendNotification(sub, payload);
          sentCount++;
        } catch (e: any) {
          if (e?.statusCode === 410) {
            // FR-NOTIF-002 §1 #8 — drop expired subscription.
            // Cast: the `users` collection isn't strongly typed at this layer, so MongoDB's
            // $pull operator-shape inference rejects nested fields. The runtime semantics
            // are correct; cast to `any` to bypass the over-strict default-Document inference.
            await mongo.db("salenoti").collection("users").updateOne(
              { _id: this.oid(userId) },
              { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } } as any
            );
            removedCount++;
          } else {
            this.sentry.captureException(e, { tags: { fr: "FR-NOTIF-002", endpoint: sub.endpoint?.slice(0, 60) } });
          }
        }
      })
    );

    this.posthog.capture("alert_sent", {
      channel: "webPush",
      trigger: triggerKind,
      productId: watchlist.productId,
      devices: sentCount,
      stale_dropped: removedCount,
    });
  }

  private oid(id: string): ObjectId {
    return new ObjectId(id);
  }
}
