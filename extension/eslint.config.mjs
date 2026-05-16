// extension/eslint.config.mjs — flat config (ESLint 9 default).
// Loads the custom FR-LEGAL-002 no-auto-apply-coupon rule from eslint-rules/ at the repo root.
import tsParser from "@typescript-eslint/parser";
import noAutoApplyCoupon from "../eslint-rules/no-auto-apply-coupon.cjs";

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
          "no-auto-apply-coupon": noAutoApplyCoupon,
        },
      },
    },
    rules: {
      "salenoti-legal/no-auto-apply-coupon": "error",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
