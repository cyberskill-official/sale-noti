// FR-NOTIF-002 §1 #11 — explicit unsubscribe.
import { z } from "zod";
import { mongo } from "@/server/db/mongo";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";

const Body = z.object({ endpoint: z.string().url().optional() });

export async function POST(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ ok: false, error: "validation_failed" }, { status: 400 });

  const userOid = (() => {
    try {
      return new ObjectId(userId);
    } catch {
      return null;
    }
  })();
  if (!userOid) return Response.json({ ok: false, error: "invalid_user_id" }, { status: 400 });

  if (parsed.data.endpoint) {
    // Cast: untyped collection — see push/subscribe route for context.
    await mongo.db("salenoti").collection("users").updateOne(
      { _id: userOid },
      { $pull: { pushSubscriptions: { endpoint: parsed.data.endpoint } } } as any
    );
  } else {
    await mongo.db("salenoti").collection("users").updateOne(
      { _id: userOid },
      { $set: { pushSubscriptions: [], "notificationChannels.webPush": false } }
    );
  }
  return Response.json({ ok: true });
}
