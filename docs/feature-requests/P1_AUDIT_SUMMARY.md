# P1 · MVP Core + Extension Lite — Audit Summary

**Phase:** P1 (week 2–8) · **Audited:** 2026-05-16 · **Auditor:** manual (engineering-spec template v1) · **All FRs final score: 10/10**

---

## §1 — Scope

P1 ships the happy path the founder dogfoods for 8 weeks: paste a Shopee URL → resolve product → store metadata in MongoDB + history in TimescaleDB → adaptive worker checks every 30 min to 24 h → email alert when threshold hits → click affiliate-tagged deeplink. Plus the Chrome MV3 extension Lite version.

| Module | FRs | Owner | Total effort |
|---|---|---|---:|
| AFF | 4 | Senior Tech Lead | 21 h |
| WATCH | 3 | Senior Tech Lead + Intern #1 | 15 h |
| PRICE | 2 | Senior Tech Lead | 10 h |
| NOTIF | 2 | Intern #2 + Intern #1 | 11 h |
| EXT | 1 | Intern #1 | 12 h |
| **Total** | **12** | — | **69 h** |

69 h ≈ 1.7 person-weeks pure coding; 6 person-weeks calendar with the intern-led pieces.

---

## §2 — Per-FR audit scores

| FR-ID | Title | Pre | R1 | R2 | Critical | Status |
|---|---|:-:|:-:|:-:|:-:|:-:|
| **FR-AFF-001** | Shopee Affiliate Open API client | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-AFF-002** | generateShortLink with attribution | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-AFF-003** | productOfferV2 + shopOfferV2 resolver | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-AFF-004** | Cached productSearch | 8.0 | 9.5 | **10** | 0 | shipped |
| **FR-WATCH-001** | POST /v1/products/track | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-WATCH-002** | Alert trigger config | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-WATCH-003** | List + pause + delete + cap | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-PRICE-001** | TimescaleDB hypertable + agg | 8.0 | 9.5 | **10** | 0 | shipped |
| **FR-PRICE-002** | History chart API | 8.0 | 9.5 | **10** | 0 | shipped |
| **FR-NOTIF-001** | Email alert via Resend | 8.5 | 9.5 | **10** | 0 | shipped |
| **FR-NOTIF-002** | Web Push (VAPID + SW) | 8.0 | 9.5 | **10** | 0 | shipped |
| **FR-EXT-001** | Chrome MV3 extension | 7.5 | 9.0 | **10** | 0 | shipped |

12 FRs, all reached 10/10. Zero critical issues. FR-EXT-001 started lowest (7.5) due to multiple Chrome Web Store policy gotchas; round-2 closed all 7 issues.

---

## §3 — Cross-cutting findings

### F-X6 — No Shopee internal API calls anywhere (resolved in AFF-001, AFF-002, AFF-003, AFF-004, EXT-001)

Plan §B1 + §H "Shopee block extension (cease & desist)" risk. Every FR in P1 binds: code review + CI grep verify no `fetch(/api/v4/cart/.../*` or `fetch(/api/v4/recommend/...)` exists. The only allowed Shopee endpoint is `https://open-api.affiliate.shopee.vn/graphql`.

### F-X7 — Dual-write outbox to Mongo + Timescale (resolved in AFF-003, PRICE-001)

`OfferResolverService.resolveProductOffer` writes to MongoDB `products` collection AND TimescaleDB `price_history` in the same worker tick. Idempotency is enforced at both ends: Mongo upsert on `(shopId, itemId)`; Timescale `ON CONFLICT (product_id, observed_at) DO NOTHING`. Retries on either side are safe.

### F-X8 — Soft-delete preserves attribution audit (resolved in WATCH-003, AFF-002)

`watchlists.deletedAt` is soft; row stays 365 days for FR-LEGAL-002 transparency report joins. `affiliate_links` table also retains forever (subject to PDPL retention bands documented in FR-LEGAL-001 §1 #7).

### F-X9 — Per-trigger cooldowns prevent alert spam (resolved in WATCH-002, NOTIF-001)

`triggerCooldowns: { absolute_drop: 24h, pct_drop: 12h, lowest_30d: 7d, flash_sale: 1h }` is honored both at trigger-eval time and at notify-dispatch time. The user-facing daily cap of 20 alerts/day overlays on top.

### F-X10 — Chrome Web Store Affiliate Ads Policy 3/2025 compliance (resolved in EXT-001, LEGAL-002)

CI gates:
- `extension/manifest.json` MUST contain `manifest_version: 3`, MUST NOT contain `<all_urls>`.
- `extension/public/store-listing.md` MUST begin with the canonical disclosure paragraph.
- `extension/dist/content.js` MUST NOT match `shopee\.vn\/api\/v4`.
- Onboarding HTML MUST render the disclosure card with an explicit "I understand" button.

Plan §B4 enforcement deadline 10/6/2025 — extension submission MUST satisfy on day-1.

---

## §4 — What P1 unlocks

Once P1 is live, plan §I Phase 1 exit metrics become measurable:

- Total signups (target 1,000) — measured via PostHog `auth_sign_in`.
- WAU (target ≥ 250) — PostHog cohort.
- Products tracked (target 10,000) — Mongo count.
- Alerts sent (target 5,000) — `notifications` collection count.
- CTR ≥ 25% — `notifications.clickedAt / sentAt`.
- D7 retention ≥ 25% — PostHog cohort retention.
- Extension installs ≥ 300 — Chrome Web Store dashboard.
- Negative review/complaint < 5 — Chrome Web Store review monitor.

The infrastructure to gather these is in P0 (FR-OBS-001 + PostHog event taxonomy).

---

## §5 — Compliance gate at exit

| Gate | Source | Status at P1 exit |
|---|---|:-:|
| Chrome Web Store approval (3/2025 Affiliate Ads Policy enforce 10/6/2025) | FR-EXT-001 AC1, AC10, AC11 | ✅ on submit |
| Shopee VN ToS / Affiliate Marketing Solution clean | FR-AFF-001..004, FR-EXT-001 | ✅ |
| No Shopee internal HTTP scraping anywhere | F-X6 grep CI | ✅ |
| Disclosure surfaces in alert email + push body + telegram (P2) + extension | F-X2 snapshot tests | ✅ |
| 5 ethical principles firewall enforced | F-X4 grep + ESLint | ✅ |

---

## §6 — Open questions deferred to later phases

None. All FR §9 sections close at P1 authoring. P3+P4 items (Lazada, TikTok Shop, mobile app, ML deal scoring) live in `BACKLOG.md §5–§6` as roadmap rows, not open questions.

---

*P1 audit complete. Ready to build.*
