// FR-WORKER-001 §3 — queue registration with rate-limiter on price-check.
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { QueueEventBridge } from "./queue.event-bridge";

export const QUEUES = ["price-check", "alert-dispatch", "commission-reconcile", "housekeeping"] as const;
export type QueueName = (typeof QUEUES)[number];

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const urlStr = config.getOrThrow<string>("REDIS_URL");
        const u = new URL(urlStr);
        return {
          connection: {
            host: u.hostname,
            port: Number(u.port),
            password: u.password || undefined,
            tls: u.protocol === "rediss:" ? {} : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 1000, age: 86_400 },
            removeOnFail: { count: 5000, age: 7 * 86_400 },
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: "price-check", limiter: { max: Number(process.env.SHOPEE_RATE_LIMIT_PER_MIN ?? 1000), duration: 60_000 } },
      { name: "alert-dispatch" },
      { name: "commission-reconcile" },
      { name: "housekeeping" }
    ),
  ],
  providers: [QueueEventBridge],
  exports: [BullModule],
})
export class QueueModule {}
