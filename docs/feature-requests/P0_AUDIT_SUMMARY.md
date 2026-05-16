# P0 · Pre-MVP Foundation — Audit Summary

**Phase:** P0 (week 0–2) · **Audited:** 2026-05-16 · **Auditor:** manual (engineering-spec template v1) · **All FRs final score: 10/10**

---

## §1 — Scope

P0 establishes the cross-cutting infrastructure that everything else depends on: authentication, legal/PDPL compliance, observability, and the queue baseline with adaptive scheduling.

| Module | FRs | Owner | Total effort |
|---|---|---|---:|
| AUTH | 3 | Senior Tech Lead | 16 h |
| LEGAL | 2 | Founder + counsel | 10 h |
| OBS | 1 | Senior Tech Lead | 4 h |
| WORKER | 2 | Senior Tech Lead | 11 h |
| **Total** | **8** | — | **41 h** |

41 h ≈ 1 person-week of focused work; 2 person-weeks calendar with handoffs.

---

## §2 — Per-FR audit scores

| FR-ID | Title | Pre | R1 | R2 | Critical | Status |
|---|---|:-:|:-:|:-:|:-:|:-:|
| **FR-AUTH-001** | Google OAuth via Auth.js v5 pinned | 8.5 | 9.5 | **10** | 0 | accepted |
| **FR-AUTH-002** | Email magic-link auth | 8.5 | 9.5 | **10** | 0 | accepted |
| **FR-AUTH-003** | JWT session + refresh rotation | 8.0 | 9.5 | **10** | 0 | accepted |
| **FR-LEGAL-001** | PDPL DPIA + DPO + A05 72h | 7.5 | 9.0 | **10** | 0 | accepted |
| **FR-LEGAL-002** | Affiliate disclosure surfaces | 8.0 | 9.5 | **10** | 0 | accepted |
| **FR-OBS-001** | Sentry + PostHog + Better Stack | 8.0 | 9.5 | **10** | 0 | accepted |
| **FR-WORKER-001** | BullMQ + Redis + Bull Board | 8.5 | 9.5 | **10** | 0 | accepted |
| **FR-WORKER-002** | Adaptive scheduler 30m/6h/24h | 8.0 | 9.5 | **10** | 0 | accepted |

8 FRs, all reached 10/10 after two audit rounds. Zero critical issues remaining.

---

## §3 — Cross-cutting findings (resolved across multiple FRs)

### F-X1 — Doppler secret hygiene (resolved in AUTH-001, AUTH-003, AFF-001, LEGAL-001, OBS-001, WORKER-001, BILL-001)

Every credential path (Google OAuth, Auth secret, refresh-token salt, Shopee app secret, VAPID keys, Resend, Sentry DSN, Stripe, VNPay, MoMo) loads from Doppler. No `.env*` committed. Pre-commit grep + CI gate. Plan §C5 binding.

### F-X2 — Disclosure-first pattern (resolved in LEGAL-002, AUTH-002, NOTIF-001, NOTIF-002, NOTIF-003, EXT-001, GROW-002, ADMIN-001)

The canonical disclosure paragraph (FR-LEGAL-002 §1 #1) is binding wherever an affiliate-tagged surface appears: magic-link email, alert email, web push body, Telegram bot message, extension onboarding, share/deal landing page, B2B form footer. Snapshot tests in CI prevent drift.

### F-X3 — Idempotency across alert channels (resolved in NOTIF-001, NOTIF-002, NOTIF-003)

Single `idem = sha256(userId|watchlistId|triggerKind|observedAt)` key shared across email + web push + Telegram. A single triggered alert sends ≤ 1 message per channel.

### F-X4 — Five ethical principles firewall (resolved in LEGAL-002, AFF-002, AFF-003, EXT-001, GROW-002)

The 5 principles from plan §A3 are codified into MUST NOT clauses: no commission-rate ranking (grep + ESLint), no auto-apply coupon (ESLint rule), respect-other-publisher cookie (`respect_other_publisher: true` mechanic), public source revenue model + open math, quarterly transparency report.

### F-X5 — Adaptive rate-budget defense in depth (resolved in AFF-001, WORKER-002)

Three independent controls protect the Shopee Affiliate API budget: producer-side BullMQ `limiter` (1000/min on `price-check`), token-bucket guard inside the client (`shopee:rl:global` in Redis), and circuit breaker on 5 consecutive failures or 50% error rate over 20-call window. Health-windowed throttle scales down to 50% when 5% of calls error in any 5-min window.

---

## §4 — What P0 unlocks

Once P0 is live:

- User identity, sessions, and cross-origin extension auth are functional → P1 WATCH-001 can resolve `userId` from JWT.
- PDPL filed + disclosure surfaces baked in → P1 NOTIF/EXT/GROW can ship affiliate-tagged links without legal/Chrome Web Store risk.
- OBS pipeline live → P1 alerts and worker telemetry feed dashboards immediately (no instrumentation backfill).
- Queue + scheduler ready → P1 price-check + alert-dispatch can plug into existing workers.

P0 has **no external blockers** beyond Shopee Affiliate VN registration (1–2 weeks lead) and counsel one-shot consult (within first 4 weeks).

---

## §5 — Compliance gate at exit

| Gate | Source | Status at P0 exit |
|---|---|:-:|
| DPIA filed with A05 (Decree 13 Art. 24) | FR-LEGAL-001 AC1 | ✅ |
| DPO appointed (Decree 13 Art. 28) | FR-LEGAL-001 AC2 | ✅ |
| Privacy Policy + cross-border transfer assessment | FR-LEGAL-001 AC3, AC9 | ✅ |
| Disclosure paragraph in store listing + email footer + onboarding | FR-LEGAL-002 AC1, AC3, AC4 | ✅ |
| Sentry + PostHog + Better Stack baseline live | FR-OBS-001 AC1, AC3, AC7 | ✅ |
| Auth.js v5 pinned (no `latest`) | FR-AUTH-001 AC8 | ✅ |
| BullMQ + Bull Board behind basic auth | FR-WORKER-001 AC4 | ✅ |

All P0 compliance gates are mechanically enforceable (CI grep, snapshot tests, dashboard checks).

---

## §6 — Open questions deferred to later phases

None. All §9 sections across the 8 P0 FRs are closed with explicit decisions. Items moved to P3/P4 are roadmap rows in `BACKLOG.md`, not open questions.

---

*P0 audit complete. Ready to build.*
