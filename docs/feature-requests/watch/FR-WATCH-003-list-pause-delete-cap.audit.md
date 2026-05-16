---
fr_id: FR-WATCH-003
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

FR-WATCH-003 ships ship-grade after two audit rounds. The central decision points are the soft-delete-with-365-day-retention (for FR-LEGAL-002 audit trail) and the cap-on-reactivation enforcement (the plan §E2 freemium conversion gate). Both have failure-mode coverage + integration tests.

Round-1 surfaced 6 issues: hard-delete erased commission-attribution audit, reactivation didn't re-check cap (free-tier bypass), pagination size unbounded, cross-user enumeration via ObjectIds, `commissionRate` leaked through `$lookup`, Pro/Pro+ cap calculation conflated with free. Round-2 added 4: missing-product graceful degradation, Timescale-enrichment best-effort fallback, Pro→Free downgrade behavior, pagination tiebreaker for deterministic order.

All 10 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows + §5 test mappings.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Hard-delete erases attribution audit
- **severity:** error
- **rule_id:** legal-compliance
- **status:** RESOLVED — §1 #8 mandates soft-delete with 365-day retention per FR-LEGAL-001 §1 #7; AC5+AC6 verify; §10 row 4 confirms commission-webhook joining still works on soft-deleted rows.

### ISS-002 — Reactivating paused at cap (free-tier bypass)
- **severity:** error
- **rule_id:** billing-correctness
- **status:** RESOLVED — §1 #7 + §6 `setStatus` skeleton enforce cap on any active-transition; AC3 verifies the 11th-reactivation 403.

### ISS-003 — Pagination size unbounded
- **severity:** warning
- **rule_id:** dos-prevention
- **status:** RESOLVED — §1 #1 clamps to 50; AC9 verifies the silent clamp; §6 uses `Math.min(...,50)`.

### ISS-004 — Cross-user enumeration via predictable ObjectIds
- **severity:** error
- **rule_id:** security-correctness
- **status:** RESOLVED — §1 #12 enforces userId filter; AC1+AC2 verify; §6 skeleton uses `{ _id: wlOid, userId: userOid }` filter everywhere. ObjectIds remain enumeration-resistant because the userId check makes wrong-user accesses indistinguishable from missing-row 404/403.

### ISS-005 — `commissionRate` leaked through `$lookup`
- **severity:** error
- **rule_id:** plan-a3-compliance
- **status:** RESOLVED — §1 #3 explicit exclusion + §6 `$project` lists allowed fields (allowlist not denylist); AC8 snapshot-tests the response JSON for `commissionRate` absence.

### ISS-006 — Pro/Pro+ cap conflated with free
- **severity:** warning
- **rule_id:** spec-completeness
- **status:** RESOLVED — §6 `setStatus` computes cap per plan (`free: 10`, `pro: 200`, `pro_plus: ∞`); AC4 verifies Pro user can exceed 10.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Missing product row crashes list
- **severity:** warning
- **rule_id:** robustness
- **status:** RESOLVED — §1 #13 + §6 `preserveNullAndEmptyArrays: true` + `??` fallbacks; AC14 verifies the `name: null` fallback.

### ISS-008 — Timescale enrichment blocks list response
- **severity:** warning
- **rule_id:** performance-correctness
- **status:** RESOLVED — §1 #4 best-effort + parallel `Promise.all` with try/catch; AC15 verifies degraded mode.

### ISS-009 — Pro→Free downgrade with 200 active was undefined
- **severity:** info
- **rule_id:** spec-completeness
- **status:** RESOLVED — §9 Q5 documents the kind-path UX (no auto-pause; banner-based opt-in curation).

### ISS-010 — Pagination tiebreaker missing
- **severity:** info
- **rule_id:** determinism
- **status:** RESOLVED — §6 sort `{ updatedAt: -1, _id: -1 }`; AC18 verifies stable pagination on identical updatedAt.

## §4 — Strengths preserved

- **§6 `$lookup` pipeline with explicit `$project` allowlist** is the API-shape pattern that prevents accidental field leakage. Defense in depth against future engineers adding fields to `products` that shouldn't be user-facing.
- **§1 #4 best-effort Timescale enrichment** is the right operational choice: degraded mode (last30dMin: null) over 503-on-list (which would break the dashboard's primary surface).
- **§9 Q5 Pro→Free downgrade UX** captures a real edge-case with explicit kind-path framing — plan §A3 trust posture preserved.
- **§4 has 18 acceptance criteria** all mapped to tests in §5.
- **§10 inventory has 14 rows** including the subtle pagination-drift and concurrent-PATCH scenarios.

## §5 — Resolution

**Score = 10/10.** Ship. Critical for the freemium funnel: the cap-on-reactivation is the only place where billing semantics interact with watchlist state, and §6's enforcement (combined with AC3 test) makes the bypass attempt mechanically caught.

---

*End of FR-WATCH-003 audit (round 2 final). Last revised: 2026-05-16.*
