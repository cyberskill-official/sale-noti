import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { Redis } from 'ioredis';
import { dashboardService } from '@/server/admin/dashboard.service';
import { sentry } from "@/server/obs/sentry.server";
import { applyTenantObservabilityTags, type TenantTier } from "@/server/obs/tenant";
import { z } from 'zod';
import { createHash } from 'crypto';

/**
 * GET /api/admin/products/search?q=<query>&limit=50&offset=0
 *
 * Search seller's own products by name/shop (row-level security).
 * Rate-limit: 10/min/user
 * Cached: 30 min
 * FR-ADMIN-002 §1 #2, #10
 */

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(100, 'Query too long (max 100 chars)'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type SearchQuery = z.infer<typeof SearchQuerySchema>;

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').substring(0, 16);
}

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const userId = session.user.id;
    const sellerId = session.user.sellerId || userId; // b2b users have sellerId
    const userTier = ((session.user as any)?.tier || "starter") as TenantTier; // default to starter
    const subscriptionId = (session.user as any)?.subscriptionId;

    applyTenantObservabilityTags(sentry, {
      scope: "b2b",
      tenantId: sellerId,
      subscriptionId: subscriptionId ?? null,
      tier: userTier,
    });

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'No active subscription' },
        { status: 403 }
      );
    }

    // Rate-limit: 10/min/user (fixed window)
    const rateLimitKey = `b2b:ratelimit:${userId}:search`;
    const requests = await redis.incr(rateLimitKey);
    if (requests === 1) {
      await redis.expire(rateLimitKey, 60);
    }
    if (requests > 10) {
      return NextResponse.json(
        { error: 'RATE_LIMIT', retryAfter: 60 },
        { status: 429 }
      );
    }

    // Check monthly quota
    const quotaCheck = await dashboardService.checkApiQuota(subscriptionId, userTier as any);
    if (quotaCheck.exceeded) {
      return NextResponse.json(
        { error: 'QUOTA_EXCEEDED', remaining: 0, limit: quotaCheck.limit },
        { status: 429 }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const parseResult = SearchQuerySchema.safeParse({
      q: searchParams.get('q'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { q, limit, offset } = parseResult.data;

    // Execute search
    const result = await dashboardService.searchProducts(sellerId, q, limit, offset);

    // Log audit trail (async, non-blocking)
    const ipHash = hashValue(request.ip || 'unknown');
    const userAgentHash = hashValue(request.headers.get('user-agent') || 'unknown');
    dashboardService
      .logB2bAccess(subscriptionId, userId, sellerId, 'api_search', undefined, ipHash, userAgentHash)
      .catch((e) => console.error('[audit] search error:', e));

    // Add quota info to response headers
    const remainingQuota = quotaCheck.limit - (quotaCheck.limit - quotaCheck.remaining) - 1;
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'X-RateLimit-Remaining': requests.toString(),
        'X-Quota-Remaining': Math.max(0, remainingQuota).toString(),
        'X-Quota-Limit': quotaCheck.limit.toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';

    // Check if it's a not-found error (should return 403 per FR-ADMIN-002 §1 #11)
    if (message.includes('unauthorized') || message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Access denied' },
        { status: 403 }
      );
    }

    console.error('[search] Error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
