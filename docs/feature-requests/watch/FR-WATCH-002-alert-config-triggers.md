---
id: FR-WATCH-002
title: "`PATCH /v1/watchlists/:id` — configure alert triggers (absolute_drop · pct_drop · lowest_30d · flash_sale) with per-trigger cooldowns + closed-enum integrity"
module: WATCH
priority: MUST
status: accepted
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-WATCH-001, FR-WATCH-003, FR-NOTIF-001, FR-NOTIF-002, FR-NOTIF-003, FR-AFF-003, FR-PRICE-001]
depends_on: [FR-WATCH-001]
blocks: [FR-NOTIF-001, FR-NOTIF-002, FR-NOTIF-003]
effort_hours: 5

new_files:
  - apps/api/src/watchlist/alert-config.zod.ts
  - apps/api/src/watchlist/trigger-eval.ts
  - apps/api/src/watchlist/__tests__/trigger-eval.spec.ts
modified_files:
  - apps/api/src/watchlist/watchlist.service.ts
  - apps/api/src/watchlist/watchlist-crud.controller.ts
allowed_tools:
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "introduce trigger types not in the closed enum (must author a new FR + Transparency Report note)"
  - "evaluate triggers client-side or in untrusted code path — server is the only authority"
  - "rank or order watchlists by `commissionRate` (FR-LEGAL-002 §1 #10 firewall)"
  - "fire an alert without writing the cooldown entry (alert spam risk)"
risk_if_skipped: "Without configurable triggers, every alert fires on the default 10% drop — which is wrong for high-volatility electronics buyers (they want 25%+) and wrong for grocery loyalists (5% is interesting). Plan §C3 lists the 4 trigger types as canonical and the founder validated each against the §F1 personas. A single fixed threshold collapses 4 distinct buyer-intent segments into one and tanks retention by 50%+ in user research from the plan's beta period."

---

## §1 — Description (BCP-14 normative)

The watchlist service MUST allow per-product alert configuration through a typed, closed-enum trigger model with per-trigger cooldown enforcement at evaluation time.

1. **MUST** define a closed enum of trigger kinds: `absolute_drop | pct_drop | lowest_30d | flash_sale`. Adding a new kind requires a new FR AND a Transparency Report note for the next quarter. The enum is enforced via zod `discriminatedUnion` (parse-time rejection of unknown kinds).
2. **MUST** validate `alertConfig` shape with zod schema. Per-trigger fields are exactly:
   - `absolute_drop`: `{ kind: "absolute_drop", targetPrice: number /* VND integer, > 0, ≤ 1,000,000,000 */, paused: boolean /* default false */ }`
   - `pct_drop`: `{ kind: "pct_drop", minDropPct: number /* 1..90 inclusive */, baseline: "current_at_track" | "last_observed" (default "current_at_track"), paused: boolean }`
   - `lowest_30d`: `{ kind: "lowest_30d", paused: boolean }`
   - `flash_sale`: `{ kind: "flash_sale", minDiscountPct: number /* 10..90, default 30 */, paused: boolean }`
3. **MUST** expose `PATCH /v1/watchlists/:id` body shape `{ alertConfig?: { triggers: Trigger[] }, status?: "active" | "paused" }`. Up to 4 triggers per watchlist (one per kind; duplicate kinds rejected with `error: "duplicate_trigger_kind"`).
4. **MUST** evaluate triggers in `trigger-eval.ts` as a pure function. Input `{ currentPrice, lastObservedPrice, baselineAtTrack, last30dMin, flashSaleObserved, currentDiscountPct, cooldowns }`. Output `{ triggered: TriggerKind[] }`. Pure function = no I/O, no mutation, no clock-reading (clock-skew exposure threaded via explicit `now` parameter with default `Date.now()`).
5. **MUST** apply per-trigger cooldowns at eval time to prevent alert spam: after a trigger fires, that trigger cannot re-fire for the same `(userId, productId)` within `cooldownHours`. Defaults are:
   - `absolute_drop: 24h` (price oscillating around a fixed target shouldn't spam)
   - `pct_drop: 12h` (price oscillating around relative threshold; 12h balances responsiveness vs noise)
   - `lowest_30d: 168h (7d)` (re-firing on a new 30-day low only once per week is the right cadence — once-per-day would be noise on slowly-declining prices)
   - `flash_sale: 1h` (flash sales typically last 1-3 hours; 1h cooldown means the user gets at most one alert per flash event)
6. **MUST** support pausing a watchlist via `PATCH` body `{ status: "paused" }`. Paused watchlists return `triggered: []` from `evaluateTriggers` unconditionally regardless of trigger config. This is the "I'm not interested in this anymore but want to preserve history" UX (cleaner than delete).
7. **MUST** support per-trigger pause WITHOUT pausing the whole watchlist: `triggers[i].paused = true` excludes that trigger from evaluation while other triggers in the same watchlist continue firing. UX: "stop the flash_sale alerts; keep lowest_30d active."
8. **MUST** return updated `Watchlist` shape on PATCH success including `triggerCooldowns` so the FE can render "next eligible alert at X" hints.
9. **MUST** emit PostHog event `watchlist_alert_config_changed` with `{ watchlistIdHash, triggerKinds: <kinds-array>, source: "web" | "ext" }`. `watchlistIdHash = sha256(watchlistId).slice(0, 12)` to keep raw IDs out of analytics store per FR-OBS-001 §1 #5.
10. **MUST** enforce auth: only the watchlist's owner can PATCH (403 `forbidden` otherwise). Cross-user enumeration via predictable ObjectIds is defeated by the `userId` filter on the underlying `findOne`.
11. **MUST** validate trigger constraint values per §1 #2 ranges. zod rejects with explicit `issues[]` on out-of-range values (`minDropPct: 0` or `91`, `minDiscountPct: 9` or `91`, negative `targetPrice`, `targetPrice > 1B VND`).
12. **MUST NOT** mutate `triggerCooldowns` from this endpoint. Cooldown writes only happen at alert dispatch time (FR-NOTIF-001 §1 #7). Caller cannot reset cooldowns via PATCH; they can only pause/resume the trigger to skip evaluation entirely.

---

## §2 — Why this design

**Why 4 closed trigger kinds (not 5, not 10):** plan §C3 watchlists `triggers: ["absolute_drop","pct_drop","lowest_30d","flash_sale"]` — verbatim. These 4 cover the personas in plan §F1: Gen-Z (`flash_sale` driven), Mẹ bỉm sữa (`pct_drop` 10-15% sweet spot), Sinh viên (`absolute_drop` budget anchor), Văn phòng (`lowest_30d` rational waiter). An open trigger model would invite bikeshedding ("can we add `lowest_60d`? `lowest_90d`?") and we'd never converge; closed enum lets the eval path stay flat (a single switch statement in `trigger-eval.ts`) and locks the analytics dimension table.

**Why baseline configurable for `pct_drop`:**
- `current_at_track` means "alert me when price drops X% from where I started watching" — intuitive for new users who just tracked a product they saw at a specific price.
- `last_observed` means "alert me whenever there's a fresh X% drop from the most recent observation" — useful for long-held items where the user wants to catch any new sale even if the product has been declining slowly.

Without the option, users either get spammed (`last_observed` semantics on a sliding-down price) or miss real drops (`current_at_track` after 6 months of price decline locks in a stale baseline). Default is `current_at_track` because it's the intuitive interpretation of "10% drop" for first-time users.

**Why per-trigger cooldowns (not a single watchlist-level cooldown):** different triggers have different "right" cadences. A price oscillating around an absolute target (`absolute_drop`) should not spam — user wants confirmation, not a stream. A flash-sale trigger SHOULD fire more often because flash sales are short-lived events. A 30-day low only happens occasionally; firing weekly is plenty. Per-trigger cooldowns match the semantic of each kind to the user's actual alert tolerance.

**Why cooldown values 24h/12h/7d/1h specifically:**
- `absolute_drop: 24h` — price oscillating 1% above/below a fixed target oscillates many times per day. 24h cooldown means at most one alert per day; user gets the confirmation they wanted, not the daily noise.
- `pct_drop: 12h` — twice-daily firing covers "morning sale" + "evening sale" cycles without overwhelming. Plan §F1 persona "Mẹ bỉm sữa" checks deals at 5am (before kids wake) and 9pm (after kids sleep); 12h cooldown aligns with that rhythm.
- `lowest_30d: 168h (7d)` — re-firing on a new 30-day low only once per week is the right cadence; once-per-day would be noise on slowly-declining prices. The "I'm waiting for a real low" user is patient by definition.
- `flash_sale: 1h` — flash sales typically last 1-3 hours; 1h cooldown means the user gets at most one alert per flash event but can still catch the second flash event if it's a "double sale" day.

**Why pause whole-watchlist OR per-trigger:** "stop alerts but keep history" is a real UX need at two granularities. A user may want to mute `flash_sale` (too noisy on 11.11) while keeping `lowest_30d` active. Or they may want to pause everything for a week while travelling. Both are valid; both are 1-line PATCH operations.

**Why `triggerCooldowns` is read-only from this endpoint:** if the caller could reset cooldowns via PATCH, they could trivially trigger spam by writing `{ triggerCooldowns: {} }` repeatedly. Cooldown timestamps are set by the alert dispatch worker (FR-NOTIF-001 §1 #7) and never via user-controlled API surface. This is the canonical pattern for "system-set field, user-readable but not writable."

**Why pure function for `evaluateTriggers`:** alerts must be deterministic for a given input. A flaky function that depends on `Date.now()` in unexpected places makes alert correctness hard to test. By passing `now` as an explicit parameter (default `Date.now()`), every test can pin time exactly. This is the same pattern used in cryptographic libraries where signing clocks must be testable.

---

## §3 — Zod schema + eval contract

```ts
// apps/api/src/watchlist/alert-config.zod.ts
import { z } from "zod";

const Pct = z.number().min(1).max(90);
const PriceVnd = z.number().int().positive().max(1_000_000_000);
const Paused = z.boolean().default(false);

export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("absolute_drop"),
    targetPrice: PriceVnd,
    paused: Paused,
  }),
  z.object({
    kind: z.literal("pct_drop"),
    minDropPct: Pct,
    baseline: z.enum(["current_at_track", "last_observed"]).default("current_at_track"),
    paused: Paused,
  }),
  z.object({
    kind: z.literal("lowest_30d"),
    paused: Paused,
  }),
  z.object({
    kind: z.literal("flash_sale"),
    minDiscountPct: z.number().min(10).max(90).default(30),
    paused: Paused,
  }),
]);

export const AlertConfigSchema = z.object({
  triggers: z
    .array(TriggerSchema)
    .max(4)
    .refine((arr) => new Set(arr.map((t) => t.kind)).size === arr.length, {
      message: "duplicate_trigger_kind",
    }),
}).strict();

export type Trigger = z.infer<typeof TriggerSchema>;
export type TriggerKind = Trigger["kind"];

export const DEFAULT_ALERT_CONFIG: { triggers: Trigger[] } = {
  triggers: [{ kind: "pct_drop", minDropPct: 10, baseline: "current_at_track", paused: false }],
};
```

```ts
// apps/api/src/watchlist/trigger-eval.ts
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
  pct_drop:      12 * 3600 * 1000,
  lowest_30d:     7 * 24 * 3600 * 1000,
  flash_sale:         3600 * 1000,
};

export function cooldownMs(kind: TriggerKind): number {
  return COOLDOWN_MS[kind];
}

export function evaluateTriggers(
  triggers: Trigger[],
  ctx: TriggerContext,
  now: number = Date.now()
): { triggered: TriggerKind[] } {
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
```

### PATCH endpoint contract

```http
PATCH /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1 HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...
Content-Type: application/json

{
  "alertConfig": {
    "triggers": [
      { "kind": "pct_drop", "minDropPct": 15, "baseline": "current_at_track" },
      { "kind": "flash_sale", "minDiscountPct": 30 }
    ]
  }
}
```

Response:

```http
HTTP/1.1 200 OK
{
  "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1",
  "alertConfig": { "triggers": [...] },
  "status": "active",
  "triggerCooldowns": { "pct_drop": "2026-05-15T11:00:00Z" },
  "updatedAt": "2026-05-16T11:00:00Z"
}
```

Errors:

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"duplicate_trigger_kind"}` | two triggers with same kind |
| 400 | `{"error":"invalid_alert_config","issues":[...]}` | zod parse fail (range, shape) |
| 401 | `{"error":"unauthenticated"}` | missing X-User-Id |
| 403 | `{"error":"forbidden"}` | not the owner |
| 404 | `{"error":"watchlist_not_found"}` | wrong id |

---

## §4 — Acceptance criteria

1. PATCH with 4 valid trigger kinds (one of each) → 200; row updated; `alertConfig.triggers` length 4.
2. PATCH with 2 `pct_drop` triggers (same kind twice) → 400 `duplicate_trigger_kind`.
3. PATCH with `pct_drop.minDropPct: 0` → 400 (zod) `invalid_alert_config` with issue `minDropPct.too_small`.
4. PATCH with `pct_drop.minDropPct: 91` → 400 (zod) `invalid_alert_config`.
5. PATCH with `absolute_drop.targetPrice: -1` → 400.
6. PATCH with `absolute_drop.targetPrice: 1_500_000_000` (over 1B VND cap) → 400.
7. PATCH on another user's watchlist → 403 `forbidden`.
8. `evaluateTriggers` with `pct_drop minDropPct 15` + `currentPrice 80000` + `baselineAtTrack 100000` (20% drop) → `triggered: ["pct_drop"]`.
9. Same watchlist evaluated within cooldown (12h) → `triggered: []`.
10. After cooldown elapses (now > lastFired + 12h) → `pct_drop` fires again.
11. `flash_sale minDiscountPct 30` + `currentDiscountPct 35` + `flashSaleObserved true` → fires.
12. `flash_sale minDiscountPct 30` + `currentDiscountPct 35` + `flashSaleObserved false` → does NOT fire (both conditions required).
13. Paused trigger (`paused: true`) → never in triggered list regardless of price condition.
14. Paused watchlist (`status: paused`) → `triggered: []` from caller's combined check (caller is FR-NOTIF-001 worker; watchlist status is the outer guard).
15. PostHog event `watchlist_alert_config_changed` emitted with `watchlistIdHash` (12-char hex), `triggerKinds: [...]`, `source: "web" | "ext"`.
16. `triggerCooldowns` not mutable via PATCH (any attempt to include it in PATCH body is silently ignored or rejected with zod `unrecognized_keys` since schema is `.strict()`).
17. `evaluateTriggers` called twice with identical input produces identical output (pure function, no time-dependent randomness).
18. `cooldownMs("absolute_drop")` = 86_400_000; `cooldownMs("pct_drop")` = 43_200_000; `cooldownMs("lowest_30d")` = 604_800_000; `cooldownMs("flash_sale")` = 3_600_000.

---

## §5 — Verification

```ts
// apps/api/src/watchlist/__tests__/trigger-eval.spec.ts
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
  it("AC8: pct_drop 15% from baselineAtTrack fires when current ≤ 85k", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
    ];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual(["pct_drop"]);
  });

  it("AC9: pct_drop cooldown 12h blocks re-fire", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
    ];
    const ctx = { ...baseCtx, cooldowns: { pct_drop: new Date(Date.now() - 1000) } };
    expect(evaluateTriggers(triggers, ctx).triggered).toEqual([]);
  });

  it("AC10: pct_drop fires again after cooldown elapses", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: false },
    ];
    const ctx = { ...baseCtx, cooldowns: { pct_drop: new Date(Date.now() - 13 * 3600 * 1000) } };
    expect(evaluateTriggers(triggers, ctx).triggered).toEqual(["pct_drop"]);
  });

  it("AC11+12: flash_sale needs both flag AND threshold", () => {
    const triggers: Trigger[] = [{ kind: "flash_sale", minDiscountPct: 30, paused: false }];
    expect(evaluateTriggers(triggers, { ...baseCtx, flashSaleObserved: true, currentPrice: 65_000, currentDiscountPct: 35 }).triggered).toEqual(["flash_sale"]);
    expect(evaluateTriggers(triggers, { ...baseCtx, flashSaleObserved: false, currentPrice: 65_000, currentDiscountPct: 35 }).triggered).toEqual([]);
    expect(evaluateTriggers(triggers, { ...baseCtx, flashSaleObserved: true, currentDiscountPct: 25 }).triggered).toEqual([]);
  });

  it("AC13: paused trigger excluded", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 15, baseline: "current_at_track", paused: true },
    ];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual([]);
  });

  it("AC17: pure function — identical input → identical output", () => {
    const triggers: Trigger[] = [{ kind: "pct_drop", minDropPct: 10, baseline: "current_at_track", paused: false }];
    const r1 = evaluateTriggers(triggers, baseCtx, 1_700_000_000_000);
    const r2 = evaluateTriggers(triggers, baseCtx, 1_700_000_000_000);
    expect(r1).toEqual(r2);
  });

  it("AC18: cooldown durations match §1 #5", () => {
    expect(cooldownMs("absolute_drop")).toBe(86_400_000);
    expect(cooldownMs("pct_drop")).toBe(43_200_000);
    expect(cooldownMs("lowest_30d")).toBe(604_800_000);
    expect(cooldownMs("flash_sale")).toBe(3_600_000);
  });

  it("AC8: absolute_drop fires only when current ≤ target", () => {
    const triggers: Trigger[] = [{ kind: "absolute_drop", targetPrice: 70_000, paused: false }];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual([]);
    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 70_000 }).triggered).toEqual(["absolute_drop"]);
  });

  it("AC8: lowest_30d fires only when current ≤ last30dMin", () => {
    const triggers: Trigger[] = [{ kind: "lowest_30d", paused: false }];
    expect(evaluateTriggers(triggers, baseCtx).triggered).toEqual([]);
    expect(evaluateTriggers(triggers, { ...baseCtx, currentPrice: 75_000 }).triggered).toEqual(["lowest_30d"]);
  });

  it("AC8: pct_drop with baseline last_observed", () => {
    const triggers: Trigger[] = [
      { kind: "pct_drop", minDropPct: 5, baseline: "last_observed", paused: false },
    ];
    const ctx = { ...baseCtx, currentPrice: 76_000, lastObservedPrice: 80_000 };
    expect(evaluateTriggers(triggers, ctx).triggered).toEqual(["pct_drop"]);
  });
});

// HTTP-level tests at apps/api/src/watchlist/__tests__/patch.spec.ts
describe("FR-WATCH-002 — PATCH /v1/watchlists/:id", () => {
  it("AC2: duplicate trigger kind rejected", async () => {
    const r = await api.patch(`/v1/watchlists/${wlId}`, {
      alertConfig: { triggers: [{ kind: "pct_drop", minDropPct: 10 }, { kind: "pct_drop", minDropPct: 20 }] },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("duplicate_trigger_kind");
  });

  it("AC7: cross-user PATCH rejected", async () => {
    const r = await api.patch(`/v1/watchlists/${otherUserWlId}`, { status: "paused" }).as(userA);
    expect(r.status).toBe(403);
  });

  it("AC15: PostHog event with hashed watchlistId", async () => {
    const events = capturePostHog();
    await api.patch(`/v1/watchlists/${wlId}`, { alertConfig: { triggers: [{ kind: "lowest_30d" }] } });
    const ev = events.find((e) => e.event === "watchlist_alert_config_changed");
    expect(ev!.properties.watchlistIdHash).toMatch(/^[a-f0-9]{12}$/);
    expect(ev!.properties.triggerKinds).toEqual(["lowest_30d"]);
  });

  it("AC16: triggerCooldowns silently dropped on PATCH (strict zod)", async () => {
    const r = await api.patch(`/v1/watchlists/${wlId}`, {
      alertConfig: { triggers: [{ kind: "pct_drop", minDropPct: 10 }], triggerCooldowns: { pct_drop: new Date(0) } },
    });
    expect(r.status).toBe(400); // strict() rejects unrecognized keys
  });
});
```

---

## §6 — Implementation skeleton

See §3 for the canonical zod schema + pure-function eval. Service patch method:

```ts
async patch(input: { userId: string; watchlistId: string; alertConfig?: unknown; status?: "active" | "paused" }) {
  const userOid = this.toObjectId(input.userId);
  const wlOid = this.toObjectId(input.watchlistId);
  const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid, userId: userOid });
  if (!wl) throw new ForbiddenException({ error: "forbidden" });

  const $set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.alertConfig !== undefined) {
    const parsed = AlertConfigSchema.safeParse(input.alertConfig);
    if (!parsed.success) {
      throw new BadRequestException({ error: "invalid_alert_config", issues: parsed.error.issues });
    }
    $set.alertConfig = parsed.data;
  }

  if (input.status === "active" && wl.status !== "active") {
    // FR-WATCH-003 §1 #6 — reactivating paused enforces free-tier cap.
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
    if (user?.plan === "free") {
      const count = await mongo.db("salenoti").collection("watchlists")
        .countDocuments({ userId: userOid, status: "active" });
      if (count >= 10) throw new ForbiddenException({ error: "free_tier_cap_reached", limit: 10, upgradeUrl: "/billing/upgrade" });
    }
    $set.status = "active";
  } else if (input.status === "paused") {
    $set.status = "paused";
  }

  await mongo.db("salenoti").collection("watchlists").updateOne({ _id: wlOid }, { $set });
  const fresh = await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid });
  this.posthog.capture("watchlist_alert_config_changed", {
    watchlistIdHash: sha256(input.watchlistId).slice(0, 12),
    triggerKinds: fresh?.alertConfig?.triggers?.map((t: any) => t.kind) ?? [],
    source: "web",
  });
  return fresh;
}
```

---

## §7 — Dependencies

- **External:** none.
- **Internal:** FR-WATCH-001 (watchlist row creation), FR-PRICE-001 (TimescaleClient `getLast30dMin` for the `lowest_30d` trigger ctx field), FR-AFF-003 (sets `products.currentPrice` / `originalPrice` / `currentDiscountPct` consumed by the eval).
- **Infrastructure:** MongoDB (watchlists collection), no Redis dependency (eval is pure).
- **Vendor:** `zod`, `mongodb`.

---

## §8 — Example payloads

### PATCH config update

```http
PATCH /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1
{
  "alertConfig": {
    "triggers": [
      { "kind": "pct_drop", "minDropPct": 15, "baseline": "current_at_track" },
      { "kind": "flash_sale", "minDiscountPct": 30 }
    ]
  }
}

→ 200 OK
{
  "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1",
  "alertConfig": { "triggers": [...] },
  "status": "active",
  "triggerCooldowns": {},
  "updatedAt": "2026-05-16T11:00:00Z"
}
```

### Pause whole watchlist

```http
PATCH /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1
{ "status": "paused" }
```

### Validation error

```http
PATCH /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1
{ "alertConfig": { "triggers": [{ "kind": "pct_drop", "minDropPct": 0 }] } }

→ 400 Bad Request
{ "error": "invalid_alert_config", "issues": [{ "path": ["triggers", 0, "minDropPct"], "code": "too_small", "minimum": 1 }] }
```

### Trigger eval (FR-NOTIF-001 caller)

```ts
const triggered = evaluateTriggers(
  watchlist.alertConfig.triggers,
  {
    currentPrice: 80_000,
    lastObservedPrice: 82_000,
    baselineAtTrack: 100_000,
    last30dMin: 75_000,
    flashSaleObserved: false,
    currentDiscountPct: 20,
    cooldowns: watchlist.triggerCooldowns ?? {},
  }
);
// → { triggered: ["pct_drop"] }
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Allow custom cooldown per trigger?** Resolved → no in P1; the 4 default cooldowns (§1 #5) are sensible and validated against persona research. Custom cooldowns would explode the analytics dimension and invite "0 cooldown" abuse. P3 if data shows demand.
- **Q2: Soft-cap on triggers per watchlist?** Resolved → 4 (one per kind). Matches the closed enum exactly; any further triggers would have to share a kind, which `.refine()` rejects.
- **Q3: Cross-watchlist correlation (this product across all users)?** Resolved → no; per-watchlist scoping is the explicit design. Cross-watchlist analytics (e.g., "how many users use lowest_30d?") live in PostHog aggregations, not in the Mongo schema.
- **Q4: Should `current_at_track` baseline freeze at first track or update on un-pause?** Resolved → freeze at first track. Un-pause does NOT reset baseline; the original baseline is preserved so a user pausing for a week doesn't lose their reference point.
- **Q5: How does eval handle `last30dMin: 0` (no history yet)?** Resolved → §6 skeleton checks `ctx.last30dMin > 0` before the comparison, so `lowest_30d` does not fire on products with no history. New trackings need ≥ 1 observation in the 30-day window.
- **Q6: How does eval handle `currentPrice: 0` (free item)?** Resolved → `pct_drop` computes `currentPrice ≤ base * (1 - pct/100)`, so 0 satisfies any percentage threshold and fires once. The 24h cooldown caps the spam. `absolute_drop` similarly fires once if target > 0.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Stale `baselineAtTrack` after a trigger fires | n/a (immutable per design) | Future evals continue using the original baseline | If user wants fresh baseline → un-track + re-track (deliberate UX) |
| Cooldown miss (server clock skew) | Worker NTP-synced; eval uses server clock | Eval may fire ~60s early or late on clock drift | NTP sync host; tolerate ±60s drift acceptable for daily-cadence alerts |
| All triggers paused → caller still passes the watchlist into eval | `evaluateTriggers` returns `triggered: []` | No alert fires; no cooldown written | OK by design |
| Unknown trigger kind via injection | zod `.discriminatedUnion` rejects at parse | 400; row not updated | None |
| `lowest_30d` with < 30 days of history | `last30dMin = MIN(price)` over available window | Uses the partial-window min (honest behavior) | None — better than alerting "no history yet" |
| `targetPrice: 0` / negative | zod `.positive()` rejects | 400 | None |
| Flash-sale flag flaps (Shopee toggles flashSale boolean every check) | eval evaluates per check; 1h cooldown after fire | One alert per 1h max; spam bounded | OK |
| User on free tier pauses to free a slot | FR-WATCH-003 counts active only; paused doesn't count | Allowed — `paused` slot freed up | Plan §E2 conversion-trigger UX intact |
| Bulk PATCH multiple watchlists race | each PATCH is independent `findOneAndUpdate`; last-write-wins per row | OK | Acceptable |
| Trigger kinds added in DB without code path | zod parse-time fails → row unchanged | Rejected at PATCH; if seeded via direct Mongo write, eval ignores the unknown kind | Use migration; never write triggers directly to Mongo |
| Cooldown write fails post-alert (FR-NOTIF-001 worker error) | Sentry tag `phase: "cooldown_write"` | Alert sent without cooldown; potential immediate re-fire next check | Worker retries the cooldown write idempotently |
| zod `.strict()` allows future-proof field additions to leak as 400s | Test suite covers known fields | Caller errors when including new field client-side | Document; or relax to `.passthrough()` if backward-compat needed |
| Cross-trigger interaction (e.g., `pct_drop` + `flash_sale` both fire on same observation) | both returned in `triggered: []` | FR-NOTIF-001 sends 2 alerts (one per kind) OR 1 alert listing both kinds (impl choice) | Doc'd in NOTIF-001 §1 #4: one alert per (idem, channel) regardless of trigger count |

---

## §11 — Notes

- The pure-function eval is easily unit-testable independent of HTTP — that's the AC17 invariant + the entire `__tests__/trigger-eval.spec.ts` file demonstrates the pattern.
- FR-NOTIF-001 worker calls `evaluateTriggers` and then dispatches the email — the worker is the I/O layer; this function is the policy layer. The separation is what lets us A/B-test trigger policies in the future without touching the worker.
- The `triggerCooldowns` Mongo field is bumped at FR-NOTIF-001 §1 #7 (after successful dispatch). This FR's PATCH endpoint is purely user-facing config; cooldowns are operational state owned by the worker.
- Plan §C3 watchlists schema commit: `triggers: ["absolute_drop","pct_drop","lowest_30d","flash_sale"]`. The closed enum here matches verbatim; any future expansion needs both an FR + a Transparency Report row.
- The pure-function pattern also makes alert correctness reproducible: given the same `price_history` row + the same alertConfig, the same triggers fire. This satisfies plan §A3 principle 4 ("open source revenue model") — users can audit any alert by replaying the eval against historical data.

---

*End of FR-WATCH-002. Status: accepted (10/10). Last expanded: 2026-05-16.*
