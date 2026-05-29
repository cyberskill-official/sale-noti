---
fr_id: FR-NOTIF-004
audited: 2026-05-26
auditor: manual (engineering-spec template v1)
verdict: DRAFT
score_pre_revision: 7.2/10
score_post_revision_1: 8.9/10
issues_open: 0
issues_resolved: 3
issues_critical: 0
template: engineering-spec@1
round: 1
---

## §1 — Verdict summary

Round 1 surfaced three load-bearing gaps: the `mobilePush` channel taxonomy was not pinned end-to-end, the deep-link target was not concrete enough for the current Expo app, and duplicate-token subscribe semantics were underspecified. The spec revision now closes those gaps so implementation can start without leaving them implicit.

## §2 — Round-1 findings

### ISS-001 — `mobilePush` channel semantics were implicit
- **severity:** error · **rule_id:** spec-completeness
- **status:** RESOLVED IN CURRENT REVISION — §1 #5/#7 now name `mobilePush` explicitly and pin `deviceId` as metadata only.

### ISS-002 — Deep-link target was not concrete enough
- **severity:** warning · **rule_id:** implementation-clarity
- **status:** RESOLVED IN CURRENT REVISION — §1 #8, §3 payload example, and §6 notes now pin the `salenoti://watchlists/<watchlistId>` custom-scheme target.

### ISS-003 — Duplicate-token subscribe semantics were ambiguous
- **severity:** warning · **rule_id:** robustness
- **status:** RESOLVED IN CURRENT REVISION — §1 #5 now requires upsert by token, `lastSeenAt` refresh, and preserved `addedAt` ordering.

## §3 — Strengths preserved

- The spec stays Expo-managed and does not force a native rewrite for the first token registration path.
- Shared daily cap and shared `alertIdem` reuse remain aligned with FR-NOTIF-001/002/003.
- Disclosure before user action is still explicitly in scope.

## §4 — Next step

Run the second audit round once the implementation slice exists or if the spec drifts again before code starts.
