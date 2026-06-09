import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriceCheckProcessor } from "../price-check.processor";

const state = vi.hoisted(() => ({
  products: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    find: vi.fn(),
  },
  watchlists: {
    find: vi.fn(),
  },
  dealScores: {
    insertOne: vi.fn(),
  },
  timescale: {
    getLast30dMin: vi.fn(),
    query: vi.fn(),
  },
  reevaluateTier: vi.fn(),
  evaluateTriggers: vi.fn(),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "products") return state.products;
        if (name === "watchlists") return state.watchlists;
        if (name === "deal_scores") return state.dealScores;
        return state.products;
      }),
    })),
  },
}));

vi.mock("../../db/timescale.client", () => ({
  timescale: state.timescale,
}));

vi.mock("../../watchlist/trigger-eval", () => ({
  evaluateTriggers: state.evaluateTriggers,
}));

vi.mock("../../scheduler/priority-engine", () => ({
  reevaluateTier: state.reevaluateTier,
}));

function makeProcessor() {
  const resolver = {
    resolveProductOffer: vi.fn(),
  };
  const alerts = {
    add: vi.fn(),
  };
  const posthog = {
    capture: vi.fn(),
  };
  const sentry = {
    captureException: vi.fn(),
  };

  return {
    processor: new PriceCheckProcessor(resolver as any, alerts as any, posthog as any, sentry as any),
    resolver,
    alerts,
    posthog,
    sentry,
  };
}

describe("FR-PRICE-003 — PriceCheckProcessor deal score persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    state.products.findOne.mockResolvedValue({
      category: "shirts",
      region: "VN",
    });
    state.products.updateOne.mockResolvedValue({});
    state.products.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { currentPrice: 100_000 },
          { currentPrice: 110_000 },
          { currentPrice: 120_000 },
        ]),
      }),
    });
    state.watchlists.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    state.dealScores.insertOne.mockResolvedValue({ insertedId: "deal_score_1" });
    state.timescale.getLast30dMin.mockResolvedValue(80_000);
    state.timescale.query.mockResolvedValue({
      rows: [
        { observed_at: new Date("2026-06-06T00:00:00Z"), price: 100_000, flash_sale: false },
        { observed_at: new Date("2026-06-07T00:00:00Z"), price: 95_000, flash_sale: false },
        { observed_at: new Date("2026-06-08T00:00:00Z"), price: 82_000, flash_sale: false },
        { observed_at: new Date("2026-06-09T00:00:00Z"), price: 80_000, flash_sale: false },
      ],
    });
    state.reevaluateTier.mockResolvedValue("mid");
    state.evaluateTriggers.mockReturnValue({ triggered: [] });
  });

  it("persists the latest deal score and emits a redacted event", async () => {
    const { processor, resolver, posthog, sentry } = makeProcessor();
    const offer = {
      currentPrice: 80_000,
      originalPrice: 100_000,
      currentDiscountPct: 20,
      flashSale: false,
    };
    resolver.resolveProductOffer.mockResolvedValue(offer);

    await processor.process({
      data: {
        productId: "123456-9876543210",
        shopId: 123456,
        itemId: 9876543210,
        tier: "hot",
      },
    } as any);

    expect(state.products.updateOne).toHaveBeenCalledWith(
      { shopId: 123456, itemId: 9876543210 },
      expect.objectContaining({
        $set: expect.objectContaining({
          trackPriority: "mid",
          lastPriceCheckAt: expect.any(Date),
          lastDealScore: expect.any(Number),
          lastDealScoreLabel: "real_deal",
          lastDealScoreConfidence: expect.any(Number),
          lastDealScoreModelVersion: "heuristic-v1",
          lastDealScoreModelSource: "heuristic",
          lastDealScoreAt: expect.any(Date),
          lastRecommendedPricePoint: 104500,
        }),
      }),
    );

    expect(state.dealScores.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "123456-9876543210",
        shopId: 123456,
        itemId: 9876543210,
        label: "real_deal",
        score: expect.any(Number),
        modelSource: "heuristic",
      }),
    );

    expect(posthog.capture).toHaveBeenCalledWith(
      "deal_score_computed",
      expect.objectContaining({
        productId: "123456-9876543210",
        shopId: 123456,
        itemId: 9876543210,
        label: "real_deal",
        score: expect.any(Number),
        confidence: expect.any(Number),
        modelVersion: "heuristic-v1",
        modelSource: "heuristic",
      }),
    );

    expect(JSON.stringify(posthog.capture.mock.calls)).not.toMatch(/commissionRate|userId|sellerEmail|buyerReview/i);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
