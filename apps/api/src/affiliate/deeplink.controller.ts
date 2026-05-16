// FR-AFF-002 §3 — POST /v1/affiliate/deeplink
import { Body, Controller, Headers, HttpException, HttpStatus, Post, UseGuards } from "@nestjs/common";
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
  async generate(@Body() body: unknown, @Headers("x-user-id") userIdHeader: string | undefined) {
    // userIdHeader is a placeholder until the AuthGuard from FR-AUTH-003 ships in NestJS scope.
    // The web app calls this endpoint with the user JWT; the NestJS auth guard will populate the userId.
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = Body_.safeParse(body);
    if (!parsed.success) throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    const result = await this.deeplink.generate({
      userId: userIdHeader,
      productId: parsed.data.productId,
      source: parsed.data.source as DeeplinkSource,
      watchlistId: parsed.data.watchlistId,
      campaign: parsed.data.campaign,
      respectOtherPublisher: parsed.data.respect_other_publisher,
    });
    return { ok: true, url: result.url, expiresAt: result.expiresAt };
  }
}
