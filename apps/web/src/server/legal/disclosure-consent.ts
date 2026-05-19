import crypto from "crypto";
import { ObjectId } from "mongodb";
import { mongo } from "@/server/db/mongo";
import { DISCLOSURE_VERSION } from "@/lib/disclosure";

export const AFFILIATE_DISCLOSURE_KIND = `affiliate_disclosure_${DISCLOSURE_VERSION}` as const;
export const PRIVACY_CONSENT_KIND = "privacy_v1" as const;

export type ConsentKind = typeof AFFILIATE_DISCLOSURE_KIND | typeof PRIVACY_CONSENT_KIND;

export type ConsentRecord = {
  kind: ConsentKind;
  version: string;
  grantedAt: Date;
  ip_hash: string;
  ua_hash: string;
  source: "sign_in" | "api" | "extension";
};

function hashConsentSignal(value: string): string {
  const salt = process.env.PII_HASH_SALT ?? process.env.AUTH_SECRET ?? "salenoti-dev-salt";
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 24);
}

export function buildConsentRecord(args: {
  kind: ConsentKind;
  version?: string;
  grantedAt?: Date;
  ip?: string;
  userAgent?: string;
  source?: ConsentRecord["source"];
}): ConsentRecord {
  return {
    kind: args.kind,
    version: args.version ?? (args.kind === AFFILIATE_DISCLOSURE_KIND ? DISCLOSURE_VERSION : "v1"),
    grantedAt: args.grantedAt ?? new Date(),
    ip_hash: hashConsentSignal(args.ip ?? "unknown"),
    ua_hash: hashConsentSignal(args.userAgent ?? "unknown"),
    source: args.source ?? "api",
  };
}

export function defaultSignInConsents(now = new Date()): ConsentRecord[] {
  return [
    buildConsentRecord({ kind: PRIVACY_CONSENT_KIND, grantedAt: now, source: "sign_in" }),
    buildConsentRecord({ kind: AFFILIATE_DISCLOSURE_KIND, grantedAt: now, source: "sign_in" }),
  ];
}

export async function recordDisclosureConsent(args: {
  userId: string;
  kind: ConsentKind;
  ip?: string;
  userAgent?: string;
  source?: ConsentRecord["source"];
}): Promise<boolean> {
  const record = buildConsentRecord({
    kind: args.kind,
    ip: args.ip,
    userAgent: args.userAgent,
    source: args.source ?? "api",
  });
  const users = mongo.db("salenoti").collection("users");
  const filter = { _id: ObjectId.isValid(args.userId) ? new ObjectId(args.userId) : args.userId } as any;
  await users.updateOne(filter, { $pull: { consents: { kind: args.kind } } } as any);
  const result = await users.updateOne(filter, { $push: { consents: record } } as any);
  return result.matchedCount > 0;
}
