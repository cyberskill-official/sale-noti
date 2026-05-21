export type LazadaApiErrorCode =
  | "config_error"
  | "auth_failure"
  | "rate_limit"
  | "service_unavailable"
  | "schema_drift"
  | "unknown";

export class LazadaApiError extends Error {
  constructor(
    public readonly code: LazadaApiErrorCode,
    message?: string,
    public readonly retryable = false,
  ) {
    super(message ?? `Lazada API error: ${code}`);
    this.name = "LazadaApiError";
  }
}
