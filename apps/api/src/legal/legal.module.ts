import { Module } from "@nestjs/common";
import { DsrDeleteService } from "./dsr-delete.service";
import { DsrExportService } from "./dsr-export.service";
import { LegalController, MeDsrController } from "./legal.controller";

@Module({
  providers: [DsrExportService, DsrDeleteService],
  controllers: [LegalController, MeDsrController],
  exports: [DsrExportService, DsrDeleteService],
})
export class LegalModule {}
