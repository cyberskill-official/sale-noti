import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommissionReconcileProcessor } from "../commission-reconcile.processor";

const state = vi.hoisted(() => ({
  link: null as any,
  affiliateUpdates: [] as any[],
  unmatchedUpdates: [] as any[],
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "affiliate_links") {
          return {
            findOne: async () => state.link,
            updateOne: async (...args: any[]) => {
              state.affiliateUpdates.push(args);
              return { matchedCount: state.link ? 1 : 0, modifiedCount: state.link ? 1 : 0 };
            },
          };
        }
        if (name === "affiliate_commission_unmatched") {
          return {
            updateOne: async (...args: any[]) => {
              state.unmatchedUpdates.push(args);
              return { upsertedCount: 1 };
            },
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

vi.mock("../../obs/posthog", () => ({
  posthog: {
    capture: vi.fn(),
  },
}));

describe("FR-AFF-002/P2 — commission reconcile processor", () => {
  beforeEach(() => {
    state.link = {
      _id: "link-1",
      productId: "123-456",
      source: "alert_email",
      campaign: "default",
      shortUrl: "https://shope.ee/abc",
      conversions: [],
    };
    state.affiliateUpdates = [];
    state.unmatchedUpdates = [];
  });

  it("persists a confirmed conversion onto the affiliate link", async () => {
    const processor = new CommissionReconcileProcessor();

    await processor.process({
      id: "job-1",
      data: {
        transactionId: "txn-1",
        shortUrl: "https://shope.ee/abc",
        commissionVnd: 12_000,
        orderAmountVnd: 400_000,
        status: "confirmed",
      },
    } as any);

    expect(state.affiliateUpdates).toHaveLength(1);
    expect(state.affiliateUpdates[0][1].$push.conversions).toMatchObject({
      transactionId: "txn-1",
      status: "confirmed",
      commissionVnd: 12_000,
      orderAmountVnd: 400_000,
      currency: "VND",
      source: "shopee",
    });
    expect(state.affiliateUpdates[0][1].$inc).toEqual({ confirmedCommissionVnd: 12_000 });
  });

  it("updates an existing conversion and applies only the confirmed commission delta", async () => {
    state.link.conversions = [{ transactionId: "txn-1", status: "pending", commissionVnd: 0 }];
    const processor = new CommissionReconcileProcessor();

    await processor.process({
      id: "job-2",
      data: {
        transactionId: "txn-1",
        subIds: ["salenoti", "userhash", "wlhash", "alert_email", "default"],
        commissionVnd: 15_000,
        status: "confirmed",
      },
    } as any);

    expect(state.affiliateUpdates[0][1].$set["conversions.$"]).toMatchObject({
      transactionId: "txn-1",
      status: "confirmed",
      commissionVnd: 15_000,
    });
    expect(state.affiliateUpdates[0][1].$inc).toEqual({ confirmedCommissionVnd: 15_000 });
  });

  it("records unmatched provider events instead of silently dropping them", async () => {
    state.link = null;
    const processor = new CommissionReconcileProcessor();

    await processor.process({
      id: "job-3",
      data: {
        transactionId: "txn-missing",
        shortUrl: "https://shope.ee/missing",
        commissionVnd: 1_000,
      },
    } as any);

    expect(state.affiliateUpdates).toHaveLength(0);
    expect(state.unmatchedUpdates[0][0]).toEqual({ transactionId: "txn-missing" });
    expect(state.unmatchedUpdates[0][2]).toEqual({ upsert: true });
  });
});
