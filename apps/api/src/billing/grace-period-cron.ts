// FR-BILL-001 §1 #7 — hourly cron to advance grace state.
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BillingService } from "./billing.service";

@Injectable()
export class GracePeriodCron {
  private readonly log = new Logger(GracePeriodCron.name);
  constructor(private readonly billing: BillingService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: "billing-grace-tick" })
  async tick() {
    if (!process.env.MONGODB_URI) return;
    try {
      await this.billing.tickGracePeriod();
    } catch (e) {
      this.log.error("grace tick failed", e);
    }
  }
}
