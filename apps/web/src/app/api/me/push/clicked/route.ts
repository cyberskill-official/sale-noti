// FR-NOTIF-002 §1 #10 — click attribution beacon from service worker.
import { z } from "zod";
import { mongo } from "@/server/db/mongo";

export const runtime = "nodejs";

const Body = z.object({ idem: z.string().min(8).max(128) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  await mongo.db("salenoti").collection("notifications").updateOne(
    { idem: parsed.data.idem, channel: "webPush", clickedAt: null },
    { $set: { clickedAt: new Date() } }
  );
  return Response.json({ ok: true });
}
