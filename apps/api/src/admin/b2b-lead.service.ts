// FR-ADMIN-001 — B2B lead capture.
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Resend } from "resend";
import { mongo } from "../db/mongo";
import { envelopeEncrypt, piiHash } from "../legal/encryption-envelope";

const VN_PHONE = /^(\+?84|0)\d{9,10}$/;

const LeadSchema = z
  .object({
    companyName: z.string().min(2).max(200),
    website: z.string().url().max(500).optional(),
    contactName: z.string().min(2).max(100),
    email: z.string().email().max(255),
    phone: z.string().regex(VN_PHONE),
    monthlyBudget: z.enum(["<5M", "5-15M", "15-50M", "50M+"]).default("<5M"),
    volume: z.enum(["<1K", "1K-10K", "10K-100K", "100K+"]).default("<1K"),
    monthlyOrders: z.enum(["<100", "100-1000", "1000-10000", ">10000"]).optional(),
    shopeeStoreUrl: z.string().url().max(500).optional(),
    source: z.enum(["homepage", "footer", "blog", "other"]).optional(),
    useCase: z.string().min(10).max(1000),
    howFoundUs: z.string().max(200).optional(),
    consents: z.object({ pdpl_v1: z.literal(true) }).optional(),
    consentPdpl: z.literal(true).optional(),
    hcaptchaToken: z.string().min(10).optional(),
  })
  .refine((data) => data.consents?.pdpl_v1 === true || data.consentPdpl === true, {
    path: ["consentPdpl"],
    message: "consent_required",
  });

export type LeadInput = z.infer<typeof LeadSchema>;

@Injectable()
export class B2bLeadService {
  constructor(
    @Inject("OBS_SLACK") private readonly slack: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async submit(input: unknown, meta: { ip: string; referer: string; ua: string }): Promise<{ ok: true; leadId: string }> {
    const parsed = LeadSchema.safeParse(input);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean);
      throw new BadRequestException({ error: "validation_failed", fields });
    }
    // FR-ADMIN-001 §1 #9 — hCaptcha verify (best-effort; skipped if no secret).
    if (process.env.HCAPTCHA_SECRET) {
      if (!parsed.data.hcaptchaToken) throw new BadRequestException({ error: "captcha_failed" });
      const ok = await verifyHcaptcha(parsed.data.hcaptchaToken, meta.ip).catch(() => false);
      if (!ok) throw new BadRequestException({ error: "captcha_failed" });
    }

    const email = parsed.data.email.toLowerCase();
    const phone = parsed.data.phone;
    const doc = {
      companyName: parsed.data.companyName,
      website: parsed.data.website ?? parsed.data.shopeeStoreUrl ?? null,
      shopeeStoreUrl: parsed.data.shopeeStoreUrl ?? null,
      contactName: parsed.data.contactName,
      emailEncrypted: envelopeEncrypt(email, "b2b_leads.email"),
      phoneEncrypted: envelopeEncrypt(phone, "b2b_leads.phone"),
      emailHash: piiHash(email, "b2b_leads.email"),
      phoneHash: piiHash(phone, "b2b_leads.phone"),
      phoneLast4: phone.slice(-4),
      monthlyBudget: parsed.data.monthlyBudget,
      monthlyOrders: parsed.data.monthlyOrders ?? null,
      volume: parsed.data.volume,
      useCase: parsed.data.useCase,
      source: parsed.data.source ?? parsed.data.howFoundUs ?? null,
      howFoundUs: parsed.data.howFoundUs ?? null,
      consents: { pdpl_v1: { grantedAt: new Date(), ip: meta.ip } },
      status: "new" as const,
      ipHash: piiHash(meta.ip, "b2b_leads.ip"),
      uaHash: piiHash(meta.ua, "b2b_leads.ua"),
      referer: meta.referer.slice(0, 500),
      createdAt: new Date(),
    };

    const r = await mongo.db("salenoti").collection("b2b_leads").insertOne(doc);

    // FR-ADMIN-001 §1 #6 — Slack within 30s.
    await this.slack.post("b2b", {
      text: `📩 New B2B lead — ${parsed.data.companyName}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              `*${parsed.data.companyName}*`,
              `Contact: ${parsed.data.contactName} · email hash ${doc.emailHash.slice(0, 10)} · phone ****${doc.phoneLast4}`,
              `Budget: ${parsed.data.monthlyBudget}  ·  Volume: ${parsed.data.volume}`,
              `Use-case: ${parsed.data.useCase.slice(0, 300)}${parsed.data.useCase.length > 300 ? "…" : ""}`,
            ].join("\n"),
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open lead" },
              url: `${process.env.APP_URL ?? "https://salenoti.vn"}/admin/b2b-leads/${r.insertedId}`,
            },
          ],
        },
      ],
    });

    this.posthog.capture("b2b_lead_submitted", {
      companySize: parsed.data.monthlyBudget,
      volumeBucket: parsed.data.volume,
      source: doc.source,
      hasShopeeStore: Boolean(doc.shopeeStoreUrl),
    });

    await sendLeadConfirmation(email, parsed.data.contactName).catch(() => undefined);

    return { ok: true, leadId: String(r.insertedId) };
  }
}

async function sendLeadConfirmation(email: string, contactName: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: "CyberSkill <sales@cyberskill.world>",
    to: email,
    subject: "Cảm ơn bạn đã liên hệ CyberSkill",
    text: `Chào ${contactName},\n\nCyberSkill đã nhận thông tin của bạn. Team sẽ phản hồi trong vòng 24 giờ làm việc.\n\nCyberSkill`,
    html: `<p>Chào ${escapeHtml(contactName)},</p><p>CyberSkill đã nhận thông tin của bạn. Team sẽ phản hồi trong vòng <b>24 giờ làm việc</b>.</p><p>CyberSkill</p>`,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function verifyHcaptcha(token: string, ip: string): Promise<boolean> {
  try {
    const r = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        response: token,
        secret: process.env.HCAPTCHA_SECRET!,
        remoteip: ip,
      }),
    });
    const body = (await r.json()) as { success: boolean };
    return Boolean(body.success);
  } catch {
    return false;
  }
}
