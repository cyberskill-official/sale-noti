import { z } from 'zod';
import { mongodb, timescale } from '@/lib/db';
import { redis } from '@/lib/redis';
import { ObjectId } from 'mongodb';

/**
 * B2B Dashboard Service — row-level security for seller self-service access
 *
 * Enforces:
 * - Row-level security: seller only sees their own products (sellerId filter)
 * - Caching: search (30min), history (1h), analytics (6h)
 * - Rate-limiting: handled at route level (10/min for search)
 * - Tier feature parity: starter (7d), growth/enterprise (90d) per FR-ADMIN-002 §1 #12
 */

// ============================================================================
// Zod Schemas (match FR-ADMIN-002 §3)
// ============================================================================

export const SearchResponseSchema = z.object({
  results: z.array(
    z.object({
      productId: z.string(),
      shopId: z.number(),
      itemId: z.number(),
      name: z.string(),
      imageUrl: z.string().url(),
      currentPrice: z.number(),
      currentDiscountPct: z.number().min(0).max(100),
      lastFetchedAt: z.date(),
    })
  ),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const HistoryResponseSchema = z.object({
  productId: z.string(),
  range: z.enum(['7d', '30d', '90d']),
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

export const AnalyticsResponseSchema = z.object({
  productId: z.string(),
  floorPrice: z.number(),
  priceVolatility: z.number().min(0).max(1), // coefficient of variation
  estimatedSalesTrend: z.enum(['↑ increasing', '→ stable', '↓ decreasing']),
  alertsTriggered: z.number(),
  competitorCountInCategory: z.number(),
  recommendedPricePoint: z.number().optional(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
export type AnalyticsResponse = z.infer<typeof AnalyticsResponseSchema>;

// ============================================================================
// Tier Configuration (FR-ADMIN-002 §1 #12)
// ============================================================================

const TIER_CONFIG: Record<'starter' | 'growth' | 'enterprise', {
  monthlyProductLimit: number;
  monthlyApiCalls: number;
  maxHistoryDays: number;
}> = {
  starter: {
    monthlyProductLimit: 10,
    monthlyApiCalls: 5000,
    maxHistoryDays: 7,
  },
  growth: {
    monthlyProductLimit: 50,
    monthlyApiCalls: 50000,
    maxHistoryDays: 90,
  },
  enterprise: {
    monthlyProductLimit: 200,
    monthlyApiCalls: 500000,
    maxHistoryDays: 730, // 2 years
  },
};

// ============================================================================
// B2B Dashboard Service
// ============================================================================

export class B2BDashboardService {
  /**
   * GET /api/admin/products/search?q=<query>&limit=50&offset=0
   *
   * Search seller's own products by name/shop (row-level security enforced).
   * Cached: 30 min
   * FR-ADMIN-002 §1 #2
   */
  async searchProducts(
    sellerId: string,
    query: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<SearchResponse> {
    // Validate inputs
    if (!sellerId || typeof sellerId !== 'string') {
      throw new Error('Invalid sellerId');
    }
    if (limit < 1 || limit > 100) {
      throw new Error('limit must be 1-100');
    }
    if (offset < 0) {
      throw new Error('offset must be >= 0');
    }

    // Check cache first
    const cacheKey = `b2b:search:${sellerId}:${query}:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SearchResponse;
    }

    // Row-level security: filter by sellerId
    const { db } = mongodb;
    const products = await db
      .collection('products')
      .find({
        sellerId: new ObjectId(sellerId), // only seller's own products
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { shopName: { $regex: query, $options: 'i' } },
        ],
      })
      .project({
        productId: 1,
        shopId: 1,
        itemId: 1,
        name: 1,
        imageUrl: 1,
        currentPrice: 1,
        currentDiscountPct: 1,
        lastFetchedAt: 1,
      })
      .skip(offset)
      .limit(limit)
      .toArray();

    const total = await db.collection('products').countDocuments({
      sellerId: new ObjectId(sellerId),
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { shopName: { $regex: query, $options: 'i' } },
      ],
    });

    const response: SearchResponse = {
      results: products.map((p) => ({
        productId: (p.productId as string) || '',
        shopId: (p.shopId as number) || 0,
        itemId: (p.itemId as number) || 0,
        name: (p.name as string) || '',
        imageUrl: (p.imageUrl as string) || '',
        currentPrice: (p.currentPrice as number) || 0,
        currentDiscountPct: (p.currentDiscountPct as number) || 0,
        lastFetchedAt: new Date(p.lastFetchedAt as string | Date),
      })),
      total,
      limit,
      offset,
    };

    // Cache for 30 min
    await redis.setex(cacheKey, 1800, JSON.stringify(response));

    return response;
  }

  /**
   * GET /api/admin/products/:productId/history?range=7d|30d|90d
   *
   * Fetch price history from pre-aggregated TimescaleDB continuous aggregate.
   * Cached: 1 hour
   * Row-level security: verify product belongs to seller
   * FR-ADMIN-002 §1 #3
   */
  async getProductHistory(
    sellerId: string,
    productId: string,
    range: '7d' | '30d' | '90d',
    tier: 'starter' | 'growth' | 'enterprise' = 'starter'
  ): Promise<HistoryResponse> {
    if (!sellerId || !productId || !range) {
      throw new Error('Missing required parameters');
    }

    // Tier check: starter can only query 7d
    if (tier === 'starter' && range !== '7d') {
      throw new Error('UPGRADE_REQUIRED');
    }

    // Check cache first
    const cacheKey = `b2b:history:${sellerId}:${productId}:${range}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as HistoryResponse;
    }

    // Row-level security: verify product belongs to seller
    const { db } = mongodb;
    const product = await db.collection('products').findOne({
      productId,
      sellerId: new ObjectId(sellerId),
    });

    if (!product) {
      throw new Error('Product not found or unauthorized (403)');
    }

    // Calculate date range
    const now = new Date();
    const startDate = new Date(now);
    if (range === '7d') startDate.setDate(startDate.getDate() - 7);
    else if (range === '30d') startDate.setDate(startDate.getDate() - 30);
    else if (range === '90d') startDate.setDate(startDate.getDate() - 90);

    // Query pre-aggregated continuous aggregate from TimescaleDB
    // Select the appropriate aggregate based on range (FR-ADMIN-002 §5)
    const { client: tsClient } = timescale;

    let aggregateTable = 'price_history_30min_agg';
    if (range === '30d') aggregateTable = 'price_history_4h_agg';
    else if (range === '90d') aggregateTable = 'price_history_1d_agg';

    const query = `
      SELECT
        bucket AS time,
        avg_price,
        min_price,
        max_price
      FROM ${aggregateTable}
      WHERE product_id = $1
        AND bucket >= $2
      ORDER BY time ASC
    `;
    const result = await tsClient.query(query, [productId, startDate]);

    if (!result.rows || result.rows.length === 0) {
      // No price data yet; return empty response
      const response: HistoryResponse = {
        productId,
        range,
        timestamps: [],
        prices: [],
        discounts: [],
        min30d: 0,
        max30d: 0,
        avgPrice: 0,
        priceChangeToday: { absolute: 0, pct: 0 },
        lastUpdated: new Date(),
      };
      await redis.setex(cacheKey, 3600, JSON.stringify(response));
      return response;
    }

    // Extract aggregated data
    const timestamps = result.rows.map((row: any) =>
      new Date(row.time).toISOString()
    );
    const prices = result.rows.map((row: any) => row.avg_price);
    const discounts = result.rows.map((row: any) => row.discount_pct || 0);

    // Calculate min/max/avg over last 30 days
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDayRows = await tsClient.query(
      `SELECT min_price, max_price FROM ${aggregateTable}
       WHERE product_id = $1 AND bucket >= $2 ORDER BY bucket ASC`,
      [productId, thirtyDaysAgo]
    );

    const min30d =
      thirtyDayRows.rows?.length > 0
        ? Math.min(...thirtyDayRows.rows.map((r: any) => r.min_price))
        : prices[0] || 0;

    const max30d =
      thirtyDayRows.rows?.length > 0
        ? Math.max(...thirtyDayRows.rows.map((r: any) => r.max_price))
        : prices[0] || 0;

    const avgPrice =
      prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    // Price change today: compare last entry vs 24h ago
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayRows = await tsClient.query(
      `SELECT avg_price FROM ${aggregateTable}
       WHERE product_id = $1 AND bucket <= $2
       ORDER BY bucket DESC LIMIT 1`,
      [productId, yesterday]
    );

    const yesterdayPrice =
      yesterdayRows.rows?.length > 0 ? yesterdayRows.rows[0].avg_price : prices[0] || 0;
    const todayPrice = prices[prices.length - 1] || 0;
    const priceChangeAbsolute = todayPrice - yesterdayPrice;
    const priceChangePct =
      yesterdayPrice > 0 ? (priceChangeAbsolute / yesterdayPrice) * 100 : 0;

    const response: HistoryResponse = {
      productId,
      range,
      timestamps,
      prices,
      discounts,
      min30d,
      max30d,
      avgPrice,
      priceChangeToday: {
        absolute: Math.round(priceChangeAbsolute * 100) / 100,
        pct: Math.round(priceChangePct * 100) / 100,
      },
      lastUpdated: new Date(),
    };

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(response));

    return response;
  }

  /**
   * GET /api/admin/products/:productId/analytics?range=7d|30d|90d
   *
   * Calculate KPI cards: floor price, volatility, trend, alerts, competitors.
   * Cached: 6 hours
   * Row-level security: verify product belongs to seller
   * FR-ADMIN-002 §1 #4
   */
  async getProductAnalytics(
    sellerId: string,
    productId: string,
    range: '7d' | '30d' | '90d',
    tier: 'starter' | 'growth' | 'enterprise' = 'starter'
  ): Promise<AnalyticsResponse> {
    if (!sellerId || !productId || !range) {
      throw new Error('Missing required parameters');
    }

    // Check cache first
    const cacheKey = `b2b:analytics:${sellerId}:${productId}:${range}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AnalyticsResponse;
    }

    // Row-level security
    const { db } = mongodb;
    const product = await db.collection('products').findOne({
      productId,
      sellerId: new ObjectId(sellerId),
    });

    if (!product) {
      throw new Error('Product not found or unauthorized (403)');
    }

    // Calculate date range
    const now = new Date();
    const startDate = new Date(now);
    const daysAgo = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    startDate.setDate(startDate.getDate() - daysAgo);

    // Query TimescaleDB for KPI calculations
    const { client: tsClient } = timescale;
    const query = `
      SELECT
        min(avg_price) as floor_price,
        max(avg_price) as ceiling_price,
        stddev(avg_price) as stddev_price,
        avg(avg_price) as mean_price
      FROM price_history_30min_agg
      WHERE product_id = $1 AND bucket >= $2
    `;
    const result = await tsClient.query(query, [productId, startDate]);

    const row = result.rows?.[0];
    const floorPrice = row?.floor_price || 0;
    const meanPrice = row?.mean_price || 0;
    const stddevPrice = row?.stddev_price || 0;

    // Price volatility: coefficient of variation (CV = stddev / mean)
    const priceVolatility = meanPrice > 0 ? stddevPrice / meanPrice : 0;

    // Estimated sales trend: placeholder (requires FR-WORKER-002 sales data)
    // For now, use simple heuristic: if latest price > avg, assume decreasing trend
    let estimatedSalesTrend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    const lastPriceQuery = await tsClient.query(
      `SELECT avg_price FROM price_history_30min_agg
       WHERE product_id = $1
       ORDER BY bucket DESC LIMIT 1`,
      [productId]
    );
    if (lastPriceQuery.rows?.length > 0) {
      const lastPrice = lastPriceQuery.rows[0].avg_price;
      if (lastPrice < meanPrice * 0.95) estimatedSalesTrend = 'decreasing';
      else if (lastPrice > meanPrice * 1.05) estimatedSalesTrend = 'increasing';
    }

    // Alerts triggered: count from alerts collection
    const alertsTriggered = await db.collection('alerts').countDocuments({
      productId,
      sellerId: new ObjectId(sellerId),
      triggeredAt: { $gte: startDate },
    });

    // Competitor count: use cached competitor count per category
    // FR-ADMIN-002 §1 #4 implementation note
    const shopeeCategory = (product.category as string) || 'unknown';
    let competitorCount = 0;
    const competitorCacheKey = `b2b:competitor_count:${shopeeCategory}`;
    const cachedCompetitors = await redis.get(competitorCacheKey);
    if (cachedCompetitors) {
      competitorCount = parseInt(cachedCompetitors, 10);
    } else {
      // Count all sellers in same category (not filtered to direct competitors)
      competitorCount = await db.collection('products').countDocuments({
        category: shopeeCategory,
        sellerId: { $ne: new ObjectId(sellerId) },
      });
      // Cache for 24 hours
      await redis.setex(competitorCacheKey, 86400, competitorCount.toString());
    }

    // Recommended price point: simple heuristic
    // = lowest-in-category-30d-avg - 5% (FR-ADMIN-002 §1 #4)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const categoryAvgQuery = await tsClient.query(
      `SELECT avg(avg_price) as category_avg
       FROM price_history_30min_agg ph
       WHERE EXISTS (
         SELECT 1 FROM products p
         WHERE p.product_id = ph.product_id
           AND p.category = $1
       )
       AND ph.bucket >= $2`,
      [shopeeCategory, thirtyDaysAgo]
    );
    let recommendedPricePoint: number | undefined;
    if (categoryAvgQuery.rows?.length > 0) {
      const categoryAvg = categoryAvgQuery.rows[0].category_avg || 0;
      recommendedPricePoint = Math.round(categoryAvg * 0.95);
    }

    const response: AnalyticsResponse = {
      productId,
      floorPrice: Math.round(floorPrice * 100) / 100,
      priceVolatility: Math.min(Math.round(priceVolatility * 1000) / 1000, 1),
      estimatedSalesTrend: `${
        estimatedSalesTrend === 'increasing'
          ? '↑'
          : estimatedSalesTrend === 'decreasing'
            ? '↓'
            : '→'
      } ${estimatedSalesTrend}`,
      alertsTriggered,
      competitorCountInCategory: competitorCount,
      recommendedPricePoint,
    };

    // Cache for 6 hours
    await redis.setex(cacheKey, 21600, JSON.stringify(response));

    return response;
  }

  /**
   * Check monthly API quota for a subscription.
   * FR-ADMIN-002 §1 #8 — quota enforcement
   */
  async checkApiQuota(
    subscriptionId: string,
    tier: 'starter' | 'growth' | 'enterprise'
  ): Promise<{ remaining: number; limit: number; exceeded: boolean }> {
    const limit = TIER_CONFIG[tier].monthlyApiCalls;
    const cacheKey = `b2b:quota:${subscriptionId}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      const callCount = parseInt(cached, 10);
      const remaining = Math.max(0, limit - callCount);
      return { remaining, limit, exceeded: callCount >= limit };
    }

    // Count API calls in the current month from audit log
    // This is a simplified check; in production, implement proper quota tracking in b2b_api_usage table
    const { db } = mongodb;
    const callCount = await db.collection('b2b_audit_log').countDocuments({
      subscription_id: subscriptionId,
      request_at: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      action: { $in: ['api_search', 'api_history', 'api_analytics'] },
    });

    // Cache quota for 1 minute (will refresh on next check)
    await redis.setex(cacheKey, 60, callCount.toString());

    const remaining = Math.max(0, limit - callCount);
    const exceeded = callCount >= limit;

    return { remaining, limit, exceeded };
  }

  /**
   * Log B2B API access for audit trail.
   * FR-ADMIN-002 §1 #10 — PDPL compliance
   */
  async logB2bAccess(
    subscriptionId: string,
    userId: string,
    sellerId: string,
    action: 'api_search' | 'api_history' | 'api_analytics' | 'page_view_dashboard',
    productId?: string,
    ipHash?: string,
    userAgentHash?: string
  ): Promise<void> {
    const { db } = mongodb;

    try {
      await db.collection('b2b_audit_log').insertOne({
        subscription_id: subscriptionId,
        seller_id: sellerId,
        user_id: userId,
        action,
        product_id: productId || null,
        request_at: new Date(),
        ip_hash: ipHash || null,
        user_agent_hash: userAgentHash || null,
      });

      // Clear quota cache when new activity is recorded
      await redis.del(`b2b:quota:${subscriptionId}`);
    } catch (e) {
      console.error('[audit] Error logging B2B access:', e);
      // Don't throw; audit errors shouldn't block requests
    }
  }

  /**
   * Get dashboard summary for seller.
   * FR-ADMIN-002 §1 #5 — dashboard page data
   */
  async getDashboardSummary(
    sellerId: string,
    tier: 'starter' | 'growth' | 'enterprise'
  ): Promise<{
    totalProducts: number;
    drops7d: number;
    alertsThisMonth: number;
    monthlyQuotaUsed: number;
    monthlyQuotaLimit: number;
  }> {
    const cacheKey = `b2b:dashboard:${sellerId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const { db } = mongodb;

    // Count total products for seller
    const totalProducts = await db.collection('products').countDocuments({
      sellerId: new ObjectId(sellerId),
    });

    // Count price drops > 15% in last 7 days (stub: 0 for now, requires price history query)
    const drops7d = 0;

    // Count alerts triggered this month
    const alertsThisMonth = await db.collection('alerts').countDocuments({
      sellerId: new ObjectId(sellerId),
      triggeredAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    });

    // Get quota usage
    const limit = TIER_CONFIG[tier].monthlyApiCalls;
    const quotaUsed = await db.collection('b2b_audit_log').countDocuments({
      seller_id: sellerId,
      request_at: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    });

    const result = {
      totalProducts,
      drops7d,
      alertsThisMonth,
      monthlyQuotaUsed: quotaUsed,
      monthlyQuotaLimit: limit,
    };

    await redis.setex(cacheKey, 300, JSON.stringify(result)); // Cache for 5 min

    return result;
  }
}

export const dashboardService = new B2BDashboardService();
