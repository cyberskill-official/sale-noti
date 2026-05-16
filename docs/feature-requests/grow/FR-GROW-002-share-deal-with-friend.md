---
id: FR-GROW-002
title: "'Chia deal cho bạn' — copy-share user-tagged Affiliate deeplink + landing page with 'Theo dõi giá' CTA"
module: GROW
priority: MUST
status: SPEC_READY
verify: T
phase: P2
slice: 1
owner: growth-team
created: 2026-05-16
last_revised: 2026-05-16
template: engineering-spec@1
reviewers: [legal, eng-web, eng-api, eng-affiliate]
plan_anchors: ["§F2 #6", "§F4 share-virality", "ethics #4"]
depends_on: [FR-AFF-002, FR-WATCH-001, FR-AUTH-001]
blocked_by: []
unlocks: ["FR-NOTIF-001", "FR-GROW-001 (sharer often becomes referrer)"]
effort_hours: 10
---

## §1 — Description (normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174).

1. The system MUST expose endpoint `POST /api/grow/share/create` that accepts `{ productUrl: string, sourceWatchlistId?: string, channel?: "facebook"|"zalo"|"telegram"|"copy"|"x"|"other" }` and returns `{ shareId, shortLink, landingUrl, expiresAt }`.
2. `shortLink` MUST be a shortened CyberSkill domain link (`sale.cyber.skill/s/<8chars>`) that 302-redirects to `landingUrl`. The 302 path MUST NOT redirect directly to Shopee — the visitor MUST land on the public deal page first per §F4 share-virality.
3. `landingUrl` MUST point to a public page `/deal/<shareId>` on `sale.cyber.skill` that renders the deal preview (image, title, current price, ≤30-day price chart, 30-day low badge, "Theo dõi giá" CTA, affiliate disclosure banner).
4. The landing page CTA "Theo dõi giá" MUST link to `/auth/signup?ref=<sharerUserId>&seedProduct=<productUrl>` so the new user lands directly on the watchlist-create flow with the product pre-filled.
5. The system MUST internally call `FR-AFF-002.generateShortLink({ userId: sharerId, productUrl, sub: shareId })` to obtain the Shopee affiliate deeplink; the affiliate deeplink is rendered as a "Mua trên Shopee" secondary CTA on the landing page (not auto-redirected).
6. Share metadata MUST be persisted in `shares` collection: `{ shareId, sharerUserId, productUrl, sourceWatchlistId?, channel, shortLink, affiliateLink, createdAt, expiresAt (createdAt + 90d), clickCount: 0, conversionCount: 0 }`.
7. The 302 short-link handler MUST increment `clickCount` atomically (`$inc`) and record `share_clicks` row `{ shareId, ts, ip_hash (sha256+salt), ua_hash, referer_host }` for fraud detection; raw IP and UA MUST NOT be stored.
8. The landing page MUST render the affiliate disclosure banner from `FR-LEGAL-002` at the top, MUST include the Shopee logo with "via Affiliate" caption, AND MUST display the sharer's first name as "X chia sẻ cho bạn" with explicit opt-out toggle in user profile (default: opt-in to name display).
9. The system MUST cap share creation at `60 shares/user/day` and `5 shares/product/user/day` to prevent spam; rate-limit MUST return `429 RATE_LIMIT_SHARE` with `retryAfter` seconds.
10. The share MUST expire after 90 days; the short-link handler MUST 302 to a `/deal/expired?productUrl=<x>` page after expiry, NOT to a 404.
11. When `conversionCount` reaches 1 (first new signup via this share's CTA), the system MUST emit growth event `share_converted` to PostHog with properties `{ shareId, sharerUserId (hashed), channel, ttc_seconds }` for funnel analysis.
12. The "X shared this deal" attribution MUST be controlled by per-user privacy setting `displaySharerName` (default `true`). When `false`, landing page shows "Một người dùng CyberSkill đã chia sẻ deal này".
13. The landing page MUST render structured data (OpenGraph + Twitter Card) for rich previews on Facebook/Zalo/Telegram: `og:title`, `og:description` (incl. current price and 30-day low), `og:image` (Shopee product image), `og:url` (the `sale.cyber.skill/s/<8>` link).
14. The system MUST detect bot user-agents (Googlebot, Facebot, TelegramBot, ZaloBot, twitterbot, slackbot) on the 302 handler and serve the OpenGraph-only HTML response WITHOUT redirect, so social previews work without inflating `clickCount`.
15. Share creation MUST be free for Free tier (capped at 60/day per §1 #9); no Pro upgrade required — share is a growth lever, gating it would defeat the purpose per plan §F2 #6.

## §2 — Why this design

The "Chia deal cho bạn" feature is the second of three growth viral loops (after referral §GROW-001 and before Mega Sale §GROW-003). It exploits a behavior already common on Vietnamese Shopee culture: users screenshot deals and paste into Zalo group chats. We intercept that copy-paste flow at the moment of generosity (sharing) and convert friction-free into (a) affiliate revenue when friends buy, and (b) new signups when friends want to track the same product.

The "land on our deal page, not Shopee directly" decision (§1 #2 and #3) is the central design choice. Direct-to-Shopee shares give us nothing — we earn affiliate but cannot convert the visitor to a tracked-user. Landing them on `/deal/<shareId>` gives us the chart, the disclosure banner, AND the "Theo dõi giá" hook. ~30% of click-throughs are predicted to start a watchlist (per plan §F4 model assumption).

The 90-day TTL (§1 #10) balances three concerns: (a) most deal links lose relevance within weeks as prices change, so stale links serve no one; (b) keeping inactive `shares` rows forever bloats the collection; (c) 90 days is enough for "I saved this in Zalo" rediscovery. After 90 days, the `/deal/expired` page still recovers value by offering "Theo dõi giá" CTA on the underlying product.

The bot-detection short-circuit (§1 #14) was added in round-2 because the first version inflated `clickCount` every time a share got pasted into Facebook/Zalo (the platform's preview crawler hits the link). This made conversion-rate metrics meaningless. Bot-detection routes social crawlers to an OpenGraph-only response that doesn't count as a click.

The opt-in-by-default sharer-name display (§1 #12) is a deliberate ethical choice. Vietnamese sharers commonly want credit ("look, I found this deal first") — making it opt-in by default would lose 80% of the social proof. But the explicit opt-out toggle protects users who'd prefer anonymity (corporate accounts, privacy-conscious users). The toggle is surfaced in profile settings AND on the first share-create modal as "Hiển thị tên bạn cho bạn bè khi chia sẻ?" with both choices visible.

The dual-CTA pattern on the landing page ("Theo dõi giá" primary, "Mua trên Shopee" secondary, §1 #4/#5) reflects our growth-over-affiliate priority. If we made "Mua trên Shopee" the primary, the visitor would leave for Shopee and we'd never see them again — affiliate revenue, but zero CAC reduction. By making "Theo dõi giá" primary, we accept lower per-share affiliate yield in exchange for a much-higher signup conversion rate, which compounds.

## §3 — API contract & code shape

```ts
// POST /api/grow/share/create
const ShareCreateInput = z.object({
  productUrl: z.string().url().regex(/shopee\.vn/),
  sourceWatchlistId: z.string().optional(),
  channel: z.enum(["facebook", "zalo", "telegram", "copy", "x", "other"]).default("copy"),
});

type ShareCreateOutput = {
  shareId: string;
  shortLink: string;       // https://sale.cyber.skill/s/<8>
  landingUrl: string;      // https://sale.cyber.skill/deal/<shareId>
  affiliateLink: string;   // shopee.vn/... (preview, primary use is on landing page)
  expiresAt: string;       // ISO-8601, +90d
};

// GET /s/:short → 302 to /deal/:shareId (or 200 OG-only for bots)
// GET /deal/:shareId → public HTML page with chart + CTA + disclosure
```

Error responses:

| code | http | reason |
|---|---|---|
| `INVALID_PRODUCT_URL` | 422 | Not a Shopee URL |
| `RATE_LIMIT_SHARE` | 429 | 60/day or 5/product/day cap hit |
| `AFFILIATE_LINK_FAILED` | 502 | FR-AFF-002 dependency failed; share created with `affiliateLink: null` and warning surfaced |
| `SHARE_EXPIRED` | 410 | Visit to expired shareId via direct landing URL |
| `SHARE_NOT_FOUND` | 404 | shareId not in DB |

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | authenticated user (Free) | POSTs `/api/grow/share/create` with valid Shopee URL | response 200, `shortLink` matches `^https://sale\.cyber\.skill/s/[a-zA-Z0-9_-]{8}$` |
| AC2 | user has reached 60-share daily cap | POSTs `/api/grow/share/create` | response 429 RATE_LIMIT_SHARE with `retryAfter` |
| AC3 | user shares same product 5 times today | 6th POST for same productUrl | response 429 RATE_LIMIT_SHARE |
| AC4 | share created with channel=zalo | visitor opens `https://sale.cyber.skill/s/<8>` from Zalo | 302 to `/deal/<shareId>`, `clickCount` incremented to 1 |
| AC5 | TelegramBot user-agent | hits `/s/<8>` | 200 HTML with OpenGraph meta tags, `clickCount` NOT incremented |
| AC6 | landing page visit | user clicks "Theo dõi giá" CTA | navigates to `/auth/signup?ref=<sharerId>&seedProduct=<encodedUrl>` |
| AC7 | new user signs up via share's referral param | completes signup + verifies email | share's `conversionCount` += 1, PostHog `share_converted` event emitted |
| AC8 | share created with `displaySharerName: false` | visitor lands on `/deal/<shareId>` | page header shows "Một người dùng CyberSkill đã chia sẻ deal này" |
| AC9 | share is 91 days old | visitor opens `/s/<8>` | 302 to `/deal/expired?productUrl=<x>`, landing offers "Theo dõi giá" CTA |
| AC10 | share's affiliate dependency fails | POST create | share row created with `affiliateLink: null`, response 200 with `affiliateLink: null` and `warning: "AFFILIATE_LINK_DEFERRED"` |
| AC11 | landing page rendered | Facebook crawler hits | `og:image`, `og:title`, `og:description`, `og:url` all present and valid; preview loads on Facebook |
| AC12 | affiliate disclosure banner | landing page render | banner from FR-LEGAL-002 at top, "Mua trên Shopee" CTA labeled "via Affiliate" |
| AC13 | sourceWatchlistId provided | share create | `shares.sourceWatchlistId` stored; analytics can attribute share to existing watch |
| AC14 | rate-limit window | 25h after first share of day | counter resets, user can share 60 more |

## §5 — Verification

```ts
describe("FR-GROW-002 share-deal", () => {
  it("AC1: creates short link and landing URL", async () => {
    const r = await POST("/api/grow/share/create", { productUrl: "https://shopee.vn/abc-i.123.456" });
    expect(r.shortLink).toMatch(/^https:\/\/sale\.cyber\.skill\/s\/[\w-]{8}$/);
    expect(r.landingUrl).toMatch(/\/deal\//);
  });
  it("AC2,3: enforces rate limit", async () => {
    for (let i = 0; i < 60; i++) await POST("/api/grow/share/create", { productUrl: urls[i] });
    const r = await POST("/api/grow/share/create", { productUrl: "https://shopee.vn/x-i.1.1" });
    expect(r.status).toBe(429);
  });
  it("AC4: 302 increments clickCount for non-bot UA", async () => {
    const { shareId, shortLink } = await createShare();
    await fetch(shortLink, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    const share = await db.shares.findOne({ shareId });
    expect(share.clickCount).toBe(1);
  });
  it("AC5: TelegramBot gets OG-only without click increment", async () => {
    const { shareId, shortLink } = await createShare();
    const resp = await fetch(shortLink, { headers: { "User-Agent": "TelegramBot (like TwitterBot)" } });
    expect(resp.status).toBe(200);
    const share = await db.shares.findOne({ shareId });
    expect(share.clickCount).toBe(0);
  });
  it("AC7: conversion attribution", async () => {
    const { shareId } = await createShare({ sharerId: "u1" });
    await signupNewUser({ ref: "u1", seedProduct: "https://shopee.vn/..." });
    const share = await db.shares.findOne({ shareId });
    expect(share.conversionCount).toBe(1);
    expect(posthog.events).toContainEqual(expect.objectContaining({ event: "share_converted" }));
  });
  it("AC9: expired share redirects to /deal/expired", async () => {
    const { shortLink } = await createShare({ createdAt: daysAgo(91) });
    const resp = await fetch(shortLink, { redirect: "manual" });
    expect(resp.headers.get("location")).toMatch(/\/deal\/expired/);
  });
  it("AC10: affiliate failure does not block share creation", async () => {
    mockAffiliate.fail();
    const r = await POST("/api/grow/share/create", { productUrl: "https://shopee.vn/abc-i.1.1" });
    expect(r.affiliateLink).toBeNull();
    expect(r.warning).toBe("AFFILIATE_LINK_DEFERRED");
  });
});
```

## §6 — Implementation skeleton

```ts
// apps/api/src/growth/share.service.ts
@Injectable()
export class ShareService {
  constructor(
    private readonly affiliate: AffiliateService,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly posthog: PostHogService,
  ) {}

  async createShare(userId: string, input: ShareCreateInput): Promise<ShareCreateOutput> {
    await this._enforceRateLimit(userId, input.productUrl);

    const shareId = nanoid(12);
    const shortCode = nanoid(8);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    // Fire-and-forget affiliate link (don't block share creation)
    let affiliateLink: string | null = null;
    try {
      const aff = await this.affiliate.generateShortLink({ userId, productUrl: input.productUrl, sub: shareId });
      affiliateLink = aff.shortLink;
    } catch (e) {
      this.logger.warn(`AFFILIATE_LINK_DEFERRED for share ${shareId}: ${e.message}`);
    }

    await this.db.shares.insertOne({
      shareId, shortCode, sharerUserId: userId, productUrl: input.productUrl,
      sourceWatchlistId: input.sourceWatchlistId, channel: input.channel,
      affiliateLink, createdAt: new Date(), expiresAt, clickCount: 0, conversionCount: 0,
    });

    return {
      shareId,
      shortLink: `https://sale.cyber.skill/s/${shortCode}`,
      landingUrl: `https://sale.cyber.skill/deal/${shareId}`,
      affiliateLink: affiliateLink ?? null,
      expiresAt: expiresAt.toISOString(),
      ...(affiliateLink === null && { warning: "AFFILIATE_LINK_DEFERRED" }),
    };
  }

  private async _enforceRateLimit(userId: string, productUrl: string): Promise<void> {
    const dailyKey = `share:daily:${userId}:${dayBucket()}`;
    const productKey = `share:product:${userId}:${hash(productUrl)}:${dayBucket()}`;
    const daily = await this.redis.incr(dailyKey);
    await this.redis.expire(dailyKey, 86400);
    if (daily > 60) throw new RateLimitException("RATE_LIMIT_SHARE", { retryAfter: secondsUntilMidnight() });
    const perProduct = await this.redis.incr(productKey);
    await this.redis.expire(productKey, 86400);
    if (perProduct > 5) throw new RateLimitException("RATE_LIMIT_SHARE", { retryAfter: secondsUntilMidnight() });
  }

  // 302 handler — invoked by edge worker or Next.js route handler
  async handleShortLinkClick(shortCode: string, ua: string, ip: string, referer?: string) {
    const share = await this.db.shares.findOne({ shortCode });
    if (!share) return { status: 404 };
    if (share.expiresAt < new Date()) {
      return { status: 302, location: `/deal/expired?productUrl=${encodeURIComponent(share.productUrl)}` };
    }
    if (isBotUserAgent(ua)) {
      return { status: 200, body: renderOpenGraphOnly(share) };
    }
    await this.db.shares.updateOne({ shortCode }, { $inc: { clickCount: 1 } });
    await this.db.share_clicks.insertOne({
      shareId: share.shareId, ts: new Date(),
      ip_hash: sha256(ip + process.env.IP_SALT).slice(0, 16),
      ua_hash: sha256(ua + process.env.UA_SALT).slice(0, 12),
      referer_host: referer ? new URL(referer).hostname : null,
    });
    return { status: 302, location: `/deal/${share.shareId}` };
  }

  async onShareConvert(shareId: string, newUserId: string): Promise<void> {
    const share = await this.db.shares.findOne({ shareId });
    if (!share || share.conversionCount > 0) return; // first conversion only emits event
    await this.db.shares.updateOne({ shareId }, { $inc: { conversionCount: 1 } });
    this.posthog.capture("share_converted", {
      shareId, sharerHash: sha256(share.sharerUserId).slice(0, 12),
      channel: share.channel, ttc_seconds: (Date.now() - share.createdAt.getTime()) / 1000,
    });
  }
}

function isBotUserAgent(ua: string): boolean {
  return /Googlebot|facebookexternalhit|Twitterbot|TelegramBot|ZaloBot|Slackbot|LinkedInBot/i.test(ua);
}
```

## §7 — Dependencies

- FR-AFF-002 (generateShortLink) — non-blocking; share creation succeeds even if affiliate API is down (§1 fall-back path).
- FR-WATCH-001 — `sourceWatchlistId` is optional but enables share-from-watchlist UX.
- FR-AUTH-001 — `ref` param on `/auth/signup` is consumed by the signup flow.
- FR-LEGAL-002 — disclosure banner is rendered on every landing page.

## §8 — Example payloads

Request:
```json
{ "productUrl": "https://shopee.vn/iPhone-15-Pro-Max-i.123.45678", "channel": "zalo", "sourceWatchlistId": "wl_abc123" }
```

Response:
```json
{
  "shareId": "shr_8f2k9d3pqr1z",
  "shortLink": "https://sale.cyber.skill/s/AbCdEf12",
  "landingUrl": "https://sale.cyber.skill/deal/shr_8f2k9d3pqr1z",
  "affiliateLink": "https://shopee.vn/...?affiliate=...",
  "expiresAt": "2026-08-14T07:23:18.000Z"
}
```

## §9 — Open questions (resolved)

**Q1: Should "X shared this deal" be opt-in or opt-out?**
A: Opt-in by default (display sharer name), explicit opt-out toggle. Vietnamese sharers value social credit; defaulting to anonymous would lose ~80% of the social-proof signal.

**Q2: Should we direct-redirect to Shopee for some channels (e.g. Telegram inline)?**
A: No. Direct redirect kills the conversion funnel. All channels go through the landing page. If users want a direct-Shopee link, they can use the affiliate link separately (the share-create response already returns it).

**Q3: Why 90-day expiry?**
A: Most deal links lose relevance within ~30 days; 90 days covers "I saved this in Zalo" rediscovery. After expiry, `/deal/expired` still recovers value by surfacing "Theo dõi giá" on the underlying product (which may be tracked under a different watchlist).

**Q4: What if a sharer is banned/disabled?**
A: Landing page falls back to anonymous "Một người dùng CyberSkill đã chia sẻ deal này" and the affiliate link still works (revenue is independent of sharer state).

**Q5: Should we rate-limit by source watchlist?**
A: No — already covered by 5/product/user/day. Per-watchlist limit would over-restrict legitimate sharing of multi-product watchlists.

**Q6: Why count clicks but not skip-bot conversions?**
A: Conversion = email-verified signup, which a bot cannot fake. So conversion is intrinsically bot-resistant. Click counts inflate from bots, so we must filter at click time.

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | affiliate API down | FR-AFF-002 returns 5xx | exception in `createShare` try/catch | share created with `affiliateLink: null`; landing page hides "Mua trên Shopee" CTA | warning |
| 2 | rate-limit DDOS | bot creates 1000s of shares | redis daily counter at 60 | 429 RATE_LIMIT_SHARE | error if Pro user; warning if Free (expected behavior) |
| 3 | OG image fetch fails | Shopee image URL 404 | image proxy responds 502 | fallback to CyberSkill default OG image | info |
| 4 | bot user-agent spoofs human | Selenium with Chrome UA | ip_hash repeats > 10 times/day for same shareId | shadow-rate-limit by ip_hash; flag in `fraud_clicks` | warning |
| 5 | expired share visited via direct landingUrl | user pastes /deal/<shareId> after 90d | DB row `expiresAt < now` | render `/deal/expired` page with "Theo dõi giá" CTA | info |
| 6 | sharer deletes account | sharer requests data deletion | `sharerUserId` in deleted users | render anonymous; affiliate link still functional | info |
| 7 | productUrl 404s | Shopee removed product | OG fetch returns 404 | landing page shows "Sản phẩm đã hết hàng — Theo dõi sản phẩm tương tự" | info |
| 8 | conversion event lost | PostHog ingestion outage | event queue overflow | event written to local fallback queue; replayed when PostHog recovers | warning |
| 9 | Free user hits 60 cap | legitimate heavy sharer | 429 response | UX shows "Hôm nay bạn đã chia sẻ tối đa — quay lại sau X giờ"; encourages Pro upgrade (no per-day cap on Pro? — see Q5) | info |
| 10 | malformed Shopee URL | user pastes Lazada link | regex `/shopee\.vn/` fails | 422 INVALID_PRODUCT_URL | info |
| 11 | shortCode collision | nanoid(8) collides (~1 in 218T) | DB unique index violation | retry with new nanoid; emit `share_collision` metric | info |
| 12 | sharer's name contains XSS | name="<script>" injected via profile | HTML render unescaped | landing template uses `{{ name | escape }}` per Edge/React policy | error if present, else info |
| 13 | conversion attribution race | new user signs up in same TX as another share | two `share_converted` events for one signup | per-shareId increment is atomic; PostHog dedup by `(shareId, newUserId)` | info |

## §11 — Notes

- Pro tier consideration (Q5 deferred): consider relaxing 60/day cap to 200/day for Pro users as a perk; revisit at P3 with usage data.
- Mobile share-sheet integration (native iOS/Android share API) is a P3 enhancement — out of scope for P2.
- Watch for "share spam" pattern in fraud telemetry: same ip_hash creating multiple shares with rapid succession should auto-pause the user pending review.

---

*FR-GROW-002 spec — last revised 2026-05-16.*
