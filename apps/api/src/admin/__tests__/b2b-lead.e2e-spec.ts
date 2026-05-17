import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { B2bLeadController, PublicB2bLeadController } from "../b2b-lead.controller";
import { B2bLeadService } from "../b2b-lead.service";

vi.mock("../../queue/redis.client", () => ({
  redis: {
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

describe("FR-ADMIN-001 — B2B lead API e2e", () => {
  let app: INestApplication;
  let base: string;
  const leads = {
    submit: vi.fn(async () => ({ ok: true, leadId: "lead-e2e" })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [B2bLeadController, PublicB2bLeadController],
      providers: [{ provide: B2bLeadService, useValue: leads }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts public /api/public/b2b-contact submissions", async () => {
    const res = await fetch(`${base}/api/public/b2b-contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Vitest", Referer: "https://salenoti.vn/business" },
      body: JSON.stringify({ email: "lead@example.com" }),
    });

    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      leadId: "lead-e2e",
      expectedResponseHours: 24,
    });
    expect(leads.submit).toHaveBeenCalledWith(expect.objectContaining({ email: "lead@example.com" }), expect.objectContaining({ ua: "Vitest" }));
  });
});
