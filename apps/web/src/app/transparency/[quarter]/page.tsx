// FR-LEGAL-002 §1 #7 — Individual transparency report page (template).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

// Hard-coded reports for now. Replace with a Sanity / Mongo source in P3.
const REPORTS: Record<string, ReportData> = {
  // "2026-q3": { ...filled in by founder when Q3 closes },
};

type ReportData = {
  quarter: string;
  publishedAt: string;
  commissionVnd: number;
  alertsSent: number;
  alertsClicked: number;
  conversions: number;
  ethicsStatus: "green" | "amber" | "red";
  incidents: number;
  notes: string;
};

export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ quarter: string }>;
}): Promise<Metadata> {
  const { quarter } = await params;
  return {
    title: `Transparency Report ${quarter.toUpperCase()} — SaleNoti`,
    description: `Quarterly transparency report ${quarter.toUpperCase()} for SaleNoti.`,
  };
}

export default async function TransparencyReportPage({
  params,
}: {
  params: Promise<{ quarter: string }>;
}) {
  const { quarter } = await params;
  const report = REPORTS[quarter];
  if (!report) notFound();

  const ctr = report.alertsSent > 0 ? (report.alertsClicked / report.alertsSent) * 100 : 0;
  const conversionRate =
    report.alertsClicked > 0 ? (report.conversions / report.alertsClicked) * 100 : 0;

  return (
    <main style={{ maxWidth: 720, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui", lineHeight: 1.6 }}>
      <p>
        <Link href="/transparency">← All reports</Link>
      </p>
      <h1>Transparency Report — {report.quarter.toUpperCase()}</h1>
      <p style={{ color: "#666" }}>Published {report.publishedAt}</p>

      <h2>Affiliate revenue</h2>
      <ul>
        <li>Total commission: <b>{report.commissionVnd.toLocaleString("vi-VN")} ₫</b></li>
        <li>Alerts sent: {report.alertsSent.toLocaleString("vi-VN")}</li>
        <li>Alerts clicked: {report.alertsClicked.toLocaleString("vi-VN")} (CTR {ctr.toFixed(1)}%)</li>
        <li>Conversions: {report.conversions.toLocaleString("vi-VN")} (rate {conversionRate.toFixed(1)}%)</li>
      </ul>

      <h2>5-ethics audit</h2>
      <p>Status: <b style={{ color: { green: "#2f855a", amber: "#c05621", red: "#c53030" }[report.ethicsStatus] }}>{report.ethicsStatus.toUpperCase()}</b></p>

      <h2>Privacy & incidents</h2>
      <p>Incident count this quarter: {report.incidents}</p>

      <h2>Notes</h2>
      <p>{report.notes}</p>

      <p style={{ marginTop: 48, fontSize: 13, color: "#666" }}>
        Signed by Stephen Cheng, DPO · <a href="mailto:legal@salenoti.vn">legal@salenoti.vn</a>
      </p>
    </main>
  );
}
