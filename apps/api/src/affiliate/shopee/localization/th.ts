import { AFFILIATE_DISCLOSURE_TH, FIVE_PRINCIPLES_TH, type EthicalPrinciple } from "@salenoti/disclosure-copy";
import { getShopeeThailandKocRoster, type ShopeeThailandKocRosterEntry } from "./koc-roster";

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

export const SHOPEE_THAILAND_MARKET: ShopeeThailandMarketConfig = Object.freeze({
  market: "TH",
  locale: "th_TH",
  language: "th",
  currency: "THB",
  currencySymbol: "฿",
  disclosureVersion: "v1",
  disclosureCopy: AFFILIATE_DISCLOSURE_TH,
  principles: FIVE_PRINCIPLES_TH,
  kocRoster: getShopeeThailandKocRoster(),
});

export function resolveShopeeThailandMarket(input: { locale?: string | null; market?: string | null }): ShopeeThailandMarketConfig | null {
  const normalizedMarket = (input.market ?? "").trim().toUpperCase();
  const normalizedLocale = (input.locale ?? "").trim().toLowerCase();

  if (normalizedMarket === "TH" || normalizedLocale === "th" || normalizedLocale === "th_th" || normalizedLocale === "th-th") {
    return SHOPEE_THAILAND_MARKET;
  }

  return null;
}

export function formatShopeeThailandCurrency(amount: number): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(amount);
}
