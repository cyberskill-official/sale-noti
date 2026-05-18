// FR-AUTH-003 §1 #7 — POST /api/auth/sign-out
import { revokeFamily, revokeFamilyById } from "@/server/auth/refresh";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/server/auth/session";

export const runtime = "nodejs";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function POST(req: Request) {
  const access = readCookie(req, ACCESS_COOKIE);
  if (access) {
    const claims = await verifyAccessToken(access);
    if (claims) await revokeFamilyById(claims.familyId, claims.sub);
  }
  const raw = readCookie(req, REFRESH_COOKIE);
  const setCookies = await revokeFamily(raw);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: [
      ["content-type", "application/json"],
      ...setCookies.map((c) => ["set-cookie", c] as [string, string]),
    ] as unknown as Headers,
  });
}
