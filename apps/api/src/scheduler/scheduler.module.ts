import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdaptiveSchedulerService } from "./adaptive-scheduler.service";

@Module({
  imports: [BullModule.registerQueue({ name: "price-check" })],
  providers: [AdaptiveSchedulerService],
  exports: [AdaptiveSchedulerService],
})
export class SchedulerModule {}
