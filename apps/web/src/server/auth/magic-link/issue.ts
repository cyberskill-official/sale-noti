// FR-AUTH-002 §6 — issue magic-link.
import crypto from "node:crypto";
import { z } from "zod";
import { mongo } from "@/server/db/mongo";
import { resend } from "@/server/email/resend";
import { renderMagicLinkEmail } from "@/server/email/templates/magic-link";

const EmailSchema = z.string().email().max(255);

export async function issueMagicLink(input: { email: string; ip: string; userAgent: string }): Promise<{ ok: true } | { ok: false; reason: "invalid_email" }> {
  const parsed = EmailSchema.safeParse(input.email);
  if (!parsed.success) return { ok: false, reason: "invalid_email" };
  const email = parsed.data.toLowerCase();

  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  // Per FR-AUTH-002 §1 #2 — store hash only, never raw.
  await mongo.db("salenoti").collection("magic_link_tokens").insertOne({
    tokenHash,
    email,
    expiresAt,
    consumed: false,
    consumedAt: null,
    createdAt: new Date(),
    ip: input.ip,
    userAgent: input.userAgent.slice(0, 200),
  });

  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/magic-link/consume?token=${raw}`;
  const { html, text } = renderMagicLinkEmail({ url, email });
  await resend.send({
    from: "SaleNoti <noreply@salenoti.vn>",
    to: email,
    subject: "Đăng nhập SaleNoti",
    html,
    text,
    tags: [
      { name: "fr", value: "FR-AUTH-002" },
      { name: "kind", value: "magic-link" },
    ],
  });

  return { ok: true };
}
