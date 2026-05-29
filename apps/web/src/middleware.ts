// FR-AUTH-001/003 — protect /dashboard/* and /api/admin/** without importing Node-only Auth.js callbacks into Edge middleware.
import type { NextRequest } from "next/server";

export default function middleware(req: NextRequest) {
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token") ||
    req.cookies.has("salenoti.session-token");

  const isDashboard = req.nextUrl.pathname.startsWith("/dashboard");
  const isAdminApi = req.nextUrl.pathname.startsWith("/api/admin");

  if (!hasSession && (isDashboard || isAdminApi)) {
    const signInUrl = new URL("/auth/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(signInUrl);
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/admin/:path*"],
};
