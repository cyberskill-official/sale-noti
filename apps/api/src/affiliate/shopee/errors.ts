// FR-AFF-001 §1 #7 — typed error enum.
export type ShopeeErrorCode = "rate_limit" | "service_unavailable" | "auth_failure" | "unknown" | "schema_drift";

export class ShopeeApiError extends Error {
  constructor(public readonly code: ShopeeErrorCode, message?: string) {
    super(message ?? `Shopee API error: ${code}`);
    this.name = "ShopeeApiError";
  }
}
