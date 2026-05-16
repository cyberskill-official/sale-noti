// FR-WATCH-002 §6 — pure trigger evaluation. Test target.
import type { Trigger, TriggerKind } from "./alert-config.zod";

export type TriggerContext = {
  currentPrice: number;
  lastObservedPrice: number;
  baselineAtTrack: number;
  last30dMin: number;
  flashSaleObserved: boolean;
  currentDiscountPct: number;
  cooldowns: Partial<Record<TriggerKind, Date | null>>;
};

const COOLDOWN_MS: Record<TriggerKind, number> = {
  absolute_drop: 24 * 3600 * 1000,
  pct_drop: 12 * 3600 * 1000,
  lowest_30d: 7 * 24 * 3600 * 1000,
  flash_sale: 1 * 3600 * 1000,
};

export function cooldownMs(kind: TriggerKind): number {
  return COOLDOWN_MS[kind];
}

export function evaluateTriggers(triggers: Trigger[], ctx: TriggerContext, now = Date.now()): { triggered: TriggerKind[] } {
  const out: TriggerKind[] = [];
  for (const t of triggers) {
    if (t.paused) continue;
    const lastFired = ctx.cooldowns[t.kind];
    if (lastFired && now - lastFired.getTime() < COOLDOWN_MS[t.kind]) continue;

    let fired = false;
    switch (t.kind) {
      case "absolute_drop":
        fired = ctx.currentPrice <= t.targetPrice;
        break;
      case "pct_drop": {
        const base = t.baseline === "last_observed" ? ctx.lastObservedPrice : ctx.baselineAtTrack;
        fired = base > 0 && ctx.currentPrice <= base * (1 - t.minDropPct / 100);
        break;
      }
      case "lowest_30d":
        fired = ctx.last30dMin > 0 && ctx.currentPrice <= ctx.last30dMin;
        break;
      case "flash_sale":
        fired = ctx.flashSaleObserved && ctx.currentDiscountPct >= t.minDiscountPct;
        break;
    }
    if (fired) out.push(t.kind);
  }
  return { triggered: out };
}
