import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthController, QueueHealthController, buildHealthPayload, withTimeout } from "../health.controller";

const healthMock = vi.hoisted(() => ({
  mongoOk: true,
  redisOk: true,
  timescaleOk: true,
  jobCounts: { waiting: 2, delayed: 3, active: 1, failed: 4 },
  mongoPing: vi.fn(),
  redisPing: vi.fn(),
  timescaleHealthCheck: vi.fn(),
  queueClose: vi.fn(),
  bullConnectionFromUrl: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(
      readonly name: string,
      readonly options: unknown,
    ) {}

    async getJobCounts() {
      return healthMock.jobCounts;
    }

    async close() {
      healthMock.queueClose(this.name);
    }
  },
}));

vi.mock("../../queue/queues", () => ({
  QUEUES: ["price-check", "alert-dispatch"],
  bullConnectionFromUrl: healthMock.bullConnectionFromUrl,
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      command: healthMock.mongoPing,
    }),
  },
}));

vi.mock("../../queue/redis.client", () => ({
  redis: {
    ping: healthMock.redisPing,
  },
}));

vi.mock("../../db/timescale.client", () => ({
  timescale: {
    healthCheck: healthMock.timescaleHealthCheck,
  },
}));

beforeEach(() => {
  delete process.env.MONGODB_URI;
  delete process.env.REDIS_URL;
  delete process.env.TIMESCALE_DB_URL;
  delete process.env.RESEND_API_KEY;
  delete process.env.GIT_COMMIT;
  healthMock.mongoOk = true;
  healthMock.redisOk = true;
  healthMock.timescaleOk = true;
  healthMock.mongoPing.mockReset();
  healthMock.redisPing.mockReset();
  healthMock.timescaleHealthCheck.mockReset();
  healthMock.queueClose.mockReset();
  healthMock.bullConnectionFromUrl.mockReset();
  healthMock.mongoPing.mockImplementation(async () => {
    if (!healthMock.mongoOk) throw new Error("mongo down");
    return { ok: 1 };
  });
  healthMock.redisPing.mockImplementation(async () => {
    if (!healthMock.redisOk) throw new Error("redis down");
    return "PONG";
  });
  healthMock.timescaleHealthCheck.mockImplementation(async () => ({ ok: healthMock.timescaleOk, latest_observation: null }));
  healthMock.bullConnectionFromUrl.mockImplementation((url: string) => ({ host: url }));
});

describe("FR-OBS-001 — API health contract", () => {
  it("returns degraded without provider env and avoids touching missing clients", async () => {
    const payload = await buildHealthPayload(5);

    expect(payload.status).toBe("degraded");
    expect(payload.checks).toEqual({ mongo: false, redis: false, resend: false, timescale: false });
    expect(payload.version).toBe("local-dev");
    expect(payload.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(payload.latency_ms).toBeGreaterThanOrEqual(0);
    expect(healthMock.mongoPing).not.toHaveBeenCalled();
    expect(healthMock.redisPing).not.toHaveBeenCalled();
    expect(healthMock.timescaleHealthCheck).not.toHaveBeenCalled();
  });

  it("returns ok with all dependency signals present and sets HTTP 200", async () => {
    process.env.MONGODB_URI = "mongodb://localhost:27017";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.TIMESCALE_DB_URL = "postgres://localhost/salenoti";
    process.env.RESEND_API_KEY = "re_test";
    process.env.GIT_COMMIT = "obs123";
    const status = vi.fn();

    const response = await new HealthController().health({ status });

    expect(response.status).toBe("ok");
    expect(response.checks).toEqual({ mongo: true, redis: true, resend: true, timescale: true });
    expect(response.version).toBe("obs123");
    expect(status).toHaveBeenCalledWith(200);
  });

  it("returns degraded and HTTP 503 when any dependency check fails", async () => {
    process.env.MONGODB_URI = "mongodb://localhost:27017";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.TIMESCALE_DB_URL = "postgres://localhost/salenoti";
    process.env.RESEND_API_KEY = "re_test";
    healthMock.redisOk = false;
    const status = vi.fn();

    const response = await new HealthController().health({ status });

    expect(response.status).toBe("degraded");
    expect(response.checks.redis).toBe(false);
    expect(status).toHaveBeenCalledWith(503);
  });

  it("times out slow checks within the configured budget", async () => {
    const started = Date.now();
    const result = await withTimeout(new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50)), 5);

    expect(result).toBe(false);
    expect(Date.now() - started).toBeLessThan(40);
  });

  it("reports empty queue health without Redis env", async () => {
    await expect(new QueueHealthController().queueHealth()).resolves.toEqual({ redis: false, queues: {} });
    expect(healthMock.bullConnectionFromUrl).not.toHaveBeenCalled();
  });

  it("reports queue depth and closes BullMQ handles with Redis env", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";

    const response = await new QueueHealthController().queueHealth();

    expect(response).toEqual({
      redis: true,
      queues: {
        "price-check": { ready: true, depth: 6, failed: 4 },
        "alert-dispatch": { ready: true, depth: 6, failed: 4 },
      },
    });
    expect(healthMock.bullConnectionFromUrl).toHaveBeenCalledWith("redis://localhost:6379");
    expect(healthMock.queueClose).toHaveBeenCalledWith("price-check");
    expect(healthMock.queueClose).toHaveBeenCalledWith("alert-dispatch");
  });

  it("defaults missing queue counts to zero", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    healthMock.jobCounts = {} as typeof healthMock.jobCounts;

    const response = await new QueueHealthController().queueHealth();
    const queues = response.queues as Record<string, { ready: boolean; depth: number; failed: number }>;

    expect(queues["price-check"]).toEqual({ ready: true, depth: 0, failed: 0 });
  });
});
