import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTikTokShopHeaders } from "../sign";

describe("FR-AFF-006 — buildTikTokShopHeaders", () => {
  it("creates a deterministic signature envelope", () => {
    const signed = buildTikTokShopHeaders("payload-x", "appid123", "secret456", "token789", 1_700_000_000_000);
    const expected = crypto.createHash("sha256").update(`appid123:${signed.timestamp}:payload-x:token789:secret456`).digest("hex");

    expect(signed.timestamp).toBe(1_700_000_000);
    expect(signed.signature).toBe(expected);
    expect(signed.headers.Authorization).toContain("Credential=appid123");
    expect(signed.headers["X-TikTok-Shop-Access-Token"]).toBe("token789");
    expect(signed.headers["X-TikTok-Shop-Timestamp"]).toBe(String(signed.timestamp));
  });
});
