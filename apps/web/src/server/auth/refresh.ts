// FR-AUTH-003 §6 — refresh token rotation with reuse-detection.
import crypto from "node:crypto";
import { mongo } from "@/server/db/mongo";
import { sentry } from "@/server/obs/sentry.server";
import { signAccessToken, buildAccessCookie, buildRefreshCookie, ACCESS_COOKIE, REFRESH_COOKIE, buildClearCookie } from "./session";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RotateResult =
  | { ok: true; setCookies: string[] }
  | { ok: false; code: "no_token" | "expired" | "session_revoked" | "reuse_detected" };

function hash(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function newRaw() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createInitialRefreshSession(input: {
  userId: string;
  ip: string;
  ua: string;
  method?: "google" | "magic-link";
}): Promise<string[]> {
  const method = input.method ?? "magic-link";
  const family = crypto.randomUUID();
  const raw = newRaw();
  const tokenHash = hash(raw);
  await mongo
    .db("salenoti")
    .collection("refresh_tokens")
    .insertOne({
      tokenHash,
      userId: input.userId,
      family,
      method,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      used: false,
      usedAt: null,
      rotatedTo: null,
      revoked: false,
      revokedAt: null,
      revokeReason: null,
      createdAt: new Date(),
      ip: input.ip,
      ua: input.ua.slice(0, 200),
    });
  const access = await signAccessToken({ userId: input.userId, familyId: family, method });
  return [buildAccessCookie(access), buildRefreshCookie(raw)];
}

export async function rotateRefresh(rawRefresh: string | null | undefined): Promise<RotateResult> {
  if (!rawRefresh) return { ok: false, code: "no_token" };
  const tokenHash = hash(rawRefresh);
  const col = mongo.db("salenoti").collection("refresh_tokens");

  // No Mongo transaction — Atlas M0 doesn't support them. Use two-stage atomic update with reuse-detect afterwards.
  const row = await col.findOne({ tokenHash });
  if (!row) return { ok: false, code: "no_token" };
  if (row.revoked) return { ok: false, code: "session_revoked" };
  if (row.expiresAt < new Date()) return { ok: false, code: "expired" };

  if (row.used) {
    // Reuse-detection: revoke entire family
    await col.updateMany(
      { family: row.family },
      { $set: { revoked: true, revokedAt: new Date(), revokeReason: "reuse_detected" } }
    );
    sentry.captureMessage("Refresh token reuse detected — family revoked", {
      level: "error",
      tags: { fr: "FR-AUTH-003", kind: "reuse_detected" },
      extra: { userId: row.userId, family: row.family },
    });
    return { ok: false, code: "reuse_detected" };
  }

  const newRaw = crypto.randomBytes(32).toString("base64url");
  const newHash = hash(newRaw);
  await col.updateOne({ _id: row._id, used: false }, { $set: { used: true, usedAt: new Date(), rotatedTo: newHash } });
  await col.insertOne({
    tokenHash: newHash,
    userId: row.userId,
    family: row.family,
    method: row.method,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    used: false,
    usedAt: null,
    rotatedTo: null,
    revoked: false,
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date(),
    ip: row.ip,
    ua: row.ua,
  });

  const access = await signAccessToken({ userId: row.userId, familyId: row.family, method: row.method });
  return { ok: true, setCookies: [buildAccessCookie(access), buildRefreshCookie(newRaw)] };
}

export async function revokeFamily(rawRefresh: string | null | undefined): Promise<string[]> {
  if (rawRefresh) {
    const row = await mongo.db("salenoti").collection("refresh_tokens").findOne({ tokenHash: hash(rawRefresh) });
    if (row) {
      await mongo
        .db("salenoti")
        .collection("refresh_tokens")
        .updateMany(
          { family: row.family },
          { $set: { revoked: true, revokedAt: new Date(), revokeReason: "user_signed_out" } }
        );
    }
  }
  return [buildClearCookie(ACCESS_COOKIE, "/"), buildClearCookie(REFRESH_COOKIE, "/api/auth/refresh")];
}
