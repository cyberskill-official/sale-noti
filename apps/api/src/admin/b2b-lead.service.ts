// FR-ADMIN-001 — B2B lead capture.
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { mongo } from "../db/mongo";

const VN_PHONE = /^(\+?84|0)\d{9,10}$/;

const LeadSchema = z.object({
  companyName: z.string().min(2).max(200),
  website: z.string().url().max(500).optional(),
  contactName: z.string().min(2).max(100),
  email: z.string().email().max(255),
  phone: z.string().regex(VN_PHONE),
  monthlyBudget: z.enum(["<5M", "5-15M", "15-50M", "50M+"]),
  volume: z.enum(["<1K", "1K-10K", "10K-100K", "100K+"]),
  useCase: z.string().min(10).max(1000),
  howFoundUs: z.string().max(200).optional(),
  consents: z.object({ pdpl_v1: z.literal(true) }),
  hcaptchaToken: z.string().min(10).optional(),
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

    // FR-ADMIN-001 §1 #10 — explicit consent required.
    if (!parsed.data.consents?.pdpl_v1) throw new BadRequestException({ error: "consent_required" });

    const doc = {
      companyName: parsed.data.companyName,
      website: parsed.data.website ?? null,
      contactName: parsed.data.contactName,
      email: parsed.data.email.toLowerCase(),
      phone: parsed.data.phone,
      monthlyBudget: parsed.data.monthlyBudget,
      volume: parsed.data.volume,
      useCase: parsed.data.useCase,
      howFoundUs: parsed.data.howFoundUs ?? null,
      consents: { pdpl_v1: { grantedAt: new Date(), ip: meta.ip } },
      status: "new" as const,
      ip: meta.ip,
      referer: meta.referer.slice(0, 500),
      ua: meta.ua.slice(0, 500),
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
              `Contact: ${parsed.data.contactName} <${parsed.data.email}> · ${parsed.data.phone}`,
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
    });

    return { ok: true, leadId: String(r.insertedId) };
  }
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
