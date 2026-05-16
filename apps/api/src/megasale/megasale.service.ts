// FR-GROW-003 §6 — Mega Sale Mode service.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { mongo } from "../db/mongo";
import { activeOrUpcomingSale, MEGA_SALES } from "./megasale-window.config";

const HOT_CAP = 50_000;

@Injectable()
export class MegaSaleService {
  private readonly log = new Logger(MegaSaleService.name);

  constructor(@Inject("OBS_POSTHOG") private readonly posthog: any) {}

  /** Public lookup for FE banner + scheduler use. */
  current() {
    return activeOrUpcomingSale();
  }

  /** FR-GROW-003 §1 #4 — hot-tier override during live window. */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: "megasale-tier-override" })
  async applyHotOverride() {
    if (!process.env.MONGODB_URI) return;
    const { sale, stage } = activeOrUpcomingSale();
    if (stage !== "live" || !sale) {
      // Revert any leftover overrides outside windows.
      await mongo
        .db("salenoti")
        .collection("products")
        .updateMany({ _megaSaleOverride: { $exists: true } }, { $set: { trackPriority: "mid" }, $unset: { _megaSaleOverride: "" } });
      return;
    }

    // Only override products with at least one watchlist having a flash_sale trigger.
    const flashWatchlists = await mongo
      .db("salenoti")
      .collection("watchlists")
      .aggregate([
        { $match: { status: "active", "alertConfig.triggers.kind": "flash_sale" } },
        { $group: { _id: "$productId" } },
        { $limit: HOT_CAP },
      ])
      .toArray();

    const productIds = flashWatchlists.map((r) => r._id as string);
    for (const pid of productIds) {
      const m = pid.match(/^(\d+)-(\d+)$/);
      if (!m) continue;
      await mongo
        .db("salenoti")
        .collection("products")
        .updateOne(
          { shopId: Number(m[1]), itemId: Number(m[2]) },
          { $set: { trackPriority: "hot", _megaSaleOverride: sale.slug } }
        );
    }
    this.posthog.capture("megasale_hot_override_applied", { slug: sale.slug, count: productIds.length });
  }

  /** FR-GROW-003 §1 #6 — top-N deals during a live window (for landing page + Slack post). */
  async getTopDeals(slug: string, limit = 50) {
    const sale = MEGA_SALES.find((s) => s.slug === slug);
    if (!sale) return [];
    return mongo
      .db("salenoti")
      .collection("products")
      .find({ _megaSaleOverride: slug, currentDiscountPct: { $gte: 30 } })
      .sort({ currentDiscountPct: -1, sales: -1 })
      .limit(limit)
      .toArray();
  }
}
