import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "./route";

const routeMock = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  recordDisclosureConsent: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  ACCESS_COOKIE: "sn_access",
  verifyAccessToken: routeMock.verifyAccessToken,
}));

vi.mock("@/server/legal/disclosure-consent", () => ({
  AFFILIATE_DISCLOSURE_KIND: "affiliate_disclosure_v1",
  PRIVACY_CONSENT_KIND: "privacy_v1",
  recordDisclosureConsent: routeMock.recordDisclosureConsent,
}));

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://salenoti.test/api/auth/disclosure-ack", {
    method: "POST",
    headers: {
      cookie: "sn_access=access-token",
      "content-type": "application/json",
      "user-agent": "Vitest disclosure route",
      "x-forwarded-for": "203.0.113.30, 198.51.100.4",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
  routeMock.verifyAccessToken.mockReset();
  routeMock.recordDisclosureConsent.mockReset();
  routeMock.verifyAccessToken.mockResolvedValue({ sub: "user-1" });
  routeMock.recordDisclosureConsent.mockResolvedValue(true);
});

describe("FR-LEGAL-002 — disclosure acknowledgement route contract", () => {
  it("rejects unauthenticated acknowledgements without writing consent", async () => {
    routeMock.verifyAccessToken.mockResolvedValue(null);

    const response = await POST(request({ kind: "affiliate_disclosure_v1" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "no_session" });
    expect(routeMock.recordDisclosureConsent).not.toHaveBeenCalled();
  });

  it("rejects requests that do not carry the access cookie", async () => {
    const response = await POST(
      new Request("https://salenoti.test/api/auth/disclosure-ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "affiliate_disclosure_v1" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(routeMock.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("rejects malformed consent kinds", async () => {
    const response = await POST(request({ kind: "marketing_v9" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_consent_kind" });
    expect(routeMock.recordDisclosureConsent).not.toHaveBeenCalled();
  });

  it("defaults to affiliate disclosure consent and records hashed signal inputs", async () => {
    const response = await POST(request({ source: "extension" }, { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    await expect(response.json()).resolves.toEqual({ ok: true, kind: "affiliate_disclosure_v1" });
    expect(routeMock.recordDisclosureConsent).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "affiliate_disclosure_v1",
      ip: "203.0.113.30",
      userAgent: "Vitest disclosure route",
      source: "extension",
    });
  });

  it("records privacy consent from the web app without extension CORS headers", async () => {
    const response = await POST(request({ kind: "privacy_v1", source: "web" }, { origin: "https://evil.example" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(routeMock.recordDisclosureConsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "privacy_v1", source: "api" }),
    );
  });

  it("returns 404 when the authenticated user no longer exists", async () => {
    routeMock.recordDisclosureConsent.mockResolvedValue(false);

    const response = await POST(request({ kind: "affiliate_disclosure_v1" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "user_not_found" });
  });

  it("handles invalid JSON as the default affiliate acknowledgement", async () => {
    const response = await POST(
      new Request("https://salenoti.test/api/auth/disclosure-ack", {
        method: "POST",
        headers: { cookie: "sn_access=access-token" },
        body: "{",
      }),
    );

    expect(response.status).toBe(200);
    expect(routeMock.recordDisclosureConsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "affiliate_disclosure_v1" }),
    );
  });

  it("answers extension preflight only for the configured extension id", async () => {
    const allowed = await OPTIONS(
      new Request("https://salenoti.test/api/auth/disclosure-ack", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
      }),
    );
    const blocked = await OPTIONS(
      new Request("https://salenoti.test/api/auth/disclosure-ack", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://notallowed" },
      }),
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(blocked.status).toBe(204);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });
});
