import { describe, it, expect } from "vitest";
import { evaluateTriggers, cooldownMs } from "../trigger-eval";
import type { Trigger } from "../alert-config.zod";

const baseCtx = {
  currentPrice: 80_000,
  lastObservedPrice: 80_000,
  baselineAtTrack: 100_000,
  last30dMin: 75_000,
  flashSaleObserved: false,
  currentDiscountPct: 20,
  cooldowns: {},
};

describe("FR-WATCH-002 — evaluateTriggers", () => {
  it("AC5: pct_drop 15% from baselineAtTrack fires when current ≤ 85k", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
    ];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual(["pct_drop"]);
  });

  it("AC6: pct_drop cooldown 12h blocks re-fire", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
    ];
    const ctx = { ...baseCtx, cooldowns: { pct_drop: new Date(Date.now() - 1000) } };
    expect(evaluateTriggers(triggers, ctx).triggered).toEqual([]);
  });

  it("AC10+17: pct_drop fires again after cooldown and is deterministic for pinned time", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
    ];
    const now = 1_800_000_000_000;
    const ctx = { ...baseCtx, cooldowns: { pct_drop: new Date(now - 13 * 3600 * 1000) } };

    expect(evaluateTriggers(triggers, ctx, now)).toEqual(evaluateTriggers(triggers, ctx, now));
    expect(evaluateTriggers(triggers, ctx, now).triggered).toEqual(["pct_drop"]);
  });

  it("AC8: paused trigger excluded", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: true },
    ];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual([]);
  });

  it("AC7: flash_sale fires when observed + discount ≥ threshold", () => {
    const triggers: Trigger[] = [{ kind: "flash_sale", minDiscountPct: 30, paused: false }];
    const ctx = { ...baseCtx, flashSaleObserved: true, currentPrice: 65_000, currentDiscountPct: 35 };
    expect(evaluateTriggers(triggers, ctx).triggered).toEqual(["flash_sale"]);
    expect(evaluateTriggers(triggers, { ...ctx, flashSaleObserved: false }).triggered).toEqual([]);
    expect(evaluateTriggers(triggers, { ...ctx, currentDiscountPct: 25 }).triggered).toEqual([]);
  });

  it("absolute_drop fires only when current ≤ target", () => {
    const triggers: Trigger[] = [{ kind: "absolute_drop", targetPrice: 70_000, paused: false }];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual([]);
    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 70_000 }).triggered).toEqual(["absolute_drop"]);
  });

  it("lowest_30d fires only when current ≤ last30dMin", () => {
    const triggers: Trigger[] = [{ kind: "lowest_30d", paused: false }];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual([]);
    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 75_000 }).triggered).toEqual(["lowest_30d"]);
    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 1, last30dMin: 0 }).triggered).toEqual([]);
  });

  it("pct_drop supports last_observed baseline and ignores zero baselines", () => {
    const triggers: Trigger[] = [{ kind: "pct_drop", minDropPct: 5, baseline: "last_observed", paused: false }];

    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 76_000, lastObservedPrice: 80_000 }).triggered).toEqual([
      "pct_drop",
    ]);
    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 1, lastObservedPrice: 0 }).triggered).toEqual([]);
  });

  it("cooldown durations match §1 #5", () => {
    expect(cooldownMs("absolute_drop")).toBe(24 * 3600 * 1000);
    expect(cooldownMs("pct_drop")).toBe(12 * 3600 * 1000);
    expect(cooldownMs("lowest_30d")).toBe(7 * 24 * 3600 * 1000);
    expect(cooldownMs("flash_sale")).toBe(3600 * 1000);
  });
});
