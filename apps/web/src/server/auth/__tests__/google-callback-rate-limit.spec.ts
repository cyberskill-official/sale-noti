import { describe, expect, it } from "vitest";
import {
  clientIpForAuth,
  enforceGoogleCallbackRateLimit,
  isGoogleCallbackRequest,
} from "@/server/auth/google-callback-rate-limit";

describe("FR-AUTH-001 — Google callback rate limit", () => {
  it("detects only the Auth.js Google callback route", () => {
    expect(isGoogleCallbackRequest(new Request("https://salenoti.test/api/auth/callback/google"))).toBe(true);
    expect(isGoogleCallbackRequest(new Request("https://salenoti.test/api/auth/signin/google"))).toBe(false);
  });

  it("uses the first forwarded IP and falls back safely", () => {
    expect(
      clientIpForAuth(
        new Request("https://salenoti.test/api/auth/callback/google", {
          headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
        })
      )
    ).toBe("203.0.113.10");
    expect(clientIpForAuth(new Request("https://salenoti.test/api/auth/callback/google"))).toBe("unknown");
  });

  it("allows 10 callback hits/min/IP and returns 429 with Retry-After on the 11th", async () => {
    const ip = `198.51.100.${Date.now() % 250}`;

    for (let i = 0; i < 10; i++) {
      const response = await enforceGoogleCallbackRateLimit(
        new Request("https://salenoti.test/api/auth/callback/google", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
        })
      );
      expect(response).toBeNull();
    }

    const blocked = await enforceGoogleCallbackRateLimit(
      new Request("https://salenoti.test/api/auth/callback/google", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
      })
    );

    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBe("60");
    await expect(blocked?.json()).resolves.toMatchObject({
      code: "AUTH_GOOGLE_CALLBACK_RATE_LIMITED",
    });
  });
});
