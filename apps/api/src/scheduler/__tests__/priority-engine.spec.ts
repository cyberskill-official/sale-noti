import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  watchlists: [] as any[],
  product: null as any,
  megaSale: null as any,
  user: null as any,
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "watchlists") {
          return { find: () => ({ toArray: async () => state.watchlists }) };
        }
        if (name === "products") {
          return { findOne: async () => state.product };
        }
        if (name === "mega_sales") {
          return { findOne: async () => state.megaSale };
        }
        if (name === "users") {
          return {
            find: () => ({
              sort: () => ({
                limit: () => ({
                  next: async () => state.user,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

describe("FR-WORKER-002 — priority engine", () => {
  beforeEach(() => {
    state.watchlists = [];
    state.product = null;
    state.megaSale = null;
    state.user = null;
  });

  it("marks flash-sale watchlists as hot", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [
      {
        userId: new ObjectId("665000000000000000000001"),
        status: "active",
        alertConfig: { triggers: [{ kind: "flash_sale", paused: false }] },
      },
    ];

    await expect(reevaluateTier("1-2")).resolves.toBe("hot");
  });

  it("marks products with no watchlist as low", async () => {
    const { reevaluateTier } = await import("../priority-engine");

    await expect(reevaluateTier("1-2")).resolves.toBe("low");
  });

  it("marks all-paused products as low", async () => {
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [{ status: "paused", alertConfig: { triggers: [] } }];

    await expect(reevaluateTier("1-2")).resolves.toBe("low");
  });

  it("downgrades products that are cooling down after repeated API failures", async () => {
    const { reevaluateTier } = await import("../priority-engine");
    state.product = { cooldownUntil: new Date("2026-05-18T01:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("low");
  });

  it("honors a non-expired admin force-tier override", async () => {
    const { reevaluateTier } = await import("../priority-engine");
    state.product = {
      priorityOverride: {
        tier: "hot",
        expiresAt: new Date("2026-05-19T00:00:00.000Z"),
      },
    };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("hot");
  });

  it("marks recently alerted products and active mega-sale windows as hot", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [
      { userId: new ObjectId("665000000000000000000001"), status: "active", alertConfig: { triggers: [] } },
    ];
    state.product = { lastAlertAt: new Date("2026-05-17T00:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("hot");

    state.product = {};
    state.megaSale = { status: "active" };
    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("hot");
  });

  it("keeps active recently-used products in mid", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [
      { userId: new ObjectId("665000000000000000000001"), status: "active", alertConfig: { triggers: [] } },
    ];
    state.user = { lastActiveAt: new Date("2026-05-17T00:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("mid");
  });

  it("downgrades stale active products to low", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [
      { userId: new ObjectId("665000000000000000000001"), status: "active", alertConfig: { triggers: [] } },
    ];
    state.user = { lastActiveAt: new Date("2026-03-01T00:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("low");
  });

  it("falls back through updatedAt and createdAt when lastActiveAt is unavailable", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [
      { userId: new ObjectId("665000000000000000000001"), status: "active", alertConfig: { triggers: [] } },
    ];
    state.user = { updatedAt: new Date("2026-05-16T00:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("mid");

    state.user = { createdAt: new Date("2026-05-16T00:00:00.000Z") };
    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("mid");
  });

  it("keeps active watchlists without ObjectId owners in mid until cleanup", async () => {
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [{ userId: "legacy-user-id", status: "active", alertConfig: { triggers: [] } }];

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("mid");
  });
});
