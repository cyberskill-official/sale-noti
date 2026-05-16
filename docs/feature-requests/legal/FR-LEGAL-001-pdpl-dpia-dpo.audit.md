---
fr_id: FR-LEGAL-001
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

FR-LEGAL-001 ships ship-grade after two rounds. PDPL compliance is the regulatory floor — every other FR (FR-AUTH-001, FR-WATCH-001, FR-BILL-001) is operationally non-compliant if this one isn't in place. The 5%-of-revenue fine + reputation damage on missing 72h breach notification makes the asymmetric downside larger than the upfront compliance cost. Plan §B3 framing ("đây không phải nice-to-have, đây là moat") is the right framing.

Round-1 (6 issues): DSR access vs portability distinction, soft-delete grace window, breach-detector automation, processor register, cross-border re-assessment trigger, encryption envelope.
Round-2 (5 issues): consent re-acquisition on policy change, DSR rate-limits, KEK rotation, subscription retention conflict, annual review trigger.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — DSR access (`right of access`) vs portability (`right of portability`) not distinguished
- **severity:** error · **rule_id:** compliance
- **status:** RESOLVED — §1 #9 (portability/export, 30d SLA) + §1 #11 (access JSON, 15d SLA); AC8/AC21 verify.

### ISS-002 — Soft-delete grace window undefined
- **severity:** error · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #10 24h grace + cancel-deletion email; T+25h soft → T+73h hard-purge; AC9-AC12 cover full lifecycle.

### ISS-003 — Breach-detector signals not automated
- **severity:** error · **rule_id:** compliance + ops-readiness
- **status:** RESOLVED — §1 #7 + §6 `breachDetector` covers 5 signal classes; AC13-AC15 verify each path; §10 row 3 documents false-positive handling.

### ISS-004 — Processor list scattered (no single register)
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #3 + `docs/legal/processor-register.md` enumerates all 11 processors; AC16 verifies; CI gate on new-processor PRs per AC18.

### ISS-005 — Cross-border re-assessment trigger missing
- **severity:** warning · **rule_id:** compliance
- **status:** RESOLVED — §1 #20 + AC18: PR detecting `processor-register.md` change requires counsel sign-off.

### ISS-006 — Encryption envelope unspecified for sensitive PII
- **severity:** warning · **rule_id:** compliance + security
- **status:** RESOLVED — §1 #17 + §6 `envelopeEncrypt`/`envelopeDecrypt` with KEK rotation support; AC23 verifies round-trip.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Consent on policy change not handled
- **severity:** warning · **rule_id:** compliance
- **status:** RESOLVED — §1 #15 + AC20: material version change triggers re-consent on next sign-in; minor changes OK.

### ISS-008 — DSR endpoint rate-limits missing (DoS vector)
- **severity:** info · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #9 (1/30d export) + Q7; §10 row 6 documents.

### ISS-009 — KEK rotation breaks legacy decryption
- **severity:** warning · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #17 + §6 `kekVersion` field; multi-key acceptance; §10 row 11 documents migration path.

### ISS-010 — Subscription 7y retention vs Art. 17 erasure conflict
- **severity:** warning · **rule_id:** compliance-edge-case
- **status:** RESOLVED — §1 #10 + §9 Q8 + §10 row 13: PII-null on retention skeleton, aggregate retained — counsel-approved compromise.

### ISS-011 — Annual DPIA review not auto-tracked
- **severity:** info · **rule_id:** ops-readiness
- **status:** RESOLVED — §1 #21 + AC24: T+11 month calendar reminder + Slack ping; §10 row 17.

## §4 — Strengths preserved

- **Day-0 DPIA filing posture** avoids the "pre-filing data trap" — if processing starts before DPIA filed, the entire dataset becomes unlawful.
- **Breach-detector automation** shrinks detection-to-notification window from "weeks" (manual discovery) to "hours" (signal-driven page), making 72h compliance achievable.
- **DSR endpoints with proper rate-limiting** balance user rights with abuse prevention; the distinction between access (15d) and portability (30d) reflects Art. 14 semantics.
- **Encryption envelope with kekVersion** enables forward-secure key rotation; P0 ships stub, P2 graduates to AWS KMS — without re-architecting fields.
- **Processor register + CI gate on changes** prevents accidental "new processor added without compliance review" — a common ops failure mode in growing teams.
- **Consent re-acquisition on material version change** keeps audit trail compliant under PDPL Art. 11 demonstrable standard.
- **Subscription 7y retention compromise** correctly resolves PDPL vs VN accounting law conflict via PII-nulling with aggregate retention — counsel-approved pattern.
- **§10 has 17 failure-mode rows** including the subtle "DPO conflict-of-interest emerges", "KEK rotation legacy decryption", and "processor breach cascades to our notification clock" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR underwrites every personal-data interaction in the system. Plan §H risk-matrix flagging "PDPL violation = high impact" + plan §B3 "moat framing" both reinforce: compliance is an asset, not a cost. The 5%-of-revenue fine cap on Decree 13 violations is asymmetric enough that even modest compliance investment is positively-NPV.

---

*End of FR-LEGAL-001 audit (round 2 final). Last revised: 2026-05-16.*
