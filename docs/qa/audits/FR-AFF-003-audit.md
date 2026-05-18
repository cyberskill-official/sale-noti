# FR-AFF-003 Audit Report — Product/Shop Offer Resolver

**Date:** 2026-05-18 17:03 ICT  
**Initial state:** `Implemented-Pending-Audit`  
**Final state:** `Completed` via deterministic mock/sandbox validation; live Shopee + Mongo + Timescale + Redis smoke remains credential-gated.

## Audit Findings

The shipped resolver already called `productOfferV2`, upserted MongoDB, and wrote Timescale history. The first strict audit failed because the resolver lacked required tests and several FR details:

- `resolveShopOffer` did not cache shop-level rates in Redis for 1 hour.
- `product_offer_resolved` events did not include required `outcome: "live"` and `latency_ms` for live/dead paths.
- Explicit Shopee `flashSale` flags were not requested or honored.
- Resolver-stage Sentry tagging was incomplete for `resolve` and `mongo_write`.
- Mongo rows did not enforce the reserved `currency: "VND"` field.
- Discount percent was not capped at 99.
- There was no offer-resolver test suite covering dual-write, dead items, cache, OBS tags, degraded Timescale behavior, or deterministic scheduling hash.

## Fixes Implemented

- Added optional `flashSale` support to the Shopee response schema and product offer query.
- Added resolver-level Sentry phase tags for `resolve`, `mongo_write`, and `timescale_write`.
- Added required PostHog `outcome` and `latency_ms` fields.
- Added Redis `shopee:shop_offer:<shopId>` cache with 3600s TTL.
- Added explicit flash-sale handling: discount threshold OR Shopee flag.
- Added `currency: "VND"` on Mongo product snapshots.
- Capped `currentDiscountPct` at 99.
- Switched schedule hash to deterministic djb2-style hashing.
- Added `offer-resolver.spec.ts` covering the FR contract with mocks.
- Updated README, QA traceability, and test case documentation.

## Acceptance Criteria Coverage

| AC  | Result | Evidence                                                                     |
| --- | ------ | ---------------------------------------------------------------------------- |
| 1   | Passed | `offer-resolver.spec.ts` normalizes `currentPrice`, discount, flash sale     |
| 2   | Passed | Mongo upsert assertions cover required snapshot fields                       |
| 3   | Passed | Timescale insert assertion uses the same `observedAt` as Mongo               |
| 4   | Passed | Dead item test sets `deletedAt` and skips Timescale                          |
| 5   | Passed | Mongo upsert includes `$unset: { deletedAt: "" }`                            |
| 6   | Passed | 50% discount test sets Timescale `flashSale: true`                           |
| 7   | Passed | Explicit Shopee `flashSale: true` is honored                                 |
| 8   | Passed | `pnpm legal:check` no commission ranking                                     |
| 9   | Passed | PostHog event assertions cover public ids and `latency_ms`                   |
| 10  | Passed | Redis cache test covers miss, setex, hit                                     |
| 11  | Mocked | Unit path is deterministic; live p95 requires provider smoke                 |
| 12  | Mocked | Mongo upsert shape supports dedupe; live unique-index smoke credential-gated |
| 13  | Passed | Timescale failure is captured and does not propagate                         |
| 14  | Passed | Schedule hash deterministic across repeated resolutions                      |

## Live Validation Notes

No browser UI or Computer Control flow applies to FR-AFF-003; this FR is backend ingestion. UI elements interacted with: none.

External Shopee, MongoDB, Timescale, and Redis credentials were not used in this local environment. Per the external dependency protocol, the resolver was validated with deterministic mocks. Existing live handoffs for Shopee (`docs/qa/FR-AFF-001-live-handoff.md`) and Timescale (`docs/qa/FR-PRICE-001-timescale-live-handoff.md`) cover the provider payloads required for a full staging smoke.

Final verified state: mocked resolver resolves live and dead product offers, writes Mongo and Timescale data consistently, caches shop-level fallback rates, honors threshold and explicit flash-sale signals, phase-tags errors, and preserves degraded behavior on Timescale outage.

## Raw Terminal Results

### Initial Affiliate Test Slice Before Fix

```text
$ pnpm --filter @salenoti/api test -- src/affiliate
Test Files  23 passed | 1 skipped (24)
Tests       76 passed | 3 skipped (79)
```

### Targeted FR-AFF-003 Tests After Fix

```text
$ pnpm --filter @salenoti/api test -- src/affiliate
Test Files  24 passed | 1 skipped (25)
Tests       82 passed | 3 skipped (85)
```

### API Typecheck

```text
$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit
```

### API Lint

```text
$ pnpm --filter @salenoti/api lint
$ eslint "src/**/*.ts"
```

### Legal Check

```text
$ pnpm legal:check
$ node scripts/legal-check.mjs
✅ legal-check passed — disclosure surfaces intact, no commission-rate ranking, manifest scope clean
```

### API Unit Tests

```text
$ pnpm --filter @salenoti/api test
Test Files  24 passed | 1 skipped (25)
Tests       82 passed | 3 skipped (85)
```

### API E2E Tests

```text
$ pnpm --filter @salenoti/api test:e2e
Test Files  1 passed (1)
Tests       1 passed (1)
```

### API Build

```text
$ pnpm --filter @salenoti/api build
$ nest build
```

### FR Metadata Check

```text
$ pnpm fr:check
$ node scripts/fr-check.mjs
✅ fr-check passed — all FRs conform to docs/FR_AUTHORING_WORKFLOW.md §11
```

## Decision

FR-AFF-003 is `Completed` for local/mock validation. Live provider smoke remains a manual credential-gated follow-up and does not block completion under the mock/sandbox branch of the execution protocol.
