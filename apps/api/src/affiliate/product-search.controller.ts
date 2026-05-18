// FR-AFF-004 §3 — GET /v1/products/search
import crypto from "node:crypto";
import { Controller, Get, Headers, HttpException, HttpStatus, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ProductSearchRateLimitError, ProductSearchService } from "./product-search.service";

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
  async list(
    @Query() raw: unknown,
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Headers("x-real-ip") realIp: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof (raw as { q?: unknown }).q === "string" && !(raw as { q: string }).q.trim()) {
      throw new HttpException({ ok: false, error: "invalid_keyword" }, HttpStatus.BAD_REQUEST);
    }
    const parsed = Query_.safeParse(raw);
    if (!parsed.success)
      throw new HttpException(
        { ok: false, error: errorCodeFromIssues(parsed.error.issues), issues: parsed.error.issues },
        HttpStatus.BAD_REQUEST,
      );
    const userId = extractUserId(authorization, userIdHeader);
    const userIdHash = userId
      ? crypto.createHash("sha256").update(userId + (process.env.POSTHOG_PII_SALT ?? "")).digest("hex").slice(0, 16)
      : undefined;
    try {
      return await this.search.search(
        {
          keyword: parsed.data.q,
          pageNumber: parsed.data.page,
          pageSize: parsed.data.size,
          sort: parsed.data.sort,
        },
        { userIdHash, userIdRaw: userId ?? undefined, ip: clientIp(forwardedFor, realIp, req) },
      );
    } catch (e) {
      if (e instanceof ProductSearchRateLimitError) {
        res.setHeader("Retry-After", String(e.retryAfter));
        throw new HttpException(
          { ok: false, error: "rate_limit", retryAfter: e.retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw e;
    }
  }
}

function errorCodeFromIssues(issues: z.ZodIssue[]): string {
  const path = issues[0]?.path[0];
  if (path === "q") return issues[0]?.code === "too_big" ? "keyword_too_long" : "invalid_keyword";
  if (path === "size") return "invalid_pageSize";
  if (path === "page") return "invalid_pageNumber";
  if (path === "sort") return "invalid_sort";
  return "validation_failed";
}

function clientIp(forwardedFor: string | undefined, realIp: string | undefined, req: Request): string {
  return forwardedFor?.split(",")[0]?.trim() || realIp || req.ip || "0.0.0.0";
}

function extractUserId(authorization: string | undefined, userIdHeader: string | undefined): string | null {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return verifyAccessTokenSub(bearer);
  if (process.env.NODE_ENV !== "production" && userIdHeader) return userIdHeader;
  return null;
}

function verifyAccessTokenSub(token: string): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (!header || !payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    sub?: string;
    exp?: number;
    iat?: number;
  };
  const now = Math.floor(Date.now() / 1000);
  if (!claims.sub || !claims.exp || !claims.iat) return null;
  if (claims.exp < now - 60 || claims.iat > now + 60) return null;
  return claims.sub;
}
