---
fr_id: FR-AFF-007
audited: 2026-05-19
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.8/10
score_post_revision_1: 8.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 4
issues_critical: 0
template: engineering-spec@1
---

## §1 — Verdict summary

The draft now reads like a ship-ready fallback slice. The frontmatter is clean, the auth boundary is explicit, the fallback trigger set uses a single failure taxonomy, and the attribution mapping is pinned to exact `utm_*` / `sub*` fields so there is one implementable interpretation.

The slice stays properly narrow: one provider-local AccessTrade client plus one fallback orchestration path from DeeplinkService. The hard stop for `respectOtherPublisher` remains intact, and the resolver still fails closed on config and market errors.

## §2 — Round-1 findings

- **ISS-001 (error)** Invalid placeholder in `blocks` frontmatter — RESOLVED by setting `blocks: []`, which keeps the FR atomic and schema-valid.
- **ISS-002 (warning)** Auth-header helper in the wrong file — RESOLVED by moving `buildAccessTradeHeaders()` to `sign.ts` and importing it from the client skeleton.
- **ISS-003 (warning)** Fallback trigger taxonomy is inconsistent — RESOLVED by using `service_unavailable` in AC2, matching the normative clause and failure modes.
- **ISS-004 (warning)** Attribution projection is still underspecified — RESOLVED by pinning the exact mapping in §1 #10 and mirroring it in the verification payload: `sub1 = userHash`, `sub2 = watchlistHash`, `sub3 = source`, `sub4 = campaign`, with `utm_source = "salenoti"`, `utm_medium = "affiliate_fallback"`, `utm_campaign = campaign`, `utm_content = source`.

## §3 — Strengths preserved

- The FR correctly stays within the documented AccessTrade VN publisher API and does not invent private endpoints.
- `respectOtherPublisher` remains a hard stop, which keeps the fallback from overriding another publisher's attribution.
- The failure inventory already covers the main operational paths: missing config, 401/403, 429, 5xx, and empty campaigns.
- The design keeps auth, normalization, rate limiting, and fallback orchestration separated, which is the right shape for a provider-local adapter.

## §4 — Interim resolution

**Score = 10/10.** Ship.

This FR is now ready to be treated as accepted and can proceed to implementation when the P3 workstream picks it up.

*End of FR-AFF-007 audit (round 2 final).*
