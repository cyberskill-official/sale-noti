import { describe, expect, it } from "vitest";
import { findSimilarWishlistProducts, recommendWishlistTargetPrice } from "../index";

const baseWindow = {
  watchlistId: "wl-1",
  productId: "p-1",
  market: "VN" as const,
  range: "30d" as const,
  currentPrice: 80_000,
  baselinePrice: 100_000,
  last30dMin: 79_000,
  currentDiscountPct: 20,
  discountPersistenceHours: 36,
  priceVolatility: 0.08,
  flashSaleDensity: 0.1,
  reboundWithin24h: false,
  daysSinceLastStrongDrop: 2,
  categoryGapPct: 12,
  dealScore: 0.86,
  dealConfidence: 0.88,
  observationCount: 12,
};

const similarCandidates = [
  {
    productId: "p-2",
    name: "Áo thun nam basic slim",
    imageUrl: "https://cf.shopee.vn/file/p2",
    currentPrice: 82_000,
    market: "VN" as const,
    range: "30d" as const,
    baselinePrice: 104_000,
    last30dMin: 80_000,
    currentDiscountPct: 21,
    discountPersistenceHours: 24,
    priceVolatility: 0.1,
    flashSaleDensity: 0.08,
    reboundWithin24h: false,
    daysSinceLastStrongDrop: 3,
    categoryGapPct: 10,
    dealScore: 0.84,
    dealConfidence: 0.9,
    observationCount: 11,
  },
  {
    productId: "p-3",
    name: "Áo thun nam basic regular",
    imageUrl: "https://cf.shopee.vn/file/p3",
    currentPrice: 84_000,
    market: "VN" as const,
    range: "30d" as const,
    baselinePrice: 106_000,
    last30dMin: 81_000,
    currentDiscountPct: 20,
    discountPersistenceHours: 18,
    priceVolatility: 0.09,
    flashSaleDensity: 0.07,
    reboundWithin24h: false,
    daysSinceLastStrongDrop: 5,
    categoryGapPct: 11,
    dealScore: 0.82,
    dealConfidence: 0.85,
    observationCount: 10,
  },
  {
    productId: "p-4",
    name: "Áo thun nam basic heavy",
    imageUrl: "https://cf.shopee.vn/file/p4",
    currentPrice: 86_000,
    market: "VN" as const,
    range: "30d" as const,
    baselinePrice: 110_000,
    last30dMin: 83_000,
    currentDiscountPct: 22,
    discountPersistenceHours: 20,
    priceVolatility: 0.11,
    flashSaleDensity: 0.09,
    reboundWithin24h: false,
    daysSinceLastStrongDrop: 4,
    categoryGapPct: 9,
    dealScore: 0.81,
    dealConfidence: 0.87,
    observationCount: 9,
  },
  {
    productId: "th-1",
    name: "Áo thun Thai",
    imageUrl: "https://cf.shopee.vn/file/th1",
    currentPrice: 50_000,
    market: "TH" as const,
    range: "30d" as const,
    baselinePrice: 60_000,
    last30dMin: 49_000,
    currentDiscountPct: 18,
    discountPersistenceHours: 16,
    priceVolatility: 0.12,
    flashSaleDensity: 0.06,
    reboundWithin24h: false,
    daysSinceLastStrongDrop: 3,
    categoryGapPct: 8,
    dealScore: 0.8,
    dealConfidence: 0.86,
    observationCount: 10,
  },
];

describe("FR-WATCH-005 — smart wishlist similarity", () => {
  it("returns a target price from stable history", () => {
    const result = recommendWishlistTargetPrice(baseWindow, similarCandidates, 3);

    expect(result.modelSource).toBe("heuristic");
    expect(result.recommendedTargetPrice).toBeGreaterThan(0);
    expect(result.similarProducts).toHaveLength(3);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.reasons).toContain("sustained_discount");
  });

  it("falls back for sparse history", () => {
    const result = recommendWishlistTargetPrice({ ...baseWindow, observationCount: 4 }, []);

    expect(result.modelSource).toBe("heuristic");
    expect(result.similarProducts).toEqual([]);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.reasons).toContain("thin_history");
  });

  it("keeps markets separated", () => {
    const results = findSimilarWishlistProducts(baseWindow, similarCandidates, 5);

    expect(results.some((candidate) => candidate.productId === "th-1")).toBe(false);
    expect(results.every((candidate) => candidate.reasons.includes("same_market"))).toBe(true);
  });
});
