# SaleNoti FR Authoring — Session Progress

**Session:** 2026-05-16 · **Owner:** Stephen Cheng (Founder) · **Driver:** project-local workflow at [`../FR_AUTHORING_WORKFLOW.md`](../FR_AUTHORING_WORKFLOW.md)

---

## §1 — What was produced this session

### Backlog + Manifest

- [`BACKLOG.md`](BACKLOG.md) — phase-by-phase index, 29 authored + 13 roadmapped = 42 FRs total.
- [`MANIFEST.json`](MANIFEST.json) — state file, 6 batches recorded, 12 module FR counters.

### FRs + Audits (26 shipped P0-P2, 3 P3 drafts in progress)

**P0 · Pre-MVP Foundation** (8 FRs · 8 audits)

| Module | FR | Audit |
|---|---|---|
| AUTH | [FR-AUTH-001](auth/FR-AUTH-001-google-oauth-authjs-v5.md) | [audit](auth/FR-AUTH-001-google-oauth-authjs-v5.audit.md) |
| AUTH | [FR-AUTH-002](auth/FR-AUTH-002-email-magic-link.md) | [audit](auth/FR-AUTH-002-email-magic-link.audit.md) |
| AUTH | [FR-AUTH-003](auth/FR-AUTH-003-jwt-session-refresh.md) | [audit](auth/FR-AUTH-003-jwt-session-refresh.audit.md) |
| LEGAL | [FR-LEGAL-001](legal/FR-LEGAL-001-pdpl-dpia-dpo.md) | [audit](legal/FR-LEGAL-001-pdpl-dpia-dpo.audit.md) |
| LEGAL | [FR-LEGAL-002](legal/FR-LEGAL-002-affiliate-disclosure-surfaces.md) | [audit](legal/FR-LEGAL-002-affiliate-disclosure-surfaces.audit.md) |
| OBS | [FR-OBS-001](obs/FR-OBS-001-sentry-posthog-betterstack.md) | [audit](obs/FR-OBS-001-sentry-posthog-betterstack.audit.md) |
| WORKER | [FR-WORKER-001](worker/FR-WORKER-001-bullmq-redis-baseline.md) | [audit](worker/FR-WORKER-001-bullmq-redis-baseline.audit.md) |
| WORKER | [FR-WORKER-002](worker/FR-WORKER-002-adaptive-scheduler.md) | [audit](worker/FR-WORKER-002-adaptive-scheduler.audit.md) |

→ [P0_AUDIT_SUMMARY.md](P0_AUDIT_SUMMARY.md)

**P1 · MVP Core + Extension Lite** (12 FRs · 12 audits)

| Module | FR | Audit |
|---|---|---|
| AFF | [FR-AFF-001](aff/FR-AFF-001-shopee-affiliate-client.md) | [audit](aff/FR-AFF-001-shopee-affiliate-client.audit.md) |
| AFF | [FR-AFF-002](aff/FR-AFF-002-generateshortlink-attribution.md) | [audit](aff/FR-AFF-002-generateshortlink-attribution.audit.md) |
| AFF | [FR-AFF-003](aff/FR-AFF-003-product-shop-offer-resolver.md) | [audit](aff/FR-AFF-003-product-shop-offer-resolver.audit.md) |
| AFF | [FR-AFF-004](aff/FR-AFF-004-product-search-cached.md) | [audit](aff/FR-AFF-004-product-search-cached.audit.md) |
| WATCH | [FR-WATCH-001](watch/FR-WATCH-001-paste-shopee-url-track.md) | [audit](watch/FR-WATCH-001-paste-shopee-url-track.audit.md) |
| WATCH | [FR-WATCH-002](watch/FR-WATCH-002-alert-config-triggers.md) | [audit](watch/FR-WATCH-002-alert-config-triggers.audit.md) |
| WATCH | [FR-WATCH-003](watch/FR-WATCH-003-list-pause-delete-cap.md) | [audit](watch/FR-WATCH-003-list-pause-delete-cap.audit.md) |
| PRICE | [FR-PRICE-001](price/FR-PRICE-001-timescaledb-hypertable.md) | [audit](price/FR-PRICE-001-timescaledb-hypertable.audit.md) |
| PRICE | [FR-PRICE-002](price/FR-PRICE-002-history-chart-api.md) | [audit](price/FR-PRICE-002-history-chart-api.audit.md) |
| NOTIF | [FR-NOTIF-001](notif/FR-NOTIF-001-email-alert-resend.md) | [audit](notif/FR-NOTIF-001-email-alert-resend.audit.md) |
| NOTIF | [FR-NOTIF-002](notif/FR-NOTIF-002-web-push-vapid.md) | [audit](notif/FR-NOTIF-002-web-push-vapid.audit.md) |
| EXT | [FR-EXT-001](ext/FR-EXT-001-chrome-mv3-track-button.md) | [audit](ext/FR-EXT-001-chrome-mv3-track-button.audit.md) |

→ [P1_AUDIT_SUMMARY.md](P1_AUDIT_SUMMARY.md)

**P2 · Growth & Monetization** (6 FRs · 6 audits)

| Module | FR | Audit |
|---|---|---|
| BILL | [FR-BILL-001](bill/FR-BILL-001-freemium-stripe-vnpay-momo.md) | [audit](bill/FR-BILL-001-freemium-stripe-vnpay-momo.audit.md) |
| NOTIF | [FR-NOTIF-003](notif/FR-NOTIF-003-telegram-bot.md) | [audit](notif/FR-NOTIF-003-telegram-bot.audit.md) |
| GROW | [FR-GROW-001](grow/FR-GROW-001-referral-program.md) | [audit](grow/FR-GROW-001-referral-program.audit.md) |
| GROW | [FR-GROW-002](grow/FR-GROW-002-share-deal-with-friend.md) | [audit](grow/FR-GROW-002-share-deal-with-friend.audit.md) |
| GROW | [FR-GROW-003](grow/FR-GROW-003-mega-sale-mode.md) | [audit](grow/FR-GROW-003-mega-sale-mode.audit.md) |
| ADMIN | [FR-ADMIN-001](admin/FR-ADMIN-001-b2b-contact-form.md) | [audit](admin/FR-ADMIN-001-b2b-contact-form.audit.md) |

→ [P2_AUDIT_SUMMARY.md](P2_AUDIT_SUMMARY.md)

**P3 + P4** are roadmap rows in `BACKLOG.md §5–§6`. Re-batch when P2 exit metrics land (see P2_AUDIT_SUMMARY.md §6 triggers).

---

## §2 — Totals

| Metric | Value |
|---|---:|
| Files written | 60 (backlog + manifest + FR/audit files + phase summaries) |
| Bytes written | ~380 KB |
| FRs authored | 28 |
| FRs roadmapped | 14 |
| Total FRs planned | 42 |
| Effort sum (authored P0–P2 + P3 drafts) | ~189 hours |
| Effort sum (all 5 phases) | ~336 hours (~22 person-weeks calendar) |
| Audit rounds per FR | 2 (engineering-spec template v1) |
| Average pre-revision score | 8.3 / 10 |
| Final score (audited FRs) | 10 / 10 |
| Critical issues remaining | 0 |
| P3 drafts in progress | 2 |
| Plan PDF pages covered | 34 / 34 |

---

## §3 — Cross-cutting design decisions made this session

| Decision | Where it lives |
|---|---|
| Auth.js v5.0.0-beta.25 pinned (no `latest`) with CI grep gate | FR-AUTH-001 |
| Disclosure paragraph as a constant; snapshot test enforces drift | FR-LEGAL-002 §1 #1 |
| Three-tier adaptive scheduler 30m/6h/24h with 50% throttle on 5% error window | FR-WORKER-002 |
| MongoDB + TimescaleDB hybrid via dual-write outbox pattern | FR-AFF-003 + FR-PRICE-001 |
| Single idempotency key across email + push + telegram | NOTIF-001/002/003 |
| Refresh token reuse-detection revokes family | FR-AUTH-003 |
| Strict Chrome MV3 scope `*://*.shopee.vn/*` only (no `<all_urls>`) | FR-EXT-001 |
| 5 ethical principles enforced via ESLint rule + grep CI | FR-LEGAL-002 §1 #8–#10 |
| Freemium 10-product cap as the conversion moment with `upgradeUrl` 403 | FR-WATCH-001 + FR-BILL-001 |
| 3-qualified-invite referral with anti-fraud guards | FR-GROW-001 |
| Mega Sale Mode hot-tier override capped at 50K products | FR-GROW-003 + FR-WORKER-002 |

---

## §4 — Next steps

### Implementation checkpoint — 2026-05-17

All 26 authored P0-P2 FRs have been implemented and marked `shipped` in their FR frontmatter, `BACKLOG.md`, and `MANIFEST.json`.

Notable completion work:

- Added missing queue production pieces: shared queue registry, queue depth health, housekeeping/commission workers, price-check worker, trigger evaluation dispatch, and scheduler tier reevaluation.
- Added PDPL DSR API module with export/delete request endpoints plus AES-256-GCM envelope encryption and PII hashing for restricted data.
- Completed B2B contact plumbing from web form to API, including the public endpoint alias, hashed/encrypted lead PII, Slack/PostHog events, and confirmation email path.
- Added missing Chrome extension and Web Push icon assets referenced by the manifest/service worker.
- Added Auth session-family listing/revoke route and real gateway checkout creation paths for Stripe, VNPay, and MoMo when production credentials are present.

### Current transition — 2026-05-18

P0-P2 are now the shipped baseline. The team is shifting into P3 re-batch and authoring mode, and the first P3 drafts now exist as `FR-AFF-005` for Lazada Affiliate API integration, `FR-AFF-006` for TikTok Shop affiliate discovery, and `FR-AFF-007` for the AccessTrade publisher failover path.

P3 fallback re-batch has now extended to `FR-AFF-007` for the AccessTrade publisher failover path.

Verification checkpoint:

- Direct `fr-check` and `legal-check` scripts pass.
- Direct package TypeScript checks pass for API, Web, and Extension.
- Direct unit tests pass for API and Web.
- Extension build emits `dist/` with manifest, scripts, and icons.

Known local runner caveat:

- Root `pnpm <script>` currently invokes pnpm's install/deps-status path and is blocked by pnpm 11 ignored-build approval state in this checkout. Direct package binaries were used for verification until the checkout's pnpm build approvals are refreshed.

### P3 authoring kickoff

1. Re-batch P3 from `BACKLOG.md` plus the trigger rules in `P2_AUDIT_SUMMARY.md §6`.
2. Author `FR-AFF-005`, `FR-AFF-006`, and `FR-AFF-007` as the first P3 drafts.
3. Complete audit round 1 on each FR before starting the next P3 FR.
4. Only after each FR reaches `10/10` should the next FR be started.

---

## §5 — Risks open at end-of-session

| Risk | From plan | Mitigation in FRs | Status |
|---|---|---|:-:|
| Shopee changes Affiliate API | §H Risk Matrix | FR-AFF-001 breaker + retry; FR-AFF-007 (P3) AccessTrade fallback | Mitigated |
| Shopee blocks extension | §H | FR-EXT-001 §C9 strict scope; Plan B bookmarklet documented | Mitigated |
| Chrome Web Store rejects | §H | FR-EXT-001 §1 #11 policy alignment; LEGAL-002 disclosure | Mitigated |
| Honey-style scandal | §A2 | FR-LEGAL-002 §1 #8–#10 five-principles firewall | Mitigated |
| ShopBack pivot competition | §H | Plan §K2 "Defensive moat — data history + brand integrity" | Long-term |
| Intern team delivery slip | §H | Senior Tech Lead full-time (§11 of FRs) | Mitigated |
| PDPL violation | §H + §B3 | FR-LEGAL-001 full DPIA + DPO + A05 path | Mitigated |
| Vercel/Railway free-tier overrun | §H + §C5 | FR-OBS-001 cost alerts + multi-cloud Plan B doc'd | Mitigated |

---

## §6 — Workflow provenance

The full authoring + audit process is self-contained in this project at [`../FR_AUTHORING_WORKFLOW.md`](../FR_AUTHORING_WORKFLOW.md):

- **Schema:** YAML frontmatter (id/title/module/priority/status/verify/phase/slice/owner/created/related_frs/depends_on/blocks/effort_hours/new_files/modified_files/allowed_tools/disallowed_tools/risk_if_skipped) — see workflow §6.
- **Sections:** §1 BCP-14 normative / §2 rationale / §3 contract / §4 acceptance / §5 verification / §6 skeleton / §7 deps / §8 examples / §9 open questions / §10 failure modes / §11 notes — see workflow §4.
- **Audit template:** `engineering-spec@1`, 2-round revision history with score progression — see workflow §5.

---

*Session complete. 29 FRs authored; 26 shipped P0-P2 + 3 P3 drafts in progress. BRAIN ledger heartbeat emitted per AGENTS.md §14.*
