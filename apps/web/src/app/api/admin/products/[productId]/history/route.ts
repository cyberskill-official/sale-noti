import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { Redis } from 'ioredis';
import { dashboardService } from '@/server/admin/dashboard.service';
import { sentry } from "@/server/obs/sentry.server";
import { applyTenantObservabilityTags, type TenantTier } from "@/server/obs/tenant";
import { z } from 'zod';
import { createHash } from 'crypto';

/**
 * GET /api/admin/products/:productId/history?range=7d|30d|90d
 *
 * Fetch price history from pre-aggregated TimescaleDB buckets.
 * Row-level security: seller only sees own products
 * Cached: 1 hour
 * FR-ADMIN-002 §1 #3, #10
 */

const HistoryQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d']).default('7d'),
});

type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').substring(0, 16);
}

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  try {
    // Auth check
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const userId = session.user.id;
    const sellerId = session.user.sellerId || userId;
    const userTier = ((session.user as any)?.tier || "starter") as TenantTier;
    const subscriptionId = (session.user as any)?.subscriptionId;
    const productId = params.productId;

    applyTenantObservabilityTags(sentry, {
      scope: "b2b",
      tenantId: sellerId,
      subscriptionId: subscriptionId ?? null,
      tier: userTier,
    });

    if (!productId) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', message: 'Missing productId' },
        { status: 400 }
      );
    }

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'No active subscription' },
        { status: 403 }
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
    const parseResult = HistoryQuerySchema.safeParse({
      range: searchParams.get('range'),
    });

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { range } = parseResult.data;

    // Execute history query
    const result = await dashboardService.getProductHistory(
      sellerId,
      productId,
      range,
      userTier as any
    );

    // Log audit trail (async, non-blocking)
    const ipHash = hashValue(request.ip || 'unknown');
    const userAgentHash = hashValue(request.headers.get('user-agent') || 'unknown');
    dashboardService
      .logB2bAccess(subscriptionId, userId, sellerId, 'api_history', productId, ipHash, userAgentHash)
      .catch((e) => console.error('[audit] history error:', e));

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'X-Quota-Remaining': Math.max(0, quotaCheck.remaining - 1).toString(),
        'X-Quota-Limit': quotaCheck.limit.toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';

    // Row-level security: return 403 not 404 (per FR-ADMIN-002 §1 #11)
    if (
      message.includes('unauthorized') ||
      message.includes('Unauthorized') ||
      message.includes('not found') ||
      message.includes('FORBIDDEN')
    ) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'Access denied' },
        { status: 403 }
      );
    }

    if (message.includes('UPGRADE_REQUIRED')) {
      return NextResponse.json(
        { error: 'UPGRADE_REQUIRED', message: 'Tier upgrade required for 90d history' },
        { status: 403 }
      );
    }

    console.error('[history] Error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
