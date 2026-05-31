import { Platform } from 'react-native';
import { ApiClientError, type ApiErrorPayload, type MobileConfig, type SearchResult, type SearchSort, type TrackResult, type WatchlistItem, type WatchlistListResult } from './types';

type JsonPrimitive = string | number | boolean | null;
type MobileRegion = "sg" | "us";

const SEA_LOCALES = ["vi_VN", "th_TH", "fil_PH", "id_ID", "ms_MY", "km_KH"] as const;

type RequestOptions = {
  query?: Record<string, JsonPrimitive | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
};

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const normalizedBase = normalizeApiBaseUrl(baseUrl);
  const url = new URL(path.replace(/^\//, ''), `${normalizedBase}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return fallbackApiBaseUrl();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function fallbackApiBaseUrl(): string {
  if (Platform.OS === "android") return "http://10.0.2.2:3000";
  return "http://localhost:3000";
}

function detectDeviceLocale(): string {
  try {
    const resolvedLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (resolvedLocale) return resolvedLocale;
  } catch {
    // Ignore locale detection failures and fall back below.
  }

  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    return navigator.language || "";
  }

  return "";
}

export function getMobileRegionFromLocale(locale: string = detectDeviceLocale()): MobileRegion {
  const normalized = locale.replace(/-/g, "_");
  return SEA_LOCALES.some((candidate) => normalized.startsWith(candidate)) ? "sg" : "us";
}

function regionSpecificApiBaseUrl(region: MobileRegion): string {
  const sharedBaseUrl = process.env.EXPO_PUBLIC_SALENOTI_API_BASE_URL?.trim();
  const sgBaseUrl = process.env.EXPO_PUBLIC_SALENOTI_API_BASE_URL_SG?.trim();
  const usBaseUrl = process.env.EXPO_PUBLIC_SALENOTI_API_BASE_URL_US?.trim();
  const rawBaseUrl = region === "sg" ? sgBaseUrl || sharedBaseUrl : usBaseUrl || sharedBaseUrl;
  return normalizeApiBaseUrl(rawBaseUrl || fallbackApiBaseUrl());
}

export function defaultApiBaseUrl(): string {
  return regionSpecificApiBaseUrl(getMobileRegionFromLocale());
}

export function buildShopeeProductUrl(shopId: string | number, itemId: string | number): string {
  return `https://shopee.vn/product-i.${shopId}.${itemId}`;
}

function buildHeaders(config: MobileConfig, hasBody: boolean, headers: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };
  if (hasBody && !out['Content-Type']) {
    out['Content-Type'] = 'application/json';
  }
  const bearer = config.bearerToken.trim();
  const userId = config.userId.trim();
  if (bearer) out.Authorization = `Bearer ${bearer}`;
  if (userId) out['X-User-Id'] = userId;
  if (!out['X-Salenoti-Source']) out['X-Salenoti-Source'] = 'import';
  return out;
}

async function requestJson<T>(config: MobileConfig, path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(config.apiBaseUrl, path, options.query);
  const hasBody = options.body !== undefined;
  const headers = buildHeaders(config, hasBody, options.headers);
  const body = hasBody ? JSON.stringify(options.body) : undefined;

  const response = await fetch(url, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers,
    body,
  });

  const rawText = await response.text();
  const payload = parseJson(rawText) as ApiErrorPayload | null;
  if (!response.ok) {
    throw new ApiClientError(response.status, payload);
  }
  return (payload ?? null) as T;
}

function parseJson(rawText: string): unknown {
  if (!rawText.trim()) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return { message: rawText };
  }
}

export async function searchProducts(
  config: MobileConfig,
  input: { q: string; page?: number; size?: number; sort?: SearchSort },
): Promise<SearchResult> {
  return requestJson<SearchResult>(config, '/v1/products/search', {
    method: 'GET',
    query: {
      q: input.q,
      page: input.page,
      size: input.size,
      sort: input.sort,
    },
  });
}

export async function trackProduct(
  config: MobileConfig,
  input: { url: string; nickname?: string; alertConfig?: unknown },
): Promise<TrackResult> {
  return requestJson<TrackResult>(config, '/v1/products/track', {
    method: 'POST',
    body: {
      url: input.url,
      nickname: input.nickname,
      alertConfig: input.alertConfig,
    },
  });
}

export async function fetchWatchlists(
  config: MobileConfig,
  input: { status?: 'active' | 'paused' | 'all'; page?: number; size?: number },
): Promise<WatchlistListResult> {
  return requestJson<WatchlistListResult>(config, '/v1/watchlists', {
    method: 'GET',
    query: {
      status: input.status,
      page: input.page,
      size: input.size,
    },
  });
}

export async function updateWatchlist(
  config: MobileConfig,
  watchlistId: string,
  input: { status?: 'active' | 'paused'; alertConfig?: unknown },
): Promise<WatchlistItem> {
  return requestJson<WatchlistItem>(config, `/v1/watchlists/${watchlistId}`, {
    method: 'PATCH',
    body: {
      status: input.status,
      alertConfig: input.alertConfig,
    },
  });
}

export async function deleteWatchlist(config: MobileConfig, watchlistId: string): Promise<void> {
  await requestJson<void>(config, `/v1/watchlists/${watchlistId}`, {
    method: 'DELETE',
  });
}
