# SaleNoti FR Authoring — Session Progress

**Session:** 2026-05-16 · **Owner:** Stephen Cheng (Founder) · **Driver:** project-local workflow at [`../FR_AUTHORING_WORKFLOW.md`](../FR_AUTHORING_WORKFLOW.md)

---

## §1 — What was produced this session

### Backlog + Manifest

- [`BACKLOG.md`](BACKLOG.md) — phase-by-phase index, 26 authored + 16 roadmapped = 42 FRs total.
- [`MANIFEST.json`](MANIFEST.json) — state file, 3 batches recorded, 12 module FR counters.

### FRs + Audits (26 each, all 10/10)

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
| Files written | 56 (1 backlog + 1 manifest + 26 FR + 26 audit + 3 phase summaries) |
| Bytes written | ~380 KB |
| FRs authored | 26 |
| FRs roadmapped | 16 |
| Total FRs planned | 42 |
| Effort sum (authored phases P0–P2) | ~150 hours |
| Effort sum (all 5 phases) | ~336 hours (~22 person-weeks calendar) |
| Audit rounds per FR | 2 (engineering-spec template v1) |
| Average pre-revision score | 8.3 / 10 |
| Final score (every FR) | 10 / 10 |
| Critical issues remaining | 0 |
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

### Immediate (this week)

1. Founder reviews BACKLOG.md + 3 phase summaries → adjusts priorities if needed.
2. Senior Tech Lead reviews P0 FRs → accepts or sends revision notes.
3. Counsel one-shot consult booked (FR-LEGAL-001 dependency) — Tilleke & Gibbins recommended.
4. Shopee Affiliate VN registration submitted (FR-AFF-001 dependency, 1–2 week lead).

### Week 1–2 (P0 build)

5. AUTH, LEGAL, OBS, WORKER modules built in order per `depends_on` graph.
6. CI gates added: pin checks, manifest-lint, disclosure snapshot, commission-rate grep.

### Week 2–8 (P1 build)

7. AFF, WATCH, PRICE, NOTIF, EXT modules build per dependency graph.
8. Chrome Web Store submission rehearsal in week 7; submit in week 8.
9. Closed beta of 50 users (network founder + 2 FB groups per plan §F5).

### Week 8 launch

10. Public launch (Product Hunt + TinHTe + Spiderum + Reddit r/Vietnam per plan §F2 #4).
11. Phase 1 success criteria measured weekly.

### Re-batch trigger

P3 FR authoring starts when ANY trigger from P2_AUDIT_SUMMARY.md §6 fires.

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

*Session complete. 26 FRs ready for build. BRAIN ledger heartbeat emitted per AGENTS.md §14.*
