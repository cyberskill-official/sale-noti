import { beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../../../next.config.mjs";
import { POST as subscribe } from "./subscribe/route";
import { POST as unsubscribe } from "./unsubscribe/route";
import { POST as clicked } from "./clicked/route";

const state = vi.hoisted(() => ({
  rateLimitFixed: vi.fn(),
  posthogCapture: vi.fn(),
  users: { updateOne: vi.fn(), findOne: vi.fn() },
  notifications: { updateOne: vi.fn() },
}));

vi.mock("@/server/auth/rate-limit", () => ({
  rateLimitFixed: (...args: unknown[]) => state.rateLimitFixed(...args),
}));

vi.mock("@/server/obs/posthog.server", () => ({
  posthogServer: { capture: (...args: unknown[]) => state.posthogCapture(...args) },
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

describe("FR-NOTIF-002 — web push routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.rateLimitFixed = vi.fn(async () => ({ ok: true, used: 1 }));
    state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.users.findOne = vi.fn(async () => ({ pushSubscriptions: [{ endpoint: "https://x/1" }, { endpoint: "https://x/2" }] }));
    state.notifications.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.posthogCapture = vi.fn();
  });

  it("subscribes with validation, rate limit, FIFO write shape, and no-store service-worker header", async () => {
    const response = await subscribe(
      req("/api/me/push/subscribe", {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "p", auth: "a" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deviceCount: 2 });
    expect(state.rateLimitFixed).toHaveBeenCalledWith("push:subscribe:665000000000000000000021", 5, 60);
    expect(state.users.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $push: {
          pushSubscriptions: expect.objectContaining({
            $slice: -5,
          }),
        },
        $set: expect.objectContaining({ "notificationChannels.webPush": true }),
      }),
    );

    const headersFn = nextConfig.headers!;
    const headers = await headersFn();
    expect(headers[0]).toEqual({
      source: "/service-worker.js",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    });
  });

  it("rejects subscribe auth, malformed payloads, invalid ids, and the 6th call/min", async () => {
    const unauth = await subscribe(new Request("https://sale.cyber.skill/api/me/push/subscribe", { method: "POST", body: "{}" }));
    expect(unauth.status).toBe(401);

    const malformed = await subscribe(req("/api/me/push/subscribe", { endpoint: "x", keys: {} }));
    expect(malformed.status).toBe(400);

    const invalidUser = await subscribe(req("/api/me/push/subscribe", { endpoint: "https://x.test/a", keys: { p256dh: "p", auth: "a" } }, "bad-user"));
    expect(invalidUser.status).toBe(400);

    state.rateLimitFixed.mockResolvedValueOnce({ ok: false, used: 6 });
    const limited = await subscribe(req("/api/me/push/subscribe", { endpoint: "https://x.test/a", keys: { p256dh: "p", auth: "a" } }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });

  it("unsubscribes one endpoint or all endpoints and flips channel off when empty", async () => {
    const unauth = await unsubscribe(new Request("https://sale.cyber.skill/api/me/push/unsubscribe", { method: "POST", body: "{}" }));
    expect(unauth.status).toBe(401);
    const malformed = await unsubscribe(req("/api/me/push/unsubscribe", { endpoint: "bad-url" }));
    expect(malformed.status).toBe(400);
    const invalidUser = await unsubscribe(req("/api/me/push/unsubscribe", {}, "bad-user"));
    expect(invalidUser.status).toBe(400);

    state.users.findOne.mockResolvedValueOnce({ pushSubscriptions: [{ endpoint: "https://x/other" }] });
    const nonEmpty = await unsubscribe(req("/api/me/push/unsubscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/still" }));
    expect(nonEmpty.status).toBe(200);
    expect(state.users.updateOne).not.toHaveBeenCalledWith(expect.any(Object), { $set: { "notificationChannels.webPush": false } });

    state.users.findOne.mockResolvedValueOnce({ pushSubscriptions: [] });
    const one = await unsubscribe(req("/api/me/push/unsubscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc" }));
    expect(one.status).toBe(200);
    expect(state.users.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { "notificationChannels.webPush": false } },
    );

    const all = await unsubscribe(req("/api/me/push/unsubscribe", {}));
    expect(all.status).toBe(200);
    expect(state.users.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { pushSubscriptions: [], "notificationChannels.webPush": false } },
    );
  });

  it("records push click attribution without raw endpoint data", async () => {
    const bad = await clicked(req("/api/me/push/clicked", { idem: "short" }));
    expect(bad.status).toBe(400);

    const response = await clicked(req("/api/me/push/clicked", { idem: "abcdef1234567890" }));

    expect(response.status).toBe(200);
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { idem: "abcdef1234567890", channel: "webPush", clickedAt: null },
      { $set: { clickedAt: expect.any(Date) } },
    );
    expect(state.posthogCapture).toHaveBeenCalledWith("push_clicked", "ef1234567890", { idem_tail: "ef1234567890" });
    expect(JSON.stringify(state.posthogCapture.mock.calls)).not.toContain("fcm.googleapis.com");
  });
});
