import { describe, it, expect } from "vitest";
import { parseShopeeUrl } from "../url-parser";

describe("FR-WATCH-001 — parseShopeeUrl", () => {
  it("AC1: valid product URL", () => {
    expect(parseShopeeUrl("https://shopee.vn/Áo-thun-nam-basic-i.123.4567890")).toEqual({ shopId: 123, itemId: 4567890 });
  });

  it("with www. subdomain", () => {
    expect(parseShopeeUrl("https://www.shopee.vn/foo-i.1.2")).toEqual({ shopId: 1, itemId: 2 });
  });

  it("with query string", () => {
    expect(parseShopeeUrl("https://shopee.vn/x-i.1.2?af_short_link_id=abc")).toEqual({ shopId: 1, itemId: 2 });
  });

  it("AC2: rejects non-shopee.vn", () => {
    expect(parseShopeeUrl("https://tiki.vn/x-i.1.2")).toBeNull();
    expect(parseShopeeUrl("https://shopee.com.vn/x-i.1.2")).toBeNull();
  });

  it("rejects malformed", () => {
    expect(parseShopeeUrl("https://shopee.vn/")).toBeNull();
    expect(parseShopeeUrl("not a url")).toBeNull();
    expect(parseShopeeUrl("https://shopee.vn/x-i.0.0")).toBeNull();
  });

  it("rejects oversize input", () => {
    expect(parseShopeeUrl("https://shopee.vn/" + "x".repeat(3000) + "-i.1.2")).toBeNull();
  });
});
