import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";

export type TrackPriority = "hot" | "mid" | "low";

const DAY_MS = 86_400_000;

function hasFlashSaleTrigger(watchlist: any): boolean {
  return Boolean(watchlist.alertConfig?.triggers?.some((t: any) => t.kind === "flash_sale" && !t.paused));
}

async function isInActiveMegaSaleWindow(now: Date): Promise<boolean> {
  const active = await mongo.db("salenoti").collection("mega_sales").findOne({
    status: "active",
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  });
  return Boolean(active);
}

async function newestUserActivity(userIds: ObjectId[]): Promise<Date | null> {
  if (userIds.length === 0) return null;
  const user = await mongo
    .db("salenoti")
    .collection("users")
    .find({ _id: { $in: userIds } }, { projection: { lastActiveAt: 1, updatedAt: 1, createdAt: 1 } })
    .sort({ lastActiveAt: -1, updatedAt: -1, createdAt: -1 })
    .limit(1)
    .next();
  return user?.lastActiveAt ?? user?.updatedAt ?? user?.createdAt ?? null;
}

export async function reevaluateTier(productId: string, now = new Date()): Promise<TrackPriority> {
  const watchlists = await mongo
    .db("salenoti")
    .collection("watchlists")
    .find({ productId, status: { $in: ["active", "paused"] } })
    .toArray();

  if (watchlists.length === 0) return "low";
  if (watchlists.some(hasFlashSaleTrigger)) return "hot";

  const productMatch = productId.match(/^(\d+)-(\d+)$/);
  const product = productMatch
    ? await mongo
        .db("salenoti")
        .collection("products")
        .findOne({ shopId: Number(productMatch[1]), itemId: Number(productMatch[2]) })
    : null;

  if (product?.lastAlertAt instanceof Date && now.getTime() - product.lastAlertAt.getTime() < 7 * DAY_MS) {
    return "hot";
  }
  if (await isInActiveMegaSaleWindow(now)) return "hot";

  const activeWatchlists = watchlists.filter((w) => w.status === "active");
  if (activeWatchlists.length === 0) return "low";

  const activity = await newestUserActivity(activeWatchlists.map((w) => w.userId).filter((id): id is ObjectId => id instanceof ObjectId));
  if (activity && now.getTime() - activity.getTime() > 30 * DAY_MS) return "low";

  return "mid";
}
