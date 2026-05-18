// FR-AUTH-003 — JWT access token signing (15-min).
// HS256 with AUTH_SECRET; symmetric since both signer and verifier live in our app.
import crypto from "crypto";

const ACCESS_TTL_SEC = 15 * 60;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export type AccessClaims = {
  sub: string; // userId
  plan: string;
  familyId: string;
  jti: string;
  method: "google" | "magic-link";
  iat: number;
  exp: number;
};

export async function signAccessToken(input: {
  userId: string;
  familyId: string;
  method: AccessClaims["method"];
  plan?: string;
}): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET missing or too short");
  const now = Math.floor(Date.now() / 1000);
  const claims: AccessClaims = {
    sub: input.userId,
    plan: input.plan ?? "free",
    familyId: input.familyId,
    jti: crypto.randomUUID(),
    method: input.method,
    iat: now,
    exp: now + ACCESS_TTL_SEC,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  const current = process.env.AUTH_SECRET;
  if (!current) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  // TS doesn't narrow destructured tuples from .split() — explicit guard for type-soundness.
  if (!header || !payload || !sig) return null;

  const previous = process.env.AUTH_SECRET_N_MINUS_1;
  const previousUntil = Number(process.env.AUTH_SECRET_N_MINUS_1_ACCEPT_UNTIL_MS ?? "0");
  const candidates = [
    current,
    previous && (!previousUntil || Date.now() <= previousUntil) ? previous : null,
  ].filter(Boolean) as string[];

  const sigBuf = Buffer.from(sig);
  const verified = candidates.some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    const expBuf = Buffer.from(expected);
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  });
  if (!verified) return null;

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as AccessClaims;
  // Allow ±60s clock skew per FR-AUTH-003 §10 row 10
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now - 60) return null;
  if (claims.iat > now + 60) return null;
  return claims;
}

export const ACCESS_COOKIE = "authjs.session-token";
export const REFRESH_COOKIE = "authjs.refresh-token";

export function buildAccessCookie(token: string): string {
  return [
    `${ACCESS_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${ACCESS_TTL_SEC}`,
  ].join("; ");
}

export function buildRefreshCookie(rawToken: string): string {
  return [
    `${REFRESH_COOKIE}=${rawToken}`,
    "Path=/api/auth/refresh",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${30 * 24 * 60 * 60}`,
  ].join("; ");
}

export function buildClearCookie(name: string, path = "/"): string {
  return `${name}=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
