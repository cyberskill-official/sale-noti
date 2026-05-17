// FR-AUTH-003 — current refresh-token family introspection/revoke surface.
import { mongo } from "@/server/db/mongo";
import { REFRESH_COOKIE } from "@/server/auth/session";
import { revokeFamily } from "@/server/auth/refresh";
import crypto from "crypto";

export const runtime = "nodejs";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function hash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function GET(req: Request) {
  const raw = readCookie(req, REFRESH_COOKIE);
  if (!raw) return Response.json({ ok: false, error: "no_session" }, { status: 401 });

  const current = await mongo.db("salenoti").collection("refresh_tokens").findOne({ tokenHash: hash(raw) });
  if (!current) return Response.json({ ok: false, error: "no_session" }, { status: 401 });

  const sessions = await mongo
    .db("salenoti")
    .collection("refresh_tokens")
    .aggregate([
      { $match: { userId: current.userId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$family",
          createdAt: { $min: "$createdAt" },
          lastSeenAt: { $max: "$createdAt" },
          revoked: { $max: "$revoked" },
          method: { $first: "$method" },
          current: { $max: { $eq: ["$family", current.family] } },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: 20 },
    ])
    .toArray();

  return Response.json({
    ok: true,
    sessions: sessions.map((s) => ({
      familyId: s._id,
      method: s.method,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      revoked: Boolean(s.revoked),
      current: Boolean(s.current),
    })),
  });
}

export async function DELETE(req: Request) {
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
