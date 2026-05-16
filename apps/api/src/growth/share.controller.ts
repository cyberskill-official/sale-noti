// FR-GROW-002 §3 — POST /v1/share/create.
import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { ShareService } from "./share.service";

const Body_ = z.object({ productId: z.string().regex(/^\d+-\d+$/) });

@Controller("v1/share")
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post("create")
  async create(@Body() raw: unknown, @Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = Body_.safeParse(raw);
    if (!parsed.success)
      throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, HttpStatus.BAD_REQUEST);
    return this.share.createShare({ userId, productId: parsed.data.productId });
  }
}
