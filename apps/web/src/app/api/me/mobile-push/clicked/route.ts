// FR-NOTIF-004 §1 #9 — POST /v1/me/mobile-push/clicked
// Record notification click for audit/attribution.
// Updates notifications.clickedAt for the given idempotency key.
import { z } from "zod";
import { mongo } from "@/server/db/mongo";

export const runtime = "nodejs";

const Body = z.object({
  idem: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "validation_failed" }, { status: 400 });
  }

  const now = new Date();

  // Update the notifications row with the matching idem and channel.
  // This is a best-effort update; the notification may have already been clicked or expired.
  await mongo
    .db("salenoti")
    .collection("notifications")
    .updateOne(
      { idem: parsed.data.idem, channel: "mobilePush" },
      { $set: { clickedAt: now } }
    );

  // Always respond OK; beacons are fire-and-forget.
  return Response.json({ ok: true });
}
