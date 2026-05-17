// FR-BILL-001 — billing orchestration: subscribe, webhook state transitions, cancel, downgrade.
import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import crypto from "node:crypto";
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

  private async startStripeCheckout(input: SubscribeInput, user: any, amountVnd: number): Promise<string> {
    const key = this.cfg.get<string>("STRIPE_SECRET_KEY");
    if (!key) return `${this.appUrl()}/billing/upgrade?dev_stub=stripe&plan=${input.plan}`;
    const params = new URLSearchParams({
      mode: "subscription",
      success_url: `${this.appUrl()}/billing/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.appUrl()}/billing/upgrade?cancelled=1`,
      client_reference_id: input.userId,
      customer_email: user.email ?? "",
      "metadata[userId]": input.userId,
      "metadata[plan]": input.plan,
      "metadata[interval]": input.interval,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "vnd",
      "line_items[0][price_data][unit_amount]": String(amountVnd),
      "line_items[0][price_data][product_data][name]": input.plan === "pro" ? "SaleNoti Pro" : "SaleNoti Pro+",
      "line_items[0][price_data][recurring][interval]": input.interval === "monthly" ? "month" : "year",
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const body = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) throw new BadRequestException({ error: "stripe_checkout_failed", message: body.error?.message });
    return body.url;
  }

  private async startVnpayCheckout(input: SubscribeInput, user: any, amountVnd: number): Promise<string> {
    const tmnCode = this.cfg.get<string>("VNPAY_TMN_CODE");
    const secret = this.cfg.get<string>("VNPAY_HASH_SECRET");
    if (!tmnCode || !secret) return `${this.appUrl()}/billing/upgrade?dev_stub=vnpay&plan=${input.plan}`;
    const now = new Date();
    const txnRef = `${input.userId}|${input.plan}|${input.interval}|${now.getTime()}`;
    const params: Record<string, string> = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: tmnCode,
      vnp_Amount: String(amountVnd * 100),
      vnp_CurrCode: "VND",
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: `SaleNoti ${input.plan} ${input.interval}`,
      vnp_OrderType: "billpayment",
      vnp_Locale: "vn",
      vnp_ReturnUrl: `${this.appUrl()}/billing/success?provider=vnpay`,
      vnp_IpAddr: user.lastIp ?? "127.0.0.1",
      vnp_CreateDate: formatVnpDate(now),
    };
    const query = signedQuery(params, secret, "sha512");
    return `https://pay.vnpay.vn/vpcpay.html?${query}`;
  }

  private async startMomoCheckout(input: SubscribeInput, user: any, amountVnd: number): Promise<string> {
    const partnerCode = this.cfg.get<string>("MOMO_PARTNER_CODE");
    const accessKey = this.cfg.get<string>("MOMO_ACCESS_KEY");
    const secretKey = this.cfg.get<string>("MOMO_SECRET_KEY");
    if (!partnerCode || !accessKey || !secretKey) return `${this.appUrl()}/billing/upgrade?dev_stub=momo&plan=${input.plan}`;

    const requestId = `${input.userId}-${Date.now()}`;
    const orderId = requestId;
    const extraData = Buffer.from(JSON.stringify({ userId: input.userId, plan: input.plan, interval: input.interval })).toString("base64");
    const notifyUrl = `${this.cfg.get<string>("API_URL") ?? "https://api.salenoti.vn"}/webhooks/momo`;
    const redirectUrl = `${this.appUrl()}/billing/success?provider=momo`;
    const raw: Record<string, string> = {
      accessKey,
      amount: String(amountVnd),
      extraData,
      ipnUrl: notifyUrl,
      orderId,
      orderInfo: `SaleNoti ${input.plan} ${input.interval}`,
      partnerCode,
      redirectUrl,
      requestId,
      requestType: "captureWallet",
    };
    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(
        [
          "accessKey",
          "amount",
          "extraData",
          "ipnUrl",
          "orderId",
          "orderInfo",
          "partnerCode",
          "redirectUrl",
          "requestId",
          "requestType",
        ]
          .map((k) => `${k}=${raw[k]}`)
          .join("&")
      )
      .digest("hex");
    const res = await fetch("https://test-payment.momo.vn/v2/gateway/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...raw, lang: "vi", signature }),
    });
    const body = (await res.json()) as { payUrl?: string; message?: string };
    if (!res.ok || !body.payUrl) throw new BadRequestException({ error: "momo_checkout_failed", message: body.message });
    return body.payUrl;
  }

  private appUrl() {
    return this.cfg.get<string>("APP_URL") ?? "http://localhost:3000";
  }
}

function signedQuery(params: Record<string, string>, secret: string, algorithm: "sha512"): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? "")}`)
    .join("&");
  const secureHash = crypto.createHmac(algorithm, secret).update(sorted).digest("hex");
  return `${sorted}&vnp_SecureHash=${secureHash}`;
}

function formatVnpDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
