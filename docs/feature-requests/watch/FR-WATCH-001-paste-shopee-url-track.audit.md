---
fr_id: FR-WATCH-001
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.5/10
score_post_revision_1: 9.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 11
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-WATCH-001 ships ship-grade after two rounds. This IS the MVP happy path — the single product-add surface for web visitors and the API target for the Chrome extension. Every consumer-side feature (FR-WATCH-002 triggers, FR-PRICE-002 chart, FR-NOTIF-001 alerts) starts from data this endpoint creates. A single design error here compounds into every downstream FR.

Round-1 (6 issues): no deleted-row reactivation path, no idempotency cache, no URL hygiene (utm/fbclid leaks), no per-IP rate-limit, no XSS-safe nickname handling, no soft-funnel for anonymous users. Round-2 (5 issues): cross-tier cap behavior, source-header forgery, breaker-open state handling, response-card data completeness, deprecated-domain rejection.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Deleted watchlist re-track creates duplicate row
- **severity:** error · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #13 + §6 reactivation logic preserves createdAt; AC10 verifies.

### ISS-002 — No idempotency cache (flaky 4G double-tracks)
- **severity:** warning · **rule_id:** correctness-on-mobile
- **status:** RESOLVED — §1 #15 + §6 Redis 60s cache; AC14 verifies same response from cache + no duplicate row.

### ISS-003 — URL tracking params (utm/fbclid) stored in productId / leaked to analytics
- **severity:** warning · **rule_id:** privacy-hygiene
- **status:** RESOLVED — §1 #2 + §6 `TRACKING_PARAMS` set stripped before canonicalization; AC3 verifies.

### ISS-004 — No per-IP rate-limit (signup-and-enumerate attack)
- **severity:** warning · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #11 5/min/IP + 20/min/user dual-tier; §6 `@ThrottleByIp` decorator.

### ISS-005 — Nickname XSS / control-char risk
- **severity:** warning · **rule_id:** xss
- **status:** RESOLVED — §1 #14 + §6 `sanitizeNickname` strips control chars + rejects `<>`+backtick; AC16 verifies.

### ISS-006 — Anonymous users hit hard 401 (no soft-funnel)
- **severity:** warning · **rule_id:** growth-funnel
- **status:** RESOLVED — §1 #16 + §3 response includes `signinUrl` with `seedUrl=<encoded>`; AC15 verifies; combined with FR-GROW-002 share-deal funnel.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Pro user cap behavior undocumented
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #4 explicit "Pro tier MUST have no cap"; AC6 verifies.

### ISS-008 — Source header trivially forgeable
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #8 + §6 enum-coercion to "web" for unknown values; AC13 verifies.

### ISS-009 — Breaker-open state not surfaced to client
- **severity:** info · **rule_id:** ux-correctness
- **status:** RESOLVED — §3 error table + AC18 (503 AFFILIATE_API_TIMEOUT with circuit breaker per FR-AFF-001).

### ISS-010 — Response card incomplete for "tracked!" UX
- **severity:** warning · **rule_id:** ux-completeness
- **status:** RESOLVED — §1 #9 response shape includes `is30DayLow`, `last30dMin`, `discountPct`; FE renders one-paint card without second round-trip.

### ISS-011 — Deprecated `shopee.com.vn` domain not explicitly rejected
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §9 Q4 explicit (only `shopee.vn`); §5 parser test rejects `shopee.com.vn`.

## §4 — Strengths preserved

- **Server-side URL parsing with PII hygiene** — strips utm_/fbclid/gclid/etc. before canonicalization; analytics + DB never see tracking params.
- **Soft-funnel for anonymous users** — `seedUrl` param in `signinUrl` lets us land users on the watchlist-create flow with the product pre-filled after signup; supports the FR-GROW-002 share-deal acquisition path.
- **Reactivation flow** preserves `createdAt` for cohort analysis while resetting `updatedAt`; deletion is soft so re-adding is friction-free.
- **Idempotency cache** handles flaky-mobile retry without surfacing 409 to legitimate retries (only true duplicates trigger 409).
- **One-paint response shape** with `is30DayLow + last30dMin + currentPrice + discountPct` eliminates the second round-trip on the highest-stake UX moment (the "tracked!" feedback).
- **Dual-tier rate-limit** (per-user + per-IP) catches both legitimate-account abuse AND signup-and-enumerate scraper patterns.
- **§10 has 16 failure-mode rows** including the subtle "Redis idempotency cache miss after 60s" + "Mongo replica-set failover mid-insert" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR blocks FR-WATCH-002 (triggers), FR-WATCH-003 (list/pause/delete), FR-EXT-001 (extension calls this endpoint), FR-PRICE-002 (chart only renders for tracked products), and FR-NOTIF-001 (alerts fire only on tracked watchlists). The "I just pasted a URL and got my deal alert" loop is the single most-important consumer flow at MVP.

---

*End of FR-WATCH-001 audit (round 2 final). Last revised: 2026-05-16.*
