// FR-WORKER-001 §3 — queue registration with shared queue metadata.
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CommissionReconcileProcessor } from "./commission-reconcile.processor";
import { HeartbeatScheduler } from "./heartbeat.scheduler";
import { HousekeepingProcessor } from "./housekeeping.processor";
import { QueueEventBridge } from "./queue.event-bridge";
import { DEFAULT_JOB_OPTIONS, QUEUES, bullConnectionFromUrl } from "./queues";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          connection: bullConnectionFromUrl(config.getOrThrow<string>("REDIS_URL")),
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        };
      },
    }),
    BullModule.registerQueue(...QUEUES.map((name) => ({ name }))),
  ],
  providers: [QueueEventBridge, HeartbeatScheduler, HousekeepingProcessor, CommissionReconcileProcessor],
  exports: [BullModule],
})
export class QueueModule {}
