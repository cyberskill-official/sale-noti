// apps/web/eslint.config.mjs — flat config (ESLint 9 default).
// Loads the custom FR-LEGAL-002 rule from eslint-rules/ at the repo root.
import nextPlugin from "eslint-config-next";
import noAutoApplyCoupon from "../../eslint-rules/no-auto-apply-coupon.cjs";

export default [
  {
    plugins: {
      "salenoti-legal": {
        rules: {
          "no-auto-apply-coupon": noAutoApplyCoupon,
        },
      },
    },
    rules: {
      "salenoti-legal/no-auto-apply-coupon": "error",
    },
  },
  ...(typeof nextPlugin === "function" ? [nextPlugin()] : [nextPlugin]),
];
