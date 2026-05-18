// FR-NOTIF-001 §1 #13 — token-authenticated one-click unsubscribe.
import { Controller, Get, HttpException, HttpStatus, Inject, Query } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { unsubscribeToken } from "./idempotency";

@Controller("unsubscribe")
export class UnsubscribeController {
  constructor(@Inject("OBS_POSTHOG") private readonly posthog: any) {}

  @Get()
  async unsubscribe(@Query("u") userId: string | undefined, @Query("t") token: string | undefined, @Query("watchlistId") watchlistId?: string) {
    if (!userId || !token) throw new HttpException({ ok: false, error: "missing_token" }, HttpStatus.UNAUTHORIZED);
    const expected = unsubscribeToken(userId, watchlistId ?? null);
    if (token !== expected) throw new HttpException({ ok: false, error: "invalid_token" }, HttpStatus.UNAUTHORIZED);

    if (watchlistId) {
      await mongo
        .db("salenoti")
        .collection("watchlists")
        .updateOne(
          { _id: toObjectId(watchlistId), userId: toObjectId(userId) } as any,
          { $pull: { "alertConfig.channels": "email" } as any, $set: { emailUnsubscribedAt: new Date() } },
        );
    } else {
      await mongo
        .db("salenoti")
        .collection("users")
        .updateOne({ _id: toObjectId(userId) } as any, { $set: { "notificationChannels.email": false } });
    }

    this.posthog.capture("notification_unsubscribed", {
      scope: watchlistId ? "watchlist" : "all",
      channel: "email",
    });
    return { ok: true };
  }
}

function toObjectId(id: string): ObjectId | string {
  return ObjectId.isValid(id) ? new ObjectId(id) : id;
}
