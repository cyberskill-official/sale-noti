import { beforeEach, describe, expect, it, vi } from "vitest";
import { B2bLeadService } from "../b2b-lead.service";

const state = vi.hoisted(() => ({
  inserted: null as any,
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name !== "b2b_leads") throw new Error(`unexpected collection ${name}`);
        return {
          insertOne: async (doc: any) => {
            state.inserted = doc;
            return { insertedId: "lead-1" };
          },
        };
      },
    }),
  },
}));

describe("FR-ADMIN-001 — B2B lead service", () => {
  const slack = { post: vi.fn(async () => undefined) };
  const posthog = { capture: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    state.inserted = null;
    process.env.DATA_ENCRYPTION_KEY = "b".repeat(64);
    process.env.PII_HASH_SALT = "b2b-test-salt";
    delete process.env.RESEND_API_KEY;
  });

  it("accepts public contact-shape input and stores encrypted/hash-only PII", async () => {
    const service = new B2bLeadService(slack, posthog);

    const result = await service.submit(
      {
        companyName: "Cyber Mall",
        contactName: "Anh Tran",
        email: "lead@example.com",
        phone: "0901234567",
        shopeeStoreUrl: "https://shopee.vn/cybermall",
        monthlyOrders: "1000-10000",
        source: "homepage",
        useCase: "Need competitor price intelligence for Shopee Mall category planning.",
        consentPdpl: true,
      },
      { ip: "203.0.113.10", referer: "https://salenoti.vn/business", ua: "Mozilla/5.0" }
    );

    expect(result).toEqual({ ok: true, leadId: "lead-1" });
    expect(state.inserted.email).toBeUndefined();
    expect(state.inserted.phone).toBeUndefined();
    expect(JSON.stringify(state.inserted)).not.toContain("lead@example.com");
    expect(JSON.stringify(state.inserted)).not.toContain("0901234567");
    expect(state.inserted.emailEncrypted.alg).toBe("AES-256-GCM");
    expect(state.inserted.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.inserted.ipHash).toMatch(/^[a-f0-9]{64}$/);
    const slackPayload = (slack.post.mock.calls[0] as any[])[1];
    expect(slackPayload.blocks[0].text.text).toContain("phone ****4567");
    expect(slackPayload.blocks[0].text.text).not.toContain("0901234567");
    expect(posthog.capture).toHaveBeenCalledWith("b2b_lead_submitted", expect.objectContaining({ source: "homepage", hasShopeeStore: true }));
  });

  it("rejects missing PDPL consent", async () => {
    const service = new B2bLeadService(slack, posthog);

    await expect(
      service.submit(
        {
          companyName: "Cyber Mall",
          contactName: "Anh Tran",
          email: "lead@example.com",
          phone: "0901234567",
          useCase: "Need competitor price intelligence for Shopee Mall category planning.",
        },
        { ip: "203.0.113.10", referer: "", ua: "Mozilla/5.0" }
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ error: "validation_failed" }) });
  });
});
