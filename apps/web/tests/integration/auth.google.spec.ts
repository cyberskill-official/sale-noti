// FR-AUTH-001 §5 — integration tests.
// Run: `pnpm --filter @salenoti/web test:integration`
// Requires: local Atlas-compatible Mongo (or `mongodb-memory-server`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUserOnSignIn } from "@/server/users/upsert-on-signin";
import { mongo } from "@/server/db/mongo";

const TEST_DB = "salenoti";

beforeAll(async () => {
  // Sanity check — bail early if Mongo isn't reachable
  await mongo.db(TEST_DB).command({ ping: 1 });
});

afterAll(async () => {
  // Best-effort cleanup of test users
  await mongo
    .db(TEST_DB)
    .collection("users")
    .deleteMany({ email: { $regex: /^salenoti-test-/ } });
  await mongo.close();
});

describe("FR-AUTH-001 — upsertUserOnSignIn", () => {
  it("AC1: fresh user → row created with plan=free", async () => {
    const email = `salenoti-test-${Date.now()}@example.com`;
    const r = await upsertUserOnSignIn({
      sub: "google-sub-001",
      email,
      email_verified: true,
      name: "Test User",
    });
    expect(r.ok).toBe(true);
    const row = await mongo.db(TEST_DB).collection("users").findOne({ email });
    expect(row?.plan).toBe("free");
    expect(row?.notificationChannels).toEqual({ email: true, webPush: false, telegram: false });
    expect(row?.oauthProviders).toEqual(
      expect.arrayContaining([{ provider: "google", providerAccountId: "google-sub-001" }])
    );
  });

  it("AC2: returning user → updatedAt bumps; no duplicate row", async () => {
    const email = `salenoti-test-${Date.now()}@example.com`;
    await upsertUserOnSignIn({ sub: "google-sub-002", email, email_verified: true });
    const first = await mongo.db(TEST_DB).collection("users").findOne({ email });
    await new Promise((r) => setTimeout(r, 10));
    await upsertUserOnSignIn({ sub: "google-sub-002", email, email_verified: true });
    const second = await mongo.db(TEST_DB).collection("users").findOne({ email });
    expect(String(second?._id)).toBe(String(first?._id));
    expect(second?.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
  });

  it("AC5: unverified email → fail-closed", async () => {
    const r = await upsertUserOnSignIn({
      sub: "google-sub-003",
      email: `salenoti-test-${Date.now()}@example.com`,
      email_verified: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unverified_email");
  });

  it("AC5: missing email → fail-closed", async () => {
    const r = await upsertUserOnSignIn({ sub: "google-sub-004", email: "", email_verified: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_email");
  });

  it("AC: multiple Google sub for same email → $addToSet keeps both", async () => {
    const email = `salenoti-test-${Date.now()}@example.com`;
    await upsertUserOnSignIn({ sub: "sub-a", email, email_verified: true });
    await upsertUserOnSignIn({ sub: "sub-b", email, email_verified: true });
    const row = await mongo.db(TEST_DB).collection("users").findOne({ email });
    expect(row?.oauthProviders).toHaveLength(2);
  });
});
