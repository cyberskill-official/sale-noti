# FR-BILL-001 Audit Report

**FR:** Freemium billing with Stripe, VNPay, and MoMo  
**Audit date:** 2026-05-19  
**State:** shipped + mocked-dependency  
**Failure count:** 1 resolved coverage issue

## Audit Verdict

Billing now has local coverage for hosted checkout creation, dev-stub fallback when gateway credentials are absent, webhook-only state mutation, gateway signature checks, cancel-at-period-end behavior, idempotent payment success processing, payment-failed grace state, hourly grace cron, and `/v1/billing/me` response shape.

Live money movement remains external-provider gated. The local contract intentionally avoids in-app card collection and keeps the implementation in SAQ-A style hosted checkout posture.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Validation | Invalid plan/user/existing subscription | Rejects before checkout |
| Hosted checkout | Stripe credentials present | Creates metadata-bearing Checkout Session |
| Hosted checkout | VNPay/MoMo credentials present | Returns signed provider redirect URL |
| Dev mode | Gateway credentials absent | Returns deterministic `dev_stub` URL |
| Webhook auth | Stripe/VNPay/MoMo bad signature | 401/no mutation |
| Webhook state | Payment success | Upserts subscription, sets `users.plan` |
| Idempotency | Duplicate event id | Redis NX prevents second mutation |
| Failure state | Payment failed | Sets `past_due` and `graceExpiresAt` |
| Grace cron | Warn/downgrade windows | Emits telemetry, downgrades to free |
| API | `/subscribe`, `/cancel`, `/me` | Auth, validation, and response mapping covered |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/billing/__tests__/billing.service.spec.ts
Test Files  1 passed (1)
Tests       7 passed (7)
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/billing/billing.service.ts --coverage.include=src/billing/billing.controller.ts --coverage.include=src/billing/webhook.controller.ts --coverage.include=src/billing/plan.ts --coverage.include=src/billing/grace-period-cron.ts --coverage.reporter=text
billing.service.ts      100% statements, 100% lines
billing.controller.ts   98.27% statements, 98.27% lines
webhook.controller.ts   95.41% statements, 95.41% lines
grace-period-cron.ts    100% statements, 100% lines
plan.ts                 100% statements, 100% lines
```

## Live Verification

Provider smoke requires Stripe test keys/webhook secret, VNPay sandbox credentials, and MoMo sandbox credentials. No live charge/refund was attempted locally.

