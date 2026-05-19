// FR-WATCH-002 + FR-WATCH-003 — list / patch / delete watchlists.
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { redis } from "../queue/redis.client";
import { WatchlistService } from "./watchlist.service";

const ListQuery = z.object({
  status: z.enum(["active", "paused", "all"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  size: z.coerce.number().int().min(1).optional(),
});

const PatchBody = z.object({
  status: z.enum(["active", "paused"]).optional(),
  alertConfig: z.unknown().optional(),
}).strict();

@Controller("v1/watchlists")
export class WatchlistCrudController {
  constructor(private readonly watch: WatchlistService) {}

  @Get()
  async list(
    @Query() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    await assertCrudRateLimit(userIdHeader, res);
    const parsed = ListQuery.safeParse(raw);
    if (!parsed.success)
      throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    return this.watch.list({ userId: userIdHeader, ...parsed.data });
  }

  @Patch(":id")
  async patch(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-salenoti-source") sourceHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    await assertCrudRateLimit(userIdHeader, res);
    const parsed = PatchBody.safeParse(raw);
    if (!parsed.success)
      throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    return this.watch.patch({ userId: userIdHeader, watchlistId: id, ...parsed.data, source: sourceHeader === "ext" ? "ext" : "web" });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-salenoti-source") sourceHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    await assertCrudRateLimit(userIdHeader, res);
    return this.watch.softDelete({ userId: userIdHeader, watchlistId: id, source: sourceHeader === "ext" ? "ext" : "web" });
  }
}

async function assertCrudRateLimit(userId: string, res?: Response): Promise<void> {
  const key = `rl:watch:${userId}:${Math.floor(Date.now() / 60_000)}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 60);
  if (used > 50) {
    res?.setHeader("Retry-After", "60");
    throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
