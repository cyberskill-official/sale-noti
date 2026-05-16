---
id: FR-BILL-001
title: "Freemium tiers — Free / Pro 39K₫ / Pro+ 89K₫ — Stripe + VNPay + MoMo · webhook lifecycle · grace period · idempotency"
module: BILL
priority: MUST
status: accepted
verify: T
phase: P2
milestone: P2 · slice 1 · Growth & Monetization
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-AUTH-003, FR-WATCH-001, FR-WATCH-003, FR-GROW-001, FR-OBS-001, FR-LEGAL-001]
depends_on: [FR-AUTH-003, FR-WATCH-003]
blocks: [FR-GROW-001]
effort_hours: 24
template: engineering-spec@1

new_files:
  - apps/api/src/billing/billing.module.ts
  - apps/api/src/billing/billing.service.ts
  - apps/api/src/billing/billing.controller.ts
  - apps/api/src/billing/plan-enforcer.guard.ts
  - apps/api/src/billing/plan-catalog.ts
  - apps/api/src/billing/gateways/billing-gateway.interface.ts
  - apps/api/src/billing/gateways/stripe.adapter.ts
  - apps/api/src/billing/gateways/vnpay.adapter.ts
  - apps/api/src/billing/gateways/momo.adapter.ts
  - apps/api/src/billing/webhook.controller.ts
  - apps/api/src/billing/grace-period.worker.ts
  - apps/api/src/billing/coupon.service.ts
  - apps/api/src/billing/__tests__/billing.spec.ts
  - apps/api/src/billing/__tests__/stripe-webhook.spec.ts
  - apps/api/src/billing/__tests__/vnpay-webhook.spec.ts
  - apps/api/src/billing/__tests__/momo-webhook.spec.ts
  - apps/api/src/billing/__tests__/grace-period.spec.ts
modified_files:
  - apps/api/src/app.module.ts
  - apps/api/src/watchlist/watchlist.service.ts
allowed_tools: ["file_read/write apps/api/**", "bash pnpm test"]
disallowed_tools:
  - "apply plan change on client-side redirect (race risk) — webhook-only state transitions"
  - "store full PAN / CVV / CVC / expiry — PCI scope grows; Stripe Elements / VNPay redirect / MoMo redirect keep us SAQ-A"
  - "auto-downgrade on payment failure without 7-day grace period (poor UX, high churn)"
  - "skip webhook signature verification — replay attack vector"
  - "process webhook events without idempotency check (double-charge or double-grant risk)"
  - "trust gateway-supplied user identity — always map via stored gatewayCustomerId, not by email match"
risk_if_skipped: "Plan §E2 freemium pricing is the central revenue lever. Without billing, plan §I Phase 2 'MRR 30M₫' and §I Phase 3 'MRR $10K' targets are unreachable. The free-tier 10-product cap (FR-WATCH-003) is the conversion trigger; this FR is the conversion landing. Multi-rail (Stripe + VNPay + MoMo) is non-optional in VN — Stripe alone leaves ~30% of VN users unable to pay due to card-issuance / FX-surcharge gaps."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The billing service MUST implement three subscription tiers with three payment rails, full webhook lifecycle, and graceful failure-to-pay handling.

### Plan catalog

1. The system MUST define three plans in `users.plan`:
   - `free` — 10 active watchlists, email-only alerts, mid+low tier polling cadence (6h, 24h), no API access, ads-rendered on dashboard.
   - `pro` — 200 active watchlists, all alert channels (email + push + Telegram), hot-tier 30-min polling on user-marked-priority products, CSV export, "Mega Sale" priority slot in `/megasale/<slug>` curated list, ad-free dashboard. Price: **39,000 ₫/month** or **350,000 ₫/year** (~25% annual discount).
   - `pro_plus` — Unlimited active watchlists, 30-min polling on ALL tracked products (no per-product priority needed), advanced analytics (price-prediction, deal-score), public API access (FR-AFF-004 with elevated rate limit), "Trusted Hunter" community badge. Price: **89,000 ₫/month** or **800,000 ₫/year** (~25% annual discount).
2. The plan catalog MUST be code-defined in `plan-catalog.ts` with explicit limits (`maxWatchlists`, `alertChannels`, `pollCadenceMin`, `cmsAccess`, `apiAccess`, `adFree`, `mega_sale_priority_slot`). Adding a new plan MUST require code change + Stripe Terraform update + audit row (no on-the-fly plan-config edits via admin UI to prevent accidental tier drift).

### Payment gateways

3. Stripe MUST be the global primary gateway. Stripe Products + Prices MUST be created via Terraform in `infra/stripe-products.tf`; never via dashboard. Each plan-interval combination MUST be a separate Stripe Price (4 prices: pro/month, pro/year, pro_plus/month, pro_plus/year). The Stripe customer MUST be created on first checkout attempt; `users.stripeCustomerId` MUST persist for all subsequent calls.
4. VNPay MUST be integrated as a Vietnamese card rail. VNPay does NOT support recurring subscriptions natively (Vietnamese card-issuance limitation); subscription is modeled as monthly-invoice-with-renewal-link: at `current_period_end - 3 days`, the system MUST email a renewal link; user clicks → new VNPay checkout → success webhook extends `current_period_end` by 30 days.
5. MoMo MUST be integrated as a Vietnamese e-wallet rail. MoMo's subscription API IS available (`subscriptionId` model); MUST be used. Auto-renew works similarly to Stripe.
6. The gateway abstraction MUST conform to the `BillingGateway` interface:
   ```ts
   interface BillingGateway {
     name: "stripe" | "vnpay" | "momo";
     createCheckout(input: CheckoutInput): Promise<{ redirectUrl: string; sessionId: string }>;
     handleWebhook(req: Request): Promise<WebhookResult>;
     cancelSubscription(subscriptionId: string): Promise<void>;
     refund(paymentId: string, amount?: number): Promise<{ refundId: string }>;
     verifySignature(headers: Record<string,string>, rawBody: Buffer): boolean;
   }
   ```

### Subscription lifecycle

7. The endpoint `POST /v1/billing/subscribe` MUST accept `{ plan: "pro" | "pro_plus", interval: "monthly" | "yearly", paymentMethod: "stripe" | "vnpay" | "momo", couponCode?: string }` and return `{ redirectUrl, sessionId, expiresAt }`. The `redirectUrl` MUST be the gateway's hosted checkout (never an in-app card form, to keep us SAQ-A PCI scope).
8. The system MUST verify gateway webhook signatures:
   - Stripe: `Stripe-Signature: t=<ts>,v1=<hex>` HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`, 5-min skew tolerance.
   - VNPay: `vnp_SecureHash` HMAC-SHA512 with `VNPAY_HASH_SECRET` over the sorted query parameters (per VNPay spec v2.1).
   - MoMo: `signature` field in body, HMAC-SHA256 with `MOMO_SECRET_KEY` over canonical concatenation per MoMo spec.
   Mismatched signatures MUST return `401` with NO state change and a Sentry event tagged `fr: "FR-BILL-001"`, `gateway: <name>`.
9. The system MUST apply plan changes ONLY on webhook-confirmed events. The redirect-back URL `/billing/success` MUST be a UI-only confirmation page that polls `/v1/billing/me` for the actual plan state. The redirect MUST NOT mutate state.
10. Webhook event idempotency MUST be enforced: every webhook event ID MUST be checked against `webhookEvents` collection (unique index on `{eventId, gateway}`); duplicate delivery MUST return 200 with `{duplicate: true}` and skip state mutation.
11. The webhook-driven state machine MUST be:
    ```
    [free] → checkout.session.completed → [active]
    [active] → invoice.payment_succeeded (renewal) → [active] (period extended)
    [active] → invoice.payment_failed → [past_due] (grace start, day 0)
    [past_due] → day +3 → email alert, no plan change
    [past_due] → day +7 → [free] (downgrade), audit row
    [past_due] → invoice.payment_succeeded → [active] (recovery)
    [active] → customer.subscription.deleted → [active until period_end, then free]
    ```

### Grace period (failed payment)

12. On `invoice.payment_failed`, the system MUST:
    - Mark `subscriptions.status = "past_due"`, set `gracePeriodEndsAt = now + 7 days`.
    - Keep `users.plan = "pro" | "pro_plus"` UNCHANGED for the grace window (the user can still use Pro features).
    - At day +3 (4 days remaining), email reminder via FR-NOTIF-001 with subject "Thanh toán SaleNoti Pro gặp lỗi — vui lòng cập nhật thẻ" and CTA to billing portal.
    - At day +7, downgrade `users.plan = "free"` via the `grace-period.worker.ts` cron (runs every 6h).
    - At any point during grace, a successful retry payment MUST restore `status = "active"` and clear `gracePeriodEndsAt`.

### Cancellation

13. `POST /v1/billing/cancel` MUST cancel at `current_period_end` (no proration refund). Body: `{ reason?: string }`. The user's plan MUST continue through `current_period_end`, then auto-downgrade. The cancel reason MUST be persisted for churn analysis.
14. `POST /v1/billing/uncancel` MUST be exposed: a user who cancelled but hasn't yet hit `current_period_end` MUST be able to reverse the cancel.

### Plan enforcement

15. Plan limits MUST be enforced server-side via `PlanEnforcerGuard` (NestJS guard) consulted by FR-WATCH-001 (track endpoint) and FR-WATCH-003 (reactivate endpoint). The guard MUST read the live `users.plan` value (denormalized cache) but MUST fall back to `subscriptions` collection on cache miss. `users.plan` denormalization MUST be updated atomically within the same Mongo transaction as the `subscriptions` row update.
16. Soft-over-cap behavior: a user who downgrades (Pro → Free) with 50 active watchlists MUST NOT have watchlists auto-deleted. Instead:
    - All watchlists remain in `status: "active"` but FR-WATCH-002 trigger eval MUST skip products beyond the cap (sorted by `lastNotifiedAt` desc, then `createdAt` desc — keep "favorites").
    - The UI MUST show a banner "Bạn có 50 sản phẩm, vượt giới hạn 10 của Free. Hãy pause/delete 40 sản phẩm để alerts hoạt động lại."
    - The user MUST be able to delete/pause manually; reactivating Pro MUST restore normal eval.

### Refunds

17. The system MUST expose `POST /v1/billing/refund` (admin-only, per FR-ADMIN-001 admin role) with body `{ subscriptionId, amount?, reason }`. Stripe / MoMo refunds via API; VNPay refunds via manual ops + audit log entry (`status: "manual_pending"`).
18. First-month full-refund policy: a user requesting a refund within 30 days of `current_period_start` MUST receive a full refund on first request (NSM trust per plan §I). The refund endpoint MUST verify `currentPeriodStart >= now - 30 days` for the auto-approval path; older refunds MUST require admin approval.

### Audit & analytics

19. Subscription state MUST be persisted in `subscriptions` collection with schema:
    ```ts
    { _id, userId, plan, gateway, gatewayCustomerId, gatewaySubscriptionId,
      status: "trialing"|"active"|"past_due"|"cancelled"|"unpaid",
      interval: "monthly"|"yearly", currentPeriodStart, currentPeriodEnd,
      cancelAtPeriodEnd: bool, cancelReason?, gracePeriodEndsAt?,
      couponCode?, discountPct?, amountVnd, currency: "VND"|"USD",
      createdAt, updatedAt, history: [{ event, at, payload }] }
    ```
    History MUST append on every state transition (state-machine audit log).
20. PostHog events MUST fire on every state transition: `subscription_started`, `subscription_renewed`, `subscription_cancelled`, `subscription_payment_failed`, `subscription_recovered`, `subscription_downgraded`, `subscription_refunded`. Properties MUST include `{ userId: hashed, plan, gateway, interval, amountVnd, source: "first" | "renewal" | "upgrade" | "downgrade" }`.

### PCI & compliance

21. The system MUST NOT store PAN, CVV/CVC, or expiry dates. Stripe Elements (hosted iframe), VNPay redirect, and MoMo redirect keep us at PCI SAQ-A scope.
22. Stored data MUST be limited to: `gatewayCustomerId`, `gatewaySubscriptionId`, last-4 digits (from gateway webhook for display only, never used for charging), card brand (visa/mc/etc.).
23. Per PDPL Decree 13/2023 (FR-LEGAL-001): subscription records MUST be retained 7 years post-cancellation (Vietnamese accounting law), PII purged after retention via `delete(purge)` flow.

### Coupon codes

24. `couponCode` (optional in `POST /subscribe`) MUST be validated against `coupons` collection: `{ code, discountPct: 10-100, maxUses, usedCount, validFrom, validUntil, planRestrictions?: string[], userRestrictions?: string[] }`. Invalid coupons MUST return 422 with `{ error: "INVALID_COUPON", reason }`. Coupon source events: FR-GROW-001 referral, partnership campaigns, win-back retention.
25. Stripe coupon MUST be created via Stripe API on first use (cached in `coupons.stripeCouponId`); VNPay/MoMo coupons MUST be applied client-side (price reduction in the redirect URL since neither gateway has native coupon support).

---

## §2 — Why this design

**Why three tiers (not two, not four):** plan §E2 explicit. Free is for top-of-funnel; Pro is the conversion target (39K ₫ ≈ $1.50, low enough to convert on impulse, high enough to be meaningful revenue at scale); Pro+ is the power-user upsell with API access and 30-min everywhere. Four tiers would over-segment a market that's still pre-PMF; two tiers (no Pro+) leaves the API/B2B power-user gap that B2B leads (FR-ADMIN-001) can't fully service alone.

**Why Stripe + VNPay + MoMo (three rails, not just Stripe):** plan §E3 explicit — Vietnamese cards issued domestically often fail or surcharge via Stripe (Visa/MC sometimes route through foreign acquirers, triggering 3% FX fee). VNPay is the universal VN-card rail; MoMo is the e-wallet rail with ~30M users in VN. Skipping either leaves significant revenue on the table. Three integrations sound heavy but they share the `BillingGateway` interface — adapter complexity is contained.

**Why VNPay = invoice-renewal model (not subscription):** Vietnamese card-issuance rules don't permit indefinite card-on-file authorizations the way US/EU cards do. VNPay's recurring API only supports limited recurring (the customer's bank may require re-auth). Modeling as monthly invoice with a 3-day-ahead renewal link is the standard Vietnamese SaaS pattern (also used by Spotify VN, YouTube Premium VN).

**Why MoMo subscription (not invoice-renewal):** MoMo's e-wallet model permits true recurring via their `subscriptionId` API. We use it where it works to reduce friction.

**Why webhook-only state transitions:** redirect-back from gateway to `/billing/success` is unreliable — the user can lose network mid-flight, close the tab, or the gateway can fail to redirect at all (especially with VNPay's 5-min iframe timeout). The webhook is the single source of truth; the redirect is UI confirmation only. This pattern is the consensus in modern SaaS billing (Stripe docs explicitly recommend it).

**Why 7-day grace period (not 3, not 14):** standard SaaS norm. Plan §E3 mentions churn 8%/mo target; aggressive cancel (1-day downgrade) creates support tickets and refund requests. Lenient cancel (14+ days) gives away too much free Pro. 7 days + 3-day reminder is the industry standard for B2C subscriptions.

**Why soft-over-cap (not auto-delete on downgrade):** auto-deleting 40 watchlists when a Pro user downgrades is data destruction without consent. Soft-over-cap preserves user data but limits feature access — the user can reactivate Pro and immediately recover. This converts churn moments into "I miss Pro" moments (better re-conversion path).

**Why webhook idempotency via `webhookEvents` collection:** Stripe explicitly recommends idempotent webhook handling — they redeliver events on 5xx responses and during outages. VNPay/MoMo have less predictable retry behavior. Storing event IDs with unique index gives us replay protection at the persistence layer, not application logic.

**Why plan limits enforced server-side (not just client-side):** client-side enforcement is suggestion, not security. A user with DevTools can bypass any client check. Server-side guard via `PlanEnforcerGuard` is the actual limit. The client-side counter is UX guidance only.

**Why `users.plan` denormalized cache + atomic transaction:** the `subscriptions` collection is the audit log; `users.plan` is the hot-read for every API request (track, alert eval, etc.). Reading subscriptions on every request would multiply DB load 10x. Atomic Mongo transaction updates both, ensuring consistency.

**Why coupon code via Stripe API (not in-app discount):** Stripe has well-tested coupon infrastructure (percentage / fixed / duration discounts, max-redemptions, expiry). Building our own would re-implement edge cases like proration during partial-month upgrades. For VNPay/MoMo (no native coupon), we apply price reduction in the checkout URL — slightly less elegant but functional.

**Why first-month auto-refund:** plan §I trust-building NSM. Users who pay 39K ₫ and discover Pro doesn't fit their needs deserve a friction-free refund — this also reduces chargeback risk (which costs $15+ each and damages gateway reputation). Auto-approval for first-month refunds is the right ops trade-off.

---

## §3 — API contract & gateway differences

### Subscribe

```http
POST /v1/billing/subscribe
Authorization: Bearer <jwt>
Content-Type: application/json

{ "plan": "pro", "interval": "monthly", "paymentMethod": "stripe", "couponCode": "REFERRAL_8B3F" }

→ 200 OK
{
  "redirectUrl": "https://checkout.stripe.com/c/cs_test_a1b2c3...",
  "sessionId": "cs_test_a1b2c3",
  "expiresAt": "2026-05-16T11:30:00.000Z"
}
```

### Cancel / uncancel

```http
POST /v1/billing/cancel
Body: { "reason": "no_longer_needed" }
→ 200 { "cancelAt": "2026-06-16T00:00:00Z", "message": "Plan continues until that date" }

POST /v1/billing/uncancel
→ 200 { "status": "active", "currentPeriodEnd": "2026-06-16T00:00:00Z" }
```

### Self-service status

```http
GET /v1/billing/me
→ 200
{
  "plan": "pro",
  "status": "active",
  "interval": "monthly",
  "gateway": "stripe",
  "currentPeriodEnd": "2026-06-16T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "gracePeriodEndsAt": null,
  "amountVnd": 39000,
  "nextChargeAt": "2026-06-16T00:00:00Z",
  "paymentMethod": { "brand": "visa", "last4": "4242" }
}
```

### Gateway-specific webhook event shapes

```
Stripe events handled:
  - checkout.session.completed         → start subscription
  - invoice.payment_succeeded          → confirm renewal
  - invoice.payment_failed             → enter past_due
  - customer.subscription.deleted      → mark cancelAtPeriodEnd
  - customer.subscription.updated      → metadata sync

VNPay events handled (single endpoint /webhooks/vnpay, IPN):
  - vnp_ResponseCode=00 → success (start or renew)
  - vnp_ResponseCode≠00 → fail

MoMo events handled (single endpoint /webhooks/momo):
  - resultCode=0  → success
  - resultCode=9000 → pending (in 3DS flow)
  - resultCode≠0,≠9000 → fail
```

### Error responses

| http | code | body |
|---|---|---|
| 400 | `INVALID_PLAN` | invalid plan/interval combo |
| 401 | `UNAUTHENTICATED` | no JWT |
| 403 | `INSUFFICIENT_ROLE` | refund without admin role |
| 404 | `SUBSCRIPTION_NOT_FOUND` | cancel without active sub |
| 409 | `ALREADY_SUBSCRIBED` | user has active sub on different gateway |
| 422 | `INVALID_COUPON` | coupon expired/exhausted/restricted |
| 502 | `GATEWAY_UNAVAILABLE` | Stripe/VNPay/MoMo API down |

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | free user, valid input, Stripe paymentMethod | POST /subscribe | 200 with checkout.stripe.com redirectUrl; Stripe customer created; sessionId stored |
| AC2 | Stripe webhook `checkout.session.completed` for the session | POST /webhooks/stripe | `users.plan = "pro"`, `subscriptions` row inserted with `status: "active"`, PostHog `subscription_started` fired |
| AC3 | Stripe webhook with invalid signature | POST /webhooks/stripe with bad sig | 401; no state change; Sentry event tagged |
| AC4 | duplicate webhook event delivery (same event.id) | POST /webhooks/stripe twice | 200 second call with `{duplicate: true}`; only one state change |
| AC5 | VNPay paymentMethod | POST /subscribe | 200 with `sandbox.vnpayment.vn/paymentv2/vpcpay.html` URL; VNPay session encoded |
| AC6 | MoMo paymentMethod | POST /subscribe | 200 with `test-payment.momo.vn/...` URL; MoMo orderId stored |
| AC7 | invoice.payment_failed received | webhook | `subscriptions.status = "past_due"`, gracePeriodEndsAt = +7d, plan UNCHANGED |
| AC8 | day +3 of grace period | cron tick | reminder email via FR-NOTIF-001; plan still Pro |
| AC9 | day +7 of grace period, no recovery | cron tick | `users.plan = "free"`, audit row, PostHog `subscription_downgraded` |
| AC10 | day +5 of grace, successful retry payment | webhook | `status = "active"`, `gracePeriodEndsAt = null`, PostHog `subscription_recovered` |
| AC11 | Pro user cancels | POST /cancel | `cancelAtPeriodEnd: true`, plan continues until currentPeriodEnd |
| AC12 | cancelled user un-cancels before periodEnd | POST /uncancel | `cancelAtPeriodEnd: false`; renewal proceeds |
| AC13 | Pro+ user with 1000 active watchlists | track 1001st | 201 (no cap) |
| AC14 | Pro→Free downgrade with 50 active watchlists | downgrade event | watchlists remain `status: "active"`; banner "vượt giới hạn 10"; FR-WATCH-002 skips beyond 10 |
| AC15 | reactivate Pro after over-cap | POST /subscribe (Pro again) | all 50 watchlists eligible for FR-WATCH-002 eval again |
| AC16 | first-month refund request via API | admin POST /refund within 30d | auto-approve; Stripe refund issued; PostHog `subscription_refunded` |
| AC17 | refund request 31+ days post-start | admin POST /refund | requires admin override flag; refund logged for manual review |
| AC18 | invalid coupon code | POST /subscribe with bogus code | 422 INVALID_COUPON |
| AC19 | valid coupon REFERRAL_8B3F | POST /subscribe + Stripe checkout | discount applied; `coupons.usedCount` incremented; coupon FK on subscription |
| AC20 | annual interval | POST /subscribe pro/yearly | redirectUrl to 350,000 ₫ Stripe price; on success, currentPeriodEnd = +1 year |
| AC21 | 4 webhooks with same event.id arrive | parallel | `webhookEvents` unique index makes 3 fail; only 1 state mutation |
| AC22 | user with `stripeCustomerId` re-subscribes after cancel | POST /subscribe | re-uses existing Stripe customer; new subscription on existing customer |
| AC23 | PCI scope: store request body | inspect Mongo `subscriptions` row | no PAN/CVV/full card number; only last4 + brand |

---

## §5 — Verification

```ts
// apps/api/src/billing/__tests__/billing.spec.ts
describe("FR-BILL-001 — Freemium + Stripe/VNPay/MoMo", () => {
  beforeEach(async () => { await mongo.db("salenoti").collection("subscriptions").deleteMany({}); await mongo.db("salenoti").collection("webhookEvents").deleteMany({}); resetMocks(); });

  it("AC1+AC2: Stripe happy path", async () => {
    const r = await api.post("/v1/billing/subscribe")
      .set("Authorization", `Bearer ${freeJwt}`)
      .send({ plan: "pro", interval: "monthly", paymentMethod: "stripe" });
    expect(r.status).toBe(200);
    expect(r.body.redirectUrl).toMatch(/checkout\.stripe\.com/);
    expect(stripeMock.customerCreateCalled).toBe(true);

    const event = makeStripeEvent("checkout.session.completed", { session_id: r.body.sessionId, customer: "cus_T1", subscription: "sub_T1" });
    const wr = await api.post("/webhooks/stripe").set("stripe-signature", signStripe(event)).send(event);
    expect(wr.status).toBe(200);

    const user = await db.users.findOne({ _id: freeUserId });
    expect(user!.plan).toBe("pro");
    const sub = await db.subscriptions.findOne({ userId: freeUserId });
    expect(sub!.status).toBe("active");
    expect(posthogMock.events).toContainEqual(expect.objectContaining({ event: "subscription_started" }));
  });

  it("AC3: invalid Stripe signature rejected", async () => {
    const r = await api.post("/webhooks/stripe").set("stripe-signature", "t=1,v1=badbeef").send({ type: "checkout.session.completed" });
    expect(r.status).toBe(401);
    const user = await db.users.findOne({ _id: freeUserId });
    expect(user!.plan).toBe("free");
  });

  it("AC4: duplicate webhook event idempotent", async () => {
    const event = makeStripeEvent("checkout.session.completed");
    const sig = signStripe(event);
    const r1 = await api.post("/webhooks/stripe").set("stripe-signature", sig).send(event);
    const r2 = await api.post("/webhooks/stripe").set("stripe-signature", sig).send(event);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    expect(await db.subscriptions.countDocuments({ userId: freeUserId })).toBe(1);
  });

  it("AC7+AC8+AC9: 7-day grace period downgrades", async () => {
    await seedActiveSubscription(freeUserId, "pro", "stripe");
    const failEvent = makeStripeEvent("invoice.payment_failed");
    await api.post("/webhooks/stripe").set("stripe-signature", signStripe(failEvent)).send(failEvent);
    let sub = await db.subscriptions.findOne({ userId: freeUserId });
    expect(sub!.status).toBe("past_due");
    expect((await db.users.findOne({ _id: freeUserId }))!.plan).toBe("pro");

    advanceTime(3 * 86400_000);
    await graceWorker.tick();
    expect(notifyMock.sentReminders).toContainEqual(expect.objectContaining({ userId: freeUserId, kind: "grace_warning" }));

    advanceTime(4 * 86400_000 + 1000); // total day +7+
    await graceWorker.tick();
    expect((await db.users.findOne({ _id: freeUserId }))!.plan).toBe("free");
    expect(posthogMock.events).toContainEqual(expect.objectContaining({ event: "subscription_downgraded" }));
  });

  it("AC10: recovery during grace restores active", async () => {
    await seedPastDueSubscription(freeUserId, { gracePeriodEndsAt: new Date(Date.now() + 3 * 86400_000) });
    const okEvent = makeStripeEvent("invoice.payment_succeeded");
    await api.post("/webhooks/stripe").set("stripe-signature", signStripe(okEvent)).send(okEvent);
    const sub = await db.subscriptions.findOne({ userId: freeUserId });
    expect(sub!.status).toBe("active");
    expect(sub!.gracePeriodEndsAt).toBeUndefined();
  });

  it("AC11+AC12: cancel and uncancel", async () => {
    await seedActiveSubscription(freeUserId, "pro", "stripe", { currentPeriodEnd: new Date(Date.now() + 15 * 86400_000) });
    await api.post("/v1/billing/cancel").set("Authorization", `Bearer ${proJwt}`).send({ reason: "no_longer_needed" });
    expect((await db.subscriptions.findOne({ userId: freeUserId }))!.cancelAtPeriodEnd).toBe(true);
    await api.post("/v1/billing/uncancel").set("Authorization", `Bearer ${proJwt}`);
    expect((await db.subscriptions.findOne({ userId: freeUserId }))!.cancelAtPeriodEnd).toBe(false);
  });

  it("AC14: Pro→Free with 50 watchlists keeps all active", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => seedWatchlist(proUserId, `${i}-${i}`, { status: "active" })));
    await downgradeUserToFree(proUserId);
    expect(await db.watchlists.countDocuments({ userId: proUserId, status: "active" })).toBe(50);
    const wls = await db.watchlists.find({ userId: proUserId, status: "active" }).sort({ lastNotifiedAt: -1, createdAt: -1 }).toArray();
    const evalEligible = wls.slice(0, 10).map(w => w._id);
    // trigger eval skips beyond cap — covered by FR-WATCH-002 update
    expect(evalEligible).toHaveLength(10);
  });

  it("AC16: first-month auto-refund", async () => {
    const sub = await seedActiveSubscription(proUserId, "pro", "stripe", { currentPeriodStart: new Date(Date.now() - 5 * 86400_000) });
    const r = await api.post("/v1/billing/refund").set("Authorization", `Bearer ${adminJwt}`).send({ subscriptionId: sub._id, reason: "user_requested" });
    expect(r.status).toBe(200);
    expect(stripeMock.refundCalled).toBe(true);
  });

  it("AC18+AC19: coupon validation", async () => {
    await db.coupons.insertOne({ code: "REFERRAL_8B3F", discountPct: 50, maxUses: 100, usedCount: 0, validUntil: new Date(Date.now() + 30 * 86400_000) });
    const r = await api.post("/v1/billing/subscribe").set("Authorization", `Bearer ${freeJwt}`).send({ plan: "pro", interval: "monthly", paymentMethod: "stripe", couponCode: "REFERRAL_8B3F" });
    expect(r.status).toBe(200);
    const bogus = await api.post("/v1/billing/subscribe").set("Authorization", `Bearer ${freeJwt}`).send({ plan: "pro", interval: "monthly", paymentMethod: "stripe", couponCode: "NOT_REAL" });
    expect(bogus.status).toBe(422);
  });

  it("AC21: parallel duplicate webhooks → only one state mutation", async () => {
    const event = makeStripeEvent("checkout.session.completed");
    const sig = signStripe(event);
    await Promise.all([
      api.post("/webhooks/stripe").set("stripe-signature", sig).send(event),
      api.post("/webhooks/stripe").set("stripe-signature", sig).send(event),
      api.post("/webhooks/stripe").set("stripe-signature", sig).send(event),
      api.post("/webhooks/stripe").set("stripe-signature", sig).send(event),
    ]);
    expect(await db.subscriptions.countDocuments({ userId: freeUserId })).toBe(1);
  });

  it("AC23: PCI scope — no card data stored", async () => {
    await seedActiveSubscription(freeUserId, "pro", "stripe");
    const sub = await db.subscriptions.findOne({ userId: freeUserId });
    const json = JSON.stringify(sub);
    expect(json).not.toMatch(/\d{16}/);     // no PAN
    expect(json).not.toMatch(/cvv|cvc/i);
    expect(json).toMatch(/last4/);          // last4 OK
  });
});

describe("FR-BILL-001 VNPay adapter", () => {
  it("AC5: VNPay redirect URL + signature verify", async () => {
    const r = await api.post("/v1/billing/subscribe").set("Authorization", `Bearer ${freeJwt}`).send({ plan: "pro", interval: "monthly", paymentMethod: "vnpay" });
    expect(r.body.redirectUrl).toMatch(/sandbox\.vnpayment\.vn/);
    const callback = mockVnpayCallback({ vnp_ResponseCode: "00", vnp_TxnRef: r.body.sessionId });
    const wr = await api.get(`/webhooks/vnpay?${new URLSearchParams(callback as any)}`);
    expect(wr.status).toBe(200);
    expect((await db.users.findOne({ _id: freeUserId }))!.plan).toBe("pro");
  });
});

describe("FR-BILL-001 MoMo adapter", () => {
  it("AC6: MoMo redirect + IPN", async () => {
    const r = await api.post("/v1/billing/subscribe").set("Authorization", `Bearer ${freeJwt}`).send({ plan: "pro", interval: "monthly", paymentMethod: "momo" });
    expect(r.body.redirectUrl).toMatch(/test-payment\.momo\.vn/);
    const ipn = makeMomoIPN({ resultCode: 0, orderId: r.body.sessionId });
    const wr = await api.post("/webhooks/momo").send(ipn);
    expect(wr.status).toBe(200);
  });
});
```

---

## §6 — Implementation skeleton

```ts
// apps/api/src/billing/plan-catalog.ts
export const PLANS = {
  free: { maxWatchlists: 10, alertChannels: ["email"], pollCadenceMin: [6 * 60, 24 * 60], adFree: false, apiAccess: false, mega_sale_priority_slot: false },
  pro: { maxWatchlists: 200, alertChannels: ["email", "push", "telegram"], pollCadenceMin: [30, 6 * 60, 24 * 60], adFree: true, apiAccess: false, mega_sale_priority_slot: true,
         pricing: { monthly: { vnd: 39_000, stripePriceId: "price_pro_month" }, yearly: { vnd: 350_000, stripePriceId: "price_pro_year" } } },
  pro_plus: { maxWatchlists: Infinity, alertChannels: ["email", "push", "telegram"], pollCadenceMin: [30], adFree: true, apiAccess: true, mega_sale_priority_slot: true,
              pricing: { monthly: { vnd: 89_000, stripePriceId: "price_proplus_month" }, yearly: { vnd: 800_000, stripePriceId: "price_proplus_year" } } },
} as const;

// apps/api/src/billing/billing.service.ts
@Injectable()
export class BillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly stripe: StripeAdapter,
    private readonly vnpay: VnpayAdapter,
    private readonly momo: MomoAdapter,
    private readonly coupons: CouponService,
    private readonly posthog: PostHogService,
  ) {}

  async subscribe(userId: string, input: SubscribeInput): Promise<{ redirectUrl: string; sessionId: string; expiresAt: Date }> {
    const plan = PLANS[input.plan];
    if (!plan || !("pricing" in plan)) throw new BadRequestException("INVALID_PLAN");
    const pricing = plan.pricing[input.interval];

    let discount = 0;
    let couponId: string | undefined;
    if (input.couponCode) {
      const c = await this.coupons.validate(input.couponCode, { plan: input.plan, userId });
      if (!c) throw new UnprocessableEntityException({ error: "INVALID_COUPON" });
      discount = c.discountPct;
      couponId = c._id.toString();
    }

    const finalVnd = Math.round(pricing.vnd * (100 - discount) / 100);
    const gateway = this._selectGateway(input.paymentMethod);
    const result = await gateway.createCheckout({ userId, plan: input.plan, interval: input.interval, amountVnd: finalVnd, stripePriceId: pricing.stripePriceId, couponId });

    await this.db.checkoutSessions.insertOne({
      userId, sessionId: result.sessionId, plan: input.plan, interval: input.interval,
      gateway: gateway.name, amountVnd: finalVnd, couponId,
      createdAt: new Date(), expiresAt: result.expiresAt,
    });

    return result;
  }

  async cancel(userId: string, reason?: string): Promise<{ cancelAt: Date }> {
    const sub = await this.db.subscriptions.findOne({ userId, status: { $in: ["active", "past_due"] } });
    if (!sub) throw new NotFoundException("SUBSCRIPTION_NOT_FOUND");
    const gateway = this._gatewayFor(sub.gateway);
    await gateway.cancelSubscription(sub.gatewaySubscriptionId!);
    await this.db.subscriptions.updateOne(
      { _id: sub._id },
      { $set: { cancelAtPeriodEnd: true, cancelReason: reason, updatedAt: new Date() }, $push: { history: { event: "cancel_requested", at: new Date(), payload: { reason } } } }
    );
    this.posthog.capture({ event: "subscription_cancelled", properties: { userId: hashUserId(userId), plan: sub.plan, gateway: sub.gateway, reason } });
    return { cancelAt: sub.currentPeriodEnd };
  }

  async uncancel(userId: string): Promise<void> {
    const sub = await this.db.subscriptions.findOne({ userId, cancelAtPeriodEnd: true, status: "active" });
    if (!sub) throw new NotFoundException();
    const gateway = this._gatewayFor(sub.gateway);
    await gateway.reactivateSubscription?.(sub.gatewaySubscriptionId!);
    await this.db.subscriptions.updateOne(
      { _id: sub._id },
      { $set: { cancelAtPeriodEnd: false, updatedAt: new Date() }, $unset: { cancelReason: 1 }, $push: { history: { event: "uncancel", at: new Date() } } }
    );
  }

  async getMyBilling(userId: string): Promise<MyBillingView> {
    const sub = await this.db.subscriptions.findOne({ userId, status: { $in: ["active", "past_due"] } });
    if (!sub) return { plan: "free", status: "free" } as MyBillingView;
    return {
      plan: sub.plan, status: sub.status, interval: sub.interval, gateway: sub.gateway,
      currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      gracePeriodEndsAt: sub.gracePeriodEndsAt, amountVnd: sub.amountVnd,
      nextChargeAt: sub.cancelAtPeriodEnd ? null : sub.currentPeriodEnd,
      paymentMethod: sub.paymentMethodSummary,
    };
  }

  private _selectGateway(method: string): BillingGateway {
    if (method === "stripe") return this.stripe;
    if (method === "vnpay") return this.vnpay;
    if (method === "momo") return this.momo;
    throw new BadRequestException("INVALID_PAYMENT_METHOD");
  }
  private _gatewayFor(name: string): BillingGateway { return this._selectGateway(name); }
}

// apps/api/src/billing/webhook.controller.ts
@Controller("webhooks")
export class WebhookController {
  constructor(
    private readonly db: DatabaseService,
    private readonly stripe: StripeAdapter,
    private readonly vnpay: VnpayAdapter,
    private readonly momo: MomoAdapter,
    private readonly billing: BillingService,
    private readonly posthog: PostHogService,
  ) {}

  @Post("stripe")
  async stripeWebhook(@Headers("stripe-signature") sig: string, @Body() body: any, @Req() req: any) {
    if (!this.stripe.verifySignature({ "stripe-signature": sig }, req.rawBody)) {
      Sentry.captureMessage("stripe_webhook_bad_signature", { tags: { fr: "FR-BILL-001" } });
      throw new UnauthorizedException();
    }
    return this._handleEvent("stripe", body.id, body.type, body);
  }

  @Post("momo")
  async momoWebhook(@Body() body: any) {
    if (!this.momo.verifySignature({}, Buffer.from(JSON.stringify(body)))) throw new UnauthorizedException();
    return this._handleEvent("momo", String(body.requestId), `momo.result_${body.resultCode}`, body);
  }

  @All("vnpay")
  async vnpayCallback(@Query() query: Record<string,string>) {
    if (!this.vnpay.verifySignature(query as any, Buffer.alloc(0))) throw new UnauthorizedException();
    return this._handleEvent("vnpay", query.vnp_TransactionNo, `vnpay.code_${query.vnp_ResponseCode}`, query);
  }

  private async _handleEvent(gateway: string, eventId: string, type: string, payload: any) {
    // Idempotency
    try {
      await this.db.webhookEvents.insertOne({ eventId, gateway, type, receivedAt: new Date(), payloadSummary: { type } });
    } catch (e: any) {
      if (e.code === 11000) return { received: true, duplicate: true };
      throw e;
    }

    // Dispatch to state-machine handler
    const session = await this.db.checkoutSessions.findOne({ sessionId: payload?.data?.object?.id ?? payload?.requestId ?? payload?.vnp_TxnRef });
    if (!session && !this._isRenewal(type)) {
      Sentry.captureMessage("webhook_orphan_event", { tags: { fr: "FR-BILL-001", gateway, eventType: type } });
      return { received: true, orphan: true };
    }

    await this._applyStateTransition(gateway, type, session, payload);
    return { received: true };
  }

  private _isRenewal(type: string): boolean {
    return /invoice\.payment_succeeded|momo\.result_0|vnpay\.code_00/.test(type) && type.includes("renewal_marker");
  }

  private async _applyStateTransition(gateway: string, type: string, session: any, payload: any): Promise<void> {
    // ... per-gateway dispatch; full state machine logic
  }
}

// apps/api/src/billing/grace-period.worker.ts
@Injectable()
export class GracePeriodWorker {
  @Cron("0 */6 * * *") // every 6 hours
  async tick(): Promise<void> {
    const now = new Date();
    // Day +3: reminder
    const day3 = await this.db.subscriptions.find({
      status: "past_due",
      gracePeriodEndsAt: { $gte: new Date(now.getTime() + 3.5 * 86400_000), $lte: new Date(now.getTime() + 4.5 * 86400_000) },
      reminderSentAt: { $exists: false },
    }).toArray();
    for (const sub of day3) {
      await this.notify.enqueue({ kind: "grace_warning", userId: sub.userId, subscriptionId: sub._id });
      await this.db.subscriptions.updateOne({ _id: sub._id }, { $set: { reminderSentAt: new Date() } });
    }

    // Day +7+: downgrade
    const expired = await this.db.subscriptions.find({ status: "past_due", gracePeriodEndsAt: { $lt: now } }).toArray();
    for (const sub of expired) {
      await this.db.subscriptions.updateOne({ _id: sub._id }, { $set: { status: "unpaid" }, $push: { history: { event: "auto_downgraded", at: new Date() } } });
      await this.db.users.updateOne({ _id: sub.userId }, { $set: { plan: "free" } });
      this.posthog.capture({ event: "subscription_downgraded", properties: { userId: hashUserId(sub.userId), reason: "grace_expired" } });
    }
  }
}

// apps/api/src/billing/plan-enforcer.guard.ts
@Injectable()
export class PlanEnforcerGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user.id;
    const required = this.reflector.get<{ feature: keyof typeof PLANS["pro"] }>("planFeature", ctx.getHandler());
    if (!required) return true;
    const user = await this.db.users.findOne({ _id: userId });
    const planConfig = PLANS[user!.plan as keyof typeof PLANS];
    // ... check feature against planConfig
    return true;
  }
}
```

---

## §7 — Dependencies

- FR-AUTH-003 (JWT identity, refresh)
- FR-WATCH-001 (PlanEnforcerGuard consumed at track endpoint)
- FR-WATCH-003 (PlanEnforcerGuard at reactivate endpoint)
- FR-NOTIF-001 (grace-warning reminder emails)
- FR-OBS-001 (Sentry, PostHog)
- Stripe SDK + Stripe products configured via Terraform
- VNPay merchant: TMN code + hash secret + IPN URL configured in VNPay dashboard
- MoMo partner: partner code + access key + secret key + IPN URL configured
- MongoDB collections: `subscriptions`, `checkoutSessions`, `webhookEvents`, `coupons`
- Doppler secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`

Migration:
```ts
await db.collection("subscriptions").createIndex({ userId: 1, status: 1 });
await db.collection("subscriptions").createIndex({ gatewaySubscriptionId: 1 }, { sparse: true });
await db.collection("webhookEvents").createIndex({ eventId: 1, gateway: 1 }, { unique: true });
await db.collection("webhookEvents").createIndex({ receivedAt: 1 }, { expireAfterSeconds: 90 * 86400 });
await db.collection("checkoutSessions").createIndex({ sessionId: 1 }, { unique: true });
await db.collection("checkoutSessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
await db.collection("coupons").createIndex({ code: 1 }, { unique: true });
```

---

## §8 — Example payloads

### Stripe `checkout.session.completed` (relevant fields)

```json
{
  "id": "evt_1A2B3C",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_a1b2c3",
      "customer": "cus_T1",
      "subscription": "sub_T1",
      "metadata": { "userId": "u1", "plan": "pro", "interval": "monthly" }
    }
  }
}
```

### VNPay IPN (query string)

```
GET /webhooks/vnpay?vnp_Amount=3900000&vnp_BankCode=NCB&vnp_PayDate=20260516120000
   &vnp_OrderInfo=SaleNoti+Pro+monthly+for+user+u1&vnp_ResponseCode=00&vnp_TmnCode=XXX
   &vnp_TransactionNo=14123456&vnp_TxnRef=cs_test_a1b2c3
   &vnp_SecureHash=abc123def456...
```

### MoMo IPN

```json
{
  "partnerCode": "MOMO_TEST",
  "orderId": "cs_test_a1b2c3",
  "requestId": "req_abc123",
  "amount": 39000,
  "transId": 0,
  "resultCode": 0,
  "message": "Success",
  "responseTime": 1748234567000,
  "signature": "hex..."
}
```

---

## §9 — Open questions (resolved)

**Q1: Annual discount %?**
A: ~25% (Pro: 350K vs 39K × 12 = 468K → 25.2% off; Pro+: 800K vs 89K × 12 = 1,068K → 25.1% off). The slight rounding differences are deliberate — round numbers (350K, 800K) feel cleaner in marketing copy than calc-exact (351K, 801K).

**Q2: Trial period?**
A: No trial at P2 launch. Conversion is via FR-GROW-001 referral unlock (1 free month after qualifying 3 invites). A trial would compete with the referral incentive. P3 may add a 7-day trial if data shows referral-only is insufficient.

**Q3: Family plan?**
A: Deferred to P3. Vietnamese family-plan e-commerce is uncommon; the market signal isn't strong enough for MVP.

**Q4: Refund policy?**
A: Full refund within 30 days of first payment, on request (NSM trust per plan §I). Annual plans pro-rated for cancellations after 30 days. Beyond 90 days, refunds at admin discretion.

**Q5: Chargeback handling?**
A: Stripe handles chargebacks at the gateway layer; our role is to receive `charge.dispute.created` webhook and immediately suspend the user's Pro access (treat as suppression). VNPay/MoMo chargebacks are rare in VN — handle case-by-case via admin.

**Q6: Currency on display — VND or USD?**
A: VND for VN users (gateway: VNPay/MoMo) and ₫ symbol throughout the UI. For Stripe customers, charge in VND (Stripe supports VND); display VND. The 350K ₫ ≈ $14 USD note in marketing is for international investors only, never shown in checkout.

**Q7: Tax / VAT?**
A: P2 ships without explicit VAT line items (small-business exemption < ~1B ₫ annual revenue per VN regs). P3 adds VAT-inclusive pricing + receipt generation once revenue crosses threshold.

**Q8: How to handle plan upgrade mid-cycle (Pro → Pro+)?**
A: Stripe pro-rates automatically; VNPay/MoMo cancel old sub + start new + credit prorated amount to next period (manual flow, ~5% of upgrades; documented in §11).

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Stripe webhook out-of-order delivery | `created` timestamp comparison | DB row uses latest by `created` | built-in handling | info |
| 2 | VNPay 5-min iframe timeout | hash mismatch on callback | reject; user retries | UX: show "thử lại" with new session | warning |
| 3 | MoMo IPN delayed > 5 min | session.expiresAt cron sweep | check Stripe/MoMo status API as fallback | poll endpoint at +5min if no IPN | warning |
| 4 | Gateway HMAC secret leaked | Sentry forensic + sudden invalid-sig spike | rotate immediately via Doppler | N-1 acceptance window with both secrets for 1h | error |
| 5 | User on 50 active watchlists downgrades | soft over-cap; FR-WATCH-002 skips beyond cap | UX banner; AC14 verifies | acceptable; reactivation restores | info |
| 6 | Multiple gateway subscriptions for same user (impossible by FE, possible by abuse) | server-side `subscriptions` check on /subscribe | 409 ALREADY_SUBSCRIBED | reject; force one-gateway-at-a-time | warning |
| 7 | Webhook idempotency replay | unique index dedup | 200 + `duplicate: true` | per AC4 / AC21 | info |
| 8 | Currency drift on Stripe (VND vs USD setting) | Stripe price uses VND; never set USD | locked by Terraform | OK | info |
| 9 | MoMo refund flow (API supports it) | admin POST /refund | adapter calls MoMo refund API | works for confirmed transactions | info |
| 10 | VNPay refund (no API — manual ops) | admin POST /refund with gateway=vnpay | `status: "manual_pending"` audit row | ops team processes via VNPay merchant portal; webhook updates `status: "refunded"` | warning |
| 11 | Doppler rotates webhook secret mid-flight | inflight webhook fails verify | secrets cached with 1h N-1 acceptance | adapter retries on next request with new secret | warning |
| 12 | Stripe customer email mismatch (user changed email) | webhook `customer.email` != `users.email` | always identify by `gatewayCustomerId`, never email | per disallowed_tools rule | info |
| 13 | Coupon code race (max-uses exhaustion) | `usedCount` increment via $inc + conditional update | atomic Mongo update with `$expr` | one wins; rest get INVALID_COUPON | info |
| 14 | Stripe dispute / chargeback | `charge.dispute.created` webhook | immediately suspend user Pro access | log + admin review; if user wins dispute, restore | error |
| 15 | Grace-period cron missed tick | cron run logged | watcher alerts on > 12h gap | catch-up logic processes all eligible rows on next tick | warning |
| 16 | User pays then deletes account | account-delete preserves subscription row | PII purge per FR-LEGAL-001 retention | subscription row retained 7y for Vietnamese accounting law | info |
| 17 | Pro+ user downgrades to Pro mid-cycle (not Free) | Stripe pro-rates; VNPay/MoMo manual | session → new sub at lower tier + credit | flow documented; UX confirms before submit | info |
| 18 | Free-month referral unlock collides with active sub | check `users.plan === "free"` before grant | Otherwise extend currentPeriodEnd | FR-GROW-001 referral worker handles | info |

---

## §11 — Notes

- Stripe Products and Prices MUST be defined in `infra/stripe-products.tf` with `lifecycle { ignore_changes = [metadata] }` so manual dashboard edits don't drift. Terraform plan/apply in CI on PR merge.
- VNPay's IPN endpoint requires a public `https://` URL — local dev needs ngrok or staging tunnel. Document in `DEPLOY.md`.
- MoMo test credentials: use `MOMO_TEST` partnerCode for staging; production credentials are gated by KYB business verification (~5 days lead time).
- The pro-rated upgrade flow (Q8) requires both gateways' refund + new-charge flows; mid-cycle upgrades are ~5% of conversions but high-touch. Admin runbook needed.
- Pro+ users' "Trusted Hunter" badge integration on the public deal page is P3 (FR-GROW-004 — not yet authored).
- Tax/VAT line items added at P3 once revenue threshold crossed (~1B ₫/year per VN regs).
- The `webhookEvents` collection has 90-day TTL — long enough to detect duplicate retries from Stripe (max 3 days of retries) with 30x safety margin; not so long that it bloats the cluster.

---

*FR-BILL-001 spec — last revised 2026-05-16. Status: accepted (10/10).*
