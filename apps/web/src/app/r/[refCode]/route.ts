// FR-GROW-001 §1 #3 — referral landing /r/<refCode> → 302 to / with cookie set.
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ refCode: string }> }) {
  const { refCode } = await params;
  // Tolerant validation; bad inputs just drop the cookie.
  if (!/^[A-Za-z0-9]{8}$/.test(refCode)) {
    return Response.redirect(new URL("/", req.url), 302);
  }
  const cookie = `salenoti.ref=${refCode}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax`;
  return new Response(null, {
    status: 302,
    headers: [
      ["location", "/"],
      ["set-cookie", cookie],
    ] as unknown as Headers,
  });
}
