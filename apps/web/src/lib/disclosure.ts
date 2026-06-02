// FR-LEGAL-002 §1 #1 — canonical affiliate disclosure copy.
// Source of truth lives in the workspace package so web and API emails cannot drift.
// DO NOT EDIT in place. Any wording change requires:
//   1. A new FR (FR-LEGAL-002a-...)
//   2. Bump DISCLOSURE_VERSION
//   3. Re-consent flow for existing users (FR-LEGAL-001 §1 #9)
export {
  AFFILIATE_DISCLOSURE_EN,
  AFFILIATE_DISCLOSURE_VI,
  AFFILIATE_DISCLOSURE_TH,
  DISCLOSURE_VERSION,
  FIVE_PRINCIPLES_EN,
  FIVE_PRINCIPLES_VI,
  FIVE_PRINCIPLES_TH,
} from "@salenoti/disclosure-copy";

import {
  AFFILIATE_DISCLOSURE_EN,
  AFFILIATE_DISCLOSURE_TH,
  AFFILIATE_DISCLOSURE_VI,
  FIVE_PRINCIPLES_EN,
  FIVE_PRINCIPLES_TH,
  FIVE_PRINCIPLES_VI,
  type EthicalPrinciple,
} from "@salenoti/disclosure-copy";

export type Locale = "vi" | "en" | "th";

export function disclosureFor(locale: Locale): string {
  if (locale === "th") return AFFILIATE_DISCLOSURE_TH;
  return locale === "vi" ? AFFILIATE_DISCLOSURE_VI : AFFILIATE_DISCLOSURE_EN;
}

export function principlesFor(locale: Locale) {
  if (locale === "th") return FIVE_PRINCIPLES_TH;
  return locale === "vi" ? FIVE_PRINCIPLES_VI : FIVE_PRINCIPLES_EN;
}

export function resolveDisclosureLocaleFromHeaders(requestHeaders: Pick<Headers, "get">): Locale {
  const country = requestHeaders.get("x-vercel-ip-country")?.trim().toUpperCase();
  if (country === "TH") return "th";

  const acceptLanguage = requestHeaders.get("accept-language")?.trim().toLowerCase() ?? "";
  if (acceptLanguage.includes("th")) return "th";
  if (acceptLanguage.includes("en")) return "en";

  return "vi";
}

export type { EthicalPrinciple };
