import { Module } from "@nestjs/common";
import { HistoryCacheInvalidator, HistoryService } from "./history.service";
import { HistoryController } from "./history.controller";

@Module({
  providers: [HistoryService, HistoryCacheInvalidator],
  controllers: [HistoryController],
  exports: [HistoryService],
})
export class PriceModule {}
