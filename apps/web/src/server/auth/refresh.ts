// FR-AUTH-003 §6 — refresh token rotation with reuse-detection.
import crypto from "crypto";
import type { ClientSession } from "mongodb";
import { mongo } from "@/server/db/mongo";
import { sentry } from "@/server/obs/sentry.server";
import { posthogServer } from "@/server/obs/posthog.server";
import { signAccessToken, buildAccessCookie, buildRefreshCookie, ACCESS_COOKIE, REFRESH_COOKIE, buildClearCookie } from "./session";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RotateResult =
  | { ok: true; setCookies: string[] }
  | { ok: false; code: "no_token" | "expired" | "session_revoked" | "reuse_detected" };

function hash(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function hashRefreshToken(raw: string): string {
  return hash(raw);
}

function hashForAudit(value: string, saltName: "IP_HASH_SALT" | "UA_HASH_SALT" = "IP_HASH_SALT"): string {
  const salt = process.env[saltName] ?? process.env.POSTHOG_PII_SALT ?? "local-dev-salt";
  return crypto.createHash("sha256").update(`${value}|${salt}`).digest("hex");
}

function summarizeUa(ua: string): string {
  if (/Chrome/i.test(ua)) return /Mac/i.test(ua) ? "Chrome on macOS" : "Chrome";
  if (/Firefox/i.test(ua)) return "Firefox";
  if (/Safari/i.test(ua)) return /Mobile/i.test(ua) ? "Mobile Safari" : "Safari";
  if (/SaleNotiExtension/i.test(ua)) return "Chrome Extension";
  return "Unknown client";
}

function newRaw() {
  return crypto.randomBytes(32).toString("base64url");
}

async function runRefreshMutation<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
  const transactional = mongo as typeof mongo & {
    withTransaction?: (inner: (session: ClientSession) => Promise<T>) => Promise<T>;
  };
  if (typeof transactional.withTransaction !== "function") return fn();

  let lastError: unknown;
  for (const delay of [0, 50]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await transactional.withTransaction((session) => fn(session));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
      ip_hash: hashForAudit(input.ip),
      ua_hash: hashForAudit(input.ua, "UA_HASH_SALT"),
      ua_summary: summarizeUa(input.ua),
    });
  posthogServer.capture("auth_session_created", input.userId, { method, fr: "FR-AUTH-003" });
  const access = await signAccessToken({ userId: input.userId, familyId: family, method, plan: "free" });
  return [buildAccessCookie(access), buildRefreshCookie(raw)];
}

export async function rotateRefresh(rawRefresh: string | null | undefined): Promise<RotateResult> {
  if (!rawRefresh) return { ok: false, code: "no_token" };
  const tokenHash = hash(rawRefresh);
  const col = mongo.db("salenoti").collection("refresh_tokens");
  const now = new Date();

  return runRefreshMutation(async (session) => {
    const newRaw = crypto.randomBytes(32).toString("base64url");
    const newHash = hash(newRaw);
    const row = await col.findOneAndUpdate(
      { tokenHash, used: false, revoked: false, expiresAt: { $gt: now } },
      { $set: { used: true, usedAt: now, rotatedTo: newHash } },
      { returnDocument: "before", session }
    );

    if (!row) {
      const existing = await col.findOne({ tokenHash }, { session });
      if (!existing) return { ok: false, code: "no_token" };
      if (existing.revoked) return { ok: false, code: "session_revoked" };
      if (existing.expiresAt < now) return { ok: false, code: "expired" };
      if (existing.used) {
        await col.updateMany(
          { family: existing.family },
          { $set: { revoked: true, revokedAt: now, revokeReason: "reuse_detected" } },
          { session }
        );
        sentry.captureMessage("auth_reuse_detected", {
          level: "error",
          tags: {
            fr: "FR-AUTH-003",
            kind: "reuse_detected",
            family: existing.family,
            userId: hashForAudit(String(existing.userId)).slice(0, 12),
          },
        });
        return { ok: false, code: "reuse_detected" };
      }
      return { ok: false, code: "no_token" };
    }

    await col.insertOne(
      {
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
        createdAt: now,
        ip_hash: row.ip_hash,
        ua_hash: row.ua_hash,
        ua_summary: row.ua_summary,
      },
      { session }
    );

    const familyAgeDays = Math.max(0, (Date.now() - new Date(row.createdAt).getTime()) / 86_400_000);
    posthogServer.capture("auth_session_refreshed", row.userId, {
      family_age_days: Number(familyAgeDays.toFixed(3)),
      fr: "FR-AUTH-003",
    });

    const access = await signAccessToken({
      userId: row.userId,
      familyId: row.family,
      method: row.method,
      plan: row.plan ?? "free",
    });
    return { ok: true, setCookies: [buildAccessCookie(access), buildRefreshCookie(newRaw)] };
  });
}

export async function revokeFamilyById(familyId: string, userId?: string): Promise<boolean> {
  const filter = userId ? { family: familyId, userId } : { family: familyId };
  const result = await mongo
    .db("salenoti")
    .collection("refresh_tokens")
    .updateMany(filter, { $set: { revoked: true, revokedAt: new Date(), revokeReason: "user_signout" } });
  if (userId && result.modifiedCount > 0) {
    posthogServer.capture("auth_session_revoked", userId, { reason: "user_signout", fr: "FR-AUTH-003" });
  }
  return result.modifiedCount > 0;
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
          { $set: { revoked: true, revokedAt: new Date(), revokeReason: "user_signout" } }
        );
      posthogServer.capture("auth_session_revoked", row.userId, { reason: "user_signout", fr: "FR-AUTH-003" });
    }
  }
  return [buildClearCookie(ACCESS_COOKIE, "/"), buildClearCookie(REFRESH_COOKIE, "/api/auth/refresh")];
}
