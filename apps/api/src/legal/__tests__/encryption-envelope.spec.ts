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

  it("supports non-hex key material through sha256-derived local key fallback", () => {
    process.env.DATA_ENCRYPTION_KEY = "not-hex-but-long-enough-for-local-tests";
    delete process.env.DATA_ENCRYPTION_KEY_ID;

    const envelope = envelopeEncrypt("fallback@example.com", "fallback");

    expect(envelope.kid).toBe("local-v1");
    expect(envelopeDecrypt(envelope, "fallback")).toBe("fallback@example.com");
  });

  it("falls back from DATA_ENCRYPTION_KEY to AUTH_SECRET and then local dev material", () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    process.env.AUTH_SECRET = "auth-secret-for-envelope-fallback";
    const authEnvelope = envelopeEncrypt("auth-secret@example.com", "fallback");
    expect(envelopeDecrypt(authEnvelope, "fallback")).toBe("auth-secret@example.com");

    delete process.env.AUTH_SECRET;
    const localEnvelope = envelopeEncrypt("local@example.com", "fallback");
    expect(envelopeDecrypt(localEnvelope, "fallback")).toBe("local@example.com");
  });

  it("rejects unsupported envelope versions and algorithms", () => {
    const envelope = envelopeEncrypt("lead@example.com", "b2b_leads.email");

    expect(() =>
      envelopeDecrypt({ ...envelope, v: 2 as 1 }, "b2b_leads.email")
    ).toThrow("unsupported_envelope");
    expect(() =>
      envelopeDecrypt({ ...envelope, alg: "AES-128-GCM" as "AES-256-GCM" }, "b2b_leads.email")
    ).toThrow("unsupported_envelope");
  });

  it("hashes PII deterministically by purpose", () => {
    expect(piiHash("Lead@Example.com", "email")).toBe(piiHash("lead@example.com", "email"));
    expect(piiHash("lead@example.com", "email")).not.toBe(piiHash("lead@example.com", "phone"));
  });

  it("falls back to PostHog salt for PII hashes when dedicated salt is absent", () => {
    delete process.env.PII_HASH_SALT;
    process.env.POSTHOG_PII_SALT = "posthog-salt";

    expect(piiHash("lead@example.com", "email")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to a local salt when no PII salts are configured", () => {
    delete process.env.PII_HASH_SALT;
    delete process.env.POSTHOG_PII_SALT;

    expect(piiHash("lead@example.com", "email")).toMatch(/^[0-9a-f]{64}$/);
  });
});
