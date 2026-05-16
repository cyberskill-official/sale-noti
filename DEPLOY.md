# SaleNoti — Deploy Playbook

Step-by-step walkthrough for the week-0 external dependencies in [`TASKS.md`](TASKS.md). Each section ends with **"Done when:"** so you can tick boxes confidently.

> Tip: keep this file open in one window and `TASKS.md` in another. As each step finishes, tick the corresponding TASKS.md checkbox.

---

## §0 — Prerequisites on your machine

```bash
# 1. Node 20.11.1 (project pins via .nvmrc)
nvm install 20.11.1 && nvm use

# 2. pnpm 9.12 via Corepack
corepack enable
corepack prepare pnpm@9.12.0 --activate

# 3. Doppler CLI
brew install dopplerhq/cli/doppler   # macOS
# or: curl -Ls https://cli.doppler.com/install.sh | sh

# 4. Git (you've got it) + GitHub CLI is helpful
brew install gh
```

**Done when:** `node --version` shows v20.11.x · `pnpm --version` ≥ 9.12 · `doppler --version` works.

---

## §1 — GitHub repo (15 min)

```bash
gh auth login                                  # if not logged in
cd /Users/stephencheng/Projects/CyberSkill/sale-noti
git init
git add .
git commit -m "feat: initial backlog (26 FRs at 10/10) + monorepo scaffold + legal docs"
gh repo create cyberskill/salenoti --private --source=. --remote=origin
git branch -M main
git push -u origin main
```

Then in the GitHub repo UI:

1. Settings → Security → **enable Dependabot alerts + security updates + secret scanning + push protection**.
2. Settings → Branches → **branch protection rule for `main`**: require status checks (`drift-catchers`, `pin-check`, `build`), require 1 review on PRs (`Stephen Cheng` as default reviewer), restrict who can push.
3. Settings → Actions → General → **read + write permissions for the workflow token**.

**Done when:** `git push` works · branch protection requires CI green · Dependabot alerts visible.

---

## §2 — Doppler workspace (15 min)

```bash
# 1. Create workspace via dashboard.doppler.com
#    Project name: salenoti
#    Configs: dev (local), staging, prod

# 2. From repo root:
doppler login
doppler setup     # select project=salenoti, config=dev

# 3. Verify
doppler secrets --only-names      # should list nothing yet — that's fine
```

Now populate the **`dev`** config with the env names from `.env.example`. You can either:

**Option A (dashboard):** open dashboard.doppler.com → project `salenoti` → `dev` config → paste each key. Click "Show" → "Edit" to fill values as you complete §3-§13 below.

**Option B (CLI, faster once you have values):**

```bash
doppler secrets set GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..."
doppler secrets set AUTH_SECRET="$(openssl rand -hex 32)"
doppler secrets set DEEPLINK_SALT="$(openssl rand -hex 32)"
doppler secrets set POSTHOG_PII_SALT="$(openssl rand -hex 32)"
doppler secrets set REFERRAL_SALT="$(openssl rand -hex 32)"
doppler secrets set TELEGRAM_LINK_SALT="$(openssl rand -hex 32)"
doppler secrets set BULL_BOARD_USER="ops" BULL_BOARD_PASS="$(openssl rand -hex 24)"
doppler secrets set APP_URL="http://localhost:3000"
```

**Done when:** `doppler secrets --only-names` lists at least `AUTH_SECRET`, `DEEPLINK_SALT`, `POSTHOG_PII_SALT`, `REFERRAL_SALT`, `BULL_BOARD_USER`, `BULL_BOARD_PASS`, `APP_URL`.

---

## §3 — Google Cloud OAuth (20 min)

1. Go to https://console.cloud.google.com → **create project** `salenoti`.
2. **APIs & Services** → **OAuth consent screen** → User Type: **External** → fill app name, support email, developer contact. **Add scopes**: `openid`, `email`, `profile` (non-sensitive trio → ~same-day verification, sometimes instant). Save.
3. **Credentials** → **Create credentials** → **OAuth client ID** → Application type **Web application** → name `salenoti-web`.
4. Authorized redirect URIs (add both):
   - `http://localhost:3000/api/auth/callback/google`
   - `https://salenoti.vn/api/auth/callback/google`
5. Copy `Client ID` and `Client secret`.
6. Push to Doppler:

```bash
doppler secrets set GOOGLE_CLIENT_ID="123...apps.googleusercontent.com"
doppler secrets set GOOGLE_CLIENT_SECRET="GOCSPX-..."
```

**Done when:** Doppler `dev` has both values · OAuth consent screen status: "In production" or "Pending verification" (non-sensitive scopes usually clear quickly).

---

## §4 — MongoDB Atlas M0 (10 min)

1. Sign up at https://cloud.mongodb.com (free).
2. **Create a project** `salenoti`.
3. **Build a cluster** → M0 (Shared) → AWS Singapore (`ap-southeast-1`).
4. **Database Access** → add user `salenoti-dev` with strong autogen password.
5. **Network Access** → for dev, add `0.0.0.0/0` temporarily; for prod, restrict to Vercel + Railway IP ranges.
6. **Connect** → Drivers → Node.js → copy the SRV URI. Replace `<password>` and `<dbname>` (`salenoti`).

```bash
doppler secrets set MONGODB_URI="mongodb+srv://salenoti-dev:PASSWORD@cluster.xxx.mongodb.net/salenoti?retryWrites=true&w=majority"
```

**Done when:** `pnpm --filter @salenoti/web dev` then `curl localhost:3000/api/health` returns `{"status":"ok","checks":{"mongo":true}}`.

---

## §5 — Neon Postgres + Timescale (15 min)

1. Sign up at https://neon.tech.
2. **New project** → name `salenoti-timeseries` → region Singapore.
3. **SQL Editor** → run `CREATE EXTENSION IF NOT EXISTS timescaledb;` (Neon supports it on free tier).
4. **Connection details** → copy the pooled URI.

```bash
doppler secrets set TIMESCALE_DB_URL="postgres://USER:PASS@HOST/salenoti?sslmode=require"
```

**Done when:** in psql with that URI, `SELECT extname FROM pg_extension;` returns `timescaledb`.

Migration to create `price_history` hypertable lands when FR-PRICE-001 ships (the SQL is already at [`docs/feature-requests/price/FR-PRICE-001-timescaledb-hypertable.md`](docs/feature-requests/price/FR-PRICE-001-timescaledb-hypertable.md) §3).

---

## §6 — Upstash Redis (10 min)

1. Sign up at https://console.upstash.com.
2. **Create database** → name `salenoti-redis` → region Singapore (`ap-southeast-1`) → TLS enabled.
3. **Details** tab → copy the **Redis URL** (starts with `rediss://`).

```bash
doppler secrets set REDIS_URL="rediss://default:PASSWORD@HOST.upstash.io:6380"
```

**Done when:** `redis-cli -u "$REDIS_URL" PING` returns `PONG`.

---

## §7 — Resend (20 min — DNS lag is the gate)

1. Sign up at https://resend.com (free 3K/mo).
2. **Domains** → **Add Domain** → `salenoti.vn` (or your final domain). Resend shows DNS records to add (SPF TXT, DKIM TXT, optional DMARC TXT).
3. In your DNS provider (Cloudflare / Route 53 / whoever owns the domain), add the records. Wait 5-30 min for propagation.
4. **Verify** → wait for the green check on each row.
5. **API Keys** → create one named `salenoti-dev` with `full_access`.

```bash
doppler secrets set RESEND_API_KEY="re_..."
```

**Done when:** Resend dashboard shows `salenoti.vn` verified · `RESEND_API_KEY` in Doppler.

DMARC recommended setting: `_dmarc.salenoti.vn  TXT  "v=DMARC1; p=quarantine; rua=mailto:dpo@salenoti.vn; pct=100"`.

---

## §8 — VAPID keypair for Web Push (3 min)

```bash
pnpm dlx web-push generate-vapid-keys

# Output:
# Public Key: BL...
# Private Key: ...

doppler secrets set VAPID_PUBLIC_KEY="BL..."
doppler secrets set VAPID_PRIVATE_KEY="..."
```

**Done when:** both values in Doppler. The `VAPID_PUBLIC_KEY` will be safe-to-expose-on-client (FR-NOTIF-002 §3); the private key stays server-only.

---

## §9 — Sentry org + projects (10 min)

1. Sign up at https://sentry.io.
2. **Create organization** → `cyberskill` slug.
3. **Create project** → platform **Next.js** → name `salenoti-web`. Copy DSN.
4. **Create project** → platform **Node.js** → name `salenoti-api`. Copy DSN.
5. **Settings** → **Alerts** → create rule "any unhandled exception in production" → action **Slack `#oncall`**.

```bash
doppler secrets set SENTRY_DSN_WEB="https://...@o123.ingest.sentry.io/456"
doppler secrets set SENTRY_DSN_API="https://...@o123.ingest.sentry.io/457"
```

**Done when:** trigger a test exception in `apps/web` (any route) → Sentry dashboard shows the issue → Slack `#oncall` gets a message.

---

## §10 — PostHog Cloud (10 min)

1. Sign up at https://us.posthog.com (free 1M events/mo).
2. **Create project** → `salenoti`.
3. **Project Settings** → **API Keys** → copy **Project API Key** (`phc_...`).

```bash
doppler secrets set POSTHOG_KEY="phc_..."
doppler secrets set POSTHOG_HOST="https://us.i.posthog.com"
# POSTHOG_PII_SALT was set in §2 — verify it's there:
doppler secrets get POSTHOG_PII_SALT
```

4. **Feature Flags** → pre-create the flags from FR-OBS-001 §1 #6: `freemium_pricing_v1` (off), `pro_tier_visible` (off), `mega_sale_mode_2026_99` (off).

**Done when:** test event `posthog.capture("setup_complete", {})` from a dev script appears in PostHog Events page.

---

## §11 — Better Stack monitors (10 min)

1. Sign up at https://betterstack.com (free 5 monitors).
2. **Uptime** → **Create monitor** × 4 per FR-OBS-001 §1 #7. For dev, point them at staging URLs once deployed; for now just stub:
   - `salenoti-web` → `https://salenoti.vn` (placeholder; activate after Vercel deploy)
   - `salenoti-health` → `https://salenoti.vn/api/health` (placeholder)
   - `salenoti-api` → `https://api.salenoti.vn/health` (placeholder)
   - `mongo-ping` → leave disabled for now
3. **Heartbeats** → create `cron-price-check-tier1-30m` (period 30 min, grace 5 min). Copy the heartbeat URL.

```bash
doppler secrets set BETTER_STACK_TOKEN="..."        # for API access if needed
doppler secrets set BETTER_STACK_HEARTBEAT_URL_TIER1="https://uptime.betterstack.com/api/v1/heartbeat/..."
```

**Done when:** dashboard shows 4 monitors (disabled for now is fine) + 1 heartbeat in "waiting".

---

## §12 — Slack workspace + webhooks (10 min)

You probably already have a Slack. Create 4 channels:

- `#oncall` — Sentry alerts
- `#daily-metrics` — PostHog daily digest
- `#founder-incidents` — breach-detector alerts (FR-LEGAL-001)
- `#b2b-leads` — FR-ADMIN-001 form submissions

For each, **Add Apps** → **Incoming Webhooks** → create a webhook URL.

```bash
doppler secrets set SLACK_OBS_WEBHOOK="https://hooks.slack.com/services/...oncall..."
doppler secrets set SLACK_METRICS_WEBHOOK="https://hooks.slack.com/services/...metrics..."
doppler secrets set SLACK_INCIDENTS_WEBHOOK="https://hooks.slack.com/services/...incidents..."
doppler secrets set SLACK_B2B_WEBHOOK="https://hooks.slack.com/services/...b2b..."
```

**Done when:** 4 webhook URLs in Doppler.

---

## §13 — Vercel + Railway (20 min)

### Vercel

1. Sign up at https://vercel.com → **Add new** → **Project** → import the `cyberskill/salenoti` repo.
2. Root directory: `apps/web`. Framework: **Next.js** (auto-detected).
3. **Environment variables** → connect Doppler via the [official integration](https://docs.doppler.com/docs/vercel) OR paste manually from Doppler.
4. **Deploy** — first build will compile but routes that need credentials will 500 until §14 below.
5. Upgrade to **Pro plan** ($20/mo) to escape Fair-Use Guideline restrictions per plan §H risk.

### Railway

1. Sign up at https://railway.app.
2. **New Project** → **Deploy from GitHub repo** → select `salenoti`.
3. **Add service** → root `apps/api`. Build command: `pnpm install && pnpm --filter @salenoti/api build`. Start command: `node apps/api/dist/main.js`.
4. **Variables** → connect Doppler service token (`doppler configs tokens create`).
5. Plan: **Hobby** ($5 starter) → upgrade to **Pro** ($20/mo + usage) post-launch.

**Done when:** Vercel preview URL deploys · Railway service shows green status.

---

## §14 — Shopee Affiliate VN (30 min form + 1-2 week wait)

1. Go to https://affiliate.shopee.vn.
2. Click **Đăng ký** → cá nhân (individual) — easiest at MVP scale.
3. Fill: CCCD/CMND (national ID), bank account for commission payout, monthly tax filing acknowledgement, marketing channel description ("Web app + Chrome extension for VN price tracking"), expected monthly traffic.
4. Upload: CCCD scan, selfie holding CCCD.
5. Submit. **Wait 1-2 weeks for approval.** Email arrives when approved.
6. After approval → log into the Affiliate Dashboard → **Open API** → generate App credentials.

```bash
doppler secrets set SHOPEE_AFFILIATE_APP_ID="..."
doppler secrets set SHOPEE_AFFILIATE_APP_SECRET="..."
doppler secrets set SHOPEE_RATE_LIMIT_PER_MIN="1000"  # default; confirm with Shopee PM
```

**Done when:** App ID + secret in Doppler · approval email saved to `docs/legal/external/shopee-affiliate-approval.pdf`.

---

## §15 — Counsel engagement (Tilleke & Gibbins recommended)

1. Email contact at https://www.tilleke.com/contact/ (Ho Chi Minh City office).
2. Subject: "Fixed-fee PDPL DPIA review + filing assist — SaleNoti MVP".
3. Attach the 6 files from `docs/legal/`:
   - `DPIA-2026-05.md`
   - `DPO-appointment.md`
   - `cross-border-transfer-impact-assessment.md`
   - `A05-breach-notification-template.md`
   - `privacy-policy-vi.md`
   - `privacy-policy-en.md`
4. Ask for: (a) review of the 6 documents, (b) sign-off they're fileable as-is OR a revisions list, (c) assist with A05 submission Mẫu số 02, (d) one-shot Q&A on 5 specific risks.
5. Budget ≈ 30M ₫ (~ $1.2K). Get fixed-fee quote.

**Done when:** signed engagement letter received · counsel sign-off on DPIA · A05 receipt saved to `docs/legal/external/A05-receipt-DPIA-2026-05.pdf`.

---

## §16 — Chrome Web Store developer ($5, instant)

1. Go to https://chrome.google.com/webstore/devconsole.
2. Sign in with the Google account that will own the extension (RECOMMEND: a `dev@cyberskill.world` workspace account, not personal).
3. Pay $5 one-time registration.
4. **Privacy practices** → upload Privacy Policy URL (will point to `https://salenoti.vn/privacy` once deployed).
5. Note your future Extension ID will be assigned on first upload — pre-fill `EXT_ID` in Doppler after the first upload.

**Done when:** developer account active · ready to upload `extension/dist/*.crx` (or unpacked) on submission week 7.

---

## §17 — Payment rails (P2 dep — start onboarding now, ~4 week lead)

### Stripe (USA/Ireland)
1. https://dashboard.stripe.com/register → create account for `CyberSkill JSC`.
2. **Verify**: business docs (giấy phép kinh doanh, MST), bank account in VN (Vietcombank/Techcombank).
3. **API keys** → test mode for dev → `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (after webhook URL is live).

### VNPay
1. https://vnpay.vn → "Hợp tác" → submit business profile.
2. Receives **TMN code** + hash secret after ~1 week.

### MoMo
1. https://business.momo.vn → register merchant.
2. Receives partner code + access key + secret key.

```bash
doppler secrets set STRIPE_SECRET_KEY="sk_test_..."
doppler secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
doppler secrets set VNPAY_TMN_CODE="..."
doppler secrets set VNPAY_HASH_SECRET="..."
doppler secrets set MOMO_PARTNER_CODE="..."
doppler secrets set MOMO_ACCESS_KEY="..."
doppler secrets set MOMO_SECRET_KEY="..."
```

**Done when:** all three gateways' test credentials in Doppler.

---

## §18 — Telegram bot (P2 dep — 5 min)

1. In Telegram, open `@BotFather` → `/newbot`.
2. Name: `SaleNoti`. Username: `SaleNotiBot` (or fallback if taken).
3. Copy token.

```bash
doppler secrets set TELEGRAM_BOT_TOKEN="..."
# TELEGRAM_LINK_SALT was set in §2
```

**Done when:** token in Doppler. Bot stays idle until FR-NOTIF-003 ships.

---

## §19 — Verify end-to-end (the local-dev smoke test)

After §1-§7 done at minimum:

```bash
cd /Users/stephencheng/Projects/CyberSkill/sale-noti
pnpm install
doppler run -- pnpm dev
# In another terminal:
curl http://localhost:3000/api/health
# Expect: {"status":"ok","checks":{"mongo":true}}
```

Open `http://localhost:3000` → click "Sign in" → Google OAuth flow → land on `/dashboard` → see your email.

**That is the FR-AUTH-001 happy path running locally.**

---

## Roll-forward checklist after week-0 (your morning routine)

Each day in week-1+ until P1 exit:

1. `git pull origin main`
2. `doppler run -- pnpm install` (in case deps changed)
3. `doppler run -- pnpm dev`
4. Open `TASKS.md` → pick the next unticked FR in build order.
5. Open that FR's spec — it has §3 contract, §4 ACs, §5 verify tests, §6 skeleton.
6. Branch: `git checkout -b feat/fr-AUTH-002-magic-link`
7. Implement → `pnpm test` green → `pnpm fr:check` green → `pnpm legal:check` green.
8. Open PR → CI green → merge.
9. Tick the TASKS.md box, set `status: shipped` + `shipped: <ISO date>` in the FR frontmatter.

---

*Last updated 2026-05-16. Sync this file with `TASKS.md` whenever an external dep changes.*
