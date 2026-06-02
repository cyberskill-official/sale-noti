---
id: FR-AFF-009
title: "Shopee Affiliate Thailand localization — Thai locale, THB currency, and KOC roster"
module: AFF
priority: MUST
status: draft
verify: T
phase: P4
milestone: "P4 - slice 1 - Thailand launch"
slice: 1
owner: "Senior Tech Lead"
created: 2026-06-02
related_frs:
  - FR-AFF-001
  - FR-AFF-008
  - FR-ADMIN-004
  - FR-LEGAL-002
  - FR-WATCH-004
depends_on:
  - FR-AFF-001
  - FR-AFF-008
  - FR-ADMIN-004
blocks:
  - FR-PRICE-003
  - FR-PRICE-004
  - FR-WATCH-005
  - FR-ADMIN-005
  - FR-ADMIN-006
effort_hours: 10
template: engineering-spec@1
new_files:
  - apps/api/src/affiliate/shopee/localization/th.ts
  - apps/api/src/affiliate/shopee/localization/koc-roster.ts
  - apps/api/src/affiliate/shopee/localization/__tests__/th.spec.ts
  - apps/mobile/src/disclosure.ts
  - apps/mobile/src/__tests__/disclosure.spec.ts
modified_files:
  - packages/disclosure-copy/index.cjs
  - packages/disclosure-copy/index.d.ts
  - apps/web/src/lib/disclosure.ts
  - apps/web/src/components/disclosure/__tests__/disclosure.spec.tsx
  - apps/mobile/src/shims.d.ts
  - apps/mobile/App.tsx
allowed_tools:
  - file_read/write apps/api/**
  - file_read/write apps/web/**
  - file_read/write apps/mobile/**
  - file_read/write packages/disclosure-copy/**
  - bash pnpm test
disallowed_tools:
  - scrape Shopee TH HTML pages
  - call undocumented/private Shopee TH endpoints
  - invent real KOC identities or store personal data in source control
  - override existing affiliate cookies or attribution from other publishers
risk_if_skipped: "The first SEA launch would still render in VN assumptions: Thai users would see the wrong currency/locale, KOC attribution rules would not be localized, and downstream regional features would inherit a market gap that needs a second cleanup pass."
---

## §1 - Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The API and UI layers MUST support a Thailand-specific Shopee affiliate localization slice without changing the existing Vietnam behavior.

1. The shared disclosure package MUST export `AFFILIATE_DISCLOSURE_TH` and `FIVE_PRINCIPLES_TH` alongside the existing EN/VI constants. `DISCLOSURE_VERSION` MUST remain `v1` because the meaning of the canonical disclosure does not change; only the language rendering changes.
2. `apps/web/src/lib/disclosure.ts` MUST accept `Locale = "vi" | "en" | "th"`, and `disclosureFor("th")` MUST return the Thai disclosure string from `@salenoti/disclosure-copy`. Existing `vi` and `en` behavior MUST remain unchanged.
3. The Thailand market helper MUST expose a closed descriptor with `market: "TH"`, `locale: "th_TH"`, `language: "th"`, `currency: "THB"`, and `currencySymbol: "฿"`. Price formatting for display MUST use Thai locale rules, but underlying numeric amounts MUST remain untouched.
4. The Thailand KOC roster MUST be a read-only config of non-secret metadata only. Each roster entry MUST include only safe fields such as `slug`, `displayName`, `channel`, `vertical`, and `respectOtherPublisher`; the roster MUST NOT contain private tokens, scraped profile data, or real-person identifiers that are not already public.
5. The Thai disclosure copy MUST preserve the same ethical commitments as the canonical copy: no auto-applied coupon, no affiliate-cookie override, and no hiding of better deals to chase commission. The wording MAY be translated, but the meaning MUST be equivalent.
6. The Thailand locale resolver MUST treat `th`, `th_TH`, and `th-TH` as Thailand and MUST fail closed for unsupported markets. Non-TH locales MUST continue to resolve through the existing VN/EN surfaces and MUST NOT be silently mapped to TH.
7. The market descriptor MUST be injectable into web, mobile, and API surfaces without changing public Shopee VN route signatures or the existing `platform: "shopee"` semantics from P1/P3.
8. This FR MUST NOT invent live KOC identities, scrape Thai partner pages, or alter commission attribution. The KOC roster is a localization/configuration surface, not a CRM or tracking database.

## §2 - Why this design

P4 is about one new SEA market first. Thailand is the cleanest first step because the workspace already has TH locale plumbing in mobile and region-aware helpers in web/API, so the incremental diff is smaller than adding a wholly new country model.

This FR intentionally separates three concerns that are easy to mix up:

- disclosure text and ethical principles live in the shared package,
- locale/currency formatting lives in the localization helper,
- KOC roster metadata lives in a read-only config module.

Keeping those concerns separate prevents the Thai launch from becoming a one-off bundle of strings that cannot be reused for PH/MY/ID later.

The KOC roster is not a place to store creator PII or scraped social profiles. It exists so the product can surface a market-specific set of safe, non-secret labels for TH while still respecting the existing cookie-fairness rule from FR-LEGAL-002 and FR-AFF-002.

`DISCLOSURE_VERSION` stays unchanged because the Thai copy does not introduce new legal meaning. The whole point of this slice is localization, not a new policy.

## §3 - API contract and code shape

### Files

- `packages/disclosure-copy/index.cjs`
- `packages/disclosure-copy/index.d.ts`
- `apps/web/src/lib/disclosure.ts`
- `apps/web/src/components/disclosure/__tests__/disclosure.spec.tsx`
- `apps/mobile/src/shims.d.ts`
- `apps/mobile/App.tsx`
- `apps/api/src/affiliate/shopee/localization/th.ts`
- `apps/api/src/affiliate/shopee/localization/koc-roster.ts`
- `apps/api/src/affiliate/shopee/localization/__tests__/th.spec.ts`

### Environment

No new environment variables are required for the draft. The TH market descriptor MAY be a static config module consumed by the app layer.

### Core types

```ts
export type Locale = "vi" | "en" | "th";

export type ShopeeThailandMarketCode = "TH";

export interface ShopeeThailandMarketConfig {
  market: ShopeeThailandMarketCode;
  locale: "th_TH";
  language: "th";
  currency: "THB";
  currencySymbol: "฿";
  disclosureVersion: "v1";
  disclosureCopy: string;
  principles: readonly EthicalPrinciple[];
  kocRoster: ReadonlyArray<ShopeeThailandKocRosterEntry>;
}

export interface ShopeeThailandKocRosterEntry {
  slug: string;
  displayName: string;
  channel: "line" | "facebook" | "tiktok" | "youtube";
  vertical: "beauty" | "fashion" | "electronics" | "home" | "mom-baby";
  respectOtherPublisher: true;
}

export function resolveShopeeThailandMarket(input: {
  locale?: string | null;
  market?: string | null;
}): ShopeeThailandMarketConfig | null;

export function formatShopeeThailandCurrency(amount: number): string;

export function getShopeeThailandKocRoster(): ReadonlyArray<ShopeeThailandKocRosterEntry>;
```

### Shared disclosure exports

```ts
export const DISCLOSURE_VERSION: "v1";
export const AFFILIATE_DISCLOSURE_VI: string;
export const AFFILIATE_DISCLOSURE_EN: string;
export const AFFILIATE_DISCLOSURE_TH: string;
export type EthicalPrinciple = {
  id: number;
  title: string;
  body: string;
};
export const FIVE_PRINCIPLES_VI: readonly EthicalPrinciple[];
export const FIVE_PRINCIPLES_EN: readonly EthicalPrinciple[];
export const FIVE_PRINCIPLES_TH: readonly EthicalPrinciple[];
```

### Helper shape

```ts
export function disclosureFor(locale: Locale): string;

export function principlesFor(locale: Locale): readonly EthicalPrinciple[];

export function resolveMobileDisclosureLocale(deviceLocale?: string | null): Locale;

export function mobileDisclosureFor(deviceLocale?: string | null): string;

export function mobilePrinciplesFor(deviceLocale?: string | null): readonly EthicalPrinciple[];
```

### Mobile shim surface

```ts
declare module "@salenoti/disclosure-copy" {
  export const DISCLOSURE_VERSION: "v1";
  export const AFFILIATE_DISCLOSURE_EN: string;
  export const AFFILIATE_DISCLOSURE_VI: string;
  export const AFFILIATE_DISCLOSURE_TH: string;
  export type EthicalPrinciple = {
    id: number;
    title: string;
    body: string;
  };
  export const FIVE_PRINCIPLES_EN: readonly EthicalPrinciple[];
  export const FIVE_PRINCIPLES_VI: readonly EthicalPrinciple[];
  export const FIVE_PRINCIPLES_TH: readonly {
    id: number;
    title: string;
    body: string;
  }[];
}
```

The public Shopee VN behavior MAY remain exactly as-is; the Thailand slice only adds a new locale branch and a read-only market descriptor.

## §4 - Acceptance criteria

1. Given the new shared copy exports, `AFFILIATE_DISCLOSURE_TH` and `FIVE_PRINCIPLES_TH` exist and the canonical `DISCLOSURE_VERSION` remains `v1`.
2. Given `disclosureFor("th")`, the helper returns the Thai disclosure string; given `disclosureFor("vi")` or `disclosureFor("en")`, the current behavior remains unchanged.
3. Given `resolveShopeeThailandMarket({ locale: "th_TH" })`, the helper returns a Thailand config with `market: "TH"`, `currency: "THB"`, and `currencySymbol: "฿"`.
4. Given a Thai price amount, `formatShopeeThailandCurrency()` returns a Thai-formatted display string and does not mutate the underlying numeric value.
5. Given a KOC roster lookup, every entry is read-only and contains only safe metadata fields; no PII, secret token, or scraped profile payload appears in source control.
6. Given a non-TH locale, the resolver returns `null` or falls through to the existing VN/EN path and does not silently remap the user into Thailand.
7. Given the mobile and web disclosure surfaces, Thai users see the Thai copy while existing Vietnamese and English users see their current copy; mobile must resolve `th_TH` / `th-TH` into the Thai disclosure branch through a helper in `apps/mobile/src/disclosure.ts`.
8. Given the mobile React Native type surface, `apps/mobile/src/shims.d.ts` declares the shared disclosure exports, including the Thai additions, so the app typechecks before the package typings are fully hoisted.
9. Given the legal and affiliate surfaces, the Thai copy preserves the no-coupon, no-cookie-override, and no-hidden-better-deal commitments.

## §5 - Verification

```ts
// apps/api/src/affiliate/shopee/localization/__tests__/th.spec.ts
it("resolves the Thailand market descriptor", () => {
  const config = resolveShopeeThailandMarket({ locale: "th_TH" });

  expect(config).toMatchObject({
    market: "TH",
    locale: "th_TH",
    language: "th",
    currency: "THB",
    currencySymbol: "฿",
  });
});

it("formats THB for display only", () => {
  const formatted = formatShopeeThailandCurrency(129900);

  expect(formatted).toContain("129");
  expect(formatted).toContain("฿");
});

it("exposes a read-only KOC roster without PII", () => {
  const roster = getShopeeThailandKocRoster();

  expect(Object.isFrozen(roster)).toBe(true);
  expect(roster.length).toBeGreaterThan(0);
  expect(roster[0]).toMatchObject({ respectOtherPublisher: true });
});
```

```ts
// apps/web/src/components/disclosure/__tests__/disclosure.spec.tsx
it("renders the Thai disclosure copy", () => {
  expect(disclosureFor("th")).toBe(AFFILIATE_DISCLOSURE_TH);
});
```

```ts
// apps/mobile/src/__tests__/disclosure.spec.ts
import { describe, it, expect, expectTypeOf } from "vitest";
import { AFFILIATE_DISCLOSURE_TH, FIVE_PRINCIPLES_TH } from "@salenoti/disclosure-copy";
import { mobileDisclosureFor, mobilePrinciplesFor, resolveMobileDisclosureLocale } from "../disclosure";

describe("FR-AFF-009 — mobile Thailand disclosure routing", () => {
  it("resolves Thai device locales to the Thai branch", () => {
    expect(resolveMobileDisclosureLocale("th_TH")).toBe("th");
    expect(resolveMobileDisclosureLocale("th-TH")).toBe("th");
  });

  it("returns the Thai disclosure copy for Thai locales", () => {
    expect(mobileDisclosureFor("th_TH")).toBe(AFFILIATE_DISCLOSURE_TH);
    expect(mobilePrinciplesFor("th_TH")).toBe(FIVE_PRINCIPLES_TH);
  });

  it("exports the Thai disclosure types for typechecking", () => {
    expectTypeOf(AFFILIATE_DISCLOSURE_TH).toBeString();
    expectTypeOf(FIVE_PRINCIPLES_TH).toBeReadonlyArray();
  });
});
```

## §6 - Implementation skeleton

```ts
import {
  AFFILIATE_DISCLOSURE_EN,
  AFFILIATE_DISCLOSURE_TH,
  AFFILIATE_DISCLOSURE_VI,
  FIVE_PRINCIPLES_EN,
  FIVE_PRINCIPLES_TH,
  FIVE_PRINCIPLES_VI,
} from "@salenoti/disclosure-copy";

export function resolveMobileDisclosureLocale(deviceLocale?: string | null) {
  if (deviceLocale === "th_TH" || deviceLocale === "th-TH" || deviceLocale === "th") {
    return "th" as const;
  }

  if (deviceLocale === "en" || deviceLocale === "en_US" || deviceLocale === "en-US") {
    return "en" as const;
  }

  return "vi" as const;
}

export function mobileDisclosureFor(deviceLocale?: string | null) {
  const locale = resolveMobileDisclosureLocale(deviceLocale);

  if (locale === "th") return AFFILIATE_DISCLOSURE_TH;
  if (locale === "en") return AFFILIATE_DISCLOSURE_EN;
  return AFFILIATE_DISCLOSURE_VI;
}

export function mobilePrinciplesFor(deviceLocale?: string | null) {
  const locale = resolveMobileDisclosureLocale(deviceLocale);

  if (locale === "th") return FIVE_PRINCIPLES_TH;
  if (locale === "en") return FIVE_PRINCIPLES_EN;
  return FIVE_PRINCIPLES_VI;
}

const THAILAND_MARKET: ShopeeThailandMarketConfig = Object.freeze({
  market: "TH",
  locale: "th_TH",
  language: "th",
  currency: "THB",
  currencySymbol: "฿",
  disclosureVersion: "v1",
  disclosureCopy: AFFILIATE_DISCLOSURE_TH,
  principles: FIVE_PRINCIPLES_TH,
  kocRoster: Object.freeze([
    Object.freeze({
      slug: "th-beauty",
      displayName: "Thai Beauty",
      channel: "line",
      vertical: "beauty",
      respectOtherPublisher: true,
    }),
  ]),
});

export function resolveShopeeThailandMarket(input: { locale?: string | null; market?: string | null }) {
  if (input.market === "TH" || input.locale === "th_TH" || input.locale === "th-TH" || input.locale === "th") {
    return THAILAND_MARKET;
  }

  return null;
}

export function formatShopeeThailandCurrency(amount: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(amount);
}
```

## §7 - Dependencies

Internal dependencies:

- `FR-AFF-001` for the hardened Shopee client pattern.
- `FR-AFF-008` for the multi-platform storage pivot already in place.
- `FR-ADMIN-004` for the locale-aware SEA routing posture.
- `FR-LEGAL-002` for disclosure and cookie-fairness guardrails.

External dependencies:

- None beyond the current workspace package layout.

## §8 - Failure modes inventory

| Failure | Detection | Outcome | Recovery |
|---|---|---|---|
| Thai copy drifts from canonical meaning | snapshot or string test failure | legal mismatch risk | update TH copy and re-audit |
| Non-TH locale falls into TH branch | resolver unit test fails | wrong market/currency displayed | tighten locale guards |
| KOC roster contains PII | review or lint fail | privacy/compliance risk | replace with alias-only metadata |
| Thai currency formatter emits a misleading amount | unit test failure | user-facing price confusion | fix formatter and re-run tests |
| Shared disclosure export missing in mobile shims | typecheck failure | mobile compile break | update `src/shims.d.ts` |
| Existing VN behavior regresses | regression tests fail | public copy mismatch | keep `vi`/`en` branches intact |

## §9 - Notes

This FR is the first P4 regional slice and should stay focused on Thailand only. PH/MY/ID expansion belongs in later FRs once the TH localization proves stable.

The draft deliberately avoids real KOC names or market-specific partner IDs. Those belong in runtime configuration if and when the business has approved public partners for TH.

Plan references: `BACKLOG.md §6`, P4 regional goal in the source plan, and the shared disclosure guardrails established by FR-LEGAL-002.
