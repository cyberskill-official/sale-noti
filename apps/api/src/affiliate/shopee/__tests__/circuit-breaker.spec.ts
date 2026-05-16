// FR-AFF-001 AC4 + AC5 — circuit breaker state machine.
import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker, BreakerOpenError } from "../circuit-breaker";

describe("FR-AFF-001 — circuit breaker", () => {
  let cb: CircuitBreaker;
  beforeEach(() => {
    cb = new CircuitBreaker({ openAfterConsecFails: 5, halfOpenAfterMs: 50, closeAfterConsecSuccess: 3 });
  });

  it("AC4: opens after 5 consecutive failures", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(cb.exec(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }
    expect(cb.getState()).toBe("open");
    await expect(cb.exec(async () => 1)).rejects.toBeInstanceOf(BreakerOpenError);
  });

  it("AC5: half-open after timeout; closed after 3 consecutive successes", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(cb.exec(async () => { throw new Error("boom"); })).rejects.toThrow();
    }
    expect(cb.getState()).toBe("open");
    await new Promise((r) => setTimeout(r, 60));
    await expect(cb.exec(async () => 1)).resolves.toBe(1);
    expect(cb.getState()).toBe("half_open");
    await expect(cb.exec(async () => 1)).resolves.toBe(1);
    await expect(cb.exec(async () => 1)).resolves.toBe(1);
    expect(cb.getState()).toBe("closed");
  });

  it("half-open single-token: parallel calls blocked", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(cb.exec(async () => { throw new Error("boom"); })).rejects.toThrow();
    }
    await new Promise((r) => setTimeout(r, 60));
    // 2 parallel exec calls in half-open — second should throw BreakerOpenError immediately.
    const slow = cb.exec(async () => { await new Promise((r) => setTimeout(r, 50)); return 1; });
    const fast = cb.exec(async () => 1);
    await expect(fast).rejects.toBeInstanceOf(BreakerOpenError);
    await expect(slow).resolves.toBe(1);
  });
});
