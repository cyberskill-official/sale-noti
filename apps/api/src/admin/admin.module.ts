import { Module } from "@nestjs/common";
import { B2bLeadService } from "./b2b-lead.service";
import { B2bLeadController, PublicB2bLeadController } from "./b2b-lead.controller";

@Module({
  providers: [B2bLeadService],
  controllers: [B2bLeadController, PublicB2bLeadController],
  exports: [B2bLeadService],
})
export class AdminModule {}
