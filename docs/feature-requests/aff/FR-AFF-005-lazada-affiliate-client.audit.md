---
fr_id: FR-AFF-005
audited: 2026-05-18
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.8/10
score_post_revision_1: 9.2/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 6
issues_critical: 0
template: engineering-spec@1
---

## §1 — Verdict summary

The first draft was directionally correct but still had a few load-bearing gaps: unresolved provider questions in §9, a missing normalize helper in the file plan, an ambiguous perf fixture phrasing, and failure modes that did not fully cover auth/signature drift. Those were the right kinds of problems to catch in round 1 because they are integration blockers, not stylistic nits.

After revision, the FR is now implementable as a provider-local adapter: the endpoint/auth contract is isolated behind `sign.ts` and the client, the helper files are explicitly listed, the rate-limit and breaker behavior is pinned to the same hardening pattern as Shopee, and the remaining storage-schema question is explicitly punted to a later FR instead of being left open.

## §2 — Round-1 findings (resolved)

- **ISS-001 (error)** Open questions in §9 left the provider contract and downstream storage identity unresolved — RESOLVED §9 + §2.
- **ISS-002 (error)** `normalizeLazadaOffer()` was referenced without a declared helper file — RESOLVED §3 file list + §6 imports.
- **ISS-003 (warning)** The p95 check used a vague “warm-cache fixture path” phrase without an actual cache layer — RESOLVED §4 AC7 wording.
- **ISS-004 (warning)** Failure modes did not explicitly cover credential misconfig and signature/header mismatch — RESOLVED §10 added rows.

## §3 — Round-2 findings (resolved)

- **ISS-005 (warning)** The client skeleton still needed explicit imports to be directly translatable to code — RESOLVED §6 imports for `LazadaApiError`, `normalizeLazadaOffer`, and `LazadaRateLimitGuard`.
- **ISS-006 (warning)** Provider rate-limit and breaker semantics were not explicit enough to prevent per-pod multiplication or threshold drift — RESOLVED §1 #5 with Redis shared token bucket `lazada:rl:global` and Shopee-threshold parity.

## §4 — Strengths preserved

- The FR remains atomic: one provider client, one normalized offer surface, no watchlist or persistence side effects.
- Scraping remains forbidden, which keeps the compliance moat intact.
- The adapter boundary is clean: signing, normalization, and error typing are isolated into helper files.
- The telemetry contract now names both `affiliate_api_call` and the outcome dimensions needed for operational review.
- The follow-up storage question is explicitly deferred to a later FR instead of leaking into this slice.

## §5 — Resolution

**Score = 10/10.** Ship.

This is now ready to be used as the first P3 AFF draft and can be picked up after the P3 re-batch work begins.

*End of FR-AFF-005 audit.*
