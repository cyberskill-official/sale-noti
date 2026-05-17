// FR-AUTH-001/003 — protect /dashboard/* without importing Node-only Auth.js callbacks into Edge middleware.
import type { NextRequest } from "next/server";

export default function middleware(req: NextRequest) {
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token") ||
    req.cookies.has("salenoti.session-token");

  if (!hasSession && req.nextUrl.pathname.startsWith("/dashboard")) {
    const signInUrl = new URL("/auth/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(signInUrl);
  }
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
