// FR-WORKER-001 §1 #5 — Bull Board mount behind basic auth.
// Wires the API ExpressAdapter into NestJS.
import { Module } from "@nestjs/common";
import { BullBoardModule } from "@bull-board/nestjs";
import { ExpressAdapter } from "@bull-board/express";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { BullModule } from "@nestjs/bullmq";
import basicAuth from "express-basic-auth";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { QUEUES } from "../queue/queues";

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: "/admin/queues",
      adapter: ExpressAdapter,
    }),
    // Cast: @bull-board/api's BullMQAdapter constructor signature drifted across versions;
    // the runtime contract is correct but the TS type doesn't unify with the older
    // BullBoardModule.forFeature signature. Cast keeps the runtime behavior; pin to a
    // matching @bull-board/api version in a follow-up if the cast becomes load-bearing.
    BullBoardModule.forFeature(...QUEUES.map((name) => ({ name, adapter: BullMQAdapter as any }))),
    BullModule.registerQueue(...QUEUES.map((name) => ({ name }))),
  ],
})
export class BullBoardWrapperModule {}

/**
 * Call this from main.ts after `app = NestFactory.create()` to gate /admin/queues with basic auth.
 */
export function installBullBoardAuth(app: NestExpressApplication) {
  const user = process.env.BULL_BOARD_USER;
  const pass = process.env.BULL_BOARD_PASS;
  if (!user || !pass) {
    console.warn("[bull-board] BULL_BOARD_USER/PASS missing — /admin/queues route is unprotected. Refusing to expose.");
    // Block the route entirely if creds are missing.
    app.use("/admin/queues", (_req: any, res: any) => res.status(503).send("Bull Board disabled: no auth configured."));
    return;
  }
  app.use("/admin/queues", basicAuth({ users: { [user]: pass }, challenge: true, realm: "SaleNoti Ops" }));
}
