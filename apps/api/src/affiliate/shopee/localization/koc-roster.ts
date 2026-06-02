export interface ShopeeThailandKocRosterEntry {
  slug: string;
  displayName: string;
  channel: "line" | "facebook" | "tiktok" | "youtube";
  vertical: "beauty" | "fashion" | "electronics" | "home" | "mom-baby";
  respectOtherPublisher: true;
}

const ROSTER: ReadonlyArray<ShopeeThailandKocRosterEntry> = Object.freeze([
  Object.freeze({
    slug: "th-beauty-weekly",
    displayName: "Thai Beauty Weekly",
    channel: "line",
    vertical: "beauty",
    respectOtherPublisher: true,
  }),
  Object.freeze({
    slug: "th-fashion-finds",
    displayName: "Thai Fashion Finds",
    channel: "tiktok",
    vertical: "fashion",
    respectOtherPublisher: true,
  }),
  Object.freeze({
    slug: "th-home-hacks",
    displayName: "Thai Home Hacks",
    channel: "youtube",
    vertical: "home",
    respectOtherPublisher: true,
  }),
]);

export function getShopeeThailandKocRoster(): ReadonlyArray<ShopeeThailandKocRosterEntry> {
  return ROSTER;
}
