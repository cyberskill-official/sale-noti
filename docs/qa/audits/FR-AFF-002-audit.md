# FR-AFF-002 Audit Report — Deeplink Attribution

**Date:** 2026-05-18 17:09 ICT  
**Initial state:** `Implemented-Pending-Audit`  
**Final state:** `Completed` via deterministic mock/sandbox validation; live Shopee short-link smoke is credential-gated.

## Audit Findings

The shipped implementation had a basic deeplink service, controller, cache, and sub-id shape tests. The strict audit failed because key production behaviors were missing:

- No productId↔originUrl cross-check.
- No per-user 30 req/min Redis token bucket.
- No `SET NX` concurrency lease for same tuple races.
- `respect_other_publisher` returned the raw URL but did not persist the required audit row or emit `affiliate_link_respected_publisher`.
- PostHog payloads used off-spec names and omitted `latency_ms`, `cached`, and `respect_other_publisher`.
- Cache miss/hit tests did not prove safe telemetry or Shopee-call suppression.

## Fixes Implemented

- Added `DeeplinkRateLimitError` and Redis per-user/minute token bucket.
- Added productId↔originUrl validation after product lookup.
- Added `SET NX` lease with jitter retry for concurrent same-key calls.
- Added respect-other-publisher audit rows with `subIds[4] = "respected"` and event telemetry.
- Added safe analytics helper with `userIdHash`, `productIdHash`, `campaign`, `cached`, `respect_other_publisher`, and `latency_ms`.
- Added `DEEPLINK_SALT` strength validation.
- Updated controller to return 429 with `Retry-After: 60`.
- Replaced the shallow hash-only test with service tests covering generation, cache hits, invalid URLs, respect-publisher, campaign scrub, rate-limit, and lease races.
- Updated README, QA traceability, and test cases.

## Acceptance Criteria Coverage

| AC  | Result   | Evidence                                                                        |
| --- | -------- | ------------------------------------------------------------------------------- |
| 1   | Passed   | `deeplink.spec.ts` verifies Shopee short URL and 5-slot subIds                  |
| 2   | Passed   | Cache hit returns cached URL, suppresses Shopee call, increments cacheHits      |
| 3   | Passed   | Analytics assertions verify hashes/latency and absence of raw URL/userId        |
| 4   | Passed   | Non-Shopee URL rejected                                                         |
| 5   | Passed   | ProductId mismatch rejected                                                     |
| 6   | Existing | Controller still rejects missing auth; full route auth live smoke remains gated |
| 7   | Existing | Disclosure tests and README document hook-gated click flow                      |
| 8   | Passed   | Respect-publisher branch returns origin, no Shopee call, audit row/event        |
| 9   | Passed   | Campaign scrub test                                                             |
| 10  | Passed   | Default campaign path covered by generation/cache tests                         |
| 11  | Passed   | Rate-limit test throws `DeeplinkRateLimitError`; controller maps 429            |
| 12  | Mocked   | Unit paths are deterministic; live p95 requires provider smoke                  |
| 13  | Passed   | `SET NX` loser reads cache and avoids second Shopee call                        |
| 14  | Passed   | `pnpm legal:check` no commission ranking                                        |

## Live Validation Notes

No browser UI or Computer Control flow applies directly to FR-AFF-002; it is a backend attribution API. UI elements interacted with: none.

External Shopee, MongoDB, and Redis credentials were not used in this local environment. Per the external dependency protocol, behavior was validated with deterministic mocks. The Shopee live smoke payload is documented in `docs/qa/FR-AFF-001-live-handoff.md`.

Final verified state: mocked deeplink generation validates origin URLs, builds privacy-safe subIds, caches short links, respects existing publishers, rate-limits users, absorbs concurrency races, and emits safe analytics.

## Raw Terminal Results

### Initial Deeplink Test Slice Before Fix

```text
$ pnpm --filter @salenoti/api test -- src/affiliate/__tests__/deeplink.spec.ts
Test Files  24 passed | 1 skipped (25)
Tests       82 passed | 3 skipped (85)
```

### Targeted FR-AFF-002 Tests After Fix

```text
$ pnpm --filter @salenoti/api test -- src/affiliate/__tests__/deeplink.spec.ts
Test Files  24 passed | 1 skipped (25)
Tests       83 passed | 3 skipped (86)
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
Tests       83 passed | 3 skipped (86)
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
✅ fr-check passed — all FRs conform to feature-request-audit skill §11
```

## Decision

FR-AFF-002 is `Completed` for local/mock validation. Live provider smoke remains a manual credential-gated follow-up and does not block completion under the mock/sandbox branch of the execution protocol.
