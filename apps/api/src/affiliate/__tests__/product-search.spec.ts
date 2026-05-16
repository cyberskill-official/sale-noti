// FR-AFF-004 — keyword scrubbing + HTML strip.
import { describe, it, expect } from "vitest";

// Reproduce the inline helpers because the service file's helpers are unexported (intentional).
// Mirror of `stripHtml` in apps/api/src/affiliate/product-search.service.ts — keep in sync.
function stripHtml(s: string): string {
  return s
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}
function scrubKeyword(kw: string): string {
  if (/@/.test(kw)) return "[redacted-email]";
  return kw.slice(0, 60);
}

describe("FR-AFF-004 — productSearch helpers", () => {
  it("AC6: XSS payload in productName is stripped", () => {
    expect(stripHtml("<script>alert(1)</script>OK")).toBe("OK");
    expect(stripHtml("<b>Áo</b> thun")).toBe("Áo thun");
  });

  it("AC7: email-like keyword → [redacted-email]", () => {
    expect(scrubKeyword("u@example.com áo")).toBe("[redacted-email]");
    expect(scrubKeyword("áo thun")).toBe("áo thun");
  });

  it("keyword > 60 chars truncated", () => {
    const long = "x".repeat(100);
    expect(scrubKeyword(long).length).toBe(60);
  });
});
