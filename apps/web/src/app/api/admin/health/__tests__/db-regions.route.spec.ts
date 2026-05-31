import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '../db-regions/route';
import { mongo } from '@/server/db/mongo';

vi.mock('@/server/db/mongo', () => ({
  mongo: {
    health: vi.fn(),
  },
}));

describe('GET /api/admin/health/db-regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the regional health snapshot with no-store caching', async () => {
    const healthPayload = {
      sg: {
        connected: true,
        latency_ms: 42,
        replica_lag_seconds: 0,
        status: 'primary',
      },
      us: {
        connected: true,
        latency_ms: 118,
        replica_lag_seconds: 9,
        status: 'secondary',
      },
      timestamp: '2026-05-31T00:00:00.000Z',
    };

    vi.mocked(mongo.health).mockResolvedValue(healthPayload as any);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(healthPayload);
    expect(mongo.health).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when both regions are unavailable', async () => {
    vi.mocked(mongo.health).mockResolvedValue({
      sg: {
        connected: false,
        latency_ms: null,
        replica_lag_seconds: null,
        status: 'primary-down',
      },
      us: {
        connected: false,
        latency_ms: null,
        replica_lag_seconds: null,
        status: 'secondary-down',
      },
      timestamp: '2026-05-31T00:00:00.000Z',
    } as any);

    const response = await GET();

    expect(response.status).toBe(503);
  });
});
