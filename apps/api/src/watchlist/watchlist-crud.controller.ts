// FR-WATCH-002 + FR-WATCH-003 — list / patch / delete watchlists.
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { WatchlistService } from "./watchlist.service";
import { AlertConfigSchema } from "./alert-config.zod";

const ListQuery = z.object({
  status: z.enum(["active", "paused", "all"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  size: z.coerce.number().int().min(1).max(50).optional(),
});

const PatchBody = z.object({
  status: z.enum(["active", "paused"]).optional(),
  alertConfig: AlertConfigSchema.optional(),
});

@Controller("v1/watchlists")
export class WatchlistCrudController {
  constructor(private readonly watch: WatchlistService) {}

  @Get()
  async list(@Query() raw: unknown, @Headers("x-user-id") userIdHeader: string | undefined) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = ListQuery.safeParse(raw);
    if (!parsed.success)
      throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    return this.watch.list({ userId: userIdHeader, ...parsed.data });
  }

  @Patch(":id")
  async patch(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined
  ) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = PatchBody.safeParse(raw);
    if (!parsed.success)
      throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    return this.watch.patch({ userId: userIdHeader, watchlistId: id, ...parsed.data });
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @Headers("x-user-id") userIdHeader: string | undefined) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    return this.watch.softDelete({ userId: userIdHeader, watchlistId: id });
  }
}
