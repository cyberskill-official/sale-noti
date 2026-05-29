// FR-NOTIF-004 §1 #5/#6 — POST /v1/me/mobile-push/subscribe
// Register device push token (Expo Notifications).
// Upserts by token; refresh lastSeenAt; preserve addedAt.
import { z } from "zod";
import { mongo } from "@/server/db/mongo";
import { ObjectId } from "mongodb";
import { rateLimitFixed } from "@/server/auth/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().min(1),
  platform: z.enum(["android", "ios"]),
  appVersion: z.string().optional(),
});

function readUserId(req: Request): string | null {
  return req.headers.get("x-user-id");
}

export async function POST(req: Request) {
  const userId = readUserId(req);
  if (!userId) {
    return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const limit = await rateLimitFixed(`mobilePush:subscribe:${userId}`, 5, 60);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "rate_limit", retryAfter: 60 },
      { status: 429, headers: { "Retry-After": "60" } }
    );
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

  const now = new Date();

  // FR-NOTIF-004 §1 #5: Upsert by token value.
  // - If token already exists: refresh lastSeenAt, preserve addedAt, don't increase length.
  // - If token is new: add with addedAt = now, lastSeenAt = now.
  const user = await mongo
    .db("salenoti")
    .collection("users")
    .findOne({ _id: userOid }, { projection: { mobilePushTokens: 1 } });

  const existingToken = user?.mobilePushTokens?.find(
    (t: any) => t.token === parsed.data.token
  );

  if (existingToken) {
    // Token already registered: refresh lastSeenAt only.
    await mongo.db("salenoti").collection("users").updateOne(
      { _id: userOid, "mobilePushTokens.token": parsed.data.token },
      {
        $set: { "mobilePushTokens.$[elem].lastSeenAt": now },
      } as any,
      { arrayFilters: [{ "elem.token": parsed.data.token }] } as any
    );
  } else {
    // New token: add to array (cap at 5 devices with FIFO eviction).
    await mongo.db("salenoti").collection("users").updateOne(
      { _id: userOid },
      {
        $push: {
          mobilePushTokens: {
            $each: [
              {
                token: parsed.data.token,
                platform: parsed.data.platform,
                deviceId: undefined,
                appVersion: parsed.data.appVersion,
                addedAt: now,
                lastSeenAt: now,
              },
            ],
            $slice: -5, // keep most-recent 5
          },
        },
        $set: { "notificationChannels.mobilePush": true, updatedAt: now },
      } as any
    );
  }

  const updated = await mongo
    .db("salenoti")
    .collection("users")
    .findOne({ _id: userOid }, { projection: { mobilePushTokens: 1 } });

  return Response.json({
    ok: true,
    deviceCount: updated?.mobilePushTokens?.length ?? 1,
  });
}
