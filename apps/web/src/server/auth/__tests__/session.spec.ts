import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_COOKIE, REFRESH_COOKIE, buildAccessCookie, buildRefreshCookie, signAccessToken, verifyAccessToken } from "../session";

const OLD_ENV = { ...process.env };

describe("FR-AUTH-003 — access and refresh session helpers", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "c".repeat(64);
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("signs and verifies 15-minute access tokens", async () => {
    const token = await signAccessToken({ userId: "user-1", familyId: "family-1", method: "magic-link" });
    const claims = await verifyAccessToken(token);

    expect(claims).toMatchObject({ sub: "user-1", familyId: "family-1", method: "magic-link" });
    expect(claims?.plan).toBe("free");
    expect(claims?.jti).toMatch(/[0-9a-f-]{36}/);
    expect((claims!.exp - claims!.iat)).toBe(900);
  });

  it("rejects tampered access tokens", async () => {
    const token = await signAccessToken({ userId: "user-1", familyId: "family-1", method: "google" });
    const tampered = token.replace(/.$/, token.endsWith("a") ? "b" : "a");

    await expect(verifyAccessToken(tampered)).resolves.toBeNull();
  });

  it("sets secure path-scoped cookies", () => {
    expect(buildAccessCookie("access")).toContain(`${ACCESS_COOKIE}=access`);
    expect(buildAccessCookie("access")).toContain("HttpOnly");
    expect(buildAccessCookie("access")).toContain("SameSite=Lax");
    expect(buildRefreshCookie("refresh")).toContain(`${REFRESH_COOKIE}=refresh`);
    expect(buildRefreshCookie("refresh")).toContain("Path=/api/auth/refresh");
    expect(buildRefreshCookie("refresh")).toContain("Max-Age=2592000");
  });

  it("verifies tokens signed with AUTH_SECRET_N_MINUS_1 during the grace window", async () => {
    process.env.AUTH_SECRET = "o".repeat(64);
    const oldToken = await signAccessToken({ userId: "user-1", familyId: "family-1", method: "google" });

    process.env.AUTH_SECRET_N_MINUS_1 = "o".repeat(64);
    process.env.AUTH_SECRET_N_MINUS_1_ACCEPT_UNTIL_MS = String(Date.now() + 60 * 60 * 1000);
    process.env.AUTH_SECRET = "n".repeat(64);

    await expect(verifyAccessToken(oldToken)).resolves.toMatchObject({ sub: "user-1" });

    process.env.AUTH_SECRET_N_MINUS_1_ACCEPT_UNTIL_MS = String(Date.now() - 1000);
    await expect(verifyAccessToken(oldToken)).resolves.toBeNull();
  });
});
