// FR-AUTH-002 — GET /api/auth/magic-link/consume?token=...
import { consumeMagicLink } from "@/server/auth/magic-link/consume";
import { rateLimitFixed } from "@/server/auth/rate-limit";
import { createInitialRefreshSession } from "@/server/auth/refresh";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const ua = req.headers.get("user-agent") ?? "";

  // FR-AUTH-002 §1 #7 — 20/min/IP on consume
  const limit = await rateLimitFixed(`ml:consume:ip:${ip}`, 20, 60);
  if (!limit.ok) return Response.redirect(new URL("/auth/error?code=rate_limit", req.url), 302);

  const result = await consumeMagicLink(token);
  if (!result.ok) {
    const params = new URLSearchParams({ code: result.code });
    if (result.trace) params.set("trace", result.trace);
    return Response.redirect(new URL(`/auth/error?${params.toString()}`, req.url), 302);
  }

  // FR-AUTH-003 — create refresh session + JWT access token.
  const setCookies = await createInitialRefreshSession({ userId: result.userId, ip, ua });

  return new Response(null, {
    status: 302,
    headers: [
      ["location", "/dashboard"],
      ...setCookies.map((c) => ["set-cookie", c] as [string, string]),
    ] as unknown as Headers,
  });
}
