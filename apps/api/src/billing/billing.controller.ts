// FR-BILL-001 §3 — POST /v1/billing/subscribe + /v1/billing/cancel + /v1/billing/me.
import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { BillingService } from "./billing.service";
import { mongo } from "../db/mongo";
import { ObjectId } from "mongodb";

const SubscribeBody = z.object({
  plan: z.enum(["pro", "pro_plus"]),
  interval: z.enum(["monthly", "yearly"]),
  paymentMethod: z.enum(["stripe", "vnpay", "momo"]),
});

@Controller("v1/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post("subscribe")
  async subscribe(@Body() raw: unknown, @Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = SubscribeBody.safeParse(raw);
    if (!parsed.success)
      throw new HttpException(
        { ok: false, error: "validation_failed", issues: parsed.error.issues },
        HttpStatus.BAD_REQUEST
      );
    return this.billing.subscribe({ userId, ...parsed.data });
  }

  @Post("cancel")
  async cancel(@Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const r = await this.billing.cancel(userId);
    if (!r) throw new HttpException({ ok: false, error: "no_active_subscription" }, HttpStatus.NOT_FOUND);
    return { ok: true, cancelAt: r.cancelAt };
  }

  @Get("me")
  async me(@Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    let userOid: ObjectId;
    try {
      userOid = new ObjectId(userId);
    } catch {
      throw new HttpException({ ok: false, error: "invalid_user_id" }, HttpStatus.BAD_REQUEST);
    }
    const sub = await mongo
      .db("salenoti")
      .collection("subscriptions")
      .findOne({ userId: userOid, status: { $in: ["active", "trialing", "past_due"] } });
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
    return {
      ok: true,
      plan: user?.plan ?? "free",
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            gateway: sub.gateway,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
            graceExpiresAt: sub.graceExpiresAt ?? null,
          }
        : null,
    };
  }
}
