// FR-BILL-001 — billing orchestration: subscribe, webhook state transitions, cancel, downgrade.
import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { redis } from "../queue/redis.client";
import { isValidPlan, type Interval, type Plan, PLAN_PRICE_VND } from "./plan";

export type SubscribeInput = {
  userId: string;
  plan: "pro" | "pro_plus";
  interval: Interval;
  paymentMethod: "stripe" | "vnpay" | "momo";
};

export type SubscribeResult = { redirectUrl: string; provider: "stripe" | "vnpay" | "momo" };

const GRACE_DAYS = 7;
const GRACE_WARN_DAYS = 3;

@Injectable()
export class BillingService {
  constructor(
    private readonly cfg: ConfigService,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {}

  /** FR-BILL-001 §3 — initiate subscription; returns gateway redirect URL. */
  async subscribe(input: SubscribeInput): Promise<SubscribeResult> {
    if (!isValidPlan(input.plan)) throw new BadRequestException({ error: "invalid_plan" });
    const userOid = new ObjectId(input.userId);
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
    if (!user) throw new NotFoundException({ error: "user_not_found" });

    // Reject double-subscribe.
    const existing = await mongo.db("salenoti").collection("subscriptions").findOne({
      userId: userOid,
      status: { $in: ["active", "trialing", "past_due"] },
    });
    if (existing) throw new BadRequestException({ error: "already_subscribed" });

    const amountVnd = PLAN_PRICE_VND[input.plan][input.interval];

    switch (input.paymentMethod) {
      case "stripe":
        return { provider: "stripe", redirectUrl: await this.startStripeCheckout(input, user, amountVnd) };
      case "vnpay":
        return { provider: "vnpay", redirectUrl: await this.startVnpayCheckout(input, user, amountVnd) };
      case "momo":
        return { provider: "momo", redirectUrl: await this.startMomoCheckout(input, user, amountVnd) };
    }
  }

  /** FR-BILL-001 §1 #8 — cancel at period end. */
  async cancel(userId: string): Promise<{ cancelAt: Date } | null> {
    const userOid = new ObjectId(userId);
    const sub = await mongo.db("salenoti").collection("subscriptions").findOne({
      userId: userOid,
      status: { $in: ["active", "trialing"] },
    });
    if (!sub) return null;
    await mongo.db("salenoti").collection("subscriptions").updateOne(
      { _id: sub._id },
      { $set: { cancelAtPeriodEnd: true, updatedAt: new Date() } }
    );
    this.posthog.capture("subscription_cancelled", { plan: sub.plan, gateway: sub.gateway });
    return { cancelAt: sub.currentPeriodEnd };
  }

  /** FR-BILL-001 §1 #6 — apply tier change ONLY on webhook-confirmed payment_succeeded. Idempotent via Redis dedup. */
  async applyPaymentSucceeded(input: {
    eventId: string;
    gateway: "stripe" | "vnpay" | "momo";
    userId: string;
    plan: Plan;
    gatewayCustomerId: string;
    gatewaySubscriptionId: string | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  }): Promise<void> {
    const dedupKey = `billing:event:${input.gateway}:${input.eventId}`;
    const seen = await redis.set(dedupKey, "1", "EX", 7 * 86_400, "NX");
    if (seen !== "OK") return; // already processed

    const userOid = new ObjectId(input.userId);
    await mongo.db("salenoti").collection("subscriptions").findOneAndUpdate(
      { userId: userOid, gateway: input.gateway, gatewaySubscriptionId: input.gatewaySubscriptionId },
      {
        $setOnInsert: { userId: userOid, gateway: input.gateway, gatewayCustomerId: input.gatewayCustomerId, createdAt: new Date() },
        $set: {
          gatewaySubscriptionId: input.gatewaySubscriptionId,
          plan: input.plan,
          status: "active",
          currentPeriodStart: input.currentPeriodStart,
          currentPeriodEnd: input.currentPeriodEnd,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Denormalized cache in users.plan.
    await mongo.db("salenoti").collection("users").updateOne({ _id: userOid }, { $set: { plan: input.plan } });

    this.posthog.capture("subscription_started", { plan: input.plan, gateway: input.gateway });
  }

  /** FR-BILL-001 §1 #7 — grace period state. Called by webhook on payment_failed. */
  async applyPaymentFailed(input: { userId: string; gateway: "stripe" | "vnpay" | "momo" }): Promise<void> {
    const userOid = new ObjectId(input.userId);
    const sub = await mongo.db("salenoti").collection("subscriptions").findOne({
      userId: userOid,
      gateway: input.gateway,
      status: "active",
    });
    if (!sub) return;
    await mongo.db("salenoti").collection("subscriptions").updateOne(
      { _id: sub._id },
      { $set: { status: "past_due", graceExpiresAt: new Date(Date.now() + GRACE_DAYS * 86_400_000), updatedAt: new Date() } }
    );
    this.posthog.capture("subscription_payment_failed", { plan: sub.plan, gateway: input.gateway });
  }

  /** Cron-friendly: run hourly to enforce grace period transitions. */
  async tickGracePeriod(): Promise<void> {
    const now = new Date();
    const cutoffWarn = new Date(now.getTime() - GRACE_WARN_DAYS * 86_400_000);

    // Send warning at day 3 (grace started ≥ GRACE_DAYS - GRACE_WARN_DAYS ago).
    const warnTargets = await mongo
      .db("salenoti")
      .collection("subscriptions")
      .find({
        status: "past_due",
        graceWarnedAt: { $exists: false },
        graceExpiresAt: { $lt: new Date(now.getTime() + GRACE_WARN_DAYS * 86_400_000) },
      })
      .toArray();
    for (const s of warnTargets) {
      this.posthog.capture("subscription_grace_warning", { plan: s.plan, gateway: s.gateway });
      await mongo.db("salenoti").collection("subscriptions").updateOne({ _id: s._id }, { $set: { graceWarnedAt: now } });
      // TODO: enqueue email via alert-dispatch queue with a dedicated `kind: "grace_warning"`.
    }

    // Auto-downgrade past graceExpiresAt.
    const downgradeTargets = await mongo
      .db("salenoti")
      .collection("subscriptions")
      .find({ status: "past_due", graceExpiresAt: { $lt: now } })
      .toArray();
    for (const s of downgradeTargets) {
      await mongo.db("salenoti").collection("subscriptions").updateOne(
        { _id: s._id },
        { $set: { status: "cancelled", cancelledAt: now, downgradeReason: "grace_expired", updatedAt: now } }
      );
      await mongo.db("salenoti").collection("users").updateOne({ _id: s.userId }, { $set: { plan: "free" } });
      this.posthog.capture("subscription_downgraded", { plan: s.plan, gateway: s.gateway, reason: "grace_expired" });
    }
  }

  // ─── Provider-specific checkouts (stubbed; production code lands per FR-BILL-001 §6) ─────────
  private async startStripeCheckout(input: SubscribeInput, user: any, amountVnd: number): Promise<string> {
    const key = this.cfg.get<string>("STRIPE_SECRET_KEY");
    if (!key) return `${this.appUrl()}/billing/upgrade?dev_stub=stripe&plan=${input.plan}`;
    // Real impl: stripe.checkout.sessions.create({...}) — defer to a follow-up commit.
    return `${this.appUrl()}/billing/upgrade?dev_stub=stripe&plan=${input.plan}&amount=${amountVnd}`;
  }

  private async startVnpayCheckout(input: SubscribeInput, user: any, amountVnd: number): Promise<string> {
    return `${this.appUrl()}/billing/upgrade?dev_stub=vnpay&plan=${input.plan}&amount=${amountVnd}`;
  }

  private async startMomoCheckout(input: SubscribeInput, user: any, amountVnd: number): Promise<string> {
    return `${this.appUrl()}/billing/upgrade?dev_stub=momo&plan=${input.plan}&amount=${amountVnd}`;
  }

  private appUrl() {
    return this.cfg.get<string>("APP_URL") ?? "http://localhost:3000";
  }
}
