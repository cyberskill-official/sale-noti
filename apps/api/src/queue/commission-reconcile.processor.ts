import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { z } from "zod";
import { mongo } from "../db/mongo";
import { posthog } from "../obs/posthog";
import { QUEUE_CONCURRENCY } from "./queues";

const CommissionJobSchema = z
  .object({
    transactionId: z.string().trim().min(1).max(120),
    status: z.enum(["pending", "confirmed", "rejected", "refunded"]).default("confirmed"),
    commissionVnd: z.coerce.number().finite().min(0).max(1_000_000_000).default(0),
    orderAmountVnd: z.coerce.number().finite().min(0).max(10_000_000_000).optional(),
    currency: z.string().trim().min(3).max(3).default("VND"),
    eventAt: z.union([z.string(), z.date()]).optional(),
    source: z.enum(["shopee", "manual_import", "provider_webhook"]).default("shopee"),
    shortUrl: z.string().url().optional(),
    subIds: z.array(z.string().trim().min(1).max(64)).min(1).max(5).optional(),
    rawRef: z.string().trim().max(160).optional(),
  })
  .refine((value) => value.shortUrl || value.subIds?.length, {
    message: "shortUrl or subIds is required",
    path: ["shortUrl"],
  });

type CommissionJob = z.infer<typeof CommissionJobSchema>;
type AffiliateLinkDoc = {
  _id: unknown;
  conversions: any[];
  confirmedCommissionVnd?: number;
  productId?: string;
  source?: string;
  campaign?: string;
  [key: string]: any;
};

@Processor("commission-reconcile", { concurrency: QUEUE_CONCURRENCY["commission-reconcile"] })
export class CommissionReconcileProcessor extends WorkerHost {
  private readonly log = new Logger(CommissionReconcileProcessor.name);

  async process(job: Job): Promise<void> {
    const payload = CommissionJobSchema.parse(job.data);
    const links = mongo.db("salenoti").collection<AffiliateLinkDoc>("affiliate_links");
    const query = this.buildAffiliateLinkQuery(payload);
    const link = await links.findOne(query);

    if (!link) {
      await this.recordUnmatched(payload, job.id);
      this.log.warn(`commission reconcile unmatched transaction ${payload.transactionId}`);
      posthog.capture("affiliate_commission_unmatched", {
        transactionId: payload.transactionId,
        source: payload.source,
        hasShortUrl: Boolean(payload.shortUrl),
        hasSubIds: Boolean(payload.subIds?.length),
      });
      return;
    }

    const eventAt = payload.eventAt ? new Date(payload.eventAt) : new Date();
    const existing = Array.isArray(link.conversions)
      ? link.conversions.find((conversion: any) => conversion?.transactionId === payload.transactionId)
      : null;
    const previousConfirmed = existing?.status === "confirmed" ? Number(existing.commissionVnd ?? 0) : 0;
    const nextConfirmed = payload.status === "confirmed" ? payload.commissionVnd : 0;
    const confirmedDelta = nextConfirmed - previousConfirmed;

    const conversion = {
      transactionId: payload.transactionId,
      status: payload.status,
      commissionVnd: payload.commissionVnd,
      orderAmountVnd: payload.orderAmountVnd ?? null,
      currency: payload.currency,
      eventAt,
      source: payload.source,
      rawRef: payload.rawRef ?? null,
      reconciledAt: new Date(),
    };

    if (existing) {
      await links.updateOne(
        { _id: link._id, "conversions.transactionId": payload.transactionId },
        {
          $set: {
            "conversions.$": conversion,
            lastConversionAt: eventAt,
            updatedAt: new Date(),
          },
          ...(confirmedDelta ? { $inc: { confirmedCommissionVnd: confirmedDelta } } : {}),
        }
      );
    } else {
      const update: any = {
        $push: { conversions: conversion },
        $set: {
          lastConversionAt: eventAt,
          updatedAt: new Date(),
        },
      };
      if (confirmedDelta) update.$inc = { confirmedCommissionVnd: confirmedDelta };
      await links.updateOne(
        { _id: link._id, "conversions.transactionId": { $ne: payload.transactionId } },
        update
      );
    }

    posthog.capture("affiliate_commission_reconciled", {
      source: payload.source,
      status: payload.status,
      commissionVnd: payload.commissionVnd,
      currency: payload.currency,
      productId: link.productId,
      deeplinkSource: link.source,
      campaign: link.campaign,
    });
  }

  private buildAffiliateLinkQuery(payload: CommissionJob): Record<string, any> {
    const ors: Record<string, any>[] = [];
    if (payload.shortUrl) ors.push({ shortUrl: payload.shortUrl });
    if (payload.subIds?.length) ors.push({ subIds: payload.subIds });
    if (ors.length === 1) return ors[0]!;
    return { $or: ors };
  }

  private async recordUnmatched(payload: CommissionJob, jobId: string | number | undefined) {
    await mongo
      .db("salenoti")
      .collection<any>("affiliate_commission_unmatched")
      .updateOne(
        { transactionId: payload.transactionId },
        {
          $setOnInsert: {
            transactionId: payload.transactionId,
            firstSeenAt: new Date(),
            payload,
          },
          $set: {
            lastSeenAt: new Date(),
            lastJobId: jobId ? String(jobId) : null,
          },
          $inc: { attempts: 1 },
        },
        { upsert: true }
      );
  }
}
