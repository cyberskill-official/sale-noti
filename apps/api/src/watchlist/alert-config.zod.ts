// FR-WATCH-002 §3 — alert config zod schemas (closed enum).
import { z } from "zod";

const Pct = z.number().min(1).max(90);
const PriceVnd = z.number().int().positive();
const Paused = z.boolean().default(false);

export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absolute_drop"), targetPrice: PriceVnd, paused: Paused }),
  z.object({
    kind: z.literal("pct_drop"),
    minDropPct: Pct,
    baseline: z.enum(["current_at_track", "last_observed"]).default("current_at_track"),
    paused: Paused,
  }),
  z.object({ kind: z.literal("lowest_30d"), paused: Paused }),
  z.object({
    kind: z.literal("flash_sale"),
    minDiscountPct: Pct.default(30),
    paused: Paused,
  }),
]);

export type Trigger = z.infer<typeof TriggerSchema>;
export type TriggerKind = Trigger["kind"];

export const AlertConfigSchema = z
  .object({
    triggers: z
      .array(TriggerSchema)
      .max(4)
      .refine((arr) => new Set(arr.map((t) => t.kind)).size === arr.length, {
        message: "duplicate_trigger_kind",
      }),
  })
  .strict();

export const DEFAULT_ALERT_CONFIG: { triggers: Trigger[] } = {
  triggers: [{ kind: "pct_drop", minDropPct: 10, baseline: "current_at_track", paused: false }],
};
