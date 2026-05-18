# SaleNoti

**Turn Shopee price drops into deals you actually catch.**  
Vietnamese price-tracking + sale-notification platform for Shopee VN, built as a Next.js web app, NestJS API/worker fleet, and Chrome Manifest V3 extension.

Founder: Stephen Cheng (Trịnh Thái Anh) · CyberSkill JSC · DUNS 673219568

---

## 1. Current Status

P0-P2 are implemented and marked shipped in the FR backlog:

- P0: auth, PDPL/legal, observability, queues, adaptive scheduler.
- P1: Shopee Affiliate integration, watchlists, price history, alerts, Chrome extension.
- P2: billing, Telegram, referrals, share deals, Mega Sale Mode, B2B contact form.

P3/P4 are roadmap only: Lazada/TikTok, mobile app, B2B dashboard, regional SEA, AI deal scoring, price prediction.

## 2. Important Docs

| Need                        | File                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Product requirements        | [`docs/product/PRD.md`](docs/product/PRD.md)                                                     |
| Software requirements       | [`docs/product/SRS.md`](docs/product/SRS.md)                                                     |
| QA strategy                 | [`docs/qa/TEST_PLAN.md`](docs/qa/TEST_PLAN.md)                                                   |
| Test cases                  | [`docs/qa/TEST_CASES.md`](docs/qa/TEST_CASES.md)                                                 |
| FR implementation audit     | [`docs/qa/FR_TRACEABILITY.md`](docs/qa/FR_TRACEABILITY.md)                                       |
| Manual social copy/schedule | [`docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md`](docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md) |
| Active backlog              | [`docs/feature-requests/BACKLOG.md`](docs/feature-requests/BACKLOG.md)                           |
| Legal docs                  | [`docs/legal/`](docs/legal/)                                                                     |
| Original plan               | [`docs/SaleNoti — Plan.pdf`](docs/SaleNoti%20—%20Plan.pdf)                                       |

## 3. Architecture

```text
sale-noti/
├── apps/
│   ├── web/          Next.js 15 + React 19 web app
│   └── api/          NestJS 10 API, queues, workers, schedulers
├── extension/        Chrome MV3 extension for shopee.vn product pages
├── docs/             PRD, SRS, QA, legal, FR backlog/audits
├── scripts/          FR/legal policy checks
├── package.json      pnpm + Turbo root
├── turbo.json        pipeline tasks
└── .env.example      environment variable shape
```

Core services:

- MongoDB Atlas for users, products, watchlists, links, notifications, billing, referrals, leads.
- TimescaleDB/Neon Postgres for price history.
- Upstash Redis for BullMQ, cache, idempotency, and rate limits.
- Shopee Affiliate Open API for product/offer/short-link data.
- Resend, Web Push, and Telegram for alerts.
- Stripe, VNPay, and MoMo for payments.
- Sentry, PostHog, Better Stack, and Slack for operations.

## 4. Prerequisites

Use the versions pinned by the repo:

```bash
nvm use
corepack enable
corepack prepare pnpm@11.1.2 --activate
node --version
pnpm --version
```

Expected:

- Node `24.12.0` from `.nvmrc` or any Node `>=24.0.0`.
- pnpm `>=11.0.0`.

Install dependencies:

```bash
pnpm install
```

If pnpm asks for build-script approvals, review the packages and approve only expected native/tooling packages:

```bash
pnpm approve-builds
```

## 5. Environment Setup

Copy the env shape:

```bash
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
```

For production-like local dev, use Doppler:

```bash
doppler setup
doppler run -- pnpm dev
```

Google OAuth live sign-in requires a real Google Cloud OAuth client. Use
`docs/qa/FR-AUTH-001-google-oauth-handoff.md` for the exact redirect URI, consent-screen, and Doppler payload;
deterministic CI/local tests use sandbox values and in-memory mocks where external credentials are unavailable.

Minimum local values for deterministic builds/tests:

```bash
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
AUTH_SECRET=<32+ chars>
DATA_ENCRYPTION_KEY=<32-byte hex>
PII_HASH_SALT=<random hex>
DEEPLINK_SALT=<random hex>
REFERRAL_SALT=<random hex>
ADMIN_TOKEN=<random hex>
```

Full-stack local development also needs:

```bash
MONGODB_URI=mongodb://...
TIMESCALE_DB_URL=postgres://...
REDIS_URL=rediss://...
SHOPEE_AFFILIATE_APP_ID=...
SHOPEE_AFFILIATE_APP_SECRET=...
RESEND_API_KEY=...
RESEND_WEBHOOK_SECRET=...
EMAIL_IDEM_SALT=<random hex>
EMAIL_HASH_SALT=<random hex>
UNSUB_SALT=<random hex>
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_LINK_SALT=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
VNPAY_TMN_CODE=...
VNPAY_HASH_SECRET=...
MOMO_PARTNER_CODE=...
MOMO_ACCESS_KEY=...
MOMO_SECRET_KEY=...
```

## 6. Run Locally

Run every app in parallel:

```bash
pnpm dev
```

Run a single app:

```bash
pnpm --filter @salenoti/web dev
pnpm --filter @salenoti/api dev
pnpm --filter @salenoti/extension dev
```

Default local URLs:

| Surface      | URL                                                                          |
| ------------ | ---------------------------------------------------------------------------- |
| Web          | `http://localhost:3000`                                                      |
| API health   | `http://localhost:4000/health`                                               |
| Queue health | `http://localhost:4000/health/queue`                                         |
| Bull Board   | `http://localhost:4000/admin/queues` when API and credentials are configured |

Build the extension and load it in Chrome:

```bash
pnpm --filter @salenoti/extension build
```

Then open Chrome:

1. Go to `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select `extension/dist`.
5. Visit a Shopee VN product URL and confirm the "+ Theo dõi giá" button and disclosure flow.

## 7. Database And Queue Setup

MongoDB:

- Create an Atlas cluster in Singapore where possible.
- Use the database name `salenoti`.
- Keep indexes aligned with the service queries for users, products, watchlists, affiliate links, notifications, referrals, and leads.

TimescaleDB:

```bash
TIMESCALE_DB_URL=postgres://... node apps/api/scripts/migrate.mjs
```

The migration runner applies every SQL file in `apps/api/migrations/` in order and splits Timescale-sensitive blocks on
`-- @SEPARATOR`, so `CREATE EXTENSION`, `create_hypertable`, continuous aggregate policy, and retention policy statements can be safely retried after partial deploys.

Then run integration checks:

```bash
TIMESCALE_DB_URL=postgres://... pnpm test:integration
```

Redis:

- Use Upstash with TLS.
- Prefer `rediss://...:6380`.
- `apps/api/src/queue/queues.ts` parses TLS and queue options.
- The adaptive scheduler uses `SHOPEE_RATE_LIMIT_PER_MIN` for the BullMQ worker limiter and enqueues `price-check` jobs with 5 attempts plus 30s exponential backoff, 25% jitter, and a final 30-minute cap.
- Scheduler health uses rolling Redis 5-minute Shopee API buckets; retryable `429`, `5xx`, and timeout errors above 5% halve the next enqueue volume.

Scheduler admin override:

```bash
MONGODB_URI=mongodb://... pnpm salenoti-cli scheduler force-tier 123456-987654 hot --reason "mega-sale validation"
```

This sets `trackPriority`, writes a `priorityOverride` that expires after 24h by default, and clears any active `cooldownUntil`.

## 8. Verification And Audit

Run the full local gate from the repository root:

```bash
pnpm fr:check
pnpm legal:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

What these prove:

| Command            | Proves                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm fr:check`    | FR metadata, audit pairing, manifest sync, BCP-14 shape                                     |
| `pnpm legal:check` | Disclosure drift, Chrome manifest scope, no commission-rate ranking                         |
| `pnpm typecheck`   | Strict TypeScript across web, API, extension                                                |
| `pnpm lint`        | ESLint policy and code quality                                                              |
| `pnpm test`        | Unit coverage for auth, encryption, queues, scheduler, affiliate, billing, leads, extension |
| `pnpm test:e2e`    | Public web smoke, B2B public API flow, extension manifest e2e                               |
| `pnpm build`       | Production bundles                                                                          |

Credential-gated checks:

- FR-OBS-001 live Sentry/PostHog/Better Stack dashboards require provider DSNs/API keys and manual monitor setup.
  Local validation uses contract tests for Sentry init/redaction, PostHog hashing/opt-out/no-op behavior, API/web PII
  redaction, and health JSON shapes. Focused coverage gates:
  `pnpm --filter @salenoti/api exec vitest run src/obs/__tests__/pii-redactor.spec.ts src/obs/__tests__/posthog.spec.ts src/obs/__tests__/sentry.spec.ts src/health/__tests__/health.controller.spec.ts --coverage --coverage.include=src/obs/pii-redactor.ts --coverage.include=src/obs/posthog.ts --coverage.include=src/obs/sentry.ts --coverage.include=src/health/health.controller.ts --coverage.reporter=text`
  and
  `pnpm --filter @salenoti/web exec vitest run src/server/obs/__tests__/pii-redactor.spec.ts --coverage --coverage.include=src/server/obs/pii-redactor.ts --coverage.reporter=text`.
- FR-WORKER-001 live BullMQ round-trip, Bull Board UI, queue health with `redis:true`, and Better Stack heartbeat green
  status require Upstash Redis plus Bull Board credentials. Local validation uses BullMQ/Bull Board contract mocks for queue
  metadata, event bridging, heartbeat scheduling, auth gating, and `/health/queue`. Focused coverage gate:
  `pnpm --filter @salenoti/api exec vitest run src/queue/__tests__/queues.spec.ts src/queue/__tests__/heartbeat.scheduler.spec.ts src/queue/__tests__/queue.event-bridge.spec.ts src/admin/__tests__/bull-board.controller.spec.ts src/health/__tests__/health.controller.spec.ts --coverage --coverage.include=src/queue/queues.ts --coverage.include=src/queue/heartbeat.scheduler.ts --coverage.include=src/queue/queue.event-bridge.ts --coverage.include=src/admin/bull-board.controller.ts --coverage.include=src/health/health.controller.ts --coverage.reporter=text`.
- FR-AUTH-001 Google OAuth live consent requires real Google credentials. Local coverage uses contract tests around
  `handleGoogleSignIn`, including the expected Google OIDC profile shape, issuer/audience checks, open-redirect
  protection, Sentry breadcrumbs, and PostHog `auth_sign_in` events. Focused coverage gate:
  `pnpm --filter @salenoti/web exec vitest run src/auth.spec.ts src/server/auth/__tests__/google-sign-in.spec.ts --coverage --coverage.include=src/auth.ts --coverage.include=src/server/auth/google-sign-in.ts --coverage.reporter=text`.
- FR-AUTH-002 magic-link delivery requires a real Resend key and verified sending domain for live inbox delivery. Local
  validation uses a mock Resend sender plus contract tests for the issue/consume HTTP shape, token hashing, single-use
  consume, rate limits, disclosure body, and magic-link observability. Focused coverage gate:
  `pnpm --filter @salenoti/web exec vitest run tests/integration/auth.magic-link.spec.ts --config vitest.integration.config.ts --coverage --coverage.include=src/server/auth/magic-link/issue.ts --coverage.include=src/server/auth/magic-link/consume.ts --coverage.include=src/app/api/auth/magic-link/issue/route.ts --coverage.include=src/app/api/auth/magic-link/consume/route.ts --coverage.reporter=text`.
- FR-AUTH-003 session rotation is verified with Mongo-compatible contract tests plus live unauthenticated/CORS endpoint
  checks. Focused coverage gate for refresh ownership, transaction retry, reuse detection, hash-only storage, and
  revocation:
  `pnpm --filter @salenoti/web exec vitest run tests/integration/auth.refresh.spec.ts --config vitest.integration.config.ts --coverage --coverage.include=src/server/auth/refresh.ts '--coverage.include=src/app/api/auth/sessions/[familyId]/route.ts' --coverage.reporter=text`.
- FR-LEGAL-001 has a physical A05/counsel acknowledgement dependency. The repo ships a contract-tested submission
  packet at `docs/legal/A05-submission-packet.md`; the real receipt remains expected at
  `docs/legal/A05-receipt-DPIA-2026-05.pdf`. Focused coverage gates:
  `pnpm --filter @salenoti/api exec vitest run src/legal/__tests__/a05-filing-contract.spec.ts src/legal/__tests__/encryption-envelope.spec.ts src/legal/__tests__/dsr.spec.ts --coverage --coverage.include=src/legal/dsr-export.service.ts --coverage.include=src/legal/dsr-delete.service.ts --coverage.include=src/legal/encryption-envelope.ts --coverage.reporter=text`
  and
  `pnpm --filter @salenoti/web exec vitest run src/server/legal/__tests__/breach-detector.spec.ts --coverage --coverage.include=src/server/legal/breach-detector.ts --coverage.reporter=text`.
- FR-LEGAL-002 disclosure surfaces are verified by static legal policy checks, extension MV3 contract tests, browser
  checks for `/auth/sign-in`, `/legal/affiliate`, and `/transparency`, and focused coverage for disclosure components,
  consent storage, the acknowledgement route, and the deal-page affiliate CTA gate. Focused coverage gate:
  `pnpm --filter @salenoti/web exec vitest run src/components/disclosure/__tests__/disclosure.spec.tsx src/server/legal/__tests__/disclosure-consent.spec.ts src/app/api/auth/disclosure-ack/route.spec.ts 'src/app/deal/[slug]/DealAffiliateActions.spec.tsx' --coverage --coverage.include=src/components/disclosure/AffiliateDisclosureCard.tsx --coverage.include=src/components/disclosure/OnboardingDisclosureStep.tsx --coverage.include=src/components/disclosure/PreClickInterstitial.tsx --coverage.include=src/lib/disclosure.ts --coverage.include=src/server/legal/disclosure-consent.ts --coverage.include=src/app/api/auth/disclosure-ack/route.ts '--coverage.include=src/app/deal/**/DealAffiliateActions.tsx' --coverage.reporter=text`.
- `TIMESCALE_DB_URL` is required for Timescale integration tests.
- FR-PRICE-001 Timescale behavior is covered locally by mocked unit tests:
  `pnpm --filter @salenoti/api test -- src/db scripts/__tests__/migrate-lib.spec.mjs`.
  Live hypertable/retention/continuous-aggregate verification requires a Neon or Timescale database with the Timescale extension enabled; use
  [`docs/qa/FR-PRICE-001-timescale-live-handoff.md`](docs/qa/FR-PRICE-001-timescale-live-handoff.md).
- FR-PRICE-002 price-history chart behavior is covered locally by:
  `pnpm --filter @salenoti/api exec vitest run src/price/__tests__/history.spec.ts src/affiliate/__tests__/offer-resolver.spec.ts`.
  Its focused coverage gate is:
  `pnpm --filter @salenoti/api exec vitest run src/price/__tests__/history.spec.ts src/affiliate/__tests__/offer-resolver.spec.ts --coverage --coverage.include=src/price/history.service.ts --coverage.include=src/price/history.controller.ts --coverage.include=src/price/price.module.ts --coverage.include=src/affiliate/offer-resolver.service.ts --coverage.reporter=text`.
  Ops-only history access uses `X-Admin-Token: $ADMIN_TOKEN`; normal dashboard access still requires a watchlist or public-deal product.
- Shopee, Resend, Telegram, Stripe, VNPay, MoMo, Sentry, PostHog, Better Stack, and Slack need staging credentials for live provider smoke.
- Shopee Affiliate client behavior is covered locally by mocked unit tests:
  `pnpm --filter @salenoti/api test -- src/affiliate/shopee/__tests__/client.spec.ts src/affiliate/shopee/__tests__/rate-limit-guard.spec.ts`.
  Live Shopee smoke requires `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_APP_SECRET`, `REDIS_URL`, and a known VN `shopId/itemId`; use the handoff template in
  [`docs/qa/FR-AFF-001-live-handoff.md`](docs/qa/FR-AFF-001-live-handoff.md).
- Product/shop offer resolver behavior is covered locally by:
  `pnpm --filter @salenoti/api test -- src/affiliate/__tests__/offer-resolver.spec.ts`.
  Live resolver smoke requires both Shopee Affiliate credentials and Timescale/Mongo/Redis staging services.
- Deeplink attribution behavior is covered locally by:
  `pnpm --filter @salenoti/api test -- src/affiliate/__tests__/deeplink.spec.ts`.
  Live short-link smoke requires Shopee Affiliate credentials plus Redis/Mongo staging services.
- Product search behavior is covered locally by:
  `pnpm --filter @salenoti/api exec vitest run src/affiliate/__tests__/product-search.spec.ts`.
  Its focused coverage gate is:
  `pnpm --filter @salenoti/api exec vitest run src/affiliate/__tests__/product-search.spec.ts --coverage --coverage.include=src/affiliate/product-search.service.ts --coverage.include=src/affiliate/product-search.controller.ts --coverage.reporter=text`.
  Live search smoke requires Shopee Affiliate credentials plus Redis, MongoDB, and PostHog staging services.
- Product tracking behavior is covered locally by:
  `pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/url-parser.spec.ts src/watchlist/__tests__/track.spec.ts`.
  Its focused coverage gate is:
  `pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/url-parser.spec.ts src/watchlist/__tests__/track.spec.ts --coverage --coverage.include=src/watchlist/url-parser.ts --coverage.include=src/watchlist/watchlist.service.ts --coverage.include=src/watchlist/watchlist-track.controller.ts --coverage.reporter=text`.
  Live track smoke requires Auth JWTs, Shopee Affiliate credentials, Redis, MongoDB, TimescaleDB, and PostHog staging services.
- Watchlist trigger configuration is covered locally by:
  `pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/trigger-eval.spec.ts src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts`.
  Its focused coverage gate is:
  `pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/trigger-eval.spec.ts src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts --coverage --coverage.include=src/watchlist/alert-config.zod.ts --coverage.include=src/watchlist/trigger-eval.ts --coverage.include=src/watchlist/watchlist.service.ts --coverage.include=src/watchlist/watchlist-crud.controller.ts --coverage.reporter=text`.
- Watchlist CRUD list/pause/resume/delete behavior is covered locally by:
  `pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts`.
  Its focused coverage gate is:
  `pnpm --filter @salenoti/api exec vitest run src/watchlist/__tests__/patch.spec.ts src/watchlist/__tests__/track.spec.ts --coverage --coverage.include=src/watchlist/watchlist.service.ts --coverage.include=src/watchlist/watchlist-crud.controller.ts --coverage.reporter=text`.
- Email alert dispatch behavior is covered locally by:
  `pnpm --filter @salenoti/api exec vitest run src/notify/__tests__/render-alert-email.spec.ts src/notify/__tests__/notify-email.spec.ts src/notify/__tests__/resend-webhook.spec.ts src/notify/__tests__/unsubscribe.spec.ts`.
  Its focused coverage gate is:
  `pnpm --filter @salenoti/api exec vitest run src/notify/__tests__/render-alert-email.spec.ts src/notify/__tests__/notify-email.spec.ts src/notify/__tests__/resend-webhook.spec.ts src/notify/__tests__/unsubscribe.spec.ts --coverage --coverage.include=src/notify/notify-email.processor.ts --coverage.include=src/notify/idempotency.ts --coverage.include=src/notify/suppression.ts --coverage.include=src/notify/render-alert-email.ts --coverage.include=src/notify/resend-webhook.controller.ts --coverage.include=src/notify/unsubscribe.controller.ts --coverage.include=src/notify/notify.module.ts --coverage.reporter=text`.
  Live email delivery requires `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, verified DNS, and the email salts above.
- See [`docs/qa/TEST_CASES.md`](docs/qa/TEST_CASES.md) for the full sign-off template.

## 9. Feature Audit Workflow

When implementing or reviewing an FR:

1. Open [`docs/feature-requests/BACKLOG.md`](docs/feature-requests/BACKLOG.md).
2. Open the specific FR markdown and audit file.
3. Confirm deliverables in [`docs/qa/FR_TRACEABILITY.md`](docs/qa/FR_TRACEABILITY.md).
4. Run the smallest relevant unit/e2e test first.
5. Run the full verification gate before calling the FR complete.
6. Update backlog/status docs only after verification.
7. If blocked by credentials/vendor review, document the blocker and move to the next unblocked FR.

## 10. Security, Privacy, And Affiliate Ethics

Do not merge code that violates these rules:

- No hidden affiliate-link injection.
- No auto-apply coupon behavior.
- No cart/private Shopee API scraping.
- No `<all_urls>` extension permission.
- No consumer-facing ranking by commission rate.
- No plaintext storage of restricted PII.
- No provider webhook state transition without signature/secret verification.
- No affiliate surface without disclosure or pre-click interstitial.

Legal/compliance docs:

- [`docs/legal/DPIA-2026-05.md`](docs/legal/DPIA-2026-05.md)
- [`docs/legal/DPO-appointment.md`](docs/legal/DPO-appointment.md)
- [`docs/legal/A05-breach-notification-template.md`](docs/legal/A05-breach-notification-template.md)
- [`docs/legal/cross-border-transfer-impact-assessment.md`](docs/legal/cross-border-transfer-impact-assessment.md)

## 11. Tuning Guide

Scheduler:

- Hot products: 30-minute cadence.
- Mid products: 6-hour cadence.
- Low products: 24-hour cadence.
- Manual priority override: `pnpm salenoti-cli scheduler force-tier <productId> <hot|mid|low> [--hours n]`.
- Repeated Shopee `429`/`5xx` failures cool the product down to `low` for 24h after 5 attempts and emit a warning-level Sentry event.
- Mega Sale hot-tier boosts must stay capped as specified in FR-GROW-003.
- Tune in `apps/api/src/scheduler/priority-engine.ts`, `apps/api/src/scheduler/backoff-policy.ts`, and `apps/api/src/megasale/megasale-window.config.ts`.

Queues:

- Queue names and concurrency live in `apps/api/src/queue/queues.ts`.
- Lower `price-check` concurrency before increasing Shopee call volume.
- Watch 429/error rates before raising scheduler throughput.

Rate limits and cache:

- Shopee global budget defaults to `SHOPEE_RATE_LIMIT_PER_MIN=1000`.
- Shopee client HTTP attempts acquire the Redis token bucket before every network call and retry retryable `429`/`5xx` responses at most 3 times with the shared 30s exponential backoff, ±25% jitter policy, and 30-minute final delay cap.
- Timescale batch writes cap at 1000 observations per statement. Raw history reads are capped to 7 days; longer ranges must use `30min`, `6h`, or `24h` aggregate resolution.
- Product search cache is intentionally short for sale freshness.
- Deeplink cache is 24h to protect Shopee API quota.

Notifications:

- Combined daily alert caps should remain conservative until complaint/bounce rates are known.
- Web push is Chrome/Edge/Android first; iOS non-PWA users fall back to email.
- Telegram should be high-signal during Mega Sale windows.

Billing:

- Free plan cap is 10 products.
- Pro and Pro+ pricing lives in `apps/api/src/billing/plan.ts`.
- Subscription activation must remain webhook-driven.

Observability:

- Use PostHog for funnel tuning, Sentry for exceptions, Better Stack for uptime, Slack for ops alerts.
- Redact PII before events leave the app.

## 12. Deployment Strategy

Recommended environments:

| Surface     | Provider                  | Notes                                                     |
| ----------- | ------------------------- | --------------------------------------------------------- |
| Web         | Vercel                    | Next.js 15, `APP_URL`, Sentry web DSN, PostHog public key |
| API/workers | Railway or Fly.io         | Nest API, BullMQ workers, `API_URL`, provider secrets     |
| MongoDB     | Atlas SG                  | Main operational store                                    |
| TimescaleDB | Neon Postgres + Timescale | Price history                                             |
| Redis       | Upstash SG                | BullMQ/cache/rate/idempotency                             |
| Extension   | Chrome Web Store          | MV3 package from `extension/dist`                         |

Pre-deploy:

```bash
pnpm fr:check
pnpm legal:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Deploy web:

1. Create Vercel project rooted at `apps/web`.
2. Set build command `pnpm --filter @salenoti/web build`.
3. Set output framework to Next.js.
4. Configure `APP_URL`, API URL, auth, email, push, PostHog, and Sentry env vars.
5. Add custom domain and verify HTTPS.

Deploy API/workers:

1. Create service rooted at `apps/api`.
2. Build with `pnpm --filter @salenoti/api build`.
3. Start with `pnpm --filter @salenoti/api start`.
4. Configure Mongo, Redis, Timescale, Shopee, notification, billing, and observability secrets.
5. Expose `/health` and `/health/queue` to Better Stack.
6. Protect Bull Board with `BULL_BOARD_USER` and `BULL_BOARD_PASS`.

Deploy extension:

1. Run `pnpm --filter @salenoti/extension build`.
2. Confirm `extension/tests/manifest.spec.ts` passes.
3. Zip `extension/dist`.
4. Submit to Chrome Web Store with disclosure copy from FR-LEGAL-002.
5. After publish, set `EXT_ID` in web/API env.

Rollback:

- Web: Vercel instant rollback to previous deployment.
- API: redeploy previous image/build; pause queues if bad worker behavior is suspected.
- Extension: Chrome Web Store emergency publish; disable risky server endpoint if review delay blocks package rollback.
- Billing/notifications: pause webhooks only with an incident note because state can drift.

## 13. Known Local Limitations

- Provider live checks require real staging credentials and may be blocked in local-only environments.
- Timescale tests skip automatically without `TIMESCALE_DB_URL`.
- Dev-safe fallback URLs such as `dev_stub=stripe` exist only when payment credentials are absent; production must configure real provider secrets.
- Social posting is intentionally manual-gated; use [`docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md`](docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md).

## 14. License

Proprietary · © 2026 CyberSkill JSC. License terms are private until a dedicated `LICENSE` file is added.
