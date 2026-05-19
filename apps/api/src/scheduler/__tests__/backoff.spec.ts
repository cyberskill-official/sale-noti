// FR-WORKER-002 §5 AC10 — backoff schedule check.
import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffMs } from "../backoff-policy";

describe("FR-WORKER-002 — backoffMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    vi.spyOn(Math, "random").mockReturnValue(1);

    const v = backoffMs(20);

    expect(v).toBe(30 * 60_000);
  });

  it("treats zero and negative attempts as the first retry window", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(backoffMs(0)).toBe(30_000);
    expect(backoffMs(-3)).toBe(30_000);
  });
});
