import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ObsModule } from "./obs/obs.module";
import { QueueModule } from "./queue/queue.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { BullBoardWrapperModule } from "./admin/bull-board.controller";
import { TimescaleModule } from "./db/timescale.module";
import { AffiliateModule } from "./affiliate/affiliate.module";
import { WatchlistModule } from "./watchlist/watchlist.module";
import { PriceModule } from "./price/price.module";
import { NotifyModule } from "./notify/notify.module";
import { BillingModule } from "./billing/billing.module";
import { GrowthModule } from "./growth/growth.module";
import { MegaSaleModule } from "./megasale/megasale.module";
import { AdminModule } from "./admin/admin.module";
import { LegalModule } from "./legal/legal.module";
import { HealthController, QueueHealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env", "../../.env"] }),
    ScheduleModule.forRoot(),
    ObsModule,
    TimescaleModule,
    QueueModule,
    SchedulerModule,
    BullBoardWrapperModule,
    AffiliateModule,
    WatchlistModule,
    PriceModule,
    NotifyModule,
    BillingModule,
    GrowthModule,
    MegaSaleModule,
    AdminModule,
    LegalModule,
  ],
  controllers: [HealthController, QueueHealthController],
})
export class AppModule {}
