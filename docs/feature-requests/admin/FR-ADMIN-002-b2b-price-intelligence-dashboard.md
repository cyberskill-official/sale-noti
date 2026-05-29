---
id: FR-ADMIN-002
title: "B2B Price Intelligence Dashboard — historical pricing and alerts for sellers/brands"
module: ADMIN
priority: MUST
status: draft
verify: T
phase: P3
slice: 1
owner: "Senior Tech Lead + Intern #1 (FE)"
created: 2026-05-29
last_revised: 2026-05-29
related_frs:
  - FR-ADMIN-001
  - FR-PRICE-001
  - FR-PRICE-002
  - FR-AFF-001
  - FR-WATCH-002
depends_on:
  - FR-ADMIN-001
  - FR-PRICE-001
  - FR-PRICE-002
  - FR-AFF-001
blocks: []
effort_hours: 18
template: engineering-spec@1
new_files:
  - apps/web/src/app/admin/dashboard/page.tsx
  - apps/web/src/app/admin/dashboard/[productId]/page.tsx
  - apps/web/src/server/admin/dashboard.service.ts
  - apps/web/src/server/admin/__tests__/dashboard.service.spec.ts
  - apps/web/src/app/api/admin/products/search/route.ts
  - apps/web/src/app/api/admin/products/[id]/history/route.ts
  - apps/web/src/app/api/admin/products/[id]/analytics/route.ts
modified_files:
  - apps/web/src/middleware.ts
  - apps/api/src/db/timescale.client.ts
allowed_tools:
  - "file_read/write apps/web/src/app/admin/**"
  - "file_read/write apps/web/src/server/admin/**"
  - "file_read/write apps/api/src/db/**"
  - "bash pnpm test"
disallowed_tools:
  - "expose raw lead data or seller email without encryption"
  - "allow cross-seller data leakage (seller A sees seller B's products)"
  - "ship historical price data without PII audit trail per PDPL"
  - "cache price aggregates indefinitely without invalidation policy"
risk_if_skipped: "B2B segment will have no self-service access to the price data they're paying for. Sellers cannot validate ROI, compare daily drops, or plan promotional campaigns without emailing support for exports. This forces high-touch sales model (~$3K MRR annual per account) and reduces self-serve landing-page conversion for Starter/Growth tiers."
---

## §1 - Description (BCP-14 normative)

The B2B Price Intelligence Dashboard SHALL provide authenticated sellers/brands with self-service access to historical pricing data, trend analytics, and competitor alerts for their own Shopee store products, with PII-protecting filters and per-tenant row-level security.

1. The system MUST authenticate B2B users via JWT email-based auth where the email matches a `b2b_leads` entry with `status: "won"` or a `b2b_subscriptions` entry with `tier: "starter"|"growth"|"enterprise"`. API calls MUST carry `Authorization: Bearer <jwt>` and the backend MUST validate `sub` (user ID) is linked to a `sellerId` via the `b2b_subscriptions` table. **Implementation note (audit vòng 1 clarification):** Assume `b2b_subscriptions` table is pre-populated by external billing system (Stripe webhook, handled by FR-BILL-001). FR-ADMIN-002 implements reads only; tier subscription creation is deferred to FR-BILL-001 context (P3.1 or later).

2. The system MUST expose `GET /api/admin/products/search?q=<query>&limit=50&offset=0` where `q` is a Shopee shop+product name partial match (e.g., "áo nam hàng hiệu"). The endpoint MUST:
   - Return only products in the authenticated seller's shop (row-level security: `products.sellerId = auth.sellerId`)
   - Return paginated results with fields `{ productId, shopId, itemId, name, imageUrl, currentPrice, currentDiscountPct, lastFetchedAt }`
   - Cached at 30 min (Redis with invalidation on price-ingestion)
   - Rate-limited to 10 calls/min/user

3. The system MUST expose `GET /api/admin/products/:productId/history?range=7d|30d|90d` returning time-series price data from TimescaleDB:
   - `{ timestamps: [iso8601, ...], prices: [number, ...], discounts: [pct, ...], min30d: number, max30d: number, avgPrice: number, priceChangeToday: {absolute: number, pct: number} }`
   - Aggregation: 30-min buckets for 7d, 4-hour buckets for 30d, daily buckets for 90d (query pre-aggregated continuous aggregate)
   - Cached at 1 hour (invalidated on new price ingestion)
   - **Implementation note (audit vòng 1 clarification):** TimescaleDB continuous aggregate `price_history_1h` refreshes on default policy (acceptable 1h staleness for 7d/30d/90d queries). For late-arriving samples (corrected prices within 24h), use `ON CONFLICT DO UPDATE` in aggregation logic to re-compute affected buckets.

4. The system MUST expose `GET /api/admin/products/:productId/analytics?range=7d|30d|90d` returning seller-focused KPIs:
   - `{ floorPrice: number, priceVolatility: number (CV), estimatedSalesTrend: "↑ increasing" | "→ stable" | "↓ decreasing", alertsTriggered: number, competitorCountInCategory: number, recommendedPricePoint: number (if using ML model) }`
   - Calculations: `floorPrice = min(prices[range])`, `CV = stddev / mean`, `estimatedSalesTrend` from order-count trend (requires sales-integration in P4), `recommendedPricePoint` from simple heuristic (lowest-in-category-30d-avg - 5%) or ML model if available
   - **Implementation note (audit vòng 1 clarification):** `competitorCountInCategory` is calculated by: (a) looking up Shopee category from seller's own product metadata, (b) counting all other sellers in that category (not filtered to direct competitors), (c) caching for 24h using Redis key `b2b:competitor_count:{shopee_category_id}` with TTL 86400s.

5. The dashboard landing page `GET /admin/dashboard` MUST show:
   - **Header:** seller/brand name, subscription tier (Starter/Growth/Enterprise), remaining API quota for the month
   - **Search bar:** product search (endpoint per §1 #2) with autocomplete
   - **Top cards:** total products tracked, price drops > 15% in 7d (count), alerts triggered this month (count)
   - **Recent activity:** table of last 10 products with recent price changes (sortable by date, price change %)
   - **AI insights widget (optional P3.2):** "Your competitors dropped ~15% this week — consider matching" (requires FR-PRICE-003 ML model)

6. The product detail page `GET /admin/dashboard/:productId` MUST show:
   - Product image + name + shop name + current price + discount %
   - **Price history chart:** 7d/30d/90d toggleable line chart (Chart.js or Recharts), with min/max/avg annotations
   - **KPI cards:** floor price, price volatility, estimated sales trend, alerts triggered, competitor count
   - **Alert config:** ability to set email alerts for this product (`threshold: "drop_15_pct" | "drop_absolute_10000" | "flash_sale_detected"`) — sends email to seller's B2B registered email
   - **Export button:** CSV export of price history for the selected range (PII-clean, seller's own data only)

7. The system MUST enforce column-level PII masking for B2B users:
   - `productMetadata.buyerReviews` (contains text) MUST NOT be exposed to B2B API/dashboard (consumer privacy)
   - Seller email addresses of competitors MUST NOT be visible (B2B data privacy)
   - Shop ID is OK to expose (public on Shopee); shop owner contact info is not

8. The system MUST store `b2b_subscriptions` collection with `{ subscriptionId, sellerId, tier: "starter"|"growth"|"enterprise", monthlyProductLimit: 10|50|200, monthlyApiCalls: 5000|50000|500000, billingEmail, billingPeriod: "monthly"|"annual", createdAt, renewalAt, status: "active"|"cancelled"|"overdue", externalCustomerId?: string (Stripe) }`. Quota enforcement MUST happen at API gateway level (check usage before query, emit PostHog `b2b_api_quota_exhausted` if limit hit).

9. The system MUST run an async job `daily_b2b_digest_email` at 09:00 ICT that, for each active B2B subscriber, emails a digest:
   - "Your top 5 products this week: [list with price trends]"
   - "Competitor activity: X shops entered your category, Y dropped price ≥15%"
   - Subject line per language (English/Vietnamese)
   - **Implementation note (audit vòng 1 clarification):** Unsubscribe link is a one-click JWT-signed token (following FR-AUTH-002 magic-link pattern): `PATCH /api/admin/subscriptions/unsubscribe?token=<signed_jwt>&email=seller@example.com`. The token is valid for 30 days and hits the endpoint to set `b2b_subscriptions.status = "cancelled"`. Email template is built with React Email (reusing pattern from FR-NOTIF-001) and sent via Resend.

10. The system MUST log all B2B API queries and dashboard page views in `audit:b2b_access` with `{ userId, sellerId, action: "api_search" | "api_history" | "api_analytics" | "page_view_dashboard", productId?, timestamp, ipHash, userAgent }`. This audit log MUST be retained per PDPL schedule (3 years for active subscription, 1 year post-churn) and MUST be accessible to admin/billing role only.

11. The system MUST NOT allow B2B users to see other sellers' data. Row-level security MUST be enforced at every query level: if a seller with `sellerId=abc` calls `/api/admin/products/def/history`, the endpoint MUST return 403 FORBIDDEN (not 404, to avoid leaking existence of product).

12. The system MUST support tiered feature parity:
    - **Starter ($99/mo):** dashboard access, 10 products tracked, 5K API calls/mo, 7d price history
    - **Growth ($299/mo):** dashboard + alerts, 50 products, 50K API calls/mo, 90d history, daily digest email
    - **Enterprise (custom):** API access, unlimited products/calls, 2-year history, Slack integration, custom reporting, dedicated account manager

13. The system MUST integrate with Stripe for billing (P3.1) and accept VNPay/MoMo for Vietnamese sellers (P3.2 or post-P3 invoice-based). Subscription creation flow: Stripe webhook `invoice.payment_succeeded` → create `b2b_subscriptions` row with `status: "active"`.

14. The seller MUST be able to request historical export (>90d) and the system MUST queue an async job to generate a CSV from TimescaleDB with date range and deliver via email within 4h. This export MUST include an audit note `{ exportRequestedBy: userId, exportedAt, range, rowCount }` for compliance. **Implementation note (audit vòng 1 clarification):** CSV format is: `date (ISO8601), price (VNĐ), discountPct (0-100), flags (comma-separated: "flash_sale"|"below_avg"|"below_min_30d")`. Each export job is independent (allow concurrent exports); audit note is appended as footer lines in CSV (e.g., `# Exported by <userId> at <timestamp> | <rowCount> rows | Range <startDate>..<endDate>`).

## §2 - Why this design

B2B sellers paying $99-300/mo MUST get immediate ROI visibility without support ticket friction. Self-service dashboards reduce support cost and increase NPS (seller sees "I got this data from the product I paid for" vs "I had to email support for a spreadsheet").

The row-level security design (§1 #11) prevents catastrophic data-leakage scenarios. A Shopee competitor or researcher could social-engineer a seller account and dump the entire competitor's price history. Enforcing seller ∈ [own shop only] at query time prevents this even if a bug in the export logic leaks across queries.

The PII-masking rules (§1 #7) balance business intelligence with privacy. Shops are public on Shopee; historical prices are aggregated insights. But buyer reviews (contain text with brand/competitor mentions) and competitor contact info must stay hidden to avoid commercial espionage.

The tiered API quota (§1 #8) prevents aggressive competitors from DOS'ing the price database via one paid account. Starter plan gets 5K calls/month (~170/day), Growth gets 50K (~1,666/day). If a Growth user runs bulk-export for 1000 products, they hit quota on day 5-10 and either upgrade or throttle usage.

The daily digest (§1 #9) drives engagement and retention. B2B SaaS retention drops sharply if users don't see value within 7 days. A digest saying "competitor dropped price" provides weekly value even if the user never logs into the dashboard.

The audit trail (§1 #10) satisfies PDPL Article 25 (audit of data access) and enables fraud detection. If a seller's account is compromised and someone exfiltrates data to a competitor, we can detect the access pattern and contact the seller within 72h.

## §3 - API contract and code shape

### Search endpoint

```ts
// GET /api/admin/products/search?q=<query>&limit=50&offset=0
// Auth: Bearer JWT with b2b_subscriptions

const SearchResponse = z.object({
  results: z.array(z.object({
    productId: z.string(),
    shopId: z.number(),
    itemId: z.number(),
    name: z.string(),
    imageUrl: z.string().url(),
    currentPrice: z.number(),
    currentDiscountPct: z.number().min(0).max(100),
    lastFetchedAt: z.date(),
  })),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

type ApiError = { code: "UNAUTHORIZED" | "RATE_LIMIT" | "NOT_FOUND" };
```

### History endpoint

```ts
// GET /api/admin/products/:productId/history?range=7d|30d|90d
const HistoryResponse = z.object({
  productId: z.string(),
  range: z.enum(["7d", "30d", "90d"]),
  timestamps: z.array(z.string().datetime()),
  prices: z.array(z.number()),
  discounts: z.array(z.number()),
  min30d: z.number(),
  max30d: z.number(),
  avgPrice: z.number(),
  priceChangeToday: z.object({
    absolute: z.number(),
    pct: z.number(),
  }),
  lastUpdated: z.date(),
});
```

### Analytics endpoint

```ts
// GET /api/admin/products/:productId/analytics?range=7d|30d|90d
const AnalyticsResponse = z.object({
  productId: z.string(),
  floorPrice: z.number(),
  priceVolatility: z.number().min(0).max(1), // coefficient of variation
  estimatedSalesTrend: z.enum(["↑ increasing", "→ stable", "↓ decreasing"]),
  alertsTriggered: z.number(),
  competitorCountInCategory: z.number(),
  recommendedPricePoint: z.number().optional(),
});
```

### Dashboard service (BFF layer)

```ts
// apps/web/src/server/admin/dashboard.service.ts
class B2BDashboardService {
  async searchProducts(sellerId: string, query: string, limit = 50, offset = 0): Promise<SearchResponse>;
  async getProductHistory(sellerId: string, productId: string, range: "7d" | "30d" | "90d"): Promise<HistoryResponse>;
  async getProductAnalytics(sellerId: string, productId: string, range: "7d" | "30d" | "90d"): Promise<AnalyticsResponse>;
  async sendDailyDigestEmail(sellerId: string): Promise<void>;
  async generateHistoricalExport(sellerId: string, productId: string, range: DateRange): Promise<ExportJob>;
}
```

## §4 - Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | authenticated B2B user with Starter tier (10 products) | search endpoint with empty query | returns paginated results (max 50) of seller's products, cached 30 min |
| AC2 | same user tries to search for product in shop not their own | search with competitor's productId | returns empty results (row-level security) |
| AC3 | user views price history for own product | GET /api/.../productId/history?range=7d | returns time-series with 30-min buckets, min/max/avg, cached 1h |
| AC4 | same user exceeds 5K API calls/month (Starter quota) | 5001st API call in calendar month | response 429 QUOTA_EXCEEDED with retryAfter hint |
| AC5 | Growth tier user views analytics | GET /api/.../productId/analytics | returns KPI card data (floor price, volatility, competitor count, alerts) |
| AC6 | user logs into dashboard | GET /admin/dashboard | page renders with seller name, tier, quota %, search bar, recent activity table, top cards (products tracked, 7d drops, alerts this month) |
| AC7 | user clicks on product from recent activity | navigate to /admin/dashboard/:productId | detail page renders with chart (7d/30d/90d toggle), KPI cards, alert config, export button |
| AC8 | user configures alert for "drop 15%" | PATCH /api/admin/products/:id/alert-config | alert saved, confirmation email sent to seller's B2B registered email |
| AC9 | daily digest job runs at 09:00 ICT | scheduled task | Growth/Enterprise subscribers receive email with top 5 products + competitor activity |
| AC10 | user requests historical export >90d | POST /api/admin/products/:id/export?range=2026-01-01..2026-05-29 | export job queued, user receives completion email within 4h with CSV attachment |
| AC11 | audit logging for B2B API access | any API call to /api/admin/** | audit record stored with userId, sellerId, action, productId, timestamp, ipHash |
| AC12 | cross-seller data access attempt | attacker compromises user A's JWT, calls API with user B's productId | 403 FORBIDDEN response (not 404) |

## §5 - Implementation hints

### TimescaleDB pre-aggregation

Use continuous aggregates to pre-compute 30-min/4h/daily buckets. Query the aggregate instead of raw price_history table for 7d/30d/90d queries.

```sql
-- Hourly continuous aggregate for faster queries
CREATE MATERIALIZED VIEW price_history_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS time,
  product_id,
  avg(price) AS avg_price,
  min(price) AS min_price,
  max(price) AS max_price,
  count(*) AS sample_count
FROM price_history
GROUP BY 1, 2;
```

### Row-level security

All `/api/admin/**` endpoints MUST validate `seller_id` before returning results. Never expose a 404 if a product exists but belongs to another seller (return 403).

### Caching strategy

- Search results: 30 min (invalidated on new product ingestion)
- History charts: 1 hour (invalidated on new price sample)
- Analytics KPIs: 6 hours (less time-critical)
- Dashboard page: 5 min (user-specific, server-side cache with user ID key)

### B2B auth guard

Middleware at `apps/web/src/middleware.ts` must check:
1. JWT is valid
2. `sub` (user ID) exists in `b2b_subscriptions`
3. Subscription `status: "active"`
4. Redirect to login if not authenticated

## §6 - Testing strategy

- Unit tests for `dashboard.service.ts` — mock TimescaleDB, test aggregations, row-level security filter
- Integration tests for search/history/analytics endpoints — use test database, verify caching + rate-limit
- E2E test for dashboard page — render search bar, autocomplete, product detail, alert config
- PII audit test — verify no buyer reviews or competitor emails exposed to B2B users

## §7 - Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Competitor social-engineers B2B user account | HIGH | Row-level security (§1 #11), Slack alert on unusual access pattern (AC11), seller notified within 72h if breach detected |
| Seller exceeds API quota, blocks legitimate usage | MEDIUM | Clear quota messaging on dashboard, upgrade prompt 7 days before limit, grace period +10% overage before hard block |
| TimescaleDB query timeout on large date ranges | MEDIUM | Pre-aggregate data (§5), implement query timeout (30s), async export job for >1M rows |
| Privacy complaint: seller A's competitor purchased Starter, exported competitor's data | HIGH | PII masking (§1 #7), audit trail (§1 #10), breach notification template ready (FR-LEGAL-001) |

## §8 - Open questions & decisions

- **Q:** Should ML `recommendedPricePoint` be a Starter or Growth feature? **A (P3):** Heuristic version in Starter (simple percentile calc), ML model version (FR-PRICE-003) in Growth tier in P3.2.
- **Q:** Daily digest at 09:00 ICT — what if seller in different timezone? **A:** Single digest time in server TZ; P4 can add per-user timezone prefs.
- **Q:** Stripe webhook for subscription creation — who owns this, billing or engineering? **A (P3):** Engineering (BFF layer) owns `/admin/subscriptions/stripe-webhook` route; billing (founder/ops) owns Stripe product setup.

---

**End of FR-ADMIN-002 draft (v0.1.0). Ready for vòng 1 audit.**
