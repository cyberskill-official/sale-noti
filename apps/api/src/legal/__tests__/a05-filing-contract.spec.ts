import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const legalRoot = resolve(repoRoot, "docs/legal");

function readLegalDoc(name: string): string {
  return readFileSync(resolve(legalRoot, name), "utf8");
}

describe("FR-LEGAL-001 — A05 filing contract", () => {
  it("defines the exact manual A05 packet and receipt handoff path", () => {
    const packet = readLegalDoc("A05-submission-packet.md");

    for (const required of [
      "DPIA-2026-05.md",
      "DPO-appointment.md",
      "processor-register.md",
      "retention-schedule.md",
      "cross-border-transfer-impact-assessment.md",
      "data-flow-map.png",
      "A05-breach-notification-template.md",
      "docs/legal/A05-receipt-DPIA-2026-05.pdf",
    ]) {
      expect(packet).toContain(required);
    }

    expect(packet).toContain("Cục An ninh mạng và Phòng chống tội phạm sử dụng công nghệ cao (A05)");
    expect(packet).toContain("legal@cyberskill.world");
    expect(packet).toContain("Human legal review and A05 acknowledgement/receipt");
  });

  it("keeps the DPIA and DPO documents honest while the receipt is a mocked dependency", () => {
    const dpia = readLegalDoc("DPIA-2026-05.md");
    const dpo = readLegalDoc("DPO-appointment.md");
    const receiptPath = resolve(legalRoot, "A05-receipt-DPIA-2026-05.pdf");

    expect(dpia).toContain("**Filing status:** DRAFT");
    expect(dpia).toContain("**A05 receipt:** to be attached");
    expect(dpo).toContain("Conflict-of-interest declaration");
    expect(dpo).toContain("A copy of this letter is submitted to A05");
    expect(existsSync(receiptPath)).toBe(false);
  });

  it("keeps processor, retention, breach, and cross-border artifacts linked to the packet", () => {
    expect(readLegalDoc("processor-register.md")).toContain("MongoDB Atlas");
    expect(readLegalDoc("processor-register.md")).toContain("Google OAuth");
    expect(readLegalDoc("retention-schedule.md")).toContain("DSR request logs");
    expect(readLegalDoc("breach-response-runbook.md")).toContain("T+24 To T+72 Hours");
    expect(readLegalDoc("cross-border-transfer-impact-assessment.md")).toContain("Vercel");
  });
});
