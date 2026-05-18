// FR-PRICE-002 — server-side downsampled history.
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { redis } from "../queue/redis.client";

export type Range = "7d" | "30d" | "90d";
export type Granularity = "raw" | "30m" | "1h" | "6h" | "1d";

const RANGE_MS: Record<Range, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

const BUCKET_INTERVAL: Record<Exclude<Granularity, "raw">, "30 minutes" | "1 hour" | "6 hours" | "1 day"> = {
  "30m": "30 minutes",
  "1h": "1 hour",
  "6h": "6 hours",
  "1d": "1 day",
};

export type HistoryResult = {
  productId: string;
  range: Range;
  granularity: Granularity;
  points: Array<{ t: Date; p: number; p_min: number; p_max: number }>;
};

@Injectable()
export class HistoryService {
  constructor(@Inject("OBS_POSTHOG") private readonly posthog: any) {}

  async getHistory(args: {
    userId: string | null;
    adminToken?: string | null;
    productId: string;
    range: Range;
    granularity: Granularity;
    source: "web" | "ext" | "deal-page";
  }): Promise<HistoryResult> {
    const startedAt = Date.now();
    if (!isValidProductId(args.productId)) {
      throw new BadRequestException({ error: "invalid_productId" });
    }

    // FR-PRICE-002 §1 #3 — raw queries restricted to ≤ 7 days.
    if (args.granularity === "raw" && args.range !== "7d") {
      throw new BadRequestException({ error: "raw_requires_7d" });
    }

    // FR-PRICE-002 §1 #5 — auth: caller MUST hold an active watchlist on this product OR product is public.
    const isAuthorized = await this.hasActiveWatchlistOrPublic(args.userId, args.productId, args.adminToken);
    if (!isAuthorized) throw new ForbiddenException({ error: "forbidden" });

    // FR-PRICE-002 §1 #7 — 5-min cache + pubsub invalidate (pubsub wiring happens in FR-PRICE-001 caller).
    const cacheKey = `history:${args.productId}:${args.range}:${args.granularity}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = normalizeCachedHistory(JSON.parse(cached) as HistoryResult);
        this.observe(startedAt, args, true);
        return parsed;
      } catch {
        await redis.del(cacheKey);
      }
    }

    const from = new Date(Date.now() - RANGE_MS[args.range]);
    let points: HistoryResult["points"];

    if (args.granularity === "raw") {
      const raw = await timescale.getHistory(args.productId, from, new Date(), "raw");
      points = raw.map((r) => ({ t: r.observed_at, p: r.price, p_min: r.price, p_max: r.price }));
    } else {
      points = await timescale.getBucketedHistory({
        productId: args.productId,
        from,
        bucketInterval: BUCKET_INTERVAL[args.granularity],
      });
    }

    const out: HistoryResult = {
      productId: args.productId,
      range: args.range,
      granularity: args.granularity,
      points,
    };

    await redis.setex(cacheKey, 300, JSON.stringify(out));

    this.observe(startedAt, args, false);

    return out;
  }

  /** Subscribers to `price_history_invalidate` channel can call this to clear cache. */
  async invalidateCache(productId: string): Promise<void> {
    const ranges: Range[] = ["7d", "30d", "90d"];
    const grans: Granularity[] = ["raw", "30m", "1h", "6h", "1d"];
    const keys = ranges.flatMap((r) => grans.map((g) => `history:${productId}:${r}:${g}`));
    if (keys.length) await redis.del(...keys);
  }

  private async hasActiveWatchlistOrPublic(
    userId: string | null,
    productId: string,
    adminToken?: string | null,
  ): Promise<boolean> {
    if (process.env.ADMIN_TOKEN && adminToken === process.env.ADMIN_TOKEN) return true;
    // Public deal page: products.publicDealAt is set by an admin tool (FR-ADMIN spec).
    const m = productId.match(/^(\d+)-(\d+)$/);
    if (!m) return false;
    const shopId = Number(m[1]);
    const itemId = Number(m[2]);
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId, itemId });
    if (product?.publicDealAt) return true;
    if (!userId) return false;
    try {
      const userIds: unknown[] = [userId];
      if (ObjectId.isValid(userId)) userIds.unshift(new ObjectId(userId));
      const wl = await mongo
        .db("salenoti")
        .collection("watchlists")
        .findOne({ userId: { $in: userIds }, productId, status: { $in: ["active", "paused"] } });
      return Boolean(wl);
    } catch {
      return false;
    }
  }

  private observe(
    startedAt: number,
    args: { productId: string; range: Range; granularity: Granularity; source: "web" | "ext" | "deal-page" },
    cached: boolean,
  ): void {
    this.posthog.capture("price_history_viewed", {
      productId: args.productId,
      range: args.range,
      granularity: args.granularity,
      source: args.source,
      cached,
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  }
}

@Injectable()
export class HistoryCacheInvalidator implements OnModuleInit {
  private readonly log = new Logger(HistoryCacheInvalidator.name);

  constructor(private readonly history: HistoryService) {}

  async onModuleInit(): Promise<void> {
    const sub = redis.duplicate();
    sub.on("message", async (channel, productId) => {
      if (channel !== "price_history_invalidate" || typeof productId !== "string") return;
      try {
        await this.history.invalidateCache(productId);
      } catch (e) {
        this.log.warn(`history cache invalidate failed: ${(e as Error).message}`);
      }
    });
    sub.on("error", (err) => {
      this.log.warn(`history cache subscriber error: ${(err as Error).message}`);
    });
    await sub.subscribe("price_history_invalidate");
  }
}

export function isValidProductId(productId: string): boolean {
  return /^\d+-\d+$/.test(productId);
}

function normalizeCachedHistory(value: HistoryResult): HistoryResult {
  return {
    ...value,
    points: value.points.map((point) => ({
      ...point,
      t: point.t instanceof Date ? point.t : new Date(point.t),
    })),
  };
}
