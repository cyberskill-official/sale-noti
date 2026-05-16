import { Module } from "@nestjs/common";
import { AffiliateModule } from "../affiliate/affiliate.module";
import { WatchlistService } from "./watchlist.service";
import { WatchlistTrackController } from "./watchlist-track.controller";
import { WatchlistCrudController } from "./watchlist-crud.controller";

@Module({
  imports: [AffiliateModule],
  providers: [WatchlistService],
  controllers: [WatchlistTrackController, WatchlistCrudController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
