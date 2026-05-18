// FR-WATCH-001 §1 #2 — Shopee URL parser.
// Accepts canonical, legacy, mall, and deeplink product URL shapes; rejects non-shopee.vn.
const TRACKING_PARAM_PREFIXES = ["utm_", "__cf_chl_", "af_"];
const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

export type ParsedShopeeUrl = { shopId: number; itemId: number };

export function parseShopeeUrl(input: string): ParsedShopeeUrl | null {
  if (typeof input !== "string" || input.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "shopee.vn" && url.hostname !== "www.shopee.vn") return null;

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      url.searchParams.delete(key);
    }
  }

  const path = decodeURIComponent(url.pathname);
  const canonical = path.match(/(?:^|-)i\.(\d+)\.(\d+)$/i);
  const legacy = path.match(/^\/product\/(\d+)\/(\d+)$/i);
  const mall = path.match(/^\/shopee-mall\/(\d+)\/(\d+)$/i);
  const fallbackShopId = Number(url.searchParams.get("shopid"));
  const fallbackItemId = Number(url.searchParams.get("itemid"));

  const [, shopRaw, itemRaw] = canonical ?? legacy ?? mall ?? [];
  const shopId = Number(shopRaw ?? fallbackShopId);
  const itemId = Number(itemRaw ?? fallbackItemId);
  if (!Number.isSafeInteger(shopId) || !Number.isSafeInteger(itemId)) return null;
  if (shopId <= 0 || itemId <= 0) return null;
  return { shopId, itemId };
}
