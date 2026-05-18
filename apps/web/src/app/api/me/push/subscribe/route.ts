// FR-NOTIF-002 §1 #3 — POST /v1/me/push/subscribe
import { z } from "zod";
import { mongo } from "@/server/db/mongo";
import { ObjectId } from "mongodb";
import { rateLimitFixed } from "@/server/auth/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

function readUserId(req: Request): string | null {
  return req.headers.get("x-user-id");
}

export async function POST(req: Request) {
  const userId = readUserId(req);
  if (!userId) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const limit = await rateLimitFixed(`push:subscribe:${userId}`, 5, 60);
  if (!limit.ok) {
    return Response.json({ ok: false, error: "rate_limit", retryAfter: 60 }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "validation_failed" }, { status: 400 });

  const userOid = (() => {
    try {
      return new ObjectId(userId);
    } catch {
      return null;
    }
  })();
  if (!userOid) return Response.json({ ok: false, error: "invalid_user_id" }, { status: 400 });

  // Cap 5 subscriptions per user; replace by endpoint if same.
  // Cast: the `users` collection isn't strongly typed at this layer; MongoDB's $pull/$push
  // operator-shape inference rejects nested fields under the default Document type.
  // Runtime semantics are correct.
  await mongo.db("salenoti").collection("users").updateOne(
    { _id: userOid },
    {
      $pull: { pushSubscriptions: { endpoint: parsed.data.endpoint } },
    } as any
  );
  await mongo.db("salenoti").collection("users").updateOne(
    { _id: userOid },
    {
      $push: {
        pushSubscriptions: {
          $each: [{ ...parsed.data, addedAt: new Date() }],
          $slice: -5, // keep most-recent 5
        },
      },
      $set: { "notificationChannels.webPush": true, updatedAt: new Date() },
    } as any
  );

  const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid }, { projection: { pushSubscriptions: 1 } });
  return Response.json({ ok: true, deviceCount: user?.pushSubscriptions?.length ?? 1 });
}
