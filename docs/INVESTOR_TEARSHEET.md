# SaleNoti — Investor Tear-Sheet (Pre-Seed)

**Stage:** Pre-MVP, raising soft commitments for $50K–$150K SAFE.
**Build status:** 26 functional requirements authored at 10/10 audit grade, ~170 files of scaffolded + starter code, legal pack drafted (DPIA + DPO + Privacy Policy). MVP launch target: ~Week 8 from credentials-in-hand.
**Founder:** Stephen Cheng (Trịnh Thái Anh) — Founder/CEO, CyberSkill JSC (est. 2020, DUNS 673219568, 10 employees).
**Contact:** stephen@cyberskill.world · +84 906 878 091

---

## 1. One-line thesis

Vietnam's price-tracking layer for Shopee — affiliate revenue + freemium SaaS — built with the trust moat that Honey/PayPal lost, before regional aggregators (ShopBack, BeCashback) consolidate the category.

## 2. The deal in a sentence

We're the first Vietnamese price tracker that's **affiliate-disclosed by design**: every alert, every link, every surface tells the user we earn a 1.5–5% commission, and our code mechanically prevents the five behaviors that destroyed Honey's reputation. That credibility is the moat.

## 3. Why now

- **Decree 13/2023/NĐ-CP (PDPL)** enforcement formally started 2025–2026 — every B2C startup must publish a DPIA and quarterly transparency. We're treating this as a moat-thickening forcing function, not a tax.
- **Chrome Web Store Affiliate Ads Policy 3/2025 (enforce 10/6/2025)** rejected ~40% of affiliate extension submissions in 2025. Our disclosure-first architecture passes day one.
- **Honey scandal (Q4 2024)** destroyed consumer trust in deal-tracker browser extensions globally. The category needs a clean redo in every market — VN is open.
- **Vietnamese e-commerce 2025 GMV ~$28B** (Shopee 56% + TikTok Shop 41% + Lazada 34% YoY growth). Price volatility on Shopee Mall is high; alert utility is concrete.
- **Personas converge:** plan §F1 shows Gen-Z (35%) + Mẹ bỉm sữa 25-35 (25%) + students (20%) all share the same primary behavior — track deal pages on Facebook groups manually. SaleNoti's wedge is automating that one act.

## 4. Wedge → moat → market

| Layer | What | Why it compounds |
|---|---|---|
| Wedge | Free Chrome extension: paste shopee.vn URL → email when price drops. | Lowest UX friction in the category. |
| Compound 1 | Every user adds 2–10 watched products → we own a daily-updated price-history dataset. | Network-data moat. |
| Compound 2 | Quarterly Transparency Reports build the only public-record affiliate-trust narrative in VN. | Brand moat (Honey didn't). |
| Compound 3 | At 10K+ tracked products we open B2B Price Intelligence API — sellers buy historical pricing telemetry. | ARR scalable ($500K–$5M per seller). |
| Compound 4 | Multi-platform (Lazada / TikTok Shop) + SEA localization (TH/PH/MY/ID) reuses the same architecture. | TAM expansion without re-build. |

## 5. Architecture you can read

- **Frontend:** Next.js 15 App Router · React 19 · PWA · Tailwind.
- **Backend:** NestJS 10 + BullMQ + adaptive scheduler (30m / 6h / 24h tiers) sized for 100K products under Shopee's 1000 req/min API budget.
- **Hot data:** MongoDB Atlas (SG region) · Time-series: TimescaleDB (Neon) with 30-min continuous aggregate.
- **Browser:** Manifest V3, strict `*://*.shopee.vn/*` scope — no `<all_urls>`, no internal Shopee API scraping. Chrome Web Store Affiliate Ads Policy compliant by construction.
- **Auth:** Auth.js v5 pinned to `5.0.0-beta.25`. JWT refresh rotation with reuse-detection (family revoke).
- **Observability:** Sentry + PostHog (PII-hashed) + Better Stack. All free-tier until ~10K MAU.

26 functional requirements, every clause normative (BCP-14), every requirement audited to 10/10 against an engineering-spec template. Backlog at [`docs/feature-requests/BACKLOG.md`](feature-requests/BACKLOG.md).

## 6. Compliance moat (the part that's hard to copy)

| Mechanism | Where it lives in code | Effect |
|---|---|---|
| PDPL Decree 13 DPIA filed with A05 | [`docs/legal/DPIA-2026-05.md`](legal/DPIA-2026-05.md) | Legitimacy + 72-hour breach process pre-built. |
| 5 ethical principles enforced in CI | `pnpm fr:check && pnpm legal:check` | ORDER BY commission rejected at lint time. |
| Custom ESLint `no-auto-apply-coupon` rule | [`eslint-rules/no-auto-apply-coupon.cjs`](../eslint-rules/no-auto-apply-coupon.cjs) | Any future engineer adding auto-coupon code is blocked at PR time. |
| Disclosure paragraph snapshot test | `apps/web/src/components/disclosure/__tests__/disclosure.spec.tsx` | Wording drift in any of 6 surfaces fails CI. |
| Refresh-token reuse-detection | `apps/web/src/server/auth/refresh.ts` | Stolen sessions detected on legitimate user's next refresh; family revoked. |
| Bull Board hard-fail without auth | `apps/api/src/admin/bull-board.controller.ts` | Cannot accidentally expose ops dashboard. |

## 7. Plan §I targets (the milestones we measure against)

| Phase | Window | Headline target | Compliance gate |
|---|---|---|---|
| P0 — Foundation | Week 0–2 | DPIA filed · Auth.js pinned · BullMQ live | A05 acknowledgement |
| P1 — MVP | Week 2–8 | 1,000 signups · 10,000 products tracked · D7 ≥ 25% · CTR ≥ 25% | Chrome Web Store approved |
| P2 — Growth | Week 8–18 | MAU 10K · MRR 30M ₫ ($1.2K) · Free→Pro ≥ 5% | First Transparency Report (Q3 2026) |
| P3 — Multi-platform | M+5..12 | MAU 100K · ARPU $0.5 · LTV/CAC ≥ 1.8 | B2B Price Intel pilot $1K MRR seller |
| P4 — Regional + AI | M+12..24 | +1 country (TH/PH) · ML deal-score AUC ≥ 0.85 | SOC 2 Type II |

## 8. Unit economics (plan §E3, pessimistic)

| Metric | Value |
|---|---:|
| 10K user MAU | 1,000 paying (10%) at 39K ₫/mo Pro |
| Pro subscription MRR | 39M ₫ ($1,560) |
| Affiliate revenue (10K free + 1K Pro × $0.15 ARPU) | 4.5K + 0.5K ARR ≈ 25M ₫/mo |
| Total revenue (10K MAU) | ~64M ₫/mo ($2.6K) |
| Cost stack (Vercel Pro $20 · Railway $87 · Mongo Atlas M10 $57 · Timescale Cloud $25 · Upstash Pro $10 · Resend $20 · Sentry/PostHog free · Domain $5) | ~$224/mo |
| Founder + 2 interns + 1 senior tech lead part-time @ ~$4K/mo | ~$4K/mo |
| **Net at 10K MAU** | **-$1.6K/mo (pre-break-even)** |
| **Break-even at MAU ~30K · MRR ~$5K** | Within 18 months |

## 9. Ask

- **$50K SAFE** (cap $4M post · 20% discount) — 4 months runway @ Senior Tech Lead full-time + Marketing/Growth lead (P2).
- **$100K SAFE** stretch — 8 months runway including Phase 2 B2B pilot + Chrome Web Store paid acquisition.
- **$150K SAFE** ceiling — 12 months runway through Phase 3 multi-platform expansion (Lazada + TikTok Shop integration).

**Investor target list:** Antler VN ($120K, 12% SAFE, 9 months matching), ThinkZone Fund II, AVV (500 Startups VN), Do Ventures, Peony, NIC (Vietnam Innovation Network grant matching).

## 10. Risks (plan §H — already mitigated in spec)

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| Shopee Affiliate API contract change / deprecation | Medium | Circuit breaker + AccessTrade fallback (FR-AFF-001 §10 + roadmap P3) |
| Shopee blocks extension (cease & desist) | Low | Strict MV3 scope, zero internal API calls, Affiliate-only sourcing (FR-EXT-001 §1 #9) |
| Chrome Web Store rejects extension | Medium | Disclosure-first onboarding + store-listing canonical copy + CI gate (FR-LEGAL-002 + FR-EXT-001) |
| Honey-style trust scandal lookalike | Catastrophic | 5-principles firewall in CI + Quarterly Transparency Reports (FR-LEGAL-002 §1 #7) |
| Intern team can't deliver in 10–16 weeks | High | Senior Tech Lead full-time is the explicit gate (TASKS.md week-0 line item) |
| PDPL violation / A05 enforcement | Low | DPIA filed day 1; DPO appointed; 72h breach template + auto-detector (FR-LEGAL-001) |
| Vercel/Railway free-tier overage | Medium | OBS-001 cost alerts + multi-cloud Plan B documented |

## 11. Why the founder

- **Stephen Cheng (Trịnh Thái Anh)** — Founder/CEO of CyberSkill JSC since 2020. 5 years building software solutions consultancy for Vietnamese SMBs + select Western clients. Personal stake: this is the first product CyberSkill is launching as its own consumer brand, not on behalf of a client.
- **"Turn Your Will Into Real"** is CyberSkill's tagline. SaleNoti is the first proof point at scale.
- **Skin in the game:** founder is providing the Senior Tech Lead's $30–40M ₫/month salary from CyberSkill consulting revenue for the first 4 months of MVP build — investors fund Phase 2 growth, not Phase 1 build risk.

## 12. What you get if this works

| Scale point | Outcome |
|---|---|
| 100K MAU (Phase 3) | $50K MRR · acquihire-eligible (Tiki, MoMo, ZaloPay parents) for $5–15M |
| 500K MAU + B2B pilot | $250K MRR · Series A at $25–50M post |
| Regional (TH/PH/MY/ID) | Comp set: Buyhatke (India, acquired by Times Internet); CamelCamelCamel (US, ind. profitable); ShopBack ($600M valuation) |

---

*This document is a working draft. Last updated 2026-05-16. Cite the FR-IDs in any technical follow-up question.*

**Files an investor diligence reviewer should read first:**

1. [`docs/feature-requests/BACKLOG.md`](feature-requests/BACKLOG.md) — 42 FRs, 5 phases, scope.
2. [`docs/feature-requests/P0_AUDIT_SUMMARY.md`](feature-requests/P0_AUDIT_SUMMARY.md) — engineering rigor sample.
3. [`docs/legal/DPIA-2026-05.md`](legal/DPIA-2026-05.md) — regulatory posture.
4. [`docs/SaleNoti — Plan.pdf`](SaleNoti%20—%20Plan.pdf) — the founder's full plan (34 pages, Vietnamese).
5. [`TASKS.md`](../TASKS.md) — week-by-week execution plan with checkbox tracking.
