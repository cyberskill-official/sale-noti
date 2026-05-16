import { Module } from "@nestjs/common";
import { ShopeeAffiliateClient } from "./shopee/client";
import { ShopeeRateLimitGuard } from "./shopee/rate-limit-guard";
import { DeeplinkService } from "./deeplink.service";
import { DeeplinkController } from "./deeplink.controller";
import { OfferResolverService } from "./offer-resolver.service";
import { ProductSearchService } from "./product-search.service";
import { ProductSearchController } from "./product-search.controller";

@Module({
  providers: [
    ShopeeRateLimitGuard,
    ShopeeAffiliateClient,
    DeeplinkService,
    OfferResolverService,
    ProductSearchService,
  ],
  controllers: [DeeplinkController, ProductSearchController],
  exports: [ShopeeAffiliateClient, DeeplinkService, OfferResolverService, ProductSearchService],
})
export class AffiliateModule {}
