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
    await mongo
      .db("salenoti")
      .collection("products")
      .updateOne(
        { shopId: job.data.shopId, itemId: job.data.itemId },
        { $set: { trackPriority: nextTier, lastPriceCheckAt: new Date() } },
      );

    this.posthog.capture("price_check_completed", {
      productId,
      tier: job.data.tier,
      nextTier,
      alertJobs,
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
}
