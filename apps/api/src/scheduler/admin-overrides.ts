import { ObjectId, type Db, type Document, type Filter } from "mongodb";
import { mongo } from "../db/mongo";
import type { TrackPriority } from "./priority-engine";

export const SCHEDULER_OVERRIDE_TTL_MS = 86_400_000;
export const SCHEDULER_TIERS = ["hot", "mid", "low"] as const satisfies readonly TrackPriority[];

export function isSchedulerTier(value: string): value is TrackPriority {
  return (SCHEDULER_TIERS as readonly string[]).includes(value);
}

export function productFilterFromId(productId: string): Filter<Document> {
  const match = productId.match(/^(\d+)-(\d+)$/);
  if (match) return { shopId: Number(match[1]), itemId: Number(match[2]) };
  if (ObjectId.isValid(productId)) return { _id: new ObjectId(productId) };
  return { productId };
}

export async function forceTierOverride(
  productId: string,
  tier: TrackPriority,
  options: { now?: Date; expiresAt?: Date; reason?: string; db?: Db } = {},
): Promise<{ matched: boolean; modified: boolean; expiresAt: Date }> {
  if (!isSchedulerTier(tier)) {
    throw new Error(`invalid scheduler tier: ${tier}`);
  }

  const now = options.now ?? new Date();
  const expiresAt = options.expiresAt ?? new Date(now.getTime() + SCHEDULER_OVERRIDE_TTL_MS);
  const db = options.db ?? mongo.db("salenoti");
  const result = await db.collection("products").updateOne(productFilterFromId(productId), {
    $set: {
      trackPriority: tier,
      priorityOverride: {
        tier,
        forcedAt: now,
        expiresAt,
        reason: options.reason ?? "admin_force_tier",
      },
      updatedAt: now,
    },
    $unset: { cooldownUntil: "" },
  });

  return { matched: result.matchedCount > 0, modified: result.modifiedCount > 0, expiresAt };
}
