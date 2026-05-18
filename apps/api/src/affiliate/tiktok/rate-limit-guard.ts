// FR-AFF-006 — Redis-backed token bucket for the TikTok Shop affiliate client.
import { Injectable, Logger } from "@nestjs/common";
import { redis } from "../../queue/redis.client";

@Injectable()
export class TikTokShopRateLimitGuard {
  private readonly log = new Logger(TikTokShopRateLimitGuard.name);
  private readonly maxPerMin: number;
  private readonly key = "tiktokshop:rl:global";

  constructor() {
    const parsed = Number(process.env.TIKTOK_SHOP_RATE_LIMIT_PER_MIN ?? 1000);
    this.maxPerMin = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
  }

  /** Blocks up to ~5s waiting for a slot; recurses into the next minute if needed. */
  async acquire(): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const bucket = `${this.key}:${minute}`;
    const used = await redis.incr(bucket);
    if (used === 1) await redis.expire(bucket, 65);
    if (used > this.maxPerMin) {
      const waitMs = 60_000 - (Date.now() % 60_000);
      const sleep = Math.min(waitMs, 5_000);
      this.log.debug(`rate limit hit (used=${used}); sleeping ${sleep}ms`);
      await new Promise((resolve) => setTimeout(resolve, sleep));
      return this.acquire();
    }
  }
}
