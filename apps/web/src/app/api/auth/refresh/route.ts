// FR-AUTH-003 — POST /api/auth/refresh
import { rotateRefresh } from "@/server/auth/refresh";
import { rateLimitFixed } from "@/server/auth/rate-limit";
import { REFRESH_COOKIE } from "@/server/auth/session";

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const raw = readCookie(req, REFRESH_COOKIE);

  // FR-AUTH-003 §1 #6 — 30/min/user (we don't know user yet, key by raw-token hash prefix)
  const rlKey = raw ? `refresh:${raw.slice(0, 8)}` : `refresh:noip:${ip}`;
  const limit = await rateLimitFixed(rlKey, 30, 60);
  if (!limit.ok) return Response.json({ ok: false, code: "rate_limit" }, { status: 429, headers: { "Retry-After": "60" } });

  const result = await rotateRefresh(raw);
  if (!result.ok) {
    return Response.json({ ok: false, code: result.code }, { status: 401 });
  }
  return new Response(JSON.stringify({ ok: true, expiresIn: 900 }), {
    status: 200,
    headers: [
      ["content-type", "application/json"],
      ...result.setCookies.map((c) => ["set-cookie", c] as [string, string]),
    ] as unknown as Headers,
  });
}

// FR-AUTH-003 §1 #8 — CORS preflight from chrome-extension origin
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const extId = process.env.EXT_ID ?? "";
  const allowed = origin === `chrome-extension://${extId}` || origin === (process.env.APP_URL ?? "http://localhost:3000");
  if (!allowed) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    },
  });
}
