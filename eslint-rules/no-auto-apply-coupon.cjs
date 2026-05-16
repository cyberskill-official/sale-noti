// FR-LEGAL-002 §5 — custom ESLint rule.
// Blocks calls like applyCoupon(), autoApplyPromo(), injectPromoCode().
// Catches the foot-gun mechanically.
"use strict";

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Auto-applying coupons or injecting promo codes violates FR-LEGAL-002 §1 #8 and the Chrome Web Store Affiliate Ads Policy 3/2025.",
      recommended: true,
      url: "../docs/feature-requests/legal/FR-LEGAL-002-affiliate-disclosure-surfaces.md",
    },
    schema: [],
    messages: {
      forbidden:
        "FR-LEGAL-002 §1 #8: do not auto-apply coupons. The user must paste any code manually. If this is a 'copy-to-clipboard' UI helper, rename it so the intent is unambiguous (e.g. copyCouponToClipboard).",
    },
  },
  create(context) {
    const FORBIDDEN = /^(applyCoupon|autoApplyPromo|injectPromoCode|autoCoupon|injectCoupon)$/i;
    function check(node, name) {
      if (FORBIDDEN.test(name)) {
        context.report({ node, messageId: "forbidden" });
      }
    }
    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier") check(node, node.callee.name);
        if (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
          check(node, node.callee.property.name);
        }
      },
      FunctionDeclaration(node) {
        if (node.id && FORBIDDEN.test(node.id.name)) check(node, node.id.name);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && FORBIDDEN.test(node.id.name)) check(node, node.id.name);
      },
    };
  },
};
