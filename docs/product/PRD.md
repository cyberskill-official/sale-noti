# SaleNoti Product Requirements Document

**Version:** 1.0  
**Date:** 2026-05-18  
**Owner:** Stephen Cheng, CyberSkill JSC  
**Source plan:** `docs/SaleNoti — Plan.pdf`  
**Scope:** P0-P2 shipped surface plus P3-P4 roadmap boundaries from `docs/feature-requests/BACKLOG.md`.

---

## 1. Product Summary

SaleNoti is a Vietnamese Shopee price-tracking and sale-notification platform. Users paste a Shopee product URL or click the Chrome extension's "+ Theo dõi giá" button, configure alert triggers, and receive email, web push, or Telegram alerts when the product reaches the target price. Affiliate links are only generated after user intent and must always be disclosed.

The MVP is intentionally trust-first: no cart scraping, no hidden affiliate-link injection, no commission-first ranking, no auto coupon behavior, and no collection of unnecessary personal data.

## 2. Product Goals

| Goal | Target | FR coverage |
|---|---:|---|
| Ship compliant foundation | PDPL DPIA, DPO appointment, privacy/cross-border docs, breach template | FR-LEGAL-001 |
| Enable trustworthy authentication | Google OAuth, email magic link, short-lived JWT + refresh cookie | FR-AUTH-001..003 |
| Track Shopee prices reliably | URL parser, Affiliate API resolver, Mongo product/watchlist rows, Timescale price history | FR-AFF-001..004, FR-WATCH-001, FR-PRICE-001 |
| Notify users when price criteria match | Alert trigger config, Resend email, web push, Telegram | FR-WATCH-002, FR-NOTIF-001..003 |
| Keep affiliate monetization ethical | Disclosure-first UI, user-initiated deeplinks, transparency surfaces | FR-LEGAL-002, FR-AFF-002, FR-EXT-001, FR-GROW-002 |
| Monetize without blocking free value | Free tier, Pro/Pro+ checkout via Stripe/VNPay/MoMo | FR-BILL-001 |
| Grow through social sharing and sale events | Referral rewards, share deal pages, Mega Sale Mode | FR-GROW-001..003 |
| Capture B2B price-intelligence demand | Public seller/brand lead form with PDPL consent | FR-ADMIN-001 |

## 3. Users And Personas

| Persona | Need | Primary flows |
|---|---|---|
| Deal hunter | Save time and avoid missing flash-sale drops | Track product, set target, receive alert, click disclosed deeplink |
| Rational buyer | Know whether today's price is actually low | View 30-day history, use lowest_30d trigger |
| Extension user | Track directly from Shopee product pages | Install MV3 extension, acknowledge disclosure, click "+ Theo dõi giá" |
| Seller/brand operator | Understand competitor pricing movements | Submit B2B contact form, request price-intelligence dashboard |
| Founder/operator | Monitor uptime, queue health, legal compliance, growth funnel | Bull Board, Sentry/PostHog/Better Stack, transparency reports |

## 4. In Scope

- Web app: public landing, auth pages, dashboard gate, privacy/legal/transparency pages, business lead page, share deal page, Mega Sale page.
- API app: NestJS modules for affiliate, watchlist, price, notifications, billing, growth, legal DSR, admin lead capture, health and queue monitoring.
- Chrome extension: Manifest V3, `shopee.vn` product-page track button, onboarding/options/popup, no broad host permissions.
- Data stores: MongoDB Atlas for core entities, TimescaleDB for price history, Redis for queue/rate/idempotency/cache.
- Notifications: email, web push, Telegram.
- Billing: Stripe primary, VNPay and MoMo VN redirect rails.
- Compliance: PDPL artifacts, disclosure enforcement, breach template, DSR export/delete endpoints.

## 5. Out Of Scope For P0-P2

- Lazada, TikTok Shop, AccessTrade fallback, mobile native app, B2B dashboard UI, regional localization, ML deal scoring, price prediction, sponsored deals, and data licensing API.
- Fully live Shopee/VNPay/MoMo/Telegram/Resend production calls in local CI unless credentials are supplied.
- iOS web push as a primary channel; email remains fallback.

## 6. Functional Requirements

### 6.1 Authentication

- Users can sign in with Google OAuth through Auth.js `5.0.0-beta.25`, pinned exactly.
- Users can request a Resend email magic link with a 15-minute one-time token.
- Sessions use a 15-minute access token and a 30-day refresh token in HTTP-only cookies.
- Refresh-token reuse revokes the session family.
- Protected web routes redirect anonymous users to `/auth/sign-in`.

### 6.2 Compliance And Disclosure

- The repository maintains PDPL DPIA, DPO appointment, cross-border transfer assessment, privacy policies, and A05 breach notification template.
- Every affiliate-tagged surface includes disclosure copy or forces a pre-click interstitial.
- Affiliate links are never generated without user action.
- Commission rate must not be used as ranking input for consumer-facing product search/deal presentation.
- B2B lead PII is encrypted and hashed, never stored as plaintext email/phone.

### 6.3 Affiliate And Product Resolution

- Shopee Affiliate Open API calls are GraphQL POST requests with SHA256 signatures.
- The API client is rate-limit aware, has retry/backoff behavior, and captures provider failures to observability.
- Product and shop offer resolvers ingest commission and product metadata into MongoDB and TimescaleDB.
- Deeplinks carry user/watchlist/source/campaign attribution through Shopee subIds.
- Product search is cached and strips HTML from seller-controlled text.

### 6.4 Watchlist And Price History

- Users can track a product by Shopee URL.
- Users can configure `absolute_drop`, `pct_drop`, `lowest_30d`, and `flash_sale` triggers.
- Users can list, pause, resume, and delete watchlist rows.
- Free plan is capped at 10 tracked products.
- Price history is persisted to TimescaleDB and exposed as chart-ready downsampled time-series data.

### 6.5 Queue And Scheduler

- BullMQ queues exist for price checks, alert dispatch, commission reconcile, and housekeeping.
- Redis supports TLS `rediss://` connections.
- Scheduler classifies products as `hot`, `mid`, or `low` with 30-minute, 6-hour, and 24-hour cadences.
- Mega Sale windows can boost hot-tier scheduling, bounded by the FR-defined cap.

### 6.6 Notifications

- Email alerts use Resend and include idempotency, deduplication, disclosure, and delivery audit logs.
- Web push uses VAPID, service-worker subscription, unsubscribe, click telemetry, expired subscription cleanup, and no auto-prompt on page load.
- Telegram supports `/start <userId>` linking, webhook validation, alert dispatch with inline button, and shared idempotency rules.

### 6.7 Billing

- Plans: Free, Pro 39K VND/month, Pro+ 89K VND/month.
- Stripe checkout is primary and uses metadata-driven webhook lifecycle.
- VNPay and MoMo redirect flows are supported for VN payment rails.
- Subscription state changes are accepted from signed webhooks, not client redirects.
- Grace period and cancellation lifecycle jobs run server-side.

### 6.8 Growth

- Referral program grants one Pro month after three qualified invites, guarded by fraud detection.
- Share deal flow creates user-tagged affiliate deeplinks and landing pages with OpenGraph metadata.
- Mega Sale Mode exposes event-themed sale windows, leaderboard primitives, and notification timing.
- Social auto-posting remains manually gated for first events; prepared copy and schedules live in `docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md`.

### 6.9 B2B Lead Capture

- Public business page captures company, contact, Shopee store URL, monthly order band, use case, and PDPL consent.
- API validates consent and stores encrypted/hash-only PII.
- Slack/PostHog notifications redact PII.
- Users receive confirmation where email credentials are configured.

## 7. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Security | HTTP-only cookies, short access TTL, encrypted PII, no secret logging, webhook signatures, rate limits |
| Privacy | Data minimization, DSR export/delete, PDPL docs, cross-border disclosure, retention windows |
| Compliance | Chrome Affiliate Ads Policy, Shopee Affiliate ToS, no cart API scrape, disclosure-first pattern |
| Reliability | Queue retry/backoff, idempotent alert sends, provider circuit breaker, health endpoints |
| Performance | Product resolve p95 target < 800 ms with healthy provider, search cache hit < 50 ms, API cache miss < 900 ms |
| Operability | Sentry, PostHog, Better Stack, Slack alerting, Bull Board, queue health endpoint |
| Scalability | Redis global rate budgets, scheduler priority buckets, Timescale continuous aggregates |
| Accessibility | Public pages and forms must remain keyboard reachable and readable on mobile and desktop |

## 8. Success Metrics

| Phase | Metric |
|---|---|
| P1 MVP | 1,000 signups, 10,000 products tracked, 5,000 alerts sent, alert CTR >= 25%, D7 retention >= 25%, extension installs >= 300 |
| P2 Growth | MAU >= 10,000, DAU/MAU >= 20%, average tracked products/user >= 8, D30 retention >= 35%, free-to-Pro >= 5%, MRR >= 30M VND |
| Compliance | Zero undisclosed affiliate surfaces, zero plaintext PII regressions, zero Chrome Web Store policy violations |

## 9. Release Gates

Before marking a P0-P2 release as production-ready:

1. `pnpm fr:check`
2. `pnpm legal:check`
3. `pnpm typecheck`
4. `pnpm lint`
5. `pnpm test`
6. `pnpm test:e2e`
7. `pnpm build`
8. Browser live smoke on landing, business lead, privacy/legal, sign-in, dashboard redirect.
9. Extension manifest review for MV3, `shopee.vn` host scope, icons, disclosure, and no cart/coupon behavior.
10. Credential-backed provider smoke in staging for Shopee, Resend, Telegram, Stripe, VNPay, MoMo where accounts are available.

## 10. Dependencies And Risks

| Risk | Mitigation |
|---|---|
| Shopee API changes or rejects calls | Client wrapper, circuit breaker, rate-limit guard, P3 AccessTrade fallback |
| Chrome Web Store rejection | Strict MV3 scope, no `<all_urls>`, disclosure-first, no auto coupon/link injection |
| PDPL violation | DPIA/DPO artifacts, encrypted PII, DSR endpoints, retention docs |
| Affiliate trust backlash | Transparency pages, disclosure tests, no commission-rate ranking |
| Provider credentials unavailable locally | Stub-safe dev behavior plus staging-only live smoke checklist |
| Queue/Redis outage | Health endpoint, BullMQ retry/backoff, Better Stack/Sentry alerts |

## 11. Roadmap Boundary

P0-P2 are the shipped product baseline. P3 and P4 remain roadmap rows until P2 success metrics trigger re-batching:

- P3: Lazada, TikTok Shop, mobile app, B2B dashboard, AccessTrade fallback, tenant-aware observability.
- P4: regional localization, ML deal scoring, smart wishlist, price prediction, sponsored deals, data licensing.
