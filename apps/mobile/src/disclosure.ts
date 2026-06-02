import {
  AFFILIATE_DISCLOSURE_EN,
  AFFILIATE_DISCLOSURE_TH,
  AFFILIATE_DISCLOSURE_VI,
  FIVE_PRINCIPLES_EN,
  FIVE_PRINCIPLES_TH,
  FIVE_PRINCIPLES_VI,
  type EthicalPrinciple,
} from "@salenoti/disclosure-copy";

export type MobileDisclosureLocale = "vi" | "en" | "th";

export function resolveMobileDisclosureLocale(deviceLocale?: string | null): MobileDisclosureLocale {
  const normalizedLocale = (deviceLocale ?? "").trim().toLowerCase();

  if (normalizedLocale.startsWith("th")) return "th";
  if (normalizedLocale.startsWith("en")) return "en";
  return "vi";
}

export function detectMobileDisclosureLocale(): MobileDisclosureLocale {
  const runtimeLocale = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().locale : null;
  return resolveMobileDisclosureLocale(runtimeLocale);
}

export function mobileDisclosureFor(deviceLocale?: string | null): string {
  const locale = resolveMobileDisclosureLocale(deviceLocale);

  if (locale === "th") return AFFILIATE_DISCLOSURE_TH;
  if (locale === "en") return AFFILIATE_DISCLOSURE_EN;
  return AFFILIATE_DISCLOSURE_VI;
}

export function mobilePrinciplesFor(deviceLocale?: string | null): readonly EthicalPrinciple[] {
  const locale = resolveMobileDisclosureLocale(deviceLocale);

  if (locale === "th") return FIVE_PRINCIPLES_TH;
  if (locale === "en") return FIVE_PRINCIPLES_EN;
  return FIVE_PRINCIPLES_VI;
}
