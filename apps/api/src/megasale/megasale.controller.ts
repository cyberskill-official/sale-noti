// FR-GROW-003 §3 — public Mega Sale endpoints.
import { Controller, Get, Param } from "@nestjs/common";
import { MegaSaleService } from "./megasale.service";

@Controller("v1/megasale")
export class MegaSaleController {
  constructor(private readonly service: MegaSaleService) {}

  @Get("current")
  current() {
    return this.service.current();
  }

  @Get(":slug/top-deals")
  async topDeals(@Param("slug") slug: string) {
    const items = await this.service.getTopDeals(slug);
    return {
      items: items.map((p) => ({
        productId: `${p.shopId}-${p.itemId}`,
        name: p.name,
        imageUrl: p.imageUrl,
        currentPrice: p.currentPrice,
        originalPrice: p.originalPrice,
        currentDiscountPct: p.currentDiscountPct,
      })),
    };
  }
}
