import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
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
  async requestExport(userId: string): Promise<{ traceId: string; expectedDeliveryAt: Date }> {
    const oid = new ObjectId(userId);
    const now = new Date();
    const traceId = `dsr_${crypto.randomUUID()}`;
    const expectedDeliveryAt = new Date(now.getTime() + 30 * 86_400_000);
    const db = mongo.db("salenoti");

    await db.collection("privacy_export_requests").insertOne({
      traceId,
      userId: oid,
      status: "queued",
      requestedAt: now,
      expectedDeliveryAt,
    });

    await db.collection("privacy_audit_log").insertOne({
      userId: oid,
      action: "dsr_export_requested",
      traceId,
      createdAt: now,
    });

    return { traceId, expectedDeliveryAt };
  }

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
