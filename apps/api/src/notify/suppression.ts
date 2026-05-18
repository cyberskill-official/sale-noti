// FR-NOTIF-001 §1 #11 — suppression list (≥ 2 hard bounces OR ≥ 1 complaint).
import { mongo } from "../db/mongo";
import { emailHash } from "./idempotency";

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await mongo.db("salenoti").collection("suppression_list").findOne({ email_hash: emailHash(email) });
  return Boolean(row);
}

export async function recordBounce(email: string, kind: "hard" | "soft"): Promise<void> {
  const hash = emailHash(email);
  const col = mongo.db("salenoti").collection("user_email_health");
  if (kind === "hard") {
    const r = await col.findOneAndUpdate(
      { email_hash: hash },
      { $inc: { hardBounces: 1 }, $set: { lastBounceAt: new Date() } },
      { upsert: true, returnDocument: "after" }
    );
    if ((r?.hardBounces ?? 0) >= 2) {
      await mongo.db("salenoti").collection("suppression_list").updateOne(
        { email_hash: hash },
        { $setOnInsert: { email_hash: hash, reason: "hard_bounce", addedAt: new Date(), sourceEvent: "resend_bounce" } },
        { upsert: true }
      );
    }
  } else {
    await col.updateOne({ email_hash: hash }, { $inc: { softBounces: 1 } }, { upsert: true });
  }
}

export async function recordComplaint(email: string): Promise<void> {
  const hash = emailHash(email);
  await mongo.db("salenoti").collection("user_email_health").updateOne(
    { email_hash: hash },
    { $inc: { complaints: 1 }, $set: { lastComplaintAt: new Date() } },
    { upsert: true }
  );
  await mongo.db("salenoti").collection("suppression_list").updateOne(
    { email_hash: hash },
    { $setOnInsert: { email_hash: hash, reason: "complaint", addedAt: new Date(), sourceEvent: "resend_complaint" } },
    { upsert: true }
  );
}
