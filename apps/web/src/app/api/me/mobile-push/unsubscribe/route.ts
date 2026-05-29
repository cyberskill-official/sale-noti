// FR-NOTIF-004 §1 #6 — POST /v1/me/mobile-push/unsubscribe
// Unsubscribe device token(s).
import { z } from "zod";
import { mongo } from "@/server/db/mongo";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().optional(),
});

function readUserId(req: Request): string | null {
  return req.headers.get("x-user-id");
}

export async function POST(req: Request) {
  const userId = readUserId(req);
  if (!userId) {
    return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "validation_failed" }, { status: 400 });
  }

  const userOid = (() => {
    try {
      return new ObjectId(userId);
    } catch {
      return null;
    }
  })();
  if (!userOid) {
    return Response.json({ ok: false, error: "invalid_user_id" }, { status: 400 });
  }

  // FR-NOTIF-004 §1 #11: Cleanup targets token value, not deviceId alone.
  if (parsed.data.token) {
    // Remove specific token.
    await mongo
      .db("salenoti")
      .collection("users")
      .updateOne(
        { _id: userOid },
        {
          $pull: { mobilePushTokens: { token: parsed.data.token } } as any,
          $set: { updatedAt: new Date() },
        }
      );
  } else {
    // Remove all tokens.
    await mongo
      .db("salenoti")
      .collection("users")
      .updateOne(
        { _id: userOid },
        {
          $set: {
            mobilePushTokens: [],
            "notificationChannels.mobilePush": false,
            updatedAt: new Date(),
          },
        }
      );
  }

  return Response.json({ ok: true });
}
