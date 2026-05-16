// FR-WATCH-001 §1 #2 — Shopee URL parser.
// Accepts canonical product URL shapes; rejects non-shopee.vn.
const SHOPEE_URL_REGEX = /^https?:\/\/(?:www\.)?shopee\.vn\/(?:[^\s]+-)?i\.(\d+)\.(\d+)(?:\?.*)?$/i;

export type ParsedShopeeUrl = { shopId: number; itemId: number };

export function parseShopeeUrl(url: string): ParsedShopeeUrl | null {
  if (typeof url !== "string" || url.length > 2000) return null;
  const m = url.match(SHOPEE_URL_REGEX);
  if (!m) return null;
  const shopId = Number(m[1]);
  const itemId = Number(m[2]);
  if (!Number.isSafeInteger(shopId) || !Number.isSafeInteger(itemId)) return null;
  if (shopId <= 0 || itemId <= 0) return null;
  return { shopId, itemId };
}
