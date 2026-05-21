import { beforeEach, describe, expect, it } from "vitest";
import { BreakerOpenError, CircuitBreaker } from "../circuit-breaker";

describe("FR-AFF-005 — Lazada circuit breaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ openAfterConsecFails: 5, halfOpenAfterMs: 50, closeAfterConsecSuccess: 3 });
  });

  it("opens after 5 consecutive failures", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(breaker.exec(async () => {
        throw new Error("boom");
      })).rejects.toThrow("boom");
    }

    expect(breaker.getState()).toBe("open");
    await expect(breaker.exec(async () => 1)).rejects.toBeInstanceOf(BreakerOpenError);
  });

  it("half-opens after timeout and closes after 3 consecutive successes", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(breaker.exec(async () => {
        throw new Error("boom");
      })).rejects.toThrow();
    }

    expect(breaker.getState()).toBe("open");
    await new Promise((resolve) => setTimeout(resolve, 60));

    await expect(breaker.exec(async () => 1)).resolves.toBe(1);
    expect(breaker.getState()).toBe("half_open");
    await expect(breaker.exec(async () => 1)).resolves.toBe(1);
    await expect(breaker.exec(async () => 1)).resolves.toBe(1);
    expect(breaker.getState()).toBe("closed");
  });

  it("blocks parallel calls while half-open", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(breaker.exec(async () => {
        throw new Error("boom");
      })).rejects.toThrow();
    }

    await new Promise((resolve) => setTimeout(resolve, 60));

    const slow = breaker.exec(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 1;
    });
    const fast = breaker.exec(async () => 1);

    await expect(fast).rejects.toBeInstanceOf(BreakerOpenError);
    await expect(slow).resolves.toBe(1);
  });
});
