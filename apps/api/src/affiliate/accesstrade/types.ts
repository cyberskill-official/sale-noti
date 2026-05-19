export interface AccessTradeCampaign {
  id: string;
  name: string;
  merchant: string;
  url: string;
  approval: "successful" | "pending" | "rejected" | string;
  scope: string | null;
  status: number;
  cookieDuration: number | null;
}

export interface AccessTradeTrackingLink {
  campaignId: string;
  originUrl: string;
  affiliateLink: string;
  shortLink: string | null;
  generatedAt: string;
}

export interface AccessTradeFallbackInput {
  originUrl: string;
  userId: string;
  source: string;
  watchlistId?: string;
  campaign?: string;
  respectOtherPublisher?: boolean;
}

export interface AccessTradeFallbackResult {
  url: string;
  expiresAt: Date | null;
  cached: boolean;
}

export type AccessTradeApiErrorCode =
  | "config_error"
  | "auth_failure"
  | "rate_limit"
  | "unsupported_market"
  | "service_unavailable"
  | "schema_drift"
  | "no_results"
  | "unknown";
