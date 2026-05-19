// FR-AUTH-001 §6 — signIn callback delegate.
// Fail-closed: if upsert errors, the sign-in flow returns 302 to /auth/error?code=USER_UPSERT_FAILED.
import { mongo } from "@/server/db/mongo";
import { traceId } from "@/server/obs/trace";
import { sentry } from "@/server/obs/sentry.server";
import { defaultSignInConsents } from "@/server/legal/disclosure-consent";

export type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  provider?: "google" | "magic-link";
};

export type UpsertResult =
  | { ok: true; userId: string }
  | { ok: false; traceId: string; reason: "missing_email" | "unverified_email" | "db_error" };

export async function upsertUserOnSignIn(profile: GoogleProfile): Promise<UpsertResult> {
  const trace = traceId();

  if (!profile.email) return { ok: false, traceId: trace, reason: "missing_email" };
  if (profile.email_verified === false) return { ok: false, traceId: trace, reason: "unverified_email" };

  try {
    const col = mongo.db("salenoti").collection("users");
    const now = new Date();
    const email = profile.email.toLowerCase();
    const provider = profile.provider ?? "google";
    const consents = defaultSignInConsents(now);

    const doc = await col.findOneAndUpdate(
      { email },
      {
        $setOnInsert: {
          email,
          plan: "free",
          notificationChannels: { email: true, webPush: false, telegram: false },
          passwordHash: null,
          consents,
          createdAt: now,
        },
        $set: { updatedAt: now },
        $addToSet: {
          oauthProviders: { provider, providerAccountId: profile.sub },
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    if (!doc) return { ok: false, traceId: trace, reason: "db_error" };
    return { ok: true, userId: String(doc._id) };
  } catch (e) {
    sentry.captureException(e, { tags: { trace, fr: "FR-AUTH-001" } });
    return { ok: false, traceId: trace, reason: "db_error" };
  }
}
