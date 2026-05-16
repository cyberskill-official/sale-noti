# SaleNoti

**Turn Shopee price drops into deals you actually catch.**
Vietnamese price-tracking + sale-notification platform · Web + Chrome extension · Phase 1 (Shopee VN) → Phase 3 (multi-platform B2B) → Phase 4 (regional SEA + AI).

Founder: Stephen Cheng (Trịnh Thái Anh) · CyberSkill JSC · DUNS 673219568

---

## Quick links

- **Plan:** [`docs/SaleNoti — Plan.pdf`](docs/SaleNoti%20—%20Plan.pdf)
- **Docs index:** [`docs/README.md`](docs/README.md)
- **Backlog:** [`docs/feature-requests/BACKLOG.md`](docs/feature-requests/BACKLOG.md) (42 FRs, 26 authored at 10/10, 16 roadmapped)
- **Build sequence:** [`TASKS.md`](TASKS.md)
- **FR authoring workflow:** [`docs/FR_AUTHORING_WORKFLOW.md`](docs/FR_AUTHORING_WORKFLOW.md)
- **Memory protocol:** [`AGENTS.md`](AGENTS.md)

## Stack at a glance

| Layer | Pick | Reason |
|---|---|---|
| Frontend | Next.js 15 App Router · React 19 · Tailwind | Plan §C1 — PWA + SEO + RSC |
| Backend | NestJS 10/11 · TypeScript | Plan §C2 — DI + BullMQ adapter clean |
| Browser ext | Manifest V3 · esbuild | Plan §C9 — strict `shopee.vn` scope only |
| Auth | Auth.js v5.0.0-beta.25 (pinned) | Plan §C8 — App Router canonical |
| Hot data | MongoDB Atlas M0 (SG) | Plan §C3 — intern velocity |
| Time-series | TimescaleDB (Neon Postgres) | Plan §C3 — `lowest_30d` continuous aggregate |
| Queue | BullMQ + Upstash Redis | Plan §C4 — beats Inngest on cost at scale |
| Email | Resend + React Email | Plan §C6 — free tier + SPF/DKIM clean |
| Push | Web Push (VAPID) | Plan §C7 — Chrome/Android primary |
| Backup channel | Telegram Bot (P2) | Plan §C7 — VN deal-hunter community |
| Observability | Sentry + PostHog + Better Stack | Plan §C10 — free-tier triad |
| Billing | Stripe + VNPay + MoMo | Plan §E3 — VN-native rails |
| Hosting | Vercel (Pro from launch) + Railway BE | Plan §H — Fair-Use guardrails |

## Repo layout

```
sale-noti/
├── apps/
│   ├── web/                  Next.js 15 — landing, dashboard, deal pages, auth
│   └── api/                  NestJS 10 — REST API, BullMQ workers, schedulers
├── extension/                Chrome MV3 — "+ Theo dõi giá" button on shopee.vn
├── packages/                 (reserved — shared zod schemas, types)
├── docs/
│   ├── README.md
│   ├── FR_AUTHORING_WORKFLOW.md
│   ├── SaleNoti — Plan.pdf
│   ├── legal/                DPIA, Privacy Policy, DPO, cross-border transfer
│   └── feature-requests/     BACKLOG, MANIFEST, 26 FRs + audits, phase summaries
├── scripts/                  CI helpers (fr-check, legal-check)
├── TASKS.md                  Week-0 external deps + 26-FR build checklist
├── AGENTS.md                 Memory protocol proxy
├── CLAUDE.md                 → @AGENTS.md
├── README.md                 You are here
├── package.json              pnpm + turbo root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example              env shape; real values via Doppler
├── .gitignore
├── .nvmrc                    Node 20.11.1
└── .editorconfig
```

## Local dev

```bash
# 1. Install (pnpm@9.12+)
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install

# 2. Pull env from Doppler (one-time setup)
doppler setup                  # select salenoti workspace + dev env
doppler run -- pnpm dev        # boots apps/web + apps/api in parallel
```

## Compliance moat (read before merging any affiliate surface)

Plan §A3 codifies five ethical principles. They are enforced in code:

1. **Disclosure paragraph in every affiliate-tagged surface** — snapshot test catches drift.
2. **User-initiated affiliate-link generation only** — no auto-injection, no auto-coupon.
3. **Respect other publishers' cookies** — `respect_other_publisher: true` flag in the deeplink path.
4. **Open-source revenue model** — calculator on `/legal/affiliate`.
5. **Quarterly Transparency Report** — auto-generated, public.

Two grep + ESLint CI gates back this up:

```bash
pnpm fr:check         # checks FR frontmatter, audit pairing, BCP-14 keywords, manifest sync
pnpm legal:check      # checks disclosure paragraph drift, store-listing copy, no-commission-rank
```

Plan §A3 closing line: *"Đây không phải là nice-to-have. Đây là moat."*

## License

Proprietary · © 2026 CyberSkill JSC · See [`LICENSE`](LICENSE) (TBD).
