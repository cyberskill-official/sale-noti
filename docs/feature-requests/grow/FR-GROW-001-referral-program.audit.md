---
fr_id: FR-GROW-001
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

FR-GROW-001 ships ship-grade after two rounds. The single highest-leverage growth lever in P2 (plan §F2 #6 k=0.4 target). The fraud-detection design is pragmatic-not-bulletproof: enough cost-to-attack to make $1.50 Pro/month not worth bot-scripting at MVP scale; revisit at P3 with stricter fingerprinting if data shows exploitation.

Round-1: 5 issues (bot abuse via burner emails, qualification too lax, fraud reviewer gate missing, 90-day rolling window math edge cases, self-referral via fresh device). Round-2: 4 (bonus cap to limit damage, lazy backfill for legacy users, malformed refCode silent-drop, claim-button-vs-auto trade-off).

All 9 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Bot army with burner emails
- **severity:** error · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #7 detectFraud + §1 #10 fraud-flag → manual-review hold; AC7+AC8+AC9 cover signals.

### ISS-002 — Qualification too lax (sign-up alone could qualify)
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #5 dual gate (verified email AND ≥ 3 active watchlists in 7 days); AC5 covers chain.

### ISS-003 — Fraud-reviewer gate missing for ambiguous cases
- **severity:** warning · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #10 + `referral_fraud_log` collection; flagged rows stay `pending` until admin review.

### ISS-004 — 90-day rolling window math edge cases
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §6 `maybeReward` uses `qualifiedAt >= now - 90d` filter; AC6 covers the chain.

### ISS-005 — Self-referral via fresh device + IP rotation
- **severity:** info · **rule_id:** correctness-at-scale
- **status:** RESOLVED — §10 row 8 documents acceptable at MVP; P3 stricter fingerprinting via FingerprintJS or similar.

## §3 — Round-2 findings (all resolved)

### ISS-006 — Bonus cap missing (runaway abuse potential)
- **severity:** warning · **rule_id:** abuse-cap
- **status:** RESOLVED — §1 #13 caps `bonusMonthsRemaining` at 12; AC15 verifies; §10 row 14 documents VIP-tier escape valve.

### ISS-007 — Lazy backfill for users predating refCode field
- **severity:** info · **rule_id:** forward-compatibility
- **status:** RESOLVED — §1 #12 mandates lazy backfill; §10 row 11 notes O(N) scan acceptable < 10K users.

### ISS-008 — Malformed refCode handling
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #11 silent-drop on regex fail; 302 same response either way (no enumeration leak).

### ISS-009 — Claim-button vs auto-reward trade-off
- **severity:** info · **rule_id:** ux-correctness
- **status:** RESOLVED — §2 paragraph + §9 Q2 explicit: auto-apply is friction-free per plan §F2 #6 wording.

## §4 — Strengths preserved

- **§7 deterministic refCode via sha256 + salt** is idempotent — re-derivable from userId without DB lookup; resolves the "user clears local state" edge.
- **§1 #5 dual-gate qualification (email + 3 products in 7 days)** raises bot-cost above reward-value at MVP scale; the gate is the central abuse-prevention.
- **Pure-function `detectFraud`** with explicit signal flags is auditable; §5 test suite has 4 cases.
- **§10 has 14 rows** including the subtle "REFERRAL_SALT rotation breaks refLinks" scenario and the "fraud false positive office Wi-Fi" reality.
- **§11 framing of fraud detection as "pragmatic not bulletproof"** sets the right expectation; tighter detection is a P3 follow-up not a P2 blocker.

## §5 — Resolution

**Score = 10/10.** Ship. Highest-leverage P2 growth lever. Combined with FR-GROW-002 (share deal) and FR-GROW-003 (Mega Sale Mode), drives ~40% of organic acquisition per plan §F4 model.

---

*End of FR-GROW-001 audit (round 2 final). Last revised: 2026-05-16.*
