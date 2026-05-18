// FR-WATCH-001 §3 — POST /v1/products/track
import crypto from "node:crypto";
import { Body, Controller, Headers, HttpException, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { TrackRateLimitError, WatchlistService } from "./watchlist.service";

const Body_ = z.object({
  url: z.string().min(1).max(2000),
  alertConfig: z.unknown().optional(),
  nickname: z.string().max(200).optional(),
  respect_other_publisher: z.boolean().optional(),
});

@Controller("v1/products")
export class WatchlistTrackController {
  constructor(private readonly watch: WatchlistService) {}

  @Post("track")
  async track(
    @Body() raw: unknown,
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-salenoti-source") sourceHeader: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Headers("x-real-ip") realIp: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = Body_.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException(
        { ok: false, error: "validation_failed", issues: parsed.error.issues },
        HttpStatus.BAD_REQUEST
      );
    }
    const userId = extractUserId(authorization, userIdHeader);
    if (!userId) {
      const signinUrl = `/auth/signin?ref=track&seedUrl=${encodeURIComponent(parsed.data.url)}`;
      res.setHeader("Location", signinUrl);
      throw new HttpException({ ok: false, error: "UNAUTHENTICATED", signinUrl }, HttpStatus.UNAUTHORIZED);
    }
    try {
      return await this.watch.track({
        userId,
        url: parsed.data.url,
        alertConfig: parsed.data.alertConfig,
        nickname: parsed.data.nickname,
        source: coerceSource(sourceHeader),
        idempotencyKey,
        ip: clientIp(forwardedFor, realIp, req),
      });
    } catch (e) {
      if (e instanceof TrackRateLimitError) {
        res.setHeader("Retry-After", String(e.retryAfter));
        throw new HttpException(
          { ok: false, error: "RATE_LIMIT_TRACK", retryAfter: e.retryAfter, scope: e.scope },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw e;
    }
  }
}

function coerceSource(value: string | undefined): "web" | "ext" | "share" | "import" {
  return value === "ext" || value === "share" || value === "import" ? value : "web";
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
