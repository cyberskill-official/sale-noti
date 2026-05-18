export type TikTokShopApiErrorCode =
  | "config_error"
  | "auth_failure"
  | "rate_limit"
  | "unsupported_market"
  | "service_unavailable"
  | "schema_drift"
  | "no_results"
  | "unknown";

export class TikTokShopApiError extends Error {
  constructor(public readonly code: TikTokShopApiErrorCode, message?: string) {
    super(message ?? `TikTok Shop API error: ${code}`);
    this.name = "TikTokShopApiError";
  }
}
