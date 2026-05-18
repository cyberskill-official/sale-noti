// FR-NOTIF-001 §1 #8 — Resend webhook handler (delivered / bounced / complained / opened / clicked).
import crypto from "node:crypto";
import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { mongo } from "../db/mongo";
import { recordBounce, recordComplaint } from "./suppression";

@Controller("webhooks/resend")
export class ResendWebhookController {
  @Post()
  async handle(@Body() body: any, @Headers("resend-signature") signature: string | undefined) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new HttpException("webhook secret missing", HttpStatus.SERVICE_UNAVAILABLE);
    if (!verifyResendSignature(signature, body, secret)) {
      throw new HttpException("invalid signature", HttpStatus.UNAUTHORIZED);
    }

    const event = body?.type as string | undefined;
    const eventId = body?.id ?? body?.data?.event_id ?? `${event ?? "unknown"}:${body?.data?.email_id ?? body?.created_at ?? ""}`;
    const duplicate = await mongo.db("salenoti").collection("webhook_events").findOne({ eventId, source: "resend" });
    if (duplicate) return { received: true, duplicate: true };
    await mongo.db("salenoti").collection("webhook_events").insertOne({
      eventId,
      source: "resend",
      type: event ?? null,
      receivedAt: new Date(),
    });

    const email = extractEmail(body);
    const messageId = body?.data?.email_id ?? body?.data?.id ?? body?.data?.message_id;
    const sentAt = body?.data?.sent_at ?? body?.created_at;

    if (!event || !messageId) return { received: true, ignored: true };
    const selector = { resendMessageId: messageId, channel: "email" };

    switch (event) {
      case "email.delivered":
        await mongo.db("salenoti").collection("notifications").updateOne(
          selector,
          { $set: { deliveredAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
      case "email.bounced":
        await mongo.db("salenoti").collection("notifications").updateOne(
          selector,
          { $set: { bouncedAt: new Date(sentAt ?? Date.now()) } }
        );
        if (email) await recordBounce(email, body?.data?.bounce?.type === "hard" || body?.data?.type === "hard" ? "hard" : "soft");
        break;
      case "email.complained":
        await mongo.db("salenoti").collection("notifications").updateOne(
          selector,
          { $set: { complainedAt: new Date(sentAt ?? Date.now()) } }
        );
        if (email) await recordComplaint(email);
        break;
      case "email.opened":
        await mongo.db("salenoti").collection("notifications").updateOne(
          selector,
          { $set: { openedAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
      case "email.clicked":
        await mongo.db("salenoti").collection("notifications").updateOne(
          selector,
          { $set: { clickedAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
      case "email.delivery_delayed":
        await mongo.db("salenoti").collection("notifications").updateOne(
          selector,
          { $set: { deliveryDelayedAt: new Date(sentAt ?? Date.now()) } }
        );
        break;
    }

    return { received: true };
  }
}

export function verifyResendSignature(signature: string | undefined, body: unknown, secret: string): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]+)$/i.exec(signature ?? "");
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(body)}`).digest("hex");
  const actual = match[2] ?? "";
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function extractEmail(body: any): string | null {
  const to = body?.data?.to;
  if (Array.isArray(to) && typeof to[0] === "string") return to[0];
  if (typeof body?.data?.email === "string") return body.data.email;
  return null;
}
