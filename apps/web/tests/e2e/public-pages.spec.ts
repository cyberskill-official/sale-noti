import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcessWithoutNullStreams;

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

describe("public web e2e smoke", () => {
  beforeAll(async () => {
    server = spawn("./node_modules/.bin/next", ["dev", "--port", String(PORT), "--hostname", "127.0.0.1"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_URL: BASE,
        API_URL: "http://127.0.0.1:4000",
        AUTH_SECRET: "d".repeat(64),
        GOOGLE_CLIENT_ID: "test-google-client",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "pipe",
    });
    await waitFor(`${BASE}/`);
  }, 45_000);

  afterAll(() => {
    server?.kill("SIGTERM");
  });

  it("renders core public pages with disclosure and policy surfaces", async () => {
    const home = await fetch(`${BASE}/`).then((r) => r.text());
    expect(home).toContain("SaleNoti");
    expect(home).toContain("price-tracker affiliate");
    expect(home).toContain("KHÔNG");

    const business = await fetch(`${BASE}/business`).then((r) => r.text());
    expect(business).toContain("SaleNoti for Business");
    expect(business).toContain("Liên hệ");

    const privacy = await fetch(`${BASE}/privacy`).then((r) => r.text());
    expect(privacy).toContain("Chính sách bảo mật");
    expect(privacy).toContain("legal@salenoti.vn");

    const privacyEn = await fetch(`${BASE}/privacy/en`).then((r) => r.text());
    expect(privacyEn).toContain("Privacy Policy");
    expect(privacyEn).toContain("DPO");

    const affiliate = await fetch(`${BASE}/legal/affiliate`).then((r) => r.text());
    expect(affiliate).toContain("Shopee Affiliate");

    const crossBorder = await fetch(`${BASE}/legal/cross-border-transfer-impact-assessment`).then((r) => r.text());
    expect(crossBorder).toContain("Cross-border");
    expect(crossBorder).toContain("A05");

    const megaSale = await fetch(`${BASE}/megasale/2026-11-11`).then((r) => r.text());
    expect(megaSale).toContain("11.11 Double Eleven");
    expect(megaSale).toContain("Đang tổng hợp deals");
  });

  it("redirects dashboard to sign-in and exposes Google sign-in form", async () => {
    const dashboard = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
    expect(dashboard.status).toBeGreaterThanOrEqual(300);
    expect(dashboard.headers.get("location")).toContain("/auth/sign-in");

    const signIn = await fetch(`${BASE}/auth/sign-in`).then((r) => r.text());
    expect(signIn).toContain("Đăng nhập SaleNoti");
    expect(signIn).toContain("Trước khi bắt đầu");
    expect(signIn).toContain("Tôi đã hiểu");
    expect(signIn).toContain("Sign in with Google");
  });

  it("rate-limits Google OAuth callback after 10 hits/min/IP", async () => {
    const headers = { "x-forwarded-for": "203.0.113.77" };

    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${BASE}/api/auth/callback/google`, { method: "POST", headers });
      expect(response.status).not.toBe(429);
    }

    const blocked = await fetch(`${BASE}/api/auth/callback/google`, { method: "POST", headers });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    await expect(blocked.json()).resolves.toMatchObject({
      code: "AUTH_GOOGLE_CALLBACK_RATE_LIMITED",
    });
  });
});
