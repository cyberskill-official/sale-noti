// FR-OBS-001 §1 #11 — /api/health (Better Stack target).
import { Redis } from "ioredis";
import { mongo } from "@/server/db/mongo";

export const runtime = "nodejs";

async function withTimeout(check: Promise<boolean>, timeoutMs = 1000): Promise<boolean> {
  return Promise.race([check, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
}

export async function GET() {
  const started = Date.now();
  const checks = {
    mongo: await withTimeout(
      process.env.MONGO_URI_SG || process.env.MONGODB_URI
        ? mongo
            .db("salenoti")
            .command({ ping: 1 })
            .then(() => true)
            .catch(() => false)
        : Promise.resolve(false),
    ),
    redis: await withTimeout(
      process.env.REDIS_URL
        ? (() => {
            const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, enableReadyCheck: false });
            return redis
              .ping()
              .then(() => redis.quit().then(() => true))
              .catch(() => {
                redis.disconnect();
                return false;
              });
          })()
        : Promise.resolve(false),
    ),
    resend: Boolean(process.env.RESEND_API_KEY),
    timescale: Boolean(process.env.TIMESCALE_DB_URL),
  };
  const ok = Object.values(checks).every(Boolean);
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      checks,
      version: process.env.GIT_COMMIT ?? "local-dev",
      uptime_seconds: Math.round(process.uptime()),
      latency_ms: Date.now() - started,
    },
    { status: ok ? 200 : 503 }
  );
}
