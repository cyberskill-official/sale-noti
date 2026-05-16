// FR-AFF-001 §1 #5 — three-state circuit breaker.
// open after 5 consecutive failures OR error_rate ≥ 50% over 20-call window.
// half-open after 60s; close on 3 consecutive successes in half-open.

type State = "closed" | "open" | "half_open";

export type BreakerOptions = {
  openAfterConsecFails: number;
  openAfterErrorRate: number;
  windowCalls: number;
  halfOpenAfterMs: number;
  closeAfterConsecSuccess: number;
};

const DEFAULTS: BreakerOptions = {
  openAfterConsecFails: 5,
  openAfterErrorRate: 0.5,
  windowCalls: 20,
  halfOpenAfterMs: 60_000,
  closeAfterConsecSuccess: 3,
};

export class CircuitBreaker {
  private state: State = "closed";
  private openedAt = 0;
  private consecFails = 0;
  private consecHalfOpenSuccess = 0;
  private window: Array<boolean> = []; // true = ok, false = fail
  private halfOpenSemaphore = false;
  private readonly opts: BreakerOptions;

  constructor(opts: Partial<BreakerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  getState(): State {
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.opts.halfOpenAfterMs) {
        this.state = "half_open";
        this.consecHalfOpenSuccess = 0;
      } else {
        throw new BreakerOpenError();
      }
    }

    if (this.state === "half_open") {
      // FR-AFF-001 §10 row 10 — single-token semaphore in half-open to prevent burst.
      if (this.halfOpenSemaphore) throw new BreakerOpenError();
      this.halfOpenSemaphore = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    } finally {
      if (this.state === "half_open" || this.state === "closed") {
        this.halfOpenSemaphore = false;
      }
    }
  }

  private onSuccess(): void {
    this.consecFails = 0;
    this.recordWindow(true);
    if (this.state === "half_open") {
      this.consecHalfOpenSuccess++;
      if (this.consecHalfOpenSuccess >= this.opts.closeAfterConsecSuccess) {
        this.state = "closed";
        this.window = [];
        this.consecHalfOpenSuccess = 0;
      }
    }
  }

  private onFailure(): void {
    this.consecFails++;
    this.recordWindow(false);
    if (this.state === "half_open") {
      this.state = "open";
      this.openedAt = Date.now();
      return;
    }
    const errRate = this.window.length > 0 ? this.window.filter((v) => !v).length / this.window.length : 0;
    if (this.consecFails >= this.opts.openAfterConsecFails || (this.window.length === this.opts.windowCalls && errRate >= this.opts.openAfterErrorRate)) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  private recordWindow(ok: boolean) {
    this.window.push(ok);
    if (this.window.length > this.opts.windowCalls) this.window.shift();
  }
}

export class BreakerOpenError extends Error {
  constructor() {
    super("circuit_breaker_open");
    this.name = "BreakerOpenError";
  }
}
