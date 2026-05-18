// FR-WORKER-002 §3 — adaptive scheduler service.
// Cron every minute; spreads tier load across cadence windows; halves enqueue rate on >5% error window.
import { Injectable, Logger, Inject } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { computeApiHealth } from "./shopee-api-health";
import { PRICE_CHECK_JOB_OPTIONS } from "../queue/queues";

type Tier = "hot" | "mid" | "low";

const TIER_CADENCE_MIN: Record<Tier, number> = { hot: 30, mid: 360, low: 1440 };

@Injectable()
export class AdaptiveSchedulerService {
  private readonly log = new Logger(AdaptiveSchedulerService.name);

  constructor(
    @InjectQueue("price-check") private readonly q: Queue,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
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
    const now = new Date();
    const queueCounts = await this.q
      .getJobCounts("waiting", "delayed", "active", "completed", "failed")
      .catch(() => ({ waiting: 0, delayed: 0, active: 0, completed: 0, failed: 0 }));
    const currentDepth = (queueCounts.waiting ?? 0) + (queueCounts.delayed ?? 0) + (queueCounts.active ?? 0);

    for (const tier of ["hot", "mid", "low"] as Tier[]) {
      const cadenceMin = TIER_CADENCE_MIN[tier];
      const slot = minute % cadenceMin;
      const baseFilter = {
        trackPriority: tier,
        $or: [{ cooldownUntil: { $exists: false } }, { cooldownUntil: { $lte: now } }],
      };
      const count = await mongo.db("salenoti").collection("products").countDocuments(baseFilter);
      const perMinute = Math.ceil((count * scaleFactor) / cadenceMin);

      // FR-GROW-003 §1 #12 — Mega Sale Mode hot cap 50K.
      const cap = tier === "hot" ? Math.min(perMinute, Math.ceil(50_000 / cadenceMin)) : perMinute;

      const cursor = mongo
        .db("salenoti")
        .collection("products")
        .find(
          { ...baseFilter, _scheduleHash: { $mod: [cadenceMin, slot] } },
          { projection: { _id: 1, shopId: 1, itemId: 1 } },
        )
        .limit(cap);
      let enqueued = 0;
      for await (const p of cursor) {
        await this.q.add(
          `pc-${tier}`,
          { productId: String(p._id), shopId: p.shopId, itemId: p.itemId, tier },
          {
            ...PRICE_CHECK_JOB_OPTIONS,
            delay: Math.floor(Math.random() * 10_000),
            jobId: `pc:${p._id}:${minute}`,
          },
        );
        enqueued++;
      }
      this.posthog.capture("scheduler_tier_health", {
        tier,
        scheduled: enqueued,
        succeeded: queueCounts.completed ?? 0,
        failed: queueCounts.failed ?? 0,
        current_depth: currentDepth,
        queueDepth: currentDepth,
        scale: scaleFactor,
        errorRate5m: health.errorRate5m,
      });
      this.log.log(`Tier ${tier}: enqueued ${enqueued}/${perMinute} (scale=${scaleFactor})`);
    }
  }
}
