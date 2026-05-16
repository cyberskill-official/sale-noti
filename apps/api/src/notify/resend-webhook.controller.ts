// FR-NOTIF-001 §1 #8 — Resend webhook handler (delivered / bounced / complained / opened / clicked).
import crypto from "node:crypto";
import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { mongo } from "../db/mongo";
import { recordBounce, recordComplaint } from "./suppression";

@Controller("webhooks/resend")
export class ResendWebhookController {
  @Post()
  async handle(@Body() body: any, @Headers("resend-signature") signature: string | undefined, @Headers("resend-timestamp") timestamp: string | undefined) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new HttpException("webhook secret missing", HttpStatus.SERVICE_UNAVAILABLE);
    if (!signature || !timestamp) throw new HttpException("missing signature headers", HttpStatus.UNAUTHORIZED);

    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(body)}`).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new HttpException("invalid signature", HttpStatus.UNAUTHORIZED);
    }

    const event = body?.type as string | undefined;
    const email = body?.data?.email as string | undefined;
    const sentAt = body?.data?.sent_at ?? body?.created_at;

    if (!event || !email) return { ok: true, ignored: true };

    switch (event) {
      case "email.delivered":
        await mongo.db("salenoti").collection("notifications").updateMany(
          { "_dest": email, deliveredAt: null },
          { $set: { deliveredAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
      case "email.bounced":
        await recordBounce(email, body?.data?.type === "permanent" || body?.data?.type === "hard" ? "hard" : "soft");
        break;
      case "email.complained":
        await recordComplaint(email);
        break;
      case "email.opened":
        await mongo.db("salenoti").collection("notifications").updateOne(
          { "_dest": email, openedAt: null },
          { $set: { openedAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
      case "email.clicked":
        await mongo.db("salenoti").collection("notifications").updateOne(
          { "_dest": email, clickedAt: null },
          { $set: { clickedAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
    }

    return { ok: true };
  }
}
