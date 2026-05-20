# FR-PRICE-001 Audit Report — TimescaleDB Price History

**Date:** 2026-05-18 16:56 ICT  
**Initial state:** `Implemented-Pending-Audit`  
**Final state:** `Completed` via deterministic mock/sandbox validation; live Timescale smoke is credential-gated and documented in `docs/qa/FR-PRICE-001-timescale-live-handoff.md`.

## Audit Findings

The shipped implementation had a basic migration, Timescale singleton, and live integration spec, but it failed the strict FR audit because several required deliverables were missing or incomplete:

- The migration runner wrapped all SQL in one transaction and did not split `-- @SEPARATOR` blocks.
- The SQL lacked `discount_pct` / `stock` checks, `idx_price_history_flash_sale`, `any_flash_sale`, and `price_history_health`.
- The typed client lacked `insertPriceHistoryBatch`, resolution-aware `getHistory`, redacted DB error telemetry, and PostHog pool-saturation metrics.
- Local tests skipped the Timescale-specific proof when `TIMESCALE_DB_URL` was absent and did not provide equivalent mock coverage.

## Fixes Implemented

- Added `apps/api/scripts/migrate-lib.mjs` with separator-aware migration application.
- Updated `apps/api/scripts/migrate.mjs` to execute Timescale blocks independently without `BEGIN`/`COMMIT` wrapping.
- Hardened `20260516000001_price_history.sql` for clean installs.
- Added `20260518000001_price_history_hardening.sql` for environments that already applied the MVP migration.
- Rebuilt `timescale.client.ts` around a production `TimescaleClient` with:
  - single-row idempotent insert,
  - 1000-row capped multi-VALUES batch insert,
  - aggregate-backed `getLast30dMin`, `getHistory`, and `getStats`,
  - raw history guard for ranges over 7 days,
  - pool acquisition saturation metric,
  - redacted Sentry DB contexts.
- Added mocked unit tests for migration splitting/application, batch behavior, raw-range rejection, aggregate path, DB error redaction, and pool saturation metric.
- Updated README, QA traceability, test cases, and live Timescale handoff docs.

## Acceptance Criteria Coverage

| AC  | Result                     | Evidence                                                                                |
| --- | -------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Mock/docs pass; live gated | Hardened migration SQL; `migrate-lib.spec.mjs`; live handoff                            |
| 2   | Mock/docs pass; live gated | Migration SQL uses `create_hypertable(... chunk_time_interval => INTERVAL '7 days')`    |
| 3   | Passed                     | SQL includes composite PK and required product/shop/region/flash-sale indexes           |
| 4   | Mock/docs pass; live gated | SQL continuous aggregate + policy; live refresh requires DB                             |
| 5   | Mock/docs pass; live gated | SQL raw retention 730d and aggregate retention 90d                                      |
| 6   | Passed                     | `timescale.client.spec.ts` covers single insert, batch insert, aggregate history, stats |
| 7   | Passed                     | Client loads `TIMESCALE_DB_URL`; live setup documented                                  |
| 8   | Passed                     | Batch insert uses one multi-VALUES statement and 1000-row cap                           |
| 9   | Passed                     | SQL source check constraint and live spec check                                         |
| 10  | Passed                     | `timescale.client.spec.ts` proves Sentry context excludes parameter values              |
| 11  | Passed                     | Pool config and PostHog saturation metric covered                                       |
| 12  | Passed                     | Separator-aware runner and idempotent SQL/hardening migration                           |
| 13  | Passed                     | Type enforces `Date`; invalid Date rejected before insert/query                         |
| 14  | Passed                     | Compression not added                                                                   |
| 15  | Passed                     | `flash_sale` column and partial index present                                           |
| 16  | Passed                     | Migration runner splits non-transactional Timescale blocks                              |

## Live Validation Notes

No browser UI or Computer Control flow applies to FR-PRICE-001; this FR is backend DB infrastructure. UI elements interacted with: none.

External Timescale/Neon credentials were not available in the local environment. Per the external dependency protocol, DB behavior was validated with deterministic mocks and the live provider checklist/payload was generated in `docs/qa/FR-PRICE-001-timescale-live-handoff.md`.

Final verified state: local tests prove the migration runner executes separator blocks independently, the typed client performs idempotent single/batch writes, broad raw reads are rejected, aggregate reads use `price_history_30min_agg`, and DB OBS telemetry is redacted.

## Raw Terminal Results

### Initial DB Test Slice Before Fix

```text
$ pnpm --filter @salenoti/api test -- src/db
Test Files  21 passed | 1 skipped (22)
Tests       68 passed | 3 skipped (71)
```

### Targeted FR-PRICE-001 Tests After Fix

```text
$ pnpm --filter @salenoti/api test -- src/db scripts/__tests__/migrate-lib.spec.mjs
Test Files  23 passed | 1 skipped (24)
Tests       76 passed | 3 skipped (79)
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

### API Unit Tests

```text
$ pnpm --filter @salenoti/api test
Test Files  23 passed | 1 skipped (24)
Tests       76 passed | 3 skipped (79)
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

FR-PRICE-001 is `Completed` for local/mock validation. Live Timescale provider smoke remains a manual credential-gated follow-up and does not block completion under the mock/sandbox branch of the execution protocol.
