# SaleNoti — Tasks

Single source of truth for what's in flight. Sorted by phase. Tick boxes as work lands; update the corresponding FR's `status:` + `shipped:` frontmatter on PR merge.

Backlog: [`docs/feature-requests/BACKLOG.md`](docs/feature-requests/BACKLOG.md) · Workflow: [`docs/FR_AUTHORING_WORKFLOW.md`](docs/FR_AUTHORING_WORKFLOW.md)

---

## Week 0 · External-dependency unlock (start IMMEDIATELY — these have 1–4 week lead times)

These don't have FR-IDs because they're outside the codebase, but they BLOCK FR work that does:

- [ ] **Shopee Affiliate VN registration** — register at https://affiliate.shopee.vn (individual OR doanh-nghiệp account both accepted per plan §B6). Submit, wait 1–2 weeks for approval. Capture `SHOPEE_AFFILIATE_APP_ID` + `SHOPEE_AFFILIATE_APP_SECRET` into Doppler when granted. **Blocks:** FR-AFF-001..004, FR-WATCH-001..003, FR-PRICE-001..002, FR-NOTIF-001..003, FR-EXT-001.
- [ ] **PDPL counsel engagement** — book one-shot consult with Tilleke & Gibbins (or Russin & Vecchi / KPMG / EY per plan §B3). Budget ≈ 30M ₫. Send them `docs/legal/DPIA-2026-05.md` + `docs/legal/cross-border-transfer-impact-assessment.md` + `docs/legal/DPO-appointment.md` + `docs/legal/privacy-policy-vi.md` for review. Typical turnaround 2–4 weeks. **Blocks:** FR-LEGAL-001 (filing step).
- [ ] **DPIA filing with A05** — after counsel sign-off, submit Mẫu số 02 + DPO appointment letter to A05 (Cục An ninh mạng, Bộ Công an). Save receipt as `docs/legal/A05-receipt-DPIA-2026-05.pdf`. **Blocks:** any data collection (incl. waitlist email capture).
- [ ] **Doppler workspace** — create `salenoti` workspace at https://dashboard.doppler.com; create `dev` + `staging` + `prod` configs; populate env shape from [`.env.example`](.env.example). One-time setup. **Blocks:** local dev + every CI step.
- [ ] **Google Cloud Console** — create project `salenoti`, enable OAuth 2.0, configure consent screen for scopes `openid email profile` (verification non-sensitive → same-day approval), authorize redirect URI `https://salenoti.vn/api/auth/callback/google` + local `http://localhost:3000/api/auth/callback/google`. Capture client id + secret to Doppler. **Blocks:** FR-AUTH-001.
- [ ] **Resend account** — verify domain `salenoti.vn` (SPF + DKIM + DMARC=quarantine min). Capture `RESEND_API_KEY`. Free 3K/mo until ~500 paying users. **Blocks:** FR-AUTH-002, FR-NOTIF-001.
- [ ] **VAPID keypair** — run `pnpm dlx web-push generate-vapid-keys` once; capture to Doppler. **Blocks:** FR-NOTIF-002.
- [ ] **Sentry org + projects** — create org `cyberskill`, projects `salenoti-web` + `salenoti-api`. Capture DSNs. Free tier 5K errors/month. **Blocks:** FR-OBS-001.
- [ ] **PostHog org** — create org, capture project key + host + generate `POSTHOG_PII_SALT` (`openssl rand -hex 32`). Free 1M events/month. **Blocks:** FR-OBS-001.
- [ ] **Better Stack monitors** — sign up; configure 4 monitors per FR-OBS-001 §1 #7 (will be created post-launch). Free 5 monitors.
- [ ] **MongoDB Atlas M0** — Singapore region, project `salenoti`, free tier. Capture `MONGODB_URI`. **Blocks:** every data-touching FR.
- [ ] **Neon Postgres + Timescale** — Singapore region, project `salenoti-timeseries`, install `timescaledb` extension. Capture `TIMESCALE_DB_URL`. **Blocks:** FR-PRICE-001.
- [ ] **Upstash Redis** — Singapore region, free tier. Capture `REDIS_URL` (rediss:// scheme). **Blocks:** FR-WORKER-001.
- [ ] **Vercel team** — create team `cyberskill`, project `salenoti`. Pro plan from launch ($20/mo) to escape Fair-Use guardrails. **Blocks:** frontend deploy.
- [ ] **Railway team** — create project `salenoti`, environments `prod` + `staging`. ~$20/mo to start (2vCPU/4GB). **Blocks:** API deploy.
- [ ] **Chrome Web Store developer account** — $5 one-time. **Blocks:** FR-EXT-001 submission.
- [ ] **hCaptcha account** — for FR-ADMIN-001. Free tier. **Blocks:** P2 B2B form.
- [ ] **Stripe account** — KYC + bank account in VN; ~2–4 weeks approval. **Blocks:** FR-BILL-001 (P2).
- [ ] **VNPay merchant** — register at vnpay.vn; merchant ID + hash secret. **Blocks:** FR-BILL-001.
- [ ] **MoMo merchant** — register at business.momo.vn; partner code + access key + secret. **Blocks:** FR-BILL-001.
- [ ] **Telegram BotFather** — create `@SaleNotiBot`; capture `TELEGRAM_BOT_TOKEN`. **Blocks:** FR-NOTIF-003 (P2).
- [ ] **Slack workspace** — channels `#oncall`, `#daily-metrics`, `#founder-incidents`, `#b2b-leads`. Webhook URLs to Doppler. **Blocks:** OBS alert routing.
- [ ] **GitHub repo + secret scanning** — `cyberskill/salenoti` private repo; enable Dependabot + secret scanning + push protection. Set up branch protection on `main` requiring CI green.

---

## P0 · Pre-MVP Foundation (week 0–2)

Build in dependency order. Each task = one FR = one PR. Source FRs in `docs/feature-requests/<module>/`.

### AUTH slice 1

- [ ] **FR-AUTH-001** — Google OAuth via Auth.js v5 pinned · est: 6h · [spec](docs/feature-requests/auth/FR-AUTH-001-google-oauth-authjs-v5.md)
- [ ] **FR-AUTH-002** — Email magic-link · est: 5h · [spec](docs/feature-requests/auth/FR-AUTH-002-email-magic-link.md) · depends_on: FR-AUTH-001
- [ ] **FR-AUTH-003** — JWT session + refresh rotation · est: 5h · [spec](docs/feature-requests/auth/FR-AUTH-003-jwt-session-refresh.md) · depends_on: FR-AUTH-001

### LEGAL slice 1 (filings in parallel; counsel review async)

- [ ] **FR-LEGAL-001** — PDPL DPIA + DPO + A05 72h · est: 6h coding (templates in `docs/legal/` already drafted) · [spec](docs/feature-requests/legal/FR-LEGAL-001-pdpl-dpia-dpo.md)
- [ ] **FR-LEGAL-002** — Affiliate disclosure surfaces · est: 4h · [spec](docs/feature-requests/legal/FR-LEGAL-002-affiliate-disclosure-surfaces.md) · depends_on: FR-AUTH-002 (for email integration)

### OBS slice 1 (parallel to AUTH)

- [ ] **FR-OBS-001** — Sentry + PostHog + Better Stack · est: 4h · [spec](docs/feature-requests/obs/FR-OBS-001-sentry-posthog-betterstack.md)

### WORKER slice 1

- [ ] **FR-WORKER-001** — BullMQ + Redis + Bull Board · est: 5h · [spec](docs/feature-requests/worker/FR-WORKER-001-bullmq-redis-baseline.md) · depends_on: FR-OBS-001
- [ ] **FR-WORKER-002** — Adaptive scheduler · est: 6h · [spec](docs/feature-requests/worker/FR-WORKER-002-adaptive-scheduler.md) · depends_on: FR-WORKER-001

**P0 exit gate:** all 8 tasks ticked · all 8 FRs `status: shipped` · DPIA filed · counsel sign-off recorded · OBS dashboards green · Bull Board live behind auth. Total estimated effort: 41h.

---

## P1 · MVP Core + Extension Lite (week 2–8)

### PRICE slice 1 (starts before AFF — provides Timescale sink for offer resolver)

- [ ] **FR-PRICE-001** — TimescaleDB hypertable · est: 6h · [spec](docs/feature-requests/price/FR-PRICE-001-timescaledb-hypertable.md)

### AFF slice 1

- [ ] **FR-AFF-001** — Shopee Affiliate client · est: 8h · [spec](docs/feature-requests/aff/FR-AFF-001-shopee-affiliate-client.md) · depends_on: FR-WORKER-002, FR-OBS-001
- [ ] **FR-AFF-003** — productOfferV2 / shopOfferV2 resolver · est: 5h · [spec](docs/feature-requests/aff/FR-AFF-003-product-shop-offer-resolver.md) · depends_on: FR-AFF-001, FR-PRICE-001
- [ ] **FR-AFF-002** — generateShortLink with attribution · est: 4h · [spec](docs/feature-requests/aff/FR-AFF-002-generateshortlink-attribution.md) · depends_on: FR-AFF-001, FR-LEGAL-002
- [ ] **FR-AFF-004** — productSearch cached · est: 4h · [spec](docs/feature-requests/aff/FR-AFF-004-product-search-cached.md) · depends_on: FR-AFF-001

### WATCH slice 1

- [ ] **FR-WATCH-001** — POST /v1/products/track · est: 6h · [spec](docs/feature-requests/watch/FR-WATCH-001-paste-shopee-url-track.md) · depends_on: FR-AFF-003, FR-PRICE-001, FR-AUTH-003
- [ ] **FR-WATCH-002** — Alert trigger config · est: 5h · [spec](docs/feature-requests/watch/FR-WATCH-002-alert-config-triggers.md) · depends_on: FR-WATCH-001
- [ ] **FR-WATCH-003** — List + pause + delete + cap · est: 4h · [spec](docs/feature-requests/watch/FR-WATCH-003-list-pause-delete-cap.md) · depends_on: FR-WATCH-001

### PRICE slice 1 cont.

- [ ] **FR-PRICE-002** — History chart API · est: 4h · [spec](docs/feature-requests/price/FR-PRICE-002-history-chart-api.md) · depends_on: FR-PRICE-001, FR-WATCH-001

### NOTIF slice 1

- [ ] **FR-NOTIF-001** — Email alert via Resend · est: 6h · [spec](docs/feature-requests/notif/FR-NOTIF-001-email-alert-resend.md) · depends_on: FR-WATCH-002, FR-LEGAL-002
- [ ] **FR-NOTIF-002** — Web Push (VAPID + SW) · est: 5h · [spec](docs/feature-requests/notif/FR-NOTIF-002-web-push-vapid.md) · depends_on: FR-NOTIF-001

### EXT slice 1 (final P1 piece — Chrome Web Store submission week 7, public launch week 8)

- [ ] **FR-EXT-001** — Chrome MV3 extension · est: 12h · [spec](docs/feature-requests/ext/FR-EXT-001-chrome-mv3-track-button.md) · depends_on: FR-AUTH-003, FR-WATCH-001, FR-LEGAL-002

**P1 exit gate:** all 12 tasks ticked · Chrome Web Store approved (or self-host fallback executed) · plan §I Phase 1 metrics in dashboard. Total estimated effort: 69h.

---

## P2 · Growth & Monetization (week 8–18)

### BILL slice 1

- [ ] **FR-BILL-001** — Freemium + Stripe + VNPay/MoMo · est: 12h · [spec](docs/feature-requests/bill/FR-BILL-001-freemium-stripe-vnpay-momo.md) · depends_on: FR-AUTH-003, FR-WATCH-003

### NOTIF slice 2

- [ ] **FR-NOTIF-003** — Telegram bot · est: 6h · [spec](docs/feature-requests/notif/FR-NOTIF-003-telegram-bot.md) · depends_on: FR-NOTIF-001

### GROW slice 1

- [ ] **FR-GROW-001** — Referral program · est: 6h · [spec](docs/feature-requests/grow/FR-GROW-001-referral-program.md) · depends_on: FR-AUTH-003, FR-BILL-001
- [ ] **FR-GROW-002** — Share deal with friend · est: 5h · [spec](docs/feature-requests/grow/FR-GROW-002-share-deal-with-friend.md) · depends_on: FR-AFF-002, FR-NOTIF-001
- [ ] **FR-GROW-003** — Mega Sale Mode · est: 8h · [spec](docs/feature-requests/grow/FR-GROW-003-mega-sale-mode.md) · depends_on: FR-NOTIF-001, FR-NOTIF-002, FR-AFF-004

### ADMIN slice 1

- [ ] **FR-ADMIN-001** — B2B contact form · est: 3h · [spec](docs/feature-requests/admin/FR-ADMIN-001-b2b-contact-form.md) · depends_on: FR-OBS-001

**P2 exit gate:** all 6 tasks ticked · plan §I Phase 2 metrics (MRR 30M ₫, D30 ≥ 35%, Free→Pro ≥ 5%) hit. Total estimated effort: 40h.

---

## P3 + P4 — roadmap (re-batch when P2 metrics land)

See `docs/feature-requests/BACKLOG.md` §5 (P3 · Power, Multi-platform, B2B) and §6 (P4 · Regional + AI). Re-author 10 + 6 FRs when triggers in `P2_AUDIT_SUMMARY.md §6` fire.

---

## Engineering hygiene (continuous)

- [ ] CI green on every PR (drift catchers + typecheck + lint + test).
- [ ] Every PR includes the FR-ID in the title and description.
- [ ] Every shipped FR updates its frontmatter (`status: shipped`, `shipped: <ISO date>`).
- [ ] Weekly: `pnpm fr:check && pnpm legal:check` on `main` (cron via GitHub Actions).
- [ ] Quarterly: re-audit `cross-border-transfer-impact-assessment.md` (recipient certifications, DPA URLs, hosting regions).
- [ ] Quarterly: publish Transparency Report at `/transparency/<YYYY-Q[1-4]>`.
- [ ] Quarterly: A05 breach-notification drill (per FR-LEGAL-001 AC10).

---

*Maintained by Stephen Cheng. Last updated: 2026-05-16.*
