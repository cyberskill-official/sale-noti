import crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccessTradeApiError } from "./errors";
import { AccessTradePublisherClient } from "./client";
import type { AccessTradeFallbackInput, AccessTradeFallbackResult } from "./types";

@Injectable()
export class AccessTradeFallbackService {
  constructor(
    private readonly cfg: ConfigService,
    private readonly client: AccessTradePublisherClient,
  ) {}

  async generateFallbackLink(input: AccessTradeFallbackInput): Promise<AccessTradeFallbackResult> {
    if (input.respectOtherPublisher) {
      return { url: input.originUrl, expiresAt: null, cached: false };
    }

    const defaultCampaignId = this.getRequiredConfig("ACCESSTRADE_DEFAULT_CAMPAIGN_ID");
    const campaigns = await this.client.listCampaigns({ approval: "successful" });
    if (campaigns.length === 0) {
      throw new AccessTradeApiError("no_results", "No approved AccessTrade campaigns available");
    }

    const selectedCampaign = campaigns.find((campaign) => campaign.id === defaultCampaignId);
    if (!selectedCampaign) {
      throw new AccessTradeApiError("no_results", `Configured AccessTrade campaign ${defaultCampaignId} is not available`);
    }

    const subIds = this.buildSubIds(input);
    const link = await this.client.createTrackingLink({
      campaignId: defaultCampaignId,
      urls: [input.originUrl],
      utmSource: "salenoti",
      utmMedium: "affiliate_fallback",
      utmCampaign: subIds[4],
      utmContent: subIds[3],
      subIds: {
        sub1: subIds[1],
        sub2: subIds[2],
        sub3: subIds[3],
        sub4: subIds[4],
      },
    });

    return {
      url: link.shortLink ?? link.affiliateLink,
      expiresAt: null,
      cached: false,
    };
  }

  private buildSubIds(input: AccessTradeFallbackInput): [string, string, string, string, string] {
    const userHash = this.hash(input.userId, this.deeplinkSalt()).slice(0, 12);
    const watchlistHash = input.watchlistId ? this.hash(input.watchlistId).slice(0, 8) : "0";
    return ["salenoti", userHash, watchlistHash, this.scrubToken(input.source), this.scrubToken(input.campaign)];
  }

  private deeplinkSalt(): string {
    const salt = this.getRequiredConfig("DEEPLINK_SALT");
    if (!/^[a-f0-9]{32,}$/i.test(salt)) throw new Error("DEEPLINK_SALT_WEAK");
    return salt;
  }

  private getRequiredConfig(key: string): string {
    const value = this.cfg.get<string>(key);
    if (typeof value !== "string" || value.trim() === "") {
      throw new AccessTradeApiError("config_error", `Missing config: ${key}`);
    }
    return value.trim();
  }

  private scrubToken(value: string | undefined): string {
    if (!value) return "default";
    const scrubbed = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
    return scrubbed || "default";
  }

  private hash(value: string, salt = ""): string {
    return crypto.createHash("sha256").update(value + salt).digest("hex");
  }
}
