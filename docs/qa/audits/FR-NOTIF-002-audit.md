# FR-NOTIF-002 Audit Report

**FR:** Web Push via VAPID + service worker  
**Audit date:** 2026-05-19  
**State:** shipped + mocked-dependency  
**Failure count:** 1 resolved coverage/tooling issue

## Audit Verdict

The web-push implementation passes local contract validation for subscription routes, click attribution, service-worker cache headers, VAPID dispatch, stale subscription cleanup, daily-cap deferral, retry behavior, and PII-safe analytics. Live delivery remains gated by real VAPID keys plus a browser profile/device notification prompt.

The audit initially found the push implementation was testable but needed current coverage evidence. Targeted API and web coverage now exceed the per-file 90% statement/line gate for the push worker and web routes.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Permission/auth | Missing user id on subscribe/unsubscribe | 401 |
| Malformed payload | Bad endpoint/key body | 400 |
| Abuse | 6th subscribe call/minute | 429 + `Retry-After: 60` |
| FIFO cap | More than 5 subscriptions | `$push` uses `$slice: -5` |
| Delivery | Multiple endpoints | Sends one payload per endpoint with shared idem/tag |
| Stale endpoint | 410/404 from provider | `$pull` endpoint, disables channel when empty |
| Daily cap | 20 combined notifications/day | Defers without provider send |
| Transient failure | 5xx provider error | Retries, then captures redacted context |
| Privacy | Endpoint leakage | PostHog/Sentry assertions exclude raw endpoint |
| Click attribution | `/api/me/push/clicked` with idem | Sets `clickedAt`, emits idem-tail only |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/notify/__tests__/notify-push.spec.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

```text
$ pnpm --filter @salenoti/web exec vitest run src/app/api/me/push/push-routes.spec.ts
Test Files  1 passed (1)
Tests       4 passed (4)
```

```text
$ pnpm --filter @salenoti/web exec vitest run src/app/api/me/push/push-routes.spec.ts --coverage --coverage.include=src/app/api/me/push/subscribe/route.ts --coverage.include=src/app/api/me/push/unsubscribe/route.ts --coverage.include=src/app/api/me/push/clicked/route.ts --coverage.reporter=text
All files    100% statements, 92.85% branches, 100% funcs, 100% lines
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/notify/notify-push.processor.ts --coverage.reporter=text
src/notify/notify-push.processor.ts  100% statements, 93.33% branches, 100% funcs, 100% lines
```

## Live Verification

No live push was sent locally. Full browser smoke requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, a Chrome/Edge profile with notification permission granted, and a reachable web origin serving `/service-worker.js`.

