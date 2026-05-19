import crypto from "node:crypto";
import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseShopeeUrl } from "../url-parser";
import { sanitizeNickname, TrackRateLimitError, WatchlistService } from "../watchlist.service";
import { WatchlistTrackController } from "../watchlist-track.controller";

const state = vi.hoisted(() => ({
  users: {
    findOne: vi.fn(),
  },
  watchlists: {
    findOne: vi.fn(),
    countDocuments: vi.fn(),
    find: vi.fn(),
    aggregate: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
  products: {
    updateOne: vi.fn(),
  },
  timescale: {
    getLast30dMin: vi.fn(),
  },
  redisStore: new Map<string, string>(),
  redis: {
    get: vi.fn(async (key: string) => state.redisStore.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      state.redisStore.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "users") return state.users;
        if (name === "watchlists") return state.watchlists;
        if (name === "products") return state.products;
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

const userId = "665000000000000000000001";
const watchlistId = new ObjectId("665000000000000000000002");

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    productName: "Áo thun nam basic",
    imageUrl: "https://cf.shopee.vn/file/example",
    currentPrice: 89_000,
    originalPrice: 129_000,
    currentDiscountPct: 31,
    productLink: "https://shopee.vn/ao-thun-i.123.9876",
    commissionRate: 0.03,
    ...overrides,
  };
}

function makeService() {
  const resolver = {
    resolveProductOffer: vi.fn(async () => makeOffer()),
  };
  const posthog = { capture: vi.fn() };
  const service = new WatchlistService(resolver as any, posthog);
  return { service, resolver, posthog };
}

function mockOldest(createdAt = new Date("2026-01-01T00:00:00.000Z")) {
  const next = vi.fn(async () => ({ createdAt }));
  const limit = vi.fn(() => ({ next }));
  const sort = vi.fn(() => ({ limit }));
  state.watchlists.find.mockReturnValue({ sort });
  return { sort, limit, next };
}

function makeJwt(
  sub: string | undefined,
  secret: string,
  claims: Partial<{ iat: number; exp: number }> = {},
  signingSecret = secret,
) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub, iat: claims.iat ?? now, exp: claims.exp ?? now + 900 }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", signingSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

describe("FR-WATCH-001 — parseShopeeUrl", () => {
  it.each([
    ["https://shopee.vn/Áo-thun-nam-basic-i.123.4567890", { shopId: 123, itemId: 4567890 }],
    ["https://www.shopee.vn/foo-i.1.2?utm_source=fb&fbclid=z&safe=1", { shopId: 1, itemId: 2 }],
    ["https://shopee.vn/product/123/456", { shopId: 123, itemId: 456 }],
    ["https://shopee.vn/shopee-mall/123/456", { shopId: 123, itemId: 456 }],
    ["https://shopee.vn/deeplink?af_dp=x&itemid=456&shopid=123", { shopId: 123, itemId: 456 }],
  ])("parses %s", (url, expected) => {
    expect(parseShopeeUrl(url)).toEqual(expected);
  });

  it.each([
    "http://shopee.vn/x-i.1.2",
    "https://lazada.vn/foo",
    "https://shopee.com.vn/x-i.1.2",
    "ftp://shopee.vn/x-i.1.2",
    "javascript:alert(1)",
    "https://shopee.vn/x-i.0.0",
    "https://shopee.vn/" + "x".repeat(3000) + "-i.1.2",
  ])("rejects %s", (url) => {
    expect(parseShopeeUrl(url)).toBeNull();
  });
});

describe("FR-WATCH-001 — WatchlistService.track", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.redisStore.clear();
    state.users.findOne = vi.fn(async () => ({ _id: new ObjectId(userId), plan: "free" }));
    state.watchlists.findOne = vi.fn(async () => null);
    state.watchlists.countDocuments = vi.fn(async () => 0);
    state.watchlists.aggregate = vi.fn(() => ({ toArray: vi.fn(async () => []) }));
    state.watchlists.insertOne = vi.fn(async () => ({ insertedId: watchlistId }));
    state.watchlists.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.watchlists.findOneAndUpdate = vi.fn(async () => ({ _id: watchlistId }));
    state.products.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.timescale.getLast30dMin = vi.fn(async () => 79_000);
    state.redis.get = vi.fn(async (key: string) => state.redisStore.get(key) ?? null);
    state.redis.setex = vi.fn(async (key: string, _ttl: number, value: string) => {
      state.redisStore.set(key, value);
      return "OK";
    });
    state.redis.incr = vi.fn(async () => 1);
    state.redis.expire = vi.fn(async () => 1);
    mockOldest();
    process.env.POSTHOG_PII_SALT = "test-salt";
  });

  it("AC1+7+9: creates a default mid-priority watchlist and one-paint success response", async () => {
    const { service, resolver, posthog } = makeService();

    const result = await service.track({
      userId,
      url: "https://shopee.vn/ao-thun-i.123.9876?utm_source=fb",
      ip: "203.0.113.44",
      source: "web",
    });

    expect(resolver.resolveProductOffer).toHaveBeenCalledWith(123, 9876);
    expect(state.watchlists.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: new ObjectId(userId),
        productId: "123-9876",
        status: "active",
        alertConfig: expect.objectContaining({ triggers: [expect.objectContaining({ kind: "pct_drop", minDropPct: 10 })] }),
        commissionRateAtTrack: 0.03,
        baselineAtTrack: 89_000,
        source: "web",
      }),
    );
    expect(state.products.updateOne).toHaveBeenCalledWith({ shopId: 123, itemId: 9876 }, { $set: { trackPriority: "mid" } });
    expect(result).toEqual({
      watchlistId: String(watchlistId),
      productId: "123-9876",
      name: "Áo thun nam basic",
      imageUrl: "https://cf.shopee.vn/file/example",
      currentPrice: 89_000,
      originalPrice: 129_000,
      discountPct: 31,
      affiliateLink: "https://shopee.vn/ao-thun-i.123.9876",
      is30DayLow: false,
      last30dMin: 79_000,
    });
    expect(posthog.capture).toHaveBeenCalledWith(
      "product_tracked",
      expect.objectContaining({
        userId: expect.stringMatching(/^[a-f0-9]{16}$/),
        productId: "123-9876",
        source: "web",
        hasNickname: false,
        triggerCount: 1,
        freeTierCountAfter: 1,
      }),
    );
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toContain(userId);
  });

  it("AC4+5+6: handles unavailable products and free/pro tier caps", async () => {
    const { service, resolver } = makeService();
    resolver.resolveProductOffer.mockResolvedValueOnce(null as any);
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "product_not_available" }),
      status: 404,
    });

    state.watchlists.countDocuments.mockResolvedValueOnce(10);
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toMatchObject({
      response: expect.objectContaining({
        error: "free_tier_cap_reached",
        limit: 10,
        currentCount: 10,
        upgradeUrl: "/billing/upgrade",
        availableAt: "2026-01-01T00:00:00.000Z",
      }),
      status: 403,
    });

    state.watchlists.countDocuments.mockResolvedValueOnce(10);
    state.watchlists.find.mockReturnValueOnce({ sort: () => ({ limit: () => ({ next: async () => ({}) }) }) });
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toMatchObject({
      response: expect.objectContaining({ availableAt: null }),
    });

    state.users.findOne.mockResolvedValueOnce({ _id: new ObjectId(userId), plan: "pro" });
    state.watchlists.countDocuments.mockResolvedValueOnce(1000);
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).resolves.toMatchObject({
      productId: "1-2",
    });
  });

  it("AC8+12+13+16: normalizes alert config, source, and nickname", async () => {
    const { service, resolver, posthog } = makeService();

    await service.track({
      userId,
      url: "https://shopee.vn/x-i.1.2",
      alertConfig: { triggers: ["flash_sale"], flashSale: true },
      nickname: " Áo\u0000 săn sale ",
      source: "ext",
    });

    expect(state.watchlists.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        nickname: "Áo săn sale",
        alertConfig: expect.objectContaining({ triggers: [expect.objectContaining({ kind: "flash_sale" })] }),
      }),
    );
    expect(state.products.updateOne).toHaveBeenCalledWith({ shopId: 1, itemId: 2 }, { $set: { trackPriority: "hot" } });
    expect(posthog.capture).toHaveBeenCalledWith(
      "product_tracked",
      expect.objectContaining({ source: "ext", hasNickname: true }),
    );
    await service.track({
      userId,
      url: "https://shopee.vn/x-i.3.4",
      alertConfig: { triggers: ["pct_drop"], minDropPct: 15 },
    });
    expect(state.watchlists.insertOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        alertConfig: expect.objectContaining({ triggers: [expect.objectContaining({ kind: "pct_drop", minDropPct: 15 })] }),
      }),
    );
    await service.track({
      userId,
      url: "https://shopee.vn/x-i.9.10",
      alertConfig: { triggers: [{ kind: "pct_drop" }], minDropPct: 12 },
    });
    expect(state.watchlists.insertOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        alertConfig: expect.objectContaining({ triggers: [expect.objectContaining({ kind: "pct_drop", minDropPct: 12 })] }),
      }),
    );
    expect(sanitizeNickname("x".repeat(100))).toHaveLength(60);
    expect(sanitizeNickname()).toBeUndefined();
    expect(sanitizeNickname("\u0000   ")).toBeUndefined();
    expect(() => sanitizeNickname("<script>")).toThrow(UnprocessableEntityException);
    await service.track({
      userId,
      url: "https://shopee.vn/x-i.5.6",
      alertConfig: { triggers: ["absolute_drop"], targetPrice: 50_000 },
    });
    await service.track({
      userId,
      url: "https://shopee.vn/x-i.7.8",
      alertConfig: { lowest30d: true },
    });
    await service.track({
      userId,
      url: "https://shopee.vn/x-i.13.14",
      alertConfig: { triggers: [{ kind: "lowest_30d", paused: false }] },
    });
    await service.track({
      userId,
      url: "https://shopee.vn/x-i.15.16",
      alertConfig: {},
    });
    resolver.resolveProductOffer.mockResolvedValueOnce(
      makeOffer({ imageUrl: undefined, currentPrice: 70_000, currentDiscountPct: 46 }),
    );
    state.timescale.getLast30dMin.mockResolvedValueOnce(80_000);
    await expect(
      service.track({ userId, url: "https://shopee.vn/x-i.11.12", alertConfig: { triggers: ["flash_sale"], minDropPct: 40 } }),
    ).resolves.toMatchObject({ imageUrl: null, is30DayLow: true });
    await expect(
      service.track({ userId, url: "https://shopee.vn/x-i.1.2", alertConfig: { triggers: ["absolute_drop"] } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.track({ userId, url: "https://shopee.vn/x-i.1.2", alertConfig: null }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.track({ userId, url: "https://shopee.vn/x-i.1.2", alertConfig: { triggers: ["unknown"] } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.track({ userId, url: "https://shopee.vn/x-i.1.2", alertConfig: { triggers: ["pct_drop"], minDropPct: 0 } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("AC9+10: active duplicates 409, while deleted rows reactivate without changing createdAt", async () => {
    const { service } = makeService();
    const createdAt = new Date("2026-02-01T00:00:00.000Z");
    state.watchlists.findOne.mockResolvedValueOnce({ _id: watchlistId, status: "active", createdAt });

    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(state.watchlists.countDocuments).not.toHaveBeenCalled();

    state.watchlists.findOne.mockResolvedValueOnce({
      _id: watchlistId,
      status: "deleted",
      createdAt,
      alertConfig: { triggers: [{ kind: "lowest_30d", paused: false }] },
      source: "share",
    });
    const result = await service.track({ userId, url: "https://shopee.vn/x-i.1.2", source: "share" });

    expect(result.watchlistId).toBe(String(watchlistId));
    expect(state.watchlists.updateOne).toHaveBeenCalledWith(
      { _id: watchlistId },
      { $set: expect.objectContaining({ status: "active", deletedAt: null, source: "share" }) },
    );
    expect(state.watchlists.insertOne).not.toHaveBeenCalled();

    state.watchlists.findOne.mockResolvedValueOnce({
      _id: watchlistId,
      status: "paused",
      createdAt,
      alertConfig: { triggers: [{ kind: "pct_drop", minDropPct: 10, baseline: "current_at_track", paused: false }] },
    });
    await service.track({ userId, url: "https://shopee.vn/x-i.1.2" });
    expect(state.watchlists.updateOne).toHaveBeenLastCalledWith(
      { _id: watchlistId },
      { $set: expect.objectContaining({ status: "active", source: "web" }) },
    );

    state.watchlists.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: watchlistId, status: "active", createdAt });
    state.watchlists.insertOne.mockRejectedValueOnce({ code: 11000 });
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "already_tracking", watchlistId: String(watchlistId) }),
    });

    const mongoError = new Error("mongo down");
    state.watchlists.findOne.mockResolvedValueOnce(null);
    state.watchlists.insertOne.mockRejectedValueOnce(mongoError);
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toBe(mongoError);
  });

  it("AC11+14: enforces dual rate limits and returns cached idempotency responses", async () => {
    const { service, resolver } = makeService();

    state.redis.incr.mockResolvedValueOnce(21);
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2" })).rejects.toMatchObject({
      scope: "user",
    });

    state.redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(6);
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.1.2", ip: "203.0.113.9" })).rejects.toMatchObject({
      scope: "ip",
    });

    const first = await service.track({
      userId,
      url: "https://shopee.vn/x-i.1.2",
      idempotencyKey: "retry-1",
    });
    const second = await service.track({
      userId,
      url: "https://shopee.vn/x-i.1.2",
      idempotencyKey: "retry-1",
    });

    expect(first).toEqual(second);
    expect(state.redis.setex).toHaveBeenCalledWith(expect.stringMatching(/^idem:track:/), 60, JSON.stringify(first));
    expect(resolver.resolveProductOffer).toHaveBeenCalledTimes(1);

    state.timescale.getLast30dMin.mockRejectedValueOnce(new Error("timescale down"));
    await expect(service.track({ userId, url: "https://shopee.vn/x-i.7.8" })).resolves.toMatchObject({
      last30dMin: null,
      is30DayLow: false,
    });
  });

  it("covers list enrichment with product lookup rows and Timescale degradation", async () => {
    const { service } = makeService();
    const rowId = new ObjectId("665000000000000000000003");
    state.watchlists.aggregate.mockReturnValueOnce({
      toArray: vi.fn(async () => [
        {
          _id: rowId,
          productId: "1-2",
          status: "active",
          alertConfig: { triggers: [] },
          baselineAtTrack: 90_000,
          lastTriggeredAt: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          p: {
            name: "Áo",
            imageUrl: "https://cf.shopee.vn/file/a",
            currentPrice: 80_000,
            originalPrice: 100_000,
            currentDiscountPct: 20,
            lastObservedAt: new Date("2026-01-03T00:00:00.000Z"),
          },
        },
        {
          _id: new ObjectId("665000000000000000000004"),
          productId: "3-4",
          status: "paused",
          alertConfig: { triggers: [] },
          createdAt: new Date("2026-01-04T00:00:00.000Z"),
          updatedAt: new Date("2026-01-05T00:00:00.000Z"),
        },
      ]),
    });
    state.timescale.getLast30dMin.mockResolvedValueOnce(70_000).mockRejectedValueOnce(new Error("timescale down"));

    const result = await service.list({ userId, status: "all", page: 0, size: 100 });

    expect(result).toMatchObject({ page: 1, size: 50 });
    expect(result.items[0]).toMatchObject({
      watchlistId: String(rowId),
      productId: "1-2",
      name: "Áo",
      currentPrice: 80_000,
      last30dMin: 70_000,
    });
    expect(result.items[1]).toMatchObject({ productId: "3-4", name: null, last30dMin: null });
  });

  it("covers patch validation, pause/resume events, cap guard, and soft delete", async () => {
    const { service, posthog } = makeService();
    const wlId = "665000000000000000000003";
    state.watchlists.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: new ObjectId(wlId), userId: new ObjectId(userId), status: "paused" })
      .mockResolvedValueOnce({ _id: new ObjectId(wlId), userId: new ObjectId(userId), status: "paused" })
      .mockResolvedValueOnce({ _id: new ObjectId(wlId), userId: new ObjectId(userId), status: "active" })
      .mockResolvedValueOnce({ _id: new ObjectId(wlId), userId: new ObjectId(userId), status: "paused" });

    await expect(service.patch({ userId, watchlistId: wlId, status: "active" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    state.watchlists.countDocuments.mockResolvedValueOnce(10);
    await expect(service.patch({ userId, watchlistId: wlId, status: "active" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    state.watchlists.countDocuments.mockResolvedValueOnce(0);
    await service.patch({
      userId,
      watchlistId: wlId,
      status: "active",
      alertConfig: { triggers: [{ kind: "lowest_30d", paused: false }] },
    });
    expect(posthog.capture).toHaveBeenCalledWith(
      "watchlist_alert_config_changed",
      expect.objectContaining({
        watchlistIdHash: expect.stringMatching(/^[a-f0-9]{12}$/),
        triggerKinds: ["lowest_30d"],
        source: "web",
      }),
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "watchlist_resumed",
      expect.objectContaining({ watchlistIdHash: expect.stringMatching(/^[a-f0-9]{12}$/), source: "web" }),
    );

    await service.patch({ userId, watchlistId: wlId, status: "paused" });
    expect(posthog.capture).toHaveBeenCalledWith(
      "watchlist_paused",
      expect.objectContaining({ watchlistIdHash: expect.stringMatching(/^[a-f0-9]{12}$/), source: "web" }),
    );

    state.watchlists.findOne.mockResolvedValueOnce({ _id: new ObjectId(wlId), userId: new ObjectId(userId), status: "active" });
    await expect(service.patch({ userId, watchlistId: wlId, alertConfig: { triggers: [{ kind: "pct_drop" }] } })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "invalid_alert_config" }),
    });

    state.watchlists.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(service.softDelete({ userId, watchlistId: wlId })).rejects.toBeInstanceOf(ForbiddenException);
    state.watchlists.findOneAndUpdate.mockResolvedValueOnce({ _id: new ObjectId(wlId) });
    await expect(service.softDelete({ userId, watchlistId: wlId })).resolves.toEqual({ ok: true });
    expect(posthog.capture).toHaveBeenCalledWith(
      "watchlist_deleted",
      expect.objectContaining({ watchlistIdHash: expect.stringMatching(/^[a-f0-9]{12}$/), source: "web" }),
    );
  });

  it("rejects malformed ids before database mutation", async () => {
    const { service } = makeService();

    await expect(service.list({ userId: "bad-id" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "invalid_id" }),
    });
  });
});

describe("FR-WATCH-001 — WatchlistTrackController", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_SECRET;
  });

  it("AC15: unauthenticated requests return soft-funnel signin URL and Location header", async () => {
    const controller = new WatchlistTrackController({ track: vi.fn() } as any);
    const res = { setHeader: vi.fn() };

    await expect(
      controller.track(
        { url: "https://shopee.vn/x-i.1.2" },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { ip: "127.0.0.1" } as any,
        res as any,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: "UNAUTHENTICATED", signinUrl: expect.stringContaining("seedUrl=") }),
      status: 401,
    });
    expect(res.setHeader).toHaveBeenCalledWith("Location", expect.stringContaining("/auth/signin?ref=track"));
  });

  it("passes JWT user, source, idempotency key, and IP into the service", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    process.env.NODE_ENV = "production";
    process.env.AUTH_SECRET = secret;
    const watch = { track: vi.fn(async () => ({ ok: true })) };
    const controller = new WatchlistTrackController(watch as any);

    await controller.track(
      { url: "https://shopee.vn/x-i.1.2", nickname: "Áo" },
      `Bearer ${makeJwt(userId, secret)}`,
      "spoofed",
      "malicious",
      "idem-1",
      "203.0.113.9, 10.0.0.1",
      undefined,
      { ip: "127.0.0.1" } as any,
      { setHeader: vi.fn() } as any,
    );

    expect(watch.track).toHaveBeenCalledWith({
      userId,
      url: "https://shopee.vn/x-i.1.2",
      alertConfig: undefined,
      nickname: "Áo",
      source: "web",
      idempotencyKey: "idem-1",
      ip: "203.0.113.9",
    });

    await controller.track(
      { url: "https://shopee.vn/x-i.1.2" },
      `Bearer ${makeJwt(userId, secret)}`,
      undefined,
      "import",
      undefined,
      undefined,
      "198.51.100.4",
      { ip: "127.0.0.1" } as any,
      { setHeader: vi.fn() } as any,
    );
    expect(watch.track).toHaveBeenLastCalledWith(expect.objectContaining({ source: "import", ip: "198.51.100.4" }));
  });

  it("maps track rate limits to HTTP 429", async () => {
    const watch = {
      track: vi.fn(async () => {
        throw new TrackRateLimitError("ip");
      }),
    };
    const controller = new WatchlistTrackController(watch as any);
    const res = { setHeader: vi.fn() };

    await expect(
      controller.track(
        { url: "https://shopee.vn/x-i.1.2" },
        undefined,
        userId,
        "ext",
        undefined,
        undefined,
        "198.51.100.7",
        { ip: "127.0.0.1" } as any,
        res as any,
      ),
    ).rejects.toMatchObject({ response: { error: "RATE_LIMIT_TRACK", retryAfter: 60, scope: "ip" }, status: 429 });
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });

  it("maps invalid request bodies and passes through non-rate service errors", async () => {
    const error = new ForbiddenException({ error: "blocked" });
    const watch = {
      track: vi
        .fn()
        .mockRejectedValueOnce(error),
    };
    const controller = new WatchlistTrackController(watch as any);

    await expect(
      controller.track(
        { url: "" },
        undefined,
        userId,
        undefined,
        undefined,
        undefined,
        undefined,
        { ip: "127.0.0.1" } as any,
        { setHeader: vi.fn() } as any,
      ),
    ).rejects.toMatchObject({ response: { error: "validation_failed" }, status: 400 });

    await expect(
      controller.track(
        { url: "https://shopee.vn/x-i.1.2" },
        undefined,
        userId,
        "share",
        undefined,
        undefined,
        undefined,
        { ip: "192.0.2.9" } as any,
        { setHeader: vi.fn() } as any,
      ),
    ).rejects.toBe(error);
    expect(watch.track).toHaveBeenCalledWith(expect.objectContaining({ source: "share", ip: "192.0.2.9" }));
  });

  it("treats malformed bearer tokens as anonymous and falls through to signin", async () => {
    process.env.NODE_ENV = "production";
    const secret = "0123456789abcdef0123456789abcdef";
    process.env.AUTH_SECRET = secret;
    const controller = new WatchlistTrackController({ track: vi.fn() } as any);
    const now = Math.floor(Date.now() / 1000);
    const tokens = [
      "malformed.token",
      makeJwt(userId, secret, {}, "fedcba9876543210fedcba9876543210"),
      makeJwt(undefined, secret),
      makeJwt(userId, secret, { exp: now - 120 }),
      makeJwt(userId, secret, { iat: now + 120 }),
    ];

    for (const token of tokens) {
      await expect(
        controller.track(
          { url: "https://shopee.vn/x-i.1.2" },
          `Bearer ${token}`,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {} as any,
          { setHeader: vi.fn() } as any,
        ),
      ).rejects.toMatchObject({ response: { error: "UNAUTHENTICATED" }, status: 401 });
    }
  });
});
