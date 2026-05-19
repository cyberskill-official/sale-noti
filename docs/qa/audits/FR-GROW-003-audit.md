# FR-GROW-003 Audit Report

**FR:** Mega Sale Mode  
**Audit date:** 2026-05-19  
**State:** shipped + strict-audited for implemented scope  
**Failure count:** 1 resolved coverage issue

## Audit Verdict

Mega Sale Mode passes local validation for event-window detection, current-sale API/controller behavior, hot-tier override during live windows, revert outside windows, 50K watchlist aggregation cap, top-deal query output, homepage banner logic, and scheduler hot-tier cap integration.

The implemented MVP covers the in-app/event-page and scheduler portions. External auto-posting to Zalo/Telegram/X remains a manual marketing/provider gate and is not executed locally.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Calendar | Pre/live/none windows | Deterministic date tests |
| Current API | Live event | Returns sale + stage |
| No DB | Missing `MONGODB_URI` | Cron no-op |
| Live override | Flash-sale watchlists | Updates products to hot tier |
| Bad product id | Aggregate row malformed | Skipped |
| Window ended | Existing overrides | Reverts to mid tier |
| Top deals | Unknown slug | Empty list |
| Top deals | Known slug | Sorted discount/sales, limit 50 |
| Scheduler | Mega-sale surge | Hot enqueue volume capped |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/megasale/__tests__/megasale.spec.ts src/scheduler/__tests__/adaptive-scheduler.spec.ts src/scheduler/__tests__/priority-engine.spec.ts
Test Files  3 passed (3)
Tests       21 passed (21)
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/megasale/megasale.service.ts --coverage.include=src/megasale/megasale.controller.ts --coverage.include=src/megasale/megasale-window.config.ts --coverage.reporter=text
megasale.service.ts        100% statements, 100% lines
megasale.controller.ts     100% statements, 100% lines
megasale-window.config.ts  100% statements, 100% lines
```

## Live Verification

Live Mongo-backed page data needs staging products/watchlists. External auto-posting remains a human/provider gate.

