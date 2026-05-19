// FR-AUTH-003 — current refresh-token family introspection/revoke surface.
import { mongo } from "@/server/db/mongo";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/server/auth/session";
import { revokeFamily, revokeFamilyById } from "@/server/auth/refresh";

export const runtime = "nodejs";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function GET(req: Request) {
  const access = readCookie(req, ACCESS_COOKIE);
  const claims = access ? await verifyAccessToken(access) : null;
  if (!claims) return Response.json({ ok: false, error: "no_session" }, { status: 401 });

  const rows = await mongo
    .db("salenoti")
    .collection("refresh_tokens")
    .find({ userId: claims.sub })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const byFamily = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const familyRows = byFamily.get(row.family) ?? [];
    familyRows.push(row);
    byFamily.set(row.family, familyRows);
  }

  return Response.json({
    ok: true,
    sessions: [...byFamily.entries()].slice(0, 20).map(([familyId, familyRows]) => {
      const createdAt = familyRows.reduce((min, row) => (row.createdAt < min ? row.createdAt : min), familyRows[0]!.createdAt);
      const lastRefreshedAt = familyRows.reduce(
        (max, row) => (row.createdAt > max ? row.createdAt : max),
        familyRows[0]!.createdAt
      );
      const active = familyRows.some((row) => !row.revoked);
      const latest = familyRows[0]!;
      return {
        familyId,
        method: latest.method,
        createdAt,
        lastRefreshedAt,
        ip_hash_prefix: String(latest.ip_hash ?? "").slice(0, 8),
        ua_summary: latest.ua_summary ?? "Unknown client",
        revoked: !active,
        current: familyId === claims.familyId,
      };
    }),
  });
}

export async function DELETE(req: Request) {
  const access = readCookie(req, ACCESS_COOKIE);
  const claims = access ? await verifyAccessToken(access) : null;
  if (claims) await revokeFamilyById(claims.familyId, claims.sub);
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
