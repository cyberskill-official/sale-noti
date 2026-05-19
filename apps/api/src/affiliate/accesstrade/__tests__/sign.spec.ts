import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAccessTradeHeaders } from "../sign";

describe("FR-AFF-007 — buildAccessTradeHeaders", () => {
  it("builds a Token auth envelope", () => {
    const headers = buildAccessTradeHeaders("access-key-123");

    expect(headers.headers.Authorization).toBe("Token access-key-123");
    expect(headers.headers["Content-Type"]).toBe("application/json");
    expect(Object.keys(headers.headers)).toEqual(["Authorization", "Content-Type"]);
    expect(crypto.createHash("sha256").update("noop").digest("hex")).toMatch(/^[a-f0-9]{64}$/);
  });
});
