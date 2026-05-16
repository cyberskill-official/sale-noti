// FR-GROW-001 — referral program. 3 qualified invites → 1 month Pro bonus.
import crypto from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { detectFraud } from "./fraud-detect";

@Injectable()
export class ReferralService {
  constructor(@Inject("OBS_POSTHOG") private readonly posthog: any) {}

  /** Compute the canonical refCode for a user (deterministic). */
  static refCodeFor(userId: string): string {
    const salt = process.env.REFERRAL_SALT ?? "";
    const h = crypto.createHash("sha256").update(`${userId}|${salt}`).digest();
    // base62-ish 8-char
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let out = "";
    for (let i = 0; i < 8; i++) out += alphabet[h[i]! % alphabet.length];
    return out;
  }

  async getStatus(userId: string): Promise<{
    refCode: string;
    refLink: string;
    invited: number;
    qualified: number;
    rewardsEarnedMonths: number;
  }> {
    const oid = new ObjectId(userId);
    const code = ReferralService.refCodeFor(userId);
    const [invited, qualified, rewardsEarnedMonths] = await Promise.all([
      mongo.db("salenoti").collection("referrals").countDocuments({ referrerId: oid }),
      mongo.db("salenoti").collection("referrals").countDocuments({ referrerId: oid, status: "qualified" }),
      mongo
        .db("salenoti")
        .collection("referral_rewards")
        .countDocuments({ referrerId: oid })
        .then((n) => n * 1),
    ]);
    return {
      refCode: code,
      refLink: `${process.env.APP_URL ?? "https://salenoti.vn"}/r/${code}`,
      invited,
      qualified,
      rewardsEarnedMonths,
    };
  }

  /** Called from sign-up flow when a user lands with `salenoti.ref=<code>` cookie. */
  async onSignup(args: {
    newUserId: string;
    newUserEmail: string;
    newUserIp: string;
    refCode: string;
  }): Promise<void> {
    const newOid = new ObjectId(args.newUserId);
    const referrer = await this.findByRefCode(args.refCode);
    if (!referrer) return;
    if (String(referrer._id) === args.newUserId) {
      // Self-referral.
      throw new BadRequestException({ error: "self_referral" });
    }
    const existing = await mongo.db("salenoti").collection("referrals").findOne({ referredId: newOid });
    if (existing) return; // already attributed

    const fraud = detectFraud({
      referrerId: String(referrer._id),
      referredId: args.newUserId,
      referrerIp: referrer.lastSignInIp,
      referredIp: args.newUserIp,
      referrerEmail: referrer.email,
      referredEmail: args.newUserEmail,
    });

    await mongo.db("salenoti").collection("referrals").insertOne({
      referrerId: referrer._id,
      referredId: newOid,
      refCode: args.refCode,
      status: "pending",
      createdAt: new Date(),
      qualifiedAt: null,
      fraudSignals: fraud,
    });

    this.posthog.capture("referral_signup", { hasFraudFlag: fraud.anyFlag });
  }

  /** FR-GROW-001 §1 #5 — call when a user verifies email + tracks ≥3 products. */
  async checkQualification(userId: string): Promise<void> {
    const oid = new ObjectId(userId);
    const ref = await mongo.db("salenoti").collection("referrals").findOne({ referredId: oid, status: "pending" });
    if (!ref) return;
    if (ref.fraudSignals?.anyFlag) return; // manual review hold

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: oid });
    if (!user?.emailVerified) return;
    const trackCount = await mongo
      .db("salenoti")
      .collection("watchlists")
      .countDocuments({ userId: oid, status: "active" });
    if (trackCount < 3) return;

    await mongo
      .db("salenoti")
      .collection("referrals")
      .updateOne({ _id: ref._id }, { $set: { status: "qualified", qualifiedAt: new Date() } });

    this.posthog.capture("referral_qualified", {});
    await this.maybeReward(ref.referrerId);
  }

  /** FR-GROW-001 §1 #6 — auto-reward on 3rd qualified invite in rolling 90 days. */
  private async maybeReward(referrerId: ObjectId): Promise<void> {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const qualifiedCount = await mongo
      .db("salenoti")
      .collection("referrals")
      .countDocuments({ referrerId, status: "qualified", qualifiedAt: { $gte: since } });
    const rewardCount = await mongo
      .db("salenoti")
      .collection("referral_rewards")
      .countDocuments({ referrerId });

    // Award one month for every 3 qualified invites.
    if (qualifiedCount < (rewardCount + 1) * 3) return;

    await mongo.db("salenoti").collection("referral_rewards").insertOne({
      referrerId,
      monthsGranted: 1,
      grantedAt: new Date(),
      reason: "3_qualified_invites",
    });
    await mongo
      .db("salenoti")
      .collection("subscriptions")
      .updateOne({ userId: referrerId }, { $inc: { bonusMonthsRemaining: 1 }, $set: { updatedAt: new Date() } }, { upsert: false });

    this.posthog.capture("referral_reward_unlocked", {});
  }

  private async findByRefCode(refCode: string): Promise<any | null> {
    // Brute-force scan acceptable at MVP scale (<10K users). Production: maintain `users.refCode` index.
    const stored = await mongo.db("salenoti").collection("users").findOne({ refCode });
    if (stored) return stored;
    // Lazy backfill: when first user without cached refCode signs up, write it.
    const users = await mongo.db("salenoti").collection("users").find({ refCode: { $exists: false } }).toArray();
    for (const u of users) {
      const code = ReferralService.refCodeFor(String(u._id));
      await mongo.db("salenoti").collection("users").updateOne({ _id: u._id }, { $set: { refCode: code } });
      if (code === refCode) return u;
    }
    return null;
  }
}
