// FR-AUTH-002 — POST /api/auth/magic-link/issue
import { z } from "zod";
import { issueMagicLink } from "@/server/auth/magic-link/issue";
import { rateLimitFixed } from "@/server/auth/rate-limit";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email().max(255) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";

  // FR-AUTH-002 §1 #6 — 3/min/email AND 10/min/IP
  const perEmail = await rateLimitFixed(`ml:issue:email:${parsed.data.email}`, 3, 60);
  const perIp = await rateLimitFixed(`ml:issue:ip:${ip}`, 10, 60);
  if (!perEmail.ok || !perIp.ok) {
    return Response.json(
      { ok: false, error: "rate_limit" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  await issueMagicLink({
    email: parsed.data.email,
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
  });

  // FR-AUTH-002 §1 #4 — always 200, do not leak email existence
  return Response.json({
    ok: true,
    message: "If that email is registered or eligible, a sign-in link is on its way.",
  });
}
