import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AccessTradeFallbackService } from "./accesstrade/fallback.service";
import { AccessTradePublisherClient } from "./accesstrade/client";
import { AccessTradeRateLimitGuard } from "./accesstrade/rate-limit-guard";
import { ShopeeAffiliateClient } from "./shopee/client";
import { ShopeeRateLimitGuard } from "./shopee/rate-limit-guard";
import { TikTokShopAffiliateClient } from "./tiktok/client";
import { TikTokShopRateLimitGuard } from "./tiktok/rate-limit-guard";
import { DeeplinkService } from "./deeplink.service";
import { DeeplinkController } from "./deeplink.controller";
import { OfferResolverService } from "./offer-resolver.service";
import { ProductSearchService } from "./product-search.service";
import { ProductSearchController } from "./product-search.controller";
import { PriceCheckProcessor } from "./price-check.processor";

@Module({
  imports: [BullModule.registerQueue({ name: "price-check" }, { name: "alert-dispatch" })],
  providers: [
    AccessTradeRateLimitGuard,
    AccessTradePublisherClient,
    AccessTradeFallbackService,
    ShopeeRateLimitGuard,
    ShopeeAffiliateClient,
    TikTokShopRateLimitGuard,
    TikTokShopAffiliateClient,
    DeeplinkService,
    OfferResolverService,
    ProductSearchService,
    PriceCheckProcessor,
  ],
  controllers: [DeeplinkController, ProductSearchController],
  exports: [
    AccessTradePublisherClient,
    AccessTradeFallbackService,
    ShopeeAffiliateClient,
    TikTokShopAffiliateClient,
    DeeplinkService,
    OfferResolverService,
    ProductSearchService,
  ],
})
export class AffiliateModule {}
