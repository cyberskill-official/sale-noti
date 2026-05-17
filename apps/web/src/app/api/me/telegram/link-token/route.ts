// FR-NOTIF-003 §1 #3 — issue a daily-rotated Telegram link token for the authenticated user.
import crypto from "crypto";

export const runtime = "nodejs";

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

export async function GET(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const salt = process.env.TELEGRAM_LINK_SALT ?? "";
  const token = crypto.createHash("sha256").update(`${userId}|${salt}|${dayBucket()}`).digest("hex").slice(0, 16);
  const botName = process.env.TELEGRAM_BOT_NAME ?? "SaleNotiBot";
  return Response.json({
    ok: true,
    token,
    deepLink: `https://t.me/${botName}?start=${token}`,
    expiresIn: 86_400, // 24h
  });
}
