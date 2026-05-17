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

| Need | File |
|---|---|
| Product requirements | [`docs/product/PRD.md`](docs/product/PRD.md) |
| Software requirements | [`docs/product/SRS.md`](docs/product/SRS.md) |
| QA strategy | [`docs/qa/TEST_PLAN.md`](docs/qa/TEST_PLAN.md) |
| Test cases | [`docs/qa/TEST_CASES.md`](docs/qa/TEST_CASES.md) |
| FR implementation audit | [`docs/qa/FR_TRACEABILITY.md`](docs/qa/FR_TRACEABILITY.md) |
| Manual social copy/schedule | [`docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md`](docs/growth/MANUAL_SOCIAL_CONTENT_CALENDAR.md) |
| Active backlog | [`docs/feature-requests/BACKLOG.md`](docs/feature-requests/BACKLOG.md) |
| Legal docs | [`docs/legal/`](docs/legal/) |
| Original plan | [`docs/SaleNoti — Plan.pdf`](docs/SaleNoti%20—%20Plan.pdf) |

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
```

For production-like local dev, use Doppler:

```bash
doppler setup
doppler run -- pnpm dev
```

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
```

Full-stack local development also needs:

```bash
MONGODB_URI=mongodb://...
TIMESCALE_DB_URL=postgres://...
REDIS_URL=rediss://...
SHOPEE_AFFILIATE_APP_ID=...
SHOPEE_AFFILIATE_APP_SECRET=...
RESEND_API_KEY=...
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

| Surface | URL |
|---|---|
| Web | `http://localhost:3000` |
| API health | `http://localhost:4000/health` |
| Queue health | `http://localhost:4000/health/queue` |
| Bull Board | `http://localhost:4000/admin/queues` when API and credentials are configured |

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

Then run integration checks:

```bash
TIMESCALE_DB_URL=postgres://... pnpm test:integration
```

Redis:

- Use Upstash with TLS.
- Prefer `rediss://...:6380`.
- `apps/api/src/queue/queues.ts` parses TLS and queue options.

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

| Command | Proves |
|---|---|
| `pnpm fr:check` | FR metadata, audit pairing, manifest sync, BCP-14 shape |
| `pnpm legal:check` | Disclosure drift, Chrome manifest scope, no commission-rate ranking |
| `pnpm typecheck` | Strict TypeScript across web, API, extension |
| `pnpm lint` | ESLint policy and code quality |
| `pnpm test` | Unit coverage for auth, encryption, queues, scheduler, affiliate, billing, leads, extension |
| `pnpm test:e2e` | Public web smoke, B2B public API flow, extension manifest e2e |
| `pnpm build` | Production bundles |

Credential-gated checks:

- `TIMESCALE_DB_URL` is required for Timescale integration tests.
- Shopee, Resend, Telegram, Stripe, VNPay, MoMo, Sentry, PostHog, Better Stack, and Slack need staging credentials for live provider smoke.
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
- Mega Sale hot-tier boosts must stay capped as specified in FR-GROW-003.
- Tune in `apps/api/src/scheduler/priority-engine.ts`, `apps/api/src/scheduler/backoff-policy.ts`, and `apps/api/src/megasale/megasale-window.config.ts`.

Queues:

- Queue names and concurrency live in `apps/api/src/queue/queues.ts`.
- Lower `price-check` concurrency before increasing Shopee call volume.
- Watch 429/error rates before raising scheduler throughput.

Rate limits and cache:

- Shopee global budget defaults to `SHOPEE_RATE_LIMIT_PER_MIN=1000`.
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

| Surface | Provider | Notes |
|---|---|---|
| Web | Vercel | Next.js 15, `APP_URL`, Sentry web DSN, PostHog public key |
| API/workers | Railway or Fly.io | Nest API, BullMQ workers, `API_URL`, provider secrets |
| MongoDB | Atlas SG | Main operational store |
| TimescaleDB | Neon Postgres + Timescale | Price history |
| Redis | Upstash SG | BullMQ/cache/rate/idempotency |
| Extension | Chrome Web Store | MV3 package from `extension/dist` |

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
