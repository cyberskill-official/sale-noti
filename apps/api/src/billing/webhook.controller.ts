// FR-BILL-001 §1 #5 + #6 — gateway webhook handlers with HMAC verification.
import crypto from "node:crypto";
import { Body, Controller, Headers, HttpException, HttpStatus, Post, Query, Req } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { isValidPlan } from "./plan";
import type { Request } from "express";

@Controller("webhooks")
export class WebhookController {
  constructor(private readonly billing: BillingService) {}

  // ───────────────── Stripe ─────────────────
  @Post("stripe")
  async stripe(@Req() req: Request, @Headers("stripe-signature") signature: string | undefined) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new HttpException("webhook secret missing", HttpStatus.SERVICE_UNAVAILABLE);
    if (!signature) throw new HttpException("missing signature", HttpStatus.UNAUTHORIZED);
    const raw = (req as any).rawBody?.toString() ?? JSON.stringify((req as any).body);
    // Stripe's signature is `t=<timestamp>,v1=<hmac>`. Verify manually to avoid the full stripe-node dep.
    const parts = Object.fromEntries(signature.split(",").map((s) => s.split("="))) as Record<string, string>;
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) throw new HttpException("malformed signature", HttpStatus.UNAUTHORIZED);
    const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
      throw new HttpException("invalid signature", HttpStatus.UNAUTHORIZED);
    }
    const body = JSON.parse(raw);
    await this.handleStripe(body);
    return { ok: true };
  }

  private async handleStripe(body: any) {
    const type = body?.type as string;
    const obj = body?.data?.object ?? {};
    const userId = obj?.metadata?.userId;
    const plan = obj?.metadata?.plan;
    if (!userId || !plan) return;

    switch (type) {
      case "invoice.payment_succeeded":
      case "checkout.session.completed":
        if (!isValidPlan(plan)) return;
        await this.billing.applyPaymentSucceeded({
          eventId: body.id,
          gateway: "stripe",
          userId,
          plan,
          gatewayCustomerId: obj.customer ?? "",
          gatewaySubscriptionId: obj.subscription ?? null,
          currentPeriodStart: new Date(((obj.current_period_start ?? Math.floor(Date.now() / 1000)) as number) * 1000),
          currentPeriodEnd: new Date(((obj.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86400) as number) * 1000),
        });
        break;
      case "invoice.payment_failed":
        await this.billing.applyPaymentFailed({ userId, gateway: "stripe" });
        break;
    }
  }

  // ───────────────── VNPay ─────────────────
  @Post("vnpay")
  async vnpay(@Body() body: any, @Query() query: any) {
    const secret = process.env.VNPAY_HASH_SECRET;
    if (!secret) throw new HttpException("webhook secret missing", HttpStatus.SERVICE_UNAVAILABLE);
    const merged = { ...query, ...body };
    const receivedHash = merged.vnp_SecureHash as string | undefined;
    if (!receivedHash) throw new HttpException("missing hash", HttpStatus.UNAUTHORIZED);
    const { vnp_SecureHash, vnp_SecureHashType, ...rest } = merged;
    const signString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k]}`)
      .join("&");
    const expected = crypto.createHmac("sha512", secret).update(signString).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expected))) {
      throw new HttpException("invalid hash", HttpStatus.UNAUTHORIZED);
    }
    const status = merged.vnp_TransactionStatus;
    if (status === "00") {
      const txn = merged.vnp_TxnRef as string; // we set userId|plan|interval at checkout
      const [userId, plan] = txn.split("|");
      if (userId && plan && isValidPlan(plan)) {
        await this.billing.applyPaymentSucceeded({
          eventId: merged.vnp_TransactionNo,
          gateway: "vnpay",
          userId,
          plan,
          gatewayCustomerId: userId,
          gatewaySubscriptionId: null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        });
      }
    }
    return { RspCode: "00", Message: "ok" };
  }

  // ───────────────── MoMo ─────────────────
  @Post("momo")
  async momo(@Body() body: any) {
    const secret = process.env.MOMO_SECRET_KEY;
    if (!secret) throw new HttpException("webhook secret missing", HttpStatus.SERVICE_UNAVAILABLE);
    const fields = [
      "accessKey",
      "amount",
      "extraData",
      "message",
      "orderId",
      "orderInfo",
      "orderType",
      "partnerCode",
      "payType",
      "requestId",
      "responseTime",
      "resultCode",
      "transId",
    ];
    const rawSign = fields.map((k) => `${k}=${body[k] ?? ""}`).join("&");
    const expected = crypto.createHmac("sha256", secret).update(rawSign).digest("hex");
    if (!body.signature || !crypto.timingSafeEqual(Buffer.from(body.signature), Buffer.from(expected))) {
      throw new HttpException("invalid signature", HttpStatus.UNAUTHORIZED);
    }
    if (body.resultCode === 0) {
      const extra = (() => {
        try {
          return JSON.parse(Buffer.from(body.extraData ?? "", "base64").toString());
        } catch {
          return {};
        }
      })();
      if (extra.userId && isValidPlan(extra.plan)) {
        await this.billing.applyPaymentSucceeded({
          eventId: String(body.transId),
          gateway: "momo",
          userId: extra.userId,
          plan: extra.plan,
          gatewayCustomerId: extra.userId,
          gatewaySubscriptionId: null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        });
      }
    }
    return { partnerCode: body.partnerCode, requestId: body.requestId, resultCode: 0, message: "ok" };
  }
}
