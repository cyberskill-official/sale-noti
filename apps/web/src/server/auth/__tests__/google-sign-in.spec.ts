import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertUserOnSignIn = vi.hoisted(() => vi.fn());
const sentry = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));
const posthogServer = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("@/server/users/upsert-on-signin", () => ({ upsertUserOnSignIn }));
vi.mock("@/server/obs/sentry.server", () => ({ sentry }));
vi.mock("@/server/obs/posthog.server", () => ({ posthogServer }));

import { handleGoogleSignIn, safeAuthRedirect } from "@/server/auth/google-sign-in";

const validInput = {
  account: { provider: "google", providerAccountId: "google-sub-1" },
  profile: {
    iss: "https://accounts.google.com",
    aud: "test-google-client",
    sub: "google-sub-1",
    email: "buyer@example.com",
    email_verified: true,
    name: "Buyer",
  },
  googleClientId: "test-google-client",
};

describe("FR-AUTH-001 — Google sign-in callback policy", () => {
  beforeEach(() => {
    upsertUserOnSignIn.mockReset();
    sentry.addBreadcrumb.mockReset();
    posthogServer.capture.mockReset();
  });

  it("contract: accepts the Google OIDC profile response shape and emits success telemetry", async () => {
    upsertUserOnSignIn.mockResolvedValue({ ok: true, userId: "user-1" });

    await expect(handleGoogleSignIn(validInput)).resolves.toBe(true);

    expect(upsertUserOnSignIn).toHaveBeenCalledWith({
      sub: "google-sub-1",
      email: "buyer@example.com",
      email_verified: true,
      name: "Buyer",
    });
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "auth.google.sign_in.started" }),
    );
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "auth.google.sign_in.succeeded" }),
    );
    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      "buyer@example.com",
      expect.objectContaining({ method: "google", outcome: "succeeded", fr: "FR-AUTH-001" }),
    );
  });

  it("accepts the alternate Google issuer and normalizes nullable profile fields", async () => {
    upsertUserOnSignIn.mockResolvedValue({ ok: true, userId: "user-2" });

    await expect(
      handleGoogleSignIn({
        ...validInput,
        profile: {
          iss: "accounts.google.com",
          aud: "test-google-client",
          sub: null,
          email: null,
          email_verified: null,
          name: null,
        },
      }),
    ).resolves.toBe(true);

    expect(upsertUserOnSignIn).toHaveBeenCalledWith({
      sub: "google-sub-1",
      email: "",
      email_verified: true,
      name: undefined,
    });
    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      "google-sub-1",
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });

  it("rejects non-Google providers without touching Mongo", async () => {
    const result = await handleGoogleSignIn({
      ...validInput,
      account: { provider: "credentials", providerAccountId: "local" },
    });

    expect(result).toBe(false);
    expect(upsertUserOnSignIn).not.toHaveBeenCalled();
    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      "buyer@example.com",
      expect.objectContaining({ outcome: "failed", reason: "invalid_provider" }),
    );
  });

  it("returns a specific auth error for invalid issuer and records failure telemetry", async () => {
    const result = await handleGoogleSignIn({
      ...validInput,
      profile: { ...validInput.profile, iss: "https://evil.example" },
    });

    expect(result).toBe("/auth/error?code=invalid_issuer");
    expect(upsertUserOnSignIn).not.toHaveBeenCalled();
    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      "buyer@example.com",
      expect.objectContaining({ outcome: "failed", reason: "invalid_issuer" }),
    );
  });

  it("returns a specific auth error for audience mismatch", async () => {
    await expect(
      handleGoogleSignIn({
        ...validInput,
        profile: { ...validInput.profile, aud: "wrong-client" },
      }),
    ).resolves.toBe("/auth/error?code=invalid_audience");
    expect(upsertUserOnSignIn).not.toHaveBeenCalled();
  });

  it("uses an anonymous analytics id when no profile or account subject is present", async () => {
    await expect(
      handleGoogleSignIn({
        account: { provider: "credentials" },
        profile: undefined,
        googleClientId: "test-google-client",
      }),
    ).resolves.toBe(false);

    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      "anonymous",
      expect.objectContaining({ outcome: "failed", reason: "invalid_provider" }),
    );
  });

  it("fails closed when Mongo upsert rejects the profile", async () => {
    upsertUserOnSignIn.mockResolvedValue({ ok: false, reason: "unverified_email", traceId: "trace-123" });

    await expect(
      handleGoogleSignIn({
        ...validInput,
        profile: { ...validInput.profile, email_verified: false },
      }),
    ).resolves.toBe("/auth/error?code=USER_UPSERT_FAILED&trace=trace-123");

    expect(posthogServer.capture).toHaveBeenCalledWith(
      "auth_sign_in",
      "buyer@example.com",
      expect.objectContaining({ outcome: "failed", reason: "unverified_email", trace: "trace-123" }),
    );
  });

  it("blocks absolute open redirects and preserves same-origin or relative redirects", () => {
    expect(safeAuthRedirect({ url: "https://evil.example/a", baseUrl: "https://salenoti.vn" })).toBe(
      "https://salenoti.vn/dashboard",
    );
    expect(safeAuthRedirect({ url: "/dashboard", baseUrl: "https://salenoti.vn" })).toBe(
      "https://salenoti.vn/dashboard",
    );
    expect(safeAuthRedirect({ url: "https://salenoti.vn/pricing", baseUrl: "https://salenoti.vn" })).toBe(
      "https://salenoti.vn/pricing",
    );
  });
});
