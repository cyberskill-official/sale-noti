import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unsubscribeToken } from "../idempotency";
import { UnsubscribeController } from "../unsubscribe.controller";

const state = vi.hoisted(() => ({
  users: { updateOne: vi.fn() },
  watchlists: { updateOne: vi.fn() },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "users") return state.users;
        if (name === "watchlists") return state.watchlists;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

describe("FR-NOTIF-001 — one-click unsubscribe", () => {
  beforeEach(() => {
    process.env.UNSUB_SALT = "unsub-salt";
    state.users.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.watchlists.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
  });

  it("pauses email for one watchlist when the deterministic token is valid", async () => {
    const userId = "665000000000000000000001";
    const watchlistId = "665000000000000000000002";
    const posthog = { capture: vi.fn() };
    const controller = new UnsubscribeController(posthog);

    await expect(controller.unsubscribe(userId, unsubscribeToken(userId, watchlistId), watchlistId)).resolves.toEqual({ ok: true });

    expect(state.watchlists.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(watchlistId), userId: new ObjectId(userId) },
      {
        $pull: { "alertConfig.channels": "email" },
        $set: { emailUnsubscribedAt: expect.any(Date) },
      },
    );
    expect(posthog.capture).toHaveBeenCalledWith("notification_unsubscribed", { scope: "watchlist", channel: "email" });
  });

  it("disables the whole email channel and rejects invalid tokens", async () => {
    const posthog = { capture: vi.fn() };
    const controller = new UnsubscribeController(posthog);

    await expect(controller.unsubscribe("legacy-user", unsubscribeToken("legacy-user", null))).resolves.toEqual({ ok: true });
    expect(state.users.updateOne).toHaveBeenCalledWith(
      { _id: "legacy-user" },
      { $set: { "notificationChannels.email": false } },
    );

    await expect(controller.unsubscribe("legacy-user", "bad-token")).rejects.toMatchObject({ status: 401 });
  });
});
