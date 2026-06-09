// FR-WORKER-002 + FR-AFF-003 — consumes price-check jobs, records fresh price,
// evaluates watchlist triggers, and enqueues alert-dispatch jobs.
import { Inject, Logger } from "@nestjs/common";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { mongo } from "../db/mongo";
import { timescale } from "../db/timescale.client";
import { evaluateTriggers } from "../watchlist/trigger-eval";
import { reevaluateTier } from "../scheduler/priority-engine";
import { priceCheckWorkerOptions } from "../queue/queues";
import { OfferResolverService } from "./offer-resolver.service";
import { ShopeeApiError } from "./shopee/errors";
import {
  extractDealScoreWindow,
  normalizeDealScoreMarket,
  scoreDeal,
  type DealScoreObservation,
} from "@salenoti/deal-scoring";

type PriceCheckJob = {
  productId: string;
  shopId: number;
  itemId: number;
  tier: "hot" | "mid" | "low";
};

function isShopeeBackoffFailure(error: Error): boolean {
  return error instanceof ShopeeApiError && (error.code === "rate_limit" || error.code === "service_unavailable");
}

@Processor("price-check", priceCheckWorkerOptions())
export class PriceCheckProcessor extends WorkerHost {
  private readonly log = new Logger(PriceCheckProcessor.name);

  constructor(
    private readonly resolver: OfferResolverService,
    @InjectQueue("alert-dispatch") private readonly alerts: Queue,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any,
  ) {
    super();
  }

  async process(job: Job<PriceCheckJob>): Promise<void> {
    const offer = await this.resolver.resolveProductOffer(job.data.shopId, job.data.itemId);
    if (!offer) return;

    const productId = `${job.data.shopId}-${job.data.itemId}`;
    const last30dMin = await timescale.getLast30dMin(productId).catch(() => null);
    const watchlists = await mongo
      .db("salenoti")
      .collection("watchlists")
      .find({ productId, status: "active" })
      .toArray();

    let alertJobs = 0;
    for (const wl of watchlists) {
      const triggered = evaluateTriggers(wl.alertConfig?.triggers ?? [], {
        currentPrice: offer.currentPrice,
        lastObservedPrice: wl.lastObservedPrice ?? wl.baselineAtTrack ?? offer.originalPrice,
        baselineAtTrack: wl.baselineAtTrack ?? offer.originalPrice,
        last30dMin: last30dMin ?? offer.currentPrice,
        flashSaleObserved: offer.flashSale,
        currentDiscountPct: offer.currentDiscountPct,
        cooldowns: wl.triggerCooldowns ?? {},
      }).triggered;

      if (triggered.length === 0) continue;
      await mongo
        .db("salenoti")
        .collection("products")
        .updateOne({ shopId: job.data.shopId, itemId: job.data.itemId }, { $set: { lastAlertAt: new Date() } });

      for (const triggerKind of triggered) {
        await this.alerts.add(
          `alert-${triggerKind}`,
          {
            userId: String(wl.userId),
            watchlistId: String(wl._id),
            triggerKind,
            observedAt: new Date().toISOString(),
          },
          { jobId: `alert:${wl._id}:${triggerKind}:${Math.floor(Date.now() / 60_000)}` },
        );
        alertJobs++;
      }
    }

    const nextTier = await reevaluateTier(productId);
    const dealScoreWindow = await this.buildDealScoreWindow({
      productId,
      shopId: job.data.shopId,
      itemId: job.data.itemId,
      offer,
    });
    const dealScore = scoreDeal(dealScoreWindow);

    await mongo
      .db("salenoti")
      .collection("products")
      .updateOne(
        { shopId: job.data.shopId, itemId: job.data.itemId },
        {
          $set: {
            trackPriority: nextTier,
            lastPriceCheckAt: new Date(),
            lastDealScore: dealScore.score,
            lastDealScoreLabel: dealScore.label,
            lastDealScoreConfidence: dealScore.confidence,
            lastDealScoreModelVersion: dealScore.modelVersion,
            lastDealScoreModelSource: dealScore.modelSource,
            lastDealScoreAt: new Date(dealScore.generatedAt),
            lastRecommendedPricePoint: dealScore.recommendedPricePoint,
          },
        },
      );

    await mongo.db("salenoti").collection("deal_scores").insertOne({
      productId,
      shopId: job.data.shopId,
      itemId: job.data.itemId,
      market: dealScoreWindow.market,
      range: dealScoreWindow.range,
      score: dealScore.score,
      confidence: dealScore.confidence,
      label: dealScore.label,
      recommendedPricePoint: dealScore.recommendedPricePoint,
      modelVersion: dealScore.modelVersion,
      modelSource: dealScore.modelSource,
      reasons: [...dealScore.reasons],
      currentPrice: dealScoreWindow.currentPrice,
      baselinePrice: dealScoreWindow.baselinePrice,
      last30dMin: dealScoreWindow.last30dMin,
      currentDiscountPct: dealScoreWindow.currentDiscountPct,
      discountPersistenceHours: dealScoreWindow.discountPersistenceHours,
      priceVolatility: dealScoreWindow.priceVolatility,
      categoryMedianPrice: dealScoreWindow.categoryMedianPrice,
      categoryGapPct: dealScoreWindow.categoryGapPct,
      flashSaleObserved: dealScoreWindow.flashSaleObserved,
      reboundWithin24h: dealScoreWindow.reboundWithin24h,
      daysSinceLastStrongDrop: dealScoreWindow.daysSinceLastStrongDrop,
      observationCount: dealScoreWindow.observationCount,
      createdAt: new Date(dealScore.generatedAt),
    });

    this.posthog.capture("price_check_completed", {
      productId,
      tier: job.data.tier,
      nextTier,
      alertJobs,
    });
    this.posthog.capture("deal_score_computed", {
      productId,
      shopId: job.data.shopId,
      itemId: job.data.itemId,
      market: dealScoreWindow.market,
      range: dealScoreWindow.range,
      score: dealScore.score,
      confidence: dealScore.confidence,
      label: dealScore.label,
      modelVersion: dealScore.modelVersion,
      modelSource: dealScore.modelSource,
      reasons: [...dealScore.reasons],
    });
    this.log.debug(`price-check ${productId}: ${alertJobs} alert job(s), next tier ${nextTier}`);
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<PriceCheckJob> | undefined, error: Error): Promise<void> {
    const productId = job?.data.productId;
    if (!productId) return;
    const attempts = job?.attemptsMade ?? 0;
    if (attempts >= 5 && isShopeeBackoffFailure(error)) {
      await mongo
        .db("salenoti")
        .collection("products")
        .updateOne(
          { shopId: job.data.shopId, itemId: job.data.itemId },
          { $set: { trackPriority: "low", cooldownUntil: new Date(Date.now() + 86_400_000) } },
        );
      this.sentry.captureException(error, {
        level: "warning",
        tags: { fr: "FR-WORKER-002", kind: "shopee_repeated_failure", productId },
      });
    }
  }

  private async buildDealScoreWindow(args: {
    productId: string;
    shopId: number;
    itemId: number;
    offer: Awaited<ReturnType<OfferResolverService["resolveProductOffer"]>> extends infer T
      ? Exclude<T, null>
      : never;
  }) {
    const { productId, shopId, itemId, offer } = args;
    const now = new Date();
    const historyStart = new Date(now);
    historyStart.setDate(historyStart.getDate() - 30);

    try {
      const product = await mongo
        .db("salenoti")
        .collection("products")
        .findOne({ shopId, itemId }, { projection: { category: 1, region: 1, market: 1 } });

      const history = await timescale.query<{
        observed_at: Date;
        price: number;
        flash_sale: boolean;
      }>(
        `SELECT observed_at, price, flash_sale
         FROM price_history
         WHERE product_id = $1 AND observed_at >= $2
         ORDER BY observed_at ASC`,
        [productId, historyStart],
      );

      const observations: DealScoreObservation[] = history.rows.map((row) => ({
        observedAt: row.observed_at,
        price: Number(row.price ?? 0),
        flashSale: Boolean(row.flash_sale),
      }));

      const last30dMin = await timescale.getLast30dMin(productId).catch(() => null);
      const baselinePrice = Math.max(offer.originalPrice, last30dMin ?? 0, offer.currentPrice);
      const market = normalizeDealScoreMarket((product as any)?.region ?? (product as any)?.market) ?? "VN";
      const categoryMedianPrice = await this.getCategoryMedianPrice((product as any)?.category as string | undefined);
      const reboundWithin24h = this.detectReboundWithin24h(observations, baselinePrice, now);
      const daysSinceLastStrongDrop = this.findDaysSinceLastStrongDrop(observations, baselinePrice, now);

      return extractDealScoreWindow({
        productId,
        market,
        range: "30d",
        observations,
        baselinePrice,
        last30dMin: last30dMin ?? offer.currentPrice,
        currentDiscountPct: offer.currentDiscountPct,
        categoryMedianPrice,
        reboundWithin24h,
        daysSinceLastStrongDrop,
      });
    } catch (error) {
      this.sentry.captureException(error, {
        level: "warning",
        tags: { fr: "FR-PRICE-003", kind: "deal_score_context_fallback", productId },
      });

      return extractDealScoreWindow({
        productId,
        market: "VN",
        range: "30d",
        observations: [],
        baselinePrice: offer.originalPrice,
        last30dMin: offer.currentPrice,
        currentDiscountPct: offer.currentDiscountPct,
        categoryMedianPrice: null,
        reboundWithin24h: false,
        daysSinceLastStrongDrop: null,
      });
    }
  }

  private async getCategoryMedianPrice(category: string | undefined): Promise<number | null> {
    if (!category || category === "unknown") return null;

    const products = await mongo
      .db("salenoti")
      .collection("products")
      .find({ category, currentPrice: { $type: "number", $gt: 0 } })
      .project({ currentPrice: 1 })
      .toArray();

    const sorted = products
      .map((product) => Number(product.currentPrice))
      .filter((price) => Number.isFinite(price) && price > 0)
      .sort((left, right) => left - right);

    if (sorted.length === 0) return null;

    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
      return Math.round(sorted[middle] ?? 0);
    }

    const left = sorted[middle - 1];
    const right = sorted[middle];
    if (left == null || right == null) return null;
    return Math.round((left + right) / 2);
  }

  private detectReboundWithin24h(
    observations: DealScoreObservation[],
    baselinePrice: number,
    now: Date,
  ): boolean {
    if (observations.length < 3) return false;

    const recent = observations.filter(
      (observation) => now.getTime() - new Date(observation.observedAt).getTime() <= 86_400_000,
    );
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

  private findDaysSinceLastStrongDrop(
    observations: DealScoreObservation[],
    baselinePrice: number,
    now: Date,
  ): number | null {
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      const observation = observations[index];
      if (!observation) continue;
      if (observation.price <= baselinePrice * 0.85) {
        return Math.max(0, Math.round((now.getTime() - new Date(observation.observedAt).getTime()) / 86_400_000));
      }
    }

    return null;
  }
}
