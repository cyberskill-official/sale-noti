// FR-LEGAL-002 §3 — three-variant disclosure component.
import React from "react";
import { disclosureFor, DISCLOSURE_VERSION, type Locale } from "@/lib/disclosure";

type Variant = "card" | "inline" | "footer";

const styles: Record<Variant, React.CSSProperties> = {
  card: {
    border: "1px solid #FBD38D",
    background: "#FFFAF0",
    padding: "16px",
    borderRadius: "8px",
    fontSize: "13px",
    lineHeight: 1.5,
    color: "#333",
  },
  inline: {
    fontSize: "12px",
    color: "#666",
    marginTop: "4px",
    lineHeight: 1.4,
  },
  footer: {
    fontSize: "11px",
    color: "#666",
    marginTop: "24px",
    paddingTop: "16px",
    borderTop: "1px solid #eee",
    lineHeight: 1.5,
  },
};

export function AffiliateDisclosureCard({
  variant = "card",
  locale = "vi",
}: {
  variant?: Variant;
  locale?: Locale;
}) {
  return (
    <div data-testid="aff-disclosure" data-version={DISCLOSURE_VERSION} data-variant={variant} style={styles[variant]}>
      <p style={{ margin: 0 }}>{disclosureFor(locale)}</p>
      <a
        href="/legal/affiliate"
        style={{ display: "inline-block", marginTop: 6, fontSize: "12px", color: "#C05621", textDecoration: "underline" }}
      >
        {locale === "vi" ? "Đọc đầy đủ →" : "Read full disclosure →"}
      </a>
    </div>
  );
}
