import { Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";

@Injectable()
export class DsrDeleteService {
  async requestErasure(userId: string, reason: string): Promise<{ erasureRequestId: string; purgeAfter: Date }> {
    const oid = new ObjectId(userId);
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const result = await mongo.db("salenoti").collection("privacy_erasure_requests").insertOne({
      userId: oid,
      reason,
      status: "pending_24h_soft_tombstone",
      requestedAt: now,
      purgeAfter,
    });

    await mongo.db("salenoti").collection("users").updateOne(
      { _id: oid },
      {
        $set: {
          deletedAt: now,
          erasureRequestId: result.insertedId,
          status: "pending_erasure",
        },
      }
    );

    await mongo.db("salenoti").collection("privacy_audit_log").insertOne({
      userId: oid,
      action: "dsr_delete_requested",
      erasureRequestId: result.insertedId,
      reason,
      createdAt: now,
    });

    return { erasureRequestId: String(result.insertedId), purgeAfter };
  }

  async purgeUserPii(userId: string, reason: string): Promise<{ ok: true }> {
    const oid = new ObjectId(userId);
    const db = mongo.db("salenoti");
    const now = new Date();
    await Promise.all([
      db.collection("users").updateOne(
        { _id: oid },
        {
          $set: {
            email: null,
            name: null,
            phone: null,
            status: "erased",
            purgedAt: now,
          },
        }
      ),
      db.collection("magic_link_tokens").deleteMany({ email: { $exists: true }, userId: oid }),
      db.collection("refresh_tokens").updateMany(
        { userId },
        { $set: { revoked: true, revokedAt: now, revokeReason: "pdpl_erasure" } }
      ),
      db.collection("watchlists").updateMany({ userId: oid }, { $set: { status: "deleted", deletedAt: now } }),
    ]);

    await db.collection("privacy_audit_log").insertOne({
      userId: oid,
      action: "dsr_purge",
      reason,
      createdAt: now,
    });
    return { ok: true };
  }
}
