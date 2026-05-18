// extension/eslint.config.mjs — flat config (ESLint 9 default).
// Loads the custom FR-LEGAL-002 no-auto-apply-coupon rule from eslint-rules/ at the repo root.
import tsParser from "@typescript-eslint/parser";
import disclosureImportRequired from "../eslint-rules/disclosure-import-required.cjs";
import noAutoApplyCoupon from "../eslint-rules/no-auto-apply-coupon.cjs";
import noCommissionRanking from "../eslint-rules/no-commission-ranking.cjs";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
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
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
