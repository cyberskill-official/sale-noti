// FR-AFF-002 §3 — POST /v1/affiliate/deeplink
import crypto from "node:crypto";
import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { DeeplinkService, type DeeplinkSource } from "./deeplink.service";

const Body_ = z.object({
  productId: z.string().regex(/^\d+-\d+$/),
  source: z.enum(["alert_email", "alert_push", "alert_telegram", "deal_page", "share_deal", "ext"]),
  watchlistId: z.string().optional(),
  campaign: z.string().max(40).optional(),
  respect_other_publisher: z.boolean().optional(),
});

@Controller("v1/affiliate")
export class DeeplinkController {
  constructor(private readonly deeplink: DeeplinkService) {}

  @Post("deeplink")
  async generate(
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-user-id") userIdHeader: string | undefined
  ) {
    const userId = extractUserId(authorization, userIdHeader);
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = Body_.safeParse(body);
    if (!parsed.success) throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    const result = await this.deeplink.generate({
      userId,
      productId: parsed.data.productId,
      source: parsed.data.source as DeeplinkSource,
      watchlistId: parsed.data.watchlistId,
      campaign: parsed.data.campaign,
      respectOtherPublisher: parsed.data.respect_other_publisher,
    });
    return { ok: true, url: result.url, expiresAt: result.expiresAt };
  }
}

function extractUserId(authorization: string | undefined, userIdHeader: string | undefined): string | null {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return verifyAccessTokenSub(bearer);

  // Local API tests and trusted internal jobs can still pass x-user-id outside production.
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

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: string; exp?: number; iat?: number };
  const now = Math.floor(Date.now() / 1000);
  if (!claims.sub || !claims.exp || !claims.iat) return null;
  if (claims.exp < now - 60 || claims.iat > now + 60) return null;
  return claims.sub;
}
