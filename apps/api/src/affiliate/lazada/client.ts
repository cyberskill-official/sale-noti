import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CircuitBreaker, BreakerOpenError } from "./circuit-breaker";
import { LazadaApiError, type LazadaApiErrorCode } from "./errors";
import { normalizeLazadaOffer } from "./normalize";
import { LazadaRateLimitGuard } from "./rate-limit-guard";
import { signLazadaRequest } from "./sign";
import type { LazadaNormalizedOffer, LazadaProductOfferInput } from "./types";

type TelemetryStatus = "success" | "error";
type TelemetryOutcome = "live" | "dead" | "error";
type LazadaRawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (["true", "1", "yes", "open", "active", "available"].includes(normalized)) return true;
    if (["false", "0", "no", "closed", "inactive", "unavailable"].includes(normalized)) return false;
  }
  return null;
}

@Injectable()
export class LazadaAffiliateClient {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly cfg: ConfigService,
    private readonly rateLimit: LazadaRateLimitGuard,
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
  ) {}

  async productOffer(input: LazadaProductOfferInput): Promise<LazadaNormalizedOffer | null> {
    const startedAt = Date.now();
    let status: TelemetryStatus = "success";
    let outcome: TelemetryOutcome = "live";
    let errorCode: LazadaApiErrorCode | "unknown" | undefined;
    let caughtError: unknown;

    try {
      const baseUrl = this.getRequiredConfig("LAZADA_AFFILIATE_BASE_URL");
      const appKey = this.getRequiredConfig("LAZADA_AFFILIATE_APP_KEY");
      const appSecret = this.getRequiredConfig("LAZADA_AFFILIATE_APP_SECRET");

      await this.rateLimit.acquire();

      const payload = JSON.stringify({ shopId: input.shopId, itemId: input.itemId });
      const response = await this.sendRequest(baseUrl, payload, appKey, appSecret);

      if (response.status === 404) {
        outcome = "dead";
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        throw new LazadaApiError("auth_failure");
      }
      if (response.status >= 400) {
        throw new LazadaApiError("unknown", `Lazada ${response.status}`);
      }

      const body = await this.safeJson(response);
      const record = this.extractOfferRecord(body);
      if (!record) {
        outcome = "dead";
        return null;
      }

      const offer = normalizeLazadaOffer(this.toNormalizeInput(record, input));
      outcome = "live";
      return offer;
    } catch (error) {
      status = "error";
      caughtError = error;
      if (error instanceof LazadaApiError) {
        errorCode = error.code;
      } else {
        errorCode = "unknown";
      }
      outcome = "error";
      throw error;
    } finally {
      this.recordTelemetry({
        startedAt,
        status,
        outcome,
        errorCode,
        error: caughtError,
      });
    }
  }

  private async sendRequest(baseUrl: string, payload: string, appKey: string, appSecret: string): Promise<Response> {
    try {
      return await this.breaker.exec(async () => {
        const { header } = signLazadaRequest(payload, appKey, appSecret);
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: header },
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs()),
        });

        if (response.status === 429) {
          throw new LazadaApiError("rate_limit", "Lazada rate limit", true);
        }
        if (response.status >= 500) {
          throw new LazadaApiError("service_unavailable", `Lazada ${response.status}`, true);
        }

        return response;
      });
    } catch (error) {
      if (error instanceof BreakerOpenError) {
        throw new LazadaApiError("service_unavailable", "circuit_breaker_open", true);
      }
      if ((error as { name?: string })?.name === "TimeoutError" || (error as { name?: string })?.name === "AbortError") {
        throw new LazadaApiError("service_unavailable", "timeout", true);
      }
      throw error;
    }
  }

  private getRequiredConfig(key: string): string {
    try {
      const value = this.cfg.getOrThrow<string>(key);
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Missing config: ${key}`);
      }
      return value.trim();
    } catch {
      throw new LazadaApiError("config_error", `Missing config: ${key}`);
    }
  }

  private timeoutMs(): number {
    const parsed = Number(this.cfg.get("LAZADA_REQUEST_TIMEOUT_MS") ?? 10_000);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10_000;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new LazadaApiError("schema_drift", (error as Error).message);
    }
  }

  private unwrapData(payload: unknown): unknown {
    if (isRecord(payload) && "data" in payload) return payload.data;
    return payload;
  }

  private extractOfferRecord(payload: unknown): LazadaRawRecord | null {
    const root = this.unwrapData(payload);

    if (Array.isArray(root)) {
      for (const item of root) {
        if (isRecord(item) && this.isOfferLikeRecord(item)) {
          if (this.isUnavailablePayload(item)) return null;
          return item;
        }
      }
      throw new LazadaApiError("schema_drift", "Unexpected Lazada array payload");
    }

    if (!isRecord(root)) {
      throw new LazadaApiError("schema_drift", "Unexpected Lazada payload shape");
    }

    const candidates = [
      this.readPath(root, ["item"]),
      this.readPath(root, ["items", 0]),
      this.readPath(root, ["product"]),
      this.readPath(root, ["offer"]),
      this.readPath(root, ["result"]),
      this.readPath(root, ["data", "item"]),
      this.readPath(root, ["data", "items", 0]),
      this.readPath(root, ["data", "product"]),
      this.readPath(root, ["data", "offer"]),
      this.readPath(root, ["data", "result"]),
    ];

    for (const candidate of candidates) {
      if (isRecord(candidate) && this.isOfferLikeRecord(candidate)) {
        if (this.isUnavailablePayload(candidate)) return null;
        return candidate;
      }
    }

    if (this.isOfferLikeRecord(root)) {
      if (this.isUnavailablePayload(root)) return null;
      return root;
    }

    if (this.isUnavailablePayload(root)) return null;

    throw new LazadaApiError("schema_drift", "Unable to locate Lazada offer payload");
  }

  private isOfferLikeRecord(record: LazadaRawRecord): boolean {
    return (
      this.readOptionalString(record, "title", "productName", "product_name", "name", "itemName", "item_name") !== null &&
      this.readOptionalNumber(record, "price", "currentPrice", "salePrice", "sale_price", "priceMin", "promoPrice", "discountPrice") !== null &&
      this.readOptionalString(record, "affiliateLink", "affiliate_link", "productLink", "product_link", "link", "url", "deeplink", "deepLink", "affiliateUrl", "affiliate_url") !== null
    );
  }

  private readPath(root: unknown, path: Array<string | number>): unknown {
    let current: unknown = root;
    for (const segment of path) {
      if (Array.isArray(current)) {
        if (typeof segment !== "number" || segment < 0 || segment >= current.length) return undefined;
        current = current[segment];
        continue;
      }
      if (!isRecord(current) || typeof segment !== "string" || !(segment in current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  private isUnavailablePayload(record: LazadaRawRecord): boolean {
    const raw =
      record.available ??
      record.isAvailable ??
      record.status ??
      record.state ??
      record.resultStatus ??
      record.itemStatus ??
      record.productStatus ??
      record.publishStatus;

    const booleanValue = toBoolean(raw);
    if (booleanValue !== null) return !booleanValue;

    const text = toText(raw);
    if (!text) return false;

    return ["unavailable", "inactive", "disabled", "deleted", "removed", "out_of_stock", "sold_out", "closed", "hidden", "expired", "not_available", "not-available"].includes(text.toLowerCase());
  }

  private toNormalizeInput(record: LazadaRawRecord, input: LazadaProductOfferInput) {
    const title = this.readRequiredString(record, "title", "productName", "product_name", "name", "itemName", "item_name");
    const price = this.readRequiredNumber(record, "price", "currentPrice", "salePrice", "sale_price", "priceMin", "promoPrice", "discountPrice");
    const originalPrice = this.readOptionalNumber(record, "originalPrice", "original_price", "marketPrice", "market_price", "priceMax", "price_max", "listPrice", "list_price") ?? price;
    const imageUrl = this.readOptionalString(record, "imageUrl", "image_url", "coverImage", "cover_image", "thumbnailUrl", "thumbnail_url", "picUrl", "pic_url");
    const affiliateLink = this.readRequiredString(record, "affiliateLink", "affiliate_link", "productLink", "product_link", "link", "url", "deeplink", "deepLink", "affiliateUrl", "affiliate_url");
    const commissionRate = this.readOptionalNumber(record, "commissionRate", "commission_rate", "rate", "commission", "commissionPercent", "commission_percent");
    const flashSale = this.readOptionalBoolean(record, "flashSale", "flash_sale", "isFlashSale", "is_flash_sale") ?? (originalPrice > price ? price < originalPrice * 0.7 : false);

    return {
      shopId: input.shopId,
      itemId: input.itemId,
      title,
      price,
      originalPrice,
      imageUrl,
      affiliateLink,
      commissionRate,
      flashSale,
    };
  }

  private readOptionalString(record: LazadaRawRecord, ...keys: string[]): string | null {
    for (const key of keys) {
      const value = toText(record[key]);
      if (value) return value;
    }
    return null;
  }

  private readRequiredString(record: LazadaRawRecord, ...keys: string[]): string {
    const value = this.readOptionalString(record, ...keys);
    if (!value) throw new LazadaApiError("schema_drift");
    return value;
  }

  private readOptionalNumber(record: LazadaRawRecord, ...keys: string[]): number | null {
    for (const key of keys) {
      const value = toNumber(record[key]);
      if (value !== null) return value;
    }
    return null;
  }

  private readRequiredNumber(record: LazadaRawRecord, ...keys: string[]): number {
    const value = this.readOptionalNumber(record, ...keys);
    if (value === null) throw new LazadaApiError("schema_drift");
    return value;
  }

  private readOptionalBoolean(record: LazadaRawRecord, ...keys: string[]): boolean | null {
    for (const key of keys) {
      const value = toBoolean(record[key]);
      if (value !== null) return value;
    }
    return null;
  }

  private recordTelemetry(input: {
    startedAt: number;
    status: TelemetryStatus;
    outcome: TelemetryOutcome;
    errorCode?: LazadaApiErrorCode | "unknown";
    error?: unknown;
  }): void {
    const event = {
      platform: "lazada",
      operation: "productOffer",
      latency_ms: Date.now() - input.startedAt,
      status: input.status,
      error_code: input.errorCode ?? null,
      outcome: input.outcome,
    };

    this.posthog.capture("affiliate_api_call", event);
    this.sentry.addBreadcrumb?.({
      category: "affiliate.lazada",
      level: input.status === "success" ? "info" : "warning",
      data: event,
    });

    if (input.error) {
      const shouldCapture =
        !(input.error instanceof LazadaApiError) ||
        input.error.code === "schema_drift" ||
        input.error.code === "service_unavailable" ||
        input.error.code === "unknown";

      if (shouldCapture) {
        this.sentry.captureException(input.error, {
          tags: {
            platform: "lazada",
            operation: "productOffer",
            error_code: input.errorCode ?? "unknown",
          },
        });
      }
    }
  }
}
