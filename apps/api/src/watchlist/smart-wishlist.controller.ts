import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { redis } from "../queue/redis.client";
import { SmartWishlistService } from "./smart-wishlist.service";

const SmartWishlistQuery = z.object({
  range: z.enum(["30d", "90d"]).optional(),
  limit: z.coerce.number().int().min(1).max(5).optional(),
});

@Controller("v1/watchlists")
export class SmartWishlistController {
  constructor(private readonly smartWishlist: SmartWishlistService) {}

  @Get(":id/smart-wishlist")
  async get(
    @Param("id") id: string,
    @Query() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    await assertSmartWishlistRateLimit(userIdHeader, res);
    const parsed = SmartWishlistQuery.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    }

    return this.smartWishlist.getSmartWishlist({
      userId: userIdHeader,
      watchlistId: id,
      range: parsed.data.range,
      limit: parsed.data.limit,
    });
  }
}

async function assertSmartWishlistRateLimit(userId: string, res?: Response): Promise<void> {
  const key = `rl:watch:${userId}:${Math.floor(Date.now() / 60_000)}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 60);
  if (used > 50) {
    res?.setHeader("Retry-After", "60");
    throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
