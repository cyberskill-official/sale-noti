# SaleNoti QA Test Plan

**Version:** 1.0  
**Date:** 2026-05-18  
**Scope:** P0-P2 shipped FRs

---

## 1. Objectives

This plan makes sure SaleNoti is tested as a product, not as disconnected scaffolding:

1. Every P0-P2 FR has concrete deliverables and at least one verification path.
2. Security, PDPL, disclosure, and affiliate ethics checks are first-class release gates.
3. Unit tests cover deterministic domain logic and dangerous edge cases.
4. End-to-end tests cover public web/API flows that users or Chrome reviewers see.
5. Live browser smoke validates the rendered app, redirects, and forms.
6. External-provider checks are either run with staging credentials or explicitly marked blocked with required secrets.

## 2. Test Pyramid

| Layer | Owner | Command or method | When to run |
|---|---|---|---|
| FR/static policy | Engineering | `pnpm fr:check`, `pnpm legal:check` | Every PR |
| Type system | Engineering | `pnpm typecheck` | Every PR |
| Lint | Engineering | `pnpm lint` | Every PR |
| Unit | Engineering | `pnpm test` | Every PR |
| E2E smoke | Engineering | `pnpm test:e2e` | Every PR touching runtime behavior |
| Production build | Engineering | `pnpm build` | Before merge/release |
| Browser smoke | Engineering/QA | In-app browser or Chrome | Before release candidate |
| Provider staging | Engineering/Ops | Credential-backed smoke scripts/manual checklist | Before production launch |
| Legal/compliance review | Founder + counsel | Document review and disclosure snapshots | Before collecting user data |

## 3. Environments

| Environment | Purpose | Required services |
|---|---|---|
| Local default | Fast deterministic development | Node 24, pnpm 11, local env; mocks/stubs acceptable |
| Local full-stack | Integration debugging | MongoDB, Redis, TimescaleDB, test API keys |
| Staging | Provider verification | Shopee Affiliate sandbox/live test, Resend test domain, Telegram bot, Stripe test, VNPay/MoMo test merchant |
| Production | Real users | Managed services with alerts and runbooks |

## 4. Required Commands

Run from repository root:

```bash
pnpm fr:check
pnpm legal:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Optional integration:

```bash
TIMESCALE_DB_URL=postgres://... pnpm test:integration
```

## 5. Current Automated Coverage

| Package | Tests |
|---|---|
| `apps/api` | Shopee signing/circuit breaker, deeplink, product search, URL parsing, trigger evaluation, Timescale integration, backoff, priority engine, queues, commission reconciliation, encryption envelope, B2B lead service/e2e, billing |
| `apps/web` | Disclosure copy/interstitial, session token/cookie behavior, public page e2e smoke, Google Auth.js config integration |
| `extension` | Manifest V3 policy, host permissions, icons, disclosure, no cart/coupon auto behavior |

## 6. Definition Of Done Per FR

An FR is done only when all applicable rows are complete:

- FR markdown status is `shipped`.
- Deliverable exists in code or compliance docs.
- Acceptance criteria have a test, static check, browser check, or documented provider/manual check.
- No known legal/ethics regression.
- No plaintext PII introduced.
- `pnpm typecheck` and relevant tests pass.
- If the FR touches UI, browser smoke validates the rendered state.
- If the FR touches a social platform, manual content and posting schedule are prepared.

## 7. Bug Severity

| Severity | Meaning | Examples |
|---|---|---|
| P0 blocker | Cannot release | Undisclosed affiliate link, plaintext PII, auth bypass, Chrome policy violation |
| P1 high | Release only with explicit waiver | Broken checkout, lost alerts, provider webhook not verified |
| P2 medium | Fix before broad rollout | UI issue on secondary page, missing telemetry, retry delay wrong |
| P3 low | Backlog acceptable | Copy polish, non-critical dashboard metric |

## 8. External Provider Smoke Checklist

These cannot be fully verified without credentials and vendor accounts:

- Shopee Affiliate: signed GraphQL request, short-link generation, productOfferV2, shopOfferV2, productSearch, rate-limit behavior.
- Resend: domain-verified email send, bounce/complaint webhook.
- Web Push: Chrome subscription, alert delivery, click telemetry, revoked subscription cleanup.
- Telegram: setWebhook, `/start <token>` link, outbound alert with inline button.
- Stripe: checkout session, completed/failed webhook, cancellation, grace period.
- VNPay/MoMo: redirect URL signing, return/webhook signature validation, failed payment.
- Better Stack/Sentry/PostHog/Slack: event redaction and routing.

## 9. Live Browser Smoke Checklist

| Flow | Expected result |
|---|---|
| `/` | Landing renders without console fatal error; disclosure surface visible |
| `/auth/sign-in` | Google button targets Auth.js endpoint; email form is visible |
| `/dashboard` anonymous | Redirects to `/auth/sign-in` |
| `/business` | Form renders, requires PDPL consent, submits to local API/web route when configured |
| `/privacy` | Privacy policy renders |
| `/legal/affiliate` | Affiliate disclosure and revenue explanation render |
| `/transparency` | Transparency index renders |
| `/megasale/2026-11-11` | Event page renders without layout break; missing local DB shows collecting-deals fallback |

## 10. Regression Risk Areas

- Auth.js beta changes: keep exact pin and run Auth.js integration test.
- Next.js edge/runtime split: protected middleware must not import Node-only auth code.
- PII handling: B2B leads and auth/session audit must stay encrypted/hash-only.
- Affiliate ethics: no commission ranking, hidden affiliate injection, or auto-coupon features.
- Queue config: Redis TLS parsing and price-check rate limiter must stay stable.
- Provider-webhook lifecycle: client redirects cannot mark durable payment/delivery success.
