// FR-AUTH-002 — credential-free integration tests for magic-link issue/consume.
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type OAuthProvider = { provider: "google" | "magic-link"; providerAccountId: string };
type TokenDoc = {
  _id: string;
  tokenHash: string;
  email: string;
  expiresAt: Date;
  consumed: boolean;
  consumedAt: Date | null;
  createdAt: Date;
  ip: string;
  userAgent: string;
};
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
type RefreshDoc = Record<string, unknown>;
type ResendArgs = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  tags?: Array<{ name: string; value: string }>;
};

type UserUpdate = {
  $setOnInsert?: Partial<UserDoc>;
  $set?: Partial<UserDoc>;
  $addToSet?: { oauthProviders?: OAuthProvider };
};

declare global {
  var __salenotiRateLimit: Map<string, { count: number; expiresAt: number }> | undefined;
}

const dbMock = vi.hoisted(() => ({
  tokens: [] as TokenDoc[],
  users: new Map<string, UserDoc>(),
  refreshTokens: [] as RefreshDoc[],
  resendCalls: [] as ResendArgs[],
  failUserUpsert: false,
  nextId: 0,
}));

const sentry = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));
const posthogServer = vi.hoisted(() => ({ capture: vi.fn() }));

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

const tokensCollection = {
  async insertOne(doc: Omit<TokenDoc, "_id">) {
    dbMock.tokens.push({ ...doc, _id: `token-${++dbMock.nextId}` });
    return { acknowledged: true };
  },
  async findOneAndUpdate(
    filter: { tokenHash: string; consumed: boolean; expiresAt: { $gt: Date } },
    update: { $set: Partial<TokenDoc> }
  ) {
    const row = dbMock.tokens.find(
      (token) =>
        token.tokenHash === filter.tokenHash &&
        token.consumed === filter.consumed &&
        token.expiresAt > filter.expiresAt.$gt
    );
    if (!row) return null;
    const before = { ...row, expiresAt: new Date(row.expiresAt), createdAt: new Date(row.createdAt) };
    Object.assign(row, update.$set);
    return before;
  },
};

const usersCollection = {
  async findOneAndUpdate(filter: { email: string }, update: UserUpdate, options: { upsert?: boolean }) {
    if (dbMock.failUserUpsert) return null;
    let doc = dbMock.users.get(filter.email) ?? null;
    if (!doc && options.upsert) {
      const inserted = update.$setOnInsert ?? {};
      doc = {
        _id: `user-${++dbMock.nextId}`,
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

const refreshTokensCollection = {
  async insertOne(doc: RefreshDoc) {
    dbMock.refreshTokens.push({ ...doc, _id: `refresh-${++dbMock.nextId}` });
    return { acknowledged: true };
  },
};

vi.mock("@/server/db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "magic_link_tokens") return tokensCollection;
        if (name === "users") return usersCollection;
        if (name === "refresh_tokens") return refreshTokensCollection;
        throw new Error(`Unexpected collection ${name}`);
      },
    }),
    close: vi.fn(),
  },
}));

vi.mock("@/server/email/resend", () => ({
  resend: {
    send: vi.fn(async (args: ResendArgs) => {
      dbMock.resendCalls.push(args);
      return { id: `mock-resend-${dbMock.resendCalls.length}` };
    }),
  },
}));

vi.mock("@/server/obs/sentry.server", () => ({ sentry }));
vi.mock("@/server/obs/posthog.server", () => ({ posthogServer }));

import { GET as consumeMagicLinkRoute } from "@/app/api/auth/magic-link/consume/route";
import { POST as issueMagicLinkRoute } from "@/app/api/auth/magic-link/issue/route";
import { issueMagicLink } from "@/server/auth/magic-link/issue";
import { MAGIC_LINK_DISCLOSURE_VI } from "@/server/email/templates/magic-link";
import { mongo } from "@/server/db/mongo";

function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function issue(email: string, ip = unique("203.0.113")) {
  return issueMagicLinkRoute(
    new Request("https://salenoti.test/api/auth/magic-link/issue", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "vitest",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email }),
    })
  );
}

async function consume(token: string, ip = unique("198.51.100")) {
  return consumeMagicLinkRoute(
    new Request(`https://salenoti.test/api/auth/magic-link/consume?token=${token}`, {
      headers: { "user-agent": "vitest", "x-forwarded-for": ip },
    })
  );
}

function lastRawToken(): string {
  const call = dbMock.resendCalls.at(-1);
  const match = /token=([A-Za-z0-9_-]+)/.exec(`${call?.html}\n${call?.text ?? ""}`);
  if (!match?.[1]) throw new Error("Missing token in mock Resend email");
  return match[1];
}

beforeEach(() => {
  process.env.APP_URL = "https://salenoti.test";
  process.env.AUTH_SECRET = "d".repeat(64);
  globalThis.__salenotiRateLimit?.clear();
  dbMock.tokens.length = 0;
  dbMock.users.clear();
  dbMock.refreshTokens.length = 0;
  dbMock.resendCalls.length = 0;
  dbMock.failUserUpsert = false;
  sentry.addBreadcrumb.mockReset();
  posthogServer.capture.mockReset();
});

describe("FR-AUTH-002 — magic-link auth", () => {
  it("AC1/10/11/12: issue stores tokenHash only, sends disclosure email, and stays under 300ms locally", async () => {
    const started = performance.now();
    const response = await issue("user@example.com", "203.0.113.20");
    const elapsed = performance.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(300);
    expect(dbMock.resendCalls).toHaveLength(1);
    expect(dbMock.resendCalls[0]?.html).toContain(MAGIC_LINK_DISCLOSURE_VI);
    expect(dbMock.resendCalls[0]?.text).toContain(MAGIC_LINK_DISCLOSURE_VI);

    const rawToken = lastRawToken();
    const stored = dbMock.tokens[0];
    expect(stored?.tokenHash).toBe(crypto.createHash("sha256").update(rawToken).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "auth.magic_link.issued",
        data: expect.objectContaining({ fr: "FR-AUTH-002", emailDomain: "example.com" }),
      })
    );
  });

  it("AC2: invalid email returns 400 invalid_email", async () => {
    const response = await issue("not-an-email", "203.0.113.21");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_email" });
  });

  it("contract: issue service rejects malformed email before token creation or Resend", async () => {
    await expect(issueMagicLink({ email: "bad", ip: "203.0.113.25", userAgent: "vitest" })).resolves.toEqual({
      ok: false,
      reason: "invalid_email",
    });
    expect(dbMock.tokens).toHaveLength(0);
    expect(dbMock.resendCalls).toHaveLength(0);
  });

  it("contract: issue service falls back to localhost APP_URL without leaking the raw token to storage", async () => {
    delete process.env.APP_URL;

    await expect(
      issueMagicLink({ email: "fallback@example.com", ip: "203.0.113.27", userAgent: "vitest" })
    ).resolves.toEqual({ ok: true });

    expect(dbMock.resendCalls[0]?.html).toContain("http://localhost:3000/api/auth/magic-link/consume?token=");
    expect(JSON.stringify(dbMock.tokens[0])).not.toContain(lastRawToken());
  });

  it("contract: issue route accepts valid JSON without forwarded IP or user-agent headers", async () => {
    const response = await issueMagicLinkRoute(
      new Request("https://salenoti.test/api/auth/magic-link/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "no-headers@example.com" }),
      })
    );
    expect(response.status).toBe(200);
    expect(dbMock.tokens[0]?.ip).toBe("0.0.0.0");
    expect(dbMock.tokens[0]?.userAgent).toBe("");
  });

  it("AC3/4: valid token creates cookies and user; second consume is rejected", async () => {
    const email = "consume@example.com";
    await issue(email, "203.0.113.22");
    const rawToken = lastRawToken();

    const first = await consume(rawToken, "198.51.100.22");
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/dashboard");
    expect(first.headers.get("set-cookie")).toContain("authjs.session-token=");
    expect(first.headers.get("set-cookie")).toContain("authjs.refresh-token=");

    const user = await mongo.db("salenoti").collection("users").findOne({ email });
    expect(user?.oauthProviders).toEqual(
      expect.arrayContaining([{ provider: "magic-link", providerAccountId: `magic-link:${email}` }])
    );
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "auth.magic_link.consumed" })
    );
    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      expect.stringMatching(/^user-/),
      expect.objectContaining({
        auth_sign_in_method: "magic-link",
        method: "magic-link",
        outcome: "succeeded",
        fr: "FR-AUTH-002",
      })
    );

    const second = await consume(rawToken, "198.51.100.22");
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toContain("code=invalid_or_expired_token");
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "auth.magic_link.rejected",
        data: expect.objectContaining({ reason: "invalid_or_expired_token" }),
      })
    );
  });

  it("AC5: expired token redirects to invalid_or_expired_token", async () => {
    await issue("expired@example.com", "203.0.113.23");
    dbMock.tokens[0]!.expiresAt = new Date(Date.now() - 1000);

    const response = await consume(lastRawToken(), "198.51.100.23");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("code=invalid_or_expired_token");
  });

  it("AC5: user upsert failure redirects with trace and emits rejected telemetry", async () => {
    await issue("upsert-fail@example.com", "203.0.113.26");
    dbMock.failUserUpsert = true;

    const response = await consume(lastRawToken(), "198.51.100.26");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("code=USER_UPSERT_FAILED");
    expect(response.headers.get("location")).toContain("trace=");
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "auth.magic_link.rejected",
        data: expect.objectContaining({ reason: "db_error" }),
      })
    );
  });

  it("AC6: missing token follows the same invalid_or_expired_token path", async () => {
    const response = await consumeMagicLinkRoute(
      new Request("https://salenoti.test/api/auth/magic-link/consume")
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("code=invalid_or_expired_token");
  });

  it("AC6: random token follows the same invalid_or_expired_token path", async () => {
    const response = await consume(crypto.randomBytes(32).toString("base64url"), "198.51.100.24");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("code=invalid_or_expired_token");
  });

  it("AC7: 4 issue requests/min/email returns 429 with Retry-After", async () => {
    const email = "rate-email@example.com";
    for (let i = 0; i < 3; i++) {
      expect((await issue(email, `203.0.113.${30 + i}`)).status).toBe(200);
    }
    const blocked = await issue(email, "203.0.113.34");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
  });

  it("AC8: 11 issue requests/min/IP returns 429 with Retry-After", async () => {
    const ip = "203.0.113.40";
    for (let i = 0; i < 10; i++) {
      expect((await issue(`rate-ip-${i}@example.com`, ip)).status).toBe(200);
    }
    const blocked = await issue("rate-ip-11@example.com", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
  });

  it("AC9: 21 consume requests/min/IP returns 429 with Retry-After", async () => {
    const ip = "198.51.100.40";
    for (let i = 0; i < 20; i++) {
      expect((await consume(crypto.randomBytes(32).toString("base64url"), ip)).status).toBe(302);
    }
    const blocked = await consume(crypto.randomBytes(32).toString("base64url"), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
  });
});
