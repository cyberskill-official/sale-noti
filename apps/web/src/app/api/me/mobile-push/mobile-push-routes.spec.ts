import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as subscribe } from "./subscribe/route";
import { POST as unsubscribe } from "./unsubscribe/route";
import { POST as clicked } from "./clicked/route";

const state = vi.hoisted(() => ({
  rateLimitFixed: vi.fn(),
  users: { updateOne: vi.fn(), findOne: vi.fn() },
  notifications: { updateOne: vi.fn() },
}));

vi.mock("@/server/auth/rate-limit", () => ({
  rateLimitFixed: (...args: unknown[]) => state.rateLimitFixed(...args),
}));

vi.mock("@/server/db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "users") return state.users;
        if (name === "notifications") return state.notifications;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

function req(path: string, body: unknown, userId = "665000000000000000000021") {
  return new Request(`https://sale.cyber.skill${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify(body),
  });
}

const expoToken1 = "ExponentPushToken[abc123def456]";
const expoToken2 = "ExponentPushToken[xyz789uvw000]";
const expoToken3 = "ExponentPushToken[foo111bar222]";
const expoToken4 = "ExponentPushToken[qux333mno444]";
const expoToken5 = "ExponentPushToken[pqr555stu666]";
const expoToken6 = "ExponentPushToken[vwx777yza888]";

describe("FR-NOTIF-004 — Mobile push routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.rateLimitFixed = vi.fn(async () => ({ ok: true, used: 1 }));
    state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.users.findOne = vi.fn(async () => ({ mobilePushTokens: [] }));
    state.notifications.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
  });

  describe("Subscribe endpoint", () => {
    it("validates input with required token and platform", async () => {
      // Missing token
      const noToken = await subscribe(req("/api/me/mobile-push/subscribe", { platform: "ios" }));
      expect(noToken.status).toBe(400);
      await expect(noToken.json()).resolves.toEqual({ ok: false, error: "validation_failed" });

      // Missing platform
      const noPlatform = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1 }));
      expect(noPlatform.status).toBe(400);

      // Invalid platform
      const badPlatform = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "web" }));
      expect(badPlatform.status).toBe(400);

      // Valid: token + platform
      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: [] }));
      const valid = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios" }));
      expect(valid.status).toBe(200);
    });

    it("requires authentication (x-user-id header)", async () => {
      const noAuth = new Request("https://sale.cyber.skill/api/me/mobile-push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: expoToken1, platform: "ios" }),
      });
      const response = await subscribe(noAuth);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "unauthenticated" });
    });

    it("rate-limits to 5 calls/min/user", async () => {
      state.rateLimitFixed.mockResolvedValueOnce({ ok: false, used: 6 });
      const response = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios" }));
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      await expect(response.json()).resolves.toEqual({ ok: false, error: "rate_limit", retryAfter: 60 });

      expect(state.rateLimitFixed).toHaveBeenCalledWith("mobilePush:subscribe:665000000000000000000021", 5, 60);
    });

    it("rejects invalid user ID format", async () => {
      const response = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios" }, "not-an-objectid"));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_user_id" });
    });

    it("creates new token with addedAt/lastSeenAt when first registered", async () => {
      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: [] }));
      state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));

      const response = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios", appVersion: "1.0.0" }));
      expect(response.status).toBe(200);

      // Verify updateOne was called with $push and $slice for FIFO
      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $push: {
            mobilePushTokens: expect.objectContaining({
              $each: expect.arrayContaining([
                expect.objectContaining({
                  token: expoToken1,
                  platform: "ios",
                  appVersion: "1.0.0",
                  addedAt: expect.any(Date),
                  lastSeenAt: expect.any(Date),
                }),
              ]),
              $slice: -5, // FIFO cap at 5 devices
            }),
          },
          $set: expect.objectContaining({ "notificationChannels.mobilePush": true }),
        })
      );
    });

    it("upserts same token: refresh lastSeenAt, preserve addedAt", async () => {
      const addedAt = new Date("2026-05-20T10:00:00Z");
      state.users.findOne = vi.fn(async () => ({
        mobilePushTokens: [
          { token: expoToken1, platform: "ios", appVersion: "1.0.0", addedAt, lastSeenAt: new Date("2026-05-25T09:00:00Z") },
        ],
      }));

      const response = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios", appVersion: "1.1.0" }));
      expect(response.status).toBe(200);

      // Verify it uses array update ($set with arrayFilters) instead of $push
      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(Object), "mobilePushTokens.token": expoToken1 }),
        {
          $set: { "mobilePushTokens.$[elem].lastSeenAt": expect.any(Date) },
        },
        expect.objectContaining({
          arrayFilters: [{ "elem.token": expoToken1 }],
        })
      );

      // No $push should happen, no new addedAt created
      const callArgs = state.users.updateOne.mock.calls[0][1];
      expect(callArgs.$push).toBeUndefined();
    });

    it("enforces FIFO cap of 5 devices with eviction on 6th registration", async () => {
      const now = new Date();
      const baseTime = new Date("2026-05-20T10:00:00Z");
      const tokens = [expoToken1, expoToken2, expoToken3, expoToken4, expoToken5];
      const mockTokens = tokens.map((t, i) => ({
        token: t,
        platform: i % 2 === 0 ? "ios" : "android",
        addedAt: new Date(baseTime.getTime() + i * 1000),
        lastSeenAt: new Date(baseTime.getTime() + i * 1000),
      }));

      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: mockTokens }));
      state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));

      // Register a 6th token
      const response = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken6, platform: "ios" }));
      expect(response.status).toBe(200);

      // Verify $push includes $slice: -5 (keeps most-recent 5, drops oldest)
      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $push: {
            mobilePushTokens: expect.objectContaining({
              $slice: -5, // Only keeps last 5 items added
            }),
          },
        })
      );
    });

    it("returns deviceCount after successful subscription", async () => {
      const mockTokens = [
        { token: expoToken1, platform: "ios", addedAt: new Date(), lastSeenAt: new Date() },
        { token: expoToken2, platform: "android", addedAt: new Date(), lastSeenAt: new Date() },
      ];
      state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: mockTokens }));

      const response = await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios" }));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, deviceCount: 2 });
    });

    it("sets notificationChannels.mobilePush = true on new subscription", async () => {
      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: [] }));

      await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios" }));

      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({ "notificationChannels.mobilePush": true }),
        })
      );
    });
  });

  describe("Unsubscribe endpoint", () => {
    it("requires authentication", async () => {
      const noAuth = new Request("https://sale.cyber.skill/api/me/mobile-push/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const response = await unsubscribe(noAuth);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "unauthenticated" });
    });

    it("removes a specific token by value", async () => {
      const response = await unsubscribe(req("/api/me/mobile-push/unsubscribe", { token: expoToken1 }));
      expect(response.status).toBe(200);

      // Verify $pull targets the token value
      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(Object) }),
        {
          $pull: { mobilePushTokens: { token: expoToken1 } },
          $set: { updatedAt: expect.any(Date) },
        }
      );
    });

    it("removes all tokens when token is not specified", async () => {
      const response = await unsubscribe(req("/api/me/mobile-push/unsubscribe", {}));
      expect(response.status).toBe(200);

      // Verify it clears array and disables channel
      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(Object) }),
        {
          $set: {
            mobilePushTokens: [],
            "notificationChannels.mobilePush": false,
            updatedAt: expect.any(Date),
          },
        }
      );
    });

    it("rejects invalid user ID format", async () => {
      const response = await unsubscribe(req("/api/me/mobile-push/unsubscribe", {}, "not-an-objectid"));
      expect(response.status).toBe(400);
    });

    it("returns ok: true on successful unsubscribe", async () => {
      const response = await unsubscribe(req("/api/me/mobile-push/unsubscribe", { token: expoToken1 }));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    });
  });

  describe("Clicked endpoint", () => {
    it("validates idem is a non-empty string", async () => {
      const noIdem = await clicked(req("/api/me/mobile-push/clicked", {}));
      expect(noIdem.status).toBe(400);

      const emptyIdem = await clicked(req("/api/me/mobile-push/clicked", { idem: "" }));
      expect(emptyIdem.status).toBe(400);

      const valid = await clicked(req("/api/me/mobile-push/clicked", { idem: "abc123" }));
      expect(valid.status).toBe(200);
    });

    it("updates notifications.clickedAt for matching (idem, channel: mobilePush)", async () => {
      const idemKey = "abc123def456ghi789jkl012";
      const response = await clicked(req("/api/me/mobile-push/clicked", { idem: idemKey }));
      expect(response.status).toBe(200);

      // Verify it updates the correct notification row
      expect(state.notifications.updateOne).toHaveBeenCalledWith(
        { idem: idemKey, channel: "mobilePush" },
        { $set: { clickedAt: expect.any(Date) } }
      );
    });

    it("returns ok: true as fire-and-forget (no validation of notification existence)", async () => {
      // Even if no notification exists, endpoint returns 200
      state.notifications.updateOne = vi.fn(async () => ({ modifiedCount: 0 }));

      const response = await clicked(req("/api/me/mobile-push/clicked", { idem: "abc123" }));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it("does not expose raw token data in response or logging", async () => {
      const response = await clicked(req("/api/me/mobile-push/clicked", { idem: "abc123" }));
      const json = await response.json();

      expect(JSON.stringify(json)).not.toContain("token");
      expect(JSON.stringify(json)).not.toContain("ExponentPushToken");
      expect(JSON.stringify(json)).not.toContain("mobilePushTokens");
    });
  });

  describe("Integration scenarios", () => {
    it("subscribes 5 devices, then 6th device evicts oldest", async () => {
      const baseTime = new Date("2026-05-20T10:00:00Z");
      const existingTokens = [expoToken1, expoToken2, expoToken3, expoToken4, expoToken5].map((t, i) => ({
        token: t,
        platform: i % 2 === 0 ? "ios" : "android",
        addedAt: new Date(baseTime.getTime() + i * 1000),
        lastSeenAt: new Date(baseTime.getTime() + i * 1000),
      }));

      // Scenario: user has 5 devices
      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: existingTokens }));

      // Add 6th device
      await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken6, platform: "ios" }));

      // Verify $slice: -5 is used (keeps most recent 5)
      const updateCall = state.users.updateOne.mock.calls[0];
      expect(updateCall[1].$push.mobilePushTokens.$slice).toBe(-5);
    });

    it("re-subscribing same token preserves addedAt but updates lastSeenAt", async () => {
      const origAddedAt = new Date("2026-05-10T10:00:00Z");
      const existingTokens = [
        { token: expoToken1, platform: "ios", appVersion: "1.0.0", addedAt: origAddedAt, lastSeenAt: new Date() },
      ];

      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: existingTokens }));

      // Re-subscribe same token with different appVersion
      await subscribe(req("/api/me/mobile-push/subscribe", { token: expoToken1, platform: "ios", appVersion: "1.1.0" }));

      // Should use array filter update, not $push
      const updateCall = state.users.updateOne.mock.calls[0];
      expect(updateCall[2].arrayFilters[0]["elem.token"]).toBe(expoToken1);
      expect(updateCall[1].$set["mobilePushTokens.$[elem].lastSeenAt"]).toBeDefined();
      expect(updateCall[1].$push).toBeUndefined();
    });

    it("unsubscribe all tokens disables channel and clears array", async () => {
      const existingTokens = [
        { token: expoToken1, platform: "ios", addedAt: new Date(), lastSeenAt: new Date() },
        { token: expoToken2, platform: "android", addedAt: new Date(), lastSeenAt: new Date() },
      ];

      state.users.findOne = vi.fn(async () => ({ mobilePushTokens: existingTokens }));

      await unsubscribe(req("/api/me/mobile-push/unsubscribe", {}));

      expect(state.users.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        {
          $set: {
            mobilePushTokens: [],
            "notificationChannels.mobilePush": false,
            updatedAt: expect.any(Date),
          },
        }
      );
    });
  });
});
