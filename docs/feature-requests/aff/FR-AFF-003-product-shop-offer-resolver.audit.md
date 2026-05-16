---
fr_id: FR-AFF-003
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

FR-AFF-003 ships ship-grade after two audit rounds. It's the single dual-write ingress to MongoDB + TimescaleDB and feeds 3 downstream FRs (FR-WATCH-001, FR-PRICE-002, FR-NOTIF-001), making correctness here non-negotiable.

Round-1 surfaced 6 issues spanning dual-write divergence (no documented recovery path for Timescale failures), commission-rate ranking firewall (only assumed, not enforced at resolver layer), flash-sale detection ambiguity (single 30% threshold missed Shopee-tagged Mall items), item-resurrection handling ($unset on deletedAt missing), schedule hash determinism (not guaranteed), and discountPct edge case (100% rounding when item becomes free). Round-2 added 4 more: phase-tagged Sentry exceptions, currency-field reservation for P4, stock-field semantics, and slug unicode safety.

All 10 issues are resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows. The §10 inventory has 14 rows, the §5 verification suite has 11 tests with explicit AC-mapping, and §2 has 8 rationale paragraphs — exceeding the FR-AUTH-001 gold standard depth.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Dual-write divergence has no documented recovery
- **severity:** error
- **rule_id:** dual-write-correctness
- **status:** RESOLVED — §10 row 2 documents the outbox retry pattern; §1 #5 acknowledges sequential semantics; §6 skeleton catches the Timescale error without propagating to caller (AC13 verifies). The ~10ms divergence window is bounded and acceptable at MVP scale.

### ISS-002 — Commission-rate ranking firewall only assumed
- **severity:** error
- **rule_id:** plan-a3-compliance
- **status:** RESOLVED — §1 #8 re-asserts at the resolver layer; AC8 grep test covers `apps/api/src/**/*.ts` for `ORDER BY.*commission` / `sortBy.*commission` / `sort.*commissionRate`. The legal-check.mjs script in CI enforces.

### ISS-003 — Flash sale detection missed Shopee-tagged Mall items
- **severity:** warning
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #7 adds two-condition detection (price < 70% OR explicit Shopee `flashSale` field); §2 paragraph explains the Mall-marked subset rationale; AC7 fixture-tests the explicit flag at 25% discount.

### ISS-004 — Item resurrection misses $unset deletedAt
- **severity:** error
- **rule_id:** state-machine-correctness
- **status:** RESOLVED — §1 #4 mandates `$unset: { deletedAt: "" }` in the upsert; §6 skeleton implements; AC5 verifies a previously-dead item gets its `deletedAt` removed on re-resolution.

### ISS-005 — Schedule hash determinism not guaranteed
- **severity:** error
- **rule_id:** scheduler-correctness
- **status:** RESOLVED — §1 #11 mandates deterministic djb2 hash; §6 skeleton implementation is pure (no randomness); AC14 asserts identical `_scheduleHash` across re-resolutions of the same product.

### ISS-006 — discountPct edge case at 100% rounding
- **severity:** warning
- **rule_id:** edge-case-handling
- **status:** RESOLVED — §6 skeleton caps `Math.min(99, ...)` to avoid the 100% (free-item) edge that would break downstream `pct_drop` math. Explicit in §6.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Sentry exception tagging insufficient for phase decomposition
- **severity:** warning
- **rule_id:** observability-completeness
- **status:** RESOLVED — §1 #12 mandates `phase: "resolve" | "mongo_write" | "timescale_write"` tag; §6 try/catch blocks each set the tag. OBS dashboards can now decompose resolver failure rate by stage.

### ISS-008 — Currency field reservation undocumented
- **severity:** info
- **rule_id:** forward-compatibility
- **status:** RESOLVED — §1 #13 reserves `currency: "VND"` on Mongo row with explicit Q4-region migration call-out in §9.

### ISS-009 — Stock field semantics ambiguous
- **severity:** info
- **rule_id:** schema-completeness
- **status:** RESOLVED — §9 Q6 documents `stock: null` when Shopee omits, `stock: number` when present; reserved for FR-NOTIF-001 low-stock+low-price composite trigger (P3 candidate).

### ISS-010 — Slug unicode safety
- **severity:** info
- **rule_id:** url-safety
- **status:** RESOLVED — §6 `slugify` helper strips combining marks via NFD normalization + non-alnum scrub; §10 row 14 confirms all slugs are URL-safe `[a-z0-9-]+` ≤ 80 chars.

## §4 — Strengths preserved

- **§2 rationale is comprehensive** (8 paragraphs) — every non-obvious decision (Timescale vs alternatives, hybrid storage, no-resolver-cache, 1h shop offer cache, 70% flash threshold, two-condition flash detection, sequential dual-write, deterministic hash, commission-rank firewall) has its own paragraph with concrete trade-off math.
- **§3 includes both Mongo + Timescale schemas inline** — implementation-ready with index definitions. The TypeScript `NormalizedOffer` type binds the two layers via the `currentPrice`/`flashSale` derived fields.
- **§4 acceptance criteria are 1:1 with §5 tests** — 14 ACs, 11 tests (some ACs share a test where the invariant is the same). AC13 (Timescale failure does NOT propagate) is the kind of negative test that's easy to skip; including it locks in the degraded-mode contract.
- **§10 failure modes inventory has 14 rows** — well above the 8-row floor, with concrete detection (Sentry tag, zod parse, regression test) and recovery columns. The "schema breaking change" row (row 10) maps cleanly to FR-AFF-001 §1 #10's `schema_drift` error path.
- **§11 dual-write outbox migration framing** — explicitly identifies the resolver as a clean migration boundary for future event-sourced architecture (P3 ML, P4 multi-region). This is forward planning that costs nothing now.
- **Plan §A3 principle 4 ("open source revenue model") tied directly to the no-cache decision** — §11 closing note makes the audit-ability of the system explicit. Users can re-derive any historic alert from price_history + trigger-eval rules.

## §5 — Resolution

**Score = 10/10.** Ship. Implementation MAY begin once FR-AFF-001 + FR-PRICE-001 have shipped.

This FR's correctness is foundational. The §10 inventory's depth + the AC8 grep firewall + AC13 degraded-mode contract + AC14 deterministic-hash assertion give us mechanical confidence that the downstream FRs (WATCH-001, PRICE-002, NOTIF-001) can build on a stable contract.

---

*End of FR-AFF-003 audit (round 2 final). Last revised: 2026-05-16.*
