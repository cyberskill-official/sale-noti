// FR-AUTH-001 — testable Auth.js Google callback policy + telemetry.
import { posthogServer } from "@/server/obs/posthog.server";
import { sentry } from "@/server/obs/sentry.server";
import { upsertUserOnSignIn } from "@/server/users/upsert-on-signin";

type AuthAccount = { provider?: string; providerAccountId?: string } | null | undefined;

export type GoogleOAuthProfile = {
  iss?: string | null;
  aud?: string | null;
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
};

type SignInInput = {
  account: AuthAccount;
  profile: GoogleOAuthProfile | null | undefined;
  googleClientId: string;
};

type AuthStage = "started" | "succeeded" | "failed";

function distinctId(profile: GoogleOAuthProfile | null | undefined, account: AuthAccount): string {
  return profile?.email || profile?.sub || account?.providerAccountId || "anonymous";
}

function addAuthBreadcrumb(stage: AuthStage, data: Record<string, unknown> = {}) {
  sentry.addBreadcrumb?.({
    category: `auth.google.sign_in.${stage}`,
    level: stage === "failed" ? "warning" : "info",
    data: { fr: "FR-AUTH-001", method: "google", ...data },
  });
}

function captureAuthSignIn(
  stage: Exclude<AuthStage, "started">,
  input: SignInInput,
  properties: Record<string, unknown> = {},
) {
  posthogServer.capture("auth_sign_in", distinctId(input.profile, input.account), {
    fr: "FR-AUTH-001",
    method: "google",
    outcome: stage === "succeeded" ? "succeeded" : "failed",
    ...properties,
  });
}

function fail(input: SignInInput, reason: string, redirect = false): false | string {
  addAuthBreadcrumb("failed", { reason });
  captureAuthSignIn("failed", input, { reason });
  return redirect ? `/auth/error?code=${reason}` : false;
}

export async function handleGoogleSignIn(input: SignInInput): Promise<boolean | string> {
  addAuthBreadcrumb("started");

  if (input.account?.provider !== "google") return fail(input, "invalid_provider");

  const iss = input.profile?.iss;
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
    return fail(input, "invalid_issuer", true);
  }

  if (input.profile?.aud !== input.googleClientId) {
    return fail(input, "invalid_audience", true);
  }

  const result = await upsertUserOnSignIn({
    sub: String(input.profile?.sub ?? input.account.providerAccountId),
    email: input.profile?.email ?? "",
    email_verified: input.profile?.email_verified ?? true,
    name: input.profile?.name ?? undefined,
  });

  if (!result.ok) {
    addAuthBreadcrumb("failed", { reason: result.reason, trace: result.traceId });
    captureAuthSignIn("failed", input, { reason: result.reason, trace: result.traceId });
    return `/auth/error?code=USER_UPSERT_FAILED&trace=${result.traceId}`;
  }

  addAuthBreadcrumb("succeeded");
  captureAuthSignIn("succeeded", input);
  return true;
}

export function safeAuthRedirect({ url, baseUrl }: { url: string; baseUrl: string }): string {
  if (url.startsWith(baseUrl)) return url;
  if (url.startsWith("/")) return `${baseUrl}${url}`;
  return `${baseUrl}/dashboard`;
}
