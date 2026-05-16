---
fr_id: FR-AUTH-002
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 8.5/10
score_post_revision_1: 9.5/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 6
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-AUTH-002 is ship-grade. Round-1 surfaced 3 issues (single-use atomic guarantee, hash-not-raw storage, disclosure-paragraph binding). Round-2 surfaced 2 more (timing side-channel, race on parallel tabs). All resolved:

- §1 #5 makes single-use atomic semantics normative (`findOneAndUpdate` with consumed-false guard).
- §1 #9 forbids raw-token logging anywhere; §3 schema stores `tokenHash` only.
- §1 #10 binds the disclosure paragraph wording to FR-LEGAL-002 §2.
- AC6 + §10 row 6/7 enumerate timing leak and race.
- §10 row 8 makes the template snapshot test the drift catcher for disclosure.

## §2 — Round-1 findings (resolved)

### ISS-001 — Single-use semantics ambiguous
- **severity:** error · **status:** RESOLVED via §1 #5 atomic update + AC4 test.

### ISS-002 — Token storage not specified as hash
- **severity:** error · **status:** RESOLVED via §1 #2, §1 #9, §3 schema.

### ISS-003 — Disclosure paragraph wording floating
- **severity:** warning · **status:** RESOLVED via §1 #10 explicit binding to FR-LEGAL-002.

## §3 — Round-2 findings (resolved)

### ISS-004 — Timing side-channel between expired vs nonexistent token
- **severity:** warning · **status:** RESOLVED via §1 #5 unified code path; AC6 timing assertion < 20 ms variance.

### ISS-005 — Race condition on parallel tabs
- **severity:** info · **status:** RESOLVED via §10 row 5 (atomic update guarantees exactly one wins).

### ISS-006 — Email PII could leak into Sentry context when Resend SDK throws
- **severity:** warning · **rule_id:** pii-correctness
- **status:** RESOLVED — FR-OBS-001 §1 #5 `beforeSend` pii-redactor scrubs email patterns from all event tags, extras, and contexts before transmission; AUTH-002 §10 row 9 documents the dependency. AC verifies no `@` substring appears in captured Sentry events when the magic-link send path fails.

## §4 — Strengths preserved

- §2 rationale exhaustive (why 15 min, why hash, why Resend, why 3+10 rate limits).
- §6 skeleton implementable in one sitting; testable end-to-end.
- Disclosure paragraph integration meshes correctly with FR-LEGAL-002 contract.

## §5 — Resolution

**Score = 10/10.** Ship. Implementation MAY begin after FR-AUTH-001 lands.

---

*End of FR-AUTH-002 audit (round 2 final).*
