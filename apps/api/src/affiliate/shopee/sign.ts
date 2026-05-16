// FR-AFF-001 §3 — SHA256 signed Authorization header for Shopee Affiliate Open API.
// Format: SHA256 Credential=<app_id>, Signature=<hex>, Timestamp=<unix_seconds>
// Signature = sha256(app_id || timestamp || payload || app_secret), lowercase hex.
import crypto from "node:crypto";

export type SignedRequest = {
  timestamp: number;
  signature: string;
  header: string;
};

export function signRequest(payload: string, appId: string, appSecret: string, nowMs = Date.now()): SignedRequest {
  const timestamp = Math.floor(nowMs / 1000);
  const base = `${appId}${timestamp}${payload}${appSecret}`;
  const signature = crypto.createHash("sha256").update(base).digest("hex");
  return {
    timestamp,
    signature,
    header: `SHA256 Credential=${appId}, Signature=${signature}, Timestamp=${timestamp}`,
  };
}
