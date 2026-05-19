// FR-WORKER-001 §1 #8 — repeatable Better Stack heartbeat jobs.
import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";

const HEARTBEATS = [
  { key: "cron-price-check-tier1-30m", env: "BETTER_STACK_HEARTBEAT_URL_TIER1", pattern: "*/30 * * * *" },
  { key: "cron-price-check-tier2-6h", env: "BETTER_STACK_HEARTBEAT_URL_TIER2", pattern: "0 */6 * * *" },
  { key: "cron-price-check-tier3-24h", env: "BETTER_STACK_HEARTBEAT_URL_TIER3", pattern: "0 0 * * *" },
  { key: "cron-megasale-teaser", env: "BETTER_STACK_HEARTBEAT_URL_MEGASALE", pattern: "0 9 * * *" },
  { key: "cron-grace-period-worker", env: "BETTER_STACK_HEARTBEAT_URL_GRACE", pattern: "0 */6 * * *" },
  { key: "cron-retention-purge", env: "BETTER_STACK_HEARTBEAT_URL_RETENTION", pattern: "0 */6 * * *" },
] as const;

@Injectable()
export class HeartbeatScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue("housekeeping") private readonly housekeepingQueue: Queue) {}

  async onApplicationBootstrap() {
    for (const heartbeat of HEARTBEATS) {
      const heartbeatUrl = process.env[heartbeat.env] ?? process.env.BETTER_STACK_HEARTBEAT_URL;
      await this.housekeepingQueue.add(
        "better-stack-heartbeat",
        { kind: "better-stack-heartbeat", heartbeatKey: heartbeat.key, heartbeatUrl },
        {
          jobId: `heartbeat:${heartbeat.key}`,
          repeat: { pattern: heartbeat.pattern },
          removeOnComplete: { count: 100, age: 86_400 },
          removeOnFail: { count: 500, age: 604_800 },
        }
      );
    }
  }
}
