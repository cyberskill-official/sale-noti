---
fr_id: FR-ADMIN-001
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.0/10
score_post_revision_1: 8.5/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 11
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-ADMIN-001 ships ship-grade after two rounds. The B2B form is the only revenue-capture surface for Mall/Brand sellers (plan §F6); each lead represents $300-3000 ARR, justifying the elevated PII encryption + retention discipline. Triple-rate-limit (IP + email + manual-review escape valve) handles competitor-spam threat model without false-blocking corporate-NAT users.

Round-1: 6 issues (no PII encryption at rest, no consent capture, naive rate-limit, no spam filter, no retention rule, no audit on PII reads). Round-2: 5 (CSRF gap, MX-validation cliff, suspicious-UA over-blocking, profanity false-positive recovery, scope creep on CRM integration).

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — PII stored unencrypted (regulatory exposure)
- **severity:** error · **rule_id:** pdpl-compliance
- **status:** RESOLVED — §1 #9 envelope_encrypt per FR-LEGAL-001; AC1 verifies; admin reads logged per AC8.

### ISS-002 — Explicit PDPL consent missing
- **severity:** error · **rule_id:** pdpl-compliance
- **status:** RESOLVED — §1 #12 `consentPdpl: z.literal(true)`; AC2 verifies rejection of unchecked.

### ISS-003 — Naive rate-limit (corporate NAT false-blocks)
- **severity:** warning · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #3 triple-tier (IP + email + manual-review queue); AC4+AC5 cover both legitimate and adversarial paths.

### ISS-004 — No spam filter (free-text useCase abuse)
- **severity:** warning · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #11 profanity filter + MX check + UA sniffing; AC7 verifies.

### ISS-005 — No retention policy (data accumulates indefinitely)
- **severity:** warning · **rule_id:** pdpl-minimization
- **status:** RESOLVED — §1 #10 graduated retention (36/12/6 months by status); AC11 verifies purge with status retained.

### ISS-006 — Admin PII reads unaudited
- **severity:** warning · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #9 + AC8 `audit:b2b_pii_read` event with adminId/leadId/ts/reason.

## §3 — Round-2 findings (all resolved)

### ISS-007 — CSRF protection missing (cross-origin attack)
- **severity:** error · **rule_id:** security
- **status:** RESOLVED — §1 #2 origin-allowlist; AC14 verifies 403 on `Origin: https://evil.com`.

### ISS-008 — MX-record check could time out and block submissions
- **severity:** info · **rule_id:** dependency-isolation
- **status:** RESOLVED — §10 row 4 graceful timeout (5s budget) + mx_unverified flag for admin review.

### ISS-009 — Suspicious-UA over-blocks legitimate API integrations
- **severity:** info · **rule_id:** ux-balance
- **status:** RESOLVED — §1 #11 + §6 routes to `status: "review"` not hard-reject; AC6 verifies admin reviews flagged submissions.

### ISS-010 — Profanity filter false positive has no recovery
- **severity:** info · **rule_id:** ux-balance
- **status:** RESOLVED — §10 row 8 admin Slack ping on rejection with full payload; admin can whitelist + re-process.

### ISS-011 — CRM integration scope creep into MVP
- **severity:** info · **rule_id:** scope-discipline
- **status:** RESOLVED — §9 Q1 explicit deferral to P3 with reasoning (avoid vendor lock-in before PMF).

## §4 — Strengths preserved

- **PII-encryption-at-rest with audit-on-read** elevates B2B lead data above standard PDPL baseline, reflecting their commercial sensitivity.
- **Triple rate-limit (IP + email + manual review)** handles competitor-spam threat without false-blocking corporate NATs or legitimate retry attempts.
- **24h response promise + Slack ping + daily digest** is the operational triple-redundancy ensuring no lead ages past SLA.
- **Graduated retention (36/12/6)** balances PDPL minimization with sales-cycle realism — won customers persist, dead leads age out, untouched leads gate triage.
- **Explicit PDPL consent + disclosure block** makes the form legally clean and prevents future "I didn't agree to be contacted" disputes.
- **§10 has 14 failure-mode rows** including the subtle "encryption KEK rotation" + "XSS in CSV export" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. Sole B2B monetization surface; entire Mall/Brand revenue stream per plan §F6 depends on this lead capture working cleanly + securely + at SLA.

---

*End of FR-ADMIN-001 audit (round 2 final). Last revised: 2026-05-16.*
