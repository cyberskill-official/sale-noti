---
fr_id: FR-PRICE-002
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.5/10
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

FR-PRICE-002 ships ship-grade after two rounds. The pubsub-invalidation pattern (FR-AFF-003 publishes → FR-PRICE-002 invalidates) is the central interesting decision — it gives correctness under both write-bursts (invalidation fires) and stale-subscriber (TTL fallback) regimes.

Round-1 surfaced 5 issues: server-side downsampling (raw 30d would blow chart libs), watchlist-or-public auth split, cache invalidation on new observations, rate limit auth/anon split, commissionRate firewall. Round-2 added 4: range > 90d cap, productId regex validation, pubsub subscriber resilience, empty-history graceful handling.

All 9 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows + §5 test mappings.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Raw 30d response too large for mobile chart libs
- **severity:** error
- **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #3 raw restricted to ≤ 7d; AC2 verifies. §2 paragraph quantifies the 1500-point limit on Recharts/Chart.js.

### ISS-002 — Auth scope (always public vs always private) unclear
- **severity:** error
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #5 watchlist-OR-public alternation; AC5+AC6 cover both branches; §2 paragraph explains the SEO acquisition-funnel rationale.

### ISS-003 — No cache invalidation on new observations
- **severity:** warning
- **rule_id:** freshness-correctness
- **status:** RESOLVED — §1 #7 + #12 add Redis pubsub channel; §6 `HistoryCacheInvalidator` subscriber; AC4 verifies invalidation within 100 ms of publish.

### ISS-004 — Rate limit didn't differentiate auth vs anon
- **severity:** warning
- **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #10 splits 60/min/user vs 30/min/IP `/24` for anonymous (public-deal access).

### ISS-005 — commissionRate could leak through the response
- **severity:** error
- **rule_id:** plan-a3-compliance
- **status:** RESOLVED — §1 #13 explicit exclusion; AC13 snapshot grep-tests the response JSON.

## §3 — Round-2 findings (all resolved)

### ISS-006 — Range > 90d uncapped
- **severity:** warning
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #11 caps at 90d; AC11 verifies 91d → 400 `range_too_large`. §2 paragraph explains TimescaleDB retention (730d) vs UX cap (90d) split.

### ISS-007 — productId path param not validated
- **severity:** warning
- **rule_id:** input-validation
- **status:** RESOLVED — §1 #1 regex `^\d+-\d+$`; AC12 verifies `abc-xyz` → 400.

### ISS-008 — Pubsub subscriber resilience
- **severity:** info
- **rule_id:** robustness
- **status:** RESOLVED — §10 row 11 documents reconnect on disconnect via OnModuleInit; OBS alert on prolonged disconnect; cache TTL is the fallback.

### ISS-009 — Empty history not specified
- **severity:** info
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #6 implies; §6 returns `points: []`; AC15 verifies 200 + empty.

## §4 — Strengths preserved

- **§1 #5 watchlist-or-public alternation** is the right product decision (enable SEO public deal pages without leaking the entire tracking dataset).
- **§1 #7 + #12 pubsub-invalidation pattern** is correctness under both write-burst and stale-subscriber regimes — the failure modes are bounded.
- **§4 has 15 acceptance criteria** mapped 1:1 with §5 tests.
- **§10 has 15 rows** including the pubsub-subscriber disconnect scenario which is the most subtle failure mode (would otherwise be a "phantom stale cache" bug).
- **§11 closing note about audit-ability** ties this endpoint to plan §A3 principle 4 — combined with FR-WATCH-002 `evaluateTriggers`, any user can replay any alert.

## §5 — Resolution

**Score = 10/10.** Ship. The pubsub invalidation requires FR-AFF-003 to publish; both ship together to close the read+write loop on the chart UX.

---

*End of FR-PRICE-002 audit (round 2 final). Last revised: 2026-05-16.*
