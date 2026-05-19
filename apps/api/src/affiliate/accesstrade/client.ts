import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CircuitBreaker, BreakerOpenError } from "./circuit-breaker";
import { AccessTradeApiError, type AccessTradeApiErrorCode } from "./errors";
import { normalizeAccessTradeCampaign, normalizeAccessTradeTrackingLink } from "./normalize";
import { AccessTradeRateLimitGuard } from "./rate-limit-guard";
import { buildAccessTradeHeaders } from "./sign";
import type { AccessTradeCampaign, AccessTradeTrackingLink } from "./types";

type TelemetryStatus = "success" | "error";
type TelemetryOutcome = "live" | "dead" | "error";
type TelemetryOperation = "listCampaigns" | "createTrackingLink";

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

@Injectable()
export class AccessTradePublisherClient {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly cfg: ConfigService,
    private readonly rateLimit: AccessTradeRateLimitGuard,
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
  ) {}

  async listCampaigns(input: { page?: number; limit?: number; approval?: "successful" | "all" }): Promise<AccessTradeCampaign[]> {
    const startedAt = Date.now();
    let status: TelemetryStatus = "success";
    let outcome: TelemetryOutcome = "live";
    let errorCode: AccessTradeApiErrorCode | "unknown" | undefined;
    let caughtError: unknown;

    try {
      this.ensureSupportedMarket();
      const accessKey = this.getRequiredConfig("ACCESSTRADE_ACCESS_KEY");
      const requestUrl = this.buildUrl("/campaigns", {
        page: input.page,
        limit: input.limit,
      });

      await this.rateLimit.acquire();
      const response = await this.sendRequest(requestUrl, {
        method: "GET",
        headers: buildAccessTradeHeaders(accessKey).headers,
        signal: AbortSignal.timeout(this.timeoutMs()),
      });

      if (response.status === 401 || response.status === 403) throw new AccessTradeApiError("auth_failure");

      const payload = await this.safeJson(response);
      const campaigns = this.normalizeCampaignPayload(payload).map((record) => normalizeAccessTradeCampaign(record));
      const filtered = input.approval === "successful" ? campaigns.filter((campaign) => campaign.approval === "successful") : campaigns;

      outcome = filtered.length > 0 ? "live" : "dead";
      return filtered;
    } catch (error) {
      status = "error";
      caughtError = error;
      if (error instanceof AccessTradeApiError) {
        errorCode = error.code;
        outcome = this.normalizeErrorOutcome(error.code);
      } else {
        errorCode = "unknown";
        outcome = "error";
      }
      throw error;
    } finally {
      this.recordTelemetry({
        operation: "listCampaigns",
        startedAt,
        status,
        outcome,
        errorCode,
        error: caughtError,
      });
    }
  }

  async createTrackingLink(input: {
    campaignId: string;
    urls: string[];
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    subIds?: { sub1?: string; sub2?: string; sub3?: string; sub4?: string };
  }): Promise<AccessTradeTrackingLink> {
    const startedAt = Date.now();
    let status: TelemetryStatus = "success";
    let outcome: TelemetryOutcome = "live";
    let errorCode: AccessTradeApiErrorCode | "unknown" | undefined;
    let caughtError: unknown;

    try {
      this.ensureSupportedMarket();
      const accessKey = this.getRequiredConfig("ACCESSTRADE_ACCESS_KEY");
      const originUrl = this.requireFirstUrl(input.urls);

      await this.rateLimit.acquire();
      const response = await this.sendRequest(this.buildUrl("/product_link/create"), {
        method: "POST",
        headers: buildAccessTradeHeaders(accessKey).headers,
        body: JSON.stringify({
          campaign_id: input.campaignId,
          urls: input.urls,
          url_enc: true,
          utm_source: input.utmSource,
          utm_medium: input.utmMedium,
          utm_campaign: input.utmCampaign,
          utm_content: input.utmContent,
          sub1: input.subIds?.sub1,
          sub2: input.subIds?.sub2,
          sub3: input.subIds?.sub3,
          sub4: input.subIds?.sub4,
        }),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });

      if (response.status === 401 || response.status === 403) throw new AccessTradeApiError("auth_failure");

      const payload = await this.safeJson(response);
      const link = normalizeAccessTradeTrackingLink(payload, input.campaignId, originUrl);
      return link;
    } catch (error) {
      status = "error";
      caughtError = error;
      if (error instanceof AccessTradeApiError) {
        errorCode = error.code;
        outcome = this.normalizeErrorOutcome(error.code);
      } else {
        errorCode = "unknown";
        outcome = "error";
      }
      throw error;
    } finally {
      this.recordTelemetry({
        operation: "createTrackingLink",
        startedAt,
        status,
        outcome,
        errorCode,
        error: caughtError,
      });
    }
  }

  private buildUrl(path: string, query: Record<string, number | string | undefined> = {}): string {
    const base = this.baseUrl();
    const url = new URL(path.replace(/^\//, ""), `${base}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private baseUrl(): string {
    return (this.cfg.get<string>("ACCESSTRADE_BASE_URL") ?? "https://api.accesstrade.vn/v1").replace(/\/+$/, "");
  }

  private ensureSupportedMarket(): void {
    const region = toText(this.cfg.get("ACCESSTRADE_REGION"))?.toUpperCase() ?? "VN";
    if (!["VN", "VI", "VIETNAM", "VN_PUBLISHER"].includes(region)) {
      throw new AccessTradeApiError("unsupported_market");
    }
  }

  private getRequiredConfig(key: string): string {
    try {
      const value = toText(this.cfg.getOrThrow<string>(key));
      if (!value) throw new Error(`Missing config: ${key}`);
      return value;
    } catch {
      throw new AccessTradeApiError("config_error", `Missing config: ${key}`);
    }
  }

  private timeoutMs(): number {
    const parsed = Number(this.cfg.get("ACCESSTRADE_REQUEST_TIMEOUT_MS") ?? 10_000);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10_000;
  }

  private async sendRequest(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.breaker.exec(async () => {
        const response = await fetch(url, init);
        if (response.status === 429) throw new AccessTradeApiError("rate_limit", "AccessTrade rate limit", true);
        if (response.status >= 500) throw new AccessTradeApiError("service_unavailable", `AccessTrade ${response.status}`, true);
        return response;
      });
    } catch (error) {
      if (error instanceof BreakerOpenError) {
        throw new AccessTradeApiError("service_unavailable", "circuit_breaker_open", true);
      }
      if ((error as { name?: string })?.name === "TimeoutError" || (error as { name?: string })?.name === "AbortError") {
        throw new AccessTradeApiError("service_unavailable", "timeout", true);
      }
      throw error;
    }
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new AccessTradeApiError("schema_drift", (error as Error).message);
    }
  }

  private normalizeCampaignPayload(payload: unknown): unknown[] {
    const data = this.unwrapData(payload);
    if (Array.isArray(data)) return data;
    if (isRecord(data) && Array.isArray(data.campaigns)) return data.campaigns;
    if (isRecord(payload) && Array.isArray((payload as Record<string, unknown>).data)) {
      return (payload as Record<string, unknown>).data as unknown[];
    }
    if (Array.isArray(payload)) return payload;
    throw new AccessTradeApiError("schema_drift", "Unexpected campaign response shape");
  }

  private unwrapData(payload: unknown): unknown {
    if (isRecord(payload) && "data" in payload) return payload.data;
    return payload;
  }

  private requireFirstUrl(urls: string[]): string {
    const originUrl = urls[0];
    if (!originUrl) throw new AccessTradeApiError("config_error", "Missing tracking URL");
    return originUrl;
  }

  private normalizeErrorOutcome(code: AccessTradeApiErrorCode | "unknown"): TelemetryOutcome {
    return code === "no_results" || code === "unsupported_market" ? "dead" : code === "config_error" ? "error" : code === "auth_failure" ? "error" : code === "rate_limit" || code === "service_unavailable" ? "error" : code === "schema_drift" ? "error" : "error";
  }

  private recordTelemetry(input: {
    operation: TelemetryOperation;
    startedAt: number;
    status: TelemetryStatus;
    outcome: TelemetryOutcome;
    errorCode?: AccessTradeApiErrorCode | "unknown";
    error?: unknown;
  }): void {
    const latencyMs = Date.now() - input.startedAt;
    const event = {
      platform: "accesstrade",
      operation: input.operation,
      latency_ms: latencyMs,
      status: input.status,
      error_code: input.errorCode ?? null,
      outcome: input.outcome,
    };

    this.posthog.capture("affiliate_api_call", event);
    this.sentry.addBreadcrumb?.({
      category: "affiliate.accesstrade",
      level: input.status === "success" ? "info" : "warning",
      data: event,
    });

    if (input.error && !(input.error instanceof AccessTradeApiError && ["config_error", "unsupported_market", "no_results"].includes(input.error.code))) {
      this.sentry.captureException(input.error, {
        tags: {
          platform: "accesstrade",
          operation: input.operation,
          error_code: input.errorCode ?? "unknown",
        },
      });
    }
  }
}
