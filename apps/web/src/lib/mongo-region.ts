export type MongoRegion = "sg" | "us";

const SOUTH_EAST_ASIA_COUNTRIES = new Set(["SG", "MY", "TH", "PH", "VN", "ID", "KH"]);
const SOUTH_EAST_ASIA_LOCALES = ["vi_VN", "th_TH", "fil_PH", "id_ID", "ms_MY", "km_KH"] as const;

export function normalizeMongoRegion(value?: string | null): MongoRegion | null {
  return value === "sg" || value === "us" ? value : null;
}

export function getMongoRegionFromCountry(country?: string | null): MongoRegion {
  if (!country) return "sg";
  return SOUTH_EAST_ASIA_COUNTRIES.has(country.trim().toUpperCase()) ? "sg" : "us";
}

export function getMongoRegionFromLocale(locale?: string | null): MongoRegion {
  if (!locale) return "sg";
  const normalized = locale.replace("-", "_");
  return SOUTH_EAST_ASIA_LOCALES.some((candidate) => normalized.startsWith(candidate)) ? "sg" : "us";
}
