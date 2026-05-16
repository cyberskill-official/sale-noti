---
fr_id: FR-WATCH-002
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

FR-WATCH-002 ships ship-grade after two audit rounds. The single highest-value piece is the pure-function `evaluateTriggers` — it makes alert correctness reproducible and testable independent of the I/O layer, which is the foundation FR-NOTIF-001/002/003 build on.

Round-1 surfaced 6 issues: open trigger schema invited drift (no closed enum enforcement), alert spam without cooldown (no per-trigger semantics), baseline ambiguity for pct_drop (no `current_at_track` vs `last_observed` choice), targetPrice ceiling missing (1B VND cap added), trigger-cooldowns user-mutable (security risk), pure-function semantics not asserted. Round-2 added 4: per-trigger pause (vs only whole-watchlist), zod `.strict()` to reject unknown fields, flash_sale requires BOTH flag AND threshold, baseline freeze on pause (UX correctness).

All 10 issues are resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure mode rows + §5 test mappings.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Open trigger schema invites drift
- **severity:** error
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #1 mandates closed enum; §3 zod `discriminatedUnion` enforces at parse time; adding a new kind requires a new FR + Transparency Report note (§11 framing).

### ISS-002 — Alert spam without per-trigger cooldown
- **severity:** warning
- **rule_id:** ux-noise
- **status:** RESOLVED — §1 #5 defines per-trigger defaults (24h/12h/7d/1h) anchored to the user-behavior research in §2 ("Mẹ bỉm sữa" 5am+9pm rhythm matches 12h `pct_drop`); AC9+AC10 cover cooldown-during and after-elapse.

### ISS-003 — Baseline ambiguity for pct_drop
- **severity:** info
- **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #2 adds `baseline: "current_at_track" | "last_observed"` choice with `current_at_track` default; §2 paragraph explains the UX difference; AC8 covers both branches via test fixture.

### ISS-004 — targetPrice ceiling missing
- **severity:** warning
- **rule_id:** input-validation
- **status:** RESOLVED — §1 #2 caps at 1B VND; §3 zod `.max(1_000_000_000)`; AC6 verifies > cap rejected.

### ISS-005 — `triggerCooldowns` user-mutable
- **severity:** error
- **rule_id:** security-correctness
- **status:** RESOLVED — §1 #12 forbids cooldown mutation via PATCH; §3 zod `.strict()` rejects unrecognized keys; AC16 verifies the rejection path.

### ISS-006 — Pure-function semantics not asserted
- **severity:** warning
- **rule_id:** testability-correctness
- **status:** RESOLVED — §1 #4 mandates no I/O / no mutation / no clock-reading (threaded via `now` param); AC17 + §11 closing note make the reproducibility contract explicit.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Per-trigger pause missing
- **severity:** info
- **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #7 adds per-trigger pause distinct from whole-watchlist pause; AC13 verifies; §2 paragraph explains the "mute flash_sale but keep lowest_30d" UX.

### ISS-008 — Unknown future fields silently accepted
- **severity:** warning
- **rule_id:** schema-strictness
- **status:** RESOLVED — §3 zod `.strict()` rejects unrecognized keys; AC16 covers the `triggerCooldowns` payload attempt.

### ISS-009 — flash_sale single-condition was ambiguous (flag OR threshold? AND?)
- **severity:** error
- **rule_id:** spec-completeness
- **status:** RESOLVED — §6 skeleton makes BOTH conditions required (`flashSaleObserved && currentDiscountPct ≥ minDiscountPct`); AC12 fixture-tests the AND semantics. §2 paragraph explains why (avoid false positives on naturally-low-discount items).

### ISS-010 — Baseline freeze behavior on pause/resume unclear
- **severity:** info
- **rule_id:** state-correctness
- **status:** RESOLVED — §9 Q4 documents freeze-at-first-track; un-pause does NOT reset baseline. UX: a week-long pause preserves the user's reference point.

## §4 — Strengths preserved

- **Pure function + injectable `now` parameter** is the testability gold standard — `evaluateTriggers` can be replayed against historic data to audit any alert.
- **Zod discriminated union with `.strict()`** rejects both unknown kinds AND unknown fields at parse time. Belt + suspenders against schema drift.
- **§2 cooldown rationale anchors each value to user behavior** (24h/12h/7d/1h aligned to specific persona research, not arbitrary).
- **§4 has 18 acceptance criteria** mapped 1:1 with §5 tests — coverage is exhaustive for a 5-hour spec.
- **§10 failure modes inventory has 13 rows** including subtle clock-skew + flash-flap + cross-trigger-interaction edge cases.
- **§11 framing of the pure-function pattern as policy/I-O separation** — enables A/B testing of trigger policies without touching the dispatch worker.

## §5 — Resolution

**Score = 10/10.** Ship. This FR's eval function is consumed by FR-NOTIF-001/002/003 workers — its correctness is the alert-loop foundation. Ship after FR-WATCH-001 lands.

---

*End of FR-WATCH-002 audit (round 2 final). Last revised: 2026-05-16.*
