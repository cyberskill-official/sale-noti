// FR-NOTIF-003 §6 — Telegram bot processor.
import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";
import { alertIdem, dailyCount, reserveSend } from "./idempotency";
import { DeeplinkService } from "../affiliate/deeplink.service";
import type { AlertJobData } from "./notify-email.processor";

const DAILY_CAP = 20;
const TELEGRAM_API = "https://api.telegram.org";
const TRUNC_DISCLOSURE =
  "SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm. Đọc đầy đủ: salenoti.vn/legal/affiliate";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

@Processor("alert-dispatch", { name: "telegram" })
export class NotifyTelegramProcessor extends WorkerHost {
  private readonly log = new Logger(NotifyTelegramProcessor.name);

  constructor(
    private readonly deeplink: DeeplinkService,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    @Inject("OBS_SENTRY") private readonly sentry: any
  ) {
    super();
  }

  async process(job: Job<AlertJobData>): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.log.debug("[telegram] TELEGRAM_BOT_TOKEN missing — skipping");
      return;
    }

    const observedAt = job.data.observedAt instanceof Date ? job.data.observedAt : new Date(job.data.observedAt);
    const { userId, watchlistId, triggerKind } = job.data;

    const user = await mongo.db("salenoti").collection("users").findOne({ _id: this.oid(userId) });
    if (!user) return;
    if (!user.notificationChannels?.telegram) return;
    if (!user.telegramChatId) return;
    if ((await dailyCount(userId)) >= DAILY_CAP) return;

    const idem = alertIdem({ userId, watchlistId, triggerKind, observedAt });
    if (!(await reserveSend({ userId, watchlistId, channel: "telegram", idem }))) return;

    const watchlist = await mongo.db("salenoti").collection("watchlists").findOne({ _id: this.oid(watchlistId) });
    if (!watchlist) return;
    const m = String(watchlist.productId).match(/^(\d+)-(\d+)$/);
    if (!m) return;
    const product = await mongo.db("salenoti").collection("products").findOne({ shopId: Number(m[1]), itemId: Number(m[2]) });
    if (!product) return;

    const deepLinkResult = await this.deeplink.generate({
      userId,
      productId: watchlist.productId,
      source: "alert_telegram",
      watchlistId,
    });

    const formatVnd = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
    const text = [
      `🔥 <b>${escapeHtml(product.name ?? "Sản phẩm")}</b>`,
      `Giảm ${product.currentDiscountPct ?? 0}% — ${formatVnd(product.currentPrice ?? 0)}`,
      `<i>${TRUNC_DISCLOSURE}</i>`,
    ].join("\n");

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: user.telegramChatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: [[{ text: "Mua ngay →", url: `${deepLinkResult.url}?utm=telegram&idem=${idem}` }]],
          },
        }),
      });
      if (res.status === 403) {
        // User blocked bot — clear chat id, switch off telegram channel.
        await mongo.db("salenoti").collection("users").updateOne(
          { _id: this.oid(userId) },
          { $unset: { telegramChatId: "" }, $set: { "notificationChannels.telegram": false } }
        );
        return;
      }
      if (!res.ok) {
        throw new Error(`Telegram ${res.status}: ${await res.text()}`);
      }
      const body: any = await res.json();
      await mongo.db("salenoti").collection("notifications").updateOne(
        { idem, channel: "telegram" },
        { $set: { telegramMessageId: body?.result?.message_id } }
      );
    } catch (e) {
      this.sentry.captureException(e, { tags: { fr: "FR-NOTIF-003" } });
      throw e;
    }

    this.posthog.capture("alert_sent", {
      channel: "telegram",
      trigger: triggerKind,
      productId: watchlist.productId,
    });
  }

  private oid(id: string): ObjectId | string {
    try {
      return new ObjectId(id);
    } catch {
      return id;
    }
  }
}
