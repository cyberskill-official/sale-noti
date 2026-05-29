# FR-ADMIN-002 Audit Round 1

**Date:** 2026-05-29  
**Auditor:** Architecture review  
**Source:** [FR-ADMIN-002-b2b-price-intelligence-dashboard.md](FR-ADMIN-002-b2b-price-intelligence-dashboard.md)  
**Status:** ⏳ **IN PROGRESS** (needs findings response)

---

## Audit findings summary

### ✅ Spec clarity

The spec is well-structured with:
- Clear BCP-14 normative clauses (14 items in §1)
- Four concrete APIs with Zod schemas (search, history, analytics, dashboard UI)
- 12 acceptance criteria covering main flows + edge cases
- Risk matrix with 5 identified threats + mitigations
- Open questions section with decisions documented

**Finding:** None on structure; spec meets writing standard.

---

### ✅ API contract consistency

Reviewed all three API endpoints:

1. **Search** — `GET /api/admin/products/search?q=...&limit=50&offset=0`
   - Row-level security enforced (seller can only see own products)
   - Rate-limit 10/min/user ✅
   - Returns paginated results with productId, currentPrice, lastFetchedAt ✅

2. **History** — `GET /api/admin/products/:productId/history?range=7d|30d|90d`
   - Uses pre-aggregated TimescaleDB buckets ✅
   - 30-min buckets for 7d, 4-hour for 30d, daily for 90d ✅
   - Cached 1 hour ✅
   - Returns timestamps[], prices[], discounts[], min/max/avg ✅

3. **Analytics** — `GET /api/admin/products/:productId/analytics?range=7d|30d|90d`
   - 7 KPI fields returned: floorPrice, volatility (CV), salesTrend, alertsTriggered, competitorCount, recommendedPricePoint ✅
   - Cached 6 hours (reasonable for less-time-critical KPIs) ✅

**Finding:** None; all three APIs have clear contracts + caching strategy + rate-limits.

---

### ✅ PII handling & PDPL compliance

Spec cites PDPL Article 25 (audit trail) and demands:
- Row-level security (§1 #11) — seller A cannot see seller B's data ✅
- PII masking (§1 #7) — no buyer reviews or competitor emails ✅
- Audit logging (§1 #10) — `audit:b2b_access` trail with userId, sellerId, action, timestamp ✅
- Retention schedule (§1 #10) — 36mo for won, 12mo for lost, 6mo for new (per FR-LEGAL-001 schedule) ✅
- Audit trail retention — 3 years for active, 1 year post-churn ✅

**Finding:** Spec correctly implements multi-layer PII protection. Note to implementation: audit trail columns match PDPL requirements.

---

### ⚠️ Tiered feature parity clarification

**Issue:** §1 #12 defines three tiers (Starter $99, Growth $299, Enterprise custom) with different limits:
- Starter: dashboard, 10 products, 5K API/mo, 7d history
- Growth: + alerts + 50 products + 50K API/mo + 90d history + daily digest
- Enterprise: unlimited

But the spec doesn't clarify:
1. How does the subscription creation flow work? (Depends on FR-BILL-001 which is P2, not yet implemented in context)
2. When does a seller's tier change trigger a dashboard UI refresh/restriction? (e.g., Growth user downgrades to Starter, suddenly sees 40+ products but can only track 10)
3. Does the API gateway hard-block API calls > quota, or soft-warn at 80%?

**Finding:** Open decision in §8 already acknowledges "who owns Stripe webhook — billing or engineering?" Recommend: 
- Stripe webhook handling deferred to FR-BILL-001 implementation context (P3.1 or later)
- For FR-ADMIN-002 scope: assume `b2b_subscriptions` table is pre-populated by a separate billing system; just read the tier and enforce quotas in the API gateway

---

### ⚠️ Continuous aggregate optimization

**Issue:** §5 defines `price_history_1h` continuous aggregate but doesn't mention:
1. When is the aggregate refreshed? (TimescaleDB default is next refresh policy, not real-time)
2. If a user queries 7d history and the aggregate is only 12 hours old, do they see stale data?
3. Should we use `ON CONFLICT DO NOTHING` or `REPLACE` for late-arriving samples?

**Finding:** These are implementation details, not spec gaps. Recommendation for implementation:
- Use TimescaleDB default refresh policy (every 1h); acceptable staleness for 7d/30d/90d queries
- Document the refresh timing in code comments
- Late-arriving samples: use `ON CONFLICT UPDATE` to re-aggregate if price corrected within 24h

---

### ✅ Daily digest email flow

**Issue:** §1 #9 says "daily digest at 09:00 ICT" but doesn't specify:
1. Who owns the email template? (Resend? React Email like FR-NOTIF-001?)
2. How to handle unsubscribe links? (Should be one-click, not requiring login)

**Finding:** Minor gap, but solvable. Recommendation:
- Reuse React Email template from FR-NOTIF-001 (standardize on Resend)
- Unsubscribe link is a JWT-signed token (like magic-link in FR-AUTH-002) that hits `PATCH /api/admin/subscriptions/unsubscribe?token=...` to set `status: "cancelled"`

---

### ✅ Data freshness guarantees

**Issue:** Spec promises "historical pricing for sellers" but doesn't explicitly guarantee:
1. How often is price ingested? (Depends on FR-WORKER-002 scheduler + FR-PRICE-001 hypertable)
2. Max lag between real Shopee price and dashboard display?

**Finding:** This is a dependency on upstream FRs (WORKER-002, PRICE-001), not a gap in FR-ADMIN-002 spec. The dashboard will reflect whatever cadence the worker achieves. Acceptable to leave as-is since caller already authored those FRs.

---

### ✅ Export functionality edge cases

**Issue:** §1 #14 says "generate CSV within 4h" but:
1. What if seller exports 2+ times in one day — are both queued, or does the 2nd cancel the 1st?
2. CSV format — does it include alert config, just prices, or full KPI snapshot?

**Finding:** Implementation detail. Recommendation:
- Allow concurrent export jobs; if user exports twice, both complete independently
- CSV format: date, price, discount%, flags (e.g., "flash_sale_detected")
- Add audit note on export: `{ exportRequestedBy, exportedAt, range, rowCount }`

---

### ✅ Acceptance criteria coverage

All 12 ACs in §4 are well-targeted:
- AC1-3: happy-path search/history/analytics
- AC4-5: quota enforcement + tier limits
- AC6-7: dashboard pages (landing + product detail)
- AC8-9: alert config + daily digest
- AC10-11: export + audit logging
- AC12: security (cross-seller prevention)

**Finding:** None; ACs are comprehensive and testable.

---

### ⚠️ Competitor count calculation

**Issue:** §1 #4 `competitorCountInCategory` — how is "category" defined?
1. Shopee category from product metadata?
2. Same as the primary seller's category, or all sellers in that category?
3. Real-time query or pre-cached?

**Finding:** Minor spec gap. Recommendation:
- Use Shopee's category from product metadata (e.g., "Men's T-Shirt")
- Count all other sellers in the same category (not just direct competitors)
- Cache for 24h (less critical than price freshness)

---

## Summary

| Category | Count | Status |
|---|---|---|
| Spec clarity | ✅ 4 | All clear |
| API contracts | ✅ 3 | All consistent |
| PII/PDPL | ✅ 4 | All compliant |
| Tiering logic | ⚠️ 1 | Deferred to FR-BILL-001 integration |
| Aggregation | ⚠️ 1 | Implementation detail (refresh policy) |
| Digest email | ✅ 1 | Reuse FR-NOTIF-001 pattern |
| Data freshness | ✅ 1 | Dependency on upstream FRs |
| Export UX | ⚠️ 1 | Implementation detail (concurrent jobs) |
| Category definition | ⚠️ 1 | Recommend: use Shopee metadata + 24h cache |
| Acceptance criteria | ✅ 12 | All comprehensive |

---

## Verdict

**Score: 8.5/10** — Spec is solid, foundational, with minor implementation details to be resolved during coding.

### Issues to address before implementation

1. **Tier subscription integration:** Clarify assumption that `b2b_subscriptions` pre-exists; implement reads only for FR-ADMIN-002 (billing creation deferred).
2. **Continuous aggregate refresh:** Document refresh policy + acceptable staleness in code.
3. **Competitor category definition:** Use Shopee product category + 24h cache.
4. **Daily digest unsubscribe:** Use JWT token + dedicated API route (follow FR-AUTH-002 magic-link pattern).
5. **Export CSV format:** Document columns (date, price, discount%, flags).

### Ready for next phase?

**YES** — with the above clarifications added to implementation comments. Proceed to vòng 2 audit only if major API changes needed; otherwise green-light for implementation.

---

**Auditor sign-off:** Architecture review complete. Recommend: implement tier-reading from existing b2b_subscriptions table; defer Stripe webhook setup to FR-BILL-001 context.
