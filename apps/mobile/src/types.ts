export type MobileConfig = {
  apiBaseUrl: string;
  userId: string;
  bearerToken: string;
};

export type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  issues?: unknown;
  retryAfter?: number;
  scope?: string;
  signinUrl?: string;
  upgradeUrl?: string;
  limit?: number;
  currentCount?: number;
  availableAt?: string | null;
};

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiErrorPayload | null,
  ) {
    super(payload?.error ?? `http_${status}`);
    this.name = 'ApiClientError';
  }
}

export type SearchSort = 'RELEVANCY' | 'PRICE_ASC' | 'PRICE_DESC' | 'SALES_DESC';

export type SearchResultItem = {
  shopId: string;
  itemId: string;
  productName: string;
  currentPrice: number;
  originalPrice: number;
  imageUrl: string | null;
  sales: number;
  affiliateLinkUrl: string | null;
};

export type SearchResult = {
  items: SearchResultItem[];
  count: number;
  pageNumber: number;
  pageSize: number;
  sort: SearchSort;
  cached: boolean;
};

export type TrackResult = {
  watchlistId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  currentPrice: number;
  originalPrice: number;
  discountPct: number;
  affiliateLink: string;
  is30DayLow: boolean;
  last30dMin: number | null;
};

export type WatchlistItem = {
  watchlistId: string;
  productId: string;
  status: 'active' | 'paused' | 'deleted';
  alertConfig: unknown;
  triggerCooldowns: Record<string, unknown>;
  baselineAtTrack: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  name: string | null;
  imageUrl: string | null;
  currentPrice: number | null;
  originalPrice: number | null;
  currentDiscountPct: number | null;
  lastObservedAt: string | null;
  last30dMin: number | null;
};

export type WatchlistListResult = {
  items: WatchlistItem[];
  page: number;
  size: number;
  total: number;
};
