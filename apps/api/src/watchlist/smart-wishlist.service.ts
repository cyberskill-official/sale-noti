import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import {
  extractDealScoreWindow,
  normalizeDealScoreMarket,
  scoreDeal,
  type DealScoreObservation,
} from "@salenoti/deal-scoring";
import {
  normalizeSmartWishlistMarket,
  normalizeSmartWishlistRange,
  recommendWishlistTargetPrice,
  type SmartWishlistCandidateInput,
  type SmartWishlistEmbeddingWindow,
  type SmartWishlistRange,
  type SmartWishlistResult,
} from "@salenoti/smart-wishlist";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";

type WatchlistDoc = {
  _id: ObjectId;
  userId: ObjectId;
  productId: string;
  status: string;
  smartWishlistSnapshot?: SmartWishlistResult | null;
};

type ProductDoc = {
  shopId: number;
  itemId: number;
  name?: string | null;
  imageUrl?: string | null;
  currentPrice?: number | null;
  originalPrice?: number | null;
  currentDiscountPct?: number | null;
  lastObservedAt?: Date | string | null;
  lastDealScore?: number | null;
  lastDealScoreConfidence?: number | null;
  lastDealScoreLabel?: string | null;
  lastDealScoreAt?: Date | string | null;
  lastRecommendedPricePoint?: number | null;
  category?: string | null;
  region?: string | null;
  market?: string | null;
  deletedAt?: Date | null;
};

type CandidateStatsRow = {
  product_id: string;
  last_30d_min: number | null;
  last_30d_max: number | null;
  last_7d_avg: number | null;
  observation_count: number | null;
};

type EnrichedWatchlistRow = Record<string, any> & {
  watchlistId: string;
  productId: string;
  smartWishlistSnapshot?: SmartWishlistResult | null;
};

function clampLimit(limit: number | undefined, fallback: number): number {
  return Math.min(Math.max(Math.floor(Number(limit) || fallback), 1), 5);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 86_400_000));
}

function parseProductId(productId: string): { shopId: number; itemId: number } {
  const match = /^(\d+)-(\d+)$/.exec(productId);
  if (!match) throw new BadRequestException({ error: "invalid_product_id" });
  return { shopId: Number(match[1]), itemId: Number(match[2]) };
}

function toObjectId(value: string, errorCode = "invalid_id"): ObjectId {
  if (!ObjectId.isValid(value)) throw new BadRequestException({ error: errorCode });
  return new ObjectId(value);
}

function toIsoDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class SmartWishlistService {
  async getSmartWishlist(input: {
    userId: string;
    watchlistId: string;
    range?: SmartWishlistRange;
    limit?: number;
  }): Promise<SmartWishlistResult> {
    const range = normalizeSmartWishlistRange(input.range);
    const limit = clampLimit(input.limit, 5);
    const userId = toObjectId(input.userId, "invalid_user_id");
    const watchlistId = toObjectId(input.watchlistId, "invalid_watchlist_id");

    const watchlist = (await mongo
      .db("salenoti")
      .collection("watchlists")
      .findOne({ _id: watchlistId, userId })) as WatchlistDoc | null;
    if (!watchlist || watchlist.status === "deleted") {
      throw new ForbiddenException({ error: "watchlist_not_found" });
    }

    const result = await this.buildRecommendation({
      watchlist,
      range,
      limit,
    });

    await this.persistSnapshot({ watchlist, result });
    return result;
  }

  async enrichWatchlistRows(input: {
    userId: string;
    rows: EnrichedWatchlistRow[];
    range?: SmartWishlistRange;
    limit?: number;
  }): Promise<EnrichedWatchlistRow[]> {
    const range = normalizeSmartWishlistRange(input.range);
    const limit = clampLimit(input.limit, 3);

    return Promise.all(
      input.rows.map(async (row) => {
        if (row.smartWishlistSnapshot && row.smartWishlistSnapshot.range === range) {
          return row;
        }

        try {
          const snapshot = await this.getSmartWishlist({
            userId: input.userId,
            watchlistId: row.watchlistId,
            range,
            limit,
          });
          return { ...row, smartWishlistSnapshot: snapshot };
        } catch {
          return row;
        }
      }),
    );
  }

  private async buildRecommendation(args: {
    watchlist: WatchlistDoc;
    range: SmartWishlistRange;
    limit: number;
  }): Promise<SmartWishlistResult> {
    const watchlistId = String(args.watchlist._id);
    const { shopId, itemId } = parseProductId(args.watchlist.productId);
    const currentProduct = (await mongo
      .db("salenoti")
      .collection("products")
      .findOne(
        { shopId, itemId },
        {
          projection: {
            shopId: 1,
            itemId: 1,
            name: 1,
            imageUrl: 1,
            currentPrice: 1,
            originalPrice: 1,
            currentDiscountPct: 1,
            lastObservedAt: 1,
            lastDealScore: 1,
            lastDealScoreConfidence: 1,
            lastDealScoreLabel: 1,
            lastDealScoreAt: 1,
            lastRecommendedPricePoint: 1,
            category: 1,
            region: 1,
            market: 1,
            deletedAt: 1,
          },
        },
      )) as ProductDoc | null;

    if (!currentProduct || currentProduct.deletedAt) {
      throw new NotFoundException({ error: "product_not_found" });
    }

    const market = normalizeSmartWishlistMarket(normalizeDealScoreMarket(currentProduct.region ?? currentProduct.market) ?? "VN");
    const history = await this.loadCurrentHistory(args.watchlist.productId, args.range);
    const observations = history.rows.map((row) => ({
      observedAt: row.observed_at,
      price: Number(row.price ?? 0),
      flashSale: Boolean(row.flash_sale),
    })) as DealScoreObservation[];
    const currentStats = await timescale.getStats(args.watchlist.productId).catch(() => null);
    const categoryMedianPrice = await this.loadCategoryMedianPrice(currentProduct, args.watchlist.productId);

    const currentPrice = Math.max(
      0,
      Number(
        currentProduct.currentPrice ?? observations.at(-1)?.price ?? currentStats?.last30dMin ?? currentProduct.originalPrice ?? 0,
      ),
    );
    const originalPrice = Math.max(0, Number(currentProduct.originalPrice ?? currentPrice));
    const last30dMin = currentStats?.last30dMin ?? null;
    const baselinePrice = Math.max(originalPrice, last30dMin ?? 0, currentPrice);
    const currentDiscountPct = Number(
      currentProduct.currentDiscountPct ??
        (baselinePrice > 0 ? Math.min(100, Math.max(0, Math.round(((baselinePrice - currentPrice) / baselinePrice) * 100))) : 0),
    );

    const dealScoreWindow = extractDealScoreWindow({
      productId: args.watchlist.productId,
      market,
      range: args.range,
      observations,
      baselinePrice,
      last30dMin: last30dMin ?? currentPrice,
      currentDiscountPct,
      categoryMedianPrice,
      reboundWithin24h: this.detectReboundWithin24h(observations, baselinePrice),
      daysSinceLastStrongDrop: this.findDaysSinceLastStrongDrop(observations, baselinePrice),
    });

    const computedDealScore = currentProduct.lastDealScore == null ? scoreDeal(dealScoreWindow) : null;
    const dealScore = currentProduct.lastDealScore ?? computedDealScore?.score ?? 0.5;
    const dealConfidence = currentProduct.lastDealScoreConfidence ?? computedDealScore?.confidence ?? 0.5;
    const flashSaleDensity = observations.length > 0 ? observations.filter((observation) => observation.flashSale).length / observations.length : 0;
    const candidateWindows = await this.loadCandidateWindows({
      currentProductId: args.watchlist.productId,
      currentWatchlistId: watchlistId,
      currentMarket: market,
      currentRange: args.range,
      category: currentProduct.category ?? null,
      categoryMedianPrice,
    });

    return recommendWishlistTargetPrice(
      {
        watchlistId,
        productId: args.watchlist.productId,
        market,
        range: args.range,
        currentPrice,
        baselinePrice,
        last30dMin: last30dMin ?? currentPrice,
        currentDiscountPct,
        discountPersistenceHours: dealScoreWindow.discountPersistenceHours,
        priceVolatility: dealScoreWindow.priceVolatility,
        flashSaleDensity,
        reboundWithin24h: dealScoreWindow.reboundWithin24h,
        daysSinceLastStrongDrop: dealScoreWindow.daysSinceLastStrongDrop,
        categoryGapPct: dealScoreWindow.categoryGapPct,
        dealScore,
        dealConfidence,
        observationCount: observations.length,
      } satisfies SmartWishlistEmbeddingWindow,
      candidateWindows,
      args.limit,
    );
  }

  private async loadCurrentHistory(productId: string, range: SmartWishlistRange): Promise<{ rows: Array<{ observed_at: Date; price: number; flash_sale: boolean }> }> {
    const rangeDays = range === "90d" ? 90 : 30;
    const historyStart = new Date();
    historyStart.setDate(historyStart.getDate() - rangeDays);

    return timescale.query<{ observed_at: Date; price: number; flash_sale: boolean }>(
      `SELECT observed_at, price, flash_sale
         FROM price_history
        WHERE product_id = $1 AND observed_at >= $2
        ORDER BY observed_at ASC`,
      [productId, historyStart],
    );
  }

  private async loadCandidateWindows(args: {
    currentProductId: string;
    currentWatchlistId: string;
    currentMarket: string;
    currentRange: SmartWishlistRange;
    category: string | null;
    categoryMedianPrice: number | null;
  }): Promise<SmartWishlistCandidateInput[]> {
    if (!args.category || args.category === "unknown") return [];

    const candidates = (await mongo
      .db("salenoti")
      .collection("products")
      .find(
        {
          category: args.category,
          deletedAt: null,
          $or: [{ region: args.currentMarket }, { market: args.currentMarket }],
          currentPrice: { $type: "number", $gt: 0 },
        },
        {
          projection: {
            shopId: 1,
            itemId: 1,
            name: 1,
            imageUrl: 1,
            currentPrice: 1,
            originalPrice: 1,
            currentDiscountPct: 1,
            lastObservedAt: 1,
            lastDealScore: 1,
            lastDealScoreConfidence: 1,
            lastDealScoreLabel: 1,
            lastDealScoreAt: 1,
            lastRecommendedPricePoint: 1,
            category: 1,
            region: 1,
            market: 1,
          },
        },
      )
      .sort({ updatedAt: -1, lastObservedAt: -1, _id: -1 })
      .limit(20)
      .toArray()) as ProductDoc[];

    const filtered = candidates.filter((candidate) => `${candidate.shopId}-${candidate.itemId}` !== args.currentProductId);
    if (filtered.length === 0) return [];

    const candidateIds = filtered.map((candidate) => `${candidate.shopId}-${candidate.itemId}`);
    const statsRows = await this.loadCandidateStats(candidateIds);
    const statsByProductId = new Map<string, CandidateStatsRow>();
    for (const row of statsRows) {
      statsByProductId.set(row.product_id, row);
    }

    const categoryPrices = filtered
      .map((candidate) => Number(candidate.currentPrice ?? 0))
      .filter((price) => Number.isFinite(price) && price > 0);
    const categoryMedian = args.categoryMedianPrice ?? median(categoryPrices);

    return filtered.map((candidate) => {
      const productId = `${candidate.shopId}-${candidate.itemId}`;
      const stats = statsByProductId.get(productId);
      const currentPrice = Math.max(0, Number(candidate.currentPrice ?? 0));
      const originalPrice = Math.max(0, Number(candidate.originalPrice ?? currentPrice));
      const baselinePrice = Math.max(originalPrice, stats?.last_30d_max ?? 0, currentPrice);
      const currentDiscountPct = Number(
        candidate.currentDiscountPct ??
          (baselinePrice > 0 ? Math.min(100, Math.max(0, Math.round(((baselinePrice - currentPrice) / baselinePrice) * 100))) : 0),
      );
      const observationCount = Math.max(0, Number(stats?.observation_count ?? 0));
      const priceVolatility = stats && stats.last_30d_min && stats.last_30d_max
        ? Math.min(1, Math.max(0, (stats.last_30d_max - stats.last_30d_min) / Math.max(stats.last_7d_avg ?? currentPrice ?? 1, 1)))
        : 0;
      const lastDealScoreAt = toIsoDate(candidate.lastDealScoreAt);

      return {
        watchlistId: args.currentWatchlistId,
        productId,
        market: normalizeSmartWishlistMarket(candidate.region ?? candidate.market ?? args.currentMarket),
        range: args.currentRange,
        currentPrice: currentPrice || null,
        baselinePrice,
        last30dMin: stats?.last_30d_min ?? currentPrice,
        currentDiscountPct,
        discountPersistenceHours: Math.min(72, Math.max(0, observationCount * 3)),
        priceVolatility,
        flashSaleDensity: currentDiscountPct >= 30 ? 0.35 : currentDiscountPct >= 15 ? 0.12 : 0.05,
        reboundWithin24h: (candidate.lastDealScoreLabel ?? "") === "false_alarm",
        daysSinceLastStrongDrop: lastDealScoreAt ? daysBetween(new Date(), lastDealScoreAt) : null,
        categoryGapPct: categoryMedian && categoryMedian > 0 ? Number((((categoryMedian - currentPrice) / categoryMedian) * 100).toFixed(2)) : null,
        dealScore: typeof candidate.lastDealScore === "number" ? candidate.lastDealScore : null,
        dealConfidence: typeof candidate.lastDealScoreConfidence === "number" ? candidate.lastDealScoreConfidence : null,
        observationCount,
        name: candidate.name ?? null,
        imageUrl: candidate.imageUrl ?? null,
      } satisfies SmartWishlistCandidateInput;
    });
  }

  private async loadCandidateStats(productIds: string[]): Promise<CandidateStatsRow[]> {
    if (productIds.length === 0) return [];
    const { rows } = await timescale.query<CandidateStatsRow>(
      `SELECT
         product_id,
         MIN(min_price) AS last_30d_min,
         MAX(max_price) AS last_30d_max,
         COALESCE(AVG(avg_price) FILTER (WHERE bucket > NOW() - INTERVAL '7 days'), 0)::INTEGER AS last_7d_avg,
         COALESCE(SUM(observation_count), 0)::INTEGER AS observation_count
       FROM price_history_30min_agg
      WHERE product_id = ANY($1::text[])
        AND bucket > NOW() - INTERVAL '30 days'
      GROUP BY product_id`,
      [productIds],
    );
    return rows;
  }

  private async loadCategoryMedianPrice(product: ProductDoc, currentProductId: string): Promise<number | null> {
    if (!product.category || product.category === "unknown") return null;

    const candidates = (await mongo
      .db("salenoti")
      .collection("products")
      .find(
        {
          category: product.category,
          deletedAt: null,
          $or: [{ region: product.region ?? product.market }, { market: product.region ?? product.market }],
          currentPrice: { $type: "number", $gt: 0 },
        },
        { projection: { shopId: 1, itemId: 1, currentPrice: 1 } },
      )
      .limit(30)
      .toArray()) as Array<{ shopId: number; itemId: number; currentPrice?: number | null }>;

    const prices = candidates
      .filter((candidate) => `${candidate.shopId}-${candidate.itemId}` !== currentProductId)
      .map((candidate) => Number(candidate.currentPrice ?? 0))
      .filter((price) => Number.isFinite(price) && price > 0);

    return median(prices);
  }

  private detectReboundWithin24h(observations: DealScoreObservation[], baselinePrice: number): boolean {
    if (observations.length < 3) return false;
    const latest = observations.at(-1);
    if (!latest) return false;
    const cutoff = latest.observedAt.getTime() - 86_400_000;
    const recent = observations.filter((observation) => observation.observedAt.getTime() >= cutoff);
    if (recent.length < 3) return false;

    let recentFloor = recent[0]?.price ?? baselinePrice;
    for (const observation of recent.slice(1)) {
      if (recentFloor > 0 && observation.price >= recentFloor * 1.08 && recentFloor <= baselinePrice * 0.85) {
        return true;
      }
      recentFloor = Math.min(recentFloor, observation.price);
    }
    return false;
  }

  private findDaysSinceLastStrongDrop(observations: DealScoreObservation[], baselinePrice: number, now = new Date()): number | null {
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      const observation = observations[index];
      if (!observation) continue;
      if (observation.price <= baselinePrice * 0.85) {
        return Math.max(0, daysBetween(now, observation.observedAt));
      }
    }
    return null;
  }

  private async persistSnapshot(args: { watchlist: WatchlistDoc; result: SmartWishlistResult }): Promise<void> {
    const now = new Date(args.result.generatedAt);
    await Promise.allSettled([
      mongo.db("salenoti").collection("watchlists").updateOne(
        { _id: args.watchlist._id },
        {
          $set: {
            smartWishlistSnapshot: args.result,
            smartWishlistUpdatedAt: now,
            updatedAt: now,
          },
        },
      ),
      mongo.db("salenoti").collection("smart_wishlist_history").insertOne({
        watchlistId: args.watchlist._id,
        userId: args.watchlist.userId,
        productId: args.watchlist.productId,
        snapshot: args.result,
        createdAt: now,
      }),
    ]);
  }
}
