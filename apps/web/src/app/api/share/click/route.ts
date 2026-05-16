// FR-GROW-002 §8 — record click on deal page CTA, then 302 to Shopee affiliate URL.
import { mongo } from "@/server/db/mongo";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = url.searchParams.get("s");
  const pid = url.searchParams.get("pid");
  if (!pid) return Response.redirect(new URL("/", req.url), 302);

  const m = pid.match(/^(\d+)-(\d+)$/);
  if (!m) return Response.redirect(new URL("/", req.url), 302);

  const product = await mongo
    .db("salenoti")
    .collection("products")
    .findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });

  if (!product?.affiliateLink) return Response.redirect(new URL("/", req.url), 302);

  if (s) {
    await mongo.db("salenoti").collection("shares").updateOne({ shareToken: s }, { $inc: { clicks: 1 } });
  }
  return Response.redirect(product.affiliateLink, 302);
}
