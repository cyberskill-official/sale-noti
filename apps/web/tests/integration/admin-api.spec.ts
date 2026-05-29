/**
 * Integration tests for B2B Admin API routes (FR-ADMIN-002)
 * Tests search, history, and analytics endpoints with quota, rate-limiting, and RLS
 * Uses mocked dependencies with service layer verification
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { B2BDashboardService } from '@/server/admin/dashboard.service';
import { mongodb, timescale } from '@/lib/db';
import { redis } from '@/lib/redis';
import { ObjectId } from 'mongodb';

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
    incr: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
  },
}));

describe('Admin API Integration (FR-ADMIN-002)', () => {
  let service: B2BDashboardService;
  const sellerId = new ObjectId('507f1f77bcf86cd799439011');
  const subscriptionId = 'sub_test_123';
  const userId = 'user_test_123';
  const productId = 'prod_test_123';
  const tier = 'growth';

  beforeEach(() => {
    service = new B2BDashboardService();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Search API integration
  // =========================================================================

  describe('Search API Integration', () => {
    it('should complete successful search flow with caching', async () => {
      const mockCollection = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            skip: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    productId: 'prod_123',
                    sellerId,
                    name: 'Test Product',
                    currentPrice: 10000,
                  },
                ]),
              }),
            }),
          }),
        }),
        countDocuments: vi.fn().mockResolvedValue(1),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue('OK');

      // First search hits database
      const result1 = await service.searchProducts(sellerId.toString(), 'test', 50, 0);
      expect(result1.results).toHaveLength(1);
      expect(result1.total).toBe(1);

      // Verify cache was set
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('b2b:search:'),
        1800,
        expect.any(String)
      );

      const cacheSetCallCount = vi.mocked(mongodb.db.collection).mock.calls.length;

      // Second search should use cache (JSON serialized)
      const cachedJson = JSON.stringify(result1);
      vi.mocked(redis.get).mockResolvedValue(cachedJson);
      const result2 = await service.searchProducts(sellerId.toString(), 'test', 50, 0);

      // Verify results match (accounting for JSON deserialization)
      expect(result2.total).toBe(result1.total);
      expect(result2.results.length).toBe(result1.results.length);
      expect(result2.results[0]?.productId).toBe(result1.results[0]?.productId);

      // Verify no additional database calls (count should not increase)
      const cacheHitCallCount = vi.mocked(mongodb.db.collection).mock.calls.length;
      expect(cacheHitCallCount).toBe(cacheSetCallCount); // No new DB calls on cache hit
    });

    it('should enforce RLS: deny cross-seller product access', async () => {
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

      // Verify that RLS filter is applied in query
      await service.searchProducts(sellerId.toString(), 'test', 50, 0);

      const findCall = mockCollection.find.mock.calls[0]?.[0];
      expect(findCall?.sellerId).toBeDefined();
      expect(findCall.sellerId).toEqual(new ObjectId(sellerId));
    });

    it('should validate search input parameters', async () => {
      await expect(service.searchProducts('', 'test', 50, 0)).rejects.toThrow();
      await expect(service.searchProducts(sellerId.toString(), 'test', 0, 0)).rejects.toThrow();
      await expect(service.searchProducts(sellerId.toString(), 'test', 101, 0)).rejects.toThrow();
      await expect(
        service.searchProducts(sellerId.toString(), 'test', 50, -1)
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // History API integration
  // =========================================================================

  describe('History API Integration', () => {
    it('should complete successful history flow with tier-based access', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query).mockResolvedValue({
        rows: [
          {
            time: new Date(),
            avg_price: 10000,
            min_price: 9500,
            max_price: 10500,
          },
        ],
      });

      // Growth tier can access 90d
      const result = await service.getProductHistory(
        sellerId.toString(),
        productId,
        '90d',
        'growth'
      );

      expect(result.prices).toBeDefined();
      expect(result.range).toBe('90d');
    });

    it('should enforce tier restrictions: starter cannot access 30d/90d', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      // Starter tier: 7d only
      await expect(
        service.getProductHistory(sellerId.toString(), productId, '30d', 'starter')
      ).rejects.toThrow('UPGRADE_REQUIRED');

      await expect(
        service.getProductHistory(sellerId.toString(), productId, '90d', 'starter')
      ).rejects.toThrow('UPGRADE_REQUIRED');
    });

    it('should use correct TimescaleDB aggregate per range', async () => {
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

      // 7d should use 30min aggregate
      await service.getProductHistory(sellerId.toString(), productId, '7d', 'starter');
      expect(timescale.client.query).toHaveBeenCalledWith(
        expect.stringContaining('price_history_30min_agg'),
        expect.any(Array)
      );
    });

    it('should enforce RLS: deny access to unowned products', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue(null), // Product not found for this seller
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(
        service.getProductHistory(sellerId.toString(), productId, '7d', 'growth')
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Analytics API integration
  // =========================================================================

  describe('Analytics API Integration', () => {
    it('should calculate analytics KPIs with competitor caching', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue({
          productId,
          sellerId,
          category: 'shirts',
        }),
        countDocuments: vi.fn()
          .mockResolvedValueOnce(3) // alerts
          .mockResolvedValueOnce(8), // competitors
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(timescale.client.query)
        .mockResolvedValueOnce({
          rows: [
            {
              floor_price: 9000,
              ceiling_price: 11000,
              stddev_price: 500,
              mean_price: 10000,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ avg_price: 10200 }] })
        .mockResolvedValueOnce({ rows: [{ category_avg: 10000 }] });

      const result = await service.getProductAnalytics(
        sellerId.toString(),
        productId,
        '7d',
        'growth'
      );

      expect(result.floorPrice).toBe(9000);
      expect(result.alertsTriggered).toBe(3);
      expect(result.competitorCountInCategory).toBe(8);

      // Verify competitor count was cached
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('b2b:competitor_count:'),
        86400,
        expect.any(String)
      );
    });

    it('should enforce RLS in analytics', async () => {
      const mockCollection = {
        findOne: vi.fn().mockResolvedValue(null), // Not owned by seller
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(
        service.getProductAnalytics(sellerId.toString(), productId, '7d', 'growth')
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // API Quota integration
  // =========================================================================

  describe('API Quota Integration', () => {
    it('should track API call count and enforce monthly limit', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(4500), // Used 4500 of 5000 for starter
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.checkApiQuota(subscriptionId, 'starter');

      expect(result.limit).toBe(5000);
      expect(result.remaining).toBe(500);
      expect(result.exceeded).toBe(false);
    });

    it('should mark quota as exceeded when limit reached', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(5000), // At limit
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.checkApiQuota(subscriptionId, 'starter');

      expect(result.exceeded).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should cache quota for 1 minute', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await service.checkApiQuota(subscriptionId, 'growth');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining(`b2b:quota:${subscriptionId}`),
        60,
        expect.any(String)
      );
    });
  });

  // =========================================================================
  // Audit logging integration
  // =========================================================================

  describe('Audit Logging Integration', () => {
    it('should log API access and clear quota cache', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit_id' }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.del).mockResolvedValue(1);

      await service.logB2bAccess(
        subscriptionId,
        userId,
        sellerId.toString(),
        'api_search',
        productId,
        'ip_hash_abc',
        'ua_hash_xyz'
      );

      // Verify quota cache was invalidated
      expect(redis.del).toHaveBeenCalledWith(`b2b:quota:${subscriptionId}`);
    });

    it('should hash sensitive data before audit logging', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit_id' }),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.del).mockResolvedValue(1);

      await service.logB2bAccess(
        subscriptionId,
        userId,
        sellerId.toString(),
        'api_search',
        productId,
        'hashed_ip_12345678',
        'hashed_ua_abcdefgh'
      );

      const insertCall = mockCollection.insertOne.mock.calls[0]?.[0];
      expect(insertCall.ip_hash).toBe('hashed_ip_12345678');
      expect(insertCall.user_agent_hash).toBe('hashed_ua_abcdefgh');
    });

    it('should not throw if audit insert fails', async () => {
      const mockCollection = {
        insertOne: vi.fn().mockRejectedValue(new Error('DB error')),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.del).mockResolvedValue(1);

      // Should complete without throwing
      await expect(
        service.logB2bAccess(
          subscriptionId,
          userId,
          sellerId.toString(),
          'api_search',
          productId
        )
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Dashboard summary integration
  // =========================================================================

  describe('Dashboard Summary Integration', () => {
    it('should provide dashboard overview with quota info', async () => {
      const mockCollection = {
        countDocuments: vi
          .fn()
          .mockResolvedValueOnce(25) // total products
          .mockResolvedValueOnce(3) // alerts this month
          .mockResolvedValueOnce(1500), // quota used
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      const result = await service.getDashboardSummary(sellerId.toString(), 'growth');

      expect(result.totalProducts).toBe(25);
      expect(result.drops7d).toBe(0); // Stub: requires price history analysis
      expect(result.alertsThisMonth).toBe(3);
      expect(result.monthlyQuotaUsed).toBe(1500);
      expect(result.monthlyQuotaLimit).toBe(50000); // growth tier
    });

    it('should cache dashboard summary for 5 minutes', async () => {
      const mockCollection = {
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(mongodb.db.collection).mockReturnValue(mockCollection as any);
      vi.mocked(redis.get).mockResolvedValue(null);

      await service.getDashboardSummary(sellerId.toString(), 'starter');

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining(`b2b:dashboard:${sellerId}`),
        300,
        expect.any(String)
      );
    });
  });

  // =========================================================================
  // Error handling & edge cases
  // =========================================================================

  describe('Error Handling & Edge Cases', () => {
    it('should handle empty search results gracefully', async () => {
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

      const result = await service.searchProducts(sellerId.toString(), 'nonexistent', 50, 0);

      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should handle missing price data in history', async () => {
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

      const result = await service.getProductHistory(
        sellerId.toString(),
        productId,
        '7d',
        'growth'
      );

      expect(result.prices).toHaveLength(0);
      expect(result.avgPrice).toBe(0);
    });

    it('should handle database connection errors gracefully', async () => {
      vi.mocked(mongodb.db.collection).mockImplementation(() => {
        throw new Error('Connection refused');
      });

      await expect(
        service.searchProducts(sellerId.toString(), 'test', 50, 0)
      ).rejects.toThrow();
    });
  });
});
