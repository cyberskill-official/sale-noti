import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CircuitBreaker, BreakerOpenError } from "./circuit-breaker";
import { TikTokShopApiError, type TikTokShopApiErrorCode } from "./errors";
import { normalizeTikTokShopProduct } from "./normalize";
import { TikTokShopRateLimitGuard } from "./rate-limit-guard";
import { buildTikTokShopHeaders } from "./sign";
import type {
  TikTokShopNormalizedOffer,
  TikTokShopPromotionLink,
  TikTokShopRawRecord,
  TikTokShopSearchInput,
} from "./types";

type TelemetryStatus = "success" | "error";
type TelemetryOutcome = "live" | "dead" | "error";
type TelemetryOperation = "searchOpenCollaborationProducts" | "generatePromotionLink";
type CanonicalSearchInput = Parameters<typeof normalizeTikTokShopProduct>[0];

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
    if (["true", "1", "yes", "open", "open_collaboration", "open-collaboration", "open plan", "open_plan"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "closed", "target", "target_collaboration", "target-collaboration", "target plan"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function normalizeErrorOutcome(code: TikTokShopApiErrorCode | "unknown"): TelemetryOutcome {
  return code === "no_results" || code === "unsupported_market" ? "dead" : "error";
}

@Injectable()
export class TikTokShopAffiliateClient {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly cfg: ConfigService,
    private readonly rateLimit: TikTokShopRateLimitGuard,
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async searchOpenCollaborationProducts(input: TikTokShopSearchInput): Promise<TikTokShopNormalizedOffer[]> {
    const startedAt = Date.now();
    let status: TelemetryStatus = "success";
    let outcome: TelemetryOutcome = "live";
    let errorCode: TikTokShopApiErrorCode | "unknown" | undefined;
    let caughtError: unknown;

    try {
      this.ensureSupportedMarket();
      await this.rateLimit.acquire();

      const response = await this.sendRequest(JSON.stringify(input));
      if (response.status === 404) {
        outcome = "dead";
        return [];
      }
      if (response.status === 401 || response.status === 403) {
        throw new TikTokShopApiError("auth_failure");
      }
      if (response.status >= 400) {
        throw new TikTokShopApiError("unknown", `TikTok Shop ${response.status}`);
      }

      const payload = await this.safeJson(response);
      const records = this.extractSearchRecords(payload);
      const offers = records
        .map((record) => this.toSearchInput(record))
        .filter((record): record is CanonicalSearchInput => record !== null && record.openCollaboration)
        .map((record) => normalizeTikTokShopProduct(record));

      outcome = offers.length > 0 ? "live" : "dead";
      return offers;
    } catch (error) {
      status = "error";
      caughtError = error;
      if (error instanceof TikTokShopApiError) {
        errorCode = error.code;
        outcome = normalizeErrorOutcome(error.code);
      } else {
        errorCode = "unknown";
        outcome = "error";
      }
      throw error;
    } finally {
      this.recordTelemetry({
        operation: "searchOpenCollaborationProducts",
        startedAt,
        status,
        outcome,
        errorCode,
        error: caughtError,
      });
    }
  }

  async generatePromotionLink(input: { productId: string }): Promise<TikTokShopPromotionLink> {
    const startedAt = Date.now();
    let status: TelemetryStatus = "success";
    let outcome: TelemetryOutcome = "live";
    let errorCode: TikTokShopApiErrorCode | "unknown" | undefined;
    let caughtError: unknown;

    try {
      this.ensureSupportedMarket();
      await this.rateLimit.acquire();

      const response = await this.sendRequest(JSON.stringify(input));
      if (response.status === 404) {
        outcome = "dead";
        throw new TikTokShopApiError("no_results");
      }
      if (response.status === 401 || response.status === 403) {
        throw new TikTokShopApiError("auth_failure");
      }
      if (response.status >= 400) {
        throw new TikTokShopApiError("unknown", `TikTok Shop ${response.status}`);
      }

      const payload = await this.safeJson(response);
      const promotionLink = this.extractPromotionLink(payload);
      if (!promotionLink) {
        if (this.isUnavailablePayload(payload)) {
          outcome = "dead";
          throw new TikTokShopApiError("no_results");
        }
        throw new TikTokShopApiError("schema_drift");
      }

      return {
        productId: input.productId,
        platformProductId: `tiktok_shop:${input.productId}`,
        promotionLink,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      status = "error";
      caughtError = error;
      if (error instanceof TikTokShopApiError) {
        errorCode = error.code;
        outcome = normalizeErrorOutcome(error.code);
      } else {
        errorCode = "unknown";
        outcome = "error";
      }
      throw error;
    } finally {
      this.recordTelemetry({
        operation: "generatePromotionLink",
        startedAt,
        status,
        outcome,
        errorCode,
        error: caughtError,
      });
    }
  }

  private ensureSupportedMarket(): void {
    const region = this.getRequiredConfig("TIKTOK_SHOP_REGION").trim().toUpperCase();
    if (region === "UK" || region === "EU") {
      throw new TikTokShopApiError("unsupported_market");
    }
  }

  private getRequiredConfig(key: string): string {
    try {
      const value = this.cfg.getOrThrow<string>(key);
      const text = toText(value);
      if (!text) throw new Error(`Missing config: ${key}`);
      return text;
    } catch {
      throw new TikTokShopApiError("config_error", `Missing config: ${key}`);
    }
  }

  private getTimeoutMs(): number {
    const raw = this.cfg.get("TIKTOK_SHOP_REQUEST_TIMEOUT_MS");
    const parsed = Number(raw ?? 10_000);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10_000;
  }

  private async sendRequest(body: string): Promise<Response> {
    const baseUrl = this.getRequiredConfig("TIKTOK_SHOP_AFFILIATE_BASE_URL");
    const appKey = this.getRequiredConfig("TIKTOK_SHOP_AFFILIATE_APP_KEY");
    const appSecret = this.getRequiredConfig("TIKTOK_SHOP_AFFILIATE_APP_SECRET");
    const accessToken = this.getRequiredConfig("TIKTOK_SHOP_AFFILIATE_ACCESS_TOKEN");
    const { headers } = buildTikTokShopHeaders(body, appKey, appSecret, accessToken);

    try {
      return await this.breaker.exec(async () => {
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body,
          signal: AbortSignal.timeout(this.getTimeoutMs()),
        });

        if (response.status === 429) {
          throw new TikTokShopApiError("rate_limit");
        }
        if (response.status >= 500) {
          throw new TikTokShopApiError("service_unavailable", `TikTok Shop ${response.status}`);
        }

        return response;
      });
    } catch (error) {
      if (error instanceof BreakerOpenError) {
        throw new TikTokShopApiError("service_unavailable", "circuit_breaker_open");
      }
      if ((error as { name?: string })?.name === "TimeoutError" || (error as { name?: string })?.name === "AbortError") {
        throw new TikTokShopApiError("service_unavailable", "timeout");
      }
      throw error;
    }
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new TikTokShopApiError("schema_drift", (error as Error).message);
    }
  }

  private resolveDataPayload(payload: unknown): unknown {
    if (isRecord(payload) && "data" in payload) return payload.data;
    return payload;
  }

  private extractSearchRecords(payload: unknown): TikTokShopRawRecord[] {
    const data = this.resolveDataPayload(payload);
    if (Array.isArray(data)) return this.normalizeRecordArray(data);
    if (!isRecord(data)) throw new TikTokShopApiError("schema_drift");

    const candidates = data.products ?? data.items ?? data.results ?? data.list;
    if (!Array.isArray(candidates)) throw new TikTokShopApiError("schema_drift");

    return this.normalizeRecordArray(candidates);
  }

  private normalizeRecordArray(items: unknown[]): TikTokShopRawRecord[] {
    const records = items.filter(isRecord);
    if (records.length !== items.length) throw new TikTokShopApiError("schema_drift");
    return records;
  }

  private toSearchInput(record: TikTokShopRawRecord): CanonicalSearchInput | null {
    const openCollaboration = this.isOpenCollaborationRecord(record);
    if (!openCollaboration) return null;

    const productId = this.readRequiredString(record, "productId", "id", "product_id");
    const title = this.readRequiredString(record, "title", "name", "productName", "product_title");
    const price = this.readRequiredNumber(record, "price", "currentPrice", "salePrice", "priceMin");
    const originalPrice = this.readOptionalNumber(record, "originalPrice", "marketPrice", "priceMax") ?? price;
    const imageUrl = this.readOptionalString(record, "imageUrl", "image_url", "coverImage", "thumbnailUrl");
    const commissionRate = this.readOptionalNumber(record, "commissionRate", "commission_rate", "rate");

    return {
      productId,
      title,
      price,
      originalPrice,
      imageUrl,
      commissionRate,
      openCollaboration: true,
    };
  }

  private isOpenCollaborationRecord(record: TikTokShopRawRecord): boolean {
    const raw = record.openCollaboration ?? record.isOpenCollaboration ?? record.collaborationType ?? record.planType ?? record.plan_type;

    const booleanValue = toBoolean(raw);
    if (booleanValue !== null) return booleanValue;

    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (!normalized) return true;
      return ["open", "open_collaboration", "open-collaboration", "open plan", "open_plan"].includes(normalized);
    }

    return true;
  }

  private extractPromotionLink(payload: unknown): string | null {
    const data = this.resolveDataPayload(payload);
    if (!isRecord(data)) return null;

    return this.readOptionalString(data, "promotionLink", "promotion_link", "deepLink", "deep_link", "url", "link");
  }

  private isUnavailablePayload(payload: unknown): boolean {
    const data = this.resolveDataPayload(payload);
    if (!isRecord(data)) return false;

    const raw = data.available ?? data.isAvailable ?? data.status ?? data.state ?? data.resultStatus;
    const booleanValue = toBoolean(raw);
    if (booleanValue !== null) return !booleanValue;

    const text = toText(raw);
    if (!text) return false;

    return ["unavailable", "inactive", "disabled", "not_available", "not-available", "missing"].includes(text.toLowerCase());
  }

  private readOptionalString(record: TikTokShopRawRecord, ...keys: string[]): string | null {
    for (const key of keys) {
      const value = toText(record[key]);
      if (value) return value;
    }
    return null;
  }

  private readRequiredString(record: TikTokShopRawRecord, ...keys: string[]): string {
    const value = this.readOptionalString(record, ...keys);
    if (!value) throw new TikTokShopApiError("schema_drift");
    return value;
  }

  private readOptionalNumber(record: TikTokShopRawRecord, ...keys: string[]): number | null {
    for (const key of keys) {
      const value = toNumber(record[key]);
      if (value !== null) return value;
    }
    return null;
  }

  private readRequiredNumber(record: TikTokShopRawRecord, ...keys: string[]): number {
    const value = this.readOptionalNumber(record, ...keys);
    if (value === null) throw new TikTokShopApiError("schema_drift");
    return value;
  }

  private recordTelemetry(input: {
    operation: TelemetryOperation;
    startedAt: number;
    status: TelemetryStatus;
    outcome: TelemetryOutcome;
    errorCode?: TikTokShopApiErrorCode | "unknown";
    error?: unknown;
  }): void {
    const latencyMs = Date.now() - input.startedAt;
    this.posthog.capture("affiliate_api_call", {
      platform: "tiktok_shop",
      operation: input.operation,
      latency_ms: latencyMs,
      status: input.status,
      error_code: input.errorCode ?? null,
      outcome: input.outcome,
    });

    this.sentry.addBreadcrumb?.({
      category: "affiliate",
      level: input.status === "error" ? "warning" : "info",
      message: `TikTok Shop ${input.operation}`,
      data: {
        platform: "tiktok_shop",
        operation: input.operation,
        latency_ms: latencyMs,
        status: input.status,
        error_code: input.errorCode ?? null,
        outcome: input.outcome,
      },
    });

    if (
      input.status === "error" &&
      input.error &&
      !(input.error instanceof TikTokShopApiError && (input.error.code === "no_results" || input.error.code === "unsupported_market"))
    ) {
      this.sentry.captureException(input.error, {
        tags: {
          fr: "FR-AFF-006",
          platform: "tiktok_shop",
          operation: input.operation,
          error_code: String(input.errorCode ?? "unknown"),
          outcome: input.outcome,
        },
      });
    }
  }
}
