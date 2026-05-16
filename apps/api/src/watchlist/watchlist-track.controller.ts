// FR-WATCH-001 §3 — POST /v1/products/track
import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { WatchlistService } from "./watchlist.service";
import { AlertConfigSchema } from "./alert-config.zod";

const Body_ = z.object({
  url: z.string().min(1).max(2000),
  alertConfig: AlertConfigSchema.optional(),
  respect_other_publisher: z.boolean().optional(),
});

@Controller("v1/products")
export class WatchlistTrackController {
  constructor(private readonly watch: WatchlistService) {}

  @Post("track")
  async track(
    @Body() raw: unknown,
    @Headers("x-user-id") userIdHeader: string | undefined,
    @Headers("x-salenoti-source") sourceHeader: string | undefined
  ) {
    if (!userIdHeader) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = Body_.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException(
        { ok: false, error: "validation_failed", issues: parsed.error.issues },
        HttpStatus.BAD_REQUEST
      );
    }
    const source = (sourceHeader === "ext" || sourceHeader === "share" ? sourceHeader : "web") as
      | "ext"
      | "share"
      | "web";
    const result = await this.watch.track({
      userId: userIdHeader,
      url: parsed.data.url,
      alertConfig: parsed.data.alertConfig,
      source,
    });
    return result;
  }
}
