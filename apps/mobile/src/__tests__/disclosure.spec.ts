import { AFFILIATE_DISCLOSURE_TH, FIVE_PRINCIPLES_TH } from "@salenoti/disclosure-copy";
import { detectMobileDisclosureLocale, mobileDisclosureFor, mobilePrinciplesFor, resolveMobileDisclosureLocale } from "../disclosure";

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(message);
	}
}

function assertMatches(value: string, pattern: RegExp, message: string) {
	if (!pattern.test(value)) {
		throw new Error(message);
	}
}

assertEqual(resolveMobileDisclosureLocale("th_TH"), "th", "th_TH should resolve to Thai");
assertEqual(resolveMobileDisclosureLocale("th-TH"), "th", "th-TH should resolve to Thai");
assertEqual(mobileDisclosureFor("th_TH"), AFFILIATE_DISCLOSURE_TH, "Thai locale should map to Thai disclosure copy");
assertEqual(mobilePrinciplesFor("th_TH"), FIVE_PRINCIPLES_TH, "Thai locale should map to Thai principles");
assertMatches(detectMobileDisclosureLocale(), /^(vi|en|th)$/, "runtime locale should resolve to a supported disclosure branch");
