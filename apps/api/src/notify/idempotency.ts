// FR-NOTIF-001 §1 #3 — alert idempotency.
// idem = sha256(userId | watchlistId | triggerKind | observedAt | channel | salt).slice(0, 32)
// Per-channel keys prevent partial-failure retries from double-sending successful channels.
import crypto from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { mongo } from "../db/mongo";

export type Channel = "email" | "push" | "webPush" | "telegram" | "mobilePush";

export function alertIdem(args: {
  userId: string;
  watchlistId: string;
  triggerKind: string;
  observedAt: Date;
  channel?: Channel;
}): string {
  const channel = args.channel ?? "email";
  const s = `${args.userId}|${args.watchlistId}|${args.triggerKind}|${args.observedAt.toISOString()}|${channel}|${envSalt("EMAIL_IDEM_SALT")}`;
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export function emailHash(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase() + envSalt("EMAIL_HASH_SALT"))
    .digest("hex")
    .slice(0, 32);
}

export function unsubscribeToken(userId: string, watchlistId: string | null): string {
  return crypto
    .createHash("sha256")
    .update(`${userId}${watchlistId ?? ""}${envSalt("UNSUB_SALT")}`)
    .digest("hex")
    .slice(0, 24);
}

/** Insert a notifications row with unique-index dedup on (idem, channel). Returns false on duplicate (already sent). */
export async function reserveSend(args: {
  userId: string;
  watchlistId: string;
  channel: Channel;
  idem: string;
  triggerKind?: string;
  observedAt?: Date;
  emailHash?: string;
  correlationId?: string;
}): Promise<boolean> {
  try {
    await mongo.db("salenoti").collection("notifications").insertOne({
      userId: args.userId,
      watchlistId: args.watchlistId,
      channel: args.channel,
      idem: args.idem,
      triggerKind: args.triggerKind ?? null,
      observedAt: args.observedAt ?? null,
      email_hash: args.emailHash ?? null,
      correlationId: args.correlationId ?? null,
      sentAt: new Date(),
      openedAt: null,
      clickedAt: null,
      deliveredAt: null,
      bouncedAt: null,
      complainedAt: null,
    });
    return true;
  } catch (e: any) {
    if (e?.code === 11000) return false;
    throw e;
  }
}

/** Daily cap counter — combined across all channels. Default 20/day per FR-NOTIF-001 §1 #10. */
export async function dailyCount(userId: string): Promise<number> {
  const start = new Date();
  start.setTime(Date.now() - 24 * 60 * 60_000);
  return mongo.db("salenoti").collection("notifications").countDocuments({
    userId,
    deferredReason: { $exists: false },
    sentAt: { $gte: start },
  });
}

export async function recordDeferred(args: {
  userId: string;
  watchlistId: string;
  channel: Channel;
  triggerKind: string;
  reason: "daily_cap" | "quiet_hours" | "suppression_list";
  correlationId?: string;
}): Promise<void> {
  await mongo.db("salenoti").collection("notifications").insertOne({
    userId: args.userId,
    watchlistId: args.watchlistId,
    channel: args.channel,
    triggerKind: args.triggerKind,
    deferredReason: args.reason,
    correlationId: args.correlationId ?? null,
    sentAt: new Date(),
  });
}

export async function setTriggerCooldown(watchlistId: string, triggerKind: string): Promise<void> {
  const { ObjectId } = await import("mongodb");
  await mongo
    .db("salenoti")
    .collection("watchlists")
    .updateOne(
      { _id: new ObjectId(watchlistId) },
      { $set: { [`triggerCooldowns.${triggerKind}`]: new Date(), lastNotifiedAt: new Date() } },
    );
}

export function nextHoChiMinhNine(now = new Date()): Date {
  const utcMs = now.getTime();
  const hcm = new Date(utcMs + 7 * 60 * 60_000);
  const next = new Date(Date.UTC(hcm.getUTCFullYear(), hcm.getUTCMonth(), hcm.getUTCDate(), 2, 0, 0, 0));
  if (next.getTime() <= utcMs) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function ensureNotificationIndexes(): Promise<void> {
  const db = mongo.db("salenoti");
  await db.collection("notifications").createIndex({ idem: 1, channel: 1 }, { unique: true, name: "idem_channel_unique" });
  await db.collection("notifications").createIndex({ userId: 1, sentAt: -1 }, { name: "user_sent_at" });
  await db.collection("notifications").createIndex({ sentAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: "ttl_365d" });
  await db.collection("notifications").createIndex({ resendMessageId: 1 }, { sparse: true, name: "resend_msg" });
  await db.collection("suppression_list").createIndex({ email_hash: 1 }, { unique: true, name: "suppression_email_hash" });
  await db.collection("webhook_events").createIndex({ eventId: 1, source: 1 }, { unique: true, name: "webhook_event_unique" });
}

@Injectable()
export class NotificationIndexService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await ensureNotificationIndexes();
  }
}

function envSalt(name: "EMAIL_IDEM_SALT" | "EMAIL_HASH_SALT" | "UNSUB_SALT"): string {
  const value = process.env[name] ?? process.env.PII_HASH_SALT;
  if (!value && process.env.NODE_ENV === "production") throw new Error(`${name}_MISSING`);
  return value ?? "local-dev-salenoti-salt";
}
