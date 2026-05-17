import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ShopeeAffiliateClient } from "./shopee/client";
import { ShopeeRateLimitGuard } from "./shopee/rate-limit-guard";
import { DeeplinkService } from "./deeplink.service";
import { DeeplinkController } from "./deeplink.controller";
import { OfferResolverService } from "./offer-resolver.service";
import { ProductSearchService } from "./product-search.service";
import { ProductSearchController } from "./product-search.controller";
import { PriceCheckProcessor } from "./price-check.processor";

@Module({
  imports: [BullModule.registerQueue({ name: "price-check" }, { name: "alert-dispatch" })],
  providers: [
    ShopeeRateLimitGuard,
    ShopeeAffiliateClient,
    DeeplinkService,
    OfferResolverService,
    ProductSearchService,
    PriceCheckProcessor,
  ],
  controllers: [DeeplinkController, ProductSearchController],
  exports: [ShopeeAffiliateClient, DeeplinkService, OfferResolverService, ProductSearchService],
})
export class AffiliateModule {}
