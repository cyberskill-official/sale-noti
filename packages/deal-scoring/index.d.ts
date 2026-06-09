export type DealScoreMarket = "VN" | "TH";
export type DealScoreRange = "7d" | "30d" | "90d";
export type DealScoreLabel = "real_deal" | "false_alarm" | "uncertain";
export type DealScoreSource = "ml" | "heuristic";

export declare const DEAL_SCORE_MODEL_VERSION: "heuristic-v1";

export type DealScoreObservation = {
  observedAt: Date | string;
  price: number;
  flashSale: boolean;
};

export interface DealScoreWindowInput {
  productId: string;
  market: DealScoreMarket;
  range: DealScoreRange;
  observations: Array<DealScoreObservation>;
  baselinePrice: number;
  last30dMin: number;
  currentDiscountPct: number;
  categoryMedianPrice?: number | null;
  reboundWithin24h: boolean;
  daysSinceLastStrongDrop?: number | null;
}

export interface DealScoreWindow {
  productId: string;
  market: DealScoreMarket;
  range: DealScoreRange;
  currentPrice: number;
  baselinePrice: number;
  last30dMin: number;
  currentDiscountPct: number;
  discountPersistenceHours: number;
  priceVolatility: number;
  categoryMedianPrice: number | null;
  categoryGapPct: number | null;
  flashSaleObserved: boolean;
  reboundWithin24h: boolean;
  daysSinceLastStrongDrop: number | null;
  observationCount: number;
}

export interface DealScoreResult {
  productId: string;
  range: DealScoreRange;
  score: number;
  confidence: number;
  label: DealScoreLabel;
  recommendedPricePoint: number | null;
  modelVersion: string;
  modelSource: DealScoreSource;
  reasons: readonly string[];
  generatedAt: string;
}

export declare function isDealScoreMarket(value: unknown): value is DealScoreMarket;

export declare function normalizeDealScoreMarket(value: unknown, fallback?: DealScoreMarket): DealScoreMarket;

export declare function extractDealScoreWindow(input: DealScoreWindowInput): DealScoreWindow;

export declare function scoreDeal(window: DealScoreWindow): DealScoreResult;

export declare function scoreUnsupportedDeal(window: DealScoreWindow): DealScoreResult;
