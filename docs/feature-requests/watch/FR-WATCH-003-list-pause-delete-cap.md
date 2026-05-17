---
id: FR-WATCH-003
title: "`GET /v1/watchlists` list + `PATCH` pause/resume + `DELETE` soft-delete + free-tier 10-product cap enforcement"
module: WATCH
priority: MUST
status: shipped
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-WATCH-001, FR-WATCH-002, FR-BILL-001, FR-PRICE-001, FR-LEGAL-001]
depends_on: [FR-WATCH-001]
blocks: [FR-BILL-001]
effort_hours: 4

new_files:
  - apps/api/src/watchlist/watchlist-crud.controller.ts
modified_files:
  - apps/api/src/watchlist/watchlist.service.ts
allowed_tools:
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "expose other users' watchlists via predictable IDs (enumeration risk)"
  - "hard-delete watchlist row (must soft-delete to preserve commission attribution audit trail per FR-LEGAL-002 §1 #7)"
  - "skip the free-tier cap on reactivation (Pro→Free downgrade reopens this attack)"
  - "return commissionRate field to client (FR-LEGAL-002 §1 #10 — informational only, never user-facing)"
risk_if_skipped: "Without list+pause+delete, users can only add — there's no exit from a watchlist they no longer care about, no way to step away from alerts without losing history, no way to manage their 10-product cap. Plan §I phase 1 'Products tracked ≥ 10000' depends on users actively curating; D7 retention dies. The free-tier 10-product cap is the central upgrade trigger (plan §E2 'limit 10 products + Mega Sale event tới (FOMO)') — getting the enforcement wrong on reactivation lets users bypass billing."

---

## §1 — Description (BCP-14 normative)

The watchlist service MUST expose full CRUD over a user's watchlists with soft-delete semantics, paginated listing with denormalised product join, and free-tier cap enforcement at both creation (FR-WATCH-001) and reactivation paths.

1. **MUST** expose `GET /v1/watchlists?status=active|paused|all&page=&size=` returning paginated array sorted by `updatedAt DESC`. Default `status=active`, `page=1`, `size=20`. `size` capped at 50 (caller-passed > 50 silently clamped to 50; client should respect the cap to avoid silent truncation surprises).
2. **MUST** include the joined product fields needed by FE rendering on each list row via Mongo `$lookup` from `products` collection: `name`, `imageUrl`, `currentPrice`, `originalPrice`, `currentDiscountPct`, `lastObservedAt`, `affiliateLink`. The `$lookup` matches on the composite productId (`<shopId>-<itemId>`) reconstructed via `$concat` in the pipeline (because `products` has separate `shopId`/`itemId` fields, not the composite).
3. **MUST NOT** include `commissionRate` in the response — FR-LEGAL-002 §1 #10 firewall. The internal `products` row carries `commissionRate` (set by FR-AFF-003) but the projection in `$lookup` excludes it explicitly.
4. **MUST** enrich each row with `last30dMin` from TimescaleDB via `timescale.getLast30dMin(productId)` (FR-PRICE-001 §1 #6). Best-effort: if Timescale is unreachable, `last30dMin: null` is acceptable; the call MUST NOT block the list response (parallel `Promise.all` with per-item null-fallback).
5. **MUST** include `triggerCooldowns` map and `baselineAtTrack` on each row so the FE can render "next alert eligible at X" hints (FR-WATCH-002 §1 #8 reference).
6. **MUST** expose `PATCH /v1/watchlists/:id` body `{ status?: "active" | "paused", alertConfig?: {...} }` to toggle status and/or update alertConfig (overlapping with FR-WATCH-002). Auth: owner only (403 otherwise).
7. **MUST** enforce 10-active-product cap on transitions TO `status: "active"` (whether from `paused` or any other state). The cap applies to active-only; paused does NOT count toward the cap. Re-activating a paused watchlist when the user already has 10 active → 403 `free_tier_cap_reached` with `upgradeUrl: "/billing/upgrade"`. This is the central conversion-trigger path per plan §E2.
8. **MUST** expose `DELETE /v1/watchlists/:id`. Soft-delete: sets `status: "deleted"`, `deletedAt: now()`. Row stays in collection for 365-day retention per FR-LEGAL-001 §1 #7 (PDPL Decree 13 retention bands; commission-attribution audit). Hard-purge runs as a cron after `deletedAt > now() - 365 days` (cron lives in FR-LEGAL-001's hard-purge sweeper at P3 implementation; the row's `deletedAt` is the signal).
9. **MUST** rate-limit all CRUD endpoints combined at 50 req/min/userId via Redis token bucket keyed `rl:watch:<userId>:<minute>`. Excess returns 429 with `Retry-After: 60`.
10. **MUST** emit PostHog events `watchlist_paused`, `watchlist_resumed`, `watchlist_deleted` with `{ watchlistIdHash, source: "web" | "ext" }`. Hashing via FR-OBS-001 §1 #5 convention (sha256 + salt + 12-char prefix). Raw watchlistId NEVER in the event store.
11. **MUST** return p95 < 200 ms on `GET` for typical user (≤ 10 watchlists) including the Timescale `last30dMin` enrichment.
12. **MUST** filter results strictly to `{ userId: <jwt.userId>, status: <param> }`. No path traversal via `userId` query param, no admin override that bypasses the filter at API level. Cross-user enumeration via predictable ObjectIds is defeated by this filter.
13. **MUST** propagate the `lookupProduct` failure mode: if the `$lookup` returns null (product row missing because deletedAt set but watchlist row not yet cleaned up), the response row has `name: null` and product fields null instead of throwing. UI renders "Product unavailable" placeholder for these rows.

---

## §2 — Why this design

**Why soft-delete (not hard-delete):** plan §B5 + plan §B3 (PDPL Decree 13 Art. 24) require the *fact* of commission attribution to be reproducible for at least 365 days. Hard-deleting a watchlist row immediately destroys the link between user and product that powered a paid affiliate click, breaking the audit trail for the Transparency Report (FR-LEGAL-002 §1 #7). Soft-delete preserves the audit for a year; the hard-purge cron (FR-LEGAL-001 §1 #7) sweeps eligible rows after 365 days when both the PDPL retention window AND the Shopee commission webhook arrival window (max 90 days) have lapsed.

**Why active-only counts toward the 10-product cap:** matches user mental model ("I'm watching 8 things; pausing a few keeps the others alive"). Paused doesn't fire alerts → doesn't consume API budget → not part of the cap. Counting paused would force users to delete to free a slot, which destroys the "I might revisit this product later" UX that the pause feature exists to enable.

**Why `$lookup` (not denormalised cache on the watchlist row):** product fields change every check (currentPrice updates every 30 min for hot-tier products via FR-AFF-003). If the watchlist row denormalised these fields, every price update would require a fan-out write to every watching user's watchlist row — at 10K products × avg 3 watchers = 30K writes per price check, which is 8× the price-check itself. The `$lookup` join cost (single `findOne` per joined product, ~5ms each) is the cheaper write-vs-read trade.

**Why include `triggerCooldowns` in GET response:** FE shows "next alert eligible at X" — a meaningful UX hint that prevents users from thinking the alert system is broken when a fresh fire seems "missing" but is actually within cooldown. Plan §F4 implicit UX requirement: surface the system state to the user; never leave them guessing.

**Why 50 combined rate limit (not separate limits per endpoint):** the typical dashboard interaction is 1 GET + maybe 2-3 PATCHes during a session. 50/min covers heavy interactive use (pausing 30 products in one go during 11.11) without ever blocking legitimate behavior. Separate limits per endpoint would force the FE to spread state changes across multiple calls.

**Why p95 < 200 ms (not 500 ms):** dashboard list view is the user's primary surface; latency directly impacts perceived "is this app fast?" judgment. 200ms is the sweet spot — fast enough to feel instant, with enough budget for Mongo `$lookup` + parallel Timescale enrichment + JSON serialization.

**Why `name: null` fallback on missing product (not throw):** product rows can be soft-deleted (FR-AFF-003 §1 #6 marks items dead when Shopee returns empty `nodes[]`). The watchlist row outlives the product row by design (audit trail). If the FE got a 500 every time a watched product was deleted from Shopee, the dashboard would feel broken. Graceful fallback to "Product unavailable" gives the user agency to delete their stale watchlist.

**Why `commissionRate` NOT in the response projection:** even though the watchlist row's joined product carries `commissionRate`, exposing it to the FE creates a path where a curious user could see "this product pays 5%, that one pays 1.5%" and infer ranking. Plan §A3 principle 4 ("open source revenue model") covers aggregate; per-product commission rate stays internal. The Transparency Report shows revenue by source (alert_email vs deal_page), not per-product.

---

## §3 — API contract

### GET list

```http
GET /v1/watchlists?status=active&page=1&size=20 HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7...
```

Success:

```http
HTTP/1.1 200 OK
{
  "items": [
    {
      "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1",
      "productId": "123-456",
      "status": "active",
      "alertConfig": { "triggers": [...] },
      "triggerCooldowns": {},
      "baselineAtTrack": 100000,
      "lastTriggeredAt": null,
      "createdAt": "2026-05-15T10:00:00Z",
      "updatedAt": "2026-05-16T11:00:00Z",
      "name": "Áo thun nam basic",
      "imageUrl": "https://cf.shopee.vn/file/...",
      "currentPrice": 89000,
      "originalPrice": 129000,
      "currentDiscountPct": 31,
      "lastObservedAt": "2026-05-16T11:00:00Z",
      "last30dMin": 85000
    }
  ],
  "page": 1,
  "size": 20,
  "total": 7
}
```

### PATCH status / alertConfig

```http
PATCH /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1 HTTP/1.1
{ "status": "paused" }

→ 200 OK
{ "watchlistId": "65f8a2b3c4d5e6f7a8b9c0d1", "status": "paused", "updatedAt": "...", ... }
```

Free-tier cap on reactivation:

```http
PATCH /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1
{ "status": "active" }

→ 403 Forbidden (user already has 10 active)
{ "error": "free_tier_cap_reached", "limit": 10, "upgradeUrl": "/billing/upgrade" }
```

### DELETE soft-delete

```http
DELETE /v1/watchlists/65f8a2b3c4d5e6f7a8b9c0d1
→ 204 No Content
```

Subsequently visible with `status=all`:

```http
GET /v1/watchlists?status=all → includes the deleted row with status: "deleted", deletedAt: <date>
```

Errors:

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"invalid_status"}` | status not in enum |
| 401 | `{"error":"unauthenticated"}` | missing X-User-Id |
| 403 | `{"error":"forbidden"}` | not the owner |
| 403 | `{"error":"free_tier_cap_reached","limit":10,"upgradeUrl":"..."}` | reactivate at cap |
| 404 | `{"error":"watchlist_not_found"}` | wrong id |
| 429 | `{"error":"rate_limit","retryAfter":60}` | 51st call/min |

---

## §4 — Acceptance criteria

1. GET returns only the requester's watchlists.
2. Other user's watchlist id in PATCH/DELETE → 403 `forbidden`.
3. Reactivating paused when 10 already active → 403 `free_tier_cap_reached` with `upgradeUrl`.
4. Pro user reactivating when 10 already active → 200 (Pro cap is 200, not 10).
5. DELETE soft-deletes; row visible with `status=all` filter and `deletedAt` set.
6. DELETE → second GET with default `status=active` excludes the row.
7. `$lookup` joins product fields correctly (`name`, `imageUrl`, `currentPrice`).
8. Response does NOT include `commissionRate` field anywhere.
9. Pagination: `size=100` clamps to 50; response shows `size: 50`.
10. Sort by `updatedAt DESC` (most recently changed first).
11. PostHog events `watchlist_paused`, `watchlist_resumed`, `watchlist_deleted` fired per state change with `watchlistIdHash` (12-hex), no raw id.
12. p95 GET < 200 ms for user with 10 watchlists.
13. Combined CRUD rate limit triggers at 51 calls/min.
14. Product row missing (e.g., deletedAt set on product) → list row has `name: null`, not 500.
15. Timescale enrichment failure → `last30dMin: null` on each row; list response still returns 200.
16. `GET /v1/watchlists?status=all` includes active + paused + deleted rows.
17. Page > total → empty `items: []` (not 404).
18. Sorting tiebreaker: identical `updatedAt` → secondary sort by `_id` for deterministic pagination.

---

## §5 — Verification

```ts
describe("FR-WATCH-003 — watchlist CRUD", () => {
  it("AC1+AC2: user scoping", async () => {
    const list = await api.get("/v1/watchlists").as(userA);
    for (const item of list.body.items) {
      const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: new ObjectId(item.watchlistId) });
      expect(String(wl?.userId)).toBe(String(userA._id));
    }
    const r = await api.patch(`/v1/watchlists/${userB.wlId}`, { status: "paused" }).as(userA);
    expect(r.status).toBe(403);
  });

  it("AC3: reactivate at cap → 403 with upgradeUrl", async () => {
    await seedActiveWatchlists(testUserId, 10);
    const pausedId = await seedWatchlist(testUserId, "paused");
    const r = await api.patch(`/v1/watchlists/${pausedId}`, { status: "active" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("free_tier_cap_reached");
    expect(r.body.upgradeUrl).toBe("/billing/upgrade");
  });

  it("AC4: Pro user can reactivate beyond 10", async () => {
    await mongo.db("salenoti").collection("users").updateOne({ _id: new ObjectId(testUserId) }, { $set: { plan: "pro" } });
    await seedActiveWatchlists(testUserId, 10);
    const pausedId = await seedWatchlist(testUserId, "paused");
    const r = await api.patch(`/v1/watchlists/${pausedId}`, { status: "active" });
    expect(r.status).toBe(200);
  });

  it("AC5+AC6: soft-delete preserves row, hides from default list", async () => {
    await api.delete(`/v1/watchlists/${wlId}`);
    const defaultList = await api.get("/v1/watchlists");
    expect(defaultList.body.items.find((i) => i.watchlistId === wlId)).toBeUndefined();
    const allList = await api.get("/v1/watchlists?status=all");
    const row = allList.body.items.find((i) => i.watchlistId === wlId);
    expect(row?.status).toBe("deleted");
    expect(row?.deletedAt).toBeDefined();
  });

  it("AC8: commissionRate never in response", async () => {
    const list = await api.get("/v1/watchlists");
    expect(JSON.stringify(list.body)).not.toMatch(/commissionRate/i);
  });

  it("AC9: pagination clamp size > 50 → 50", async () => {
    const list = await api.get("/v1/watchlists?size=100");
    expect(list.body.size).toBe(50);
  });

  it("AC11: PostHog events with hashed watchlistId", async () => {
    const events = capturePostHog();
    await api.patch(`/v1/watchlists/${wlId}`, { status: "paused" });
    await api.patch(`/v1/watchlists/${wlId}`, { status: "active" });
    await api.delete(`/v1/watchlists/${wlId}`);
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain("watchlist_paused");
    expect(eventNames).toContain("watchlist_resumed");
    expect(eventNames).toContain("watchlist_deleted");
    for (const e of events.filter((e) => e.event.startsWith("watchlist_"))) {
      expect(e.properties.watchlistIdHash).toMatch(/^[a-f0-9]{12}$/);
      expect(JSON.stringify(e)).not.toContain(wlId);
    }
  });

  it("AC13: 51st call/min → 429", async () => {
    for (let i = 0; i < 50; i++) await api.get("/v1/watchlists");
    const r = await api.get("/v1/watchlists");
    expect(r.status).toBe(429);
  });

  it("AC14: missing product → name: null fallback", async () => {
    await mongo.db("salenoti").collection("products").deleteOne({ shopId: 1, itemId: 1 });
    const list = await api.get("/v1/watchlists");
    const row = list.body.items.find((i) => i.productId === "1-1");
    expect(row?.name).toBeNull();
  });

  it("AC15: Timescale failure degrades to last30dMin: null", async () => {
    mockTimescaleFailure();
    const list = await api.get("/v1/watchlists");
    expect(list.status).toBe(200);
    for (const item of list.body.items) expect(item.last30dMin).toBeNull();
  });

  it("AC17: page beyond total → empty items", async () => {
    const list = await api.get("/v1/watchlists?page=999");
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
  });
});
```

---

## §6 — Implementation skeleton

```ts
async list(input: { userId: string; status?: "active" | "paused" | "all"; page?: number; size?: number }) {
  const userOid = this.toObjectId(input.userId);
  const size = Math.min(Math.max(input.size ?? 20, 1), 50);
  const page = Math.max(input.page ?? 1, 1);
  const match: Filter<any> = { userId: userOid };
  if (input.status && input.status !== "all") match.status = input.status;
  else if (!input.status) match.status = "active";

  const pipeline = [
    { $match: match },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $skip: (page - 1) * size },
    { $limit: size },
    {
      $lookup: {
        from: "products",
        let: { pid: "$productId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [{ $concat: [{ $toString: "$shopId" }, "-", { $toString: "$itemId" }] }, "$$pid"],
              },
            },
          },
          // FR-WATCH-003 §1 #3 — explicit exclusion of commissionRate.
          { $project: { _id: 0, name: 1, imageUrl: 1, currentPrice: 1, originalPrice: 1, currentDiscountPct: 1, lastObservedAt: 1, affiliateLink: 1 } },
        ],
        as: "p",
      },
    },
    { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
  ];

  const items = await mongo.db("salenoti").collection("watchlists").aggregate(pipeline).toArray();

  // FR-WATCH-003 §1 #4 — best-effort Timescale enrichment.
  const enriched = await Promise.all(
    items.map(async (row: any) => {
      let last30dMin: number | null = null;
      try {
        last30dMin = await timescale.getLast30dMin(row.productId);
      } catch {}
      return {
        watchlistId: String(row._id),
        productId: row.productId,
        status: row.status,
        alertConfig: row.alertConfig,
        triggerCooldowns: row.triggerCooldowns ?? {},
        baselineAtTrack: row.baselineAtTrack,
        lastTriggeredAt: row.lastTriggeredAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt ?? null,
        name: row.p?.name ?? null,
        imageUrl: row.p?.imageUrl ?? null,
        currentPrice: row.p?.currentPrice ?? null,
        originalPrice: row.p?.originalPrice ?? null,
        currentDiscountPct: row.p?.currentDiscountPct ?? null,
        lastObservedAt: row.p?.lastObservedAt ?? null,
        last30dMin,
      };
    })
  );

  const total = await mongo.db("salenoti").collection("watchlists").countDocuments(match);
  return { items: enriched, page, size, total };
}

async setStatus(userId: string, wlId: string, status: "active" | "paused") {
  const userOid = this.toObjectId(userId);
  const wlOid = this.toObjectId(wlId);
  const wl = await mongo.db("salenoti").collection("watchlists").findOne({ _id: wlOid, userId: userOid });
  if (!wl) throw new ForbiddenException({ error: "forbidden" });
  if (status === "active" && wl.status !== "active") {
    const user = await mongo.db("salenoti").collection("users").findOne({ _id: userOid });
    const cap = user?.plan === "free" ? 10 : user?.plan === "pro" ? 200 : Number.MAX_SAFE_INTEGER;
    const count = await mongo.db("salenoti").collection("watchlists").countDocuments({ userId: userOid, status: "active" });
    if (count >= cap) throw new ForbiddenException({ error: "free_tier_cap_reached", limit: cap, upgradeUrl: "/billing/upgrade" });
  }
  await mongo.db("salenoti").collection("watchlists").updateOne({ _id: wlOid }, { $set: { status, updatedAt: new Date() } });
  this.posthog.capture(status === "paused" ? "watchlist_paused" : "watchlist_resumed", {
    watchlistIdHash: sha256(wlId).slice(0, 12),
    source: "web",
  });
}

async softDelete(userId: string, wlId: string) {
  const userOid = this.toObjectId(userId);
  const wlOid = this.toObjectId(wlId);
  const r = await mongo.db("salenoti").collection("watchlists").findOneAndUpdate(
    { _id: wlOid, userId: userOid },
    { $set: { status: "deleted", deletedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!r) throw new ForbiddenException({ error: "forbidden" });
  this.posthog.capture("watchlist_deleted", { watchlistIdHash: sha256(wlId).slice(0, 12), source: "web" });
}
```

---

## §7 — Dependencies

- **External:** none.
- **Internal:** FR-WATCH-001 (rows exist), FR-PRICE-001 (TimescaleClient `getLast30dMin`), FR-AFF-003 (writes the joined `products` fields).
- **Infrastructure:** MongoDB with `$lookup` support (M0 free tier supports), Redis for rate limit.
- **Compliance:** FR-LEGAL-001 §1 #7 retention bands (soft-delete preserved for 365 d).

---

## §8 — Example payloads

(see §3 for full request/response shapes)

### Soft-deleted row visible only via `status=all`

```http
GET /v1/watchlists?status=all
{
  "items": [
    { "watchlistId": "...", "status": "active", ... },
    { "watchlistId": "...", "status": "paused", ... },
    { "watchlistId": "...", "status": "deleted", "deletedAt": "2026-05-15T12:00:00Z", ... }
  ],
  "page": 1, "size": 20, "total": 12
}
```

### Cap enforcement on reactivation

```http
PATCH /v1/watchlists/65f...
{ "status": "active" }

→ 403 Forbidden
{ "error": "free_tier_cap_reached", "limit": 10, "upgradeUrl": "/billing/upgrade" }
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Hard-delete after 365-day retention?** Resolved → P3 cron job sweeper (lives under FR-LEGAL-001 hard-purge workflow). At MVP we accept indefinite soft-delete; storage cost is negligible at 10K-100K rows.
- **Q2: Bulk operations (delete N watchlists at once)?** Resolved → P2 (single per call at MVP keeps the audit trail clean; bulk needs idempotency + partial-failure handling).
- **Q3: Reorder / pin watchlists?** Resolved → P2 (`pinnedAt` field; sort by `pinnedAt DESC NULLS LAST, updatedAt DESC`).
- **Q4: Should DELETE confirm before destroying?** Resolved → no server-side confirm; FE responsible for "Are you sure?" UX. Server is idempotent: deleting an already-deleted row returns 204.
- **Q5: Cap behavior on Pro→Free downgrade with 200 active products?** Resolved → user keeps the 200 active (no automatic mass-pause). Future tracking new products will get 403 until pause/delete drops below 10. Plan §E2 conversion flow: surface a banner "You have 200 active, free limit is 10. Pause or delete to add new ones, or upgrade."
- **Q6: Should `triggerCooldowns` be in the response (it's read-only state) or excluded for size?** Resolved → include. The cooldown timestamps are useful UX hints ("next alert eligible at X"). Adds ~50 bytes per row, acceptable.

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| User pages past last → empty | normal flow | OK; `items: []`, `total` accurate | None — AC17 |
| User has 0 watchlists | empty result + total: 0 | UI shows empty-state CTA "Track your first product" | OK |
| Product row missing (race after track) | `$lookup` returns null; `$unwind preserveNullAndEmptyArrays: true` | Row has `name: null`; UI shows "Product unavailable" placeholder | Self-heals next price-check tick if Shopee resurrects product |
| Soft-deleted row hit by commission webhook (P2) | webhook join finds the row | Conversion attributed correctly | None — that's the audit-trail goal |
| Cross-user enumeration via predictable ObjectId | filter on `userId` defeats | 404 (no row) / 403 (cross-user PATCH/DELETE) | AC1+AC2 enforce |
| Concurrent PATCH on same row | last-write-wins per Mongo `findOneAndUpdate` | One state survives; the other is overwritten | Acceptable; no data loss |
| Pagination drift if rows change mid-scroll | total + items both refreshed per call | UI re-fetches and reconciles | Acceptable trade-off |
| Sort key tied for two rows (identical updatedAt) | secondary sort by `_id` | Deterministic pagination | AC18 |
| Rate limit triggered | 429 | UI backs off; manual retry shows count rapidly recovers | None |
| Free→Pro upgrade frees cap mid-session | re-fetch list shows correct count; FE banner updates | OK | Plan §E2 design |
| Pro→Free downgrade with 200 active | no auto-pause; new tracks blocked | Banner surfaces; user manually curates down to 10 | Plan §E2 design |
| Timescale enrichment timeout | per-item try/catch swallows; row has `last30dMin: null` | List still returns 200 in time | OK; AC15 covers |
| `$lookup` pipeline cost on 100K-watchlist user (theoretical P4) | n/a at MVP (typical user ≤ 50 watchlists) | revisit pagination strategy at P3 if observed | None at MVP scale |
| `commissionRate` accidentally projected | snapshot test on response JSON | PR blocked; CI fails | AC8 |
| DELETE on non-existent id | `findOneAndUpdate` returns null | 403 (treats as not-yours) | OK; consistent with cross-user enumeration defeat |

---

## §11 — Notes

- The `$lookup` join cost on the watchlists list is the dashboard's hot path. Performance-test this regularly (especially as user counts grow); the Mongo Atlas Performance Advisor will surface if we need to denormalise.
- Soft-delete retention is plumbed via FR-LEGAL-001 §1 #7 — the hard-purge cron (P3) is the cleanup boundary. Until then, deleted rows accumulate; at MVP scale this is < 1 GB/year.
- The Pro→Free downgrade behavior (Q5) is a deliberate UX choice: aggressive auto-pause would feel punitive. The banner-based opt-in curation is the kind path that aligns with plan §A3 trust posture.
- The `commissionRate` exclusion at the `$lookup` projection is a deliberate API-shape choice. If a future engineer needs commission data for an analytics endpoint, they should query the `products` collection directly (and have that endpoint pass `pnpm legal:check` for the ranking firewall).
- This FR's `list()` is the dashboard's primary data source. FE re-fetches via SWR / React Query every 30 seconds (FR-PRICE-002 pubsub-invalidate handles the chart; this endpoint stays REST-poll until P3 introduces SSE).

---

*End of FR-WATCH-003. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
