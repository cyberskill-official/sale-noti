// FR-AUTH-003 — integration tests for refresh rotation, reuse detection, CORS, and sessions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialRefreshSession, hashRefreshToken, rotateRefresh } from "@/server/auth/refresh";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/server/auth/session";
import { POST as refreshPost, OPTIONS as refreshOptions } from "@/app/api/auth/refresh/route";
import { POST as signOutPost } from "@/app/api/auth/sign-out/route";
import { GET as sessionsGet } from "@/app/api/auth/sessions/route";
import { DELETE as deleteFamily } from "@/app/api/auth/sessions/[familyId]/route";

type RefreshDoc = {
  _id: string;
  tokenHash: string;
  userId: string;
  family: string;
  method: "google" | "magic-link";
  expiresAt: Date;
  used: boolean;
  usedAt: Date | null;
  rotatedTo: string | null;
  revoked: boolean;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
  ip_hash?: string;
  ua_hash?: string;
  ua_summary?: string;
};

type Filter = Partial<RefreshDoc> & { expiresAt?: { $gt: Date } };
type Update = { $set?: Partial<RefreshDoc> };

declare global {
  var __salenotiRateLimit: Map<string, { count: number; expiresAt: number }> | undefined;
}

const dbMock = vi.hoisted(() => ({
  refreshTokens: [] as RefreshDoc[],
  forceNoUpdate: false,
  failTransactionCount: 0,
  nextId: 0,
}));

const sentryMock = vi.hoisted(() => ({
  captureMessage: vi.fn(),
}));

function matches(row: RefreshDoc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "expiresAt" && value && typeof value === "object" && "$gt" in value) {
      return row.expiresAt > value.$gt;
    }
    return row[key as keyof RefreshDoc] === value;
  });
}

function clone(row: RefreshDoc): RefreshDoc {
  return {
    ...row,
    expiresAt: new Date(row.expiresAt),
    createdAt: new Date(row.createdAt),
    usedAt: row.usedAt ? new Date(row.usedAt) : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
  };
}

const refreshCollection = {
  async insertOne(doc: Omit<RefreshDoc, "_id">) {
    dbMock.refreshTokens.push({ ...doc, _id: `refresh-${++dbMock.nextId}` });
    return { acknowledged: true };
  },
  async findOne(filter: Filter) {
    const row = dbMock.refreshTokens.find((candidate) => matches(candidate, filter));
    return row ? clone(row) : null;
  },
  async findOneAndUpdate(filter: Filter, update: Update) {
    if (dbMock.forceNoUpdate) return null;
    const row = dbMock.refreshTokens.find((candidate) => matches(candidate, filter));
    if (!row) return null;
    const before = clone(row);
    Object.assign(row, update.$set ?? {});
    return before;
  },
  async updateMany(filter: Filter, update: Update) {
    let modifiedCount = 0;
    for (const row of dbMock.refreshTokens) {
      if (matches(row, filter)) {
        Object.assign(row, update.$set ?? {});
        modifiedCount++;
      }
    }
    return { modifiedCount };
  },
  find(filter: Filter) {
    const rows = dbMock.refreshTokens.filter((candidate) => matches(candidate, filter)).map(clone);
    return {
      sort: () => ({
        limit: () => ({
          async toArray() {
            return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          },
        }),
      }),
    };
  },
};

vi.mock("@/server/db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name !== "refresh_tokens") throw new Error(`Unexpected collection ${name}`);
        return refreshCollection;
      },
    }),
    withTransaction: async <T>(fn: (session?: unknown) => Promise<T>) => {
      if (dbMock.failTransactionCount > 0) {
        dbMock.failTransactionCount--;
        throw new Error("Transient transaction abort");
      }
      return fn(undefined);
    },
    close: vi.fn(),
  },
}));

vi.mock("@/server/obs/sentry.server", () => ({
  sentry: sentryMock,
}));

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing cookie ${name}`);
  return cookie.split(";")[0]!.split("=")[1]!;
}

function requestWithCookie(url: string, cookie: string, ip = "203.0.113.50") {
  return new Request(url, {
    method: "POST",
    headers: { cookie, "x-forwarded-for": ip, "user-agent": "Chrome Mac vitest" },
  });
}

beforeEach(() => {
  process.env.AUTH_SECRET = "c".repeat(64);
  process.env.EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
  process.env.IP_HASH_SALT = "ip-salt";
  process.env.UA_HASH_SALT = "ua-salt";
  globalThis.__salenotiRateLimit?.clear();
  sentryMock.captureMessage.mockReset();
  dbMock.refreshTokens.length = 0;
  dbMock.forceNoUpdate = false;
  dbMock.failTransactionCount = 0;
});

describe("FR-AUTH-003 — refresh/session model", () => {
  it("AC10/19: initial session stores only tokenHash and returns raw refresh only in Set-Cookie", async () => {
    const cookies = await createInitialRefreshSession({
      userId: "user-1",
      ip: "203.0.113.1",
      ua: "Chrome Mac vitest",
      method: "magic-link",
    });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    const access = cookieValue(cookies, ACCESS_COOKIE);
    const claims = await verifyAccessToken(access);

    expect(cookies.join("\n")).toContain(`${ACCESS_COOKIE}=`);
    expect(cookies.join("\n")).toContain(`${REFRESH_COOKIE}=`);
    expect(cookies.join("\n")).toContain("HttpOnly");
    expect(cookies.join("\n")).toContain("Secure");
    expect(cookies.join("\n")).toContain("SameSite=Lax");
    expect(dbMock.refreshTokens).toHaveLength(1);
    expect(dbMock.refreshTokens[0]?.tokenHash).toHaveLength(64);
    expect(hashRefreshToken(refresh)).toBe(dbMock.refreshTokens[0]?.tokenHash);
    expect(JSON.stringify(dbMock.refreshTokens)).not.toContain(refresh);
    expect(JSON.stringify(dbMock.refreshTokens)).not.toContain("203.0.113.1");
    expect(claims).toMatchObject({ sub: "user-1", plan: "free", method: "magic-link" });
  });

  it("contract: session creation summarizes common clients without storing raw IP or UA", async () => {
    await createInitialRefreshSession({ userId: "ua-firefox", ip: "203.0.113.10", ua: "Firefox Linux vitest" });
    await createInitialRefreshSession({ userId: "ua-safari", ip: "203.0.113.11", ua: "Mobile Safari iOS vitest" });
    await createInitialRefreshSession({ userId: "ua-extension", ip: "203.0.113.12", ua: "SaleNotiExtension vitest" });
    await createInitialRefreshSession({ userId: "ua-chrome", ip: "203.0.113.13", ua: "Chrome Linux vitest" });
    await createInitialRefreshSession({ userId: "ua-safari-desktop", ip: "203.0.113.14", ua: "Safari macOS vitest" });
    await createInitialRefreshSession({ userId: "ua-unknown", ip: "203.0.113.15", ua: "Curl vitest" });

    expect(dbMock.refreshTokens.map((row) => row.ua_summary)).toEqual([
      "Firefox",
      "Mobile Safari",
      "Chrome Extension",
      "Chrome",
      "Safari",
      "Unknown client",
    ]);
    expect(JSON.stringify(dbMock.refreshTokens)).not.toContain("203.0.113.10");
    expect(JSON.stringify(dbMock.refreshTokens)).not.toContain("Mobile Safari iOS vitest");
  });

  it("contract: audit hashes fall back to PostHog salt when explicit salts are absent", async () => {
    delete process.env.IP_HASH_SALT;
    delete process.env.UA_HASH_SALT;
    process.env.POSTHOG_PII_SALT = "posthog-salt";

    await createInitialRefreshSession({ userId: "salt-fallback", ip: "203.0.113.16", ua: "Curl vitest" });

    expect(dbMock.refreshTokens[0]?.ip_hash).toHaveLength(64);
    expect(dbMock.refreshTokens[0]?.ua_hash).toHaveLength(64);
    expect(JSON.stringify(dbMock.refreshTokens)).not.toContain("203.0.113.16");
  });

  it("AC1/18: refresh rotates cookies and creates a new family member", async () => {
    const cookies = await createInitialRefreshSession({ userId: "user-1", ip: "203.0.113.2", ua: "Chrome Mac vitest" });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);

    const response = await refreshPost(
      requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.2")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, expiresIn: 900 });
    expect(response.headers.get("set-cookie")).toContain(`${ACCESS_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain(`${REFRESH_COOKIE}=`);
    expect(dbMock.refreshTokens).toHaveLength(2);
    expect(dbMock.refreshTokens[0]?.used).toBe(true);
    expect(dbMock.refreshTokens[0]?.rotatedTo).toBe(dbMock.refreshTokens[1]?.tokenHash);
    expect(dbMock.refreshTokens[1]?.family).toBe(dbMock.refreshTokens[0]?.family);
  });

  it("AC1/18: refresh retries once after a transient transaction abort", async () => {
    const cookies = await createInitialRefreshSession({ userId: "user-retry", ip: "203.0.113.20", ua: "Chrome Mac vitest" });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    dbMock.failTransactionCount = 1;

    const response = await refreshPost(
      requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.20")
    );

    expect(response.status).toBe(200);
    expect(dbMock.refreshTokens).toHaveLength(2);
  });

  it("contract: refresh surfaces an error after the retry budget is exhausted", async () => {
    const cookies = await createInitialRefreshSession({ userId: "user-retry-fail", ip: "203.0.113.22", ua: "Chrome Mac vitest" });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    dbMock.failTransactionCount = 2;

    await expect(rotateRefresh(refresh)).rejects.toThrow("Transient transaction abort");
  });

  it("AC2/3: missing and expired refresh tokens return 401 without family revocation", async () => {
    const missing = await refreshPost(requestWithCookie("https://salenoti.test/api/auth/refresh", "", "203.0.113.3"));
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toMatchObject({ code: "no_token" });

    const cookies = await createInitialRefreshSession({ userId: "user-2", ip: "203.0.113.3", ua: "Chrome Mac vitest" });
    dbMock.refreshTokens[0]!.expiresAt = new Date(Date.now() - 1000);
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    const expired = await refreshPost(
      requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.3")
    );
    expect(expired.status).toBe(401);
    await expect(expired.json()).resolves.toMatchObject({ code: "expired" });
    expect(dbMock.refreshTokens.every((row) => !row.revoked)).toBe(true);
  });

  it("contract: a lost compare-and-set update returns no_token without issuing cookies", async () => {
    const cookies = await createInitialRefreshSession({ userId: "user-race", ip: "203.0.113.21", ua: "Chrome Mac vitest" });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    dbMock.forceNoUpdate = true;

    const response = await refreshPost(
      requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.21")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "no_token" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("AC4/17/20: replaying a rotated token revokes the entire family without PII", async () => {
    const cookies = await createInitialRefreshSession({ userId: "user-3", ip: "203.0.113.4", ua: "Chrome Mac vitest" });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    const [first, replay] = await Promise.all([
      refreshPost(requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.4")),
      refreshPost(requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.4")),
    ]);
    expect([first.status, replay.status].sort()).toEqual([200, 401]);

    const third = await refreshPost(
      requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.4")
    );
    expect(third.status).toBe(401);
    await expect(third.json()).resolves.toMatchObject({ code: "session_revoked" });
    expect(dbMock.refreshTokens.every((row) => row.revoked)).toBe(true);
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "auth_reuse_detected",
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({ kind: "reuse_detected", family: dbMock.refreshTokens[0]!.family }),
      })
    );
    expect(JSON.stringify(sentryMock.captureMessage.mock.calls)).not.toContain(refresh);
    expect(JSON.stringify(sentryMock.captureMessage.mock.calls)).not.toContain("user@example.com");
  });

  it("AC7: 31 refresh attempts/min/token returns 429 with Retry-After", async () => {
    const cookies = await createInitialRefreshSession({ userId: "user-4", ip: "203.0.113.5", ua: "Chrome Mac vitest" });
    const refresh = cookieValue(cookies, REFRESH_COOKIE);
    for (let i = 0; i < 30; i++) {
      await refreshPost(requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.5"));
    }
    const blocked = await refreshPost(
      requestWithCookie("https://salenoti.test/api/auth/refresh", `${REFRESH_COOKIE}=${refresh}`, "203.0.113.5")
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
  });

  it("AC8/9: CORS only allows the pinned extension origin", async () => {
    const allowed = await refreshOptions(
      new Request("https://salenoti.test/api/auth/refresh", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
      })
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBe("true");

    const blocked = await refreshOptions(
      new Request("https://salenoti.test/api/auth/refresh", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://malicious" },
      })
    );
    expect(blocked.status).toBe(204);
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("AC6/14/15: sign-out and per-family session revocation use the access cookie", async () => {
    const firstCookies = await createInitialRefreshSession({ userId: "user-5", ip: "203.0.113.6", ua: "Chrome Mac vitest" });
    const firstAccess = cookieValue(firstCookies, ACCESS_COOKIE);
    const firstFamily = dbMock.refreshTokens[0]!.family;
    const secondCookies = await createInitialRefreshSession({ userId: "user-5", ip: "203.0.113.7", ua: "Chrome Mac vitest" });
    const secondAccess = cookieValue(secondCookies, ACCESS_COOKIE);
    const secondFamily = dbMock.refreshTokens[1]!.family;

    const list = await sessionsGet(
      new Request("https://salenoti.test/api/auth/sessions", { headers: { cookie: `${ACCESS_COOKIE}=${secondAccess}` } })
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { sessions: Array<{ familyId: string; current: boolean; ip_hash_prefix: string }> };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.find((session) => session.familyId === secondFamily)?.current).toBe(true);
    expect(JSON.stringify(body)).not.toContain("203.0.113.7");
    expect(body.sessions[0]?.ip_hash_prefix).toHaveLength(8);

    const revokeOther = await deleteFamily(
      new Request(`https://salenoti.test/api/auth/sessions/${firstFamily}`, {
        method: "DELETE",
        headers: { cookie: `${ACCESS_COOKIE}=${secondAccess}` },
      }),
      { params: Promise.resolve({ familyId: firstFamily }) }
    );
    expect(revokeOther.status).toBe(200);
    expect(dbMock.refreshTokens.find((row) => row.family === firstFamily)?.revoked).toBe(true);
    expect(dbMock.refreshTokens.find((row) => row.family === secondFamily)?.revoked).toBe(false);

    const otherUserCookies = await createInitialRefreshSession({
      userId: "user-other",
      ip: "203.0.113.8",
      ua: "Chrome Mac vitest",
    });
    const otherUserFamily = dbMock.refreshTokens[2]!.family;
    const foreignRevoke = await deleteFamily(
      new Request(`https://salenoti.test/api/auth/sessions/${otherUserFamily}`, {
        method: "DELETE",
        headers: { cookie: `${ACCESS_COOKIE}=${secondAccess}` },
      }),
      { params: Promise.resolve({ familyId: otherUserFamily }) }
    );
    expect(foreignRevoke.status).toBe(404);
    expect(dbMock.refreshTokens.find((row) => row.family === otherUserFamily)?.revoked).toBe(false);
    expect(cookieValue(otherUserCookies, ACCESS_COOKIE)).toBeTruthy();

    const signOut = await signOutPost(
      new Request("https://salenoti.test/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: `${ACCESS_COOKIE}=${secondAccess}` },
      })
    );
    expect(signOut.status).toBe(200);
    expect(signOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(dbMock.refreshTokens.find((row) => row.family === secondFamily)?.revoked).toBe(true);

    const refreshOnlyCookies = await createInitialRefreshSession({
      userId: "user-refresh-only",
      ip: "203.0.113.9",
      ua: "Firefox Linux vitest",
    });
    const refreshOnly = cookieValue(refreshOnlyCookies, REFRESH_COOKIE);
    const refreshOnlyFamily = dbMock.refreshTokens[3]!.family;
    const refreshOnlySignOut = await signOutPost(
      new Request("https://salenoti.test/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: `${REFRESH_COOKIE}=${refreshOnly}` },
      })
    );
    expect(refreshOnlySignOut.status).toBe(200);
    expect(refreshOnlySignOut.headers.get("set-cookie")).toContain(`${REFRESH_COOKIE}=;`);
    expect(dbMock.refreshTokens.find((row) => row.family === refreshOnlyFamily)?.revoked).toBe(true);
  });
});
