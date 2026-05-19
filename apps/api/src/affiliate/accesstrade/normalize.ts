import { AccessTradeApiError } from "./errors";
import type { AccessTradeCampaign, AccessTradeTrackingLink } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = stripHtml(value);
    return text.length > 0 ? text : null;
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

function deriveApproval(rawApproval: unknown, rawStatus: unknown): string {
  const explicit = toText(rawApproval);
  if (explicit) return explicit;

  const status = toNumber(rawStatus);
  if (status === 1) return "successful";
  if (status === 0) return "pending";
  if (status === -1) return "rejected";
  return "unknown";
}

function unwrapData(payload: unknown): unknown {
  if (isRecord(payload) && "data" in payload) return payload.data;
  return payload;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return null;
}

export function normalizeAccessTradeCampaign(input: unknown): AccessTradeCampaign {
  if (!isRecord(input)) throw new AccessTradeApiError("schema_drift", "Campaign payload is not an object");

  const id = firstText(input.id, input.campaign_id, input.campaignId);
  const name = firstText(input.name, input.campaign_name, input.title);
  const merchant = firstText(input.merchant, input.merchant_name, input.brand_name, name ?? input.id);
  const url = firstText(input.url, input.url_origin, input.landing_page_url, input.destination_url);

  if (!id || !name || !merchant || !url) {
    throw new AccessTradeApiError("schema_drift", "Campaign payload missing required fields");
  }

  return {
    id,
    name,
    merchant,
    url,
    approval: deriveApproval(input.approval ?? input.approval_status ?? input.status_text, input.status),
    scope: firstText(input.scope, input.campaign_scope),
    status: toNumber(input.status) ?? 0,
    cookieDuration: toNumber(input.cookieDuration ?? input.cookie_duration ?? input.cookie_days ?? input.cookie),
  };
}

export function normalizeAccessTradeTrackingLink(payload: unknown, campaignId: string, originUrl: string): AccessTradeTrackingLink {
  const unwrapped = unwrapData(payload);
  if (!isRecord(unwrapped)) throw new AccessTradeApiError("schema_drift", "Tracking link payload is not an object");

  const rawLinks = Array.isArray(unwrapped.success_link)
    ? unwrapped.success_link
    : Array.isArray(unwrapped.successLink)
      ? unwrapped.successLink
      : [];

  if (rawLinks.length === 0) {
    throw new AccessTradeApiError("no_results", "No AccessTrade tracking link returned");
  }

  const first = rawLinks[0];
  if (!isRecord(first)) throw new AccessTradeApiError("schema_drift", "Tracking link payload shape is invalid");

  const shortLink = firstText(first.short_link, first.shortLink);
  const affiliateLink = firstText(first.aff_link, first.affiliateLink);
  const resolvedOrigin = firstText(first.url_origin, first.urlOrigin) ?? originUrl;

  if (!affiliateLink && !shortLink) {
    throw new AccessTradeApiError("schema_drift", "Tracking link payload is missing url fields");
  }

  return {
    campaignId,
    originUrl: resolvedOrigin,
    affiliateLink: affiliateLink ?? shortLink ?? originUrl,
    shortLink: shortLink ?? null,
    generatedAt: new Date().toISOString(),
  };
}
