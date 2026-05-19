import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { forceTierOverride, isSchedulerTier, productFilterFromId, SCHEDULER_OVERRIDE_TTL_MS } from "../admin-overrides";

describe("FR-WORKER-002 — scheduler admin overrides", () => {
  it("builds the composite product filter used by scheduler force-tier", () => {
    expect(productFilterFromId("123-456")).toEqual({ shopId: 123, itemId: 456 });
    const objectId = "665000000000000000000001";
    expect(productFilterFromId(objectId)).toEqual({ _id: new ObjectId(objectId) });
    expect(productFilterFromId("sku-vn-local")).toEqual({ productId: "sku-vn-local" });
    expect(isSchedulerTier("mid")).toBe(true);
    expect(isSchedulerTier("urgent")).toBe(false);
  });

  it("forces a product tier and auto-expires the override after 24h", async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const db = { collection: vi.fn(() => ({ updateOne })) } as any;
    const now = new Date("2026-05-18T00:00:00.000Z");

    const result = await forceTierOverride("123-456", "hot", { now, db, reason: "megasale-smoke-test" });

    expect(result).toEqual({
      matched: true,
      modified: true,
      expiresAt: new Date(now.getTime() + SCHEDULER_OVERRIDE_TTL_MS),
    });
    expect(updateOne).toHaveBeenCalledWith(
      { shopId: 123, itemId: 456 },
      expect.objectContaining({
        $set: expect.objectContaining({
          trackPriority: "hot",
          priorityOverride: expect.objectContaining({
            tier: "hot",
            forcedAt: now,
            expiresAt: result.expiresAt,
            reason: "megasale-smoke-test",
          }),
        }),
        $unset: { cooldownUntil: "" },
      }),
    );
  });

  it("uses default reason, supports explicit expiry, and surfaces unmatched products", async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    const db = { collection: vi.fn(() => ({ updateOne })) } as any;
    const now = new Date("2026-05-18T00:00:00.000Z");
    const expiresAt = new Date("2026-05-18T06:00:00.000Z");

    const result = await forceTierOverride("sku-vn-local", "low", { now, expiresAt, db });

    expect(result).toEqual({ matched: false, modified: false, expiresAt });
    expect(updateOne).toHaveBeenCalledWith(
      { productId: "sku-vn-local" },
      expect.objectContaining({
        $set: expect.objectContaining({
          priorityOverride: expect.objectContaining({ reason: "admin_force_tier", expiresAt }),
        }),
      }),
    );
  });

  it("rejects malformed tier values before mutating data", async () => {
    const updateOne = vi.fn();
    const db = { collection: vi.fn(() => ({ updateOne })) } as any;

    await expect(forceTierOverride("123-456", "urgent" as any, { db })).rejects.toThrow(
      "invalid scheduler tier: urgent",
    );
    expect(updateOne).not.toHaveBeenCalled();
  });
});
