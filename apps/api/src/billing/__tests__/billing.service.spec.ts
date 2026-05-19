import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingService } from "../billing.service";
import { BillingController } from "../billing.controller";
import { GracePeriodCron } from "../grace-period-cron";
import { WebhookController } from "../webhook.controller";
import crypto from "node:crypto";

const userId = "665000000000000000000001";
const state = vi.hoisted(() => ({
  usersFindOne: vi.fn(),
  usersUpdateOne: vi.fn(),
  subscriptionsFindOne: vi.fn(),
  subscriptionsFindOneAndUpdate: vi.fn(),
  subscriptionsUpdateOne: vi.fn(),
  subscriptionsFind: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "users") return { findOne: state.usersFindOne, updateOne: state.usersUpdateOne };
        if (name === "subscriptions") {
          return {
            findOne: state.subscriptionsFindOne,
            findOneAndUpdate: state.subscriptionsFindOneAndUpdate,
            updateOne: state.subscriptionsUpdateOne,
            find: state.subscriptionsFind,
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

vi.mock("../../queue/redis.client", () => ({
  redis: { set: (...args: any[]) => state.redisSet(...args) },
}));

describe("FR-BILL-001 — billing subscribe", () => {
  const posthog = { capture: vi.fn() };
  const sentry = { captureException: vi.fn() };
  const cfg = {
    get: vi.fn((key: string) => {
      if (key === "APP_URL") return "https://salenoti.vn";
      if (key === "API_URL") return "https://api.salenoti.vn";
      return process.env[key];
    }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.VNPAY_HASH_SECRET;
    delete process.env.VNPAY_TMN_CODE;
    delete process.env.MOMO_ACCESS_KEY;
    delete process.env.MOMO_PARTNER_CODE;
    delete process.env.MOMO_SECRET_KEY;
    delete process.env.MONGODB_URI;
    vi.unstubAllGlobals();
    state.usersFindOne.mockResolvedValue({ _id: userId, email: "buyer@example.com" });
    state.usersUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    state.subscriptionsFindOne.mockResolvedValue(null);
    state.subscriptionsFindOneAndUpdate.mockResolvedValue({ value: null });
    state.subscriptionsUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    state.subscriptionsFind.mockReturnValue({ toArray: vi.fn(async () => []) });
    state.redisSet.mockResolvedValue("OK");
    posthog.capture.mockClear();
    sentry.captureException.mockClear();
  });

  it("returns a deterministic dev checkout URL when Stripe credentials are absent", async () => {
    const service = new BillingService(cfg, posthog, sentry);

    await expect(
      service.subscribe({ userId, plan: "pro", interval: "monthly", paymentMethod: "stripe" })
    ).resolves.toEqual({
      provider: "stripe",
      redirectUrl: "https://salenoti.vn/billing/upgrade?dev_stub=stripe&plan=pro",
    });
  });

  it("validates user/subscription state and returns gateway redirects for all rails", async () => {
    const service = new BillingService(cfg, posthog, sentry);

    await expect(service.subscribe({ userId, plan: "free" as any, interval: "monthly", paymentMethod: "stripe" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "invalid_plan" }),
    });

    state.usersFindOne.mockResolvedValueOnce(null);
    await expect(service.subscribe({ userId, plan: "pro", interval: "monthly", paymentMethod: "stripe" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "user_not_found" }),
    });

    state.subscriptionsFindOne.mockResolvedValueOnce({ _id: "sub-1" });
    await expect(service.subscribe({ userId, plan: "pro", interval: "monthly", paymentMethod: "stripe" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "already_subscribed" }),
    });

    await expect(service.subscribe({ userId, plan: "pro", interval: "yearly", paymentMethod: "vnpay" })).resolves.toEqual({
      provider: "vnpay",
      redirectUrl: "https://salenoti.vn/billing/upgrade?dev_stub=vnpay&plan=pro",
    });
    await expect(service.subscribe({ userId, plan: "pro_plus", interval: "monthly", paymentMethod: "momo" })).resolves.toEqual({
      provider: "momo",
      redirectUrl: "https://salenoti.vn/billing/upgrade?dev_stub=momo&plan=pro_plus",
    });
  });

  it("creates live Stripe, VNPay, and MoMo checkout URLs using hosted-provider redirects", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.VNPAY_TMN_CODE = "SALE";
    process.env.VNPAY_HASH_SECRET = "vnpay-secret";
    process.env.MOMO_PARTNER_CODE = "MOMO";
    process.env.MOMO_ACCESS_KEY = "access";
    process.env.MOMO_SECRET_KEY = "momo-secret";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.test/session", payUrl: "https://momo.test/pay" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new BillingService(cfg, posthog, sentry);

    const stripe = await service.subscribe({ userId, plan: "pro_plus", interval: "yearly", paymentMethod: "stripe" });

    expect(stripe.redirectUrl).toBe("https://checkout.stripe.test/session");
    const requestInit = (fetchMock.mock.calls[0] as any[])[1];
    const body = String(requestInit.body);
    expect(body).toContain("metadata%5BuserId%5D=665000000000000000000001");
    expect(body).toContain("metadata%5Bplan%5D=pro_plus");
    expect(body).toContain("recurring%5D%5Binterval%5D=year");

    const vnpay = await service.subscribe({ userId, plan: "pro", interval: "monthly", paymentMethod: "vnpay" });
    expect(vnpay.redirectUrl).toContain("https://pay.vnpay.vn/vpcpay.html?");
    expect(vnpay.redirectUrl).toContain("vnp_TmnCode=SALE");
    expect(vnpay.redirectUrl).toContain("vnp_SecureHash=");

    const momo = await service.subscribe({ userId, plan: "pro", interval: "monthly", paymentMethod: "momo" });
    expect(momo.redirectUrl).toBe("https://momo.test/pay");
    expect(JSON.parse(String((fetchMock.mock.calls[1] as any[])[1].body))).toMatchObject({
      partnerCode: "MOMO",
      requestType: "captureWallet",
      lang: "vi",
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("cancels at period end and advances webhook/grace-period state idempotently", async () => {
    const service = new BillingService(cfg, posthog, sentry);
    const periodEnd = new Date("2026-06-18T00:00:00.000Z");

    state.subscriptionsFindOne.mockResolvedValueOnce(null);
    await expect(service.cancel(userId)).resolves.toBeNull();

    state.subscriptionsFindOne.mockResolvedValueOnce({
      _id: "sub-1",
      plan: "pro",
      gateway: "stripe",
      currentPeriodEnd: periodEnd,
    });
    await expect(service.cancel(userId)).resolves.toEqual({ cancelAt: periodEnd });
    expect(state.subscriptionsUpdateOne).toHaveBeenCalledWith(
      { _id: "sub-1" },
      { $set: { cancelAtPeriodEnd: true, updatedAt: expect.any(Date) } },
    );

    await service.applyPaymentSucceeded({
      eventId: "evt_1",
      gateway: "stripe",
      userId,
      plan: "pro",
      gatewayCustomerId: "cus_1",
      gatewaySubscriptionId: "sub_ext",
      currentPeriodStart: new Date("2026-05-18T00:00:00.000Z"),
      currentPeriodEnd: periodEnd,
    });
    expect(state.subscriptionsFindOneAndUpdate).toHaveBeenCalledWith(
      { userId: expect.any(Object), gateway: "stripe", gatewaySubscriptionId: "sub_ext" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "active", plan: "pro" }) }),
      { upsert: true },
    );
    expect(state.usersUpdateOne).toHaveBeenCalledWith(expect.any(Object), { $set: { plan: "pro" } });

    state.redisSet.mockResolvedValueOnce(null);
    state.subscriptionsFindOneAndUpdate.mockClear();
    await service.applyPaymentSucceeded({
      eventId: "evt_1",
      gateway: "stripe",
      userId,
      plan: "pro",
      gatewayCustomerId: "cus_1",
      gatewaySubscriptionId: "sub_ext",
      currentPeriodStart: new Date("2026-05-18T00:00:00.000Z"),
      currentPeriodEnd: periodEnd,
    });
    expect(state.subscriptionsFindOneAndUpdate).not.toHaveBeenCalled();

    state.subscriptionsFindOne.mockResolvedValueOnce({ _id: "sub-1", plan: "pro", gateway: "stripe" });
    await service.applyPaymentFailed({ userId, gateway: "stripe" });
    expect(state.subscriptionsUpdateOne).toHaveBeenCalledWith(
      { _id: "sub-1" },
      { $set: expect.objectContaining({ status: "past_due", graceExpiresAt: expect.any(Date) }) },
    );

    state.subscriptionsFind
      .mockReturnValueOnce({ toArray: vi.fn(async () => [{ _id: "warn-1", plan: "pro", gateway: "stripe" }]) })
      .mockReturnValueOnce({ toArray: vi.fn(async () => [{ _id: "due-1", userId: "u1", plan: "pro", gateway: "momo" }]) });
    await service.tickGracePeriod();
    expect(state.subscriptionsUpdateOne).toHaveBeenCalledWith({ _id: "warn-1" }, { $set: { graceWarnedAt: expect.any(Date) } });
    expect(state.usersUpdateOne).toHaveBeenCalledWith({ _id: "u1" }, { $set: { plan: "free" } });
    expect(posthog.capture).toHaveBeenCalledWith("subscription_downgraded", expect.objectContaining({ reason: "grace_expired" }));
  });

  it("verifies signed gateway webhooks before mutating billing state", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "stripe-secret";
    process.env.VNPAY_HASH_SECRET = "vnpay-secret";
    process.env.MOMO_SECRET_KEY = "momo-secret";
    const billing = {
      applyPaymentSucceeded: vi.fn(async () => undefined),
      applyPaymentFailed: vi.fn(async () => undefined),
    };
    const controller = new WebhookController(billing as any);

    const stripeBody = JSON.stringify({
      id: "evt_stripe",
      type: "checkout.session.completed",
      data: { object: { metadata: { userId, plan: "pro" }, customer: "cus", subscription: "sub" } },
    });
    const t = "1760000000";
    const v1 = crypto.createHmac("sha256", "stripe-secret").update(`${t}.${stripeBody}`).digest("hex");
    await expect(controller.stripe({ rawBody: Buffer.from(stripeBody) } as any, `t=${t},v1=${v1}`)).resolves.toEqual({ ok: true });
    expect(billing.applyPaymentSucceeded).toHaveBeenCalledWith(expect.objectContaining({ gateway: "stripe", eventId: "evt_stripe" }));
    await expect(controller.stripe({ rawBody: Buffer.from(stripeBody) } as any, `t=${t},v1=${"0".repeat(64)}`)).rejects.toMatchObject({ status: 401 });

    const vnpayBody = {
      vnp_TxnRef: `${userId}|pro|monthly|1`,
      vnp_TransactionNo: "vnp-1",
      vnp_TransactionStatus: "00",
    } as any;
    const vnpSign = Object.keys(vnpayBody)
      .sort()
      .map((k) => `${k}=${vnpayBody[k]}`)
      .join("&");
    await expect(
      controller.vnpay({ ...vnpayBody, vnp_SecureHash: crypto.createHmac("sha512", "vnpay-secret").update(vnpSign).digest("hex") }, {}),
    ).resolves.toEqual({ RspCode: "00", Message: "ok" });

    const momoBody = {
      accessKey: "access",
      amount: "39000",
      extraData: Buffer.from(JSON.stringify({ userId, plan: "pro" })).toString("base64"),
      message: "ok",
      orderId: "order",
      orderInfo: "SaleNoti",
      orderType: "momo_wallet",
      partnerCode: "MOMO",
      payType: "web",
      requestId: "req",
      responseTime: "1",
      resultCode: 0,
      transId: "momo-1",
    } as any;
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
    const momoSign = fields.map((k) => `${k}=${momoBody[k] ?? ""}`).join("&");
    await expect(
      controller.momo({ ...momoBody, signature: crypto.createHmac("sha256", "momo-secret").update(momoSign).digest("hex") }),
    ).resolves.toMatchObject({ resultCode: 0 });
    await expect(controller.momo({ ...momoBody, signature: "0".repeat(64) })).rejects.toMatchObject({ status: 401 });
  });

  it("maps billing controller auth, validation, subscription, cancel, and /me responses", async () => {
    const billing = {
      subscribe: vi.fn(async () => ({ provider: "stripe", redirectUrl: "https://checkout.test" })),
      cancel: vi.fn(async () => null as null | { cancelAt: Date }),
    };
    const controller = new BillingController(billing as any);

    await expect(controller.subscribe({ plan: "pro", interval: "monthly", paymentMethod: "stripe" }, undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.subscribe({ plan: "free", interval: "monthly", paymentMethod: "stripe" }, userId)).rejects.toMatchObject({ status: 400 });
    await expect(controller.subscribe({ plan: "pro", interval: "monthly", paymentMethod: "stripe" }, userId)).resolves.toEqual({
      provider: "stripe",
      redirectUrl: "https://checkout.test",
    });

    await expect(controller.cancel(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.cancel(userId)).rejects.toMatchObject({ status: 404 });
    const cancelAt = new Date("2026-06-18T00:00:00.000Z");
    billing.cancel.mockResolvedValueOnce({ cancelAt });
    await expect(controller.cancel(userId)).resolves.toEqual({ ok: true, cancelAt });

    await expect(controller.me(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.me("not-object-id")).rejects.toMatchObject({ status: 400 });
    state.subscriptionsFindOne.mockResolvedValueOnce({
      plan: "pro",
      status: "past_due",
      gateway: "momo",
      currentPeriodStart: new Date("2026-05-18T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-06-18T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
      graceExpiresAt: new Date("2026-05-25T00:00:00.000Z"),
    });
    state.usersFindOne.mockResolvedValueOnce({ _id: userId, plan: "pro" });
    await expect(controller.me(userId)).resolves.toMatchObject({
      ok: true,
      plan: "pro",
      subscription: { plan: "pro", status: "past_due", gateway: "momo", cancelAtPeriodEnd: true },
    });
  });

  it("runs the grace-period cron only when MongoDB is configured and logs failures", async () => {
    const billing = { tickGracePeriod: vi.fn(async () => undefined) };
    const cron = new GracePeriodCron(billing as any);

    await cron.tick();
    expect(billing.tickGracePeriod).not.toHaveBeenCalled();

    process.env.MONGODB_URI = "mongodb://localhost/salenoti";
    await cron.tick();
    expect(billing.tickGracePeriod).toHaveBeenCalledTimes(1);

    billing.tickGracePeriod.mockRejectedValueOnce(new Error("boom"));
    await expect(cron.tick()).resolves.toBeUndefined();
  });
});
