import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SmartWishlistController } from "../smart-wishlist.controller";
import { SmartWishlistService } from "../smart-wishlist.service";
import { WatchlistCrudController } from "../watchlist-crud.controller";

const state = vi.hoisted(() => ({
  watchlists: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
  products: {
    findOne: vi.fn(),
    find: vi.fn(),
  },
  timescale: {
    query: vi.fn(),
    getStats: vi.fn(),
  },
  redis: {
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "watchlists") return state.watchlists;
        if (name === "products") return state.products;
        if (name === "smart_wishlist_history") return { insertOne: vi.fn(async () => ({ acknowledged: true })) };
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

describe("FR-WATCH-005 — SmartWishlistService", () => {
  const userId = new ObjectId("665000000000000000000001");
  const watchlistId = new ObjectId("665000000000000000000002");

  beforeEach(() => {
    state.watchlists.findOne = vi.fn(async () => ({
      _id: watchlistId,
      userId,
      productId: "123-9876",
      status: "active",
    }));
    state.watchlists.updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    state.products.findOne = vi.fn(async () => ({
      shopId: 123,
      itemId: 9876,
      name: "Ao thun nam basic",
      imageUrl: "https://cf.shopee.vn/file/example",
      currentPrice: 80_000,
      originalPrice: 100_000,
      currentDiscountPct: 20,
      lastObservedAt: new Date("2026-06-12T00:00:00.000Z"),
      lastDealScore: 0.86,
      lastDealScoreConfidence: 0.88,
      lastDealScoreLabel: "real_deal",
      lastDealScoreAt: new Date("2026-06-12T00:00:00.000Z"),
      lastRecommendedPricePoint: 79_000,
      category: "shirts",
      region: "VN",
      market: "VN",
    }));

    const candidateDocs = [
      {
        shopId: 123,
        itemId: 1001,
        name: "Ao thun nam basic slim",
        imageUrl: "https://cf.shopee.vn/file/p2",
        currentPrice: 82_000,
        originalPrice: 104_000,
        currentDiscountPct: 21,
        lastObservedAt: new Date("2026-06-12T00:00:00.000Z"),
        lastDealScore: 0.84,
        lastDealScoreConfidence: 0.9,
        lastDealScoreLabel: "real_deal",
        lastDealScoreAt: new Date("2026-06-12T00:00:00.000Z"),
        category: "shirts",
        region: "VN",
        market: "VN",
      },
      {
        shopId: 123,
        itemId: 1002,
        name: "Ao thun nam basic regular",
        imageUrl: "https://cf.shopee.vn/file/p3",
        currentPrice: 84_000,
        originalPrice: 106_000,
        currentDiscountPct: 20,
        lastObservedAt: new Date("2026-06-12T00:00:00.000Z"),
        lastDealScore: 0.82,
        lastDealScoreConfidence: 0.85,
        lastDealScoreLabel: "real_deal",
        lastDealScoreAt: new Date("2026-06-12T00:00:00.000Z"),
        category: "shirts",
        region: "VN",
        market: "VN",
      },
      {
        shopId: 123,
        itemId: 1003,
        name: "Ao thun nam basic heavy",
        imageUrl: "https://cf.shopee.vn/file/p4",
        currentPrice: 86_000,
        originalPrice: 110_000,
        currentDiscountPct: 22,
        lastObservedAt: new Date("2026-06-12T00:00:00.000Z"),
        lastDealScore: 0.81,
        lastDealScoreConfidence: 0.87,
        lastDealScoreLabel: "real_deal",
        lastDealScoreAt: new Date("2026-06-12T00:00:00.000Z"),
        category: "shirts",
        region: "VN",
        market: "VN",
      },
      {
        shopId: 123,
        itemId: 1004,
        name: "Ao thun Thai",
        imageUrl: "https://cf.shopee.vn/file/th1",
        currentPrice: 50_000,
        originalPrice: 60_000,
        currentDiscountPct: 18,
        lastObservedAt: new Date("2026-06-12T00:00:00.000Z"),
        lastDealScore: 0.8,
        lastDealScoreConfidence: 0.86,
        lastDealScoreLabel: "real_deal",
        lastDealScoreAt: new Date("2026-06-12T00:00:00.000Z"),
        category: "shirts",
        region: "TH",
        market: "TH",
      },
    ];

    state.products.find = vi.fn(() => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => candidateDocs,
        }),
      }),
      limit: () => ({
        toArray: async () => candidateDocs,
      }),
    }));

    state.timescale.getStats = vi.fn(async () => ({
      last30dMin: 79_000,
      last30dMax: 100_000,
      last7dAvg: 84_000,
      observationCount: 12,
    }));

    state.timescale.query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM price_history\n")) {
        return {
          rows: [
            { observed_at: new Date("2026-06-01T00:00:00.000Z"), price: 100_000, flash_sale: false },
            { observed_at: new Date("2026-06-02T00:00:00.000Z"), price: 96_000, flash_sale: false },
            { observed_at: new Date("2026-06-03T00:00:00.000Z"), price: 92_000, flash_sale: false },
            { observed_at: new Date("2026-06-04T00:00:00.000Z"), price: 89_000, flash_sale: false },
            { observed_at: new Date("2026-06-05T00:00:00.000Z"), price: 87_000, flash_sale: false },
            { observed_at: new Date("2026-06-06T00:00:00.000Z"), price: 85_000, flash_sale: false },
            { observed_at: new Date("2026-06-07T00:00:00.000Z"), price: 84_000, flash_sale: false },
            { observed_at: new Date("2026-06-08T00:00:00.000Z"), price: 83_000, flash_sale: false },
            { observed_at: new Date("2026-06-09T00:00:00.000Z"), price: 82_000, flash_sale: false },
            { observed_at: new Date("2026-06-10T00:00:00.000Z"), price: 81_000, flash_sale: false },
            { observed_at: new Date("2026-06-11T00:00:00.000Z"), price: 80_000, flash_sale: false },
            { observed_at: new Date("2026-06-12T00:00:00.000Z"), price: 80_000, flash_sale: false },
          ],
        };
      }

      return {
        rows: [
          { product_id: "123-1001", last_30d_min: 80_000, last_30d_max: 104_000, last_7d_avg: 82_000, observation_count: 10 },
          { product_id: "123-1002", last_30d_min: 81_000, last_30d_max: 106_000, last_7d_avg: 84_000, observation_count: 10 },
          { product_id: "123-1003", last_30d_min: 83_000, last_30d_max: 110_000, last_7d_avg: 86_000, observation_count: 9 },
          { product_id: "123-1004", last_30d_min: 49_000, last_30d_max: 60_000, last_7d_avg: 50_000, observation_count: 10 },
        ],
      };
    });
  });

  it("computes and persists a smart wishlist snapshot", async () => {
    const service = new SmartWishlistService();

    const result = await service.getSmartWishlist({
      userId: userId.toHexString(),
      watchlistId: watchlistId.toHexString(),
      range: "30d",
      limit: 3,
    });

    expect(result.modelSource).toBe("heuristic");
    expect(result.similarProducts).toHaveLength(3);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(state.watchlists.updateOne).toHaveBeenCalledWith(
      { _id: watchlistId },
      expect.objectContaining({
        $set: expect.objectContaining({
          smartWishlistSnapshot: expect.objectContaining({
            recommendedTargetPrice: expect.any(Number),
            confidence: expect.any(Number),
          }),
        }),
      }),
    );
  });
});

describe("FR-WATCH-005 — smart wishlist controllers", () => {
  beforeEach(() => {
    state.redis.incr = vi.fn(async () => 1);
    state.redis.expire = vi.fn(async () => 1);
  });

  it("passes summary mode into the CRUD list contract", async () => {
    const watch = { list: vi.fn(async () => ({ items: [] })) };
    const smartWishlist = { enrichWatchlistRows: vi.fn(async (input) => input.rows) };
    const controller = new WatchlistCrudController(watch as any, smartWishlist as any);

    const response = await controller.list({ includeSmartWishlist: "summary", status: "all" }, "user-1");

    expect(watch.list).toHaveBeenCalledWith({
      userId: "user-1",
      status: "all",
      page: undefined,
      size: undefined,
    });
    expect(smartWishlist.enrichWatchlistRows).toHaveBeenCalled();
    expect(response.items).toEqual([]);
  });

  it("supports the detail route and clamps limit to 5", async () => {
    const smartWishlist = { getSmartWishlist: vi.fn(async (input) => ({ ...input, recommendedTargetPrice: 79_000 })) };
    const controller = new SmartWishlistController(smartWishlist as any);

    const response = await controller.get("665000000000000000000002", { range: "90d", limit: "5" }, "user-1");

    expect(smartWishlist.getSmartWishlist).toHaveBeenCalledWith({
      userId: "user-1",
      watchlistId: "665000000000000000000002",
      range: "90d",
      limit: 5,
    });
    expect(response).toEqual(expect.objectContaining({ recommendedTargetPrice: 79_000 }));
  });
});
