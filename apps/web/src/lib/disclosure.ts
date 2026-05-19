// FR-LEGAL-002 §1 #1 — canonical affiliate disclosure copy.
// Source of truth lives in the workspace package so web and API emails cannot drift.
// DO NOT EDIT in place. Any wording change requires:
//   1. A new FR (FR-LEGAL-002a-...)
//   2. Bump DISCLOSURE_VERSION
//   3. Re-consent flow for existing users (FR-LEGAL-001 §1 #9)
export {
  AFFILIATE_DISCLOSURE_EN,
  AFFILIATE_DISCLOSURE_VI,
  DISCLOSURE_VERSION,
  FIVE_PRINCIPLES_EN,
  FIVE_PRINCIPLES_VI,
} from "@salenoti/disclosure-copy";

import { AFFILIATE_DISCLOSURE_EN, AFFILIATE_DISCLOSURE_VI } from "@salenoti/disclosure-copy";

export type Locale = "vi" | "en";

export function disclosureFor(locale: Locale): string {
  return locale === "vi" ? AFFILIATE_DISCLOSURE_VI : AFFILIATE_DISCLOSURE_EN;
}
