import { Module } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";
import { WebhookController } from "./webhook.controller";
import { GracePeriodCron } from "./grace-period-cron";

@Module({
  providers: [BillingService, GracePeriodCron],
  controllers: [BillingController, WebhookController],
  exports: [BillingService],
})
export class BillingModule {}
