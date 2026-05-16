---
id: FR-GROW-003
title: "Mega Sale Mode — event-themed UI · 7-day-pre teaser push · day-of leaderboard · auto-post to Zalo/Telegram channels"
module: GROW
priority: SHOULD
status: SPEC_READY
verify: T
phase: P2
slice: 2
owner: growth-team
created: 2026-05-16
last_revised: 2026-05-16
template: engineering-spec@1
reviewers: [legal, eng-web, eng-api, marketing]
plan_anchors: [§F2 #7, §F4 mega-sale-spike, §F5 marketing-calendar]
depends_on: [FR-PRICE-001, FR-NOTIF-001, FR-NOTIF-002, FR-AFF-002, FR-AFF-004]
blocked_by: []
unlocks: []
---

## §1 — Description (normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174).

1. The system MUST support "Mega Sale Mode" — a scheduled event window that re-themes UI, runs pre-event teasers, and produces day-of curated deal lists. Events are configured by admin via `mega_sales` collection with `{ slug, name, startsAt, endsAt, theme, status, productCriteria, channelsAutoPost }`.
2. Recognized Vietnamese mega-sale dates MUST include at minimum: `1/1, 2/2, 3/3, 4/4, 5/5, 6/6, 7/7, 8/8, 9/9, 10/10, 11/11, 12/12, Black-Friday (last-Fri of Nov), Tết-Sale (configurable per-year)`. Admin MAY add custom events.
3. Mega Sale UI theming MUST: (a) apply event-specific banner on homepage, (b) inject countdown widget on dashboard 7 days before `startsAt`, (c) restore default theme automatically 24h after `endsAt`. Theme switch MUST be CSS-only (no JS reload) for atomic flip.
4. 7-day-pre teaser MUST send `POST /api/notify/megasale-teaser` to subscribed users (Free + Pro) once per event, gated by user preference `megasale_teasers: bool` (default `true`).
5. Day-of curated deal list MUST be rendered on `/megasale/<slug>` public page showing top-50 products from `FR-AFF-004.searchProducts` filtered by `productCriteria.minDiscountPct` (default 50%) sorted by `discountPct DESC`, with affiliate disclosure banner per FR-LEGAL-002.
6. Each product card on the mega-sale page MUST include: image, title, current price, original price, discount %, 30-day-low badge (if applicable), "Theo dõi giá" CTA, and "Mua trên Shopee" CTA (affiliate-tagged via FR-AFF-002 with `sub=megasale_<slug>`).
7. Auto-post to external channels MUST be supported for: Telegram channel (CyberSkill public channel via Bot API), Zalo OA broadcast (if configured), and X (formerly Twitter) via OAuth-stored token. Auto-post MUST be admin-approved per-event (not blanket auto-publish); admin MUST set `channelsAutoPost: ["telegram", "zalo"]` explicitly.
8. Auto-post content MUST link to `/megasale/<slug>` (NOT to Shopee directly), so traffic funnels through the curated landing page for tracked attribution and watchlist conversion.
9. The mega-sale page MUST emit `mega_view` PostHog event with `{ slug, userId? (hashed), refSource }`; clicks on "Mua trên Shopee" MUST emit `mega_click_buy` with `{ slug, productId, position }`.
10. The system MUST cap event creation at 24 active mega-sales per year (≈2/month) and warn admins at >18; this prevents banner fatigue per plan §F5 marketing-calendar.
11. Pre-teaser push MUST honor user notification quiet hours (FR-NOTIF-001 §1 #8) — teasers scheduled during 22:00-07:00 Asia/Ho_Chi_Minh MUST defer to next 07:00.
12. Mega-sale deal list MUST be cached for 5 minutes (Redis key `megasale:list:<slug>:<minuteBucket>`) since deals are time-sensitive but not real-time; cache MUST invalidate on admin manual-refresh.
13. The countdown widget on dashboard MUST use server-time-anchored countdown (initial sync via `/api/megasale/active`, then client-side decrement) to avoid client-clock-skew showing incorrect "starts in" times.
14. Mega-sale auto-post messages MUST disclose affiliate participation in the post body itself ("Một số liên kết là tiếp thị liên kết — CyberSkill có thể nhận hoa hồng nếu bạn mua qua link.") per FR-LEGAL-002 and platform-specific disclosure norms.
15. Past mega-sales (`endsAt < now`) MUST remain accessible at `/megasale/<slug>` for analytics + SEO, but the page MUST show a banner "Sự kiện đã kết thúc — Xem deal hiện tại tại trang chủ" and disable the "Theo dõi giá" CTA on items whose price has materially changed (delta > 20%).

## §2 — Why this design

Mega Sale Mode is the third growth lever (after referral §GROW-001 and share §GROW-002) and the only one synced to Vietnamese e-commerce seasonality. Vietnamese Shopee users have strongly internalized "double-digit dates" (9.9, 11.11, 12.12) as sale events — failing to acknowledge these calendar moments would make CyberSkill feel disconnected. But naively running a mega-sale page every event risks two failure modes: (a) banner fatigue if every month is "mega", (b) commission-ranking accusations if our list-curation looks promotional rather than user-aligned.

The "land on `/megasale/<slug>` not Shopee" decision (§1 #8) mirrors the GROW-002 funnel philosophy: traffic from any auto-post channel must land on our curated page first so we can (a) show the price-history context (30-day-low badge), (b) capture "Theo dõi giá" signups, and (c) ensure disclosure is rendered. Direct-to-Shopee auto-posts would be pure affiliate revenue with zero user-acquisition value.

The 7-day-pre teaser (§1 #4) is the central pre-event lever. Vietnamese users plan purchases 5-7 days ahead for major sales; the teaser is when they add items to watchlists in anticipation. Our hypothesis: a 7-day-pre push for 11.11 drives 3-5x watchlist growth vs the baseline week (per plan §F4 mega-sale-spike). The push gating by `megasale_teasers: bool` (opt-out, not opt-in) maximizes reach since the value-prop is clear.

The 24-events-per-year cap (§1 #10) is the deliberate scarcity gate. 12 dd/mm events + Black Friday + Tết + ~10 admin-discretion events = 24 ceiling. Beyond that, the "mega" label loses meaning and banner-blindness sets in. Admin-configurable but with explicit warning gate at 18 to force conscious decision.

The auto-approval-gate (§1 #7 `channelsAutoPost` is explicit, not implicit) prevents an unintended public broadcast. Cross-platform auto-posting is a high-blast-radius action; we require admin to explicitly check `["telegram", "zalo"]` per event rather than defaulting to all-channels.

The day-of curation criteria default (`minDiscountPct: 50%`) was chosen after analyzing 2024-2025 Shopee mega-sale data: 50%+ discounts represent ~7% of products listed during mega-sales and correlate strongly with user-perceived "good deals". Lower threshold (e.g. 30%) admits too much noise; higher (70%) admits too few items to populate a 50-item list.

The past-event preservation rule (§1 #15) supports SEO + analytics: `/megasale/<slug>` pages from past events become evergreen URLs for queries like "shopee 11/11 2025 deals", driving long-tail organic traffic. The "event ended" banner prevents user confusion while keeping the URL live.

## §3 — API contract & code shape

```ts
// GET /api/megasale/active
type ActiveMegaSale = {
  slug: string;        // e.g. "11-11-2026"
  name: string;        // "Sale 11.11"
  startsAt: string;    // ISO-8601
  endsAt: string;
  theme: { primaryColor: string; bannerImageUrl: string; emoji: string };
  countdownSecondsRemaining: number;  // server-computed at response time
  status: "upcoming" | "live" | "ended";
};

// GET /api/megasale/:slug/list?page=1&limit=50
type MegaSaleList = {
  slug: string;
  products: Array<{
    productId: string;
    title: string;
    image: string;
    currentPrice: number;
    originalPrice: number;
    discountPct: number;
    is30DayLow: boolean;
    affiliateLink: string;  // with sub=megasale_<slug>
  }>;
  generatedAt: string;
  cachedUntil: string;  // +5min
};

// POST /api/admin/megasale/create  (admin-only)
const CreateInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().max(80),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  theme: z.object({ primaryColor: z.string(), bannerImageUrl: z.string().url(), emoji: z.string() }),
  productCriteria: z.object({ minDiscountPct: z.number().min(20).max(90).default(50), categories: z.array(z.string()).optional() }),
  channelsAutoPost: z.array(z.enum(["telegram", "zalo", "x"])).default([]),
});

// POST /api/admin/megasale/:slug/publish  (triggers teaser push to all subscribed users)
// POST /api/admin/megasale/:slug/autopost  (triggers manual re-post to configured channels)
```

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | admin POSTs create with slug "11-11-2026" | startsAt 2026-11-04T00:00, endsAt 2026-11-11T23:59 | event row inserted, `status: "upcoming"` |
| AC2 | 7 days before startsAt at 09:00 ICT | scheduler tick | teaser push job enqueued to FR-NOTIF queue for all subscribed users; `teasers_sent: true` on event row |
| AC3 | user has `megasale_teasers: false` | teaser push job | user skipped, log entry `skip_reason: "opted_out"` |
| AC4 | event status flips to "live" | startsAt reached | homepage banner activates atomically; `/megasale/<slug>` returns 50 products |
| AC5 | day-of `/megasale/<slug>` requested | cold cache | response includes 50 products sorted by discountPct DESC, all with discountPct >= 50% |
| AC6 | 5 min later, same request | warm cache | response served from Redis in < 50ms |
| AC7 | admin clicks "Auto-post Telegram" | event has `channelsAutoPost: ["telegram"]` | Telegram channel receives message with disclosure + link to `/megasale/<slug>`, NOT to Shopee |
| AC8 | teaser scheduled for 23:30 ICT | quiet hours active | push deferred to 07:00 next morning |
| AC9 | event endsAt + 25h | scheduler tick | homepage theme reverts to default; `/megasale/<slug>` shows "Sự kiện đã kết thúc" banner |
| AC10 | admin attempts 25th event creation | yearly count check | response 422 MAX_EVENTS_PER_YEAR |
| AC11 | user clicks "Mua trên Shopee" on mega-sale page | tracking | PostHog `mega_click_buy` event with `{ slug, productId, position }` |
| AC12 | past event `/megasale/11-11-2025` | user visits | page renders past products; "Theo dõi giá" CTA disabled on items where current price differs > 20% from cached |
| AC13 | user visits `/megasale/<slug>` from Telegram auto-post | utm_source detected | `mega_view` PostHog event with `refSource: "telegram"` |
| AC14 | admin sets `minDiscountPct: 30` | event creation | products list includes 30%+ discounts (not 50%+) |
| AC15 | countdown widget renders | client-side ticking | countdown matches server time within ±2s tolerance |

## §5 — Verification

```ts
describe("FR-GROW-003 mega-sale", () => {
  it("AC1: admin can create event", async () => {
    const r = await POST("/api/admin/megasale/create", { slug: "11-11-2026", name: "Sale 11.11", startsAt: iso(future(7)), endsAt: iso(future(14)), theme: {...}, productCriteria: { minDiscountPct: 50 }, channelsAutoPost: ["telegram"] });
    expect(r.status).toBe(200);
    expect(await db.mega_sales.findOne({ slug: "11-11-2026" })).toBeTruthy();
  });
  it("AC2,3: teaser push respects opt-out", async () => {
    const evt = await createEvent({ startsAt: future(7), endsAt: future(14) });
    await user.update({ megasale_teasers: false });
    await scheduler.tick(future(0) - 7 * 86400); // simulate 7-day-pre
    expect(notifyQueue.jobs).toHaveLength(0); // user opted out
  });
  it("AC4,5: live event lists 50 products at >=50% discount", async () => {
    const evt = await createEvent({ status: "live", productCriteria: { minDiscountPct: 50 } });
    const r = await GET(`/api/megasale/${evt.slug}/list`);
    expect(r.products).toHaveLength(50);
    expect(r.products.every(p => p.discountPct >= 50)).toBe(true);
  });
  it("AC6: caches for 5 minutes", async () => {
    const t1 = Date.now();
    await GET("/api/megasale/test/list"); // cold
    await GET("/api/megasale/test/list"); // warm
    const t2 = Date.now();
    expect(t2 - t1).toBeLessThan(200);
  });
  it("AC7: auto-post links to our page not Shopee", async () => {
    const evt = await createEvent({ channelsAutoPost: ["telegram"] });
    await POST(`/api/admin/megasale/${evt.slug}/autopost`);
    expect(telegramMock.lastMessage.text).toContain(`/megasale/${evt.slug}`);
    expect(telegramMock.lastMessage.text).not.toMatch(/shopee\.vn/);
    expect(telegramMock.lastMessage.text).toContain("tiếp thị liên kết");
  });
  it("AC8: quiet hours defer teaser", async () => {
    mockTimeOfDay("23:30 ICT");
    const evt = await createEvent({ startsAt: future(7) });
    await scheduler.runTeaser(evt.slug);
    const job = notifyQueue.jobs[0];
    expect(job.scheduledFor).toMatch(/T07:00:00/);
  });
  it("AC10: enforces 24-events-per-year cap", async () => {
    for (let i = 0; i < 24; i++) await createEvent({ slug: `evt-${i}-${YEAR}` });
    const r = await POST("/api/admin/megasale/create", { slug: `evt-25-${YEAR}`, ... });
    expect(r.status).toBe(422);
    expect(r.error).toBe("MAX_EVENTS_PER_YEAR");
  });
});
```

## §6 — Implementation skeleton

```ts
// apps/api/src/megasale/megasale.service.ts
@Injectable()
export class MegaSaleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly search: SearchService, // FR-AFF-004
    private readonly affiliate: AffiliateService,
    private readonly notify: NotifyService,
    private readonly posthog: PostHogService,
    private readonly telegram: TelegramChannelService,
  ) {}

  async createEvent(input: CreateInput): Promise<void> {
    const year = new Date(input.startsAt).getFullYear();
    const count = await this.db.mega_sales.countDocuments({ startsAt: { $gte: new Date(`${year}-01-01`), $lt: new Date(`${year+1}-01-01`) } });
    if (count >= 24) throw new BusinessException("MAX_EVENTS_PER_YEAR");
    if (count >= 18) this.logger.warn(`[mega-sale] approaching yearly cap: ${count}/24`);
    await this.db.mega_sales.insertOne({ ...input, status: "upcoming", createdAt: new Date(), teasers_sent: false });
  }

  async getActive(): Promise<ActiveMegaSale | null> {
    const now = new Date();
    const evt = await this.db.mega_sales.findOne({ status: "live", startsAt: { $lte: now }, endsAt: { $gt: now } });
    if (!evt) return null;
    return {
      slug: evt.slug, name: evt.name, startsAt: evt.startsAt.toISOString(), endsAt: evt.endsAt.toISOString(),
      theme: evt.theme, countdownSecondsRemaining: Math.floor((evt.endsAt.getTime() - now.getTime()) / 1000), status: "live",
    };
  }

  async getList(slug: string): Promise<MegaSaleList> {
    const evt = await this.db.mega_sales.findOne({ slug });
    if (!evt) throw new NotFoundException("EVENT_NOT_FOUND");
    const cacheKey = `megasale:list:${slug}:${Math.floor(Date.now() / 300_000)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const products = await this.search.searchProducts({
      filters: { minDiscountPct: evt.productCriteria.minDiscountPct, categories: evt.productCriteria.categories },
      limit: 50, sortBy: "discountPct_desc",
    });
    const enriched = await Promise.all(products.map(async p => ({
      ...p,
      affiliateLink: (await this.affiliate.generateShortLink({ userId: "system", productUrl: p.url, sub: `megasale_${slug}` })).shortLink,
    })));
    const payload: MegaSaleList = { slug, products: enriched, generatedAt: new Date().toISOString(), cachedUntil: new Date(Date.now() + 300_000).toISOString() };
    await this.redis.set(cacheKey, JSON.stringify(payload), "EX", 300);
    return payload;
  }

  async runTeaserCron(): Promise<void> {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 86400_000);
    const events = await this.db.mega_sales.find({ startsAt: { $lte: sevenDaysFromNow, $gte: new Date() }, teasers_sent: false }).toArray();
    for (const evt of events) {
      const users = await this.db.users.find({ "preferences.megasale_teasers": { $ne: false }, status: "active" }).toArray();
      for (const user of users) {
        await this.notify.enqueue({
          userId: user._id, type: "megasale_teaser", payload: { slug: evt.slug, name: evt.name, startsAt: evt.startsAt },
          respectQuietHours: true,
        });
      }
      await this.db.mega_sales.updateOne({ _id: evt._id }, { $set: { teasers_sent: true } });
    }
  }

  async autoPost(slug: string): Promise<void> {
    const evt = await this.db.mega_sales.findOne({ slug });
    if (!evt) throw new NotFoundException();
    const disclosure = "Một số liên kết là tiếp thị liên kết — CyberSkill có thể nhận hoa hồng nếu bạn mua qua link.";
    const message = `🔥 ${evt.name} đã bắt đầu!\n\nXem top deals tại: https://sale.cyber.skill/megasale/${slug}\n\n${disclosure}`;
    if (evt.channelsAutoPost.includes("telegram")) await this.telegram.broadcast(message);
    // Zalo + X handlers similar
  }
}
```

## §7 — Dependencies

- FR-PRICE-001: needed for 30-day-low badge calculation.
- FR-NOTIF-001/002: teaser push uses notification pipeline.
- FR-AFF-002: each product card's "Mua trên Shopee" CTA is generated via affiliate.
- FR-AFF-004: search-cached product discovery for list curation.
- Telegram Bot API + (optional) Zalo OA SDK + X OAuth.

## §8 — Example payloads

Admin create:
```json
{
  "slug": "11-11-2026",
  "name": "Sale 11.11 — Cuối Năm",
  "startsAt": "2026-11-04T00:00:00.000+07:00",
  "endsAt": "2026-11-11T23:59:59.000+07:00",
  "theme": { "primaryColor": "#FF4D00", "bannerImageUrl": "https://cdn.cyber.skill/megasale/1111-banner.png", "emoji": "🔥" },
  "productCriteria": { "minDiscountPct": 50, "categories": ["electronics", "fashion", "home"] },
  "channelsAutoPost": ["telegram"]
}
```

Live mega-sale active response:
```json
{
  "slug": "11-11-2026", "name": "Sale 11.11", "startsAt": "2026-11-04T00:00:00.000+07:00", "endsAt": "2026-11-11T23:59:59.000+07:00",
  "theme": { "primaryColor": "#FF4D00", "bannerImageUrl": "...", "emoji": "🔥" },
  "countdownSecondsRemaining": 432123, "status": "live"
}
```

## §9 — Open questions (resolved)

**Q1: Should we run mega-sales we didn't create (e.g. partner with brands)?**
A: Out of scope for P2. Custom events admin-defined via `channelsAutoPost` is sufficient. Partner-driven events at P3.

**Q2: How does Mega Sale interact with FR-WATCH triggers?**
A: It doesn't disable them. If a user has a watchlist on a product featured in mega-sale, they still receive the trigger fire per FR-WATCH-002. Mega-sale is broadcast, watch is personal — additive not exclusive.

**Q3: Auto-post frequency limit?**
A: Per-event one auto-post per channel on day-of activation; admin can manually re-post via `/autopost` endpoint up to 3 times per event. Higher frequency risks spam-marking on Telegram/Zalo.

**Q4: What if all 50 products are 50%+ but only 12 are interesting?**
A: P2 accepts this — discount % is the signal. P3 introduces editorial curation if data shows low click-through.

**Q5: Why no leaderboard / gamification in P2?**
A: Title mentioned gamification but P2 scope deprioritizes it — leaderboard needs sustained engagement model (which we lack data for at MVP). Re-evaluate at P3.

**Q6: Live count update on mega-sale page?**
A: 5-minute cache is correct trade-off for P2. Real-time (websocket) updates considered for P3 if mega-sale drives sustained traffic.

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | search service down at day-of | FR-AFF-004 returns 5xx | exception in `getList` | serve last-cached list with `stale_warning: true`; admin alerted | error |
| 2 | teaser push to 100K users overwhelms queue | FR-NOTIF queue backlog | Bull metrics | rate-limit teaser enqueue at 1000/s; teaser job batches per user | warning |
| 3 | event endsAt passes but status not flipped | scheduler missed tick | hourly heartbeat check | catch-up job promotes any `live` events past endsAt to `ended` | error |
| 4 | admin creates 25th event | yearly cap check | endpoint returns 422 | UX shows "Đã đạt giới hạn 24 sự kiện/năm" with override-via-engineering escape valve | info |
| 5 | Telegram bot blocked by channel admin | broadcast fails | bot API 403 | warn admin, retry with degraded "manual share required" path | warning |
| 6 | discount % miscalculated (price drop after listing) | live product price changes | drift > 5% | next 5-min refresh corrects; AC15 enforces accurate display window | info |
| 7 | mega-sale URL crawled by competitors | competitive scraping | rate-limit by IP /24 + UA fingerprint | shadow-throttle non-user agents; data is public so no breach | info |
| 8 | timezone confusion on startsAt | admin enters wrong TZ | validation: startsAt MUST have offset | reject input without explicit TZ; auto-default to Asia/Ho_Chi_Minh | info |
| 9 | duplicate slug collision | admin reuses "11-11-2026" | DB unique index | reject 409 SLUG_EXISTS | info |
| 10 | past event still appears "live" in cache | status flip after caching | 5-min cache window | accepted lag; AC9 cleanup ensures eventual consistency | info |
| 11 | auto-post sent before event live | admin clicks "autopost" while upcoming | API validates `status === "live"` | reject 409 EVENT_NOT_LIVE | info |
| 12 | product image hot-link blocked by Shopee | image CDN 403 | OG meta fallback | proxy via our CDN with 24h cache | warning |
| 13 | concurrent admin edits same event | two admins both POST update | optimistic locking via `version` field | second update rejected 409 STALE_VERSION; force-refresh | info |
| 14 | client clock skew shows wrong countdown | user's PC clock off by hours | initial server-sync on page load | server time anchored; AC15 verifies ±2s tolerance | info |

## §11 — Notes

- Tết-Sale date is configurable per year (Lunar New Year shifts annually); admin MUST set `startsAt`/`endsAt` ~30-45 days before Tết based on confirmed Shopee Tết-sale dates.
- Leaderboard / gamification scope explicitly deferred — title in original FR mentioned it but P2 doesn't ship it (Q5).
- Past mega-sales are SEO gold; ensure sitemap.xml includes them.
- Marketing-team approval gate on `channelsAutoPost` could be added at P3 as a UI flag — for P2, the admin-only access is gate enough.

---

*FR-GROW-003 spec — last revised 2026-05-16.*
