import { Module } from "@nestjs/common";
import { AffiliateModule } from "../affiliate/affiliate.module";
import { WatchlistService } from "./watchlist.service";
import { WatchlistTrackController } from "./watchlist-track.controller";
import { WatchlistCrudController } from "./watchlist-crud.controller";
import { SmartWishlistController } from "./smart-wishlist.controller";
import { SmartWishlistService } from "./smart-wishlist.service";

@Module({
  imports: [AffiliateModule],
  providers: [WatchlistService, SmartWishlistService],
  controllers: [WatchlistTrackController, WatchlistCrudController, SmartWishlistController],
  exports: [WatchlistService, SmartWishlistService],
})
export class WatchlistModule {}
