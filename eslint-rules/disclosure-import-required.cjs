"use strict";

const DISCLOSURE_LITERAL = /SaleNoti[^"`']*(affiliate|hoa hồng)[^"`']*(1\.5|5%|5％)/i;

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require disclosure copy imports from the canonical module instead of local string literals.",
      recommended: true,
    },
    schema: [],
    messages: {
      disclosureImportRequired:
        "FR-LEGAL-002: disclosure copy must come from @/lib/disclosure or @salenoti/disclosure-copy, not a local string literal.",
    },
  },
  create(context) {
    function isAllowedFile() {
      const name = context.getFilename().replace(/\\/g, "/");
      return name.endsWith("apps/web/src/lib/disclosure.ts");
    }
    function check(node) {
      if (isAllowedFile()) return;
      const text = context.getSourceCode().getText(node);
      if (DISCLOSURE_LITERAL.test(text)) context.report({ node, messageId: "disclosureImportRequired" });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node);
      },
      TemplateLiteral: check,
    };
  },
};
