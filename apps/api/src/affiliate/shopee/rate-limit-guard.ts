// FR-AFF-001 §3 — Redis-backed token bucket for global Shopee API rate limit.
// Per FR-WORKER-002 §2 lower bound: default 1000/min, override via SHOPEE_RATE_LIMIT_PER_MIN.
import { Injectable, Logger } from "@nestjs/common";
import { redis } from "../../queue/redis.client";

@Injectable()
export class ShopeeRateLimitGuard {
  private readonly log = new Logger(ShopeeRateLimitGuard.name);
  private readonly maxPerMin = Number(process.env.SHOPEE_RATE_LIMIT_PER_MIN ?? 1000);
  private readonly key = "shopee:rl:global";

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
      await new Promise((r) => setTimeout(r, sleep));
      return this.acquire();
    }
  }
}
