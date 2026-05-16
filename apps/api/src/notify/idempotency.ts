// FR-NOTIF-001 §1 #3 — alert idempotency.
// idem = sha256(userId | watchlistId | triggerKind | observedAt.toISOString())
// Shared across email + push + telegram so one trigger → one delivery per channel.
import crypto from "node:crypto";
import { mongo } from "../db/mongo";

export function alertIdem(args: { userId: string; watchlistId: string; triggerKind: string; observedAt: Date }): string {
  const s = `${args.userId}|${args.watchlistId}|${args.triggerKind}|${args.observedAt.toISOString()}`;
  return crypto.createHash("sha256").update(s).digest("hex");
}

export type Channel = "email" | "webPush" | "telegram";

/** Insert a notifications row with unique-index dedup on (idem, channel). Returns false on duplicate (already sent). */
export async function reserveSend(args: {
  userId: string;
  watchlistId: string;
  channel: Channel;
  idem: string;
}): Promise<boolean> {
  try {
    await mongo.db("salenoti").collection("notifications").insertOne({
      userId: args.userId,
      watchlistId: args.watchlistId,
      channel: args.channel,
      idem: args.idem,
      sentAt: new Date(),
      openedAt: null,
      clickedAt: null,
      deliveredAt: null,
      bouncedAt: null,
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
  start.setUTCHours(0, 0, 0, 0);
  return mongo.db("salenoti").collection("notifications").countDocuments({
    userId,
    sentAt: { $gte: start },
  });
}
