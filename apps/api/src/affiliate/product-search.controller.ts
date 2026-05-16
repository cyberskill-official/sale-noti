// FR-AFF-004 §3 — GET /v1/products/search
import crypto from "node:crypto";
import { Controller, Get, Headers, HttpException, HttpStatus, Query } from "@nestjs/common";
import { z } from "zod";
import { ProductSearchService } from "./product-search.service";

const Query_ = z.object({
  q: z.string().min(1).max(200),
  page: z.coerce.number().int().min(1).max(50).optional(),
  size: z.coerce.number().int().min(1).max(20).optional(),
  sort: z.enum(["RELEVANCY", "PRICE_ASC", "PRICE_DESC", "SALES_DESC"]).optional(),
});

@Controller("v1/products")
export class ProductSearchController {
  constructor(private readonly search: ProductSearchService) {}

  @Get("search")
  async list(@Query() raw: unknown, @Headers("x-user-id") userIdHeader: string | undefined) {
    const parsed = Query_.safeParse(raw);
    if (!parsed.success) throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    const userIdHash = userIdHeader
      ? crypto.createHash("sha256").update(userIdHeader + (process.env.POSTHOG_PII_SALT ?? "")).digest("hex").slice(0, 16)
      : undefined;
    const result = await this.search.search(
      {
        keyword: parsed.data.q,
        pageNumber: parsed.data.page,
        pageSize: parsed.data.size,
        sort: parsed.data.sort,
      },
      { userIdHash }
    );
    return result;
  }
}
