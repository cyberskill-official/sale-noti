// FR-PRICE-002 §3 — GET /v1/products/:productId/history
import { Controller, Get, Headers, HttpException, HttpStatus, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { HistoryService } from "./history.service";

const Query_ = z.object({
  range: z.enum(["7d", "30d", "90d"]).optional(),
  granularity: z.enum(["raw", "30m", "1h", "6h", "1d"]).optional(),
});

@Controller("v1/products")
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get(":productId/history")
  async history(
    @Param("productId") productId: string,
    @Query() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-salenoti-source") sourceHeader: string | undefined
  ) {
    const parsed = Query_.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException(
        { ok: false, error: "validation_failed", issues: parsed.error.issues },
        HttpStatus.BAD_REQUEST
      );
    }
    const range = parsed.data.range ?? "30d";
    const granularity = parsed.data.granularity ?? "1h";
    const source = (sourceHeader === "ext" || sourceHeader === "deal-page" ? sourceHeader : "web") as
      | "ext"
      | "deal-page"
      | "web";
    return this.history.getHistory({
      userId: userIdHeader ?? null,
      productId,
      range,
      granularity,
      source,
    });
  }
}
