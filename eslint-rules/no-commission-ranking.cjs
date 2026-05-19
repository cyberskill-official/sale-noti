"use strict";

const FORBIDDEN = /ORDER\s+BY[^;)]*(commission|offer_rate)|sortBy.*commission|commission.*sortBy/i;

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid consumer ranking by internal commission rate per FR-LEGAL-002 Principle 5.",
      recommended: true,
    },
    schema: [],
    messages: {
      forbidden: "FR-LEGAL-002 Principle 5: do not rank consumer-facing results by commission rate.",
    },
  },
  create(context) {
    function check(node) {
      const text = context.getSourceCode().getText(node);
      if (FORBIDDEN.test(text)) context.report({ node, messageId: "forbidden" });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node);
      },
      TemplateLiteral: check,
      Identifier(node) {
        if (FORBIDDEN.test(node.name)) context.report({ node, messageId: "forbidden" });
      },
    };
  },
};
