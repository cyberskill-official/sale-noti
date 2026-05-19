// FR-WORKER-002 §1 #5 — exponential backoff with jitter.
// base 30s · multiplier 2 · ±25% jitter · cap 30 min.

const BASE_MS = 30_000;
const CAP_MS = 30 * 60_000;

export function backoffMs(attempts: number): number {
  const exp = Math.min(BASE_MS * Math.pow(2, Math.max(0, attempts - 1)), CAP_MS);
  const jitter = (Math.random() - 0.5) * 0.5 * exp; // ±25%
  return Math.min(CAP_MS, Math.round(exp + jitter));
}
