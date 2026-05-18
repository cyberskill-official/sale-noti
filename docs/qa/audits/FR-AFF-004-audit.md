# FR-AFF-004 Audit Report

**FR:** Product search resolver with Redis cache, PII-safe analytics, and per-tenant rate limits  
**Audit date:** 2026-05-18  
**State:** shipped + mocked-dependency  
**Failure count:** 0

## Audit Verdict

The stale implementation had the product-search service and route, but strict review found contract gaps:

- The controller did not pass authenticated `userIdRaw`, so existing affiliate links could not be enriched over HTTP.
- Anonymous IP context was not passed into the service rate limiter.
- `ProductSearchRateLimitError` was not mapped to HTTP 429 with `Retry-After`.
- Runtime service validation did not reject non-integer pages/sizes or an out-of-contract sort supplied by direct callers.
- Tests mirrored helper logic instead of exercising the real service/controller contract.

The implementation now satisfies the local, mocked contract. Live provider proof remains blocked by Shopee Affiliate credentials plus Redis, MongoDB, and PostHog staging services.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Null/empty input | Blank keyword after trim | HTTP/service rejects `invalid_keyword` |
| Extreme input | Keyword length 201 | Rejects `keyword_too_long` |
| Bounds | `pageSize` > 20 or fractional | Rejects `invalid_pageSize` |
| Bounds | `pageNumber` < 1 or > 50 | Rejects `invalid_pageNumber` |
| Malformed sort | `COMMISSION_DESC` | Rejects `invalid_sort`; grep firewall has zero hits |
| Cache miss/hit | Same keyword/page/size/sort twice | First call hits Shopee and writes 300s Redis TTL; second call returns `cached: true` |
| PII analytics | Email, VN phone, CCCD keywords | PostHog keyword is redacted before capture |
| XSS | `<script>alert(1)</script>OK` product name | Response productName is `OK` |
| Rate limit | Auth user 31st call/minute | Throws/matches HTTP 429 with `Retry-After: 60` |
| Rate limit | Anonymous 11th call/minute/IP `/24` | Throws rate limit before Shopee call |
| Auth context | Production bearer token | Uses signed JWT `sub`; ignores spoofed `X-User-Id` |
| Legacy data | Non-ObjectId user id | Affiliate-link lookup preserves string user id |
| Degraded auth | Malformed/expired/tampered bearer | Request continues anonymous |

## Acceptance Criteria Mapping

| AC | Result | Evidence |
| --- | --- | --- |
| AC1-3 | Pass local mock | `product-search.spec.ts` proves miss, 300s cache set, hit without second Shopee call |
| AC4-5 | Pass local mock | Auth and anonymous Redis buckets tested |
| AC6-8, AC13 | Pass | Service and controller validation tests |
| AC9 | Pass | Default `RELEVANCY` asserted |
| AC10 | Pass | Real `stripHtml` helper and Shopee fixture tested |
| AC11-14 | Pass | Real `scrubKeyword` helper and PostHog capture tested |
| AC15 | Pass | `rg` commission-ranking firewall returned zero hits |
| AC16 | Pass by design | Cache hit path is Redis GET + JSON parse + optional single Mongo affiliate-link query |
| AC17-18 | Pass local mock | Batched `$in` affiliate-link enrichment and no-user null behavior tested |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/affiliate/__tests__/product-search.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/affiliate/__tests__/product-search.spec.ts (13 tests) 8ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  21:49:25
   Duration  513ms
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/affiliate/__tests__/product-search.spec.ts --coverage --coverage.include=src/affiliate/product-search.service.ts --coverage.include=src/affiliate/product-search.controller.ts --coverage.reporter=text

 Test Files  1 passed (1)
      Tests  13 passed (13)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    93.91 |     100 |     100 |
 ....controller.ts |     100 |    96.15 |     100 |     100 | 67,91
 ...rch.service.ts |     100 |    92.06 |     100 |     100 | 113-115,147,183
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

```text
$ rg -n "ORDER BY.*commission|sortBy.*commission|sort.*commissionRate" apps/api/src/affiliate/product-search.service.ts apps/api/src/affiliate/product-search.controller.ts
<no matches>
```

## Live Verification

No browser UI applies to this backend FR. The mocked contract covers Shopee `productSearch`, Redis cache/rate-limit buckets, Mongo `affiliate_links` enrichment, and PostHog capture. Full live verification requires `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_APP_SECRET`, `REDIS_URL`, `MONGODB_URI`, and PostHog staging credentials.
