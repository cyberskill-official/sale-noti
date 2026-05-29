# FR-ADMIN-002 Audit vòng 2

**Date:** 2026-05-29  
**Auditor:** Architecture review  
**Source:** [FR-ADMIN-002-b2b-price-intelligence-dashboard.md](FR-ADMIN-002-b2b-price-intelligence-dashboard.md)  
**Status:** ✅ **APPROVED FOR IMPLEMENTATION**

---

## Summary of vòng 1 findings & responses

### Finding 1: Tier subscription integration ⚠️ → ✅ ADDRESSED

**Original finding:** Spec doesn't clarify how subscription creation and tier changes are managed.

**Response:** Added implementation note to §1 #1:
```
Assume b2b_subscriptions table is pre-populated by external billing system 
(Stripe webhook, handled by FR-BILL-001). FR-ADMIN-002 implements reads only; 
tier subscription creation is deferred to FR-BILL-001 context (P3.1 or later).
```

**Verdict:** ✅ Clear. FR-ADMIN-002 assumes table pre-exists and is read-only. Billing creation deferred to FR-BILL-001.

---

### Finding 2: Continuous aggregate refresh policy ⚠️ → ✅ ADDRESSED

**Original finding:** Spec mentions continuous aggregate but doesn't document refresh timing or late-sample handling.

**Response:** Added implementation note to §1 #3:
```
TimescaleDB continuous aggregate price_history_1h refreshes on default policy 
(acceptable 1h staleness for 7d/30d/90d queries). For late-arriving samples 
(corrected prices within 24h), use ON CONFLICT DO UPDATE in aggregation logic 
to re-compute affected buckets.
```

**Verdict:** ✅ Clear. 1h refresh acceptable; late samples handled via ON CONFLICT DO UPDATE.

---

### Finding 3: Competitor category definition ⚠️ → ✅ ADDRESSED

**Original finding:** `competitorCountInCategory` calculation not defined; unclear what "category" means.

**Response:** Added implementation note to §1 #4:
```
competitorCountInCategory is calculated by: 
(a) looking up Shopee category from seller's own product metadata, 
(b) counting all other sellers in that category (not filtered to direct competitors), 
(c) caching for 24h using Redis key b2b:competitor_count:{shopee_category_id} with TTL 86400s.
```

**Verdict:** ✅ Clear. Use Shopee's own category, count all sellers in it, cache 24h.

---

### Finding 4: Daily digest unsubscribe pattern ⚠️ → ✅ ADDRESSED

**Original finding:** Spec says "one-click unsubscribe" but doesn't specify the token pattern.

**Response:** Added implementation note to §1 #9:
```
Unsubscribe link is a one-click JWT-signed token (following FR-AUTH-002 magic-link pattern): 
PATCH /api/admin/subscriptions/unsubscribe?token=<signed_jwt>&email=seller@example.com. 
The token is valid for 30 days and hits the endpoint to set b2b_subscriptions.status = "cancelled". 
Email template is built with React Email (reusing pattern from FR-NOTIF-001) and sent via Resend.
```

**Verdict:** ✅ Clear. Use JWT token (like FR-AUTH-002), React Email (like FR-NOTIF-001), Resend, 30d TTL.

---

### Finding 5: Export CSV format ⚠️ → ✅ ADDRESSED

**Original finding:** Spec says "generate CSV" but doesn't document column format or audit note placement.

**Response:** Added implementation note to §1 #14:
```
CSV format is: date (ISO8601), price (VNĐ), discountPct (0-100), 
flags (comma-separated: "flash_sale"|"below_avg"|"below_min_30d"). 
Each export job is independent (allow concurrent exports); 
audit note is appended as footer lines in CSV 
(e.g., # Exported by <userId> at <timestamp> | <rowCount> rows | Range <startDate>..<endDate>).
```

**Verdict:** ✅ Clear. CSV columns defined; audit note as footer comments; concurrent jobs allowed.

---

## Vòng 2 verification checklist

| Item | Status | Notes |
|---|---|---|
| All 5 vòng 1 findings addressed? | ✅ | All findings have implementation notes in spec §1 |
| API contracts (search, history, analytics) clear? | ✅ | Zod schemas + caching + rate-limits in §3 + §5 |
| PII/PDPL compliance documented? | ✅ | §1 #7, #10, #11 with audit trail retention schedule |
| Acceptance criteria (12 ACs) testable? | ✅ | §4 defines all ACs with given/when/then |
| Risk matrix (5 risks + mitigations) complete? | ✅ | §7 covers HIGH/MEDIUM severity with mitigations |
| Testing strategy (unit/integration/E2E/PII audit) defined? | ✅ | §6 covers all test levels |
| Open questions resolved or deferred? | ✅ | §8 answers 3 open questions; defers Stripe webhook to FR-BILL-001 |
| Implementation notes added for all 5 findings? | ✅ | Clear implementation guidance for tier, aggregate, category, digest, export |
| Spec is internally consistent (no contradictions)? | ✅ | No contradictions found; all clauses align |
| Ready for development team to start implementation? | ✅ | All ambiguities resolved; implementation notes added |

---

## Final verdict

**Score: 9.5/10** (up from 8.5/10)

**Status: ✅ APPROVED FOR IMPLEMENTATION**

### Why 9.5/10 (not 10/10)?

The only remaining item is non-blocking: §8 Open Questions section notes that Stripe webhook ownership is "deferred to FR-BILL-001". This is correct and expected; it's not a gap in FR-ADMIN-002, just a dependency that will be resolved when FR-BILL-001 is implemented.

### What's ready to start?

✅ **All backend APIs:** search (with row-level security), history (with pre-aggregated queries), analytics (with KPI calculations)
✅ **All dashboard pages:** landing page (with search bar, top cards, recent activity), product detail (with chart, KPI cards, alert config)
✅ **All supporting systems:** B2B auth guard middleware, daily digest job, export async job, audit logging
✅ **All test coverage:** unit tests (dashboard.service.ts), integration tests (endpoints), E2E tests (UI), PII audit tests

### Next step

**Proceed to implementation.** Start with backend APIs (search, history, analytics) in parallel, then dashboard UI (landing + product detail pages), then supporting systems (auth middleware, digest job, export job).

---

## Auditor sign-off

✅ **vòng 2 audit PASSED**

All vòng 1 findings have been addressed with clear implementation notes. The spec is now unambiguous and ready for development. No vòng 3 needed unless major design changes are proposed during implementation.

**Approved by:** Architecture review team  
**Date:** 2026-05-29  
**Next checkpoint:** Code review upon FR-ADMIN-002 PR submission
