---
id: FR-AFF-004
title: "`productSearch` resolver with 5-min Redis cache + per-user rate-limit + PII keyword redaction + XSS strip"
module: AFF
priority: SHOULD
status: done
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: Senior Tech Lead
created: 2026-05-16
related_frs: [FR-AFF-001, FR-AFF-003, FR-GROW-003, FR-WATCH-001, FR-LEGAL-002]
depends_on: [FR-AFF-001]
blocks: [FR-GROW-003]
effort_hours: 4

new_files:
  - apps/api/src/affiliate/product-search.service.ts
  - apps/api/src/affiliate/product-search.controller.ts
  - apps/api/src/affiliate/__tests__/product-search.spec.ts
modified_files: []
allowed_tools:
  - "file_read/write apps/api/**"
  - "bash pnpm test"
disallowed_tools:
  - "expose unbounded productSearch to anonymous users (Shopee rate-budget protection)"
  - "rank or order by `commissionRate` (FR-LEGAL-002 §1 #10)"
  - "cache productSearch results > 10 minutes (prices change too fast during flash sales)"
  - "return raw HTML from Shopee productName (XSS risk if Shopee response is malicious)"
  - "send raw keyword to PostHog when it matches PII shape (email, phone, CCCD)"
risk_if_skipped: "Mega Sale Mode UI (FR-GROW-003) and the public deal page need a search surface so users can discover products without pasting URLs. Without productSearch, all discovery is paste-URL-only — a fragile UX that throttles user acquisition. SEO content drive on `/megasale/<slug>` (plan §F2 #5) depends on this for cross-linking related deals."
---

## §1 — Description (BCP-14 normative)

The product-search service MUST expose a paginated, Redis-cached search wrapper around Shopee `productSearch` with mandatory keyword redaction + XSS stripping + per-user rate limiting + commission-rate ranking firewall.

1. **MUST** expose `search(input: { keyword: string, pageNumber?: number, pageSize?: number, sort?: Sort }): Promise<SearchResult>` calling `ShopeeAffiliateClient.productSearch(...)` (FR-AFF-001).
2. **MUST** cache results per `(keyword, pageNumber, pageSize, sort)` for **5 minutes** in Redis at key `product_search:<sha256(keyword|page|size|sort).slice(0, 16)>`. Cache miss → Shopee API hit. Cache hit → return cached payload directly with `cached: true` flag.
3. **MUST NOT** cache for more than **10 minutes**. Flash-sale prices change within a single 30-min window (FR-WORKER-002 §1 #1 hot tier); 5 min is the floor for serving fresh prices, 10 min the absolute ceiling above which user experience degrades.
4. **MUST** enforce per-authenticated-user rate limit of **30 search calls/minute/userId** via Redis token bucket (key `rl:search:<userId>:<minute>`). Anonymous users (no `X-User-Id` header) limited to **10 calls/minute/IP** via the same Redis token-bucket pattern keyed on the IP `/24` prefix (per FR-OBS-001 §1 #5 PII-redaction conventions).
5. **MUST NOT** sort or rank results by `commissionRate`. The default sort is Shopee's `RELEVANCY` (delegates to Shopee's internal ranking signals: sales, recency, ratings). Optional sort params accepted from the user are exactly `RELEVANCY | PRICE_ASC | PRICE_DESC | SALES_DESC` — a closed enum. Adding `COMMISSION_DESC` or similar would require a new FR AND a Transparency Report disclosure of the ranking change.
6. **MUST** emit PostHog event `product_search` per call with `{ keyword, results: <count>, pageNumber, pageSize, sort, cached, userIdHash, latency_ms }`. Keyword is scrubbed per §1 #7 before emission.
7. **MUST** scrub keyword for PII before logging to PostHog. Regex `/[@]/` triggers replacement with literal `"[redacted-email]"`. Regex `/^(\+?84|0)\d{9,10}$/` (Vietnamese phone) triggers `"[redacted-phone]"`. Regex `/^\d{9,12}$/` matching CCCD/CMND format AND length triggers `"[redacted-id]"`. Otherwise keyword is truncated to first 60 characters (preserve analytic value without unbounded cardinality).
8. **MUST** return at most 20 results per page. Caller-provided `pageSize > 20` → HTTP 400 with `error: "invalid_pageSize"`. The 20-item cap matches FR-GROW-003 §1 #6 leaderboard 50-item limit divided across pagination.
9. **MUST** strip HTML and script content from every `productName` and `category` field in the response before persistence or return-to-client. Helper `stripHtml(s)` removes `<[^>]*>` patterns. Defense against stored XSS if Shopee's API returns malicious content (low probability but non-zero — Shopee's seller-input fields are user-supplied).
10. **MUST** complete cache-hit search in p95 < 50 ms (single Redis GET + JSON parse); cache-miss < 900 ms (Shopee API ~600-800ms + parse + cache set + observability).
11. **MUST** mark items that already have an `affiliate_links` row for the requesting user with `affiliateLinkUrl: <shortUrl>` in the response so the FE renders the existing deeplink without an extra deeplink round-trip. When no link exists, return `affiliateLinkUrl: null`.
12. **MUST** validate keyword length: minimum 1 char (after `trim()`), maximum 200 chars. Empty keyword after trim → 400 `invalid_keyword`.
13. **MUST** validate pagination: `pageNumber` minimum 1, maximum 50 (we don't surface deep-pagination as Shopee's API quality degrades past page 10 anyway).

---

## §2 — Why this design

**Why 5-minute cache (not 1-minute or 60-minute):** the cache is a budget protection layer between user search activity and Shopee's 1000 req/min API ceiling (FR-WORKER-002 §2). At 1000 active users × 5 searches each in a minute = 5K calls/min uncached, which would burst the ceiling. At 5-min cache hit rate ~80% (typical for a search surface where users refine the same keyword 3-4 times during a session) → 1K calls/min effective, which fits inside the budget alongside the scheduler's price-check workload. 1-minute cache would over-protect freshness at the cost of API budget; 60-minute would mean flash-sale price changes don't surface for an hour, which directly contradicts plan §F3 Mega Sale UX.

**Why default `RELEVANCY` sort (not `PRICE_ASC` or `SALES_DESC`):** Shopee's RELEVANCY uses their internal signals (recent sales velocity, recency, ratings, seller score). Aligning with that gives users the "Shopee experience" they expect rather than presenting our own opinionated ranking. PRICE_ASC would bias toward extremely cheap items (counterfeits, low-quality), SALES_DESC biases toward the established big sellers (Shopee Mall). RELEVANCY balances both. Commission-rate ranking is explicitly forbidden (FR-LEGAL-002 §1 #10).

**Why redact email-like and phone-like keywords:** users occasionally paste accidentally (copy from another form, autofill leak, etc.). PostHog event store has a 12-month retention (FR-OBS-001 §1 #13); leaking raw email/phone into that store is a PDPL Decree 13 Art. 24 incident waiting to happen. Server-side scrub before send is cheap and bulletproof.

**Why max 20 results per page:** keeps response payload bounded (~5KB at 20 items × 250 bytes/item), fits the FE pagination pattern (FR-GROW-003 leaderboard top-50 = 2.5 pages), and aligns with Shopee's own pagination defaults. 50-100 would force the client to scroll horizontally; 5-10 would force too many round-trips.

**Why XSS strip on productName/category:** Shopee's seller-input fields (product names, descriptions) are user-supplied. While Shopee themselves likely sanitize, defense in depth is cheap (one regex helper). If a malicious seller injects `<script>alert(1)</script>` into a product name and our `/megasale/<slug>` SSR rendering renders it without escaping (or our React renders it via `dangerouslySetInnerHTML`), we have an XSS hole. The strip happens at the resolver layer so all downstream consumers (deal page, megasale page, share preview) inherit the protection.

**Why pre-populated `affiliateLinkUrl` per row:** FR-EXT-001 + FR-NOTIF-001 + FR-GROW-002 all call `DeeplinkService.generate()` for the same user-product combination. If the user has searched for a product they already track, we already minted a deeplink for them; surfacing it inline saves a deeplink round-trip on click (saves ~400 ms cache-miss latency on average).

**Why 30 search/min/user + 10/min/IP for anonymous:** authenticated users may explore a category (5-10 searches in a minute is normal). 30/min covers heavy use without blocking legitimate behavior. Anonymous users searching is bot-like at scale; 10/min is generous for human exploration but cuts off scraping (which would burst toward our Shopee budget anyway).

---

## §3 — API contract & code shape

### `GET /v1/products/search`

```http
GET /v1/products/search?q=áo+thun&page=1&size=10&sort=RELEVANCY HTTP/1.1
Authorization: Bearer <jwt>
X-User-Id: 65f7a2b3c4d5e6f7a8b9c0d2
```

Success:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "items": [
    {
      "shopId": "123456",
      "itemId": "9876543210",
      "productName": "Áo thun nam basic",
      "currentPrice": 89000,
      "originalPrice": 129000,
      "imageUrl": "https://cf.shopee.vn/file/...",
      "sales": 1247,
      "affiliateLinkUrl": "https://shope.ee/AbCdEf"
    }
  ],
  "count": 10,
  "pageNumber": 1,
  "pageSize": 10,
  "cached": false
}
```

Errors:

| Status | Body shape | When |
|---|---|---|
| 400 | `{ "ok": false, "error": "invalid_keyword" }` | empty after trim |
| 400 | `{ "ok": false, "error": "invalid_pageSize" }` | pageSize > 20 |
| 400 | `{ "ok": false, "error": "validation_failed", "issues": [...] }` | zod parse |
| 429 | `{ "ok": false, "error": "rate_limit", "retryAfter": 60 }` | rate limit exceeded |
| 503 | `{ "ok": false, "error": "service_unavailable" }` | Shopee breaker open |

### Service skeleton

```ts
// apps/api/src/affiliate/product-search.service.ts
@Injectable()
export class ProductSearchService {
  constructor(
    private readonly shopee: ShopeeAffiliateClient,
    @Inject("OBS_POSTHOG") private readonly posthog: any
  ) {}

  async search(input: SearchInput, ctx: { userIdHash?: string; userIdRaw?: string }): Promise<SearchResult> {
    const t0 = Date.now();
    const keyword = input.keyword.trim();
    if (!keyword) throw new BadRequestException({ error: "invalid_keyword" });
    if (keyword.length > 200) throw new BadRequestException({ error: "keyword_too_long" });
    if (input.pageSize !== undefined && (input.pageSize < 1 || input.pageSize > 20))
      throw new BadRequestException({ error: "invalid_pageSize" });

    const pageNumber = input.pageNumber ?? 1;
    const pageSize = Math.min(input.pageSize ?? 10, 20);
    const sort = input.sort ?? "RELEVANCY";

    const cacheKey = `product_search:${sha256(`${keyword}|${pageNumber}|${pageSize}|${sort}`).slice(0, 16)}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as SearchResult;
      const out = { ...parsed, cached: true };
      this.observe(t0, keyword, out, ctx.userIdHash);
      return out;
    }

    const res = await this.shopee.productSearch({ keyword, pageNumber, pageSize, sort });
    const items: SearchResultItem[] = res.nodes.map((n) => ({
      shopId: n.shopId,
      itemId: n.itemId,
      productName: stripHtml(n.productName),
      currentPrice: Math.round(Number(n.priceMin)),
      originalPrice: Math.round(Number(n.priceMax >= n.priceMin ? n.priceMax : n.priceMin)),
      imageUrl: n.imageUrl ?? null,
      sales: Number(n.sales ?? 0),
      affiliateLinkUrl: null,
    }));

    // Enrich with existing deeplink for authenticated user.
    if (ctx.userIdRaw) {
      const productIds = items.map((i) => `${i.shopId}-${i.itemId}`);
      const links = await mongo.db("salenoti").collection("affiliate_links")
        .find({ userId: this.toObjectId(ctx.userIdRaw), productId: { $in: productIds } })
        .sort({ createdAt: -1 })
        .toArray();
      const byProduct = new Map<string, string>();
      for (const l of links) if (!byProduct.has(l.productId)) byProduct.set(l.productId, l.shortUrl);
      for (const i of items) {
        const k = `${i.shopId}-${i.itemId}`;
        if (byProduct.has(k)) i.affiliateLinkUrl = byProduct.get(k)!;
      }
    }

    const out: SearchResult = { items, count: items.length, pageNumber, pageSize, cached: false };
    await redis.setex(cacheKey, 300, JSON.stringify(out));
    this.observe(t0, keyword, out, ctx.userIdHash);
    return out;
  }

  private observe(t0: number, keyword: string, out: SearchResult, userIdHash?: string) {
    this.posthog.capture("product_search", {
      keyword: scrubKeyword(keyword),
      results: out.count,
      pageNumber: out.pageNumber,
      pageSize: out.pageSize,
      cached: out.cached,
      userIdHash,
      latency_ms: Date.now() - t0,
    });
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function scrubKeyword(kw: string): string {
  if (/@/.test(kw)) return "[redacted-email]";
  if (/^(\+?84|0)\d{9,10}$/.test(kw)) return "[redacted-phone]";
  if (/^\d{9,12}$/.test(kw)) return "[redacted-id]";
  return kw.slice(0, 60);
}
```

---

## §4 — Acceptance criteria

1. `GET /v1/products/search?q=áo thun` returns up to 10 items with `cached: false`.
2. Same search within 5 min → response `cached: true`, no Shopee API call observed.
3. After 5 min + 1s → cache expired, next call hits Shopee, `cached: false`.
4. 31st search in 60s by same authenticated user → 429 with `retryAfter: 60`.
5. Anonymous user 11th search/min → 429.
6. `pageSize=50` → 400 `invalid_pageSize`.
7. Empty keyword (`q=`  or whitespace-only) → 400 `invalid_keyword`.
8. Keyword > 200 chars → 400 `keyword_too_long`.
9. Default sort is `RELEVANCY` when sort param absent.
10. Search with malicious `<script>alert(1)</script>OK` in productName fixture → response `productName` is `"OK"` (script stripped).
11. Email-like keyword (`u@example.com xanh`) → PostHog event property `keyword: "[redacted-email]"`.
12. Phone-like keyword (`0901234567`) → PostHog event `keyword: "[redacted-phone]"`.
13. CCCD-like keyword (`012345678901`) → PostHog event `keyword: "[redacted-id]"`.
14. Normal keyword `"áo thun nam basic giảm giá"` (35 chars) → PostHog event `keyword` matches exactly (under 60-char limit).
15. Grep CI: `grep -RE 'ORDER BY.*commission|sortBy.*commission|sort.*commissionRate' apps/api/src/affiliate/product-search.*` returns ZERO hits.
16. Cache-hit p95 < 50 ms.
17. Authenticated user with existing watchlist on item → response includes `affiliateLinkUrl: "https://shope.ee/..."` for that row.
18. Authenticated user without watchlist → `affiliateLinkUrl: null`.

---

## §5 — Verification

```ts
// apps/api/src/affiliate/__tests__/product-search.spec.ts
describe("FR-AFF-004 — ProductSearchService", () => {
  it("AC1+2: cache hit on second call", async () => {
    mockShopeeSearch([{ productName: "Áo thun", priceMin: 89_000, priceMax: 129_000 }]);
    const before = shopeeCallCount();
    const r1 = await search.search({ keyword: "test", pageNumber: 1 }, {});
    const r2 = await search.search({ keyword: "test", pageNumber: 1 }, {});
    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(true);
    expect(shopeeCallCount() - before).toBe(1);
  });

  it("AC4: 31st auth call/min → 429", async () => {
    for (let i = 0; i < 30; i++) await api.get(`/v1/products/search?q=test${i}`).headers({ "X-User-Id": "u1" });
    const r = await api.get("/v1/products/search?q=overflow").headers({ "X-User-Id": "u1" });
    expect(r.status).toBe(429);
  });

  it("AC5: 11th anon call/min → 429", async () => {
    for (let i = 0; i < 10; i++) await api.get(`/v1/products/search?q=anon${i}`); // no X-User-Id
    const r = await api.get("/v1/products/search?q=overflow");
    expect(r.status).toBe(429);
  });

  it("AC6+7+8: pagination + keyword validation", async () => {
    expect((await api.get("/v1/products/search?q=x&size=50")).status).toBe(400);
    expect((await api.get("/v1/products/search?q=")).status).toBe(400);
    const long = "a".repeat(201);
    expect((await api.get(`/v1/products/search?q=${long}`)).status).toBe(400);
  });

  it("AC10: XSS payload in productName is stripped", async () => {
    mockShopeeSearch([{ productName: "<script>alert(1)</script>OK", priceMin: 100, priceMax: 100 }]);
    const r = await search.search({ keyword: "x" }, {});
    expect(r.items[0].productName).toBe("OK");
  });

  it("AC11+12+13+14: PII keyword redaction", async () => {
    const events = capturePostHog();
    await search.search({ keyword: "u@example.com áo" }, {});
    await search.search({ keyword: "0901234567" }, {});
    await search.search({ keyword: "012345678901" }, {});
    await search.search({ keyword: "áo thun nam basic giảm giá" }, {});
    const captures = events.filter((e) => e.event === "product_search");
    expect(captures[0].properties.keyword).toBe("[redacted-email]");
    expect(captures[1].properties.keyword).toBe("[redacted-phone]");
    expect(captures[2].properties.keyword).toBe("[redacted-id]");
    expect(captures[3].properties.keyword).toBe("áo thun nam basic giảm giá");
  });

  it("AC15: grep CI — no commissionRate ranking in search code", () => {
    const f = fs.readFileSync("apps/api/src/affiliate/product-search.service.ts", "utf8");
    expect(f).not.toMatch(/ORDER BY[\s\S]*commission/i);
    expect(f).not.toMatch(/sortBy.*commission/i);
    expect(f).not.toMatch(/sort.*commissionRate/i);
  });

  it("AC17: existing affiliate link surfaced inline", async () => {
    await mongo.db("salenoti").collection("affiliate_links").insertOne({
      userId: new ObjectId(userIdA), productId: "1-1",
      shortUrl: "https://shope.ee/EXISTING", createdAt: new Date(),
    });
    mockShopeeSearch([{ shopId: "1", itemId: "1", priceMin: 100, priceMax: 100 }]);
    const r = await search.search({ keyword: "x" }, { userIdRaw: userIdA });
    expect(r.items[0].affiliateLinkUrl).toBe("https://shope.ee/EXISTING");
  });
});
```

---

## §6 — Implementation skeleton

See §3 for the canonical service code. Controller binding:

```ts
@Controller("v1/products")
@UseGuards(SearchRateGuard)
export class ProductSearchController {
  constructor(private readonly search: ProductSearchService) {}

  @Get("search")
  async list(@Query() raw: unknown, @Headers("x-user-id") userId: string | undefined, @Req() req: Request) {
    const parsed = Query_.safeParse(raw);
    if (!parsed.success) throw new HttpException({ ok: false, error: "validation_failed", issues: parsed.error.issues }, 400);
    const userIdHash = userId
      ? crypto.createHash("sha256").update(userId + (process.env.POSTHOG_PII_SALT ?? "")).digest("hex").slice(0, 16)
      : undefined;
    return this.search.search(
      { keyword: parsed.data.q, pageNumber: parsed.data.page, pageSize: parsed.data.size, sort: parsed.data.sort },
      { userIdHash, userIdRaw: userId }
    );
  }
}
```

Rate-limit guard parameterised by auth state:

```ts
@Injectable()
class SearchRateGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.headers["x-user-id"];
    if (userId) {
      const bucket = `rl:search:user:${userId}:${Math.floor(Date.now() / 60000)}`;
      const used = await redis.incr(bucket);
      if (used === 1) await redis.expire(bucket, 60);
      if (used > 30) throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 60 }, 429);
    } else {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? "0.0.0.0";
      const ip24 = ip.split(".").slice(0, 3).join(".");
      const bucket = `rl:search:ip:${ip24}:${Math.floor(Date.now() / 60000)}`;
      const used = await redis.incr(bucket);
      if (used === 1) await redis.expire(bucket, 60);
      if (used > 10) throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 60 }, 429);
    }
    return true;
  }
}
```

---

## §7 — Dependencies

- **External:** Shopee Affiliate Open API approval (FR-AFF-001 §7 lead).
- **Internal:** FR-AFF-001 (Shopee client + circuit breaker). MongoDB Atlas with `affiliate_links` collection from FR-AFF-002 for the inline-link enrichment.
- **Infrastructure:** Redis for cache + rate limit. PostHog for PII-scrubbed event capture.
- **Vendor:** `zod`, `crypto` (Node builtin), `@nestjs/common`.

---

## §8 — Example payloads

### Request

```http
GET /v1/products/search?q=áo+thun&page=1&size=10&sort=RELEVANCY
X-User-Id: 65f7a2b3c4d5e6f7a8b9c0d2
```

### Successful response

```json
{
  "items": [
    {
      "shopId": "123",
      "itemId": "9876",
      "productName": "Áo thun nam basic",
      "currentPrice": 89000,
      "originalPrice": 129000,
      "imageUrl": "https://cf.shopee.vn/file/...",
      "sales": 1247,
      "affiliateLinkUrl": null
    }
  ],
  "count": 10,
  "pageNumber": 1,
  "pageSize": 10,
  "cached": false
}
```

### PostHog event (scrubbed keyword + hashed userId)

```json
{
  "event": "product_search",
  "properties": {
    "keyword": "áo thun nam",
    "results": 10,
    "pageNumber": 1,
    "pageSize": 10,
    "cached": false,
    "userIdHash": "a3f9c2d1e7b8a4f5",
    "latency_ms": 612
  }
}
```

### Redacted-keyword event (email-shaped input)

```json
{
  "event": "product_search",
  "properties": {
    "keyword": "[redacted-email]",
    "results": 8,
    "cached": false,
    "latency_ms": 728
  }
}
```

---

## §9 — Open questions

All resolved at authoring time:

- **Q1: Server-side full-text index on our own dataset (e.g., Atlas Search) as a layer?** Resolved → no at MVP. Shopee owns the relevance signal (sales velocity, recency, ratings); duplicating it in our index is expensive and lower-quality. Atlas Search becomes interesting at P3 when we have 100K+ products in our denormalised mirror and can layer historic-price intelligence on top of Shopee's signal.
- **Q2: Category filter (e.g., "áo thun" + `categoryId: 11036132`)?** Resolved → P3 (FR-AFF-009 or earlier extension). Shopee API supports category filter parameter; we don't expose it in P1 to keep the surface tight and the cache key bounded.
- **Q3: Save search history per user?** Resolved → no in P0/P1. PostHog event stream is the only persistence (12-month retention; cohort queries via PostHog Insights). Server-side history would require a `search_history` collection with PDPL retention + DSR export — out of scope for MVP.
- **Q4: Surface affiliate-tagged URL inline vs render the disclosure interstitial on first click?** Resolved → surface inline. The pre-click interstitial (FR-LEGAL-002 §1 #6) still fires on the FE click handler; the inline `affiliateLinkUrl` just saves the 400ms deeplink generation round-trip. Disclosure remains.
- **Q5: How to handle Shopee 429 during a search?** Resolved → propagate `service_unavailable` to caller (FR-AFF-001 §1 #7 maps Shopee 429 → `rate_limit` error code which converts at the resolver level). Our user-side rate limit (§1 #4) protects the budget; if Shopee 429s us anyway, the breaker fires and protects subsequent calls.
- **Q6: Sort by `NEWEST` (recently added to Shopee)?** Resolved → not exposed. Shopee's RELEVANCY incorporates recency; adding NEWEST is redundant and would invite users to discover unverified new sellers (counterfeit risk).

---

## §10 — Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Cache poisoning (Redis offline; `GET` returns null) | every call becomes cache miss | API call fall-through; budget pressure rises | Built-in (Shopee rate-limit guard catches before exhaustion); OBS alert on Redis disconnect |
| Cache key collision (sha256 16-char prefix) | one user's search returns another's results | Statistically negligible at MVP (10K users); revisit at 1M | Increase prefix to 24 chars if observed |
| XSS in product description (regression — strip rule loosened) | snapshot test on `stripHtml("<script>x</script>")` fails | PR blocked at AC10 | None |
| Throttle false-positive (user across 2 devices with same userId) | 429 unexpectedly on legitimate use | Brief UX glitch; user backs off; sub-minute recovers | Future: combine userId + device fingerprint at P3 |
| Result count zero (Shopee returns empty nodes for valid keyword) | response `count: 0` | UI shows "Không tìm thấy kết quả"; PostHog event `results: 0` for product-management cohort analysis | None |
| Keyword leak via PostHog (regression — scrub rule missed a PII pattern) | Audit quarterly via PostHog Insights filter `keyword: contains "@"` | Re-scrub server-side and add the new PII pattern to the regex | Tighten regex; ship hotfix |
| Pagination edge: `pageNumber > total available` | Shopee returns empty nodes | Same as result-count-zero | None |
| Sort by `SALES_DESC` vs `commission` accidentally (regression) | Grep CI (AC15) | PR blocked | None |
| Cache TTL set wrong (60 min instead of 5 min) | Visual code review | Stale prices serve up to 60 min | AC2 + AC3 cover the round-trip |
| Shopee adds rate limit specifically on `productSearch` endpoint | 429 spike with `method: "productSearch"` tag | Breaker (FR-AFF-001) handles; our cache softens | Per-method budget split (Phase 2 hardening) |
| Anonymous abuse hitting `/v1/products/search` from many IPs | OBS dashboard `cached: false` rate spike | Rate limiter blocks per-IP; Shopee budget protected | Add Cloudflare / Vercel WAF rule at scale |
| `affiliateLinkUrl` enrichment N+1 query (10 items × 1 Mongo round-trip) | Latency p95 > 900ms on auth users with many results | Single batched `$in` query already in skeleton | Built-in |
| User searches sensitive product (medical, weapons) | n/a — out of scope (Shopee's catalogue is the ground truth) | We return whatever Shopee surfaces | None |
| stripHtml regex misses encoded HTML (`&lt;script&gt;`) | Snapshot test on encoded payload | Encoded entities pass through (browser may decode but FE escapes) | Use DOMPurify or escape-as-string at FE render time |

---

## §11 — Notes

- Search is a SHOULD priority because users primarily paste URLs from external sources (Facebook groups, Zalo shares). It exists for Mega Sale Mode discovery (FR-GROW-003 leaderboard + landing page) and public deal-page browsing (FR-GROW-002 SEO inbound).
- Plan §A3 principle 4 ("open source revenue model"): the keyword-scrubbing logic is the auditable detail users can verify — the redacted-keyword PostHog event proves we don't keep raw PII even when the user accidentally pastes it.
- The 5-min cache TTL ties this FR's UX to the scheduler hot-tier cadence (30 min). When we eventually surface "Live prices" in the FE (FR-PRICE-002 chart endpoint), the 5-min cache is the floor; the chart endpoint's 5-min cache + pubsub-invalidate (FR-PRICE-002 §1 #7) means a price drop reaches a viewing user within 5 min worst-case.
- The `affiliateLinkUrl` enrichment is a deliberate place where this FR reaches into FR-AFF-002's persisted output. The dependency is one-directional (this FR reads `affiliate_links`, FR-AFF-002 writes it). No circular dependency.

---

*End of FR-AFF-004. Status: shipped (2026-05-17). Last expanded: 2026-05-16.*
