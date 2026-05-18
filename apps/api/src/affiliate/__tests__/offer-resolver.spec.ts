import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfferResolverService } from "../offer-resolver.service";
import type { ProductOfferNode } from "../shopee/types";

const state = vi.hoisted(() => ({
  productOps: {
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  },
  timescale: {
    insertPriceHistory: vi.fn(),
  },
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    publish: vi.fn(),
  },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn(() => state.productOps),
    })),
  },
}));

vi.mock("../../db/timescale.client", () => ({
  timescale: state.timescale,
}));

vi.mock("../../queue/redis.client", () => ({
  redis: state.redis,
}));

function makeOffer(overrides: Partial<ProductOfferNode> = {}): ProductOfferNode {
  return {
    itemId: "9876543210",
    shopId: "123456",
    productName: "Áo thun nam basic",
    priceMin: 89_000,
    priceMax: 129_000,
    productLink: "https://shopee.vn/ao-thun-i.123456.9876543210",
    commissionRate: 0.03,
    sales: 1247,
    imageUrl: "https://cf.shopee.vn/file/example",
    stock: 25,
    ...overrides,
  };
}

function makeHarness() {
  const shopee = {
    productOfferV2: vi.fn(),
    shopOfferV2: vi.fn(),
  };
  const posthog = { capture: vi.fn() };
  const sentry = { captureException: vi.fn() };
  const resolver = new OfferResolverService(shopee as any, posthog, sentry);
  return { resolver, shopee, posthog, sentry };
}

describe("FR-AFF-003 — OfferResolverService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.productOps.findOneAndUpdate = vi.fn(async () => ({}));
    state.productOps.updateOne = vi.fn(async () => ({}));
    state.timescale.insertPriceHistory = vi.fn(async () => undefined);
    state.redis.get = vi.fn(async () => null);
    state.redis.setex = vi.fn(async () => "OK");
    state.redis.publish = vi.fn(async () => 1);
  });

  it("normalizes a live product and dual-writes Mongo + Timescale with matching observedAt", async () => {
    const { resolver, shopee, posthog } = makeHarness();
    shopee.productOfferV2.mockResolvedValue(makeOffer({ priceMin: 100_000, priceMax: 129_000 }));

    const offer = await resolver.resolveProductOffer(123456, 9876543210);

    expect(offer).toMatchObject({
      currentPrice: 100_000,
      originalPrice: 129_000,
      currentDiscountPct: 22,
      flashSale: false,
    });
    expect(state.productOps.findOneAndUpdate).toHaveBeenCalledWith(
      { shopId: 123456, itemId: 9876543210 },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          slug: "ao-thun-nam-basic",
          trackPriority: "mid",
          _scheduleHash: expect.any(Number),
        }),
        $set: expect.objectContaining({
          currentPrice: 100_000,
          originalPrice: 129_000,
          currentDiscountPct: 22,
          affiliateLink: "https://shopee.vn/ao-thun-i.123456.9876543210",
          commissionRate: 0.03,
          currency: "VND",
          lastObservedAt: expect.any(Date),
        }),
        $unset: { deletedAt: "" },
      }),
      { upsert: true },
    );
    const mongoObservedAt = state.productOps.findOneAndUpdate.mock.calls[0]![1].$set.lastObservedAt;
    expect(state.timescale.insertPriceHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "123456-9876543210",
        shopId: 123456,
        region: "VN",
        observedAt: mongoObservedAt,
        price: 100_000,
        originalPrice: 129_000,
        discountPct: 22,
        stock: 25,
        flashSale: false,
        source: "affiliate_api",
      }),
    );
    expect(state.redis.publish).toHaveBeenCalledWith("price_history_invalidate", "123456-9876543210");
    expect(posthog.capture).toHaveBeenCalledWith(
      "product_offer_resolved",
      expect.objectContaining({
        shopId: 123456,
        itemId: 9876543210,
        outcome: "live",
        source: "v2",
        latency_ms: expect.any(Number),
      }),
    );
  });

  it("marks dead products without writing Timescale history", async () => {
    const { resolver, shopee, posthog } = makeHarness();
    shopee.productOfferV2.mockResolvedValue(null);

    await expect(resolver.resolveProductOffer(1, 999)).resolves.toBeNull();

    expect(state.productOps.updateOne).toHaveBeenCalledWith(
      { shopId: 1, itemId: 999 },
      { $set: { deletedAt: expect.any(Date) } },
    );
    expect(state.timescale.insertPriceHistory).not.toHaveBeenCalled();
    expect(posthog.capture).toHaveBeenCalledWith(
      "product_offer_resolved",
      expect.objectContaining({ shopId: 1, itemId: 999, outcome: "dead", latency_ms: expect.any(Number) }),
    );
  });

  it("honors threshold and explicit Shopee flashSale flags", async () => {
    const { resolver, shopee } = makeHarness();
    shopee.productOfferV2
      .mockResolvedValueOnce(makeOffer({ priceMin: 50_000, priceMax: 100_000 }))
      .mockResolvedValueOnce(makeOffer({ priceMin: 75_000, priceMax: 100_000, flashSale: true }));

    await expect(resolver.resolveProductOffer(1, 2)).resolves.toMatchObject({ flashSale: true });
    await expect(resolver.resolveProductOffer(1, 3)).resolves.toMatchObject({ flashSale: true });
    expect(state.timescale.insertPriceHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({ flashSale: true }));
    expect(state.timescale.insertPriceHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ flashSale: true }));
  });

  it("normalizes optional Shopee fields when they are absent", async () => {
    const { resolver, shopee } = makeHarness();
    shopee.productOfferV2.mockResolvedValue(
      makeOffer({ imageUrl: undefined, stock: undefined, sales: undefined, priceMin: 89_000, priceMax: 89_000 }),
    );

    await expect(resolver.resolveProductOffer(10, 20)).resolves.toMatchObject({
      currentDiscountPct: 0,
      flashSale: false,
    });

    expect(state.timescale.insertPriceHistory).toHaveBeenCalledWith(
      expect.objectContaining({ stock: null, discountPct: 0 }),
    );
    expect(state.productOps.findOneAndUpdate).toHaveBeenCalledWith(
      { shopId: 10, itemId: 20 },
      expect.objectContaining({
        $set: expect.objectContaining({
          imageUrl: null,
          sales: 0,
        }),
      }),
      { upsert: true },
    );
  });

  it("returns null for missing shop-level offers", async () => {
    const { resolver, shopee } = makeHarness();
    shopee.shopOfferV2.mockResolvedValue(null);

    await expect(resolver.resolveShopOffer(404)).resolves.toBeNull();
    expect(state.redis.setex).not.toHaveBeenCalled();
  });

  it("caches shopOfferV2 in Redis for one hour", async () => {
    const { resolver, shopee } = makeHarness();
    state.redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ shopId: "123", commissionRate: 0.05 }));
    shopee.shopOfferV2.mockResolvedValue({ shopId: "123", commissionRate: 0.04 });

    await expect(resolver.resolveShopOffer(123)).resolves.toEqual({ shopId: "123", commissionRate: 0.04 });
    await expect(resolver.resolveShopOffer(123)).resolves.toEqual({ shopId: "123", commissionRate: 0.05 });

    expect(shopee.shopOfferV2).toHaveBeenCalledTimes(1);
    expect(state.redis.setex).toHaveBeenCalledWith(
      "shopee:shop_offer:123",
      3600,
      JSON.stringify({ shopId: "123", commissionRate: 0.04 }),
    );
  });

  it("tags Sentry failures by resolver phase and degrades on Timescale failure", async () => {
    const { resolver, shopee, sentry } = makeHarness();
    const shopeeError = new Error("shopee down");
    shopee.productOfferV2.mockRejectedValueOnce(shopeeError);
    await expect(resolver.resolveProductOffer(1, 1)).rejects.toThrow("shopee down");
    expect(sentry.captureException).toHaveBeenCalledWith(
      shopeeError,
      expect.objectContaining({
        tags: expect.objectContaining({ fr: "FR-AFF-003", phase: "resolve", productId: "1-1" }),
      }),
    );

    const mongoError = new Error("mongo down");
    shopee.productOfferV2.mockResolvedValueOnce(makeOffer());
    state.productOps.findOneAndUpdate.mockRejectedValueOnce(mongoError);
    await expect(resolver.resolveProductOffer(1, 2)).rejects.toThrow("mongo down");
    expect(sentry.captureException).toHaveBeenCalledWith(
      mongoError,
      expect.objectContaining({ tags: expect.objectContaining({ phase: "mongo_write", productId: "1-2" }) }),
    );

    const deadMongoError = new Error("dead mongo down");
    shopee.productOfferV2.mockResolvedValueOnce(null);
    state.productOps.updateOne.mockRejectedValueOnce(deadMongoError);
    await expect(resolver.resolveProductOffer(1, 404)).rejects.toThrow("dead mongo down");
    expect(sentry.captureException).toHaveBeenCalledWith(
      deadMongoError,
      expect.objectContaining({ tags: expect.objectContaining({ phase: "mongo_write", productId: "1-404" }) }),
    );

    const timescaleError = new Error("timescale down");
    shopee.productOfferV2.mockResolvedValueOnce(makeOffer());
    state.productOps.findOneAndUpdate.mockResolvedValueOnce({});
    state.timescale.insertPriceHistory.mockRejectedValueOnce(timescaleError);
    await expect(resolver.resolveProductOffer(1, 3)).resolves.toMatchObject({ currentPrice: 89_000 });
    expect(state.redis.publish).not.toHaveBeenCalledWith("price_history_invalidate", "1-3");
    expect(sentry.captureException).toHaveBeenCalledWith(
      timescaleError,
      expect.objectContaining({ tags: expect.objectContaining({ phase: "timescale_write", productId: "1-3" }) }),
    );
  });

  it("keeps schedule hash deterministic for repeated resolutions", async () => {
    const { resolver, shopee } = makeHarness();
    shopee.productOfferV2.mockResolvedValue(makeOffer());

    await resolver.resolveProductOffer(7, 8);
    await resolver.resolveProductOffer(7, 8);

    const firstHash = state.productOps.findOneAndUpdate.mock.calls[0]![1].$setOnInsert._scheduleHash;
    const secondHash = state.productOps.findOneAndUpdate.mock.calls[1]![1].$setOnInsert._scheduleHash;
    expect(firstHash).toBe(secondHash);
  });
});
