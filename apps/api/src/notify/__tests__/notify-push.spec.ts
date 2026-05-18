import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyPushProcessor, resetVapidForTests } from "../notify-push.processor";

const state = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
  users: { findOne: vi.fn(), updateOne: vi.fn() },
  watchlists: { findOne: vi.fn() },
  products: { findOne: vi.fn() },
  notifications: { insertOne: vi.fn(), countDocuments: vi.fn() },
  timescale: { getLast30dMin: vi.fn() },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: any[]) => state.setVapidDetails(...args),
    sendNotification: (...args: any[]) => state.sendNotification(...args),
  },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "users") return state.users;
        if (name === "watchlists") return state.watchlists;
        if (name === "products") return state.products;
        if (name === "notifications") return state.notifications;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

vi.mock("../../db/timescale.client", () => ({
  timescale: state.timescale,
}));

const userId = "665000000000000000000011";
const watchlistId = "665000000000000000000012";
const observedAt = new Date("2026-05-18T09:00:00.000Z");

function makeProcessor() {
  const deeplink = { generate: vi.fn(async () => ({ url: "https://shope.ee/push", cached: false, expiresAt: null })) };
  const posthog = { capture: vi.fn() };
  const sentry = { captureException: vi.fn() };
  const processor = new NotifyPushProcessor(deeplink as any, posthog, sentry);
  return { processor, deeplink, posthog, sentry };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      userId,
      watchlistId,
      triggerKind: "flash_sale",
      observedAt,
      channels: ["push"],
      jobMeta: { correlationId: "push-corr" },
      ...overrides,
    },
  } as any;
}

describe("FR-NOTIF-002 — NotifyPushProcessor contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = "test";
    process.env.VAPID_PUBLIC_KEY = "public";
    process.env.VAPID_PRIVATE_KEY = "private";
    process.env.EMAIL_IDEM_SALT = "idem-salt";
    resetVapidForTests();
    state.setVapidDetails = vi.fn();
    state.sendNotification = vi.fn(async () => undefined);
    state.users.findOne = vi.fn(async () => ({
      _id: new ObjectId(userId),
      notificationChannels: { webPush: true },
      pushSubscriptions: [
        { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "p", auth: "a" } },
        { endpoint: "https://fcm.googleapis.com/fcm/send/b", keys: { p256dh: "p", auth: "b" } },
      ],
    }));
    state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.watchlists.findOne = vi.fn(async () => ({ _id: new ObjectId(watchlistId), productId: "123-456" }));
    state.products.findOne = vi.fn(async () => ({
      shopId: 123,
      itemId: 456,
      name: "Áo push",
      currentPrice: 89_000,
      currentDiscountPct: 31,
    }));
    state.notifications.insertOne = vi.fn(async () => ({ insertedId: new ObjectId() }));
    state.notifications.countDocuments = vi.fn(async () => 0);
    state.timescale.getLast30dMin = vi.fn(async () => 85_000);
  });

  it("sends push payloads with VAPID TTL, OS tag idem, min-30d body, and redacted analytics", async () => {
    const { processor, posthog } = makeProcessor();

    await processor.process(makeJob());

    expect(state.setVapidDetails).toHaveBeenCalledWith("mailto:dpo@salenoti.vn", "public", "private");
    expect(state.sendNotification).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(state.sendNotification.mock.calls[0]![1]);
    expect(payload).toMatchObject({
      title: "🔥 Áo push",
      body: "Giảm 31% — 89.000 ₫ · Min 30d: 85.000 ₫",
      icon: "/icon-192.png",
      tag: expect.stringMatching(/^[a-f0-9]{32}$/),
      data: { idem: expect.stringMatching(/^[a-f0-9]{32}$/) },
    });
    expect(state.sendNotification.mock.calls[0]![2]).toEqual({ TTL: 86_400 });
    expect(posthog.capture).toHaveBeenCalledWith(
      "push_sent",
      expect.objectContaining({ device_count: 2, success_count: 2, failure_count: 0, idem_tail: expect.any(String) }),
    );
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toContain("fcm.googleapis.com");
  });

  it("uses product fallback copy and omits min text when Timescale has no 30-day low", async () => {
    state.users.findOne.mockResolvedValueOnce({
      notificationChannels: { webPush: true },
      pushSubscriptions: [{ keys: { p256dh: "p", auth: "a" } }],
    });
    state.products.findOne.mockResolvedValueOnce({});
    state.timescale.getLast30dMin.mockResolvedValueOnce(null);
    const { processor } = makeProcessor();

    await processor.process(makeJob());

    const payload = JSON.parse(state.sendNotification.mock.calls[0]![1]);
    expect(payload.title).toBe("🔥 Sản phẩm");
    expect(payload.body).toBe("Giảm 0% — 0 ₫");
  });

  it("removes 410/404 subscriptions, disables channel when all are stale, and never logs endpoints", async () => {
    state.sendNotification
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 404 });
    const { processor, posthog } = makeProcessor();

    await processor.process(makeJob());

    expect(state.users.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(userId) },
      { $pull: { pushSubscriptions: { endpoint: "https://fcm.googleapis.com/fcm/send/a" } } },
    );
    expect(state.users.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(userId) },
      { $set: { "notificationChannels.webPush": false } },
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "push_sent",
      expect.objectContaining({ success_count: 0, failure_count: 2, stale_dropped: 2 }),
    );
  });

  it("defers at combined daily cap, skips unsupported paths, and retries transient 5xx", async () => {
    const { processor, sentry, posthog } = makeProcessor();

    await processor.process(makeJob({ channels: ["email"] }));
    expect(state.sendNotification).not.toHaveBeenCalled();

    state.notifications.countDocuments.mockResolvedValueOnce(20);
    await processor.process(makeJob());
    expect(state.notifications.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "webPush", deferredReason: "daily_cap", correlationId: "push-corr" }),
    );
    expect(posthog.capture).toHaveBeenCalledWith("alert_deferred", { reason: "daily_cap", channel: "webPush" });

    state.sendNotification
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockRejectedValueOnce({ statusCode: 502 })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ statusCode: 400 });
    await processor.process(makeJob());
    expect(state.sendNotification).toHaveBeenCalledTimes(4);
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
      expect.objectContaining({ tags: expect.objectContaining({ endpoint_hash: expect.any(String) }) }),
    );
    expect(JSON.stringify(sentry.captureException.mock.calls)).not.toContain("fcm.googleapis.com");

    state.users.findOne.mockResolvedValueOnce({
      notificationChannels: { webPush: true },
      pushSubscriptions: [{ keys: { p256dh: "p", auth: "a" } }],
    });
    state.sendNotification.mockRejectedValueOnce({}).mockRejectedValueOnce({}).mockRejectedValueOnce({});
    await processor.process(makeJob());
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: expect.objectContaining({ status: "unknown" }) }),
    );
  });

  it("no-ops when VAPID, user, channel, subscriptions, watchlist, product, or productId are missing", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    resetVapidForTests();
    await expect(makeProcessor().processor.process(makeJob())).resolves.toBeUndefined();

    process.env.VAPID_PUBLIC_KEY = "public";
    process.env.VAPID_PRIVATE_KEY = "private";
    resetVapidForTests();
    const { processor } = makeProcessor();
    state.users.findOne.mockResolvedValueOnce(null);
    await processor.process(makeJob());
    state.users.findOne.mockResolvedValueOnce({ notificationChannels: { webPush: false }, pushSubscriptions: [{}] });
    await processor.process(makeJob());
    state.users.findOne.mockResolvedValueOnce({ notificationChannels: { webPush: true }, pushSubscriptions: [] });
    await processor.process(makeJob());
    state.watchlists.findOne.mockResolvedValueOnce(null);
    await processor.process(makeJob());
    state.watchlists.findOne.mockResolvedValueOnce({ productId: "bad" });
    await processor.process(makeJob());
    state.products.findOne.mockResolvedValueOnce(null);
    await processor.process(makeJob());

    expect(state.sendNotification).not.toHaveBeenCalled();
  });
});
