---
id: FR-PRICE-003
title: "ML deal-scoring model — classify each detected price drop as \"real deal\" vs \"false alarm\""
module: PRICE
priority: MUST
status: shipped
verify: T
phase: P4
milestone: "P4 - slice 1 - deal scoring baseline"
slice: 1
owner: "Senior Tech Lead"
created: 2026-06-09
last_revised: 2026-06-09
related_frs:
  - FR-PRICE-001
  - FR-PRICE-002
  - FR-AFF-009
  - FR-ADMIN-002
  - FR-WATCH-002
  - FR-WATCH-005
  - FR-PRICE-004
depends_on:
  - FR-PRICE-001
  - FR-PRICE-002
  - FR-AFF-009
blocks:
  - FR-WATCH-005
  - FR-PRICE-004
  - FR-ADMIN-005
  - FR-ADMIN-006
effort_hours: 14
template: engineering-spec@1
new_files:
  - packages/deal-scoring/package.json
  - packages/deal-scoring/src/index.ts
  - packages/deal-scoring/src/features.ts
  - packages/deal-scoring/src/model.ts
  - packages/deal-scoring/src/__tests__/deal-score.spec.ts
modified_files:
  - apps/api/src/affiliate/price-check.processor.ts
  - apps/web/src/server/admin/dashboard.service.ts
  - apps/web/src/app/api/admin/products/[productId]/analytics/route.ts
  - apps/web/src/server/admin/__tests__/dashboard.service.spec.ts
  - apps/web/src/app/api/admin/__tests__/admin-apis.integration.spec.ts
allowed_tools:
  - "file_read/write apps/api/**"
  - "file_read/write apps/web/**"
  - "file_read/write packages/deal-scoring/**"
  - "bash pnpm test"
disallowed_tools:
  - "use commissionRate as a feature or ranking signal"
  - "store userId, seller email, buyer review text, or any other PII in training features"
  - "depend on affiliate cookie state or coupon override state"
  - "surface raw training labels in product-facing UI"
risk_if_skipped: "The product keeps treating every price drop as equally meaningful, which preserves alert noise, weakens B2B recommendation quality, and leaves FR-WATCH-005 / FR-PRICE-004 / FR-ADMIN-005 without a normalized deal signal to build on."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). SaleNoti MUST expose a reusable deal-scoring layer that classifies each detected price drop as a probable real deal, a false alarm, or an uncertain signal.

1. The shared deal-scoring package MUST export pure helpers that can be consumed by both the API worker layer and the web dashboard layer. The core API MUST include `scoreDeal()` and `extractDealScoreWindow()` and MUST return a closed score result shape.
2. The model MUST use only product-level, price-history, market, and category features. It MUST NOT use `commissionRate`, `userId`, seller email, buyer-review text, affiliate-cookie state, or coupon-override state as features.
3. The feature window MUST support the same bounded historical ranges used elsewhere in the product: `7d`, `30d`, and `90d`. The window MUST include at minimum current price, baseline price, last 30-day minimum, current discount percentage, discount persistence, price volatility, flash-sale signal, category median price, category gap, and rebound evidence.
4. The model MUST be market-aware. The first slice MUST support at least `VN` and `TH` as explicit markets, using the same regional assumptions introduced by FR-AFF-009. The market passed to `extractDealScoreWindow()` and `scoreDeal()` MUST come from the caller's canonical market context (`price-history.region` or an equivalent region-routing helper); legacy Shopee-only callers MAY default to `VN`. Unsupported markets MUST fall back to the heuristic path and MUST NOT reuse a score from a different market.
5. The score result MUST expose `score` (0..1), `confidence` (0..1), `label`, `recommendedPricePoint`, `modelVersion`, `modelSource`, `reasons`, and `generatedAt`. The label set MUST be closed: `real_deal`, `false_alarm`, `uncertain`.
6. The model MUST remain safe when the trained artifact is missing or under-trained. In that case, the service MUST return the same shape with `modelSource: "heuristic"` and the callers MUST continue to work without a feature-flag rollback.
7. `apps/api/src/affiliate/price-check.processor.ts` MUST compute and persist the latest deal score after each successful price check. The processor MUST store a PII-free score snapshot on the product row and in a dedicated score history collection for drift and audit.
8. `apps/web/src/server/admin/dashboard.service.ts` MUST prefer the model-backed `recommendedPricePoint` when `confidence >= 0.80` and `modelSource = "ml"`, and MUST keep the existing heuristic fallback when the score is unavailable, low-confidence, or not yet calibrated. The analytics response MAY include `dealScore`, `dealLabel`, `dealConfidence`, and `dealReasons` as optional fields.
9. Training labels MAY be derived from product-level outcomes such as post-drop persistence, rebound within 24h, repeat-low observations, and manual QA review. The training set MUST remain anonymized at the product/window level and MUST NOT expose raw user activity logs.
10. Model quality MUST be measured on a frozen holdout split and the canonical evaluation MUST reach ROC-AUC >= 0.85 before the ML path is marked as production-grade. Calibrated confidence thresholds MUST be documented alongside the model version.
11. Observability MUST emit a `deal_score_computed` event and a failure-path Sentry signal with redacted features only. No raw labels, no commission data, and no PII may be attached to telemetry payloads.

## §2 - Why this design

The current dashboard already has a simple heuristic recommendation (`lowest-in-category-30d-avg - 5%`) as a stopgap. That fallback is safe, but it is coarse: it treats a one-hour promo spike the same as a sustained low price, and it cannot distinguish a genuine deal from a price that rebounds immediately after a flash-sale window.

A shared scoring package is the cleanest shape because both the price-check worker and the B2B dashboard need the same classification. Keeping the core logic pure and reusable prevents a duplicate heuristic from drifting between `apps/api` and `apps/web`.

The feature set is intentionally conservative. SaleNoti already has the price history, category metadata, flash-sale flags, and regional market context needed to score a drop without touching sensitive fields. Not using `commissionRate`, `userId`, seller email, or buyer-review text keeps the model aligned with the trust-first and PDPL boundaries established in the earlier FRs.

The score is normalized to a probability-like value instead of a raw binary class because later features need calibration. `FR-WATCH-005` can use the score to filter noise, `FR-PRICE-004` can reuse the same feature window for forecasting, and the B2B dashboard can turn the score into a softer recommendation when confidence is low.

## §3 - API contract and code shape

### Shared package surface

```ts
export type DealScoreLabel = "real_deal" | "false_alarm" | "uncertain";
export type DealScoreSource = "ml" | "heuristic";

export interface DealScoreWindow {
  productId: string;
  market: "VN" | "TH";
  range: "7d" | "30d" | "90d";
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
}

export interface DealScoreResult {
  productId: string;
  range: "7d" | "30d" | "90d";
  score: number;
  confidence: number;
  label: DealScoreLabel;
  recommendedPricePoint: number | null;
  modelVersion: string;
  modelSource: DealScoreSource;
  reasons: readonly string[];
  generatedAt: string;
}

export function extractDealScoreWindow(input: {
  productId: string;
  market: "VN" | "TH";
  range: "7d" | "30d" | "90d";
  observations: Array<{ observedAt: Date | string; price: number; flashSale: boolean }>;
  baselinePrice: number;
  last30dMin: number;
  currentDiscountPct: number;
  categoryMedianPrice?: number | null;
  reboundWithin24h: boolean;
  daysSinceLastStrongDrop?: number | null;
}): DealScoreWindow;

export function scoreDeal(window: DealScoreWindow): DealScoreResult;
```

### Persisted score snapshot

The first slice MUST persist a compact, PII-free deal-score snapshot so the worker and dashboard can reuse the same classification without recomputing the same window repeatedly.

Recommended persistence fields:

- `products.lastDealScore`
- `products.lastDealScoreLabel`
- `products.lastDealScoreConfidence`
- `products.lastDealScoreModelVersion`
- `products.lastDealScoreModelSource`
- `products.lastDealScoreAt`
- `products.lastRecommendedPricePoint`

A dedicated `deal_scores` history collection SHOULD keep the score window, label, confidence, and model version for drift analysis and auditability. The collection MUST remain product/window level only and MUST NOT store PII.

### Caller behavior

- `price-check.processor.ts` MUST call the scorer after every successful price observation write.
- `dashboard.service.ts` MUST surface the latest score when available and MUST keep the existing heuristic if the scorer is unavailable or low-confidence.
- The analytics route MAY expose the score fields as optional extras, but existing clients MUST continue to work if they ignore them.
- The worker and dashboard MUST use the same model version string so support can trace a score back to the exact artifact that produced it.

### Suggested score semantics

- `score >= 0.80` => `real_deal`
- `score <= 0.35` => `false_alarm`
- otherwise => `uncertain`

These thresholds are part of the model contract and MUST remain versioned; changing them requires a new model version and a fresh evaluation note.

## §4 - Acceptance criteria

1. Given a price window with a sustained discount, a category gap, and no rebound within 24h, `scoreDeal()` returns `label = "real_deal"` with `score >= 0.80`.
2. Given a one-off flash-sale spike that reverts within 24h, `scoreDeal()` returns `label = "false_alarm"` with `score <= 0.35`.
3. Given an ambiguous window, `scoreDeal()` returns `label = "uncertain"` and a confidence below the production threshold.
4. Given a missing or disabled trained artifact, the scorer still returns the same shape with `modelSource = "heuristic"` and the caller path does not crash.
5. Given a successful price check, the worker persists the latest score snapshot on the product row and emits `deal_score_computed` without attaching PII or commission data.
6. Given the B2B analytics route, the dashboard prefers the model-backed recommendation when `confidence >= 0.80` and `modelSource = "ml"`, and falls back to the existing heuristic when it is not.
7. Given the frozen evaluation split, the model achieves ROC-AUC >= 0.85 before the ML path is promoted beyond the draft baseline.
8. Given a non-supported market, the scorer degrades to the heuristic path rather than silently mixing in a different market's model.
9. Given any telemetry event emitted from the scorer, no raw training labels, buyer reviews, user IDs, seller emails, or commission rates appear in the payload.

## §5 - Verification

```ts
// packages/deal-scoring/src/__tests__/deal-score.spec.ts
describe("FR-PRICE-003 — deal scoring", () => {
  it("scores a persistent discount as a real deal", () => {
    // scoreDeal(...) -> real_deal, score >= 0.80
  });

  it("scores a rebound as a false alarm", () => {
    // scoreDeal(...) -> false_alarm, score <= 0.35
  });

  it("falls back when the model artifact is unavailable", () => {
    // scoreDeal(...) -> modelSource: "heuristic"
  });
});
```

Expected implementation checks:

- `pnpm --filter @salenoti/api test -- src/price/__tests__/deal-score.spec.ts`
- `pnpm --filter @salenoti/api test -- src/affiliate/__tests__/price-check.processor.spec.ts`
- `pnpm --filter @salenoti/web test -- src/server/admin/__tests__/dashboard.service.spec.ts`
- `pnpm fr:check`
- `pnpm legal:check`

## §6 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Sparse history for a new product | not enough observations in the requested window | `uncertain` with low confidence | Use heuristic fallback until enough points exist |
| Flash-sale noise | score jumps high on one bucket then rebounds | false positive risk | Require persistence/rebound feature before `real_deal` label |
| Missing category metadata | `categoryMedianPrice` is null | lower-confidence score | Keep model but reduce confidence and reasons quality |
| Unsupported market | market enum not recognized | fallback heuristic | Return `modelSource: "heuristic"` and keep dashboard stable |
| Model artifact missing or stale | version lookup fails | inference fallback | Use heuristic path, emit Sentry warning, and continue |
| Training drift after regional expansion | holdout metrics regress | weaker recommendations | Freeze the old version and retrain before promotion |
| PII leak in telemetry | review captured event payloads | compliance incident | Redact payload, rotate event schema, and re-run audit |
| Overconfident false positive | user sees a bad "real deal" badge | trust regression | Lower the confidence threshold and open an audit note |

## §7 - Notes

- The ML model is intentionally a normalization layer, not a price oracle. It should make the existing price signals easier to consume, not replace the underlying price history or alert rules.
- This FR is the first consumer of the regional market context introduced by FR-AFF-009.
- The current heuristic in `FR-ADMIN-002` remains the fallback and should not be removed until the model is calibrated and audited.
- Later P4 FRs can reuse the same feature window and `DealScoreResult` shape without reopening the privacy and evaluation questions.
