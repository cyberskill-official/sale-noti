import { BadRequestException, ForbiddenException, HttpException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryController, parseHistoryQuery } from "../history.controller";
import { HistoryCacheInvalidator, HistoryService, isValidProductId } from "../history.service";
import { PriceModule } from "../price.module";

const state = vi.hoisted(() => ({
  products: {
    findOne: vi.fn(),
  },
  watchlists: {
    findOne: vi.fn(),
  },
  timescale: {
    getHistory: vi.fn(),
    getBucketedHistory: vi.fn(),
  },
  redisStore: new Map<string, string>(),
  redisCounters: new Map<string, number>(),
  subscriberHandlers: {} as Record<string, (...args: any[]) => unknown>,
  subscriber: {
    subscribe: vi.fn(async () => 1),
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      state.subscriberHandlers[event] = handler;
      return state.subscriber;
    }),
  },
  redis: {
    get: vi.fn(async (key: string) => state.redisStore.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      state.redisStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) state.redisStore.delete(key);
      return keys.length;
    }),
    incr: vi.fn(async (key: string) => {
      const next = (state.redisCounters.get(key) ?? 0) + 1;
      state.redisCounters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    duplicate: vi.fn(() => state.subscriber),
  },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "products") return state.products;
        if (name === "watchlists") return state.watchlists;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

vi.mock("../../db/timescale.client", () => ({
  timescale: state.timescale,
}));

vi.mock("../../queue/redis.client", () => ({
  redis: state.redis,
}));

function makeService() {
  const posthog = { capture: vi.fn() };
  const service = new HistoryService(posthog);
  return { service, posthog };
}

function authorizeByWatchlist(userId = new ObjectId().toHexString()) {
  state.products.findOne.mockResolvedValue(null);
  state.watchlists.findOne.mockResolvedValue({ _id: new ObjectId(), userId: new ObjectId(userId), status: "active" });
  return userId;
}

describe("FR-PRICE-002 — history query parsing", () => {
  it("defaults the dashboard range/granularity and rejects range/product boundary cases", () => {
    expect(parseHistoryQuery({})).toEqual({ range: "30d", granularity: "1h" });
    expect(parseHistoryQuery({ range: "7d", granularity: "raw" })).toEqual({ range: "7d", granularity: "raw" });
    expect(() => parseHistoryQuery({ range: ["30d"] })).toThrow(HttpException);
    expect(() => parseHistoryQuery({ range: "91d" })).toThrow(HttpException);
    expect(() => parseHistoryQuery({ range: "all" })).toThrow(HttpException);
    expect(() => parseHistoryQuery({ granularity: "2h" })).toThrow(HttpException);
    expect(isValidProductId("123-456")).toBe(true);
    expect(isValidProductId("abc-456")).toBe(false);
  });
});

describe("FR-PRICE-002 — HistoryService contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.redisStore.clear();
    state.redisCounters.clear();
    state.subscriberHandlers = {};
    state.products.findOne = vi.fn(async () => null);
    state.watchlists.findOne = vi.fn(async () => null);
    state.timescale.getHistory = vi.fn(async () => [
      { observed_at: new Date("2026-05-18T00:00:00.000Z"), price: 99_000 },
    ]);
    state.timescale.getBucketedHistory = vi.fn(async () => [
      { t: new Date("2026-05-18T00:00:00.000Z"), p: 99_000, p_min: 89_000, p_max: 109_000 },
    ]);
    state.redis.get = vi.fn(async (key: string) => state.redisStore.get(key) ?? null);
    state.redis.setex = vi.fn(async (key: string, _ttl: number, value: string) => {
      state.redisStore.set(key, value);
      return "OK";
    });
    state.redis.del = vi.fn(async (...keys: string[]) => {
      for (const key of keys) state.redisStore.delete(key);
      return keys.length;
    });
    state.redis.incr = vi.fn(async (key: string) => {
      const next = (state.redisCounters.get(key) ?? 0) + 1;
      state.redisCounters.set(key, next);
      return next;
    });
    state.redis.expire = vi.fn(async () => 1);
    state.redis.duplicate = vi.fn(() => state.subscriber);
    state.subscriber.subscribe = vi.fn(async () => 1);
    state.subscriber.on = vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      state.subscriberHandlers[event] = handler;
      return state.subscriber;
    });
    delete process.env.ADMIN_TOKEN;
  });

  it("returns bucketed chart points, caches for 5 minutes, and emits latency without userId", async () => {
    const userId = authorizeByWatchlist();
    const { service, posthog } = makeService();

    const fresh = await service.getHistory({
      userId,
      productId: "123-456",
      range: "30d",
      granularity: "1h",
      source: "web",
    });
    const cached = await service.getHistory({
      userId,
      productId: "123-456",
      range: "30d",
      granularity: "1h",
      source: "web",
    });

    expect(fresh.points).toEqual([{ t: new Date("2026-05-18T00:00:00.000Z"), p: 99_000, p_min: 89_000, p_max: 109_000 }]);
    expect(cached).toEqual(fresh);
    expect(state.timescale.getBucketedHistory).toHaveBeenCalledTimes(1);
    expect(state.timescale.getBucketedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "123-456", bucketInterval: "1 hour" }),
    );
    expect(state.redis.setex).toHaveBeenCalledWith("history:123-456:30d:1h", 300, expect.any(String));
    expect(posthog.capture).toHaveBeenNthCalledWith(
      1,
      "price_history_viewed",
      expect.objectContaining({ productId: "123-456", range: "30d", granularity: "1h", cached: false, latency_ms: expect.any(Number) }),
    );
    expect(posthog.capture).toHaveBeenNthCalledWith(
      2,
      "price_history_viewed",
      expect.not.objectContaining({ userId }),
    );
  });

  it("routes raw reads through Timescale raw history only for 7d", async () => {
    const userId = authorizeByWatchlist();
    const { service } = makeService();

    await expect(
      service.getHistory({ userId, productId: "123-456", range: "30d", granularity: "raw", source: "web" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.getHistory({ userId, productId: "123-456", range: "7d", granularity: "raw", source: "web" }),
    ).resolves.toMatchObject({
      productId: "123-456",
      points: [{ p: 99_000, p_min: 99_000, p_max: 99_000 }],
    });
    expect(state.timescale.getHistory).toHaveBeenCalledWith(
      "123-456",
      expect.any(Date),
      expect.any(Date),
      "raw",
    );
  });

  it("authorizes active/paused watchlists, public deal products, and admin token access", async () => {
    const userId = new ObjectId().toHexString();
    const { service } = makeService();

    state.watchlists.findOne.mockResolvedValueOnce({ status: "paused" });
    await expect(
      service.getHistory({ userId, productId: "123-456", range: "30d", granularity: "1h", source: "web" }),
    ).resolves.toMatchObject({ productId: "123-456" });
    expect(state.watchlists.findOne).toHaveBeenCalledWith({
      userId: { $in: [new ObjectId(userId), userId] },
      productId: "123-456",
      status: { $in: ["active", "paused"] },
    });

    state.products.findOne.mockResolvedValueOnce({ publicDealAt: new Date() });
    await expect(
      service.getHistory({ userId: null, productId: "123-456", range: "30d", granularity: "1h", source: "deal-page" }),
    ).resolves.toMatchObject({ productId: "123-456" });

    process.env.ADMIN_TOKEN = "secret-admin";
    await expect(
      service.getHistory({
        userId: null,
        adminToken: "secret-admin",
        productId: "123-456",
        range: "30d",
        granularity: "1h",
        source: "web",
      }),
    ).resolves.toMatchObject({ productId: "123-456" });
  });

  it("rejects invalid product IDs, forbidden private products, and recovers from malformed cache entries", async () => {
    const userId = authorizeByWatchlist();
    const { service } = makeService();

    await expect(
      service.getHistory({ userId, productId: "abc-xyz", range: "30d", granularity: "1h", source: "web" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    state.watchlists.findOne.mockResolvedValueOnce(null);
    await expect(
      service.getHistory({ userId, productId: "123-456", range: "30d", granularity: "1h", source: "web" }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    state.watchlists.findOne.mockRejectedValueOnce(new Error("mongo read failed"));
    await expect(
      service.getHistory({ userId, productId: "123-456", range: "30d", granularity: "1h", source: "web" }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    state.watchlists.findOne.mockResolvedValue({ status: "active" });
    state.redisStore.set("history:123-456:30d:1h", "{not-json");
    await expect(
      service.getHistory({ userId, productId: "123-456", range: "30d", granularity: "1h", source: "web" }),
    ).resolves.toMatchObject({ productId: "123-456" });
    expect(state.redis.del).toHaveBeenCalledWith("history:123-456:30d:1h");
  });

  it("invalidates all range/granularity cache keys via service and Redis pubsub subscriber", async () => {
    const { service } = makeService();
    const invalidator = new HistoryCacheInvalidator(service);
    const warn = vi.spyOn((invalidator as any).log, "warn").mockImplementation(() => undefined);
    await invalidator.onModuleInit();
    const messageHandler = state.subscriberHandlers.message!;
    const errorHandler = state.subscriberHandlers.error!;

    await messageHandler("ignored", "123-456");
    await messageHandler("price_history_invalidate", 123);
    await messageHandler("price_history_invalidate", "123-456");
    state.redis.del.mockRejectedValueOnce(new Error("redis del failed"));
    await messageHandler("price_history_invalidate", "123-456");
    errorHandler(new Error("subscriber down"));

    expect(state.redis.duplicate).toHaveBeenCalled();
    expect(state.subscriber.subscribe).toHaveBeenCalledWith("price_history_invalidate");
    expect(state.redis.del).toHaveBeenCalledWith(
      "history:123-456:7d:raw",
      "history:123-456:7d:30m",
      "history:123-456:7d:1h",
      "history:123-456:7d:6h",
      "history:123-456:7d:1d",
      "history:123-456:30d:raw",
      "history:123-456:30d:30m",
      "history:123-456:30d:1h",
      "history:123-456:30d:6h",
      "history:123-456:30d:1d",
      "history:123-456:90d:raw",
      "history:123-456:90d:30m",
      "history:123-456:90d:1h",
      "history:123-456:90d:6h",
      "history:123-456:90d:1d",
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("history cache invalidate failed"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("history cache subscriber error"));
  });

  it("keeps commissionRate out of successful responses, including empty history", async () => {
    const userId = authorizeByWatchlist();
    state.timescale.getBucketedHistory.mockResolvedValueOnce([]);
    const { service } = makeService();

    const result = await service.getHistory({
      userId,
      productId: "123-456",
      range: "90d",
      granularity: "1d",
      source: "ext",
    });

    expect(result.points).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/commissionRate/i);
  });
});

describe("FR-PRICE-002 — HistoryController contract", () => {
  beforeEach(() => {
    state.redisCounters.clear();
    state.redis.incr = vi.fn(async (key: string) => {
      const next = (state.redisCounters.get(key) ?? 0) + 1;
      state.redisCounters.set(key, next);
      return next;
    });
    state.redis.expire = vi.fn(async () => 1);
    delete process.env.ADMIN_TOKEN;
  });

  it("passes defaults, source, admin, and rate-limited user context into the service", async () => {
    const history = {
      getHistory: vi.fn(async () => ({ productId: "123-456", range: "30d", granularity: "1h", points: [] })),
    };
    const controller = new HistoryController(history as any);

    await expect(
      controller.getHistory("123-456", {}, "user-1", undefined, "ext", "203.0.113.44", undefined),
    ).resolves.toEqual({ productId: "123-456", range: "30d", granularity: "1h", points: [] });
    expect(state.redis.incr).toHaveBeenCalledWith(expect.stringContaining("rl:history:user:user-1:"));
    expect(history.getHistory).toHaveBeenCalledWith({
      userId: "user-1",
      adminToken: undefined,
      productId: "123-456",
      range: "30d",
      granularity: "1h",
      source: "ext",
    });

    process.env.ADMIN_TOKEN = "secret-admin";
    await controller.getHistory("123-456", {}, undefined, "secret-admin", undefined, undefined, undefined);
    expect(state.redis.incr).toHaveBeenLastCalledWith(expect.stringContaining("rl:history:admin:"));

    await controller.getHistory("123-456", {}, undefined, undefined, undefined, undefined, undefined);
    expect(state.redis.incr).toHaveBeenLastCalledWith(expect.stringContaining("rl:history:ip:0.0.0:"));
  });

  it("returns exact HTTP errors for invalid product IDs, large ranges, and user/anonymous rate limits", async () => {
    const controller = new HistoryController({ getHistory: vi.fn() } as any);
    const res = { setHeader: vi.fn() };

    await expect(
      controller.getHistory("abc-xyz", {}, "user-1", undefined, undefined, undefined, undefined, res as any),
    ).rejects.toMatchObject({ response: { error: "invalid_productId" }, status: 400 });
    await expect(
      controller.getHistory("123-456", { range: "91d" }, "user-1", undefined, undefined, undefined, undefined, res as any),
    ).rejects.toMatchObject({ response: { error: "range_too_large" }, status: 400 });

    state.redis.incr.mockResolvedValueOnce(61);
    await expect(
      controller.getHistory("123-456", {}, "user-1", undefined, undefined, undefined, undefined, res as any),
    ).rejects.toMatchObject({ response: { error: "rate_limit", retryAfter: 60 }, status: 429 });
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");

    state.redis.incr.mockResolvedValueOnce(31);
    await expect(
      controller.getHistory("123-456", {}, undefined, undefined, "deal-page", "198.51.100.88", undefined, res as any),
    ).rejects.toMatchObject({ response: { error: "rate_limit", retryAfter: 60 }, status: 429 });
    expect(state.redis.incr).toHaveBeenLastCalledWith(expect.stringContaining("rl:history:ip:198.51.100:"));
  });

  it("loads the Nest price module metadata", () => {
    expect(PriceModule).toBeDefined();
  });
});
