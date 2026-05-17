import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { DsrDeleteService } from "./dsr-delete.service";
import { DsrExportService } from "./dsr-export.service";

const DeleteBody = z.object({
  reason: z.string().min(8).max(500),
  confirm: z.literal(true),
});

@Controller("v1/legal/dsr")
export class LegalController {
  constructor(
    private readonly exports: DsrExportService,
    private readonly deletes: DsrDeleteService
  ) {}

  @Get("export")
  async export(@Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    return { ok: true, data: await this.exports.exportUser(userId) };
  }

  @Post("delete")
  async requestDelete(@Headers("x-user-id") userId: string | undefined, @Body() raw: unknown) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    const parsed = DeleteBody.safeParse(raw);
    if (!parsed.success) throw new HttpException({ ok: false, error: "validation_failed" }, HttpStatus.BAD_REQUEST);
    const request = await this.deletes.requestErasure(userId, parsed.data.reason);
    return { ok: true, ...request };
  }
}
