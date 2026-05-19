// FR-AUTH-003 §1 #10 — revoke a specific authenticated session family.
import { revokeFamilyById } from "@/server/auth/refresh";
import { ACCESS_COOKIE, verifyAccessToken } from "@/server/auth/session";

export const runtime = "nodejs";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function DELETE(req: Request, ctx: { params: Promise<{ familyId: string }> }) {
  const access = readCookie(req, ACCESS_COOKIE);
  const claims = access ? await verifyAccessToken(access) : null;
  if (!claims) return Response.json({ ok: false, error: "no_session" }, { status: 401 });

  const { familyId } = await ctx.params;
  const revoked = await revokeFamilyById(familyId, claims.sub);
  if (!revoked) return Response.json({ ok: false, error: "session_not_found" }, { status: 404 });
  return Response.json({ revoked: true });
}
