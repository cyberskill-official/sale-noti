---
fr_id: FR-AFF-004
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.0/10
score_post_revision_1: 9.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 9
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-AFF-004 ships ship-grade after two rounds. Round-1 surfaced 6 issues: XSS strip on Shopee response, per-tenant rate limit split (auth vs anon), PII keyword redaction extended beyond email to phone + CCCD, commission-rate ranking firewall asserted, cache TTL bounded to 10-min upper limit, pageSize cap aligned with FR-GROW-003. Round-2 added 3 more: keyword length validation (200 char), pagination cap (page 1-50), inline affiliateLinkUrl enrichment (avoid N+1 deeplink round-trips).

All 9 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows + §5 test mappings.

## §2 — Round-1 findings (all resolved)

### ISS-001 — XSS in productName not stripped
- **severity:** error
- **rule_id:** security-correctness
- **status:** RESOLVED — §1 #9 mandates `stripHtml()`; §6 helper inlined; AC10 fixture-tests `<script>alert(1)</script>OK → OK`.

### ISS-002 — Single rate limit doesn't differentiate auth vs anon
- **severity:** warning
- **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #4 splits into 30/min/userId (auth) + 10/min/IP-`/24` (anon); §6 `SearchRateGuard` implements both paths; AC4 + AC5 test each.

### ISS-003 — PII redaction only covered email
- **severity:** warning
- **rule_id:** pdpl-privacy-leak
- **status:** RESOLVED — §1 #7 extends scrub to email + Vietnamese phone (`/^(\+?84|0)\d{9,10}$/`) + CCCD/CMND (`/^\d{9,12}$/`); AC11/12/13/14 cover each pattern + the "normal keyword passes through" case.

### ISS-004 — Commission-rate ranking firewall not asserted at this layer
- **severity:** error
- **rule_id:** plan-a3-compliance
- **status:** RESOLVED — §1 #5 asserts sort enum is closed; AC15 grep CI; §1 disallow list explicit. The default `RELEVANCY` sort delegates to Shopee's signal — no commission ranking opportunity at our layer.

### ISS-005 — Cache TTL had no upper bound documented
- **severity:** info
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #3 caps at 10 min absolute ceiling; §2 paragraph explains the freshness/budget trade-off math (1K calls/min effective at 5-min hit rate ~80%).

### ISS-006 — pageSize cap not aligned with downstream consumer
- **severity:** info
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #8 caps at 20 matching FR-GROW-003 leaderboard pagination; AC6 verifies > 20 rejected.

## §3 — Round-2 findings (all resolved)

### ISS-007 — No keyword length validation
- **severity:** warning
- **rule_id:** input-validation
- **status:** RESOLVED — §1 #12 mandates 1-200 char range; §6 throws on empty-after-trim or > 200; AC7+AC8 test both edges.

### ISS-008 — Pagination cap missing
- **severity:** info
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #13 caps `pageNumber` 1-50 (Shopee API quality degrades past page 10 anyway); §6 zod schema enforces.

### ISS-009 — affiliateLinkUrl enrichment risks N+1
- **severity:** warning
- **rule_id:** performance-correctness
- **status:** RESOLVED — §1 #11 mandates inline enrichment; §6 uses single batched `$in` query against `affiliate_links` instead of per-item lookups; §10 row 12 confirms; AC17 tests the round-trip avoidance.

## §4 — Strengths preserved

- **§2 rationale (7 paragraphs)** anchors every cache TTL / sort / redaction / pagination decision to a concrete trade-off (budget math, retention math, FE pagination cadence, defense-in-depth).
- **§3 contract is implementation-ready** — error table covers 5 statuses, request/response examples are concrete, code skeleton compiles with the `affiliateLinkUrl` enrichment.
- **§4 acceptance criteria are 1:1 with §5 verification** — 18 ACs, 7 tests (some ACs share a test where the invariant is the same).
- **§7 PII redaction extension to phone + CCCD** — that's the Vietnamese-context detail easy to miss. The regex set is auditable in §6.
- **§10 inventory has 14 rows** including the subtle "anonymous abuse from many IPs" scenario that's distinct from per-IP rate limit (and gets handed off to Cloudflare WAF at scale).
- **§11 closing notes** tie the 5-min cache TTL forward to FR-PRICE-002's pubsub invalidation, showing how this FR composes with the next layer in the price-tracking pipeline.

## §5 — Resolution

**Score = 10/10.** Ship. This is SHOULD priority; ship after MUST-priority FRs in P1 land. The inline `affiliateLinkUrl` enrichment makes this FR a meaningful UX improvement over a naked Shopee proxy.

---

*End of FR-AFF-004 audit (round 2 final). Last revised: 2026-05-16.*
