# SaleNoti FR Traceability And Implementation Audit

**Version:** 1.0  
**Date:** 2026-05-18  
**Purpose:** One-by-one P0-P2 FR audit so shipped rows are tied to concrete deliverables and verification.

Status legend:

- `Verified`: automated checks exist and passed in the current hardening pass.
- `Partially verified`: implementation exists; live provider or full-stack DB credential is required for final external smoke.
- `Manual gate`: deliverable is a legal, social, store-review, or operations artifact that requires human review.

---

## 1. P0 Foundation

| FR | Deliverables | Verification | Status |
|---|---|---|---|
| FR-AUTH-001 Google OAuth | `apps/web/src/auth.ts`, `/api/auth/[...nextauth]`, sign-in page | Auth.js integration test, e2e sign-in smoke, exact `next-auth` pin in `apps/web/package.json` | Verified |
| FR-AUTH-002 magic link | Magic-link issue/consume routes, Resend email renderer, rate limiter | Static/type/unit coverage; Resend send requires staging key | Partially verified |
| FR-AUTH-003 JWT session | `apps/web/src/server/auth/session.ts`, refresh rotation, session revoke routes, middleware redirect | `session.spec.ts`, e2e dashboard redirect | Verified |
| FR-LEGAL-001 PDPL | DPIA, DPO appointment, A05 breach template, cross-border assessment, DSR services/controllers | `pnpm legal:check`, document audit, DSR route review | Manual gate |
| FR-LEGAL-002 affiliate disclosure | `apps/web/src/lib/disclosure.ts`, disclosure components, legal affiliate page, extension onboarding copy | Disclosure unit tests, `pnpm legal:check`, extension manifest/content test | Verified |
| FR-OBS-001 observability | API/web Sentry/PostHog wrappers, health endpoints, Slack, Bull Board auth config | Health routes, env docs, staging dashboard smoke required | Partially verified |
| FR-WORKER-001 BullMQ baseline | Queue module, queue constants, Redis client, processors, Bull Board wrapper | `queues.spec.ts`, health endpoint; Bull Board manual auth check required | Verified |
| FR-WORKER-002 adaptive scheduler | Scheduler module, priority engine, backoff policy, Shopee API health | `priority-engine.spec.ts`, `backoff.spec.ts` | Verified |

## 2. P1 MVP Core + Extension

| FR | Deliverables | Verification | Status |
|---|---|---|---|
| FR-AFF-001 Shopee Affiliate client | Signed request helper, client, rate-limit guard, circuit breaker, typed responses | `sign.spec.ts`, `circuit-breaker.spec.ts`; live Shopee smoke needs credentials | Partially verified |
| FR-AFF-002 generateShortLink | Deeplink controller/service, attribution subIds, cache/idempotency, disclosure interstitial hook, commission reconciliation worker | `deeplink.spec.ts`, `commission-reconcile.spec.ts`, disclosure tests; live Shopee short-link smoke needs credentials | Partially verified |
| FR-AFF-003 product/shop offer resolver | Offer resolver, product upsert, price-check processor, Timescale write path | DB/provider staging smoke; Timescale integration test when `TIMESCALE_DB_URL` is set | Partially verified |
| FR-AFF-004 product search | Product search controller/service, Redis cache, sanitization, pagination guards | `product-search.spec.ts` | Verified |
| FR-WATCH-001 product tracking | Track controller/service, Shopee URL parser, watchlist product upsert | `url-parser.spec.ts`; full track API needs Shopee/Mongo/Redis staging smoke | Partially verified |
| FR-WATCH-002 alert triggers | Alert config zod schema, trigger evaluator, PATCH endpoint | `trigger-eval.spec.ts` | Verified |
| FR-WATCH-003 list/pause/delete/free cap | Watchlist CRUD controller/service, plan cap integration | API code review and manual staging smoke required | Partially verified |
| FR-PRICE-001 Timescale hypertable | Timescale client, migration script, integration spec | `timescale.spec.ts` skips without `TIMESCALE_DB_URL`; run with Neon/Timescale URL before release | Partially verified |
| FR-PRICE-002 history API | History controller/service, chart-ready bucket response | API route implementation; staging DB smoke required | Partially verified |
| FR-NOTIF-001 email alerts | Email processor, idempotency, render-alert-email, Resend webhook, suppression | Unit-level render/code review; Resend provider smoke required | Partially verified |
| FR-NOTIF-002 web push | Push processor, web subscribe/unsubscribe/click routes, service-worker-facing APIs | Browser push smoke required with VAPID keys | Partially verified |
| FR-EXT-001 Chrome MV3 | Manifest, content/background/options/popup scripts, icons, disclosure ack | `extension/tests/manifest.spec.ts`; manual Chrome load required | Verified |

## 3. P2 Growth + Monetization

| FR | Deliverables | Verification | Status |
|---|---|---|---|
| FR-BILL-001 freemium billing | Billing module/controller/service, plan constants, webhooks, grace-period cron | `billing.service.spec.ts`; Stripe/VNPay/MoMo staging smoke required | Partially verified |
| FR-NOTIF-003 Telegram bot | Telegram webhook controller, Telegram processor, web link-token route | Provider staging smoke required; content/schedule doc created for social operations | Partially verified |
| FR-GROW-001 referral program | Referral controller/service, web `/r/:refCode`, fraud detection | `fraud-detect.spec.ts` | Verified |
| FR-GROW-002 share deal | Share controller/service, web deal page, share click API, OG metadata | Public page e2e class; API staging smoke and social crawler preview required | Partially verified |
| FR-GROW-003 Mega Sale Mode | Mega Sale API/module, sale window config, web event page/banner, manual social schedule | Browser smoke and `docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md` | Manual gate |
| FR-ADMIN-001 B2B contact | Business page/form, web proxy API, API public/v1 lead controllers, encrypted lead service | `b2b-lead.service.spec.ts`, `b2b-lead.e2e-spec.ts`, browser smoke | Verified |

## 4. Blocked Or Credential-Gated Checks

| Check | Blocker | How to unblock |
|---|---|---|
| Shopee Affiliate live product/short-link/search | `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_APP_SECRET` | Add staging credentials and run provider smoke |
| Timescale migration/integration | `TIMESCALE_DB_URL` | Provide Neon/Timescale URL and run `pnpm test:integration` |
| Resend delivery/webhook | `RESEND_API_KEY`, verified domain, webhook secret if used | Configure staging domain and replay webhook |
| Web Push delivery | VAPID public/private keys and Chrome profile | Configure VAPID keys and run browser smoke |
| Telegram bot | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LINK_SALT`, webhook URL | Configure bot and run `/start` flow |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Use Stripe test mode and CLI/webhook replay |
| VNPay/MoMo | Merchant sandbox credentials | Use test merchant accounts |
| Better Stack/Sentry/PostHog/Slack | DSNs/tokens/webhook URLs | Send redacted test event |

## 5. Audit Notes From Current Pass

- Added explicit Nest `@Inject(B2bLeadService)` to B2B lead controllers after e2e exposed missing dependency metadata in isolated test runtime.
- Added `test:e2e` scripts and Turbo task so e2e verification is a first-class root command.
- Added B2B lead API e2e test to verify `/api/public/b2b-contact` does not remain a scaffold.
- Replaced the commission-reconcile placeholder with a validating reconciliation processor and unit tests for confirmed, updated, and unmatched conversion events.
- Added unit tests for PII envelope encryption/hashing, queue config, scheduler priority, billing checkout metadata, session cookies, and extension policy.
- Added public web e2e smoke to confirm public pages and anonymous dashboard redirect render through a real Next dev server.
- Remaining partial statuses are external-service or live database checks, not missing code paths.
