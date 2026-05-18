# FR-WATCH-002 Audit Report

**FR:** Watchlist alert trigger configuration and pure trigger evaluation  
**Audit date:** 2026-05-18  
**State:** shipped + strict-audited  
**Failure count:** 0

## Audit Verdict

The stale implementation had the closed trigger model and evaluator, but strict review found two contract gaps:

- `flash_sale.minDiscountPct` allowed values below the FR-required 10% floor.
- `absolute_drop.targetPrice` had no 1B VND ceiling.
- PATCH did not emit `watchlist_alert_config_changed` with hashed watchlist ID, trigger kinds, and source.

Those gaps are fixed. The evaluator remains pure and fully local; no external provider blocks this FR, so it is marked `shipped + strict-audited`.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Closed enum | Unknown trigger kind | Zod rejects |
| Duplicate kind | Two `pct_drop` triggers | Rejects `duplicate_trigger_kind` |
| Bounds | `minDropPct` 0 or 91 | Rejects |
| Bounds | `targetPrice` negative or >1B VND | Rejects |
| Bounds | `flash_sale.minDiscountPct` 9 or 91 | Rejects |
| Strict schema | `triggerCooldowns` in PATCH body | Controller/schema rejects |
| Cooldown | Trigger fired within cooldown | Suppressed |
| Cooldown | Trigger fired after cooldown | Fires again |
| Pause | Per-trigger paused | Suppressed |
| Flash sale | Flag missing or discount below threshold | Suppressed |
| Baseline | `pct_drop` last-observed baseline | Evaluates against last observed price |
| Observability | Alert config changed | Emits hashed `watchlistIdHash`, trigger kinds, and source |

## Acceptance Criteria Mapping

| AC | Result | Evidence |
| --- | --- | --- |
| AC1-7, AC16 | Pass | `patch.spec.ts` schema/controller tests and `track.spec.ts` service patch tests |
| AC8-14, AC17-18 | Pass | `trigger-eval.spec.ts` pure evaluator tests |
| AC15 | Pass | `watchlist_alert_config_changed` assertion in service patch test |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/trigger-eval.spec.ts src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/watchlist/__tests__/trigger-eval.spec.ts (9 tests) 2ms
 ✓ src/watchlist/__tests__/patch.spec.ts (5 tests) 6ms
 ✓ src/watchlist/__tests__/track.spec.ts (25 tests) 13ms

 Test Files  3 passed (3)
      Tests  39 passed (39)
   Start at  22:05:30
   Duration  369ms
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/trigger-eval.spec.ts src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts --coverage --coverage.include=src/watchlist/alert-config.zod.ts --coverage.include=src/watchlist/trigger-eval.ts --coverage.include=src/watchlist/watchlist.service.ts --coverage.include=src/watchlist/watchlist-crud.controller.ts --coverage.reporter=text

 Test Files  3 passed (3)
      Tests  39 passed (39)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    93.29 |     100 |     100 |
 ...-config.zod.ts |     100 |      100 |     100 |     100 |
 trigger-eval.ts   |     100 |      100 |     100 |     100 |
 ....controller.ts |     100 |    91.66 |     100 |     100 | 52
 ...ist.service.ts |     100 |    92.51 |     100 |     100 | ...86,374,385-387
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

No browser UI applies directly to this FR. The trigger evaluator is pure and fully unit-tested; PATCH behavior is covered with mocked watchlist service/database context.
