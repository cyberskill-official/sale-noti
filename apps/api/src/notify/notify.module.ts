import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AffiliateModule } from "../affiliate/affiliate.module";
import { NotifyEmailProcessor } from "./notify-email.processor";
import { NotifyPushProcessor } from "./notify-push.processor";
import { NotifyTelegramProcessor } from "./notify-telegram.processor";
import { ResendWebhookController } from "./resend-webhook.controller";
import { TelegramWebhookController } from "./telegram-webhook.controller";

@Module({
  imports: [
    AffiliateModule,
    BullModule.registerQueue({ name: "alert-dispatch" }),
  ],
  controllers: [ResendWebhookController, TelegramWebhookController],
  providers: [NotifyEmailProcessor, NotifyPushProcessor, NotifyTelegramProcessor],
})
export class NotifyModule {}
