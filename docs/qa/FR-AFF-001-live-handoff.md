# FR-AFF-001 Live Shopee Affiliate Smoke Handoff

**Status:** local mock validation passes. Live Shopee provider validation requires an approved Shopee Affiliate VN account and credentials.

## Required Doppler/Env Payload

```bash
SHOPEE_AFFILIATE_APP_ID=<from Shopee Affiliate VN dashboard>
SHOPEE_AFFILIATE_APP_SECRET=<from Shopee Affiliate VN dashboard>
SHOPEE_RATE_LIMIT_PER_MIN=1000
REDIS_URL=rediss://default:<password>@<host>:6380
POSTHOG_KEY=<optional staging key>
SENTRY_DSN_API=<optional staging DSN>
```

## Required Smoke Inputs

Use one public Shopee VN product that is accepted by the affiliate account:

```bash
SHOPEE_SMOKE_SHOP_ID=<numeric shop id>
SHOPEE_SMOKE_ITEM_ID=<numeric item id>
```

## Manual Live Validation Checklist

1. Export the payload above through Doppler or a local shell.
2. Run the API unit/e2e gate:

```bash
pnpm --filter @salenoti/api test
pnpm --filter @salenoti/api test:e2e
pnpm --filter @salenoti/api typecheck
pnpm --filter @salenoti/api lint
pnpm --filter @salenoti/api build
```

3. Trigger one `productOfferV2` call from a staging API worker or an authenticated watchlist flow using the smoke `shopId/itemId`.
4. Confirm the response includes non-null `itemId`, `shopId`, `productName`, `priceMin`, `priceMax`, `productLink`, and `commissionRate`.
5. Confirm PostHog has a `shopee_api_call` event with `{ method, latency_ms, status }` and no raw GraphQL payload.
6. Confirm Sentry has `shopee.api.success` breadcrumbs and no secret-bearing messages.
7. Confirm Redis contains a `shopee:api:health:5m:*` hash incremented for `success`.

## No Auto-Publish Or External Mutation

This handoff does not publish, mutate Shopee data, or scrape Shopee pages. It only validates the official signed GraphQL Affiliate Open API path required by FR-AFF-001.
