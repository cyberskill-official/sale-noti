import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { signLazadaRequest } from "../sign";

describe("FR-AFF-005 — signLazadaRequest", () => {
  it("creates a deterministic Lazada signature envelope", () => {
    const signed = signLazadaRequest("payload-x", "appid123", "secret456", 1_700_000_000_000);
    const expected = crypto.createHash("sha256").update(`appid123:${signed.timestamp}:payload-x:secret456`).digest("hex");

    expect(signed.timestamp).toBe(1_700_000_000);
    expect(signed.signature).toBe(expected);
    expect(signed.header).toBe(`LZSHA256 Credential=appid123, Signature=${expected}, Timestamp=${signed.timestamp}`);
  });
});
