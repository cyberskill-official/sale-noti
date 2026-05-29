import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as searchGET } from '../../../../../app/api/admin/products/search/route';
import { GET as historyGET } from '../../../../../app/api/admin/products/[productId]/history/route';
import { GET as analyticsGET } from '../../../../../app/api/admin/products/[productId]/analytics/route';
import { auth } from '@/lib/auth';
import { rateLimitFixed } from '@/lib/rate-limit';
import { dashboardService } from '../dashboard.service';

// Mock dependencies
vi.mock('@/lib/auth');
vi.mock('@/lib/rate-limit');
vi.mock('../dashboard.service');

describe('B2B Admin API Routes', () => {
  const mockSession = {
    user: {
      id: 'user_123',
      sellerId: 'seller_123',
      email: 'seller@example.com',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(rateLimitFixed).mockResolvedValue(false); // Not rate-limited
  });

  // =========================================================================
  // Search endpoint tests
  // =========================================================================

  describe('GET /api/admin/products/search', () => {
    it('should reject unauthenticated requests', async () => {
      vi.mocked(auth).mockResolvedValue(null);

      const request = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test'));
      const response = await searchGET(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe('UNAUTHORIZED');
    });

    it('should return 429 when rate-limited', async () => {
      vi.mocked(rateLimitFixed).mockResolvedValue(true); // Rate-limited

      const request = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test&limit=50'));
      const response = await searchGET(request);

      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json.error).toBe('RATE_LIMIT');
    });

    it('should require query parameter', async () => {
      const request = new NextRequest(new URL('http://localhost/api/admin/products/search'));
      const response = await searchGET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('should reject query parameter > 100 chars', async () => {
      const longQuery = 'a'.repeat(101);
      const request = new NextRequest(new URL(`http://localhost/api/admin/products/search?q=${longQuery}`));
      const response = await searchGET(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('should reject invalid limit/offset', async () => {
      const request1 = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test&limit=0'));
      const response1 = await searchGET(request1);
      expect(response1.status).toBe(400);

      const request2 = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test&limit=101'));
      const response2 = await searchGET(request2);
      expect(response2.status).toBe(400);

      const request3 = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test&offset=-1'));
      const response3 = await searchGET(request3);
      expect(response3.status).toBe(400);
    });

    it('should call searchProducts with correct parameters', async () => {
      const mockResponse = {
        results: [],
        total: 0,
        limit: 50,
        offset: 0,
      };
      vi.mocked(dashboardService.searchProducts).mockResolvedValue(mockResponse);

      const request = new NextRequest(
        new URL('http://localhost/api/admin/products/search?q=test&limit=25&offset=10')
      );
      const response = await searchGET(request);

      expect(dashboardService.searchProducts).toHaveBeenCalledWith(
        'seller_123',
        'test',
        25,
        10
      );
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual(mockResponse);
    });

    it('should apply rate-limit per user', async () => {
      vi.mocked(dashboardService.searchProducts).mockResolvedValue({
        results: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      const request = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test'));
      await searchGET(request);

      expect(rateLimitFixed).toHaveBeenCalledWith(
        'user_123',
        'b2b_search',
        10, // max 10 calls
        60 // per 60 seconds
      );
    });

    it('should return 403 when service raises authorization error', async () => {
      vi.mocked(dashboardService.searchProducts).mockRejectedValue(
        new Error('Product unauthorized')
      );

      const request = new NextRequest(new URL('http://localhost/api/admin/products/search?q=test'));
      const response = await searchGET(request);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // History endpoint tests
  // =========================================================================

  describe('GET /api/admin/products/:productId/history', () => {
    it('should reject unauthenticated requests', async () => {
      vi.mocked(auth).mockResolvedValue(null);

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/history'));
      const response = await historyGET(request, { params: { productId: 'prod_123' } });

      expect(response.status).toBe(401);
    });

    it('should require valid range parameter', async () => {
      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/history?range=invalid'));
      const response = await historyGET(request, { params: { productId: 'prod_123' } });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('should default range to 7d', async () => {
      const mockResponse: any = {
        productId: 'prod_123',
        range: '7d',
        timestamps: [],
        prices: [],
        discounts: [],
        min30d: 0,
        max30d: 0,
        avgPrice: 0,
        priceChangeToday: { absolute: 0, pct: 0 },
        lastUpdated: new Date(),
      };
      vi.mocked(dashboardService.getProductHistory).mockResolvedValue(mockResponse);

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/history'));
      const response = await historyGET(request, { params: { productId: 'prod_123' } });

      expect(dashboardService.getProductHistory).toHaveBeenCalledWith('seller_123', 'prod_123', '7d');
      expect(response.status).toBe(200);
    });

    it('should accept all valid ranges (7d, 30d, 90d)', async () => {
      const mockResponse: any = {
        productId: 'prod_123',
        range: '30d',
        timestamps: [],
        prices: [],
        discounts: [],
        min30d: 0,
        max30d: 0,
        avgPrice: 0,
        priceChangeToday: { absolute: 0, pct: 0 },
        lastUpdated: new Date(),
      };
      vi.mocked(dashboardService.getProductHistory).mockResolvedValue(mockResponse);

      for (const range of ['7d', '30d', '90d']) {
        const request = new NextRequest(
          new URL(`http://localhost/api/admin/products/prod_123/history?range=${range}`)
        );
        const response = await historyGET(request, { params: { productId: 'prod_123' } });

        expect(response.status).toBe(200);
        expect(dashboardService.getProductHistory).toHaveBeenCalledWith('seller_123', 'prod_123', range);
      }
    });

    it('should return 403 on unauthorized access (row-level security)', async () => {
      vi.mocked(dashboardService.getProductHistory).mockRejectedValue(
        new Error('Product not found or unauthorized')
      );

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_456/history'));
      const response = await historyGET(request, { params: { productId: 'prod_456' } });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // Analytics endpoint tests
  // =========================================================================

  describe('GET /api/admin/products/:productId/analytics', () => {
    it('should reject unauthenticated requests', async () => {
      vi.mocked(auth).mockResolvedValue(null);

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/analytics'));
      const response = await analyticsGET(request, { params: { productId: 'prod_123' } });

      expect(response.status).toBe(401);
    });

    it('should require valid range parameter', async () => {
      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/analytics?range=invalid'));
      const response = await analyticsGET(request, { params: { productId: 'prod_123' } });

      expect(response.status).toBe(400);
    });

    it('should default range to 7d', async () => {
      const mockResponse: any = {
        productId: 'prod_123',
        floorPrice: 10000,
        priceVolatility: 0.1,
        estimatedSalesTrend: '→ stable',
        alertsTriggered: 2,
        competitorCountInCategory: 5,
        recommendedPricePoint: 9500,
      };
      vi.mocked(dashboardService.getProductAnalytics).mockResolvedValue(mockResponse);

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/analytics'));
      const response = await analyticsGET(request, { params: { productId: 'prod_123' } });

      expect(dashboardService.getProductAnalytics).toHaveBeenCalledWith('seller_123', 'prod_123', '7d');
      expect(response.status).toBe(200);
    });

    it('should return 403 on unauthorized access', async () => {
      vi.mocked(dashboardService.getProductAnalytics).mockRejectedValue(
        new Error('Product not found')
      );

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_456/analytics'));
      const response = await analyticsGET(request, { params: { productId: 'prod_456' } });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('FORBIDDEN');
    });

    it('should include all KPI fields in response', async () => {
      const mockResponse: any = {
        productId: 'prod_123',
        floorPrice: 10000,
        priceVolatility: 0.15,
        estimatedSalesTrend: '↓ decreasing',
        alertsTriggered: 3,
        competitorCountInCategory: 12,
        recommendedPricePoint: 9500,
      };
      vi.mocked(dashboardService.getProductAnalytics).mockResolvedValue(mockResponse);

      const request = new NextRequest(new URL('http://localhost/api/admin/products/prod_123/analytics?range=30d'));
      const response = await analyticsGET(request, { params: { productId: 'prod_123' } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual(mockResponse);
      expect(json.floorPrice).toBe(10000);
      expect(json.priceVolatility).toBe(0.15);
      expect(json.estimatedSalesTrend).toBe('↓ decreasing');
      expect(json.alertsTriggered).toBe(3);
      expect(json.competitorCountInCategory).toBe(12);
      expect(json.recommendedPricePoint).toBe(9500);
    });
  });
});
