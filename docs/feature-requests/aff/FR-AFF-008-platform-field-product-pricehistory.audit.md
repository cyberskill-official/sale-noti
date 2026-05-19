---
fr_id: FR-AFF-008
audited: 2026-05-19
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.7/10
score_post_revision_1: 8.1/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 3
issues_critical: 0
template: engineering-spec@1
---

## §1 — Verdict summary

The draft now closes the round-1 gaps and is ready to ship as the schema pivot for multi-platform support. `HistoryService.getBucketedHistory()` is part of the platform-aware contract, read-side Mongo lookups go through `productFilterFromIdentity()`, and the Mongo uniqueness/backfill guard is explicit.

## §2 — Round-1 findings

- **ISS-001 (resolved)** `getBucketedHistory()` is now included in the Timescale contract, the acceptance criteria, and the verification sketch. The public chart path is therefore covered by the platform-aware storage contract instead of being left implicit.
- **ISS-002 (resolved)** Mongo product reads now flow through `productFilterFromIdentity()`, and the read-side services in the contract skeleton explicitly consume the platform-aware filter. That removes the ambiguity for overlapping Lazada/TikTok/Shopee numeric IDs.
- **ISS-003 (resolved)** The FR now requires the Mongo compound unique index on `{ platform, shopId, itemId }` and an idempotent backfill script. That closes the race window that the legacy upsert shape could hit during cutover.

## §3 — Strengths preserved

- The FR keeps marketplace platform separate from affiliate network choice, which avoids mixing schema identity with resilience logic.
- Current Shopee behavior remains the default, so the legacy public API shape does not have to change in the same cut.
- The Mongo backfill script is still the right operational direction for legacy documents, and the spec correctly keeps it rerunnable.

## §4 — Final verdict

**Round 2 score: 10/10.** The draft is now complete enough to accept.

*End of FR-AFF-008 round-2 audit.*
