import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFFILIATE_DISCLOSURE_KIND,
  PRIVACY_CONSENT_KIND,
  buildConsentRecord,
  defaultSignInConsents,
  recordDisclosureConsent,
} from "../disclosure-consent";

const dbMock = vi.hoisted(() => ({
  matchedCount: 1,
  updateOne: vi.fn(),
}));

vi.mock("@/server/db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name !== "users") throw new Error(`Unexpected collection ${name}`);
        return {
          updateOne: dbMock.updateOne,
        };
      },
    }),
  },
}));

beforeEach(() => {
  process.env.PII_HASH_SALT = "consent-salt";
  dbMock.matchedCount = 1;
  dbMock.updateOne.mockReset();
  dbMock.updateOne.mockImplementation(async () => ({ matchedCount: dbMock.matchedCount }));
});

describe("FR-LEGAL-002 — disclosure consent records", () => {
  it("builds hashed consent records without raw IP or UA", () => {
    const record = buildConsentRecord({
      kind: AFFILIATE_DISCLOSURE_KIND,
      ip: "203.0.113.10",
      userAgent: "UnitTest/1.0",
      grantedAt: new Date("2026-05-18T00:00:00.000Z"),
    });

    expect(record.kind).toBe("affiliate_disclosure_v1");
    expect(record.version).toBe("v1");
    expect(record.ip_hash).toMatch(/^[0-9a-f]{24}$/);
    expect(record.ua_hash).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(record)).not.toContain("203.0.113.10");
    expect(JSON.stringify(record)).not.toContain("UnitTest");
  });

  it("new sign-ins carry privacy and affiliate disclosure consents", () => {
    const records = defaultSignInConsents(new Date("2026-05-18T00:00:00.000Z"));

    expect(records.map((record) => record.kind)).toEqual([PRIVACY_CONSENT_KIND, AFFILIATE_DISCLOSURE_KIND]);
  });

  it("defaults unknown consent signals and API source without leaking raw values", () => {
    const record = buildConsentRecord({ kind: PRIVACY_CONSENT_KIND });

    expect(record.kind).toBe("privacy_v1");
    expect(record.version).toBe("v1");
    expect(record.source).toBe("api");
    expect(record.ip_hash).toMatch(/^[0-9a-f]{24}$/);
    expect(record.ua_hash).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(record)).not.toContain("unknown");
  });

  it("falls back to AUTH_SECRET when the dedicated PII salt is absent", () => {
    delete process.env.PII_HASH_SALT;
    process.env.AUTH_SECRET = "auth-secret-for-consent";

    const record = buildConsentRecord({ kind: AFFILIATE_DISCLOSURE_KIND, ip: "203.0.113.40", userAgent: "Vitest" });

    expect(record.ip_hash).toMatch(/^[0-9a-f]{24}$/);
    expect(record.ua_hash).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(record)).not.toContain("203.0.113.40");
  });

  it("replaces prior consent before appending the latest version for ObjectId users", async () => {
    const userId = new ObjectId().toHexString();

    await expect(
      recordDisclosureConsent({
        userId,
        kind: AFFILIATE_DISCLOSURE_KIND,
        ip: "203.0.113.20",
        userAgent: "Vitest/1.0",
        source: "extension",
      }),
    ).resolves.toBe(true);

    expect(dbMock.updateOne).toHaveBeenCalledTimes(2);
    expect(dbMock.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: expect.any(ObjectId) },
      { $pull: { consents: { kind: AFFILIATE_DISCLOSURE_KIND } } },
    );
    expect(dbMock.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: expect.any(ObjectId) },
      {
        $push: {
          consents: expect.objectContaining({
            kind: AFFILIATE_DISCLOSURE_KIND,
            version: "v1",
            source: "extension",
          }),
        },
      },
    );
  });

  it("supports string user ids and returns false when the user does not exist", async () => {
    dbMock.matchedCount = 0;

    await expect(
      recordDisclosureConsent({
        userId: "external-user-id",
        kind: PRIVACY_CONSENT_KIND,
        ip: "203.0.113.21",
        userAgent: "Vitest/1.0",
      }),
    ).resolves.toBe(false);

    expect(dbMock.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: "external-user-id" },
      { $pull: { consents: { kind: PRIVACY_CONSENT_KIND } } },
    );
  });
});
