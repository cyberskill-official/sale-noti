import "./obs/sentry"; // side-effect init must be FIRST
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { installBullBoardAuth } from "./admin/bull-board.controller";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });
  installBullBoardAuth(app);
  app.enableCors({
    origin: [
      process.env.APP_URL ?? "http://localhost:3000",
      new RegExp(`^chrome-extension://${process.env.EXT_ID ?? ".+"}$`),
    ],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`SaleNoti API on :${port}`);
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
