// FR-NOTIF-004 §1 #6/#12 — Mobile Push processor (Expo Notifications).
// Sends push notifications to registered Expo push tokens.
import crypto from "node:crypto";
import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { alertIdem, dailyCount, recordDeferred, reserveSend } from "./idempotency";
import { DeeplinkService } from "../affiliate/deeplink.service";
import type { AlertJobData } from "./notify-email.processor";
import { timescale } from "../db/timescale.client";

const DAILY_CAP = 20;

/**
 * Expo Notifications API client.
 * POST https://exp.host/--/api/v2/push/send with Authorization: Bearer ...
 */
async function sendExpoNotification(token: string, payload: any, accessToken: string): Promise<void> {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      categoryId: payload.categoryId,
      sound: "default",
      badge: 1,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "unknown" }));
    // Check if token is invalid (410 or similar).
    if (response.status === 400 && error.errors?.[0]?.code === "INVALID_PUSH_TOKEN") {
      const err = new Error("Invalid push token");
      (err as any).statusCode = 410;
      throw err;
    }
    throw new Error(`Expo API error: ${response.status} ${JSON.stringify(error)}`);
  }
}

@Processor("alert-dispatch", { name: "mobilePush" })
export class NotifyMobileProcessor extends WorkerHost {
  private readonly log = new Logger(NotifyMobileProcessor.name);

  constructor(
    private readonly deeplink: DeeplinkService,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {
    super();
  }

  async process(job: Job<AlertJobData>): Promise<void> {
    if (job.data.channels && !job.data.channels.includes("mobilePush")) return;

    const expoAccessToken = process.env.EXPO_ACCESS_TOKEN;
    if (!expoAccessToken) {
      this.log.debug("[mobilePush] EXPO_ACCESS_TOKEN missing — skipping");
      return;
    }

    const observedAt = job.data.observedAt instanceof Date ? job.data.observedAt : new Date(job.data.observedAt);
    const { userId, watchlistId, triggerKind } = job.data;

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: this.oid(userId) });
    if (!user) return;
    if (!user.notificationChannels?.mobilePush) return;
    const tokens: any[] = user.mobilePushTokens ?? [];
    if (tokens.length === 0) return;

    // FR-NOTIF-004 §1 #10 — shared daily cap across all channels.
    if ((await dailyCount(userId)) >= DAILY_CAP) {
      await recordDeferred({
        userId,
        watchlistId,
        channel: "mobilePush",
        triggerKind,
        reason: "daily_cap",
        correlationId: job.data.jobMeta?.correlationId,
      });
      this.posthog.capture("alert_deferred", { reason: "daily_cap", channel: "mobilePush" });
      return;
    }

    const idem = alertIdem({ userId, watchlistId, triggerKind, observedAt, channel: "mobilePush" });
    if (!(await reserveSend({ userId, watchlistId, channel: "mobilePush", idem, triggerKind, observedAt, correlationId: job.data.jobMeta?.correlationId }))) {
      return;
    }

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

    const last30dMin = await timescale.getLast30dMin(watchlist.productId).catch(() => null);
    const formatVnd = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
    const minText = last30dMin !== null ? ` · Min 30d: ${formatVnd(last30dMin)}` : "";

    const payload = {
      title: `🔥 ${(product.name ?? "Sản phẩm").slice(0, 60)}`,
      body: `Giảm ${product.currentDiscountPct ?? 0}% — ${formatVnd(product.currentPrice ?? 0)}${minText}`,
      categoryId: "default",
      data: {
        url: `salenoti://watchlists/${watchlistId}?utm=mobilePush&idem=${idem}`,
        idem,
      },
    };

    let removedCount = 0;
    let sentCount = 0;
    let failureCount = 0;

    await Promise.all(
      tokens.map(async (tokenObj: any) => {
        try {
          await sendExpoNotification(tokenObj.token, payload, expoAccessToken);
          sentCount++;
        } catch (e: any) {
          failureCount++;
          if ((e as any).statusCode === 410 || e?.message?.includes("INVALID_PUSH_TOKEN")) {
            // FR-NOTIF-004 §1 #11 — Cleanup targets token value, not deviceId alone.
            await mongo
              .db("salenoti")
              .collection("users")
              .updateOne(
                { _id: this.oid(userId) },
                { $pull: { mobilePushTokens: { token: tokenObj.token } } } as any
              );
            removedCount++;
          } else {
            this.sentry.captureException(e, {
              tags: {
                fr: "FR-NOTIF-004",
                token_hash: tokenHash(tokenObj.token),
                platform: tokenObj.platform,
              },
            });
          }
        }
      })
    );

    if (removedCount >= tokens.length) {
      await mongo
        .db("salenoti")
        .collection("users")
        .updateOne({ _id: this.oid(userId) }, { $set: { "notificationChannels.mobilePush": false } });
    }

    // FR-NOTIF-004 §1 #12 — PostHog events with counts and tail only (no raw tokens).
    this.posthog.capture("mobile_push_sent", {
      trigger: triggerKind,
      productId: watchlist.productId,
      device_count: tokens.length,
      success_count: sentCount,
      failure_count: failureCount,
      stale_dropped: removedCount,
      idem_tail: idem.slice(-12),
    });
  }

  private oid(id: string): ObjectId {
    return new ObjectId(id);
  }
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}
