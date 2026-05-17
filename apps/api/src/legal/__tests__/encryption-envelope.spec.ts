import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envelopeDecrypt, envelopeEncrypt, piiHash } from "../encryption-envelope";

const OLD_ENV = { ...process.env };

describe("FR-LEGAL-001 — encryption envelope", () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = "a".repeat(64);
    process.env.DATA_ENCRYPTION_KEY_ID = "test-kek-v1";
    process.env.PII_HASH_SALT = "test-pii-salt";
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("round-trips AES-256-GCM ciphertext without storing plaintext", () => {
    const envelope = envelopeEncrypt("lead@example.com", "b2b_leads.email");

    expect(envelope.alg).toBe("AES-256-GCM");
    expect(envelope.kid).toBe("test-kek-v1");
    expect(JSON.stringify(envelope)).not.toContain("lead@example.com");
    expect(envelopeDecrypt(envelope, "b2b_leads.email")).toBe("lead@example.com");
  });

  it("binds ciphertext to associated data", () => {
    const envelope = envelopeEncrypt("0901234567", "b2b_leads.phone");

    expect(() => envelopeDecrypt(envelope, "wrong-field")).toThrow();
  });

  it("hashes PII deterministically by purpose", () => {
    expect(piiHash("Lead@Example.com", "email")).toBe(piiHash("lead@example.com", "email"));
    expect(piiHash("lead@example.com", "email")).not.toBe(piiHash("lead@example.com", "phone"));
  });
});
