// FR-OBS-001 §1 #11 — /health returns the three-pillar status.
import { Controller, Get } from "@nestjs/common";
import { Queue } from "bullmq";
import { redis } from "../queue/redis.client";
import { mongo } from "../db/mongo";
import { QUEUES, bullConnectionFromUrl, type QueueName } from "../queue/queues";

@Controller("health")
export class HealthController {
  @Get()
  async health() {
    const mongoCheck = process.env.MONGODB_URI
      ? mongo.db("salenoti").command({ ping: 1 }).then(() => true).catch(() => false)
      : Promise.resolve(false);
    const redisCheck = process.env.REDIS_URL
      ? redis.ping().then(() => true).catch(() => false)
      : Promise.resolve(false);
    const [m, r] = await Promise.all([mongoCheck, redisCheck]);
    const ok = m && r;
    return { status: ok ? "ok" : "degraded", checks: { mongo: m, redis: r } };
  }
}

@Controller("health/queue")
export class QueueHealthController {
  @Get()
  async queueHealth() {
    if (!process.env.REDIS_URL) return { redis: false, queues: {} };
    const ok = await redis.ping().then(() => true).catch(() => false);
    const connection = bullConnectionFromUrl(process.env.REDIS_URL);
    const queueEntries = await Promise.all(
      QUEUES.map(async (name) => {
        const q = new Queue(name, { connection });
        try {
          const counts = await q.getJobCounts("waiting", "delayed", "active", "failed");
          const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
          return [name, { ready: ok, depth, failed: counts.failed ?? 0 }] as const;
        } finally {
          await q.close();
        }
      })
    );
    return { redis: ok, queues: Object.fromEntries(queueEntries) as Record<QueueName, { ready: boolean; depth: number; failed: number }> };
  }
}
