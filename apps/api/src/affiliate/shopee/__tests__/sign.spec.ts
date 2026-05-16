// FR-AFF-001 AC2 — signature reference test.
import { describe, it, expect } from "vitest";
import { signRequest } from "../sign";
import crypto from "node:crypto";

describe("FR-AFF-001 — signRequest", () => {
  it("AC2: signature matches sha256(app_id || timestamp || payload || app_secret) lowercase hex", () => {
    const { signature, timestamp, header } = signRequest("payload-x", "appid123", "secret456", 1_700_000_000_000);
    const expected = crypto.createHash("sha256").update(`appid123${timestamp}payload-x` + "secret456").digest("hex");
    expect(signature).toBe(expected);
    expect(header).toBe(`SHA256 Credential=appid123, Signature=${expected}, Timestamp=${timestamp}`);
  });

  it("timestamp is unix seconds", () => {
    const { timestamp } = signRequest("p", "a", "b", 1_700_000_000_000);
    expect(timestamp).toBe(1_700_000_000);
  });
});
