import type { AccessTradeApiErrorCode } from "./types";

export class AccessTradeApiError extends Error {
  constructor(
    public readonly code: AccessTradeApiErrorCode,
    message?: string,
    public readonly retryable = false,
  ) {
    super(message ?? `AccessTrade API error: ${code}`);
    this.name = "AccessTradeApiError";
  }
}
