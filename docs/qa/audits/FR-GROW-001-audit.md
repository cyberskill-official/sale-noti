# FR-GROW-001 Audit Report

**FR:** Referral program  
**Audit date:** 2026-05-19  
**State:** shipped + strict-audited  
**Failure count:** 1 resolved coverage issue

## Audit Verdict

Referral validation passes for deterministic refCode/refLink generation, authenticated status endpoint, signup attribution, duplicate no-op, self-referral rejection, same-IP and email-family fraud flags, qualification gating, reward issuance, and subscription bonus-month increment.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Status | Authenticated `/v1/me/referral` | Returns refCode/link/counts |
| Auth | Missing user id | 401 |
| Fraud | Self-referral | Rejects |
| Fraud | Same IPv4 `/24` or IPv6 `/64` | Flags |
| Fraud | Gmail dots/plus aliases | Flags |
| Duplicate | Referred user already has row | No new row |
| Qualification | Fraud flag present | Holds pending |
| Qualification | Email verified + 3 active watchlists | Marks qualified |
| Reward | 3 qualified invites in 90 days | Inserts reward, increments bonus month |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/growth/__tests__/fraud-detect.spec.ts src/growth/__tests__/referral-share.spec.ts
Test Files  2 passed (2)
Tests       12 passed (12)
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/growth/fraud-detect.ts --coverage.include=src/growth/referral.service.ts --coverage.include=src/growth/referral.controller.ts --coverage.reporter=text
fraud-detect.ts        92.59% statements, 92.59% lines
referral.service.ts    93.96% statements, 93.96% lines
referral.controller.ts 100% statements, 100% lines
```

## Live Verification

No external provider is required beyond the application database. Production signup-cookie integration should be re-smoked after auth deployment.

