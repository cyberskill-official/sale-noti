// FR-LEGAL-002 §1 #4/#5/#16 — explicit disclosure consent acknowledgment.
import { ACCESS_COOKIE, verifyAccessToken } from "@/server/auth/session";
import {
  AFFILIATE_DISCLOSURE_KIND,
  PRIVACY_CONSENT_KIND,
  type ConsentKind,
  recordDisclosureConsent,
} from "@/server/legal/disclosure-consent";

export const runtime = "nodejs";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const extId = process.env.EXT_ID ?? "";
  const allowed = Boolean(extId) && origin === `chrome-extension://${extId}`;
  return allowed
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    : {};
}

function isConsentKind(value: unknown): value is ConsentKind {
  return value === AFFILIATE_DISCLOSURE_KIND || value === PRIVACY_CONSENT_KIND;
}

export async function POST(req: Request) {
  const access = readCookie(req, ACCESS_COOKIE);
  const claims = access ? await verifyAccessToken(access) : null;
  if (!claims) return Response.json({ ok: false, error: "no_session" }, { status: 401, headers: corsHeaders(req) });

  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; source?: unknown };
  const kind = body.kind ?? AFFILIATE_DISCLOSURE_KIND;
  if (!isConsentKind(kind)) {
    return Response.json({ ok: false, error: "invalid_consent_kind" }, { status: 400, headers: corsHeaders(req) });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const recorded = await recordDisclosureConsent({
    userId: claims.sub,
    kind,
    ip,
    userAgent,
    source: body.source === "extension" ? "extension" : "api",
  });

  if (!recorded)
    return Response.json({ ok: false, error: "user_not_found" }, { status: 404, headers: corsHeaders(req) });
  return Response.json({ ok: true, kind }, { status: 200, headers: corsHeaders(req) });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
