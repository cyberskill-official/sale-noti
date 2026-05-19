// FR-AUTH-001 §3 — Auth.js v5 handler mount.
// runtime=nodejs is required because the mongodb driver doesn't run on Edge.
import { handlers } from "@/auth";
import { enforceGoogleCallbackRateLimit } from "@/server/auth/google-callback-rate-limit";
import type { NextRequest } from "next/server";

export const GET = handlers.GET;

export async function POST(req: NextRequest) {
  const limited = await enforceGoogleCallbackRateLimit(req);
  if (limited) return limited;
  return handlers.POST(req);
}

export const runtime = "nodejs";
