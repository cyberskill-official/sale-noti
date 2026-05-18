import { rateLimitFixed } from "@/server/auth/rate-limit";

export const GOOGLE_CALLBACK_RATE_LIMIT = {
  max: 10,
  windowSec: 60,
  retryAfterSec: 60,
} as const;

const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";

export function isGoogleCallbackRequest(req: Request): boolean {
  return new URL(req.url).pathname === GOOGLE_CALLBACK_PATH;
}

export function clientIpForAuth(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function enforceGoogleCallbackRateLimit(req: Request): Promise<Response | null> {
  if (!isGoogleCallbackRequest(req)) return null;

  const ip = clientIpForAuth(req);
  const limit = await rateLimitFixed(
    `auth:google-callback:ip:${ip}`,
    GOOGLE_CALLBACK_RATE_LIMIT.max,
    GOOGLE_CALLBACK_RATE_LIMIT.windowSec
  );

  if (limit.ok) return null;

  return Response.json(
    { error: "rate_limited", code: "AUTH_GOOGLE_CALLBACK_RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "Retry-After": String(GOOGLE_CALLBACK_RATE_LIMIT.retryAfterSec),
        "Cache-Control": "no-store",
      },
    }
  );
}
