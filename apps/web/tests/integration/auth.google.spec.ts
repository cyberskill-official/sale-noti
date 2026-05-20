// FR-AUTH-001 §5 — integration tests with an in-memory Mongo-compatible collection.
// This keeps CI/sandbox validation credential-free while exercising the real upsert service.
import { beforeEach, describe, expect, it, vi } from "vitest";

type OAuthProvider = { provider: "google"; providerAccountId: string };
type UserDoc = {
  _id: string;
  email: string;
  oauthProviders: OAuthProvider[];
  plan: "free";
  notificationChannels: { email: boolean; webPush: boolean; telegram: boolean };
  passwordHash: null;
  consents: unknown[];
  createdAt: Date;
  updatedAt: Date;
};

type UserUpdate = {
  $setOnInsert?: Partial<UserDoc>;
  $set?: Partial<UserDoc>;
  $addToSet?: { oauthProviders?: OAuthProvider };
};

const dbMock = vi.hoisted(() => ({
  users: new Map<string, UserDoc>(),
  nextId: 0,
  failNext: null as null | "return-null" | "throw",
}));

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));

function cloneUser(doc: UserDoc | null): UserDoc | null {
  if (!doc) return null;
  return {
    ...doc,
    oauthProviders: doc.oauthProviders.map((provider) => ({ ...provider })),
    consents: [...doc.consents],
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

const usersCollection = {
  async findOneAndUpdate(filter: { email: string }, update: UserUpdate, options: { upsert?: boolean }) {
    if (dbMock.failNext === "return-null") {
      dbMock.failNext = null;
      return null;
    }
    if (dbMock.failNext === "throw") {
      dbMock.failNext = null;
      throw new Error("mock mongo unavailable");
    }

    let doc = dbMock.users.get(filter.email) ?? null;
    if (!doc && options.upsert) {
      const inserted = update.$setOnInsert ?? {};
      doc = {
        _id: `mock-user-${++dbMock.nextId}`,
        email: filter.email,
        oauthProviders: [],
        plan: "free",
        notificationChannels: { email: true, webPush: false, telegram: false },
        passwordHash: null,
        consents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...inserted,
      };
      dbMock.users.set(filter.email, doc);
    }

    if (!doc) return null;
    Object.assign(doc, update.$set ?? {});

    const provider = update.$addToSet?.oauthProviders;
    if (provider && !doc.oauthProviders.some((item) => JSON.stringify(item) === JSON.stringify(provider))) {
      doc.oauthProviders.push({ ...provider });
    }

    return cloneUser(doc);
  },
  async findOne(filter: { email: string }) {
    return cloneUser(dbMock.users.get(filter.email) ?? null);
  },
};

vi.mock("@/server/db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name !== "users") throw new Error(`Unexpected collection ${name}`);
        return usersCollection;
      },
    }),
    close: vi.fn(),
  },
}));

vi.mock("@/server/obs/sentry.server", () => ({ sentry }));

import { upsertUserOnSignIn } from "@/server/users/upsert-on-signin";
import { mongo } from "@/server/db/mongo";

const TEST_DB = "salenoti";

beforeEach(() => {
  dbMock.users.clear();
  dbMock.failNext = null;
  sentry.captureException.mockReset();
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
      expect.arrayContaining([{ provider: "google", providerAccountId: "google-sub-001" }]),
    );
    expect(row?.consents.map((consent: any) => consent.kind)).toEqual(
      expect.arrayContaining(["privacy_v1", "affiliate_disclosure_v1"]),
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

  it("AC5: null Mongo response → fail-closed with db_error", async () => {
    dbMock.failNext = "return-null";

    const r = await upsertUserOnSignIn({
      sub: "google-sub-005",
      email: `salenoti-test-${Date.now()}@example.com`,
      email_verified: true,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("db_error");
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("AC5: Mongo exception → fail-closed and captures Sentry evidence", async () => {
    dbMock.failNext = "throw";

    const r = await upsertUserOnSignIn({
      sub: "google-sub-006",
      email: `salenoti-test-${Date.now()}@example.com`,
      email_verified: true,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("db_error");
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ fr: "FR-AUTH-001" }) }),
    );
  });

  it("AC: multiple Google sub for same email → $addToSet keeps both", async () => {
    const email = `salenoti-test-${Date.now()}@example.com`;
    await upsertUserOnSignIn({ sub: "sub-a", email, email_verified: true });
    await upsertUserOnSignIn({ sub: "sub-b", email, email_verified: true });
    const row = await mongo.db(TEST_DB).collection("users").findOne({ email });
    expect(row?.oauthProviders).toHaveLength(2);
  });
});
