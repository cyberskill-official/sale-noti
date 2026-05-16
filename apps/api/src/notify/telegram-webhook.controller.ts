// FR-NOTIF-003 §1 #4 + #7 + #8 — Telegram webhook handler (/start, /unsubscribe, /help, /status).
import crypto from "node:crypto";
import { Body, Controller, HttpException, HttpStatus, Post, Query } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { mongo } from "../db/mongo";

const TELEGRAM_API = "https://api.telegram.org";

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function linkTokenFor(userId: string): string {
  const salt = process.env.TELEGRAM_LINK_SALT ?? "";
  return crypto.createHash("sha256").update(`${userId}|${salt}|${dayBucket()}`).digest("hex").slice(0, 16);
}

function userIdFromToken(token: string): Promise<string | null> {
  // Reverse: scan today's + yesterday's day-buckets for any user matching the token.
  return (async () => {
    const salt = process.env.TELEGRAM_LINK_SALT ?? "";
    const buckets = [dayBucket(), dayBucket() - 1];
    const users = await mongo.db("salenoti").collection("users").find({}, { projection: { _id: 1 } }).toArray();
    for (const u of users) {
      for (const b of buckets) {
        const expected = crypto.createHash("sha256").update(`${u._id}|${salt}|${b}`).digest("hex").slice(0, 16);
        if (expected === token) return String(u._id);
      }
    }
    return null;
  })();
}

@Controller("webhooks/telegram")
export class TelegramWebhookController {
  @Post()
  async handle(@Body() update: any, @Query("secret") secret: string | undefined) {
    if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      throw new HttpException("forbidden", HttpStatus.FORBIDDEN);
    }
    const msg = update?.message;
    if (!msg?.text) return { ok: true };
    const chatId: number = msg.chat.id;
    const text: string = msg.text.trim();

    if (text.startsWith("/start")) {
      const arg = text.replace("/start", "").trim();
      if (!arg) {
        await this.reply(chatId, [
          "Chào mừng đến SaleNoti bot 👋",
          "",
          "Vào dashboard SaleNoti → Settings → Telegram → 'Liên kết bot' để lấy link cá nhân hóa.",
          "",
          "SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm.",
        ].join("\n"));
        return { ok: true };
      }
      const userId = await userIdFromToken(arg);
      if (!userId) {
        await this.reply(chatId, "Link đã hết hạn (24h). Vào dashboard SaleNoti lấy link mới.");
        return { ok: true };
      }
      await mongo.db("salenoti").collection("users").updateOne(
        { _id: this.oid(userId) },
        { $set: { telegramChatId: chatId, "notificationChannels.telegram": true } }
      );
      await this.reply(
        chatId,
        [
          "✅ Đã liên kết. Bạn sẽ nhận alert giá trên Telegram.",
          "",
          "Lệnh hữu ích:",
          "/status — số sản phẩm đang theo dõi",
          "/unsubscribe — tắt alert Telegram",
          "/help — danh sách lệnh",
          "",
          "SaleNoti là price-tracker affiliate. Click → hoa hồng. Bạn không trả thêm.",
        ].join("\n")
      );
      return { ok: true };
    }

    if (text === "/help") {
      await this.reply(chatId, "/start <token> · /status · /unsubscribe");
      return { ok: true };
    }

    if (text === "/status") {
      const user = await mongo.db("salenoti").collection("users").findOne({ telegramChatId: chatId });
      if (!user) {
        await this.reply(chatId, "Chưa liên kết. Dùng /start <token> từ dashboard.");
        return { ok: true };
      }
      const count = await mongo.db("salenoti").collection("watchlists").countDocuments({ userId: user._id, status: "active" });
      const cap = user.plan === "free" ? 10 : user.plan === "pro" ? 200 : 99999;
      await this.reply(chatId, `Đang theo dõi: ${count} / ${cap} (${user.plan ?? "free"} plan)`);
      return { ok: true };
    }

    if (text === "/unsubscribe") {
      await mongo.db("salenoti").collection("users").updateOne(
        { telegramChatId: chatId },
        { $unset: { telegramChatId: "" }, $set: { "notificationChannels.telegram": false } }
      );
      await this.reply(chatId, "Đã tắt alert Telegram. Bạn vẫn nhận email/push nếu đã bật.");
      return { ok: true };
    }

    return { ok: true };
  }

  private async reply(chatId: number, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
    });
  }

  private oid(id: string): ObjectId {
    // User IDs persist as ObjectId hex. If the value isn't valid hex, we cannot match
    // the row anyway — throwing surfaces the schema bug fast (consistent with the
    // other notify processors).
    return new ObjectId(id);
  }
}

export { linkTokenFor };
