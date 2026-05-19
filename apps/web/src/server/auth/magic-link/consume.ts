// FR-AUTH-002 §6 — consume magic-link.
// Atomic single-use: findOneAndUpdate with consumed:false guard.
import crypto from "crypto";
import { mongo } from "@/server/db/mongo";
import { posthogServer } from "@/server/obs/posthog.server";
import { sentry } from "@/server/obs/sentry.server";
import { upsertUserOnSignIn } from "@/server/users/upsert-on-signin";

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; code: "invalid_or_expired_token" | "USER_UPSERT_FAILED"; trace?: string };

export async function consumeMagicLink(rawToken: string): Promise<ConsumeResult> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();
  const row = await mongo
    .db("salenoti")
    .collection("magic_link_tokens")
    .findOneAndUpdate(
      { tokenHash, consumed: false, expiresAt: { $gt: now } },
      { $set: { consumed: true, consumedAt: now } },
      { returnDocument: "before" }
  );

  if (!row) {
    sentry.addBreadcrumb?.({
      category: "auth.magic_link.rejected",
      level: "warning",
      data: { fr: "FR-AUTH-002", reason: "invalid_or_expired_token" },
    });
    return { ok: false, code: "invalid_or_expired_token" };
  }

  const result = await upsertUserOnSignIn({
    sub: `magic-link:${row.email}`,
    email: row.email,
    email_verified: true,
    provider: "magic-link",
  });

  if (!result.ok) {
    sentry.addBreadcrumb?.({
      category: "auth.magic_link.rejected",
      level: "warning",
      data: { fr: "FR-AUTH-002", reason: result.reason, trace: result.traceId },
    });
    return { ok: false, code: "USER_UPSERT_FAILED", trace: result.traceId };
  }

  sentry.addBreadcrumb?.({
    category: "auth.magic_link.consumed",
    level: "info",
    data: { fr: "FR-AUTH-002" },
  });
  posthogServer.capture("auth_sign_in", result.userId, {
    fr: "FR-AUTH-002",
    method: "magic-link",
    auth_sign_in_method: "magic-link",
    outcome: "succeeded",
  });

  return { ok: true, userId: result.userId, email: row.email };
}
