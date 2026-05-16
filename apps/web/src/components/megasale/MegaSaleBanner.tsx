// FR-GROW-003 §1 #2 — Mega Sale Mode banner. Server component; data loaded inline.
import Link from "next/link";

const SALES = [
  { slug: "2026-09-09", label: "9.9 Super Sale", startsAt: new Date("2026-09-09T00:00:00+07:00"), endsAt: new Date("2026-09-09T23:59:59+07:00"), themeColor: "#FF5722", hashtag: "9.9SaleNoti" },
  { slug: "2026-10-10", label: "10.10 Brand Day", startsAt: new Date("2026-10-10T00:00:00+07:00"), endsAt: new Date("2026-10-10T23:59:59+07:00"), themeColor: "#E91E63", hashtag: "10.10SaleNoti" },
  { slug: "2026-11-11", label: "11.11 Double Eleven", startsAt: new Date("2026-11-11T00:00:00+07:00"), endsAt: new Date("2026-11-11T23:59:59+07:00"), themeColor: "#FAA227", hashtag: "11.11SaleNoti" },
  { slug: "2026-12-12", label: "12.12 Birthday Sale", startsAt: new Date("2026-12-12T00:00:00+07:00"), endsAt: new Date("2026-12-12T23:59:59+07:00"), themeColor: "#C026D3", hashtag: "12.12SaleNoti" },
];

const PRE_WINDOW_MS = 7 * 86_400_000;

export function MegaSaleBanner() {
  const now = new Date();
  let active: (typeof SALES)[number] | null = null;
  let stage: "live" | "pre" | null = null;
  for (const s of SALES) {
    if (now >= s.startsAt && now <= s.endsAt) {
      active = s;
      stage = "live";
      break;
    }
    if (now < s.startsAt && s.startsAt.getTime() - now.getTime() <= PRE_WINDOW_MS) {
      active = s;
      stage = "pre";
      break;
    }
  }
  if (!active) return null;

  const ms = active.startsAt.getTime() - now.getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);

  return (
    <div
      style={{
        background: active.themeColor,
        color: "white",
        padding: "12px 16px",
        borderRadius: 12,
        margin: "16px 0",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 700 }}>🔥 {active.label}</span>
      <span style={{ flex: 1, fontSize: 14 }}>
        {stage === "live" ? "ĐANG DIỄN RA — săn deal ngay" : `Còn ${days} ngày ${hours} giờ`}
      </span>
      <Link
        href={`/megasale/${active.slug}`}
        style={{ background: "white", color: active.themeColor, padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontWeight: 600, fontSize: 14 }}
      >
        Xem top deals →
      </Link>
    </div>
  );
}
