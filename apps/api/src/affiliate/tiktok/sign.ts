import crypto from "node:crypto";

export type TikTokShopSignedRequest = {
  timestamp: number;
  signature: string;
  headers: Record<string, string>;
};

export function buildTikTokShopHeaders(
  payload: string,
  appKey: string,
  appSecret: string,
  accessToken: string,
  nowMs = Date.now()
): TikTokShopSignedRequest {
  const timestamp = Math.floor(nowMs / 1000);
  const signature = crypto.createHash("sha256").update(`${appKey}:${timestamp}:${payload}:${accessToken}:${appSecret}`).digest("hex");

  return {
    timestamp,
    signature,
    headers: {
      Authorization: `TikTokShop Credential=${appKey}, Signature=${signature}, Timestamp=${timestamp}`,
      "X-TikTok-Shop-Access-Token": accessToken,
      "X-TikTok-Shop-Timestamp": String(timestamp),
    },
  };
}
