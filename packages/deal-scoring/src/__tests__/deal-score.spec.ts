import { describe, expect, it } from "vitest";
import { extractDealScoreWindow, scoreDeal, scoreUnsupportedDeal } from "../index";

function makePersistentWindow() {
  return extractDealScoreWindow({
    productId: "123-456",
    market: "VN",
    range: "30d",
    observations: [
      { observedAt: "2026-05-01T00:00:00Z", price: 100_000, flashSale: false },
      { observedAt: "2026-05-02T00:00:00Z", price: 95_000, flashSale: false },
      { observedAt: "2026-05-03T00:00:00Z", price: 82_000, flashSale: false },
      { observedAt: "2026-05-04T00:00:00Z", price: 80_000, flashSale: false },
    ],
    baselinePrice: 100_000,
    last30dMin: 80_000,
    currentDiscountPct: 20,
    categoryMedianPrice: 110_000,
    reboundWithin24h: false,
    daysSinceLastStrongDrop: 3,
  });
}

describe("FR-PRICE-003 — deal scoring", () => {
  it("scores a persistent discount as a real deal", () => {
    const window = makePersistentWindow();
    expect(window.discountPersistenceHours).toBeGreaterThanOrEqual(24);
    expect(window.categoryGapPct).toBeCloseTo(27.27, 2);

    const result = scoreDeal(window);

    expect(result.label).toBe("real_deal");
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.modelSource).toBe("heuristic");
    expect(result.modelVersion).toBe("heuristic-v1");
    expect(result.recommendedPricePoint).toBe(104500);
    expect(result.reasons).toContain("persistent_discount");
  });

  it("scores a rebound as a false alarm", () => {
    const window = extractDealScoreWindow({
      productId: "123-456",
      market: "TH",
      range: "7d",
      observations: [
        { observedAt: "2026-05-01T00:00:00Z", price: 100_000, flashSale: false },
        { observedAt: "2026-05-01T12:00:00Z", price: 99_000, flashSale: false },
        { observedAt: "2026-05-01T18:00:00Z", price: 70_000, flashSale: true },
      ],
      baselinePrice: 100_000,
      last30dMin: 70_000,
      currentDiscountPct: 30,
      categoryMedianPrice: null,
      reboundWithin24h: true,
      daysSinceLastStrongDrop: 1,
    });

    const result = scoreDeal(window);

    expect(result.label).toBe("false_alarm");
    expect(result.score).toBeLessThanOrEqual(0.35);
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.reasons).toEqual(expect.arrayContaining(["flash_sale_noise", "rebound_within_24h"]));
  });

  it("falls back when the market is unsupported", () => {
    const window = makePersistentWindow();
    const result = scoreUnsupportedDeal({ ...window, market: "MY" as never });

    expect(result.modelSource).toBe("heuristic");
    expect(result.label).toBe("uncertain");
    expect(result.score).toBeLessThanOrEqual(0.5);
    expect(result.reasons).toContain("unsupported_market_fallback");
  });
});
