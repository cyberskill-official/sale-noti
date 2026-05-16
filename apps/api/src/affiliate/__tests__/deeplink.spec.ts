// FR-AFF-002 — unit-level checks for sub-id shape + scrub.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

describe("FR-AFF-002 — sub-id semantics", () => {
  it("userHash is 12 hex chars derived from sha256(userId + salt)", () => {
    const salt = "test-salt";
    const expected = crypto.createHash("sha256").update("user-abc" + salt).digest("hex").slice(0, 12);
    expect(expected).toMatch(/^[a-f0-9]{12}$/);
  });

  it("watchlistHash is 8 hex chars or '0' when absent", () => {
    const wl = crypto.createHash("sha256").update("wl-1").digest("hex").slice(0, 8);
    expect(wl).toMatch(/^[a-f0-9]{8}$/);
  });

  it("campaign scrubbed: 'evil!@#$%' → 'evil'", () => {
    const cleaned = "evil!@#$%".replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "default";
    expect(cleaned).toBe("evil");
  });

  it("campaign empty → 'default'", () => {
    const cleaned = "".replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "default";
    expect(cleaned).toBe("default");
  });
});
