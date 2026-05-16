// FR-GROW-002 — Share deal service.
import crypto from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";

@Injectable()
export class ShareService {
  constructor(@Inject("OBS_POSTHOG") private readonly posthog: any) {}

  async createShare(args: { userId: string; productId: string }): Promise<{
    shareToken: string;
    shareUrl: string;
    title: string;
    description: string;
    imageUrl: string | null;
    ogImage: string;
  }> {
    const m = args.productId.match(/^(\d+)-(\d+)$/);
    if (!m) throw new BadRequestException({ error: "invalid_product_id" });
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });
    if (!product) throw new BadRequestException({ error: "product_not_found" });

    const shareToken = this.newShareToken();
    await mongo.db("salenoti").collection("shares").insertOne({
      shareToken,
      sharerId: new ObjectId(args.userId),
      productId: args.productId,
      createdAt: new Date(),
      clicks: 0,
      signups: 0,
      conversions: 0,
    });

    const appUrl = process.env.APP_URL ?? "https://salenoti.vn";
    const slug = product.slug ?? `i-${product.shopId}-${product.itemId}`;
    const shareUrl = `${appUrl}/deal/${slug}?s=${shareToken}`;
    const ogImage = `${appUrl}/og/deal/${args.productId}.jpg`;

    const discountPct = product.currentDiscountPct ?? 0;
    const formattedPrice = new Intl.NumberFormat("vi-VN").format(product.currentPrice ?? 0);

    this.posthog.capture("share_created", { productId: args.productId });

    return {
      shareToken,
      shareUrl,
      title: `${product.name ?? "Sản phẩm"} — giảm ${discountPct}%`,
      description: `Mua giá tốt: ${formattedPrice} ₫. Theo dõi giá miễn phí trên SaleNoti.`,
      imageUrl: product.imageUrl ?? null,
      ogImage,
    };
  }

  /** Record a share landing visit + maybe attribute a signup. */
  async onLandingVisit(args: { shareToken: string; source: "facebook" | "zalo" | "telegram" | "direct" }): Promise<void> {
    await mongo.db("salenoti").collection("shares").updateOne(
      { shareToken: args.shareToken },
      { $inc: { clicks: 1 } }
    );
    this.posthog.capture("share_landing_view", { shareToken: args.shareToken.slice(0, 6), source: args.source });
  }

  async onSignupAttribution(args: { shareToken: string; newUserId: string }): Promise<void> {
    const newOid = new ObjectId(args.newUserId);
    const share = await mongo.db("salenoti").collection("shares").findOneAndUpdate(
      { shareToken: args.shareToken },
      { $inc: { signups: 1 } },
      { returnDocument: "after" }
    );
    if (!share) return;
    await mongo.db("salenoti").collection("users").updateOne(
      { _id: newOid },
      { $set: { acquiredVia: { kind: "share", shareToken: args.shareToken, sharerId: share.sharerId } } }
    );
    this.posthog.capture("share_landing_signup", { shareToken: args.shareToken.slice(0, 6) });
  }

  private newShareToken(): string {
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const bytes = crypto.randomBytes(8);
    let out = "";
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }
}
