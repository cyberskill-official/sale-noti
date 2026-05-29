import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  B2BDashboardService,
  SearchResponse,
  HistoryResponse,
  AnalyticsResponse,
} from '../dashboard.service';
import { mongodb, timescale } from '@/lib/db';
import { redis } from '@/lib/redis';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  mongodb: {
    db: {
      collection: vi.fn(),
    },
  },
  timescale: {
    client: {
      query: vi.fn(),
    },
  },
}));

vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  },
}));

describe('B2BDashboardService', () => {
  let service: B2BDashboardService;
  const sellerId = '507f1f77bcf86cd799439011'; // mock ObjectId
  const productId = 'prod_test_123';

  beforeEach(() => {
    service = new B2BDashboardService();
    vi.clearAllMocks();
  });

  // =========================================================================
  // searchProducts tests
  // =========================================================================

  describe('searchProducts', () => {
    it('should return empty results when no products match', async () => {
      const mockCollection = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            skip: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.searchProducts(sellerId, 'nonexistent', 50, 0);

      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('should return search results with row-level security filter', async () => {
      const mockProducts = [
        {
          productId: 'prod_123',
          shopId: 100,
          itemId: 999,
          name: 'Test Product',
          imageUrl: 'https://example.com/image.jpg',
          currentPrice: 10000,
          currentDiscountPct: 10,
          lastFetchedAt: new Date('2026-05-29'),
        },
      ];

      const mockCollection = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            skip: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue(mockProducts),
              }),
            }),
          }),
        }),
        countDocuments: vi.fn().mockResolvedValue(1),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.searchProducts(sellerId, 'test', 50, 0);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].productId).toBe('prod_123');
      expect(result.results[0].name).toBe('Test Product');
      expect(result.total).toBe(1);

      // Verify row-level security: should have sellerId in the query filter
      const findCall = mockCollection.find.mock.calls[0][0];
      expect(findCall.sellerId).toBeDefined();
    });

    it('should use cache if available', async () => {
      const cachedResult: SearchResponse = {
        results: [],
        total: 0,
        limit: 50,
        offset: 0,
      };

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.searchProducts(sellerId, 'test', 50, 0);

      expect(result).toEqual(cachedResult);
      expect(redis.get).toHaveBeenCalledWith(expect.stringContaining('b2b:search:'));
      // Should not call database when cache hit
      expect(mongodb.db.collection).not.toHaveBeenCalled();
    });

    it('should set cache with 30-min TTL', async () => {
      const mockCollection = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            skip: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await service.searchProducts(sellerId, 'test', 50, 0);

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('b2b:search:'),
        1800, // 30 min in seconds
        expect.any(String)
      );
    });

    it('should reject invalid inputs', async () => {
      await expect(service.searchProducts('', 'test', 50, 0)).rejects.toThrow('Invalid sellerId');
      await expect(service.searchProducts(sellerId, 'test', 0, 0)).rejects.toThrow('limit must be 1-100');
      await expect(service.searchProducts(sellerId, 'test', 101, 0)).rejects.toThrow('limit must be 1-100');
      await expect(service.searchProducts(sellerId, 'test', 50, -1)).rejects.toThrow('offset must be >= 0');
    });
  });

  // =========================================================================
  // getProductHistory tests
  // =========================================================================

  describe('getProductHistory', () => {
    it('should return empty history when no price data exists', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      const result = await service.getProductHistory(sellerId, productId, '7d');

      expect(result.timestamps).toHaveLength(0);
      expect(result.prices).toHaveLength(0);
      expect(result.min30d).toBe(0);
      expect(result.max30d).toBe(0);
    });

    it('should enforce row-level security (403 if product not owned)', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue(null), // Product not found for this seller
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(service.getProductHistory(sellerId, productId, '7d')).rejects.toThrow(/not found|unauthorized/i);
    });

    it('should return aggregated price history data', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      const mockPriceData = [
        { time: new Date('2026-05-22T00:00:00Z'), avg_price: 10000, min_price: 9500, max_price: 10500, discount_pct: 5 },
        { time: new Date('2026-05-23T00:00:00Z'), avg_price: 10200, min_price: 10000, max_price: 10400, discount_pct: 5 },
        { time: new Date('2026-05-29T00:00:00Z'), avg_price: 10100, min_price: 10000, max_price: 10300, discount_pct: 5 },
      ];

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: mockPriceData });

      const result = await service.getProductHistory(sellerId, productId, '7d');

      expect(result.timestamps).toHaveLength(3);
      expect(result.prices).toEqual([10000, 10200, 10100]);
      expect(result.avgPrice).toBeCloseTo(10100, 0);
      expect(result.productId).toBe(productId);
      expect(result.range).toBe('7d');
    });

    it('should use cache if available', async () => {
      const cachedResult = {
        productId,
        range: '7d',
        timestamps: [],
        prices: [],
        discounts: [],
        min30d: 0,
        max30d: 0,
        avgPrice: 0,
        priceChangeToday: { absolute: 0, pct: 0 },
        lastUpdated: new Date().toISOString(),
      };

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.getProductHistory(sellerId, productId, '7d');

      expect(result.productId).toBe(cachedResult.productId);
      expect(result.range).toBe(cachedResult.range);
      expect(result.prices).toEqual(cachedResult.prices);
      expect(mongodb.db.collection).not.toHaveBeenCalled(); // Should not hit DB on cache hit
    });

    it('should set cache with 1-hour TTL', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      await service.getProductHistory(sellerId, productId, '7d');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('b2b:history:'),
        3600, // 1 hour in seconds
        expect.any(String)
      );
    });
  });

  // =========================================================================
  // getProductAnalytics tests
  // =========================================================================

  describe('getProductAnalytics', () => {
    it('should return KPI analytics data', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
        countDocuments: vi.fn()
          .mockResolvedValueOnce(5) // alerts count
          .mockResolvedValueOnce(12), // competitors in category
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValueOnce({
        rows: [
          {
            floor_price: 9500,
            ceiling_price: 11000,
            stddev_price: 500,
            mean_price: 10200,
          },
        ],
      });

      // Mock subsequent queries for trend and competitor category
      const tsQuery = vi.mocked(timescale.client.query);
      tsQuery.mockResolvedValueOnce({ rows: [{ avg_price: 10300 }] }); // last price
      tsQuery.mockResolvedValueOnce({ rows: [{ category_avg: 10000 }] }); // category avg

      const result = await service.getProductAnalytics(sellerId, productId, '7d');

      expect(result.floorPrice).toBe(9500);
      expect(result.priceVolatility).toBeCloseTo(0.049, 2); // 500 / 10200
      expect(result.alertsTriggered).toBe(5);
      expect(result.competitorCountInCategory).toBe(12);
      expect(result.recommendedPricePoint).toBe(9500); // 10000 * 0.95
      expect(['↑ increasing', '→ stable', '↓ decreasing']).toContain(result.estimatedSalesTrend);
    });

    it('should enforce row-level security', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue(null), // Product not owned by seller
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(service.getProductAnalytics(sellerId, productId, '7d')).rejects.toThrow(/not found|unauthorized/i);
    });

    it('should cache competitor count for 24 hours', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
        countDocuments: vi.fn()
          .mockResolvedValueOnce(5) // alerts count
          .mockResolvedValueOnce(12), // competitors in category
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({
        rows: [
          {
            floor_price: 10000,
            ceiling_price: 11000,
            stddev_price: 500,
            mean_price: 10200,
          },
        ],
      });

      const tsQuery = vi.mocked(timescale.client.query);
      tsQuery.mockResolvedValueOnce({ rows: [{ avg_price: 10300 }] }); // last price
      tsQuery.mockResolvedValueOnce({ rows: [{ category_avg: 10000 }] }); // category avg

      await service.getProductAnalytics(sellerId, productId, '7d');

      // Verify competitor count was cached with 24h TTL
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('b2b:competitor_count:'),
        86400, // 24 hours in seconds
        expect.any(String)
      );
    });

    it('should use cached competitor count', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
        countDocuments: vi.fn().mockResolvedValue(5),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      // Return cached competitor count
      vi.mocked(redis.get).mockResolvedValueOnce(null); // no cache for analytics itself
      vi.mocked(redis.get).mockResolvedValueOnce('12'); // cached competitor count

      vi.mocked(timescale.client.query).mockResolvedValue({
        rows: [
          {
            floor_price: 10000,
            ceiling_price: 11000,
            stddev_price: 500,
            mean_price: 10200,
          },
        ],
      });

      const tsQuery = vi.mocked(timescale.client.query);
      tsQuery.mockResolvedValueOnce({ rows: [{ avg_price: 10300 }] });
      tsQuery.mockResolvedValueOnce({ rows: [{ category_avg: 10000 }] });

      const result = await service.getProductAnalytics(sellerId, productId, '7d');

      expect(result.competitorCountInCategory).toBe(12);
      // Should not have called countDocuments for competitors (used cache)
      // (though setup makes countDocuments return 5, not 12)
    });

    it('should set cache with 6-hour TTL', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
        countDocuments: vi.fn().mockResolvedValue(5),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({
        rows: [
          {
            floor_price: 10000,
            ceiling_price: 11000,
            stddev_price: 500,
            mean_price: 10200,
          },
        ],
      });

      const tsQuery = vi.mocked(timescale.client.query);
      tsQuery.mockResolvedValueOnce({ rows: [{ avg_price: 10300 }] });
      tsQuery.mockResolvedValueOnce({ rows: [{ category_avg: 10000 }] });

      await service.getProductAnalytics(sellerId, productId, '7d');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('b2b:analytics:'),
        21600, // 6 hours in seconds
        expect.any(String)
      );
    });

    it('should calculate price volatility (coefficient of variation)', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
        countDocuments: vi.fn()
          .mockResolvedValueOnce(0) // alerts count
          .mockResolvedValueOnce(5), // competitors count
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      // First query: main KPI stats
      vi.mocked(timescale.client.query).mockResolvedValueOnce({
        rows: [
          {
            floor_price: 8000,
            ceiling_price: 12000,
            stddev_price: 1000, // CV = 1000 / 10000 = 0.1
            mean_price: 10000,
          },
        ],
      });

      // Subsequent queries
      const tsQuery = vi.mocked(timescale.client.query);
      tsQuery.mockResolvedValueOnce({ rows: [{ avg_price: 10500 }] }); // last price
      tsQuery.mockResolvedValueOnce({ rows: [{ category_avg: 10000 }] }); // category avg

      const result = await service.getProductAnalytics(sellerId, productId, '7d');

      expect(result.priceVolatility).toBeCloseTo(0.1, 2);
    });
  });

  describe('Tier feature parity', () => {
    it('should allow starter tier to access 7d history', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      // Should not throw
      const result = await service.getProductHistory(sellerId, productId, '7d', 'starter');
      expect(result.range).toBe('7d');
    });

    it('should reject starter tier for 30d history', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(
        service.getProductHistory(sellerId, productId, '30d', 'starter')
      ).rejects.toThrow('UPGRADE_REQUIRED');
    });

    it('should reject starter tier for 90d history', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(
        service.getProductHistory(sellerId, productId, '90d', 'starter')
      ).rejects.toThrow('UPGRADE_REQUIRED');
    });

    it('should allow growth tier to access 90d history', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      // Should not throw
      const result = await service.getProductHistory(sellerId, productId, '90d', 'growth');
      expect(result.range).toBe('90d');
    });

    it('should use correct continuous aggregate based on range', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      // Test 7d → price_history_30min_agg
      await service.getProductHistory(sellerId, productId, '7d', 'starter');
      expect(timescale.client.query).toHaveBeenCalledWith(
        expect.stringContaining('price_history_30min_agg'),
        expect.any(Array)
      );

      vi.clearAllMocks();
      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      // Test 30d → price_history_4h_agg
      await service.getProductHistory(sellerId, productId, '30d', 'growth');
      expect(timescale.client.query).toHaveBeenCalledWith(
        expect.stringContaining('price_history_4h_agg'),
        expect.any(Array)
      );

      vi.clearAllMocks();
      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({ rows: [] });

      // Test 90d → price_history_1d_agg
      await service.getProductHistory(sellerId, productId, '90d', 'growth');
      expect(timescale.client.query).toHaveBeenCalledWith(
        expect.stringContaining('price_history_1d_agg'),
        expect.any(Array)
      );
    });
  });

  // =========================================================================
  // Quota checking tests (FR-ADMIN-002 §1 #8)
  // =========================================================================

  describe('checkApiQuota', () => {
    const subscriptionId = 'sub_test_123';

    it('should return remaining quota for starter tier', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(2500), // Used half of 5000
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.checkApiQuota(subscriptionId, 'starter');

      expect(result.limit).toBe(5000);
      expect(result.remaining).toBe(2500);
      expect(result.exceeded).toBe(false);
    });

    it('should return remaining quota for growth tier', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(25000), // Used half of 50000
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.checkApiQuota(subscriptionId, 'growth');

      expect(result.limit).toBe(50000);
      expect(result.remaining).toBe(25000);
      expect(result.exceeded).toBe(false);
    });

    it('should return exceeded when quota limit reached', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(5000), // At limit for starter
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.checkApiQuota(subscriptionId, 'starter');

      expect(result.exceeded).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should use cached quota if available', async () => {
      vi.mocked(redis.get).mockResolvedValue('2500');

      const result = await service.checkApiQuota(subscriptionId, 'starter');

      expect(result.remaining).toBe(2500);
      expect(result.limit).toBe(5000);
      expect(result.exceeded).toBe(false);
      // Should not call database when cache hit
      expect(mongodb.db.collection).not.toHaveBeenCalled();
    });

    it('should set quota cache with 1-minute TTL', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await service.checkApiQuota(subscriptionId, 'starter');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining(`b2b:quota:${subscriptionId}`),
        60, // 1 minute
        expect.any(String)
      );
    });
  });

  // =========================================================================
  // Audit logging tests (FR-ADMIN-002 §1 #10)
  // =========================================================================

  describe('logB2bAccess', () => {
    const subscriptionId = 'sub_test_123';
    const userId = 'user_test_123';

    it('should log API access to audit collection', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit_id_123' }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.del).mockResolvedValue(1);

      await service.logB2bAccess(
        subscriptionId,
        userId,
        sellerId,
        'api_search',
        'prod_123',
        'ip_hash_abc',
        'ua_hash_xyz'
      );

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_id: subscriptionId,
          seller_id: sellerId,
          user_id: userId,
          action: 'api_search',
          product_id: 'prod_123',
          ip_hash: 'ip_hash_abc',
          user_agent_hash: 'ua_hash_xyz',
          request_at: expect.any(Date),
        })
      );
    });

    it('should clear quota cache after logging access', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit_id_123' }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.del).mockResolvedValue(1);

      await service.logB2bAccess(
        subscriptionId,
        userId,
        sellerId,
        'api_history',
        'prod_123'
      );

      expect(redis.del).toHaveBeenCalledWith(`b2b:quota:${subscriptionId}`);
    });

    it('should not throw if audit insert fails', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockRejectedValue(new Error('DB error')),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.del).mockResolvedValue(1);

      // Should not throw
      await service.logB2bAccess(
        subscriptionId,
        userId,
        sellerId,
        'api_analytics',
        'prod_123'
      );
    });

    it('should support all audit action types', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit_id_123' }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.del).mockResolvedValue(1);

      const actions: Array<'api_search' | 'api_history' | 'api_analytics' | 'page_view_dashboard'> = [
        'api_search',
        'api_history',
        'api_analytics',
        'page_view_dashboard',
      ];

      for (const action of actions) {
        await service.logB2bAccess(subscriptionId, userId, sellerId, action);
      }

      expect(mockCollection.insertOne).toHaveBeenCalledTimes(4);
    });
  });;

  // =========================================================================
  // Dashboard summary tests (FR-ADMIN-002 §1 #5)
  // =========================================================================

  describe('getDashboardSummary', () => {
    it('should return dashboard overview data', async () => {
      const mockCollection = {
        countDocuments: vi
          .fn()
          .mockResolvedValueOnce(25) // total products
          .mockResolvedValueOnce(3) // alerts this month
          .mockResolvedValueOnce(1500), // quota used
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.getDashboardSummary(sellerId, 'growth');

      expect(result.totalProducts).toBe(25);
      expect(result.alertsThisMonth).toBe(3);
      expect(result.monthlyQuotaUsed).toBe(1500);
      expect(result.monthlyQuotaLimit).toBe(50000); // growth tier limit
    });

    it('should use cached dashboard summary', async () => {
      const cachedResult = {
        totalProducts: 25,
        drops7d: 5,
        alertsThisMonth: 3,
        monthlyQuotaUsed: 1500,
        monthlyQuotaLimit: 50000,
      };

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.getDashboardSummary(sellerId, 'growth');

      expect(result).toEqual(cachedResult);
      expect(mongodb.db.collection).not.toHaveBeenCalled(); // No DB call on cache hit
    });

    it('should set cache with 5-minute TTL', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await service.getDashboardSummary(sellerId, 'starter');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining(`b2b:dashboard:${sellerId}`),
        300, // 5 minutes
        expect.any(String)
      );
    });
  });
});
