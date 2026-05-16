---
fr_id: FR-AUTH-001
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

FR-AUTH-001 is ship-grade. Round-1 review surfaced 4 issues (open-redirect guard, rate-limit, iss/aud validation explicit clauses, fail-closed semantics). Round-2 review surfaced 2 more (clock-skew failure mode, replay/race failure mode). All 6 are resolved in the current text:

- §1 #5 (open-redirect), §1 #8 (iss/aud validation), §1 #12 (rate limit) make the security invariants normative.
- §1 #7 makes fail-closed semantics explicit and binding.
- §10 enumerates 10 distinct failure paths including the clock-skew + race conditions.
- §9 closes Q1–Q4 with explicit decisions and rationale.

The skeleton compiles into a working Auth.js v5 configuration that satisfies every AC. The CI gate (`grep` for the exact pin) directly enforces plan §C8's "no `latest`" rule.

## §2 — Round-1 findings (now all resolved)

### ISS-001 — Open-redirect attack surface
- **severity:** error
- **rule_id:** security-correctness
- **status:** RESOLVED — §1 #5 makes `callbackUrl` guard normative; `redirect` callback in §3 implements it; AC6 + integration test covers it.

### ISS-002 — Rate limit not enforced
- **severity:** error
- **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #12 binds 10 req/min/IP via `@nestjs/throttler`; AC7 tests it.

### ISS-003 — `iss` / `aud` validation only implied
- **severity:** warning
- **rule_id:** oauth-correctness
- **status:** RESOLVED — §1 #8 promotes both to explicit BCP-14 MUST; §3 `signIn` callback returns `false` on either mismatch; AC3 + AC4 test both.

### ISS-004 — "Fail-closed on upsert" was a comment, not a clause
- **severity:** warning
- **rule_id:** documentation-gap
- **status:** RESOLVED — §1 #7 is now normative; AC5 ties the redirect to `/auth/error?code=USER_UPSERT_FAILED&trace=<id>` with Sentry capture; §6 skeleton returns `Result` enum that the `signIn` callback handles.

## §3 — Round-2 findings (now all resolved)

### ISS-005 — Clock-skew failure mode not enumerated
- **severity:** info
- **rule_id:** failure-mode-inventory
- **status:** RESOLVED — §10 row 10 added (Clock skew > 60 s vs Google).

### ISS-006 — Race condition on parallel first-sign-in not modelled
- **severity:** warning
- **rule_id:** concurrency-correctness
- **status:** RESOLVED — §10 row 8 explicitly calls out the idempotent outcome via `findOneAndUpdate` with `upsert: true`; §3 schema notes unique index on `email`.

## §4 — Strengths preserved

- §1 BCP-14 clauses are unambiguous and one-FR-one-test.
- §2 rationale explains *why* every non-obvious decision (`v5.0.0-beta.25` pin, `jwt` strategy, `openid email profile` only, custom upsert).
- §6 skeleton is implementable in one sitting by the Senior Tech Lead.
- §10 covers 10 distinct failure paths — sets the OBS dashboard rows for AUTH.
- The CI grep gate for the pin is the cheapest possible "drift catcher" — costs nothing, blocks the foot-gun.

## §5 — Resolution

**Score = 10/10.** Ship as-is. Implementation MAY begin immediately. Blocks FR-AUTH-002 + FR-AUTH-003 (slice 1 finishes the auth surface).

---

*End of FR-AUTH-001 audit (round 2 final).*
