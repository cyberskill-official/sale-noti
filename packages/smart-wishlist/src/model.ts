export type SmartWishlistMarket = "VN" | "TH";
export type SmartWishlistSource = "heuristic" | "ml";
export type SmartWishlistRange = "30d" | "90d";

export const SMART_WISHLIST_MODEL_VERSION = "wishlist-history-v1" as const;

export interface SmartWishlistEmbeddingWindow {
  watchlistId: string;
  productId: string;
  market: SmartWishlistMarket;
  range: SmartWishlistRange;
  currentPrice: number;
  baselinePrice: number;
  last30dMin: number;
  currentDiscountPct: number;
  discountPersistenceHours: number;
  priceVolatility: number;
  flashSaleDensity: number;
  reboundWithin24h: boolean;
  daysSinceLastStrongDrop: number | null;
  categoryGapPct: number | null;
  dealScore: number | null;
  dealConfidence: number | null;
  observationCount?: number;
}

export interface SmartWishlistCandidate {
  productId: string;
  name: string | null;
  imageUrl: string | null;
  currentPrice: number | null;
  recommendedTargetPrice: number | null;
  similarity: number;
  reasons: readonly string[];
}

export interface SmartWishlistResult {
  watchlistId: string;
  productId: string;
  market: SmartWishlistMarket;
  range: SmartWishlistRange;
  recommendedTargetPrice: number | null;
  confidence: number;
  similarProducts: readonly SmartWishlistCandidate[];
  reasons: readonly string[];
  modelVersion: string;
  modelSource: SmartWishlistSource;
  generatedAt: string;
}

export interface SmartWishlistCandidateInput extends SmartWishlistEmbeddingWindow {
  name?: string | null;
  imageUrl?: string | null;
  currentPrice?: number | null;
}
