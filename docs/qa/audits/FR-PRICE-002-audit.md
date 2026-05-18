# FR-PRICE-002 Audit Report

**FR:** Product price-history chart API  
**Audit date:** 2026-05-18  
**State:** shipped + strict-audited  
**Failure count:** 3 resolved validation/gate issues

## Audit Verdict

The stale implementation exposed the endpoint, cache, auth check, and Timescale read path, but strict review found contract gaps:

- Invalid `productId` returned forbidden instead of 400 `invalid_productId`.
- `91d` style ranges did not return the required `range_too_large` error.
- `granularity=raw` accidentally used the aggregate path instead of Timescale raw history.
- Redis rate limits for authenticated users and anonymous `/24` public-deal readers were missing.
- Cached payloads returned string timestamps while fresh service results returned `Date` values.
- PostHog events omitted `latency_ms`.
- Redis pubsub invalidation was documented but not registered in the Price module, and the offer resolver did not publish after successful Timescale writes.

Those gaps are fixed. No external provider blocks the local contract; live Timescale smoke still requires a staging Timescale/Neon database.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Invalid ID | `abc-xyz` productId | 400 `invalid_productId` |
| Range ceiling | `range=91d` | 400 `range_too_large` |
| Raw bounds | `range=30d&granularity=raw` | 400 `raw_requires_7d` |
| Raw allowed | `range=7d&granularity=raw` | Uses `timescale.getHistory(..., "raw")` |
| Bucketed reads | `30m`, `1h`, `6h`, `1d` | Uses `timescale.getBucketedHistory` aggregate path |
| Auth watchlist | Active or paused watchlist | Allowed |
| Auth public | Product has `publicDealAt` | Anonymous allowed |
| Auth admin | `X-Admin-Token` matches `ADMIN_TOKEN` | Allowed |
| Auth denied | Private product, no watchlist | 403 `forbidden` |
| Rate limit user | 61st authenticated call/min | 429 + `Retry-After: 60` |
| Rate limit anon | 31st anonymous `/24` call/min | 429 + `Retry-After: 60` |
| Cache | Second identical request | Redis hit, `cached: true`, normalized `Date` timestamps |
| Bad cache | Malformed Redis JSON | Deletes bad key and refetches |
| Invalidation | `price_history_invalidate` pubsub | Deletes all history keys for product |
| Empty history | No Timescale rows | 200 with `points: []` |
| Compliance | Response JSON | No `commissionRate` field |

## Acceptance Criteria Mapping

| AC | Result | Evidence |
| --- | --- | --- |
| AC1, AC14, AC15 | Pass | `history.spec.ts` bucketed/empty-history service tests |
| AC2, AC11, AC12 | Pass | Query parser and raw-bound tests |
| AC3, AC4 | Pass | Redis cache hit, bad-cache recovery, pubsub invalidator, offer resolver publisher assertions |
| AC5, AC6 | Pass | Watchlist, public-deal, forbidden private-product tests |
| AC7, AC8 | Pass | PostHog latency/cached assertions; local unit latency path covered |
| AC9, AC10 | Pass | Controller rate-limit tests for user and anonymous `/24` buckets |
| AC13 | Pass | Response JSON grep assertion excludes `commissionRate` |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/price/__tests__/history.spec.ts src/affiliate/__tests__/offer-resolver.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/affiliate/__tests__/offer-resolver.spec.ts (8 tests) 9ms
 ✓ src/price/__tests__/history.spec.ts (10 tests) 10ms

 Test Files  2 passed (2)
      Tests  18 passed (18)
   Start at  22:18:54
   Duration  444ms (transform 91ms, setup 0ms, collect 287ms, tests 19ms, environment 0ms, prepare 93ms)
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/price/__tests__/history.spec.ts src/affiliate/__tests__/offer-resolver.spec.ts --coverage --coverage.include=src/price/history.service.ts --coverage.include=src/price/history.controller.ts --coverage.include=src/price/price.module.ts --coverage.include=src/affiliate/offer-resolver.service.ts --coverage.reporter=text

 Test Files  2 passed (2)
      Tests  18 passed (18)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    95.86 |     100 |     100 |
 affiliate         |     100 |    96.96 |     100 |     100 |
  ...er.service.ts |     100 |    96.96 |     100 |     100 | 62
 price             |     100 |    95.45 |     100 |     100 |
  ...controller.ts |     100 |    97.67 |     100 |     100 | 50
  ...ry.service.ts |     100 |    93.33 |     100 |     100 | 114,119,181
  price.module.ts  |     100 |      100 |     100 |     100 |
-------------------|---------|----------|---------|---------|-------------------
```

```text
$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit
```

```text
$ pnpm --filter @salenoti/api lint
$ eslint "src/**/*.ts"
```

```text
$ pnpm --filter @salenoti/api build
$ nest build
```

## Debugging Record

1. Failure vector: cache serialization logic. Hypothesis and action: Redis JSON turned fresh `Date` timestamps into ISO strings; normalize cached point timestamps in `history.service.ts`.
2. Failure vector: coverage branch gaps. Hypothesis and action: fallback branches in pubsub, optional Shopee offer fields, and null shop offers were untested; add narrow contract tests in `history.spec.ts` and `offer-resolver.spec.ts`.
3. Failure vector: TypeScript test type drift. Hypothesis and action: mocked subscriber handlers are installed at runtime but typed as optional; bind non-null local references in `history.spec.ts`.

## Live Verification

No browser UI applies directly to this backend endpoint. Live p95 and Timescale aggregate freshness require a staging Timescale/Neon database plus Redis. Local contract tests mock Mongo watchlist/product access, Timescale raw/bucketed reads, Redis cache/rate/pubsub, and PostHog capture.
