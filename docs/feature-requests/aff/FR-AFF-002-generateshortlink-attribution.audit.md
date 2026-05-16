---
fr_id: FR-AFF-002
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

FR-AFF-002 ships ship-grade after two audit rounds. Round-1 surfaced 7 issues spanning attribution privacy (raw userId in subIds), publisher-cookie compliance (no flag plumbing for the respect-other-publisher case), URL validation (no productId↔originUrl cross-check), rate-limit (missing), interstitial coupling (loosely typed), cache concurrency (parallel-call race), and PostHog leakage (raw URL in event payloads). Round-2 closed 4 more: cardinality control on `campaign`, sub-id 5-slot semantics for the "respected" sentinel, hash collision math at scale, and webhook orphan handling under PDPL erasure. All 11 issues are resolved in the current text with citable section references back to §1 normative clauses.

This FR is upstream of 5 other FRs (FR-NOTIF-001/002/003, FR-GROW-002, FR-EXT-001) — getting it wrong cascades. The depth of §10 failure modes inventory (13 distinct rows with detection + recovery columns) and the explicit PostHog redaction contract (§1 #9) reflect that downstream blast radius.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Raw userId smuggled into subIds
- **severity:** error
- **rule_id:** pdpl-privacy-leak
- **status:** RESOLVED — §1 #2 mandates SHA-256 + salt + 12-char prefix; §3 schema documents the hash-not-raw storage; AC1 verifies the subId[1] shape via regex `/^[a-f0-9]{12}$/`. The 12-char width is justified in §2 against 10^14 collision space.

### ISS-002 — Respect-other-publisher flag has no end-to-end path
- **severity:** error
- **rule_id:** plan-a3-compliance
- **status:** RESOLVED — §1 #8 binds the contract; §6 skeleton's first branch returns origin URL unchanged; AC8 covers the round-trip from FR-EXT-001 §1 #5 detection through to the PostHog `affiliate_link_respected_publisher` event. §11 note explains the `subIds[4] = "respected"` sentinel as the auditable signal for the quarterly Transparency Report row.

### ISS-003 — `productId` parameter not cross-checked against `originUrl`
- **severity:** error
- **rule_id:** input-validation
- **status:** RESOLVED — §1 #6 mandates the regex check AND the productId-extraction match; §6 skeleton implements; AC5 verifies. The threat model paragraph in §2 explains the smuggling attack this defeats.

### ISS-004 — No rate limiting
- **severity:** warning
- **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #14 adds 30 req/min/userId via Redis token bucket; §6 implementation shows the guard; AC11 verifies the 31st-call 429.

### ISS-005 — Interstitial coupling could be bypassed by a client engineer
- **severity:** warning
- **rule_id:** ux-firewall
- **status:** RESOLVED — §1 #7 makes `useDeeplinkWithInterstitial()` the only public client surface; §2 paragraph explains the choke-point pattern; AC7 makes the bypass attempt a TypeScript build error. §11 note frames this as compile-time enforcement.

### ISS-006 — Parallel-call race could double-call Shopee
- **severity:** warning
- **rule_id:** concurrency-correctness
- **status:** RESOLVED — §1 #12 mandates transactional idempotency; §6 skeleton uses `SET NX` lease + 50ms jitter retry; AC13 verifies that two concurrent calls produce exactly one Shopee hit and one row.

### ISS-007 — PostHog event leaks raw URL
- **severity:** error
- **rule_id:** pdpl-privacy-leak / observability-hygiene
- **status:** RESOLVED — §1 #9 enumerates the exact properties allowed (none raw); §6 `observe()` helper redacts; AC3 grep-asserts `shope.ee` and raw userId absent from event JSON.

## §3 — Round-2 findings (all resolved)

### ISS-008 — Campaign field cardinality risk
- **severity:** warning
- **rule_id:** analytics-cardinality
- **status:** RESOLVED — §1 #11 scrubbing rules + AC9/AC10 fixture tests; §6 `scrubCampaign()` enforces. PostHog event stays under 20-char campaign cardinality regardless of caller input.

### ISS-009 — 5-slot subIds usage for "respected" not explicit
- **severity:** info
- **rule_id:** documentation-gap
- **status:** RESOLVED — §11 note documents the `subIds[4] = "respected"` sentinel and the audit query that consumes it for the Transparency Report.

### ISS-010 — Hash collision math at scale
- **severity:** info
- **rule_id:** correctness-at-scale
- **status:** RESOLVED — §10 row 3 + §2 paragraph quantify (10^14 collision space ≈ negligible at 10 K-100 K users; revisit at 1 M with 16-char prefix; forward-compatible because old 12-char prefixes remain readable).

### ISS-011 — Commission webhook orphan rows after PDPL erasure
- **severity:** info
- **rule_id:** compliance-correctness
- **status:** RESOLVED — §10 row 13 + §11 note explain: conversions arrive attributable in aggregate but not per-user reportable after a user invokes Art. 16 erasure. Aligned with FR-LEGAL-001 §1 #7 retention policy.

## §4 — Strengths preserved

- **§2 rationale paragraphs are unusually thorough** — every non-obvious decision (5 subIds, 12-char hash, 24h cache, hook-only public surface, respect-publisher flag, productId↔originUrl cross-check) has its own paragraph with concrete trade-off analysis.
- **§3 contract is implementation-ready** — schema includes the indexes, error table covers 6 status codes with body shapes, code skeleton compiles end-to-end including the `SET NX` race guard.
- **§4 acceptance criteria are 1:1 with §5 verification cases** — AC11, AC13, AC14 each have a dedicated test that asserts the specific invariant. No "spirit-of-the-AC" gaps.
- **§10 failure modes inventory has 13 rows** — well above the 8-row gold standard, with concrete detection (Redis disconnect, schema parse, productId mismatch, breaker state) and recovery columns. The `respect_other_publisher` false-negative row (§10 row 5) is the kind of nuance that's easy to skip.
- **§11 framing of the `subIds[4] = "respected"` sentinel** as the audit query for Transparency Report compliance — that's a clever piece of plan §A3 principle 3 plumbing that ties this FR to the legal-2 compliance moat.

## §5 — Resolution

**Score = 10/10.** Ship. Implementation MAY begin immediately after FR-AFF-001 lands.

This FR's blast radius is large (5 downstream FRs). The §10 inventory's depth + the §4 ACs being directly testable + the §6 implementation being compile-ready give us mechanical confidence that the downstream FRs won't have to renegotiate the contract.

---

*End of FR-AFF-002 audit (round 2 final). Last revised: 2026-05-16.*
