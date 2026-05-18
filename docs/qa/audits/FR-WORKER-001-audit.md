# FR-WORKER-001 Audit Report — BullMQ + Redis Baseline

**Audit time:** 2026-05-18 16:05 ICT  
**Manifest result:** `shipped + mocked-dependency`  
**Reason:** local queue configuration, lifecycle, event bridge, auth gate, health contract, coverage, typecheck, lint, and build pass; live BullMQ/Bull Board/queue health requires Upstash Redis and Bull Board credentials.

## Deliverable Audit

| Requirement | Result | Evidence |
|---|---|---|
| BullMQ/Nest dependencies | Pass | `apps/api/package.json` |
| Upstash `rediss://` parsing with BullMQ-safe options | Pass | `queues.spec.ts` |
| Four core queues | Pass | `apps/api/src/queue/queues.ts` |
| Default retry/backoff/retention | Pass | `queues.spec.ts` |
| Bull Board guarded by basic auth | Pass local code | `apps/api/src/admin/bull-board.controller.ts`; live proof blocked by Redis credentials |
| QueueEvents to Sentry/PostHog | Pass after fix | `queue.event-bridge.ts` with shutdown close |
| Worker concurrency | Pass | `QUEUE_CONCURRENCY` and processor decorators |
| Better Stack heartbeats | Pass after fix | `heartbeat.scheduler.ts` and test |
| Graceful QueueEvents shutdown | Pass after fix | `onApplicationShutdown` closes QueueEvents |
| `/health/queue` | Pass local code | Live `redis: true` blocked by missing Upstash URL |

## 2026-05-18 Supplemental Strict Pass

Additional fixes:

- Queue event bridge now handles `completed`, `progress`, `failed`, and `stalled`.
- Final failed events now tag Sentry with `{ queue, jobId, jobName, attempt, fr: "FR-WORKER-001" }`.
- Intermediate failed events emit PostHog but do not page Sentry.
- Bull Board auth has contract coverage for missing-credential `503` disablement and configured basic-auth mounting.
- `/health/queue` contract coverage now includes no Redis, queue depth, failed count, handle close, and missing BullMQ count fields.

### Edge-Case Matrix

| Vector | Case | Expected result | Evidence |
| --- | --- | --- | --- |
| Redis URL TLS | `rediss://` Upstash URL | TLS enabled, port `6380`, BullMQ-safe retry options | `queues.spec.ts` |
| Redis URL plain local | `redis://localhost` | port `6379`, no TLS/password | `queues.spec.ts` |
| Shopee limiter default | `SHOPEE_RATE_LIMIT_PER_MIN` absent | price-check limiter `1000/min` | `queues.spec.ts` |
| Shopee limiter override | Env set to `17` | price-check limiter `17/min` | `queues.spec.ts` |
| Completed/progress events | BullMQ emits success/progress | Sentry breadcrumb + PostHog event | `queue.event-bridge.spec.ts` |
| Intermediate failure | failed event with `prev: "active"` | PostHog failure only, no Sentry page | `queue.event-bridge.spec.ts` |
| Final failure | failed event after retry chain | Sentry error with queue/job/attempt tags | `queue.event-bridge.spec.ts` |
| Missing failure metadata | no `jobName` / attempt in event payload | defaults `jobName:"unknown"`, `attempt:3` | `queue.event-bridge.spec.ts` |
| Stalled job | stalled event | Sentry warning + PostHog stalled event | `queue.event-bridge.spec.ts` |
| Shutdown | Nest application shutdown | all `QueueEvents.close()` promises awaited | `queue.event-bridge.spec.ts` |
| Bull Board missing creds | `BULL_BOARD_USER/PASS` absent | route mounted as `503` disabled | `bull-board.controller.spec.ts` |
| Queue health no Redis | no `REDIS_URL` | `{ redis:false, queues:{} }` | `health.controller.spec.ts` |
| Queue health sparse counts | BullMQ omits count fields | depth/failed default `0` | `health.controller.spec.ts` |

### Supplemental Raw Terminal Evidence

```text
$ pnpm --filter @salenoti/api exec vitest run src/queue/__tests__/queues.spec.ts src/queue/__tests__/heartbeat.scheduler.spec.ts src/queue/__tests__/queue.event-bridge.spec.ts src/admin/__tests__/bull-board.controller.spec.ts src/health/__tests__/health.controller.spec.ts --coverage --coverage.include=src/queue/queues.ts --coverage.include=src/queue/heartbeat.scheduler.ts --coverage.include=src/queue/queue.event-bridge.ts --coverage.include=src/admin/bull-board.controller.ts --coverage.include=src/health/health.controller.ts --coverage.reporter=text

 Test Files  5 passed (5)
      Tests  17 passed (17)
All files | 100 | 98.48 | 100 | 100
```

```text
$ pnpm --filter @salenoti/api test -- src/queue/__tests__/queues.spec.ts src/queue/__tests__/heartbeat.scheduler.spec.ts src/queue/__tests__/queue.event-bridge.spec.ts src/admin/__tests__/bull-board.controller.spec.ts src/health/__tests__/health.controller.spec.ts
 Test Files  31 passed | 1 skipped (32)
      Tests  113 passed | 3 skipped (116)

$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit

$ pnpm --filter @salenoti/api lint
$ eslint "src/**/*.ts"

$ pnpm --filter @salenoti/api build
$ nest build
```

## Raw Terminal Evidence

```text
$ pnpm --filter @salenoti/api test
$ vitest run

 RUN  v2.1.9 /Users/stephencheng/Projects/CyberSkill/sale-noti/apps/api

 ✓ src/queue/__tests__/queues.spec.ts (3 tests) 3ms
 ✓ src/queue/__tests__/commission-reconcile.spec.ts (3 tests) 4ms
 ✓ src/queue/__tests__/heartbeat.scheduler.spec.ts (1 test) 2ms

 Test Files  16 passed | 1 skipped (17)
      Tests  55 passed | 3 skipped (58)
   Start at  16:04:54
   Duration  689ms (transform 539ms, setup 0ms, collect 2.11s, tests 339ms, environment 2ms, prepare 854ms)

$ pnpm --filter @salenoti/api typecheck
$ tsc --noEmit
```

## External Handoff

Use `docs/qa/FR-WORKER-001-redis-handoff.md` for the exact Redis/Bull Board/heartbeat payload needed to move this FR to `Completed`.
