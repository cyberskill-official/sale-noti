// FR-WORKER-002 §5 AC10 — backoff schedule check.
import { describe, it, expect } from "vitest";
import { backoffMs } from "../backoff-policy";

describe("FR-WORKER-002 — backoffMs", () => {
  it("attempt 1 → ~30s ± 25%", () => {
    const v = backoffMs(1);
    expect(v).toBeGreaterThan(22_499);
    expect(v).toBeLessThan(37_501);
  });
  it("attempt 2 → ~60s ± 25%", () => {
    const v = backoffMs(2);
    expect(v).toBeGreaterThan(44_999);
    expect(v).toBeLessThan(75_001);
  });
  it("attempt 20 → capped at 30 min (with positive jitter still bounded)", () => {
    const v = backoffMs(20);
    expect(v).toBeLessThanOrEqual(30 * 60_000 * 1.25);
  });
});
