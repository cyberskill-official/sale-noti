# FR-ADMIN-001 Audit Report

**FR:** Public B2B contact form  
**Audit date:** 2026-05-19  
**State:** shipped + mocked-dependency  
**Failure count:** 1 resolved coverage issue

## Audit Verdict

B2B lead capture passes local validation for public API acceptance, PDPL consent enforcement, encrypted/hash-only PII storage, Slack payload redaction, PostHog event shape, hCaptcha gating, confirmation email rendering, and public e2e controller wiring.

Slack, Resend, and hCaptcha are mocked locally; production smoke requires provider credentials.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Consent | Missing PDPL consent | 400 validation failure |
| PII | Email/phone submitted | Raw values absent from stored JSON |
| Encryption | Lead email/phone | AES-256-GCM envelopes |
| Hashing | Email/phone/IP/UA | 64-char hashes |
| Slack | Notification payload | Phone masked, email hash prefix only |
| hCaptcha | Missing/failed token when secret set | `captcha_failed` |
| Confirmation | Resend configured | Sends escaped HTML email |
| Public API | `/api/public/b2b-contact` | e2e accepts valid submission |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/api exec vitest run src/admin/__tests__/b2b-lead.service.spec.ts
Test Files  1 passed (1)
Tests       4 passed (4)
```

```text
$ pnpm --filter @salenoti/api exec vitest run --config vitest.e2e.config.ts src/admin/__tests__/b2b-lead.e2e-spec.ts
Test Files  1 passed (1)
Tests       1 passed (1)
```

```text
$ pnpm --filter @salenoti/api exec vitest run ... --coverage --coverage.include=src/admin/b2b-lead.service.ts --coverage.reporter=text
b2b-lead.service.ts  98.51% statements, 98.51% lines
```

## Live Verification

Requires `SLACK_B2B_WEBHOOK`, `RESEND_API_KEY`, `HCAPTCHA_SECRET`, and production encryption/hash salts for final live provider smoke.

