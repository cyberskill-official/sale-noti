# SaleNoti — Feature Request Backlog

**Owner:** Stephen Cheng (Founder, CyberSkill) · **Status:** v0.1.0 — P0-P2 shipped + QA traceability, 2026-05-18
**Source of truth:** the markdown files in this folder. This index is regenerated when FRs land or change status.
**Source plan:** [`../SaleNoti — Plan.pdf`](../SaleNoti%20—%20Plan.pdf)
**Authoring playbook:** [`../FR_AUTHORING_WORKFLOW.md`](../FR_AUTHORING_WORKFLOW.md) (project-local)

---

## §0 — How to read this backlog

This document is the **single source of truth** for what SaleNoti is going to build, organised by **phase** (P0 → P4), then by **module**, then by **slice** within each module. Every row is one FR; one FR is one atomic, testable requirement.

- **Phase** maps to the roadmap arc in the source plan: `P0 Pre-MVP Foundation` (legal entity, auth, observability, queue baseline) → `P1 MVP Core + Extension Lite` (the 8-week happy-path) → `P2 Growth & Monetization` (push, Telegram, billing, Mega Sale Mode) → `P3 Power Multi-platform B2B` (Lazada, TikTok Shop, mobile, B2B Price Intelligence) → `P4 Regional + AI` (SG/MY/ID/PH expansion + ML deal scoring).
- **Slice** is a coherent ship-unit within a module. Slice 1 is always the minimum viable surface for that module.
- **Priority** uses BCP-14 keywords — `MUST` (release blocker) · `SHOULD` (release should-have) · `COULD` (release nice-to-have) · `MAY` (post-release).
- **Status** flows: `draft → audited → accepted → building → shipped` (or `deferred` / `rejected` / `superseded`).
- **Depends on** is the cross-FR dependency graph. An FR cannot start `building` until its `depends_on` rows are all `shipped`.
- **Effort** is a rough sizing in hours (1h = 30 min focused work + 30 min coordination/review). Treat as ±50%. Sized for one experienced engineer (Senior Tech Lead with 2 Intern Developers in support per the plan §G1).

**Reading order for the founder/planner:** scan §1 (totals) → pick the phase you're working in → read the per-module breakdown in that phase → drill into individual FR markdowns as you accept them.

**Reading order for the implementer:** find your assigned FR-ID in the per-module section → click through to the FR markdown → that file has the API contract, test harness, allowed-tools, implementation hints.

---

## §1 — Totals at a glance

| Phase                                         | Modules in scope                                                                   | FRs planned | Estimated effort (person-weeks) | Compliance / exit gate                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | ----------: | ------------------------------: | ------------------------------------------------------------------------------------------ |
| **P0 — Pre-MVP Foundation** (week 0-2)        | AUTH · LEGAL · OBS · WORKER                                                        |       **8** |                            ~2.0 | PDPL Art. 24/28 ready · DPO appointed · A05 báo cáo (CA05) wired                           |
| **P1 — MVP Core + Extension Lite** (week 2-8) | AFF · WATCH · PRICE · NOTIF · EXT                                                  |      **12** |                            ~6.0 | 1,000 signups · 10,000 products tracked · D7 ≥ 25% · CTR ≥ 25% · Chrome Web Store approved |
| **P2 — Growth & Monetization** (week 8-18)    | BILL · NOTIF (Telegram) · GROW · ADMIN                                             |       **6** |                            ~3.0 | MRR 30M ₫ ($1.2K) · D30 ≥ 35% · Free→Pro ≥ 5%                                              |
| **P3 — Power, Multi-platform, B2B** (M+5..12) | AFF (Lazada/TikTok) · WATCH (mobile) · ADMIN (B2B dashboard) · NOTIF (mobile push) |         ~10 |                            ~6.0 | MAU 100K · ARPU $0.5 · LTV/CAC ≥ 1.8                                                       |
| **P4 — Regional + AI** (M+12..24)             | AFF (regional) · PRICE (ML scoring) · WATCH (smart wishlist)                       |          ~6 |                            ~5.0 | +1 country (TH or PH) · ML deal-score AUC ≥ 0.85                                           |
| **Total**                                     | 12 modules · 5 phases                                                              |     **~42** |            **~22 person-weeks** | 5 gated milestones                                                                         |

**Effort budget reality-check:** 42 FRs × 8h average = 336h ≈ 8.4 person-weeks of pure coding. The 22 person-weeks total accounts for design + legal review + QA + Chrome Web Store + Shopee Affiliate compliance + integration. Maps to ~22 weeks for one full-time Senior Tech Lead, which is consistent with the roadmap in plan §J.

**Phase-1 fundables only — what this backlog locks down today:** all P0-P2 FRs (rows 1-26) are shipped as of 2026-05-17. P3 and P4 are deferred — they appear in this backlog as roadmap rows only, not as authored FRs.

---

## §2 — P0 · Pre-MVP Foundation

**Phase goal:** stand up the cross-cutting infrastructure every feature depends on, with PDPL compliance wired from day one. By P0 exit (week 2), SaleNoti has a legal entity (or scoped DBA), DPO appointed, Auth.js v5 pinned, Sentry/PostHog/BullMQ live, and the Shopee Affiliate VN registration submitted.

**Compliance gate:** PDPL Decree 13/2023/NĐ-CP Art. 24/28 — DPIA filed with Bộ Công an A05 within 60 days of starting data processing. DPO appointed (Article 28).

**Build order (locked):** LEGAL-001 (entity + DPO) → AUTH-001..003 (Google OAuth + magic link + JWT) → OBS-001 (Sentry/PostHog/Better Stack) → WORKER-001..002 (BullMQ + adaptive scheduler) → LEGAL-002 (affiliate disclosure surfaces).

### P0.1 — AUTH · authentication baseline (Auth.js v5 pinned)

**Owner:** Senior Tech Lead · **Slice plan:** 1 slice, 3 FRs · **Plan refs:** plan §C8, §G1

| FR-ID           | Title                                                            | Pri  |        Status        | Depends on  | Effort |
| --------------- | ---------------------------------------------------------------- | :--: | :------------------: | ----------- | -----: |
| **FR-AUTH-001** | Google OAuth via Auth.js v5.0.0-beta.25 (pinned, no `latest`)    | MUST | shipped + mocked-dependency (2026-05-18) | —           |     6h |
| **FR-AUTH-002** | Email magic-link sign-in (Resend transactional + 15-min token)   | MUST | shipped + mocked-dependency (2026-05-18) | FR-AUTH-001 |     5h |
| **FR-AUTH-003** | JWT session (15-min access + 30-day refresh in HTTP-only cookie) | MUST | shipped + strict-audited (2026-05-18) | FR-AUTH-001 |     5h |

### P0.2 — LEGAL · PDPL + affiliate compliance

**Owner:** Founder + one-shot legal consult · **Slice plan:** 1 slice, 2 FRs · **Plan refs:** plan §B3 (PDPL), §B4 (Chrome Affiliate Ads Policy), §A3 (5 ethical principles)

| FR-ID            | Title                                                                                                                   | Pri  |        Status        | Depends on | Effort |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | :--: | :------------------: | ---------- | -----: |
| **FR-LEGAL-001** | PDPL Art. 24/28 — DPIA filed + DPO appointed + A05 notification within 72h breach window                                | MUST | shipped + mocked-dependency (2026-05-18) | —          |     6h |
| **FR-LEGAL-002** | Affiliate disclosure surfaces (Chrome Web Store listing · onboarding · every alert email · every affiliate-tagged link) | MUST | shipped + strict-audited (2026-05-18) | —          |     4h |

### P0.3 — OBS · observability baseline

**Owner:** Senior Tech Lead · **Slice plan:** 1 slice, 1 FR · **Plan refs:** plan §C10

| FR-ID          | Title                                                                                          | Pri  |        Status        | Depends on | Effort |
| -------------- | ---------------------------------------------------------------------------------------------- | :--: | :------------------: | ---------- | -----: |
| **FR-OBS-001** | Sentry (errors) + PostHog (product analytics + feature flags) + Better Stack (uptime) baseline | MUST | shipped + mocked-dependency (2026-05-18) | —          |     4h |

### P0.4 — WORKER · queue + adaptive scheduler

**Owner:** Senior Tech Lead · **Slice plan:** 1 slice, 2 FRs · **Plan refs:** plan §C4, §D6

| FR-ID             | Title                                                                                                     | Pri  |        Status        | Depends on    | Effort |
| ----------------- | --------------------------------------------------------------------------------------------------------- | :--: | :------------------: | ------------- | -----: |
| **FR-WORKER-001** | BullMQ + Redis (Upstash free tier) baseline + Bull Board ops dashboard                                    | MUST | shipped + mocked-dependency (2026-05-18) | —             |     5h |
| **FR-WORKER-002** | Adaptive scheduling — `hot` 30min / `mid` 6h / `low` 24h cadence under 1000 req/min Shopee API rate limit | MUST | shipped + mocked-dependency (2026-05-18) | FR-WORKER-001 |     6h |

---

## §3 — P1 · MVP Core + Extension Lite

**Phase goal:** ship the happy path the founder will dogfood for 8 weeks: paste a Shopee URL → resolve product via Affiliate API → store metadata in MongoDB + 30-day price history in TimescaleDB → adaptive worker checks prices every 30 min to 6 h → email alert when threshold hits → click affiliate-tagged deeplink → confirmed commission rolls back to AffiliateClick attribution. Add Chrome extension "+ Theo dõi giá" floating button on shopee.vn product pages with strict MV3 scope (`*://*.shopee.vn/*`, no `<all_urls>`, no cart API scrape).

**Compliance gate:** Chrome Web Store approval (3/2025 Affiliate Ads Policy enforced 10/6/2025 — disclosure rõ ràng, single-purpose, no auto-apply coupon, no affiliate-link injection without user action). Shopee VN ToS / Affiliate Marketing Solution clean (no scrape /api/v4/cart/\*, no DOM read until 1 user-initiated click).

**Exit metrics (plan §I, Phase 1):** Total signup ≥ 1,000 · WAU ≥ 250 · Products tracked ≥ 10,000 · Alerts sent ≥ 5,000 · CTR alert ≥ 25% · D7 retention ≥ 25% · Extension installs ≥ 300 · Negative review/complaint < 5.

### P1.1 — AFF · Shopee Affiliate Open API integration

**Owner:** Senior Tech Lead · **Slice plan:** 1 slice, 4 FRs · **Plan refs:** plan §B2 (full API design), §C3 (data model), §D4 (API contract), §H risk matrix (Affiliate API change)

| FR-ID          | Title                                                                                                  |  Pri   |                Status                 | Depends on    | Effort |
| -------------- | ------------------------------------------------------------------------------------------------------ | :----: | :-----------------------------------: | ------------- | -----: |
| **FR-AFF-001** | Shopee Affiliate Open API client — GraphQL POST · SHA256 signed header · 1000 req/min rate-limit aware |  MUST  | shipped + strict-audited (2026-05-18) | FR-WORKER-002 |     8h |
| **FR-AFF-002** | `generateShortLink(originUrl, subIds[])` deeplink with userId + watchlistId attribution sub-id         |  MUST  | shipped + strict-audited (2026-05-18) | FR-AFF-001    |     4h |
| **FR-AFF-003** | `productOfferV2` / `shopOffer` resolver for commission rate ingest + denormalised cache                |  MUST  | shipped + strict-audited (2026-05-18) | FR-AFF-001    |     5h |
| **FR-AFF-004** | `productSearch` resolver with 5–10 min cache + per-tenant rate-limit budget                            | SHOULD | shipped + mocked-dependency (2026-05-18) | FR-AFF-001    |     4h |

### P1.2 — WATCH · watchlist + alert config

**Owner:** Senior Tech Lead + Intern #1 (FE) · **Slice plan:** 1 slice, 3 FRs · **Plan refs:** plan §C3 watchlists collection, §D4 endpoints `/v1/products/track` and `/v1/watchlists`

| FR-ID            | Title                                                                                                              | Pri  |        Status        | Depends on             | Effort |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | :--: | :------------------: | ---------------------- | -----: |
| **FR-WATCH-001** | `POST /v1/products/track` — paste shopee.vn URL → resolve via Affiliate API → upsert product + watchlist row       | MUST | shipped + mocked-dependency (2026-05-18) | FR-AFF-001, FR-AFF-003 |     6h |
| **FR-WATCH-002** | `PATCH /v1/watchlists/:id` — configure alert triggers (`absolute_drop` / `pct_drop` / `lowest_30d` / `flash_sale`) | MUST | shipped + strict-audited (2026-05-18) | FR-WATCH-001           |     5h |
| **FR-WATCH-003** | `GET /v1/watchlists` list + pause/resume/delete + free-tier 10-product cap enforcement                             | MUST | shipped + strict-audited (2026-05-18) | FR-WATCH-001           |     4h |

### P1.3 — PRICE · price history (TimescaleDB)

**Owner:** Senior Tech Lead · **Slice plan:** 1 slice, 2 FRs · **Plan refs:** plan §C3 PriceHistory schema, §D3 SQL hypertable + continuous aggregate

| FR-ID            | Title                                                                                                       | Pri  |                Status                 | Depends on                 | Effort |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | :--: | :-----------------------------------: | -------------------------- | -----: |
| **FR-PRICE-001** | TimescaleDB `price_history` hypertable + 30-min rolling continuous aggregate + 30/90 day retention policies | MUST | shipped + strict-audited (2026-05-18) | —                          |     6h |
| **FR-PRICE-002** | `GET /v1/products/:id/history?range=30d` — chart-ready time-series for FE                                   | MUST | shipped + strict-audited (2026-05-18) | FR-PRICE-001, FR-WATCH-001 |     4h |

### P1.4 — NOTIF · email alert dispatch + web push

**Owner:** Intern #2 (BE) · **Slice plan:** 1 slice, 2 FRs · **Plan refs:** plan §C6 (Resend), §C7 (Web Push)

| FR-ID            | Title                                                                                         |  Pri   |        Status        | Depends on                 | Effort |
| ---------------- | --------------------------------------------------------------------------------------------- | :----: | :------------------: | -------------------------- | -----: |
| **FR-NOTIF-001** | Email alert via Resend — React Email template · idempotency-key dedup · 365-day TTL audit log |  MUST  | shipped + mocked-dependency (2026-05-18) | FR-WATCH-002, FR-LEGAL-002 |     6h |
| **FR-NOTIF-002** | Web Push (VAPID + service worker) — Chrome/Edge/Android only; iOS falls back to email         | SHOULD | shipped + mocked-dependency (2026-05-19) | FR-NOTIF-001               |     5h |

### P1.5 — EXT · browser extension MV3 (Lite scope)

**Owner:** Intern #1 (FE) · **Slice plan:** 1 slice, 1 FR · **Plan refs:** plan §B4 (Chrome Web Store Affiliate Ads Policy), §C9 (MV3 re-scope), §H risk matrix (Shopee block extension)

| FR-ID          | Title                                                                                                                                                    | Pri  |        Status        | Depends on                              | Effort |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------------------: | --------------------------------------- | -----: |
| **FR-EXT-001** | Chrome MV3 extension — "+ Theo dõi giá" floating button on `*://*.shopee.vn/-i.*.*` product pages; disclosure-first; no `<all_urls>`; no cart-API scrape | MUST | shipped + strict-audited (2026-05-19) | FR-AUTH-003, FR-WATCH-001, FR-LEGAL-002 |    12h |

---

## §4 — P2 · Growth & Monetization (week 8-18)

**Phase goal:** turn the MVP into a freemium business. Add Telegram bot (high VN affinity), web push for already-installed users, Stripe + VNPay/MoMo billing, the viral "Mega Sale Mode" UI for the 9.9/10.10/11.11/12.12 PR moments, and a public B2B contact form for the Price Intelligence pivot.

**Exit metrics (plan §I, Phase 2):** MAU ≥ 10,000 · DAU/MAU stickiness ≥ 20% · Avg products tracked/user ≥ 8 · D30 retention ≥ 35% · Free→Pro conversion ≥ 5% · MRR ≥ 30M ₫ ($1.2K) · CAC ≤ 30K ₫.

### P2.1 — BILL · freemium subscription (Stripe + VNPay/MoMo)

**Owner:** Senior Tech Lead · **Slice plan:** 1 slice, 1 FR · **Plan refs:** plan §E2 (Freemium pricing), §E3 (unit economics)

| FR-ID           | Title                                                                                                                                 | Pri  |        Status        | Depends on                | Effort |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------------------: | ------------------------- | -----: |
| **FR-BILL-001** | Freemium tiers — Free (10 products, 6h check) · Pro 39K₫/mo · Pro+ 89K₫/mo — Stripe primary + VNPay/MoMo VN cards · webhook lifecycle | MUST | shipped + mocked-dependency (2026-05-19) | FR-AUTH-003, FR-WATCH-003 |    12h |

### P2.2 — NOTIF · Telegram bot + multi-channel routing

**Owner:** Intern #2 (BE) · **Slice plan:** 1 slice, 1 FR · **Plan refs:** plan §C7 (recommendation: add Telegram bot fallback), §J Phase 2 (Telegram bot integration)

| FR-ID            | Title                                                                                         | Pri  |        Status        | Depends on   | Effort |
| ---------------- | --------------------------------------------------------------------------------------------- | :--: | :------------------: | ------------ | -----: |
| **FR-NOTIF-003** | Telegram bot — `/start <userId>` link · per-user push channel · same idempotency log as email | MUST | shipped + mocked-dependency (2026-05-19) | FR-NOTIF-001 |     6h |

### P2.3 — GROW · viral loops + referrals + Mega Sale Mode

**Owner:** Growth/Marketing lead (Phase 2 hire) + Intern #1 · **Slice plan:** 1 slice, 3 FRs · **Plan refs:** plan §F3 (Mega Sale Strategy), §F4 (Viral loops)

| FR-ID           | Title                                                                                                        |  Pri   |        Status        | Depends on                 | Effort |
| --------------- | ------------------------------------------------------------------------------------------------------------ | :----: | :------------------: | -------------------------- | -----: |
| **FR-GROW-001** | Referral program — invite 3 friends → unlock Pro 1 month; viral coefficient k≥0.4 target                     |  MUST  | shipped + strict-audited (2026-05-19) | FR-AUTH-003, FR-BILL-001   |     6h |
| **FR-GROW-002** | "Chia deal cho bạn" — copy-share user-tagged Affiliate deeplink + landing page with TT "Theo dõi giá" CTA    |  MUST  | shipped + strict-audited (implemented-scope, 2026-05-19) | FR-AFF-002, FR-NOTIF-001   |     5h |
| **FR-GROW-003** | Mega Sale Mode — event-themed UI · gamification leaderboard · 7-day-pre push · auto-tweet/Facebook auto-post | SHOULD | shipped + strict-audited (implemented-scope, 2026-05-19) | FR-NOTIF-001, FR-NOTIF-002 |     8h |

### P2.4 — ADMIN · B2B contact form (Price Intelligence lead capture)

**Owner:** Founder + Intern #1 · **Slice plan:** 1 slice, 1 FR · **Plan refs:** plan §E5 (B2B Price Intelligence SaaS), §J Phase 2

| FR-ID            | Title                                                                                       |  Pri   |        Status        | Depends on | Effort |
| ---------------- | ------------------------------------------------------------------------------------------- | :----: | :------------------: | ---------- | -----: |
| **FR-ADMIN-001** | Public B2B contact form — lead capture for Mall/Brand sellers wanting price-intel dashboard | SHOULD | shipped + mocked-dependency (2026-05-19) | —          |     3h |

---

## §5 — P3 · Power, Multi-platform, B2B (M+5..12)

**Phase goal:** prove the architecture scales horizontally (Lazada + TikTok Shop) and that the B2B Price Intelligence pivot is a fundable wedge. Mobile app (React Native) goes out so non-extension users can convert.

**Status:** roadmap rows plus P3 authoring kickoff — `FR-AFF-005`, `FR-AFF-006`, and `FR-AFF-007` are now drafted, while the remaining P3 rows stay roadmap-only until re-batching completes. Will be re-batched after P2 exit metrics are in. Plan refs: §J Phase 3.

| FR-ID (planned) | Title                                                                               |  Pri   | Phase ref |
| --------------- | ----------------------------------------------------------------------------------- | :----: | --------- |
| FR-AFF-005      | Lazada Affiliate API integration (parallel to Shopee)                               |  MUST  | P3        |
| FR-AFF-006      | TikTok Shop affiliate integration (if public API ready)                             | SHOULD | P3        |
| FR-WATCH-004    | React Native / Flutter mobile native app — re-use Phase 1 logic                     |  MUST  | P3        |
| FR-NOTIF-004    | Mobile push (FCM) — primary channel for mobile users                                |  MUST  | P3        |
| FR-ADMIN-002    | B2B Price Intelligence Dashboard — historical pricing for sellers/brands            |  MUST  | P3        |
| FR-ADMIN-003    | Coupon aggregator (Honey-trap-aware design — disclosure-first, no override)         | COULD  | P3        |
| FR-ADMIN-004    | Multi-region routing — Singapore primary, SG MongoDB Atlas region                   |  MUST  | P3        |
| FR-AFF-007      | Generic Affiliate Network fallback (AccessTrade publisher) when Shopee direct fails |  MUST  | P3        |
| FR-AFF-008      | Pivot-ready architecture — `platform` field on PriceHistory + Product collections   |  MUST  | P3        |
| FR-OBS-002      | Tail-sampling 10/100% + tenant-aware Grafana scoping for B2B customers              |  MUST  | P3        |

---

## §6 — P4 · Regional + AI (M+12..24)

**Phase goal:** prove regional expansion (one new country first — TH or PH) with full localization, and start the ML deal-scoring + smart-wishlist + price-prediction work that turns SaleNoti into an "intelligent assistant" rather than a "price tracker."

**Status:** roadmap rows only. Plan refs: §J Phase 4, §K2 Horizontal expansion SEA.

| FR-ID (planned) | Title                                                                                            |  Pri   | Phase ref |
| --------------- | ------------------------------------------------------------------------------------------------ | :----: | --------- |
| FR-AFF-009      | Localize Shopee Affiliate to one of `{TH, PH, MY, ID}` — Thai language + currency + KOC roster   |  MUST  | P4        |
| FR-PRICE-003    | ML deal-scoring model — classify each detected price drop as "real deal" vs "false alarm"        |  MUST  | P4        |
| FR-WATCH-005    | Smart wishlist — recommend similar-product price targets from history embedding similarity       | SHOULD | P4        |
| FR-PRICE-004    | Price prediction model — 7-day forward forecast (LightGBM baseline + LSTM upgrade)               | COULD  | P4        |
| FR-ADMIN-005    | Sponsored deals — paid "Top deal hôm nay" placement; labelled "Tài trợ" with disclosure          | COULD  | P4        |
| FR-ADMIN-006    | Data licensing API — sell price-history aggregates to market research firms (~$1K/mo per client) | COULD  | P4        |

---

## §7 — Cross-cutting watch-items (every phase)

These are not FRs but live audit attention points lifted from plan §H (Risk Matrix) and §C (Tech Stack review). Each row maps to an existing FR's `risk_if_skipped` field.

| Watch-item                                                      | Plan ref                      | FR(s) where this lands                                                                         |
| --------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Shopee Affiliate API contract change / deprecation              | §H — Affiliate API thay đổi   | FR-AFF-001 (circuit-breaker), FR-AFF-007 (fallback)                                            |
| Shopee block extension (cease & desist over scraping)           | §H — Shopee block extension   | FR-EXT-001 (strict MV3 scope), §10 fallback (bookmarklet + Save URL)                           |
| Chrome Web Store reject extension                               | §H — Chrome Web Store reject  | FR-LEGAL-002 (disclosure surfaces), FR-EXT-001 (Affiliate Ads Policy compliance)               |
| Honey-style scandal — affiliate cookie override / coupon hijack | §A3, §B5 — code of ethics     | FR-AFF-002 (user-initiated only), FR-LEGAL-002 (transparency report quarterly)                 |
| Intern team can't deliver in 10-16 weeks                        | §H — Intern không deliver kịp | Senior Tech Lead **full-time** is the mitigation; backlog effort sized for this team shape     |
| Hết runway before P2 monetization clicks                        | §H — Hết runway               | Bootstrap with CyberSkill safety-net 6 months; FR-BILL-001 prioritized to land week 14         |
| PDPL violation / Nghị định 13 enforcement                       | §H — PDPL violation; §B3      | FR-LEGAL-001 (DPIA + DPO + A05); 72h breach notification automated through CA05 form generator |
| Vercel/Railway free-tier overage / cost overrun                 | §H — Vercel/Railway burst     | FR-OBS-001 (cost alerts) + multi-cloud Plan B documented                                       |

---

## §8 — Manifest

Source state file: [`MANIFEST.json`](MANIFEST.json) — tracks per-module FR counters and batch history. Maintained manually at MVP scale per [`../FR_AUTHORING_WORKFLOW.md`](../FR_AUTHORING_WORKFLOW.md) §3.

When adding a new FR:

1. Update the relevant phase + module section in this file.
2. Increment `MANIFEST.json` → `last_fr_id_per_module.<MODULE>`.
3. Create the FR markdown in `docs/feature-requests/<module>/` following the workflow.
4. Two-round audit per workflow §5; reach 10/10 before `status: accepted`.

---

_End of SaleNoti backlog v0.1.0. 26 FRs shipped (2026-05-17), re-audited with implementation traceability (2026-05-18), 16 roadmapped. Re-generate after every status change in the FR files._
