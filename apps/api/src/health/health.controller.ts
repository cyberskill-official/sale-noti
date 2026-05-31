// FR-OBS-001 §1 #11 — /health returns the three-pillar status.
import { Controller, Get, Res } from "@nestjs/common";
import { Queue } from "bullmq";
import { redis } from "../queue/redis.client";
import { mongo } from "../db/mongo";
import { QUEUES, bullConnectionFromUrl, type QueueName } from "../queue/queues";
import { timescale } from "../db/timescale.client";

type HealthChecks = {
  mongo: boolean;
  redis: boolean;
  resend: boolean;
  timescale: boolean;
};

export type HealthPayload = {
  status: "ok" | "degraded";
  checks: HealthChecks;
  version: string;
  uptime_seconds: number;
  latency_ms: number;
};

export async function withTimeout(check: Promise<boolean>, timeoutMs = 1000): Promise<boolean> {
  return Promise.race([check, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
}

function mongoCheck(): Promise<boolean> {
  return process.env.MONGO_URI_SG || process.env.MONGODB_URI
    ? mongo
        .db("salenoti")
        .command({ ping: 1 })
        .then(() => true)
        .catch(() => false)
    : Promise.resolve(false);
}

function redisCheck(): Promise<boolean> {
  return process.env.REDIS_URL ? redis.ping().then(() => true).catch(() => false) : Promise.resolve(false);
}

function timescaleCheck(): Promise<boolean> {
  return process.env.TIMESCALE_DB_URL
    ? timescale.healthCheck().then((result) => result.ok).catch(() => false)
    : Promise.resolve(false);
}

export async function buildHealthPayload(timeoutMs = 1000): Promise<HealthPayload> {
  const started = Date.now();
  const [m, r, t] = await Promise.all([
    withTimeout(mongoCheck(), timeoutMs),
    withTimeout(redisCheck(), timeoutMs),
    withTimeout(timescaleCheck(), timeoutMs),
  ]);
  const checks = {
    mongo: m,
    redis: r,
    resend: Boolean(process.env.RESEND_API_KEY),
    timescale: t,
  };
  const ok = Object.values(checks).every(Boolean);
  return {
    status: ok ? "ok" : "degraded",
    checks,
    version: process.env.GIT_COMMIT ?? "local-dev",
    uptime_seconds: Math.round(process.uptime()),
    latency_ms: Date.now() - started,
  };
}

@Controller("health")
export class HealthController {
  @Get()
  async health(@Res({ passthrough: true }) response?: { status: (code: number) => unknown }) {
    const payload = await buildHealthPayload();
    response?.status(payload.status === "ok" ? 200 : 503);
    return payload;
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
