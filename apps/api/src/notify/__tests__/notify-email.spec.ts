import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyEmailProcessor, resetResendForTests, type AlertJobData } from "../notify-email.processor";
import {
  NotificationIndexService,
  alertIdem,
  dailyCount,
  emailHash,
  ensureNotificationIndexes,
  nextHoChiMinhNine,
  reserveSend,
  unsubscribeToken,
} from "../idempotency";
import { NotifyModule } from "../notify.module";

const state = vi.hoisted(() => ({
  resendSend: vi.fn(),
  users: { findOne: vi.fn(), updateOne: vi.fn(), createIndex: vi.fn() },
  watchlists: { findOne: vi.fn(), updateOne: vi.fn(), createIndex: vi.fn() },
  products: { findOne: vi.fn(), createIndex: vi.fn() },
  affiliateLinks: { findOne: vi.fn(), createIndex: vi.fn() },
  notifications: { insertOne: vi.fn(), updateOne: vi.fn(), countDocuments: vi.fn(), createIndex: vi.fn() },
  suppressionList: { findOne: vi.fn(), updateOne: vi.fn(), createIndex: vi.fn() },
  userEmailHealth: { findOneAndUpdate: vi.fn(), updateOne: vi.fn(), createIndex: vi.fn() },
  webhookEvents: { createIndex: vi.fn() },
}));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: (...args: any[]) => state.resendSend(...args),
    },
  })),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "users") return state.users;
        if (name === "watchlists") return state.watchlists;
        if (name === "products") return state.products;
        if (name === "affiliate_links") return state.affiliateLinks;
        if (name === "notifications") return state.notifications;
        if (name === "suppression_list") return state.suppressionList;
        if (name === "user_email_health") return state.userEmailHealth;
        if (name === "webhook_events") return state.webhookEvents;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

vi.mock("../../db/timescale.client", () => ({
  timescale: {
    getLast30dMin: vi.fn(async () => 88_000),
  },
}));

const userId = "665000000000000000000001";
const watchlistId = "665000000000000000000002";
const affiliateLinkId = new ObjectId("665000000000000000000003");
const observedAt = new Date("2026-05-18T08:00:00.000Z");

function makeProcessor() {
  const deeplink = { generate: vi.fn(async () => ({ url: "https://shope.ee/abc", cached: false, expiresAt: null })) };
  const posthog = { capture: vi.fn() };
  const sentry = { captureException: vi.fn() };
  const processor = new NotifyEmailProcessor(deeplink as any, posthog, sentry);
  return { processor, deeplink, posthog, sentry };
}

function makeJob(overrides: Partial<AlertJobData> = {}) {
  const data: AlertJobData = {
    userId,
    watchlistId,
    triggerKind: "pct_drop",
    observedAt,
    observedPrice: 89_000,
    baseline: 129_000,
    baselineLow30d: 88_000,
    channels: ["email", "push"],
    jobMeta: { correlationId: "corr-1" },
    ...overrides,
  };
  return {
    id: "job-1",
    data,
    queue: { add: vi.fn(async () => ({ id: "delayed-1" })) },
  } as any;
}

describe("FR-NOTIF-001 — NotifyEmailProcessor contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = "test";
    process.env.RESEND_API_KEY = "test_resend";
    process.env.APP_URL = "https://sale.cyber.skill";
    process.env.EMAIL_HASH_SALT = "email-salt";
    process.env.EMAIL_IDEM_SALT = "idem-salt";
    process.env.UNSUB_SALT = "unsub-salt";
    state.resendSend = vi.fn(async () => ({ data: { id: "msg_123" }, error: null }));
    state.users.findOne = vi.fn(async () => ({
      _id: new ObjectId(userId),
      email: "User@Example.com",
      plan: "free",
      notificationChannels: { email: true },
    }));
    state.watchlists.findOne = vi.fn(async () => ({
      _id: new ObjectId(watchlistId),
      userId: new ObjectId(userId),
      productId: "123-456",
      baselineAtTrack: 129_000,
    }));
    state.watchlists.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.products.findOne = vi.fn(async () => ({
      shopId: 123,
      itemId: 456,
      productId: "123-456",
      name: "Áo thun",
      imageUrl: "https://cf.shopee.vn/file/x",
      currentPrice: 89_000,
      originalPrice: 129_000,
      currentDiscountPct: 31,
    }));
    state.affiliateLinks.findOne = vi.fn(async () => ({ _id: affiliateLinkId, shortUrl: "https://shope.ee/abc" }));
    state.notifications.insertOne = vi.fn(async () => ({ insertedId: new ObjectId() }));
    state.notifications.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.notifications.countDocuments = vi.fn(async () => 0);
    state.suppressionList.findOne = vi.fn(async () => null);
    resetResendForTests();
  });

  it("sends one Resend email, persists idempotent audit state, and writes cooldown", async () => {
    const { processor, deeplink, posthog } = makeProcessor();
    await processor.process(makeJob());

    const idem = alertIdem({ userId, watchlistId, triggerKind: "pct_drop", observedAt, channel: "email" });
    expect(state.notifications.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        watchlistId,
        channel: "email",
        idem,
        triggerKind: "pct_drop",
        email_hash: emailHash("User@Example.com"),
        correlationId: "corr-1",
      }),
    );
    expect(deeplink.generate).toHaveBeenCalledWith({
      userId,
      productId: "123-456",
      source: "alert_email",
      watchlistId,
    });
    expect(state.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "SaleNoti <alerts@cyberskill.world>",
        to: "User@Example.com",
        tags: expect.arrayContaining([
          { name: "fr", value: "FR-NOTIF-001" },
          { name: "trigger", value: "pct_drop" },
          { name: "user_cohort", value: "free" },
        ]),
        headers: expect.objectContaining({
          "List-Unsubscribe": expect.stringContaining(unsubscribeToken(userId, watchlistId)),
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-PM-Message-Stream": "outbound",
        }),
      }),
    );
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { idem, channel: "email" },
      { $set: { resendMessageId: "msg_123", affiliateLinkId } },
    );
    expect(state.watchlists.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(watchlistId) },
      { $set: { "triggerCooldowns.pct_drop": expect.any(Date), lastNotifiedAt: expect.any(Date) } },
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "alert_dispatch_latency_ms",
      expect.objectContaining({ channel: "email", latency_ms: expect.any(Number) }),
    );
  });

  it("skips disabled, non-email, duplicate, and suppressed dispatch paths safely", async () => {
    const { processor, posthog } = makeProcessor();

    await processor.process(makeJob({ channels: ["push"] }));
    expect(state.resendSend).not.toHaveBeenCalled();

    state.users.findOne.mockResolvedValueOnce({ notificationChannels: { email: false }, email: "u@example.com" });
    await processor.process(makeJob());
    expect(posthog.capture).toHaveBeenCalledWith("alert_skipped_channel_disabled", {
      channel: "email",
      trigger: "pct_drop",
    });

    state.notifications.insertOne.mockRejectedValueOnce({ code: 11000 });
    await processor.process(makeJob());
    expect(state.resendSend).not.toHaveBeenCalled();

    state.suppressionList.findOne.mockResolvedValueOnce({ email_hash: emailHash("User@Example.com") });
    await processor.process(makeJob());
    expect(state.watchlists.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(watchlistId) },
      { $set: { "triggerCooldowns.pct_drop": expect.any(Date), lastNotifiedAt: expect.any(Date) } },
    );
    expect(posthog.capture).toHaveBeenCalledWith("alert_suppressed", { reason: "suppression_list", channel: "email" });
  });

  it("defers the 21st rolling-day alert to next 09:00 Asia/Ho_Chi_Minh with an audit row", async () => {
    state.notifications.countDocuments.mockResolvedValueOnce(20);
    const { processor, posthog } = makeProcessor();
    const job = makeJob();

    await processor.process(job);

    expect(state.notifications.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", deferredReason: "daily_cap", correlationId: "corr-1" }),
    );
    expect(job.queue.add).toHaveBeenCalledWith("alert", job.data, expect.objectContaining({ attempts: 3, delay: expect.any(Number) }));
    expect(posthog.capture).toHaveBeenCalledWith("alert_deferred", { reason: "daily_cap", channel: "email" });
    expect(state.resendSend).not.toHaveBeenCalled();
  });

  it("captures Resend failures with hashed email and affiliate link id only", async () => {
    state.resendSend.mockResolvedValueOnce({ data: null, error: { message: "resend down user@example.com https://shope.ee/abc" } });
    const { processor, sentry } = makeProcessor();

    await expect(processor.process(makeJob())).rejects.toThrow("resend down");

    const capture = sentry.captureException.mock.calls[0]!;
    expect(JSON.stringify(capture)).not.toContain("User@Example.com");
    expect(JSON.stringify(capture)).not.toContain("https://shope.ee/abc");
    expect(capture[1]).toMatchObject({
      contexts: { notify: { email_hash: emailHash("User@Example.com"), affiliate_link_id: affiliateLinkId } },
    });
  });

  it("handles dev-stub send and missing entity short-circuit branches", async () => {
    const { processor } = makeProcessor();

    state.users.findOne.mockResolvedValueOnce(null);
    await expect(processor.process(makeJob())).resolves.toBeUndefined();

    state.watchlists.findOne.mockResolvedValueOnce(null);
    await expect(processor.process(makeJob())).resolves.toBeUndefined();

    state.watchlists.findOne.mockResolvedValueOnce({ productId: "not-a-product-id" });
    await expect(processor.process(makeJob())).resolves.toBeUndefined();

    state.products.findOne.mockResolvedValueOnce(null);
    await expect(processor.process(makeJob())).resolves.toBeUndefined();

    delete process.env.RESEND_API_KEY;
    resetResendForTests();
    await expect(
      processor.process(
        makeJob({
          observedAt: observedAt.toISOString(),
          observedPrice: undefined,
          baseline: undefined,
          baselineLow30d: undefined,
          channels: undefined,
          jobMeta: undefined,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(state.watchlists.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(watchlistId) },
      { $set: { "triggerCooldowns.pct_drop": expect.any(Date), lastNotifiedAt: expect.any(Date) } },
    );
  });

  it("uses default product fields, fallback app URL, top-level Resend id, and null affiliateLinkId", async () => {
    delete process.env.APP_URL;
    state.products.findOne.mockResolvedValueOnce({ shopId: 123, itemId: 456, productId: "123-456" });
    state.affiliateLinks.findOne.mockResolvedValueOnce(null);
    state.resendSend.mockResolvedValueOnce({ id: "msg_top_level", error: null });
    const { processor } = makeProcessor();

    await processor.process(makeJob({ observedPrice: undefined, baseline: undefined, baselineLow30d: undefined }));

    expect(state.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "🔥 Sản phẩm giảm 0% — 0 ₫",
        headers: expect.objectContaining({
          "List-Unsubscribe": expect.stringContaining("https://sale.cyber.skill/unsubscribe"),
        }),
      }),
    );
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { resendMessageId: "msg_top_level", affiliateLinkId: null } },
    );
  });

  it("covers idempotency helpers, rolling counts, indexes, and module metadata", async () => {
    expect(alertIdem({ userId, watchlistId, triggerKind: "pct_drop", observedAt })).toMatch(/^[a-f0-9]{32}$/);
    const idem = alertIdem({ userId, watchlistId, triggerKind: "flash_sale", observedAt, channel: "telegram" });
    expect(idem).toMatch(/^[a-f0-9]{32}$/);
    expect(unsubscribeToken(userId, null)).toHaveLength(24);

    state.notifications.insertOne.mockResolvedValueOnce({ insertedId: "ok" });
    await expect(reserveSend({ userId, watchlistId, channel: "email", idem })).resolves.toBe(true);
    expect(state.notifications.insertOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        triggerKind: null,
        observedAt: null,
        email_hash: null,
        correlationId: null,
      }),
    );

    state.notifications.insertOne.mockRejectedValueOnce({ code: 42 });
    await expect(reserveSend({ userId, watchlistId, channel: "email", idem })).rejects.toMatchObject({ code: 42 });

    state.notifications.countDocuments.mockResolvedValueOnce(7);
    await expect(dailyCount(userId)).resolves.toBe(7);
    expect(state.notifications.countDocuments).toHaveBeenCalledWith({
      userId,
      deferredReason: { $exists: false },
      sentAt: { $gte: expect.any(Date) },
    });

    expect(nextHoChiMinhNine(new Date("2026-05-18T01:00:00.000Z")).toISOString()).toBe("2026-05-18T02:00:00.000Z");
    expect(nextHoChiMinhNine(new Date("2026-05-18T03:00:00.000Z")).toISOString()).toBe("2026-05-19T02:00:00.000Z");

    await ensureNotificationIndexes();
    expect(state.notifications.createIndex).toHaveBeenCalledWith(
      { idem: 1, channel: 1 },
      { unique: true, name: "idem_channel_unique" },
    );
    await new NotificationIndexService().onModuleInit();
    expect(NotifyModule).toBeDefined();

    delete process.env.EMAIL_HASH_SALT;
    delete process.env.PII_HASH_SALT;
    process.env.NODE_ENV = "production";
    expect(() => emailHash("u@example.com")).toThrow("EMAIL_HASH_SALT_MISSING");
    process.env.NODE_ENV = "test";
    process.env.EMAIL_HASH_SALT = "email-salt";
  });
});
