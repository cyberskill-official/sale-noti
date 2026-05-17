export const runtime = "nodejs";

export async function POST(req: Request) {
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";
  const body = await req.text();
  const res = await fetch(`${apiUrl}/api/public/b2b-contact`, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      "User-Agent": req.headers.get("user-agent") ?? "SaleNoti-Web",
      Referer: req.headers.get("referer") ?? "",
      "X-Forwarded-For": req.headers.get("x-forwarded-for") ?? "",
    },
    body,
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
