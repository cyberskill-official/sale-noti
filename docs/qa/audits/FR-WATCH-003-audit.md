# FR-WATCH-003 Audit Report

**FR:** Watchlist list, pause/resume/delete, and free-tier cap enforcement  
**Audit date:** 2026-05-18  
**State:** shipped + strict-audited  
**Failure count:** 1 resolved validation signature mismatch

## Audit Verdict

The stale implementation had the broad CRUD surface, but strict review found contract gaps in list pagination metadata, stable sorting, rate limiting, soft-delete response semantics, and observability privacy.

Those gaps are fixed. The API now returns `total`, clamps oversized page sizes inside the service, sorts by `updatedAt DESC` with `_id` as a stable tie-breaker, exposes soft-delete metadata in list rows, enforces a combined 50/min/user CRUD rate limit, returns HTTP 204 for soft delete, and emits hashed-only pause/resume/delete analytics with source attribution.

No external provider blocks this FR, so it is marked `shipped + strict-audited`.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Null auth | Missing `x-user-id` on list, patch, or delete | 401 `unauthenticated` |
| Status filter | Unknown status query | 400 validation failure |
| Page bounds | Page less than 1 | Service normalizes to page 1 |
| Size bounds | Size greater than 50 | Service clamps to 50 without rejecting |
| Stable ordering | Equal `updatedAt` values | `_id DESC` tie-breaker preserves deterministic pages |
| Ownership | User requests another user's row | 404 `not_found` |
| Free cap | Free user resumes deleted/paused row with 10 active rows | 403 `watchlist_limit_reached` |
| Pro cap | Pro user exceeds 10 active rows | Allowed |
| Soft delete | DELETE request | Sets status `deleted`, writes `deletedAt`, returns 204 |
| Rate limit | More than 50 CRUD calls/min/user | 429 with `Retry-After: 60` |
| Observability | Pause/resume/delete events | Emits hashed `watchlistIdHash` and source only |

## Acceptance Criteria Mapping

| AC | Result | Evidence |
| --- | --- | --- |
| AC1-4 | Pass | `patch.spec.ts` list controller and service list coverage |
| AC5-9 | Pass | `track.spec.ts` pause/resume/delete/free-cap service paths |
| AC10 | Pass | CRUD Redis rate-limit controller test |
| AC11 | Pass | PostHog event assertions use `watchlistIdHash`, never raw IDs |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/watchlist/__tests__/patch.spec.ts (6 tests) 8ms
 ✓ src/watchlist/__tests__/track.spec.ts (25 tests) 20ms

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  22:10:05
   Duration  730ms (transform 127ms, setup 0ms, collect 529ms, tests 28ms, environment 6ms, prepare 181ms)
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts --coverage --coverage.include=src/watchlist/watchlist.service.ts --coverage.include=src/watchlist/watchlist-crud.controller.ts --coverage.reporter=text

 Test Files  2 passed (2)
      Tests  31 passed (31)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    92.07 |     100 |     100 |
 ....controller.ts |     100 |    88.23 |     100 |     100 | 63,76
 ...ist.service.ts |     100 |    92.51 |     100 |     100 | ...88,385,396-398
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

The first broad gate failed at typecheck/build because `patch.spec.ts` still called `WatchlistCrudController.remove` with the old two-argument signature after the source header was added.

Failure vector: TypeScript contract drift in a test call.  
Hypothesis and action: add the missing `sourceHeader` placeholder argument to the auth-guard delete test. The targeted change was `apps/api/src/watchlist/__tests__/patch.spec.ts:112`.

## Live Verification

No browser UI applies directly to this FR. The CRUD contract is covered through mocked Redis, Mongo-style collections, Timescale 30-day-low lookup, and PostHog capture.
