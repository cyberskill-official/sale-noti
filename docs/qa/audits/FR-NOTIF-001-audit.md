# FR-NOTIF-001 Audit Report

**FR:** Email alert dispatch via Resend  
**Audit date:** 2026-05-18  
**State:** shipped + mocked-dependency  
**External dependency posture:** `RESEND_API_KEY` is missing locally, so live provider delivery is blocked. Resend is isolated behind SDK contract tests and a mocked sender/webhook boundary.
**Failure count:** 2 resolved validation/type issues

## Audit Verdict

The stale implementation had a working alert-dispatch skeleton, but strict review found missing contract safety around idempotency, suppression privacy, webhooks, unsubscribe, and deliverability headers.

Fixed in this pass:

- Email idempotency is salted and 32 hex chars, with durable Mongo unique-index semantics.
- Suppression list keys are `email_hash`, never plaintext email.
- Suppressed users still receive trigger cooldown updates to stop repeat queue churn.
- Daily cap deferrals create notification audit rows and delayed queue jobs for 09:00 Asia/Ho_Chi_Minh.
- Resend email payloads include disclosure, List-Unsubscribe, Postmark-compatible message stream header, trigger/cohort tags, and redacted Sentry context.
- Webhook signatures use Resend `t=<unix>,v1=<hex>` HMAC format, with replay dedup rows.
- One-click unsubscribe validates deterministic tokens for watchlist-level or full email opt-out.
- Notification indexes include `(idem, channel)`, 365-day TTL, resend message lookup, suppression hash, and webhook dedup.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Channel filter | Job lacks email channel | No Resend call |
| Disabled user | `notificationChannels.email=false` | Skips and emits `alert_skipped_channel_disabled` |
| Duplicate job | Mongo duplicate code 11000 | No second send |
| Suppression | `email_hash` exists | Skips send, sets cooldown |
| Daily cap | 20 prior notifications in 24h | Writes deferred audit row and delayed job |
| Missing entities | Missing user/watchlist/product or malformed productId | Safe no-op |
| Resend missing | No API key | Dev stub path logs only email hash |
| Resend error | SDK returns error | Throws for Bull retry and Sentry context has only email hash/link id |
| Webhook bad signature | Invalid/stale/missing `t,v1` | 401, no DB mutation |
| Webhook replay | Existing event id | Duplicate no-op |
| Bounce threshold | Second hard bounce | Adds hashed suppression row |
| Complaint | One complaint | Adds hashed suppression row |
| Unsubscribe | Valid watchlist token | Pulls email from watchlist channels |
| Unsubscribe | Valid all-email token | Sets `users.notificationChannels.email=false` |
| Template | Long product / no image / no min | Table layout, inline styles, truncated subject |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/notify/__tests__/render-alert-email.spec.ts src/notify/__tests__/notify-email.spec.ts src/notify/__tests__/resend-webhook.spec.ts src/notify/__tests__/unsubscribe.spec.ts

 Test Files  4 passed (4)
      Tests  15 passed (15)
   Start at  22:31:11
   Duration  678ms (transform 201ms, setup 0ms, collect 752ms, tests 36ms, environment 0ms, prepare 205ms)
```

```text
$ pnpm --filter @salenoti/api exec vitest run src/notify/__tests__/render-alert-email.spec.ts src/notify/__tests__/notify-email.spec.ts src/notify/__tests__/resend-webhook.spec.ts src/notify/__tests__/unsubscribe.spec.ts --coverage --coverage.include=src/notify/notify-email.processor.ts --coverage.include=src/notify/idempotency.ts --coverage.include=src/notify/suppression.ts --coverage.include=src/notify/render-alert-email.ts --coverage.include=src/notify/resend-webhook.controller.ts --coverage.include=src/notify/unsubscribe.controller.ts --coverage.include=src/notify/notify.module.ts --coverage.reporter=text

 Test Files  4 passed (4)
      Tests  15 passed (15)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    91.71 |     100 |     100 |
 idempotency.ts    |     100 |    92.59 |     100 |     100 | 98,142
 ...l.processor.ts |     100 |    89.47 |     100 |     100 | 39,66,135,154,169
 notify.module.ts  |     100 |      100 |     100 |     100 |
 ...alert-email.ts |     100 |      100 |     100 |     100 |
 ....controller.ts |     100 |    89.58 |     100 |     100 | 18,39,47,86
 suppression.ts    |     100 |      100 |     100 |     100 |
 ....controller.ts |     100 |     92.3 |     100 |     100 | 13
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

1. Failure vector: helper/controller coverage below gate. Hypothesis and action: branch-heavy fallback paths lacked targeted tests; added focused helper, webhook, and template variants.
2. Failure vector: TypeScript integration. Hypothesis and action: strict TS needed non-null mock call handling, HMAC capture narrowing, and Mongo filter casts for legacy string IDs.

## Live Verification

No browser UI applies directly to this backend FR. Live Resend sending and webhook delivery require `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and a verified sender domain. Local contract tests mock Resend send responses, webhook HMAC events, Mongo collections, Timescale min lookup, BullMQ delayed queue add, and PostHog/Sentry capture.
