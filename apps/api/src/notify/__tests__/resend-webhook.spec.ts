import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResendWebhookController, verifyResendSignature } from "../resend-webhook.controller";
import { emailHash } from "../idempotency";
import { recordBounce } from "../suppression";

const state = vi.hoisted(() => ({
  notifications: { updateOne: vi.fn() },
  webhookEvents: { findOne: vi.fn(), insertOne: vi.fn() },
  userEmailHealth: { findOneAndUpdate: vi.fn(), updateOne: vi.fn() },
  suppressionList: { updateOne: vi.fn() },
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: vi.fn(() => ({
      collection: vi.fn((name: string) => {
        if (name === "notifications") return state.notifications;
        if (name === "webhook_events") return state.webhookEvents;
        if (name === "user_email_health") return state.userEmailHealth;
        if (name === "suppression_list") return state.suppressionList;
        throw new Error(`unexpected collection ${name}`);
      }),
    })),
  },
}));

function sign(body: unknown, secret = "resend-secret", timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(body)}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("FR-NOTIF-001 — Resend webhook contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.RESEND_WEBHOOK_SECRET = "resend-secret";
    process.env.EMAIL_HASH_SALT = "email-salt";
    state.notifications.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.webhookEvents.findOne = vi.fn(async () => null);
    state.webhookEvents.insertOne = vi.fn(async () => ({ insertedId: "evt" }));
    state.userEmailHealth.findOneAndUpdate = vi.fn(async () => ({ hardBounces: 2 }));
    state.userEmailHealth.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    state.suppressionList.updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
  });

  it("verifies t/v1 signatures and updates delivered rows by Resend message id", async () => {
    const body = { id: "evt-1", type: "email.delivered", created_at: "2026-05-18T00:00:00Z", data: { email_id: "msg_1", to: ["u@example.com"] } };
    const controller = new ResendWebhookController();

    await expect(controller.handle(body, sign(body))).resolves.toEqual({ received: true });

    expect(state.webhookEvents.insertOne).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt-1", source: "resend" }));
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { resendMessageId: "msg_1", channel: "email" },
      { $set: { deliveredAt: new Date("2026-05-18T00:00:00Z") } },
    );
    expect(verifyResendSignature(sign(body), body, "resend-secret")).toBe(true);
    expect(verifyResendSignature("t=1,v1=bad", body, "resend-secret")).toBe(false);
    expect(verifyResendSignature(`t=${Math.floor(Date.now() / 1000)},v1=abcd`, body, "resend-secret")).toBe(false);
    expect(verifyResendSignature(undefined, body, "resend-secret")).toBe(false);
    expect(verifyResendSignature(sign(body, "resend-secret", 1), body, "resend-secret")).toBe(false);
  });

  it("rejects bad signatures and deduplicates replayed events", async () => {
    const body = { id: "evt-dup", type: "email.opened", data: { email_id: "msg_1" } };
    const controller = new ResendWebhookController();

    await expect(controller.handle(body, "t=1,v1=bad")).rejects.toMatchObject({ status: 401 });

    delete process.env.RESEND_WEBHOOK_SECRET;
    await expect(controller.handle(body, sign(body))).rejects.toMatchObject({ status: 503 });
    process.env.RESEND_WEBHOOK_SECRET = "resend-secret";

    state.webhookEvents.findOne.mockResolvedValueOnce({ eventId: "evt-dup" });
    await expect(controller.handle(body, sign(body))).resolves.toEqual({ received: true, duplicate: true });
    expect(state.notifications.updateOne).not.toHaveBeenCalled();
  });

  it("hashes bounce and complaint emails into suppression storage", async () => {
    const controller = new ResendWebhookController();
    const bounce = {
      id: "evt-bounce",
      type: "email.bounced",
      data: { email_id: "msg_b", to: ["Bounce@Example.com"], bounce: { type: "hard" } },
    };
    const complaint = {
      id: "evt-complaint",
      type: "email.complained",
      data: { email_id: "msg_c", to: ["Complain@Example.com"] },
    };

    await controller.handle(bounce, sign(bounce));
    await controller.handle(complaint, sign(complaint));

    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { resendMessageId: "msg_b", channel: "email" },
      { $set: { bouncedAt: expect.any(Date) } },
    );
    expect(state.suppressionList.updateOne).toHaveBeenCalledWith(
      { email_hash: emailHash("Bounce@Example.com") },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ reason: "hard_bounce" }) }),
      { upsert: true },
    );
    expect(state.suppressionList.updateOne).toHaveBeenCalledWith(
      { email_hash: emailHash("Complain@Example.com") },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ reason: "complaint" }) }),
      { upsert: true },
    );
  });

  it("handles opened, clicked, delayed, ignored, fallback email, and soft-bounce branches", async () => {
    const controller = new ResendWebhookController();
    const opened = { type: "email.opened", data: { id: "msg_o", email: "open@example.com" } };
    const clicked = { id: "evt-click", type: "email.clicked", data: { message_id: "msg_c" } };
    const delayed = { id: "evt-delay", type: "email.delivery_delayed", data: { email_id: "msg_d" } };
    const ignored = { id: "evt-ignore", type: "email.delivered", data: {} };
    const unknown = { id: "evt-unknown", data: { email_id: "msg_u" } };
    const noEmailBounce = { id: "evt-no-email-bounce", type: "email.bounced", data: { email_id: "msg_ne" } };
    const noEmailComplaint = { id: "evt-no-email-complaint", type: "email.complained", data: { email_id: "msg_nc" } };

    await controller.handle(opened, sign(opened));
    await controller.handle(clicked, sign(clicked));
    await controller.handle(delayed, sign(delayed));
    await expect(controller.handle(ignored, sign(ignored))).resolves.toEqual({ received: true, ignored: true });
    await expect(controller.handle(unknown, sign(unknown))).resolves.toEqual({ received: true, ignored: true });
    await controller.handle(noEmailBounce, sign(noEmailBounce));
    await controller.handle(noEmailComplaint, sign(noEmailComplaint));

    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { resendMessageId: "msg_o", channel: "email" },
      { $set: { openedAt: expect.any(Date) } },
    );
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { resendMessageId: "msg_c", channel: "email" },
      { $set: { clickedAt: expect.any(Date) } },
    );
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { resendMessageId: "msg_d", channel: "email" },
      { $set: { deliveryDelayedAt: expect.any(Date) } },
    );

    state.userEmailHealth.findOneAndUpdate.mockResolvedValueOnce({ hardBounces: 1 });
    await recordBounce("first-hard@example.com", "hard");
    expect(state.suppressionList.updateOne).not.toHaveBeenCalledWith(
      { email_hash: emailHash("first-hard@example.com") },
      expect.anything(),
      expect.anything(),
    );

    state.userEmailHealth.findOneAndUpdate.mockResolvedValueOnce(null);
    await recordBounce("null-hard@example.com", "hard");

    await recordBounce("soft@example.com", "soft");
    expect(state.userEmailHealth.updateOne).toHaveBeenCalledWith(
      { email_hash: emailHash("soft@example.com") },
      { $inc: { softBounces: 1 } },
      { upsert: true },
    );
  });
});
