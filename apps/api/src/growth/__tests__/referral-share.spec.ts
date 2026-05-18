import { BadRequestException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralService } from "../referral.service";
import { ShareService } from "../share.service";
import { ShareController } from "../share.controller";
import { ReferralController } from "../referral.controller";

const referrerId = "665000000000000000000031";
const referredId = "665000000000000000000032";

const state = vi.hoisted(() => ({
  users: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
  referrals: {
    countDocuments: vi.fn(),
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
  },
  referralRewards: {
    countDocuments: vi.fn(),
    insertOne: vi.fn(),
  },
  subscriptions: {
    updateOne: vi.fn(),
  },
  watchlists: {
    countDocuments: vi.fn(),
  },
  products: {
    findOne: vi.fn(),
  },
  shares: {
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
  usersWithoutCodes: [] as any[],
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "users") {
          return {
            findOne: state.users.findOne,
            updateOne: state.users.updateOne,
            find: vi.fn(() => ({ toArray: vi.fn(async () => state.usersWithoutCodes) })),
          };
        }
        if (name === "referrals") return state.referrals;
        if (name === "referral_rewards") return state.referralRewards;
        if (name === "subscriptions") return state.subscriptions;
        if (name === "watchlists") return state.watchlists;
        if (name === "products") return state.products;
        if (name === "shares") return state.shares;
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

describe("FR-GROW-001 — referral service contract", () => {
  const posthog = { capture: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REFERRAL_SALT = "ref-salt";
    process.env.APP_URL = "https://salenoti.vn";
    state.usersWithoutCodes = [];
    state.users.findOne.mockResolvedValue(null);
    state.users.updateOne.mockResolvedValue({ modifiedCount: 1 });
    state.referrals.countDocuments.mockResolvedValue(0);
    state.referrals.findOne.mockResolvedValue(null);
    state.referrals.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    state.referrals.updateOne.mockResolvedValue({ modifiedCount: 1 });
    state.referralRewards.countDocuments.mockResolvedValue(0);
    state.referralRewards.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    state.subscriptions.updateOne.mockResolvedValue({ modifiedCount: 1 });
    state.watchlists.countDocuments.mockResolvedValue(3);
    posthog.capture.mockClear();
  });

  it("returns deterministic referral status and link", async () => {
    state.referrals.countDocuments.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    state.referralRewards.countDocuments.mockResolvedValueOnce(1);
    const service = new ReferralService(posthog);

    const status = await service.getStatus(referrerId);

    expect(status.refCode).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(status.refLink).toBe(`https://salenoti.vn/r/${status.refCode}`);
    expect(status).toMatchObject({ invited: 5, qualified: 3, rewardsEarnedMonths: 1 });
  });

  it("records signups, ignores duplicate attribution, and blocks self-referrals", async () => {
    const refCode = ReferralService.refCodeFor(referrerId);
    state.users.findOne.mockResolvedValueOnce({ _id: new ObjectId(referrerId), email: "john+a@gmail.com", lastSignInIp: "27.71.10.1" });
    const service = new ReferralService(posthog);

    await service.onSignup({
      newUserId: referredId,
      newUserEmail: "john+b@gmail.com",
      newUserIp: "27.71.10.99",
      refCode,
    });

    expect(state.referrals.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        refCode,
        status: "pending",
        fraudSignals: expect.objectContaining({ sameIp: true, samePlusAlias: true, anyFlag: true }),
      }),
    );
    expect(posthog.capture).toHaveBeenCalledWith("referral_signup", { hasFraudFlag: true });

    state.referrals.insertOne.mockClear();
    state.users.findOne.mockResolvedValueOnce({ _id: new ObjectId(referrerId) });
    state.referrals.findOne.mockResolvedValueOnce({ _id: "existing" });
    await service.onSignup({ newUserId: referredId, newUserEmail: "new@example.com", newUserIp: "1.1.1.1", refCode });
    expect(state.referrals.insertOne).not.toHaveBeenCalled();

    state.users.findOne.mockResolvedValueOnce({ _id: new ObjectId(referrerId) });
    await expect(
      service.onSignup({ newUserId: referrerId, newUserEmail: "me@example.com", newUserIp: "1.1.1.1", refCode }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("qualifies clean referrals and grants one Pro month after three qualified invites", async () => {
    const referral = { _id: "ref-1", referrerId: new ObjectId(referrerId), fraudSignals: { anyFlag: false } };
    state.referrals.findOne.mockResolvedValueOnce(referral);
    state.users.findOne.mockResolvedValueOnce({ _id: new ObjectId(referredId), emailVerified: true });
    state.watchlists.countDocuments.mockResolvedValueOnce(3);
    state.referrals.countDocuments.mockResolvedValueOnce(3);
    state.referralRewards.countDocuments.mockResolvedValueOnce(0);
    const service = new ReferralService(posthog);

    await service.checkQualification(referredId);

    expect(state.referrals.updateOne).toHaveBeenCalledWith({ _id: "ref-1" }, { $set: { status: "qualified", qualifiedAt: expect.any(Date) } });
    expect(state.referralRewards.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ referrerId: new ObjectId(referrerId), monthsGranted: 1, reason: "3_qualified_invites" }),
    );
    expect(state.subscriptions.updateOne).toHaveBeenCalledWith(
      { userId: new ObjectId(referrerId) },
      { $inc: { bonusMonthsRemaining: 1 }, $set: { updatedAt: expect.any(Date) } },
      { upsert: false },
    );

    state.referrals.findOne.mockResolvedValueOnce({ ...referral, fraudSignals: { anyFlag: true } });
    state.referrals.updateOne.mockClear();
    await service.checkQualification(referredId);
    expect(state.referrals.updateOne).not.toHaveBeenCalled();
  });
});

describe("FR-GROW-002 — share deal service and controller", () => {
  const posthog = { capture: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://salenoti.vn";
    state.products.findOne.mockResolvedValue({
      shopId: 123,
      itemId: 456,
      slug: "ao-thun",
      name: "Áo thun",
      currentDiscountPct: 35,
      currentPrice: 89_000,
      imageUrl: "https://cf.shopee.vn/file/a",
    });
    state.shares.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    state.shares.updateOne.mockResolvedValue({ modifiedCount: 1 });
    state.shares.findOneAndUpdate.mockResolvedValue({ sharerId: new ObjectId(referrerId) });
    state.users.updateOne.mockResolvedValue({ modifiedCount: 1 });
    posthog.capture.mockClear();
  });

  it("creates tagged share URLs and validates controller auth/body", async () => {
    const service = new ShareService(posthog);
    const controller = new ShareController(service);

    await expect(controller.create({ productId: "123-456" }, undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.create({ productId: "bad" }, referrerId)).rejects.toMatchObject({ status: 400 });

    const share = await controller.create({ productId: "123-456" }, referrerId);

    expect(share.shareToken).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(share.shareUrl).toMatch(/^https:\/\/salenoti\.vn\/deal\/ao-thun\?s=/);
    expect(share).toMatchObject({
      title: "Áo thun — giảm 35%",
      description: "Mua giá tốt: 89.000 ₫. Theo dõi giá miễn phí trên SaleNoti.",
      imageUrl: "https://cf.shopee.vn/file/a",
      ogImage: "https://salenoti.vn/og/deal/123-456.jpg",
    });
    expect(state.shares.insertOne).toHaveBeenCalledWith(expect.objectContaining({ sharerId: new ObjectId(referrerId), productId: "123-456" }));
    expect(posthog.capture).toHaveBeenCalledWith("share_created", { productId: "123-456" });
  });

  it("rejects invalid/missing products and records landing/signup attribution", async () => {
    const service = new ShareService(posthog);

    await expect(service.createShare({ userId: referrerId, productId: "bad" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "invalid_product_id" }),
    });
    state.products.findOne.mockResolvedValueOnce(null);
    await expect(service.createShare({ userId: referrerId, productId: "123-456" })).rejects.toMatchObject({
      response: expect.objectContaining({ error: "product_not_found" }),
    });

    await service.onLandingVisit({ shareToken: "AbCdEf12", source: "zalo" });
    expect(state.shares.updateOne).toHaveBeenCalledWith({ shareToken: "AbCdEf12" }, { $inc: { clicks: 1 } });

    await service.onSignupAttribution({ shareToken: "AbCdEf12", newUserId: referredId });
    expect(state.users.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(referredId) },
      { $set: { acquiredVia: { kind: "share", shareToken: "AbCdEf12", sharerId: new ObjectId(referrerId) } } },
    );
  });

  it("exposes referral status only for authenticated users", async () => {
    const referral = { getStatus: vi.fn(async () => ({ refCode: "ABC", refLink: "https://salenoti.vn/r/ABC" })) };
    const controller = new ReferralController(referral as any);

    await expect(controller.getStatus(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.getStatus(referrerId)).resolves.toMatchObject({ refCode: "ABC" });
  });
});
