# FR-WATCH-001 Audit Report

**FR:** `POST /v1/products/track` Shopee URL tracking flow  
**Audit date:** 2026-05-18  
**State:** shipped + mocked-dependency  
**Failure count:** 0

## Audit Verdict

The stale implementation parsed one URL shape and created basic watchlist rows, but strict review found gaps in the MVP happy path:

- Auth used trusted `X-User-Id` only and did not return the required sign-in soft funnel.
- Rate limits, idempotency, deleted-row reactivation, and duplicate response metadata were incomplete.
- Legacy/mall/deeplink Shopee URL shapes were not accepted.
- Free-tier cap response missed `currentCount` and `availableAt`.
- Nickname sanitization, source coercion, hashed PostHog user ID, and one-paint response fields were incomplete.
- The shared watchlist service lacked coverage for the list/patch/delete paths that live in the same file.

The local implementation now satisfies the mocked contract. Live proof remains blocked by external Auth/Shopee/Redis/Mongo/Timescale/PostHog staging services.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| URL parsing | Canonical, `www`, legacy `/product`, mall, deeplink query | Extracts `shopId` and `itemId` |
| URL rejection | `http`, non-Shopee, deprecated `shopee.com.vn`, oversize, zero IDs | Returns `invalid_shopee_url` / parser null |
| Auth | No bearer/local user | 401 `UNAUTHENTICATED` with `Location` and encoded `seedUrl` |
| Auth | Signed production bearer | Uses JWT `sub`, ignores spoofed `X-User-Id` |
| Rate limit | User >20/min or IP >5/min | Throws/maps `RATE_LIMIT_TRACK` with `Retry-After` |
| Free tier | 10 active watchlists | 403 body includes limit, current count, upgrade URL, and oldest active timestamp |
| Pro tier | 1000 active watchlists | No cap |
| Resolver | Affiliate catalog returns null | 404 `product_not_available` |
| Duplicate | Active row exists | 409 `already_tracking` with existing ID/status/createdAt |
| Reactivation | Paused/deleted row exists | Updates status to active without a new row |
| Idempotency | Same `Idempotency-Key` within 60s | Returns cached body and avoids second resolver call |
| XSS | Nickname contains `<`, `>`, or backtick | 422 `invalid_nickname` |
| Alert config | Default, string-trigger, object-trigger, lowest30d, flashSale | Normalized to closed trigger schema and priority |
| Observability | `product_tracked` | Emits hashed user ID, product ID, source, nickname flag, trigger count, and count-after |
| Shared service | list/patch/delete methods | Covered for enrichment, Timescale degradation, cap guard, pause/resume/delete events |

## Acceptance Criteria Mapping

| AC | Result | Evidence |
| --- | --- | --- |
| AC1 | Pass local mock | Creates product/watchlist flow, default config, mid priority, one-paint response |
| AC2-3 | Pass | URL parser rejects non-Shopee and strips tracking params before ID extraction |
| AC4 | Pass | Resolver null maps to 404 |
| AC5-6 | Pass | Free cap and Pro no-cap tests |
| AC7-8 | Pass | Default config and flash-sale hot priority tests |
| AC9-10 | Pass | Active duplicate and deleted/paused reactivation tests |
| AC11 | Pass | Dual Redis rate-limit tests |
| AC12-13 | Pass | Source header allowed/coerced tests |
| AC14 | Pass | Redis idempotency cache test |
| AC15 | Pass | Controller soft-funnel unauth test |
| AC16 | Pass | Nickname sanitizer test |
| AC17 | Pass by design | Resolver/cache mocks keep local path under milliseconds; live latency depends on Shopee |
| AC18 | Pass by dependency | Resolver exceptions are passed through; FR-AFF-001 owns breaker mapping |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/url-parser.spec.ts src/watchlist/__tests__/track.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/watchlist/__tests__/url-parser.spec.ts (6 tests) 2ms
 ✓ src/watchlist/__tests__/track.spec.ts (25 tests) 14ms

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  22:01:02
   Duration  373ms
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/url-parser.spec.ts src/watchlist/__tests__/track.spec.ts --coverage --coverage.include=src/watchlist/url-parser.ts --coverage.include=src/watchlist/watchlist.service.ts --coverage.include=src/watchlist/watchlist-track.controller.ts --coverage.reporter=text

 Test Files  2 passed (2)
      Tests  31 passed (31)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    91.42 |     100 |     100 |
 url-parser.ts     |     100 |    96.15 |     100 |     100 | 35
 ....controller.ts |     100 |    92.68 |     100 |     100 | 72,84,88
 ...ist.service.ts |     100 |     90.2 |     100 |     100 | ...84,402,409,429
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

## Live Verification

No browser UI applies directly to this backend endpoint. Contract tests mock Shopee offer resolution, Redis rate/idempotency/cache, Mongo watchlist/product/user collections, Timescale 30-day-low lookup, and PostHog capture. Full live verification requires valid Auth JWTs plus Shopee Affiliate, Redis, MongoDB, TimescaleDB, and PostHog staging credentials.
