// FR-GROW-003 §3 — Mega Sale event calendar.
// Add a new row here per quarter. Operator override via `salenoti-cli megasale enable <slug>` writes
// a `mega_sale_override` Mongo doc; the lookup in megasale.service.ts merges both.

export type MegaSale = {
  slug: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  themeColor: string;
  hashtag: string;
};

export const MEGA_SALES: MegaSale[] = [
  {
    slug: "2026-09-09",
    label: "9.9 Super Sale",
    startsAt: new Date("2026-09-09T00:00:00+07:00"),
    endsAt: new Date("2026-09-09T23:59:59+07:00"),
    themeColor: "#FF5722",
    hashtag: "9.9SaleNoti",
  },
  {
    slug: "2026-10-10",
    label: "10.10 Brand Day",
    startsAt: new Date("2026-10-10T00:00:00+07:00"),
    endsAt: new Date("2026-10-10T23:59:59+07:00"),
    themeColor: "#E91E63",
    hashtag: "10.10SaleNoti",
  },
  {
    slug: "2026-11-11",
    label: "11.11 Double Eleven",
    startsAt: new Date("2026-11-11T00:00:00+07:00"),
    endsAt: new Date("2026-11-11T23:59:59+07:00"),
    themeColor: "#FAA227",
    hashtag: "11.11SaleNoti",
  },
  {
    slug: "2026-12-12",
    label: "12.12 Birthday Sale",
    startsAt: new Date("2026-12-12T00:00:00+07:00"),
    endsAt: new Date("2026-12-12T23:59:59+07:00"),
    themeColor: "#C026D3",
    hashtag: "12.12SaleNoti",
  },
];

const PRE_WINDOW_MS = 7 * 86_400_000;

export function activeOrUpcomingSale(now = new Date()): { sale: MegaSale | null; stage: "live" | "pre" | "none" } {
  for (const s of MEGA_SALES) {
    if (now >= s.startsAt && now <= s.endsAt) return { sale: s, stage: "live" };
    if (now < s.startsAt && s.startsAt.getTime() - now.getTime() <= PRE_WINDOW_MS) return { sale: s, stage: "pre" };
  }
  return { sale: null, stage: "none" };
}
