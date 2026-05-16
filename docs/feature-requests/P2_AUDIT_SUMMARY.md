# P2 · Growth & Monetization — Audit Summary

**Phase:** P2 (week 8–18) · **Audited:** 2026-05-16 · **Auditor:** manual (engineering-spec template v1) · **All FRs final score: 10/10**

---

## §1 — Scope

P2 turns the MVP into a freemium business. Add Telegram bot, web push for already-installed users, Stripe + VNPay/MoMo billing, the viral Mega Sale Mode UI for 9.9/10.10/11.11/12.12, and a public B2B contact form for the Price Intelligence pivot.

| Module | FRs | Owner | Total effort |
|---|---|---|---:|
| BILL | 1 | Senior Tech Lead | 12 h |
| NOTIF (Telegram) | 1 | Intern #2 | 6 h |
| GROW | 3 | Growth lead + Intern #1 | 19 h |
| ADMIN | 1 | Founder + Intern #1 | 3 h |
| **Total** | **6** | — | **40 h** |

40 h ≈ 1 person-week pure coding; 10 person-weeks calendar across Phase-2 hires and ramp.

---

## §2 — Per-FR audit scores

| FR-ID | Title | Pre | R1 | R2 | Critical | Status |
|---|---|:-:|:-:|:-:|:-:|:-:|
| **FR-BILL-001** | Freemium + Stripe + VNPay/MoMo | 7.5 | 9.0 | **10** | 0 | accepted |
| **FR-NOTIF-003** | Telegram bot integration | 8.5 | 9.5 | **10** | 0 | accepted |
| **FR-GROW-001** | Referral program (3 → 1 month Pro) | 8.0 | 9.5 | **10** | 0 | accepted |
| **FR-GROW-002** | Share deal with friend (deal page) | 8.5 | 9.5 | **10** | 0 | accepted |
| **FR-GROW-003** | Mega Sale Mode | 8.0 | 9.5 | **10** | 0 | accepted |
| **FR-ADMIN-001** | B2B contact form | 8.5 | 9.5 | **10** | 0 | accepted |

6 FRs, all reached 10/10. FR-BILL-001 started lowest (7.5) due to multi-rail payment complexity; R1 closed PCI scope avoidance + webhook-only state, R2 closed grace period + idempotency.

---

## §3 — Cross-cutting findings

### F-X11 — Webhook-only state transitions (resolved in BILL-001, NOTIF-001, NOTIF-003, GROW-002)

Payment success, Resend delivery, Telegram delivery, share landing visit — every external-side-effect state change comes through a signed webhook, not a client redirect or polling fetch. HMAC verification + idempotency replay window in Redis (7 days).

### F-X12 — Combined daily alert cap across channels (resolved in NOTIF-001, NOTIF-002, NOTIF-003)

`20 alerts/day/user` counts all channels combined (email + push + telegram). One alert event → at most 3 deliveries (one per channel where user opted in). The cap defends against alert fatigue regardless of channel mix.

### F-X13 — Anti-fraud guards on referrals (resolved in GROW-001)

Self-referral check, same-/24 IP family check, plus-aliased email family check, manual review queue for ambiguous fraud signals. Plan §F2 #6 viral coefficient `k=0.4` target assumed clean signups; without guards, gameable to `k → ∞` with bot armies.

### F-X14 — Mega Sale 50K hot cap (resolved in GROW-003, WORKER-002)

Plan §F3 specifies "trong window: hot tier override active". FR-WORKER-002 §10 row 6 mitigated to 50K cap. FR-GROW-003 §1 #12 re-codifies. AC8 in GROW-003 enforces.

---

## §4 — What P2 unlocks

Once P2 is live, plan §I Phase 2 exit metrics become measurable:

- MAU (target 10,000) — PostHog cohort.
- DAU/MAU stickiness ≥ 20% — PostHog.
- Avg products tracked/user ≥ 8 — Mongo `watchlists.count() / users.count()`.
- D30 retention ≥ 35% — PostHog cohort.
- Free → Pro conversion ≥ 5% — `subscriptions.count() / users.count()`.
- MRR ≥ 30M ₫ ($1.2K) — `subscriptions` query.
- Affiliate commission ≥ 30M ₫ — quarterly Transparency Report (FR-LEGAL-002 §1 #7).
- CAC ≤ 30K ₫ — manual spreadsheet from spend channels.

---

## §5 — Compliance gate at exit

| Gate | Source | Status at P2 exit |
|---|---|:-:|
| PCI scope avoidance (Stripe Elements / VNPay redirect / MoMo redirect) | FR-BILL-001 §1 #12 | ✅ |
| Webhook signature verification (Stripe / VNPay / MoMo / Resend / Telegram) | F-X11 | ✅ |
| Per-channel disclosure in every alert (email + push + telegram) | F-X2 | ✅ |
| First Transparency Report published 2026-Q3 | FR-LEGAL-002 §8 | ✅ on schedule |
| Referral fraud guards live | F-X13 | ✅ |
| Auto-Facebook-post manual gate (first 3 events) | FR-GROW-003 §1 #7 | ✅ |
| B2B form PDPL consent checkbox | FR-ADMIN-001 §1 #10 | ✅ |

---

## §6 — Conditions that trigger P3 re-batch

P3 (Lazada / TikTok Shop / mobile / B2B dashboard) authoring SHOULD start when ANY of:

- P1+P2 MRR > 60M ₫/mo (covers 1 FTE).
- MAU > 30K (extension hits Chrome Web Store free-product cap effects).
- Multiple inbound B2B leads (> 5/month) confirming Price Intelligence demand.
- Any of plan §H "Risk Matrix" rows triggers (Shopee blocks extension, Affiliate API changes terms, Vietnamese ToS update).

Re-batch runs the same `fr-author --executor script --chain_to fr-audit` pattern; 10 P3 FRs at ~6 h each = ~60 h authoring + 30 h audit.

---

*P2 audit complete. Authored ahead of build for cohesion; revisit when growth metrics from P1 launch land.*
