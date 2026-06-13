"use strict";

const SMART_WISHLIST_MODEL_VERSION = "wishlist-history-v1";

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isSmartWishlistMarket(value) {
  return value === "VN" || value === "TH";
}

function normalizeSmartWishlistMarket(value, fallback = "VN") {
  return isSmartWishlistMarket(value) ? value : fallback;
}

function normalizeSmartWishlistRange(value, fallback = "30d") {
  return value === "30d" || value === "90d" ? value : fallback;
}

function buildWishlistEmbedding(window) {
  const marketScore = normalizeSmartWishlistMarket(window.market) === "TH" ? 1 : 0;
  const priceRatio = clamp(window.currentPrice / Math.max(window.baselinePrice, 1), 0, 2) / 2;
  const discount = clamp(window.currentDiscountPct / 100, 0, 1);
  const persistence = clamp(window.discountPersistenceHours / 72, 0, 1);
  const stability = 1 - clamp(window.priceVolatility / 0.5, 0, 1);
  const flashDensity = clamp(window.flashSaleDensity, 0, 1);
  const rebound = window.reboundWithin24h ? 1 : 0;
  const recency = window.daysSinceLastStrongDrop == null ? 0.5 : 1 - clamp(window.daysSinceLastStrongDrop / 90, 0, 1);
  const categoryGap = window.categoryGapPct == null ? 0.5 : clamp((window.categoryGapPct + 50) / 100, 0, 1);
  const dealScore = window.dealScore == null ? 0.5 : clamp(window.dealScore, 0, 1);
  const dealConfidence = window.dealConfidence == null ? 0.5 : clamp(window.dealConfidence, 0, 1);
  const floorRatio = clamp(window.currentPrice / Math.max(window.last30dMin, 1), 0, 2) / 2;
  return [
    marketScore,
    priceRatio,
    discount,
    persistence,
    stability,
    flashDensity,
    rebound,
    recency,
    categoryGap,
    dealScore,
    dealConfidence,
    floorRatio,
  ];
}

function similarityScore(target, candidate) {
  const weights = [0.12, 0.15, 0.12, 0.11, 0.09, 0.07, 0.08, 0.08, 0.08, 0.07, 0.05, 0.08];
  const targetVector = buildWishlistEmbedding(target);
  const candidateVector = buildWishlistEmbedding(candidate);
  let distance = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index] ?? 0;
    const left = targetVector[index] ?? 0.5;
    const right = candidateVector[index] ?? 0.5;
    distance += weight * Math.abs(left - right);
  }
  return clamp(1 - distance, 0, 1);
}

function buildCandidateTargetPrice(candidate) {
  const floor = candidate.last30dMin > 0 ? candidate.last30dMin : candidate.currentPrice > 0 ? candidate.currentPrice : candidate.baselinePrice;
  if (!floor || floor <= 0) return null;
  const aggressive = candidate.dealScore != null && candidate.dealScore >= 0.8
    ? 0.985
    : candidate.dealConfidence != null && candidate.dealConfidence >= 0.75
      ? 0.97
      : 0.96;
  return Math.max(1, Math.round(floor * aggressive));
}

function buildCandidateReasons(target, candidate, similarity) {
  const reasons = ["same_market", "same_category"];
  const discountGap = Math.abs(candidate.currentDiscountPct - target.currentDiscountPct);
  const priceGap = target.currentPrice > 0 ? Math.abs(candidate.currentPrice - target.currentPrice) / target.currentPrice : 1;

  if (similarity >= 0.82 || discountGap <= 6) reasons.push("similar_discount_curve");
  if (priceGap <= 0.12) reasons.push("similar_price_band");
  if (candidate.priceVolatility <= target.priceVolatility + 0.05) reasons.push("low_volatility");
  if (candidate.dealScore != null && candidate.dealScore >= 0.8) reasons.push("strong_deal_signal");
  if (candidate.discountPersistenceHours >= 12) reasons.push("persistent_discount");
  if (candidate.last30dMin > 0 && candidate.currentPrice <= candidate.last30dMin * 1.02) reasons.push("close_to_floor");

  return [...new Set(reasons)].slice(0, 5);
}

function buildCurrentReasons(window, sparse, candidateCount) {
  const reasons = [];
  if (window.currentDiscountPct >= 15) reasons.push("sustained_discount");
  if (window.discountPersistenceHours >= 12) reasons.push("persistent_discount");
  if (window.priceVolatility <= 0.15) reasons.push("low_volatility");
  if (window.categoryGapPct != null && window.categoryGapPct > 0) reasons.push("below_category_median");
  if (window.flashSaleDensity > 0.25) reasons.push("flash_sale_noise");
  if (window.reboundWithin24h) reasons.push("rebound_within_24h");
  if (window.dealScore != null && window.dealScore >= 0.8) reasons.push("strong_deal_signal");
  if (sparse) reasons.push("thin_history");
  if (candidateCount < 3) reasons.push("small_candidate_pool");
  return [...new Set(reasons)].slice(0, 6);
}

function computeConfidence(window, candidates, sparse) {
  const bestSimilarity = candidates[0]?.similarity ?? 0;
  const averageSimilarity = candidates.length > 0 ? mean(candidates.slice(0, 3).map((candidate) => candidate.similarity)) : 0;
  const signalScore = clamp((window.currentDiscountPct / 100) * 0.3, 0, 0.3)
    + clamp(window.discountPersistenceHours / 72, 0, 1) * 0.2
    + clamp(1 - window.priceVolatility / 0.5, 0, 1) * 0.12
    + clamp(window.dealScore == null ? 0.5 : window.dealScore, 0, 1) * 0.18
    + clamp(window.dealConfidence == null ? 0.5 : window.dealConfidence, 0, 1) * 0.08;

  let confidence = 0.2 + bestSimilarity * 0.35 + averageSimilarity * 0.18 + signalScore;
  if (sparse) confidence -= 0.25;
  if (candidates.length < 3) confidence -= 0.15;
  if (window.reboundWithin24h) confidence -= 0.12;
  if (window.flashSaleDensity > 0.4) confidence -= 0.08;
  if (window.categoryGapPct == null) confidence -= 0.05;
  return clamp(confidence, 0, 1);
}

function buildBaseTarget(window) {
  const floor = window.last30dMin > 0 ? window.last30dMin : window.currentPrice > 0 ? window.currentPrice : window.baselinePrice;
  if (!floor || floor <= 0) return null;
  const dealAdjusted = window.dealScore != null && window.dealScore >= 0.8 ? 0.985 : 0.97;
  return Math.max(1, Math.round(floor * dealAdjusted));
}

function isSimilarCandidate(target, candidate) {
  return normalizeSmartWishlistMarket(candidate.market) === normalizeSmartWishlistMarket(target.market)
    && normalizeSmartWishlistRange(candidate.range) === normalizeSmartWishlistRange(target.range)
    && candidate.productId !== target.productId;
}

function toCandidateRecord(target, candidate) {
  const similarity = similarityScore(target, candidate);
  return {
    productId: candidate.productId,
    name: candidate.name ?? null,
    imageUrl: candidate.imageUrl ?? null,
    currentPrice: candidate.currentPrice ?? null,
    recommendedTargetPrice: buildCandidateTargetPrice(candidate),
    similarity: round(similarity, 3),
    reasons: buildCandidateReasons(target, candidate, similarity),
  };
}

function findSimilarWishlistProducts(window, candidates, limit = 5) {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 5);
  if ((window.observationCount ?? 0) < 7) return [];

  return candidates
    .filter((candidate) => isSimilarCandidate(window, candidate) && (candidate.observationCount ?? 0) >= 7)
    .map((candidate) => toCandidateRecord(window, candidate))
    .sort((left, right) => right.similarity - left.similarity || (right.currentPrice ?? 0) - (left.currentPrice ?? 0))
    .slice(0, safeLimit);
}

function recommendWishlistTargetPrice(window, candidates, limit = 5) {
  const similarProducts = findSimilarWishlistProducts(window, candidates, limit);
  const sparse = (window.observationCount ?? 0) < 7;
  const baseTarget = buildBaseTarget(window);
  const weightedCandidateTarget = similarProducts.length > 0
    ? Math.round(
        similarProducts.reduce((sum, candidate) => sum + (candidate.recommendedTargetPrice ?? 0) * candidate.similarity, 0) /
          Math.max(similarProducts.reduce((sum, candidate) => sum + candidate.similarity, 0), 1),
      )
    : null;
  const recommendedTargetPrice = weightedCandidateTarget != null
    ? Math.max(1, Math.min(window.currentPrice || weightedCandidateTarget, Math.round((weightedCandidateTarget * 0.7) + ((baseTarget ?? weightedCandidateTarget) * 0.3))))
    : baseTarget;

  return {
    watchlistId: window.watchlistId,
    productId: window.productId,
    market: normalizeSmartWishlistMarket(window.market),
    range: normalizeSmartWishlistRange(window.range),
    recommendedTargetPrice,
    confidence: computeConfidence(window, similarProducts, sparse),
    similarProducts: sparse ? [] : similarProducts,
    reasons: buildCurrentReasons(window, sparse, similarProducts.length),
    modelVersion: SMART_WISHLIST_MODEL_VERSION,
    modelSource: "heuristic",
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  SMART_WISHLIST_MODEL_VERSION,
  isSmartWishlistMarket,
  normalizeSmartWishlistMarket,
  normalizeSmartWishlistRange,
  buildWishlistEmbedding,
  findSimilarWishlistProducts,
  recommendWishlistTargetPrice,
};

module.exports.default = module.exports;
