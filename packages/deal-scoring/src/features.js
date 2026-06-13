"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDealScoreMarket = isDealScoreMarket;
exports.normalizeDealScoreMarket = normalizeDealScoreMarket;
exports.extractDealScoreWindow = extractDealScoreWindow;
exports.scoreDeal = scoreDeal;
exports.scoreUnsupportedDeal = scoreUnsupportedDeal;
const model_1 = require("./model");
function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
}
function safeNumber(value, fallback = 0) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toDate(value) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime()))
        throw new Error("INVALID_OBSERVED_AT");
    return parsed;
}
function hoursBetween(start, end) {
    return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
}
function mean(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function stddev(values) {
    if (values.length < 2)
        return 0;
    const avg = mean(values);
    const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1)
        return sorted[middle] ?? null;
    const left = sorted[middle - 1];
    const right = sorted[middle];
    if (left === undefined || right === undefined)
        return null;
    return (left + right) / 2;
}
function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
function normalizeObservations(observations) {
    return observations
        .map((observation) => ({
        observedAt: toDate(observation.observedAt),
        price: Math.max(0, safeNumber(observation.price, 0)),
        flashSale: Boolean(observation.flashSale),
    }))
        .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
}
function isDealScoreMarket(value) {
    return value === "VN" || value === "TH";
}
function normalizeDealScoreMarket(value, fallback = "VN") {
    return isDealScoreMarket(value) ? value : fallback;
}
function discountThreshold(currentPrice, baselinePrice, currentDiscountPct) {
    const discountFromBaseline = baselinePrice > 0 ? baselinePrice * (1 - clamp(currentDiscountPct, 0, 100) / 200) : currentPrice * 1.02;
    return Math.max(currentPrice * 1.02, discountFromBaseline);
}
function computeDiscountPersistenceHours(observations, currentPrice, baselinePrice, currentDiscountPct) {
    if (observations.length === 0)
        return 0;
    const latest = observations[observations.length - 1];
    if (!latest)
        return 0;
    const threshold = discountThreshold(currentPrice, baselinePrice, currentDiscountPct);
    let firstPersistentIndex = observations.length - 1;
    for (let index = observations.length - 1; index >= 0; index -= 1) {
        if (observations[index] && observations[index].price <= threshold) {
            firstPersistentIndex = index;
            continue;
        }
        break;
    }
    const firstPersistent = observations[firstPersistentIndex];
    if (!firstPersistent)
        return 0;
    return round(hoursBetween(firstPersistent.observedAt, latest.observedAt), 2);
}
function extractDealScoreWindow(input) {
    const observations = normalizeObservations(input.observations);
    const latestObservation = observations.at(-1);
    const baselinePrice = Math.max(0, safeNumber(input.baselinePrice, 0));
    const currentPrice = latestObservation ? Math.max(0, safeNumber(latestObservation.price, baselinePrice)) : baselinePrice;
    const last30dMin = Math.max(0, safeNumber(input.last30dMin, currentPrice));
    const providedDiscountPct = Number(input.currentDiscountPct);
    const derivedDiscountPct = baselinePrice > 0 ? clamp(((baselinePrice - currentPrice) / baselinePrice) * 100, 0, 100) : 0;
    const currentDiscountPct = Number.isFinite(providedDiscountPct) ? clamp(providedDiscountPct, 0, 100) : derivedDiscountPct;
    const categoryMedianPrice = input.categoryMedianPrice == null ? null : Math.max(0, safeNumber(input.categoryMedianPrice, 0)) || null;
    const categoryGapPct = categoryMedianPrice && categoryMedianPrice > 0 ? round(((categoryMedianPrice - currentPrice) / categoryMedianPrice) * 100, 2) : null;
    return {
        productId: input.productId,
        market: input.market,
        range: input.range,
        currentPrice,
        baselinePrice,
        last30dMin,
        currentDiscountPct,
        discountPersistenceHours: computeDiscountPersistenceHours(observations, currentPrice, baselinePrice, currentDiscountPct),
        priceVolatility: observations.length > 1 && mean(observations.map((observation) => observation.price)) > 0
            ? round(stddev(observations.map((observation) => observation.price)) / mean(observations.map((observation) => observation.price)), 3)
            : 0,
        categoryMedianPrice,
        categoryGapPct,
        flashSaleObserved: observations.some((observation) => observation.flashSale),
        reboundWithin24h: Boolean(input.reboundWithin24h),
        daysSinceLastStrongDrop: input.daysSinceLastStrongDrop == null ? null : Math.max(0, safeNumber(input.daysSinceLastStrongDrop, 0)),
        observationCount: observations.length,
    };
}
function buildRecommendedPricePoint(window) {
    if (window.categoryMedianPrice && window.categoryMedianPrice > 0) {
        return Math.max(1, Math.round(window.categoryMedianPrice * 0.95));
    }
    if (window.last30dMin > 0) {
        return Math.max(1, Math.round(window.last30dMin * 0.97));
    }
    if (window.currentPrice > 0) {
        return Math.max(1, Math.round(window.currentPrice * 0.97));
    }
    return null;
}
function buildReasons(window, unsupportedMarket) {
    const reasons = [];
    if (unsupportedMarket)
        reasons.push("unsupported_market_fallback");
    if (window.currentDiscountPct >= 15)
        reasons.push("sustained_discount");
    if (window.discountPersistenceHours >= 12)
        reasons.push("persistent_discount");
    if (window.currentPrice <= window.last30dMin * 1.02 && window.last30dMin > 0)
        reasons.push("at_30d_floor");
    if (window.priceVolatility <= 0.15)
        reasons.push("low_volatility");
    if (window.categoryGapPct != null && window.categoryGapPct > 0)
        reasons.push("below_category_median");
    if (window.flashSaleObserved)
        reasons.push("flash_sale_noise");
    if (window.reboundWithin24h)
        reasons.push("rebound_within_24h");
    if (window.observationCount < 3)
        reasons.push("thin_history");
    if (window.categoryMedianPrice == null)
        reasons.push("missing_category_median");
    if (window.daysSinceLastStrongDrop != null)
        reasons.push("known_recovery_window");
    return reasons.slice(0, 6);
}
function buildScore(window, unsupportedMarket) {
    const discountDepth = window.baselinePrice > 0 ? clamp((window.baselinePrice - window.currentPrice) / window.baselinePrice, 0, 1) : 0;
    const persistence = clamp(window.discountPersistenceHours / 12, 0, 1);
    const stability = clamp(1 - window.priceVolatility / 0.35, 0, 1);
    const categoryGap = window.categoryGapPct == null ? 0 : clamp(window.categoryGapPct / 25, 0, 1);
    const floorMatch = window.last30dMin > 0 && window.currentPrice <= window.last30dMin * 1.02 ? 1 : 0;
    const recency = window.daysSinceLastStrongDrop == null ? 0 : clamp((30 - window.daysSinceLastStrongDrop) / 30, 0, 1);
    let score = 0.05 + discountDepth * 0.4 + persistence * 0.28 + stability * 0.08 + categoryGap * 0.12 + floorMatch * 0.18 + recency * 0.05;
    if (window.flashSaleObserved)
        score -= 0.22;
    if (window.reboundWithin24h)
        score -= 0.18;
    if (window.categoryMedianPrice == null)
        score -= 0.03;
    if (window.observationCount < 3)
        score -= 0.05;
    let confidence = 0.3 + discountDepth * 0.2 + persistence * 0.25 + stability * 0.1 + categoryGap * 0.05 + recency * 0.04;
    confidence += window.categoryMedianPrice != null ? 0.08 : -0.03;
    confidence += window.last30dMin > 0 ? 0.05 : 0;
    confidence += window.flashSaleObserved ? -0.08 : 0;
    confidence += window.reboundWithin24h ? -0.08 : 0;
    confidence += window.observationCount >= 4 ? 0.05 : window.observationCount === 2 ? 0.02 : window.observationCount <= 1 ? -0.05 : 0;
    score = clamp(score, 0, 1);
    confidence = clamp(confidence, 0, 1);
    const unsupported = unsupportedMarket || !isDealScoreMarket(window.market);
    if (unsupported) {
        score = Math.min(score, 0.5);
        confidence = Math.min(confidence, 0.25);
    }
    let label = "uncertain";
    if (!unsupported) {
        if (score >= 0.8)
            label = "real_deal";
        else if (score <= 0.35)
            label = "false_alarm";
    }
    return {
        productId: window.productId,
        range: window.range,
        score: round(score, 3),
        confidence: round(confidence, 3),
        label,
        recommendedPricePoint: buildRecommendedPricePoint(window),
        modelVersion: model_1.DEAL_SCORE_MODEL_VERSION,
        modelSource: "heuristic",
        reasons: buildReasons(window, unsupported),
        generatedAt: new Date().toISOString(),
    };
}
function scoreDeal(window) {
    return buildScore(window, false);
}
function scoreUnsupportedDeal(window) {
    return buildScore(window, true);
}
