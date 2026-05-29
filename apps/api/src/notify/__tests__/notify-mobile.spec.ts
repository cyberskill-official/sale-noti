import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyMobileProcessor } from "../notify-mobile.processor";

const state = vi.hoisted(() => ({
  users: { findOne: vi.fn(), updateOne: vi.fn() },
  watchlists: { findOne: vi.fn() },
  products: { findOne: vi.fn() },
  notifications: { insertOne: vi.fn(), countDocuments: vi.fn() },
  timescale: { getLast30dMin: vi.fn() },
  globalFetch: vi.fn(),
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

vi.mock("../idempotency", () => ({
  alertIdem: vi.fn(({ userId, watchlistId, triggerKind, observedAt, channel }) => {
    return `idem_${userId}_${watchlistId}_${triggerKind}_${channel}_${observedAt.getTime()}`;
  }),
  dailyCount: vi.fn(async (userId) => 0),
  reserveSend: vi.fn(async () => true),
  recordDeferred: vi.fn(async () => {}),
}));

// Mock global fetch
global.fetch = state.globalFetch as any;

const userId = "665000000000000000000011";
const watchlistId = "665000000000000000000012";
const observedAt = new Date("2026-05-26T09:00:00.000Z");

const expoToken1 = "ExponentPushToken[abc123def456]";
const expoToken2 = "ExponentPushToken[xyz789uvw000]";

function makeProcessor() {
  const deeplink = { generate: vi.fn(async () => ({ url: "https://deeplink.test/watchlist/123?idem=abc", cached: false, expiresAt: null })) };
  const posthog = { capture: vi.fn() };
  const sentry = { captureException: vi.fn() };
  const processor = new NotifyMobileProcessor(deeplink as any, posthog, sentry);
  return { processor, deeplink, posthog, sentry };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      userId,
      watchlistId,
      triggerKind: "flash_sale",
      observedAt,
      channels: ["mobilePush"],
      jobMeta: { correlationId: "mobile-corr" },
      ...overrides,
    },
  } as any;
}

describe("FR-NOTIF-004 — NotifyMobileProcessor contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = "test";
    process.env.EXPO_ACCESS_TOKEN = "test-expo-token";

    state.globalFetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    global.fetch = state.globalFetch as any;

    state.users.findOne = vi.fn(async () => ({
      _id: new ObjectId(userId),
      notificationChannels: { mobilePush: true },
      mobilePushTokens: [
        { token: expoToken1, platform: "ios", deviceId: "device-1", appVersion: "1.0.0", addedAt: new Date(), lastSeenAt: new Date() },
        { token: expoToken2, platform: "android", deviceId: "device-2", appVersion: "1.0.0", addedAt: new Date(), lastSeenAt: new Date() },
      ],
    }));
    state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.watchlists.findOne = vi.fn(async () => ({ _id: new ObjectId(watchlistId), productId: "123-456" }));
    state.products.findOne = vi.fn(async () => ({
      shopId: 123,
      itemId: 456,
      name: "Sản phẩm test",
      currentPrice: 89_000,
      currentDiscountPct: 31,
    }));
    state.notifications.insertOne = vi.fn(async () => ({ insertedId: new ObjectId() }));
    state.notifications.countDocuments = vi.fn(async () => 0);
    state.timescale.getLast30dMin = vi.fn(async () => 85_000);
  });

  describe("Basic flow", () => {
    it("skips when channel mobilePush is not in channels list", async () => {
      const { processor } = makeProcessor();
      const job = makeJob({ channels: ["email"] });

      await processor.process(job);

      expect(state.users.findOne).not.toHaveBeenCalled();
    });

    it("skips when EXPO_ACCESS_TOKEN is not set", async () => {
      process.env.EXPO_ACCESS_TOKEN = "";
      const { processor } = makeProcessor();
      const job = makeJob();

      await processor.process(job);

      expect(state.users.findOne).not.toHaveBeenCalled();
    });

    it("skips when user not found", async () => {
      state.users.findOne = vi.fn(async () => null);
      const { processor } = makeProcessor();

      await processor.process(makeJob());

      expect(state.globalFetch).not.toHaveBeenCalled();
    });

    it("skips when user has notificationChannels.mobilePush = false", async () => {
      state.users.findOne = vi.fn(async () => ({
        _id: new ObjectId(userId),
        notificationChannels: { mobilePush: false },
      }));
      const { processor } = makeProcessor();

      await processor.process(makeJob());

      expect(state.globalFetch).not.toHaveBeenCalled();
    });

    it("skips when user has no tokens", async () => {
      state.users.findOne = vi.fn(async () => ({
        _id: new ObjectId(userId),
        notificationChannels: { mobilePush: true },
        mobilePushTokens: [],
      }));
      const { processor } = makeProcessor();

      await processor.process(makeJob());

      expect(state.globalFetch).not.toHaveBeenCalled();
    });
  });

  describe("Daily cap enforcement (FR-NOTIF-004 §1 #10)", () => {
    it("defers alert when daily cap is reached", async () => {
      const { recordDeferred } = await import("../idempotency");
      const mockRecordDeferred = recordDeferred as any;
      const mockDailyCount = (await import("../idempotency")).dailyCount as any;

      mockDailyCount.mockResolvedValueOnce(20); // Already at cap

      const { processor, posthog } = makeProcessor();
      await processor.process(makeJob());

      expect(mockRecordDeferred).toHaveBeenCalledWith({
        userId,
        watchlistId,
        channel: "mobilePush",
        triggerKind: "flash_sale",
        reason: "daily_cap",
        correlationId: "mobile-corr",
      });

      expect(posthog.capture).toHaveBeenCalledWith("alert_deferred", { reason: "daily_cap", channel: "mobilePush" });
      expect(state.globalFetch).not.toHaveBeenCalled();
    });

    it("sends alert when daily count is below cap", async () => {
      const { dailyCount } = await import("../idempotency");
      (dailyCount as any).mockResolvedValueOnce(5); // Below 20

      state.globalFetch = vi.fn(async () =>
        new Response(JSON.stringify({ data: "ok" }), { status: 200 })
      );
      global.fetch = state.globalFetch as any;

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      // Should attempt to send
      expect(state.globalFetch).toHaveBeenCalledWith(
        "https://exp.host/--/api/v2/push/send",
        expect.any(Object)
      );
    });
  });

  describe("Idempotency (FR-NOTIF-004 §1 #7)", () => {
    it("uses alertIdem and reserveSend with channel: mobilePush", async () => {
      const { alertIdem, reserveSend } = await import("../idempotency");
      const mockAlertIdem = alertIdem as any;
      const mockReserveSend = reserveSend as any;

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      expect(mockAlertIdem).toHaveBeenCalledWith({
        userId,
        watchlistId,
        triggerKind: "flash_sale",
        observedAt,
        channel: "mobilePush",
      });

      expect(mockReserveSend).toHaveBeenCalledWith({
        userId,
        watchlistId,
        channel: "mobilePush",
        idem: expect.stringContaining("idem_"),
        triggerKind: "flash_sale",
        observedAt,
        correlationId: "mobile-corr",
      });
    });

    it("skips send if reserveSend returns false (duplicate idem)", async () => {
      const { reserveSend } = await import("../idempotency");
      (reserveSend as any).mockResolvedValueOnce(false);

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      expect(state.globalFetch).not.toHaveBeenCalled();
    });
  });

  describe("Expo API integration", () => {
    it("sends push payload with title, body, data.url, data.idem", async () => {
      const { processor } = makeProcessor();
      await processor.process(makeJob());

      expect(state.globalFetch).toHaveBeenCalledWith(
        "https://exp.host/--/api/v2/push/send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: "Bearer test-expo-token",
          },
          body: expect.stringContaining('"title"'),
        }
      );

      const bodyArg = state.globalFetch.mock.calls[0][1].body;
      const payload = JSON.parse(bodyArg);
      expect(payload.title).toMatch(/🔥/);
      expect(payload.body).toMatch(/Giảm/);
      expect(payload.data.url).toContain("salenoti://watchlists");
      expect(payload.data.idem).toBeDefined();
    });

    it("deep-links to salenoti://watchlists/<watchlistId>?utm=mobilePush&idem=...", async () => {
      const { processor } = makeProcessor();
      await processor.process(makeJob());

      const bodyArg = state.globalFetch.mock.calls[0][1].body;
      const payload = JSON.parse(bodyArg);
      expect(payload.data.url).toContain(`salenoti://watchlists/${watchlistId}`);
      expect(payload.data.url).toContain("utm=mobilePush");
      expect(payload.data.url).toContain("idem=");
    });

    it("sends one request per registered token", async () => {
      const { processor } = makeProcessor();
      await processor.process(makeJob());

      expect(state.globalFetch).toHaveBeenCalledTimes(2); // Two tokens
    });
  });

  describe("Token cleanup (FR-NOTIF-004 §1 #11)", () => {
    it("removes token when Expo returns 400 with INVALID_PUSH_TOKEN", async () => {
      state.globalFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: [{ code: "INVALID_PUSH_TOKEN" }] }),
          { status: 400 }
        )
      );
      global.fetch = state.globalFetch as any;

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      // Should call updateOne to remove the invalid token
      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(Object) }),
        { $pull: { mobilePushTokens: { token: expoToken1 } } }
      );
    });

    it("disables mobilePush channel when all tokens are removed", async () => {
      state.users.findOne = vi.fn(async () => ({
        _id: new ObjectId(userId),
        notificationChannels: { mobilePush: true },
        mobilePushTokens: [
          { token: expoToken1, platform: "ios", addedAt: new Date(), lastSeenAt: new Date() },
        ],
      }));

      state.globalFetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: [{ code: "INVALID_PUSH_TOKEN" }] }),
          { status: 400 }
        )
      );
      global.fetch = state.globalFetch as any;

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      // When last token is removed
      expect(state.users.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(Object) },
        { $set: { "notificationChannels.mobilePush": false } }
      );
    });

    it("captures Sentry exception on non-410 errors with hashed token", async () => {
      state.globalFetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: "service_error" }), { status: 500 })
      );
      global.fetch = state.globalFetch as any;

      const { processor, sentry } = makeProcessor();
      await processor.process(makeJob());

      expect(sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        {
          tags: {
            fr: "FR-NOTIF-004",
            token_hash: expect.stringMatching(/^[a-f0-9]{16}$/), // 16-char hex
            platform: expect.stringMatching(/^(ios|android)$/),
          },
        }
      );
    });
  });

  describe("Analytics (FR-NOTIF-004 §1 #12)", () => {
    it("emits mobile_push_sent event with counts and idem_tail, no raw tokens", async () => {
      const { processor, posthog } = makeProcessor();
      await processor.process(makeJob());

      expect(posthog.capture).toHaveBeenCalledWith(
        "mobile_push_sent",
        {
          trigger: "flash_sale",
          productId: "123-456",
          device_count: 2,
          success_count: 2,
          failure_count: 0,
          stale_dropped: 0,
          idem_tail: expect.stringMatching(/^.{12}$/), // 12-char tail
        }
      );

      // Verify no raw tokens in event
      const eventCall = posthog.capture.mock.calls[posthog.capture.mock.calls.length - 1];
      const eventData = JSON.stringify(eventCall[1]);
      expect(eventData).not.toContain("ExponentPushToken");
      expect(eventData).not.toContain("device-1");
      expect(eventData).not.toContain("device-2");
    });

    it("counts sent vs failed vs removed in analytics", async () => {
      // First token succeeds, second fails
      state.globalFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: "ok" }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ errors: [{ code: "INVALID_PUSH_TOKEN" }] }), { status: 400 })
        );
      global.fetch = state.globalFetch as any;

      const { processor, posthog } = makeProcessor();
      await processor.process(makeJob());

      expect(posthog.capture).toHaveBeenCalledWith(
        "mobile_push_sent",
        expect.objectContaining({
          success_count: 1,
          failure_count: 1,
          stale_dropped: 1,
        })
      );
    });
  });

  describe("Error handling", () => {
    it("skips when watchlist not found", async () => {
      state.watchlists.findOne = vi.fn(async () => null);
      const { processor } = makeProcessor();

      await processor.process(makeJob());

      expect(state.globalFetch).not.toHaveBeenCalled();
    });

    it("skips when product not found", async () => {
      state.products.findOne = vi.fn(async () => null);
      const { processor } = makeProcessor();

      await processor.process(makeJob());

      expect(state.globalFetch).not.toHaveBeenCalled();
    });

    it("continues sending to other tokens even if one fails", async () => {
      state.globalFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: "ok" }), { status: 200 }))
        .mockRejectedValueOnce(new Error("network error"));
      global.fetch = state.globalFetch as any;

      const { processor, sentry } = makeProcessor();
      await processor.process(makeJob());

      // Should have attempted both sends
      expect(state.globalFetch).toHaveBeenCalledTimes(2);
      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  describe("Deep-link generation", () => {
    it("calls DeeplinkService.generate with correct params", async () => {
      const { processor, deeplink } = makeProcessor();
      await processor.process(makeJob());

      expect(deeplink.generate).toHaveBeenCalledWith({
        userId,
        productId: "123-456",
        source: "alert_push",
        watchlistId,
      });
    });

    it("includes min 30d price in body text", async () => {
      state.timescale.getLast30dMin = vi.fn(async () => 75_000);

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      const bodyArg = state.globalFetch.mock.calls[0][1].body;
      const payload = JSON.parse(bodyArg);
      expect(payload.body).toContain("75.000"); // Vietnamese number format
      expect(payload.body).toContain("₫");
    });

    it("omits min 30d from body when timescale lookup fails", async () => {
      state.timescale.getLast30dMin = vi.fn(async () => {
        throw new Error("service unavailable");
      });

      const { processor } = makeProcessor();
      await processor.process(makeJob());

      const bodyArg = state.globalFetch.mock.calls[0][1].body;
      const payload = JSON.parse(bodyArg);
      expect(payload.body).not.toContain("Min 30d");
    });
  });
});
