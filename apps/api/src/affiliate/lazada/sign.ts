import crypto from "node:crypto";

export type LazadaSignedRequest = {
  timestamp: number;
  signature: string;
  header: string;
};

export function signLazadaRequest(payload: string, appKey: string, appSecret: string, nowMs = Date.now()): LazadaSignedRequest {
  const timestamp = Math.floor(nowMs / 1000);
  const signature = crypto.createHash("sha256").update(`${appKey}:${timestamp}:${payload}:${appSecret}`).digest("hex");

  return {
    timestamp,
    signature,
    header: `LZSHA256 Credential=${appKey}, Signature=${signature}, Timestamp=${timestamp}`,
  };
}
