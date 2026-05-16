// FR-NOTIF-001 §1 #11 — suppression list (≥ 2 hard bounces OR ≥ 1 complaint).
import { mongo } from "../db/mongo";

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await mongo.db("salenoti").collection("suppression_list").findOne({ email });
  return Boolean(row);
}

export async function recordBounce(email: string, kind: "hard" | "soft"): Promise<void> {
  const col = mongo.db("salenoti").collection("user_email_health");
  if (kind === "hard") {
    const r = await col.findOneAndUpdate(
      { email },
      { $inc: { hardBounces: 1 }, $set: { lastBounceAt: new Date() } },
      { upsert: true, returnDocument: "after" }
    );
    if ((r?.hardBounces ?? 0) >= 2) {
      await mongo.db("salenoti").collection("suppression_list").updateOne(
        { email },
        { $setOnInsert: { email, reason: "hard_bounce_2x", addedAt: new Date() } },
        { upsert: true }
      );
    }
  } else {
    await col.updateOne({ email }, { $inc: { softBounces: 1 } }, { upsert: true });
  }
}

export async function recordComplaint(email: string): Promise<void> {
  await mongo.db("salenoti").collection("user_email_health").updateOne(
    { email },
    { $inc: { complaints: 1 }, $set: { lastComplaintAt: new Date() } },
    { upsert: true }
  );
  await mongo.db("salenoti").collection("suppression_list").updateOne(
    { email },
    { $setOnInsert: { email, reason: "complaint", addedAt: new Date() } },
    { upsert: true }
  );
}
