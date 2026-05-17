import { Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";

const EXPORT_COLLECTIONS = [
  "users",
  "watchlists",
  "notifications",
  "subscriptions",
  "referrals",
  "referral_rewards",
  "shares",
  "share_clicks",
  "b2b_leads",
] as const;

@Injectable()
export class DsrExportService {
  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const oid = new ObjectId(userId);
    const db = mongo.db("salenoti");
    const out: Record<string, unknown> = { userId, exportedAt: new Date().toISOString() };

    for (const collection of EXPORT_COLLECTIONS) {
      const query =
        collection === "users"
          ? { _id: oid }
          : {
              $or: [
                { userId: oid },
                { userId },
                { sharerUserId: oid },
                { sharerUserId: userId },
                { referredId: oid },
                { referrerId: oid },
              ],
            };
      out[collection] = await db.collection(collection).find(query).limit(10_000).toArray();
    }

    await db.collection("privacy_audit_log").insertOne({
      userId: oid,
      action: "dsr_export",
      createdAt: new Date(),
      collectionCount: EXPORT_COLLECTIONS.length,
    });

    return out;
  }
}
