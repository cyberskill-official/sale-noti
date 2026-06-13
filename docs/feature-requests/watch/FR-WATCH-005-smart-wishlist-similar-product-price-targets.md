---
id: FR-WATCH-005
title: "Smart wishlist — recommend similar-product price targets from history embedding similarity"
module: WATCH
priority: SHOULD
verify: T
phase: P4
milestone: "P4 - slice 2 - smart wishlist baseline"
slice: 2
owner: "Senior Tech Lead"
created: 2026-06-13
status: shipped
last_revised: 2026-06-13
related_frs:
  - FR-WATCH-003
  - FR-WATCH-004
  - FR-AFF-009
  - FR-PRICE-003
  - FR-PRICE-004
depends_on:
  - FR-WATCH-003
  - FR-AFF-009
  - FR-PRICE-003
blocks:
  - FR-PRICE-004
effort_hours: 12
template: engineering-spec@1
new_files:
  - packages/smart-wishlist/package.json
  - packages/smart-wishlist/src/index.ts
  - packages/smart-wishlist/src/features.ts
  - packages/smart-wishlist/src/model.ts
  - packages/smart-wishlist/src/__tests__/smart-wishlist.spec.ts
  - apps/api/src/watchlist/smart-wishlist.controller.ts
  - apps/api/src/watchlist/smart-wishlist.service.ts
  - apps/api/src/watchlist/__tests__/smart-wishlist.spec.ts
modified_files:
  - apps/api/src/watchlist/watchlist.module.ts
  - apps/api/src/watchlist/watchlist.service.ts
  - apps/api/src/watchlist/watchlist-crud.controller.ts
  - apps/mobile/src/api.ts
  - apps/mobile/src/types.ts
  - apps/mobile/App.tsx
allowed_tools:
  - "file_read/write apps/api/**"
  - "file_read/write apps/mobile/**"
  - "file_read/write packages/smart-wishlist/**"
  - "bash pnpm test"
disallowed_tools:
  - "use userId, email, phone, or other PII in embeddings or similarity features"
  - "use commissionRate as a similarity or ranking signal"
  - "store raw price-history rows from other users' watchlists in telemetry"
  - "scrape Shopee pages or undocumented endpoints for candidate products"
risk_if_skipped: "The wishlist stays passive: users can track items, but they never get a concrete price target or similar-product guidance, so the P4 AI wedge is just a label rather than a product behavior."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). SaleNoti MUST expose a read-only smart-wishlist layer that turns price-history similarity into a concrete target price and a short list of similar products.

1. The smart-wishlist layer MUST build a history embedding from product-level price history only. The embedding MUST use current price, baseline price, last 30-day minimum, current discount percentage, discount persistence, price volatility, flash-sale density, rebound within 24h, days since last strong drop, market, category gap, and the FR-PRICE-003 deal score when available. The layer MUST NOT use userId, email, phone, seller contact data, commissionRate, coupon state, or affiliate-cookie state.
2. The first slice MUST support the canonical markets already used in P4, at minimum `VN` and `TH`. The market context MUST come from the same canonical product/region source used by FR-AFF-009 and price-check. Unsupported markets MUST fall back to the heuristic path and MUST NOT borrow a similarity score from a different market.
3. Candidate products MUST be sourced from public product and price-history data only. The similarity pool MUST be restricted to the same market and same top-level category, with at least 7 observations in the requested range where possible. The layer MUST NOT inspect other users' watchlist ownership, alert config, or billing tier.
4. The API MUST expose `GET /v1/watchlists/:id/smart-wishlist?range=30d|90d&limit=1..5` and return a closed result shape containing `recommendedTargetPrice`, `confidence`, `similarProducts`, `modelVersion`, `modelSource`, `reasons`, and `generatedAt`.
5. The API MAY expose summary fields on `GET /v1/watchlists?includeSmartWishlist=summary` so the mobile list can render a target-price badge without a second round trip. The default watchlist response MUST remain unchanged when the query flag is absent.
6. The first slice SHOULD persist a compact, PII-free recommendation snapshot on the watchlist row and in a dedicated `smart_wishlist_history` collection. The snapshot MUST contain only product-level fields such as market, range, embedding version, recommendedTargetPrice, confidence, modelVersion, modelSource, and generatedAt.
7. `recommendedTargetPrice` MUST be a whole-currency value and MUST be rounded for the local market display unit. The `similarProducts` list SHOULD include `productId`, `name`, `imageUrl`, `currentPrice`, `recommendedTargetPrice`, `similarity`, and `reasons` for each comparable item.
8. The smart-wishlist layer MUST emit `smart_wishlist_computed` with redacted identifiers only. Raw price-history series, raw embeddings, userId, and commission data MUST NOT be attached to telemetry payloads. A fallback-path Sentry warning MAY be emitted when the heuristic path is used because of sparse history or an unsupported market.
9. The feature MUST remain read-only. It MUST NOT mutate alert config, watchlist status, trackPriority, subscription tier, or any other persisted state outside the recommendation snapshot.
10. Sparse history MUST be handled safely. If there are too few observations or too few comparable products, the service MUST still return the same shape with `modelSource: "heuristic"`, `similarProducts: []`, and low confidence instead of failing closed with an exception.

## §2 - Why this design

Smart wishlist is the consumer-side counterpart to FR-PRICE-003. Deal scoring tells us whether a price drop is real; smart wishlist turns that signal into an actionable target price for the watched item and a short list of similar products that justify the target.

The embedding is intentionally deterministic. SaleNoti does not need a vector database or an external ML stack for the first slice; it needs a stable feature vector that can be built from the same price-history data we already have. That keeps the implementation cheap, keeps the market boundary explicit, and avoids drifting into user-level or commission-based ranking.

Keeping the similarity layer read-only matters. The feature is supposed to help the user decide what price to wait for, not to rewrite alert config or billing state behind their back. That makes the feature safe to expose in a mobile list badge and reusable later for the price-prediction and sponsored-deals work.

The optional summary flag keeps the existing watchlist response stable while still letting the mobile surface render a target-price badge in one paint. That is the lowest-friction UX path for the current app structure.

## §3 - API contract and code shape

### Shared package surface

```ts
export type SmartWishlistMarket = "VN" | "TH";
export type SmartWishlistSource = "heuristic" | "ml";
export type SmartWishlistRange = "30d" | "90d";

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

export function buildWishlistEmbedding(window: SmartWishlistEmbeddingWindow): readonly number[];
export function findSimilarWishlistProducts(
  window: SmartWishlistEmbeddingWindow,
  candidates: readonly SmartWishlistEmbeddingWindow[],
  limit?: number,
): readonly SmartWishlistCandidate[];
export function recommendWishlistTargetPrice(
  window: SmartWishlistEmbeddingWindow,
  candidates: readonly SmartWishlistEmbeddingWindow[],
  limit?: number,
): SmartWishlistResult;
```

### API routes

```http
GET /v1/watchlists/:id/smart-wishlist?range=30d&limit=3
Authorization: Bearer <jwt>
X-User-Id: 65f7...
```

Success:

```http
HTTP/1.1 200 OK
{
  "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1",
  "productId": "123-456",
  "market": "VN",
  "range": "30d",
  "recommendedTargetPrice": 89000,
  "confidence": 0.84,
  "modelVersion": "wishlist-history-v1",
  "modelSource": "heuristic",
  "reasons": ["stable_discount", "category_peer_low", "no_rebound_within_24h"],
  "generatedAt": "2026-06-13T10:00:00Z",
  "similarProducts": [
    {
      "productId": "123-999",
      "name": "Áo thun nam basic slim",
      "imageUrl": "https://cf.shopee.vn/file/...",
      "currentPrice": 92000,
      "recommendedTargetPrice": 89000,
      "similarity": 0.91,
      "reasons": ["same_market", "same_category", "similar_discount_curve"]
    }
  ]
}
```

Optional list summary:

```http
GET /v1/watchlists?includeSmartWishlist=summary
```

The response MAY add these optional fields to each item:

- `smartWishlistTargetPrice`
- `smartWishlistConfidence`
- `smartWishlistSimilarCount`
- `smartWishlistModelVersion`
- `smartWishlistModelSource`
- `smartWishlistGeneratedAt`

### Persistence contract

The first slice SHOULD cache a compact snapshot on the watchlist row and in `smart_wishlist_history` so the same recommendation does not need to be recomputed on every list refresh. The cached data MUST remain product-level only and MUST NOT store raw price-history series or user-level metadata.

Recommended snapshot fields:

- `watchlists.lastSmartWishlistTargetPrice`
- `watchlists.lastSmartWishlistConfidence`
- `watchlists.lastSmartWishlistModelVersion`
- `watchlists.lastSmartWishlistModelSource`
- `watchlists.lastSmartWishlistAt`
- `watchlists.lastSmartWishlistSimilarCount`

### Caller behavior

- The API route MUST stay read-only and MUST NOT touch alert state.
- The mobile list MAY render a badge from the summary fields when present.
- The same model version string MUST flow through the API, mobile summary, and history collection.
- The candidate pool MUST be market-separated so VN and TH never mix.

## §4 - Acceptance criteria

1. Given a watched product with enough history and at least three comparable products in the same market/category, `GET /v1/watchlists/:id/smart-wishlist` returns a non-null `recommendedTargetPrice`, a non-empty `similarProducts` list, and `confidence >= 0.8` when the signal is strong.
2. Given sparse history or too few comparable products, the response still returns the same shape with `modelSource = "heuristic"`, `similarProducts = []`, and `confidence < 0.5`.
3. Given `includeSmartWishlist=summary`, `GET /v1/watchlists` adds the optional summary fields, and the default watchlist response remains unchanged when the flag is omitted.
4. Given a TH watchlist, no VN candidates appear in the result set, and vice versa.
5. Given any telemetry event emitted by the feature, the payload contains no userId, no email, no phone, no commissionRate, and no raw price-history series.
6. Given `limit=99`, the API clamps the result to 5 similar products.
7. Given the mobile watchlist card with summary fields present, the UI can render a target-price badge without an extra request; without summary fields, the card remains unchanged.
8. Given an unsupported market, the service degrades to the heuristic path and does not fail the request.

## §5 - Verification

```ts
// packages/smart-wishlist/src/__tests__/smart-wishlist.spec.ts
describe("FR-WATCH-005 — smart wishlist similarity", () => {
  it("returns a target price from stable history", () => {
    // recommendWishlistTargetPrice(...) -> recommendedTargetPrice, similarProducts
  });

  it("falls back for sparse history", () => {
    // recommendWishlistTargetPrice(...) -> modelSource: "heuristic"
  });

  it("keeps markets separated", () => {
    // VN candidate pool does not include TH rows
  });
});
```

Expected implementation checks:

- `pnpm --filter @salenoti/api test -- src/watchlist/__tests__/smart-wishlist.spec.ts`
- `pnpm --filter @salenoti/api test -- src/watchlist/__tests__/watchlist-crud.spec.ts`
- `pnpm --dir apps/mobile typecheck`
- `pnpm fr:check`
- `pnpm legal:check`

## §6 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Sparse history for a new watchlist | too few observations in the requested range | heuristic recommendation with low confidence | keep the same response shape and show an empty/low-confidence summary |
| Market mismatch | market code missing or mixed across pools | wrong or unstable target price | fall back to the canonical market source and never mix pools |
| Candidate pool too small | fewer than the minimum comparable products | noisy target price | shrink the result to `similarProducts: []` and lower confidence |
| Flash-sale spike | one-off promo window distorts the embedding | false high target or unstable neighbors | require persistence and rebound features before high-confidence output |
| Stale snapshot | cached recommendation no longer matches current price history | outdated badge in the mobile list | refresh the snapshot on the next successful list/detail request |
| Telemetry leak | event payload includes raw labels or user data | compliance incident | redact the payload, update the schema, and rerun audit |
| Unsupported market | market not recognized by the routing helper | missing recommendation | return the heuristic path and keep the UI stable |

*End of FR-WATCH-005 spec. Status: shipped (2026-06-13).*
