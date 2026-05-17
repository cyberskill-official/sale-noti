import crypto from "node:crypto";

export type CiphertextEnvelope = {
  v: 1;
  alg: "AES-256-GCM";
  kid: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

function keyMaterial(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY ?? process.env.AUTH_SECRET ?? "dev-only-change-me-dev-only-change-me";
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

export function envelopeEncrypt(plaintext: string, aad = "salenoti:v1"): CiphertextEnvelope {
  const key = keyMaterial();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    v: 1,
    alg: "AES-256-GCM",
    kid: process.env.DATA_ENCRYPTION_KEY_ID ?? "local-v1",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function envelopeDecrypt(envelope: CiphertextEnvelope, aad = "salenoti:v1"): string {
  if (envelope.v !== 1 || envelope.alg !== "AES-256-GCM") throw new Error("unsupported_envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function piiHash(value: string, purpose = "pii"): string {
  const salt = process.env.PII_HASH_SALT ?? process.env.POSTHOG_PII_SALT ?? "local-dev-salt";
  return crypto.createHash("sha256").update(`${purpose}:${value.toLowerCase()}:${salt}`).digest("hex");
}
