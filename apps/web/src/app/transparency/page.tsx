// FR-LEGAL-002 §1 #7 — Transparency Report index.
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Transparency Reports — SaleNoti",
  description: "Quarterly transparency reports for SaleNoti affiliate revenue + ethics audit.",
};

export const revalidate = 3600;

const REPORTS = [
  // Populated each quarter by the founder; first report due 2026-Q3 (covering MVP launch quarter).
  // Until then this list is intentionally empty + the page explains why.
];

export default function TransparencyIndex() {
  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>Transparency Reports</h1>
      <p>
        Quarterly cadence per <Link href="/legal/affiliate">plan §A3 principle 5</Link>. Each report covers: total
        commission revenue, alerts sent, click-through-rate, conversion rate, all currently-active affiliate networks,
        any deviation from the 5 ethical principles, privacy + breach log.
      </p>

      {REPORTS.length === 0 ? (
        <section style={{ marginTop: 32, padding: 16, background: "#FFFAF0", borderRadius: 8, border: "1px solid #FBD38D" }}>
          <p style={{ margin: 0 }}>
            <b>Status:</b> first report due 2026-Q3 (covering MVP launch quarter). No earlier reports exist because
            SaleNoti has not yet processed any affiliate commission.
          </p>
        </section>
      ) : (
        <ul>
          {REPORTS.map((r: { slug: string; label: string; publishedAt: string }) => (
            <li key={r.slug}>
              <Link href={`/transparency/${r.slug}`}>{r.label}</Link>
              <span style={{ color: "#999", marginLeft: 8, fontSize: 13 }}>· {r.publishedAt}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 40 }}>What's in each report</h2>
      <ol>
        <li>Total commission earned (₫ and USD equivalent).</li>
        <li>Alerts sent (with split by channel: email / push / telegram).</li>
        <li>Alert → Click CTR.</li>
        <li>Click → Conversion (commission webhook confirmation).</li>
        <li>Active affiliate networks (Shopee Affiliate Open API direct, AccessTrade fallback, etc.).</li>
        <li>5-ethics audit status (all green / any deviation explained).</li>
        <li>Privacy & breach log (incident count for the quarter).</li>
        <li>DPO sign-off.</li>
      </ol>

      <p style={{ marginTop: 32 }}>
        Template at{" "}
        <a href="https://github.com/cyberskill/salenoti/blob/main/docs/legal/transparency-report-template.md">
          docs/legal/transparency-report-template.md
        </a>{" "}
        (public after repo open-sources post-launch).
      </p>
    </main>
  );
}
