// FR-AFF-005 §1 #5 — Redis-backed token bucket for global Lazada API rate limit.
// Per FR-WORKER-002 §2 lower bound: default 1000/min.
import { Injectable, Logger } from "@nestjs/common";
import { redis } from "../../queue/redis.client";

@Injectable()
export class LazadaRateLimitGuard {
  private readonly log = new Logger(LazadaRateLimitGuard.name);
  private readonly maxPerMin = Number(process.env.LAZADA_RATE_LIMIT_PER_MIN ?? 1000);
  private readonly key = "lazada:rl:global";

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
