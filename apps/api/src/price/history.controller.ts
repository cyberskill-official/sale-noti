// FR-PRICE-002 §3 — GET /v1/products/:productId/history
import { Controller, Get, Headers, HttpException, HttpStatus, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { HistoryService, isValidProductId, type Granularity, type Range } from "./history.service";

const RANGE_VALUES = new Set(["7d", "30d", "90d"]);
const GRANULARITY_VALUES = new Set(["raw", "30m", "1h", "6h", "1d"]);

@Controller("v1/products")
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get(":productId/history")
  async getHistory(
    @Param("productId") productId: string,
    @Query() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-admin-token") adminTokenHeader: string | undefined,
    @Headers("x-salenoti-source") sourceHeader: string | undefined,
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Headers("x-real-ip") realIp: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!isValidProductId(productId)) {
      throw new HttpException({ error: "invalid_productId" }, HttpStatus.BAD_REQUEST);
    }
    const parsed = parseHistoryQuery(raw);
    await assertHistoryRateLimit({
      userId: userIdHeader ?? null,
      adminToken: adminTokenHeader,
      ip: forwardedFor?.split(",")[0]?.trim() || realIp,
      res,
    });
    const source = (sourceHeader === "ext" || sourceHeader === "deal-page" ? sourceHeader : "web") as
      | "ext"
      | "deal-page"
      | "web";
    return this.historyService.getHistory({
      userId: userIdHeader ?? null,
      adminToken: adminTokenHeader,
      productId,
      range: parsed.range,
      granularity: parsed.granularity,
      source,
    });
  }
}

export function parseHistoryQuery(raw: unknown): { range: Range; granularity: Granularity } {
  const query = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rangeRaw = query.range;
  const granularityRaw = query.granularity;
  const range = parseRange(rangeRaw);
  const granularity = parseGranularity(granularityRaw);
  return { range, granularity };
}

function parseRange(value: unknown): Range {
  if (value === undefined) return "30d";
  if (typeof value !== "string") {
    throw new HttpException({ error: "validation_failed" }, HttpStatus.BAD_REQUEST);
  }
  if (RANGE_VALUES.has(value)) return value as Range;
  const dayMatch = value.match(/^(\d+)d$/);
  if (dayMatch && Number(dayMatch[1]) > 90) {
    throw new HttpException({ error: "range_too_large" }, HttpStatus.BAD_REQUEST);
  }
  throw new HttpException({ error: "validation_failed" }, HttpStatus.BAD_REQUEST);
}

function parseGranularity(value: unknown): Granularity {
  if (value === undefined) return "1h";
  if (typeof value === "string" && GRANULARITY_VALUES.has(value)) return value as Granularity;
  throw new HttpException({ error: "validation_failed" }, HttpStatus.BAD_REQUEST);
}

function isAdminToken(token: string | undefined): boolean {
  return Boolean(process.env.ADMIN_TOKEN && token && token === process.env.ADMIN_TOKEN);
}

async function assertHistoryRateLimit(input: {
  userId: string | null;
  adminToken: string | undefined;
  ip: string | undefined;
  res?: Response;
}): Promise<void> {
  const { redis } = await import("../queue/redis.client");
  const minute = Math.floor(Date.now() / 60_000);
  const admin = isAdminToken(input.adminToken);
  const identity = admin
    ? { key: `rl:history:admin:${minute}`, limit: 60 }
    : input.userId
      ? { key: `rl:history:user:${input.userId}:${minute}`, limit: 60 }
      : { key: `rl:history:ip:${anonymousIp24(input.ip)}:${minute}`, limit: 30 };
  const used = await redis.incr(identity.key);
  if (used === 1) await redis.expire(identity.key, 60);
  if (used > identity.limit) {
    input.res?.setHeader("Retry-After", "60");
    throw new HttpException({ error: "rate_limit", retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function anonymousIp24(ip: string | undefined): string {
  const match = (ip ?? "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "0.0.0";
}
