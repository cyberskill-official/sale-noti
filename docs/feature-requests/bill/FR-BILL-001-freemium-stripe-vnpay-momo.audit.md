---
fr_id: FR-BILL-001
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.0/10
score_post_revision_1: 8.5/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 13
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-BILL-001 ships ship-grade after two rounds. This is the entire revenue surface of the product — every plan §I MRR target (30M ₫ at P2, $10K at P3) flows through this billing pipeline. Three gateways (Stripe, VNPay, MoMo) each with their own webhook signature scheme, retry semantics, and refund flow, multiplied by the state-machine complexity (active/past_due/grace/cancelled/recovered), makes this the highest-state-space FR in the catalog. Mistakes here are double-charge or revenue-leak class.

Round-1 (7 issues): VNPay = invoice-renewal model (not subscription), webhook-only state transitions, 7-day grace period state machine, soft-over-cap on downgrade, coupon validation flow, refund policy (first-30-days auto-approve), PCI scope explicit.

Round-2 (6 issues): webhook idempotency via `webhookEvents`, gateway-customer-id mapping (never trust gateway email), Doppler N-1 secret rotation acceptance, chargeback handling, plan upgrade mid-cycle, Vietnamese accounting law 7-year retention.

All 13 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — VNPay modeled as recurring (broken; VN cards don't support indefinite tokenization)
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #4 + §2 explanation: invoice-renewal model with 3-day-ahead renewal link, standard VN SaaS pattern.

### ISS-002 — State applied on client redirect (race risk)
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #9 + §2 paragraph: webhook-only state transitions, `/billing/success` is UI confirmation that polls `/v1/billing/me`.

### ISS-003 — Grace period state machine ambiguous
- **severity:** error · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #11 + #12 explicit state transitions; AC7/AC8/AC9 verify day 0/+3/+7 transitions; AC10 verifies recovery.

### ISS-004 — Auto-delete watchlists on downgrade (data destruction)
- **severity:** warning · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #16 soft-over-cap; AC14 verifies all watchlists preserved; FR-WATCH-002 skips beyond cap; AC15 verifies reactivation restores.

### ISS-005 — Coupon validation flow missing
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #24 + §1 #25 + AC18+AC19 + §6 CouponService.

### ISS-006 — Refund policy not specified
- **severity:** warning · **rule_id:** ux-correctness + compliance
- **status:** RESOLVED — §1 #17 + #18 + §9 Q4: first-30-days auto-approve; admin override for older; chargeback handled via §10 row 14.

### ISS-007 — PCI scope unclear
- **severity:** error · **rule_id:** compliance
- **status:** RESOLVED — §1 #21 + #22 + disallowed_tools rule; Stripe Elements / VNPay redirect / MoMo redirect keep us SAQ-A; only last4 + brand stored.

## §3 — Round-2 findings (all resolved)

### ISS-008 — Webhook idempotency not implemented
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #10 + §6 `webhookEvents` unique index on `{eventId, gateway}`; AC4 + AC21 verify duplicate/parallel handling.

### ISS-009 — Trust gateway email for user mapping (account-takeover risk)
- **severity:** error · **rule_id:** security
- **status:** RESOLVED — disallowed_tools rule explicit; §1 #2 + §10 row 12: always map via stored `gatewayCustomerId`.

### ISS-010 — Doppler secret rotation breaks inflight webhooks
- **severity:** warning · **rule_id:** ops-reliability
- **status:** RESOLVED — §10 row 11 + §11 N-1 acceptance window for 1h.

### ISS-011 — Chargeback handling undefined
- **severity:** warning · **rule_id:** spec-completeness
- **status:** RESOLVED — §9 Q5 + §10 row 14: immediate Pro suspension on `charge.dispute.created`; admin restoration if user wins dispute.

### ISS-012 — Plan upgrade mid-cycle not specified
- **severity:** info · **rule_id:** ux-correctness
- **status:** RESOLVED — §9 Q8 + §10 row 17: Stripe pro-rates; VNPay/MoMo manual flow documented; ~5% of conversions.

### ISS-013 — Vietnamese accounting law retention not addressed
- **severity:** error · **rule_id:** compliance
- **status:** RESOLVED — §1 #23 explicit 7-year retention post-cancellation per VN regs; PII purge per FR-LEGAL-001 retention flow.

## §4 — Strengths preserved

- **Three-gateway abstraction via `BillingGateway` interface** contains adapter complexity behind a single contract; adding a fourth rail (e.g., ZaloPay in P3) is a single new adapter.
- **VNPay invoice-renewal model** correctly reflects Vietnamese card-issuance reality (no indefinite tokenization), avoiding the trap of trying to use Stripe-style recurring on VNPay's actual API surface.
- **Webhook-only state transitions** are the modern SaaS billing consensus; `/billing/success` is UI-only.
- **7-day grace period with day-3 reminder** is the industry standard balance between revenue recovery and UX courtesy.
- **Soft-over-cap on downgrade** preserves user data; reactivation immediately restores function, converting churn moments into "I miss Pro" moments.
- **Idempotent webhook handling** via `webhookEvents` unique index handles Stripe's retry-on-5xx, VNPay's retry behavior, and MoMo's redeliveries uniformly.
- **PCI scope minimization** — Stripe Elements / VNPay redirect / MoMo redirect keep us at SAQ-A (the lightest PCI tier); we never see card numbers.
- **First-30-days auto-approve refund** + chargeback fast-suspend protects both NSM trust AND gateway reputation.
- **§10 has 18 failure-mode rows** including the subtle "Doppler N-1 rotation", "chargeback dispute", and "Vietnamese accounting law 7-year retention" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. The single revenue surface of the product — every Pro/Pro+ MRR target depends on this pipeline. Three-gateway integration + state-machine correctness + idempotency-by-construction makes this the highest-stake P2 FR. Combined with FR-GROW-001 referral free-month and FR-WATCH-003 cap-driven conversion trigger, this completes the freemium conversion loop.

---

*End of FR-BILL-001 audit (round 2 final). Last revised: 2026-05-16.*
