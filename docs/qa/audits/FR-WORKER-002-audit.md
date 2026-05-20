# FR-WORKER-002 Audit Report

**FR:** Adaptive scheduler, hot/mid/low tiers under Shopee API rate limit  
**Audit date:** 2026-05-18  
**State:** shipped + mocked-dependency  
**Failure count:** 0

## Audit Verdict

Initial audit failed because the shipped implementation had meaningful gaps:

- Missing `apps/api/src/scheduler/__tests__/adaptive-scheduler.spec.ts`.
- Missing `apps/api/src/scheduler/admin-overrides.ts` and a runnable force-tier command path.
- `scheduler_tier_health` did not include `succeeded`, `failed`, or `current_depth`.
- Price-check jobs used the shared 3-attempt queue default, so the 5-consecutive-failure cooldown path could not be reached from scheduler-enqueued jobs.

The local implementation now satisfies the mocked/unit-testable FR contract:

- Scheduler evenly spreads hot/mid/low products across 30m/6h/24h cadence windows.
- Scheduler halves enqueue volume when the Shopee health window exceeds 5 percent errors.
- Scheduler skips products that are still in cooldown.
- Price-check jobs are enqueued with 5 attempts and exponential 30s backoff with 25 percent jitter; the shared helper now clamps the final retry delay to 30 minutes.
- Repeated Shopee `429`/`5xx` failures downgrade the product to `low`, set 24h cooldown, and emit warning-level Sentry evidence.
- Admin override is implemented via `forceTierOverride` and `pnpm salenoti-cli scheduler force-tier <productId> <tier>`.
- Root README documents scheduler tuning and manual override flow.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Null/local dependency | `MONGODB_URI` absent | Scheduler no-ops before queue or Mongo mutation |
| Empty data | No watchlists or no products | Tier resolves to `low`; scheduler emits zero scheduled jobs |
| Extreme bounds | 100K hot products during surge | Hot enqueue is capped to the FR-GROW-003 50K budget |
| Malformed payload | Invalid admin tier value | Override rejects before data mutation |
| Legacy IDs | Composite ID, ObjectId, and local product ID | `productFilterFromId` maps all three shapes |
| Redis/window health | Missing Redis samples | Health returns zero error rate |
| Redis/window health | Current and previous 5-minute buckets | Counts are summed; non-throttleable 4xx does not inflate retryable error count |
| Queue degradation | BullMQ count call rejects or omits fields | Metrics normalize to zero/default queue depth |
| API retry bounds | Large retry attempt with positive jitter | Final backoff never exceeds 30 minutes |
| Priority drift | Cooldown, paused lists, stale user activity, mega sale, recent alert | Tier engine returns `low`, `mid`, or `hot` per contract |

## Acceptance Criteria Mapping

| AC   | Result                         | Evidence                                                                     |
| ---- | ------------------------------ | ---------------------------------------------------------------------------- |
| AC1  | Pass local mock                | `adaptive-scheduler.spec.ts` enqueues 4 hot, 3 mid, 7 low                    |
| AC2  | Pass by deterministic modulo   | `_scheduleHash mod 30` cohorting in scheduler                                |
| AC3  | Pass by deterministic modulo   | `_scheduleHash mod 360` cohorting in scheduler                               |
| AC4  | Pass by deterministic modulo   | `_scheduleHash mod 1440` cohorting in scheduler                              |
| AC5  | Pass local mock                | `errorRate5m = 0.06` produces 8 jobs instead of 14                           |
| AC6  | Pass code and job options      | `PRICE_CHECK_JOB_OPTIONS.attempts = 5`; live provider proof remains blocked  |
| AC7  | Pass local mock                | `priority-engine.spec.ts` covers flash-sale, paused, active, stale, override |
| AC8  | Pass local guard; live blocked | `admin-overrides.spec.ts`; CLI requires `MONGODB_URI`                        |
| AC9  | Pass local mock; live blocked  | event includes `scheduled`, `succeeded`, `failed`, `current_depth`           |
| AC10 | Pass                           | `backoff.spec.ts`; queue job options carry 30s exponential jitter with 30m helper cap |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/scheduler/__tests__/adaptive-scheduler.spec.ts src/scheduler/__tests__/priority-engine.spec.ts src/scheduler/__tests__/backoff.spec.ts src/scheduler/__tests__/admin-overrides.spec.ts src/scheduler/__tests__/shopee-api-health.spec.ts src/affiliate/shopee/__tests__/client.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/scheduler/__tests__/backoff.spec.ts (4 tests) 2ms
 ✓ src/scheduler/__tests__/shopee-api-health.spec.ts (3 tests) 12ms
 ✓ src/scheduler/__tests__/admin-overrides.spec.ts (4 tests) 8ms
 ✓ src/scheduler/__tests__/priority-engine.spec.ts (10 tests) 70ms
 ✓ src/affiliate/shopee/__tests__/client.spec.ts (5 tests) 13ms
 ✓ src/scheduler/__tests__/adaptive-scheduler.spec.ts (7 tests) 189ms

 Test Files  6 passed (6)
      Tests  33 passed (33)
   Start at  21:40:45
   Duration  515ms
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/scheduler/__tests__/adaptive-scheduler.spec.ts src/scheduler/__tests__/priority-engine.spec.ts src/scheduler/__tests__/backoff.spec.ts src/scheduler/__tests__/admin-overrides.spec.ts src/scheduler/__tests__/shopee-api-health.spec.ts --coverage --coverage.include=src/scheduler/adaptive-scheduler.service.ts --coverage.include=src/scheduler/priority-engine.ts --coverage.include=src/scheduler/backoff-policy.ts --coverage.include=src/scheduler/admin-overrides.ts --coverage.include=src/scheduler/shopee-api-health.ts --coverage.reporter=text

 Test Files  5 passed (5)
      Tests  28 passed (28)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    95.23 |     100 |     100 |
 ...ler.service.ts |     100 |    94.73 |     100 |     100 | 44
 ...n-overrides.ts |     100 |    86.66 |     100 |     100 | 28,30
 backoff-policy.ts |     100 |      100 |     100 |     100 |
 ...rity-engine.ts |     100 |    97.36 |     100 |     100 | 34
 ...-api-health.ts |     100 |      100 |     100 |     100 |
-------------------|---------|----------|---------|---------|-------------------
```

```text
$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit
```

```text
$ pnpm --filter @salenoti/api build
$ nest build
```

```text
$ pnpm --filter @salenoti/api lint
$ eslint "src/**/*.ts"
```

```text
$ pnpm fr:check
$ node scripts/fr-check.mjs
✅ fr-check passed — all FRs conform to feature-request-audit skill §11
```

```text
$ node scripts/salenoti-cli.mjs scheduler force-tier 123-456 hot
MONGODB_URI is required.
```

## Live Verification

No browser UI applies to this FR. The local CLI guard was executed and ended in the expected final state: the command refused to mutate data without `MONGODB_URI`.

Full live validation is blocked until the project has a connected MongoDB, Redis/BullMQ, Shopee API credential set, and observability projects. The exact handoff is in `docs/qa/FR-WORKER-002-live-handoff.md`.
