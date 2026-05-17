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

  it("marks all-paused products as low", async () => {
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [{ status: "paused", alertConfig: { triggers: [] } }];

    await expect(reevaluateTier("1-2")).resolves.toBe("low");
  });

  it("keeps active recently-used products in mid", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [{ userId: new ObjectId("665000000000000000000001"), status: "active", alertConfig: { triggers: [] } }];
    state.user = { lastActiveAt: new Date("2026-05-17T00:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("mid");
  });

  it("downgrades stale active products to low", async () => {
    const { ObjectId } = await import("mongodb");
    const { reevaluateTier } = await import("../priority-engine");
    state.watchlists = [{ userId: new ObjectId("665000000000000000000001"), status: "active", alertConfig: { triggers: [] } }];
    state.user = { lastActiveAt: new Date("2026-03-01T00:00:00.000Z") };

    await expect(reevaluateTier("1-2", new Date("2026-05-18T00:00:00.000Z"))).resolves.toBe("low");
  });
});
