// apps/web/eslint.config.mjs — flat config (ESLint 9 default).
// Note: we deliberately don't use `next lint` because Next 15.0.x's eslint-config-next
// patches an internal ESLint module that breaks under ESLint 9. Direct typescript-eslint
// is forward-compatible and is the path Next 15.2+ also moved to.
// The custom FR-LEGAL-002 no-auto-apply-coupon rule is loaded from eslint-rules/ at repo root.
import tsParser from "@typescript-eslint/parser";
import disclosureImportRequired from "../../eslint-rules/disclosure-import-required.cjs";
import noAutoApplyCoupon from "../../eslint-rules/no-auto-apply-coupon.cjs";
import noCommissionRanking from "../../eslint-rules/no-commission-ranking.cjs";

export default [
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", "**/*.d.ts", "next-env.d.ts"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "salenoti-legal": {
        rules: {
          "disclosure-import-required": disclosureImportRequired,
          "no-auto-apply-coupon": noAutoApplyCoupon,
          "no-commission-ranking": noCommissionRanking,
        },
      },
    },
    rules: {
      "salenoti-legal/disclosure-import-required": "error",
      "salenoti-legal/no-auto-apply-coupon": "error",
      "salenoti-legal/no-commission-ranking": "error",
      "no-unused-vars": "off", // typecheck catches this better
      "no-undef": "off", // TS handles undefined identifiers
    },
  },
];
