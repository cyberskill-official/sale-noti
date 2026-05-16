// FR-WORKER-002 §3 — adaptive scheduler service.
// Cron every minute; spreads tier load across cadence windows; halves enqueue rate on >5% error window.
import { Injectable, Logger, Inject } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { computeApiHealth } from "./shopee-api-health";

type Tier = "hot" | "mid" | "low";

const TIER_CADENCE_MIN: Record<Tier, number> = { hot: 30, mid: 360, low: 1440 };

@Injectable()
export class AdaptiveSchedulerService {
  private readonly log = new Logger(AdaptiveSchedulerService.name);

  constructor(
    @InjectQueue("price-check") private readonly q: Queue,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  /**
   * FR-WORKER-002 §1 #3 — distribute enqueue evenly within each tier's cadence window.
   * Selection uses `_scheduleHash mod cadenceMin === minute mod cadenceMin` so each product
   * lands in exactly one minute of its cadence window.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: "tier-enqueue" })
  async enqueueByTier() {
    // In dev / before Mongo wiring, gracefully no-op.
    if (!process.env.MONGODB_URI) {
      this.log.debug("MONGODB_URI not set; scheduler no-op");
      return;
    }

    const { mongo } = await import("../db/mongo");
    const health = await computeApiHealth();
    const scaleFactor = health.errorRate5m > 0.05 ? 0.5 : 1.0;
    const minute = Math.floor(Date.now() / 60_000);

    for (const tier of ["hot", "mid", "low"] as Tier[]) {
      const cadenceMin = TIER_CADENCE_MIN[tier];
      const slot = minute % cadenceMin;
      const count = await mongo.db("salenoti").collection("products").countDocuments({ trackPriority: tier });
      const perMinute = Math.ceil((count * scaleFactor) / cadenceMin);

      // FR-GROW-003 §1 #12 — Mega Sale Mode hot cap 50K.
      const cap = tier === "hot" ? Math.min(perMinute, Math.ceil(50_000 / cadenceMin)) : perMinute;

      const cursor = mongo
        .db("salenoti")
        .collection("products")
        .find(
          { trackPriority: tier, _scheduleHash: { $mod: [cadenceMin, slot] } },
          { projection: { _id: 1, shopId: 1, itemId: 1 } }
        )
        .limit(cap);
      let enqueued = 0;
      for await (const p of cursor) {
        await this.q.add(
          `pc-${tier}`,
          { productId: String(p._id), shopId: p.shopId, itemId: p.itemId, tier },
          { jobId: `pc:${p._id}:${minute}`, removeOnComplete: 100 }
        );
        enqueued++;
      }
      this.posthog.capture("scheduler_tier_health", {
        tier,
        scheduled: enqueued,
        scale: scaleFactor,
        errorRate5m: health.errorRate5m,
      });
      this.log.log(`Tier ${tier}: enqueued ${enqueued}/${perMinute} (scale=${scaleFactor})`);
    }
  }
}
