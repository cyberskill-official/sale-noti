---
fr_id: FR-GROW-002
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.5/10
score_post_revision_1: 9.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 10
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-GROW-002 ships ship-grade after two rounds. The growth-funnel design (land-on-our-page-not-Shopee, dual-CTA, sharer-name social proof) is the right architecture for the Vietnamese context per plan §F4. Bot-detection on the 302 handler is the load-bearing addition from round-2 — without it, click conversion metrics are meaningless because every Zalo/Facebook paste inflates the count via crawler hits.

Round-1: 6 issues (rate-limit absent, no affiliate-failure fallback, bot inflation undetected, no expiry path, sharer-name privacy unclear, no OG meta). Round-2: 4 (race in conversion attribution, sourceWatchlistId schema, XSS in sharer name, ttc_seconds units).

All 10 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Rate limit missing (spam vector)
- **severity:** error · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #9 60/day + 5/product/day; AC2+AC3 cover.

### ISS-002 — Affiliate API failure blocks share creation
- **severity:** error · **rule_id:** dependency-isolation
- **status:** RESOLVED — §1 #5 + §6 try/catch with `affiliateLink: null` fallback; AC10 covers; §10 row 1 documents.

### ISS-003 — Click count inflated by social-platform crawlers
- **severity:** error · **rule_id:** correctness-at-scale
- **status:** RESOLVED — §1 #14 + §6 `isBotUserAgent`; AC5 verifies TelegramBot path.

### ISS-004 — Expired shares 404 silently (poor UX)
- **severity:** warning · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #10 redirect to `/deal/expired`; AC9 verifies.

### ISS-005 — Sharer-name privacy choice ambiguous
- **severity:** warning · **rule_id:** privacy
- **status:** RESOLVED — §1 #12 + §2 paragraph (opt-in default, explicit toggle); AC8 verifies opt-out path.

### ISS-006 — OpenGraph meta tags missing (rich previews broken)
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #13 + §6 `renderOpenGraphOnly`; AC11 verifies Facebook preview.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Conversion attribution race condition
- **severity:** warning · **rule_id:** correctness
- **status:** RESOLVED — §6 `onShareConvert` checks `conversionCount > 0` before emit; §10 row 13 documents.

### ISS-008 — sourceWatchlistId not in DB schema
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #6 + §3 schema include sourceWatchlistId; AC13 verifies.

### ISS-009 — XSS in sharer-name display
- **severity:** error · **rule_id:** xss
- **status:** RESOLVED — §10 row 12 + React auto-escape policy documented.

### ISS-010 — `ttc_seconds` units ambiguous in analytics payload
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §6 `(Date.now() - createdAt.getTime()) / 1000` explicit; PostHog property documented as seconds.

## §4 — Strengths preserved

- **Dual-CTA pattern** (Theo dõi giá primary, Mua trên Shopee secondary) reflects growth-over-affiliate priority and is the central commercial-vs-product trade-off resolved explicitly.
- **Bot-detection on 302** preserves conversion-rate metric integrity; without it, ~40% of clicks would be crawler noise (typical Zalo+Facebook paste behavior).
- **Affiliate-failure soft-degrade** keeps share-creation working even when Shopee Open API is down; the share is the asset, the affiliate link is the (recoverable) bonus.
- **90-day TTL with `/deal/expired` recovery page** balances data hygiene with UX continuity — old links don't 404, they re-funnel into watchlist creation.
- **§10 has 13 failure-mode rows** including the subtle "sharer deletes account" + "Shopee removes product" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. P2 growth lever; second-highest-leverage after FR-GROW-001. Combined with referral (GROW-001) and Mega Sale (GROW-003), drives ~40% of organic acquisition per plan §F4 model.

---

*End of FR-GROW-002 audit (round 2 final). Last revised: 2026-05-16.*
