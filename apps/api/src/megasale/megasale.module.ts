import { Module } from "@nestjs/common";
import { MegaSaleService } from "./megasale.service";
import { MegaSaleController } from "./megasale.controller";

@Module({
  providers: [MegaSaleService],
  controllers: [MegaSaleController],
  exports: [MegaSaleService],
})
export class MegaSaleModule {}
