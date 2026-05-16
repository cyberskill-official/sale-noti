import { Module } from "@nestjs/common";
import { ReferralService } from "./referral.service";
import { ReferralController } from "./referral.controller";
import { ShareService } from "./share.service";
import { ShareController } from "./share.controller";

@Module({
  providers: [ReferralService, ShareService],
  controllers: [ReferralController, ShareController],
  exports: [ReferralService, ShareService],
})
export class GrowthModule {}
