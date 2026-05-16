import { Global, Module } from "@nestjs/common";
import { timescale } from "./timescale.client";

@Global()
@Module({
  providers: [{ provide: "TIMESCALE", useValue: timescale }],
  exports: ["TIMESCALE"],
})
export class TimescaleModule {}
