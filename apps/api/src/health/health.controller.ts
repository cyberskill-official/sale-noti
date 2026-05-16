// FR-OBS-001 §1 #11 — /health returns the three-pillar status.
import { Controller, Get, Inject } from "@nestjs/common";
import { redis } from "../queue/redis.client";
import { mongo } from "../db/mongo";

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
    return { redis: ok, queues: {} }; // depth wiring lands when worker handlers register
  }
}
