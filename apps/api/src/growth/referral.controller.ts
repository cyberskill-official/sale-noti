// FR-GROW-001 §3 — referral endpoints.
import { Controller, Get, Headers, HttpException, HttpStatus } from "@nestjs/common";
import { ReferralService } from "./referral.service";

@Controller("v1/me/referral")
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  @Get()
  async getStatus(@Headers("x-user-id") userId: string | undefined) {
    if (!userId) throw new HttpException({ ok: false, error: "unauthenticated" }, HttpStatus.UNAUTHORIZED);
    return this.referral.getStatus(userId);
  }
}
