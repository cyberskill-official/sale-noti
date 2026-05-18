import { beforeEach, describe, expect, it, vi } from "vitest";

const nextAuth = vi.hoisted(() => vi.fn());
const googleProvider = vi.hoisted(() => vi.fn((config: unknown) => ({ id: "google", config })));
const handleGoogleSignIn = vi.hoisted(() => vi.fn());
const safeAuthRedirect = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  default: nextAuth,
}));

vi.mock("next-auth/providers/google", () => ({
  default: googleProvider,
}));

vi.mock("@/server/auth/google-sign-in", () => ({
  handleGoogleSignIn,
  safeAuthRedirect,
}));

function resetEnv() {
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  process.env.AUTH_SECRET = "d".repeat(64);
}

describe("FR-AUTH-001 — Auth.js config wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
    nextAuth.mockReset();
    googleProvider.mockClear();
    handleGoogleSignIn.mockReset();
    safeAuthRedirect.mockReset();
    nextAuth.mockReturnValue({ handlers: { GET: vi.fn(), POST: vi.fn() }, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() });
    resetEnv();
  });

  it("pins Google provider scope and delegates callback policy to the auth helper", async () => {
    handleGoogleSignIn.mockResolvedValue(true);
    safeAuthRedirect.mockReturnValue("https://salenoti.vn/dashboard");

    await import("@/auth");
    const call = nextAuth.mock.calls[0];
    expect(call).toBeDefined();
    const config = call![0] as any;

    expect(googleProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "test-google-client",
        clientSecret: "test-google-secret",
        authorization: { params: { scope: "openid email profile" } },
      }),
    );

    const account = { provider: "google", providerAccountId: "sub-1" };
    const profile = { aud: "test-google-client", iss: "https://accounts.google.com" };
    await expect(config.callbacks.signIn({ account, profile })).resolves.toBe(true);
    expect(handleGoogleSignIn).toHaveBeenCalledWith({ account, profile, googleClientId: "test-google-client" });

    await expect(config.callbacks.redirect({ url: "/dashboard", baseUrl: "https://salenoti.vn" })).resolves.toBe(
      "https://salenoti.vn/dashboard",
    );
    expect(safeAuthRedirect).toHaveBeenCalledWith({ url: "/dashboard", baseUrl: "https://salenoti.vn" });
  });

  it("fails closed when required OAuth env is missing at runtime", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_SECRET;

    await import("@/auth");
    const call = nextAuth.mock.calls[0];
    expect(call).toBeDefined();
    const config = call![0] as any;

    expect(googleProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "__missing_google_client_id__",
        clientSecret: "__missing_google_client_secret__",
      }),
    );
    expect(config.secret).toBe("__missing_auth_secret_for_build_only__");

    await expect(config.callbacks.signIn({ account: { provider: "google" }, profile: {} })).resolves.toBe(false);
    expect(handleGoogleSignIn).not.toHaveBeenCalled();
  });
});
