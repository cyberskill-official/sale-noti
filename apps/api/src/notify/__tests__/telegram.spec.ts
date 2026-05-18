import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotifyTelegramProcessor } from "../notify-telegram.processor";
import { TelegramWebhookController, linkTokenFor } from "../telegram-webhook.controller";

const userId = "665000000000000000000041";
const watchlistId = "665000000000000000000042";

const state = vi.hoisted(() => ({
  users: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    find: vi.fn(),
  },
  watchlists: {
    findOne: vi.fn(),
    countDocuments: vi.fn(),
  },
  products: {
    findOne: vi.fn(),
  },
  notifications: {
    updateOne: vi.fn(),
  },
  alertIdem: vi.fn(),
  dailyCount: vi.fn(),
  reserveSend: vi.fn(),
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => {
        if (name === "users") return state.users;
        if (name === "watchlists") return state.watchlists;
        if (name === "products") return state.products;
        if (name === "notifications") return state.notifications;
        throw new Error(`unexpected collection ${name}`);
      },
    }),
  },
}));

vi.mock("../idempotency", () => ({
  alertIdem: (...args: any[]) => state.alertIdem(...args),
  dailyCount: (...args: any[]) => state.dailyCount(...args),
  reserveSend: (...args: any[]) => state.reserveSend(...args),
}));

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      userId,
      watchlistId,
      triggerKind: "flash_sale",
      observedAt: new Date("2026-05-18T09:00:00.000Z"),
      channels: ["telegram"],
      ...overrides,
    },
  } as any;
}

describe("FR-NOTIF-003 — Telegram bot", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret";
    process.env.TELEGRAM_LINK_SALT = "telegram-salt";
    state.users.findOne.mockResolvedValue({
      _id: new ObjectId(userId),
      plan: "pro",
      telegramChatId: 12345,
      notificationChannels: { telegram: true },
    });
    state.users.updateOne.mockResolvedValue({ modifiedCount: 1 });
    state.users.find.mockReturnValue({ toArray: vi.fn(async () => [{ _id: new ObjectId(userId) }]) });
    state.watchlists.findOne.mockResolvedValue({ _id: new ObjectId(watchlistId), productId: "123-456" });
    state.watchlists.countDocuments.mockResolvedValue(4);
    state.products.findOne.mockResolvedValue({ shopId: 123, itemId: 456, name: "<b>Áo</b>", currentPrice: 89_000, currentDiscountPct: 31 });
    state.notifications.updateOne.mockResolvedValue({ modifiedCount: 1 });
    state.alertIdem.mockReturnValue("abcdef1234567890abcdef1234567890");
    state.dailyCount.mockResolvedValue(0);
    state.reserveSend.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ result: { message_id: 987 } }), text: async () => "ok" })));
  });

  it("sends escaped affiliate-disclosed Telegram alerts with idempotent attribution", async () => {
    const deeplink = { generate: vi.fn(async () => ({ url: "https://shope.ee/abc", cached: false })) };
    const posthog = { capture: vi.fn() };
    const sentry = { captureException: vi.fn() };
    const processor = new NotifyTelegramProcessor(deeplink as any, posthog, sentry);

    await processor.process(makeJob());

    expect(state.reserveSend).toHaveBeenCalledWith({ userId, watchlistId, channel: "telegram", idem: "abcdef1234567890abcdef1234567890" });
    expect(deeplink.generate).toHaveBeenCalledWith({ userId, productId: "123-456", source: "alert_telegram", watchlistId });
    const request = JSON.parse(String((fetch as any).mock.calls[0][1].body));
    expect(request).toMatchObject({
      chat_id: 12345,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Mua ngay →", url: "https://shope.ee/abc?utm=telegram&idem=abcdef1234567890abcdef1234567890" }]] },
    });
    expect(request.text).toContain("&lt;b&gt;Áo&lt;/b&gt;");
    expect(request.text).toContain("SaleNoti là price-tracker affiliate");
    expect(state.notifications.updateOne).toHaveBeenCalledWith(
      { idem: "abcdef1234567890abcdef1234567890", channel: "telegram" },
      { $set: { telegramMessageId: 987 } },
    );
    expect(posthog.capture).toHaveBeenCalledWith("alert_sent", { channel: "telegram", trigger: "flash_sale", productId: "123-456" });
  });

  it("skips unsupported jobs and disables Telegram when the bot is blocked", async () => {
    const processor = new NotifyTelegramProcessor({ generate: vi.fn(async () => ({ url: "https://shope.ee/abc" })) } as any, { capture: vi.fn() }, { captureException: vi.fn() });

    delete process.env.TELEGRAM_BOT_TOKEN;
    await processor.process(makeJob());
    expect(fetch).not.toHaveBeenCalled();

    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    state.users.findOne.mockResolvedValueOnce(null);
    await processor.process(makeJob());
    state.users.findOne.mockResolvedValueOnce({ notificationChannels: { telegram: false }, telegramChatId: 12345 });
    await processor.process(makeJob());
    state.users.findOne.mockResolvedValueOnce({ notificationChannels: { telegram: true } });
    await processor.process(makeJob());
    state.dailyCount.mockResolvedValueOnce(20);
    await processor.process(makeJob());
    state.reserveSend.mockResolvedValueOnce(false);
    await processor.process(makeJob());

    (fetch as any).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}), text: async () => "blocked" });
    await processor.process(makeJob());
    expect(state.users.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(userId) },
      { $unset: { telegramChatId: "" }, $set: { "notificationChannels.telegram": false } },
    );
  });

  it("captures Telegram send errors without leaking chat ids", async () => {
    const sentry = { captureException: vi.fn() };
    const processor = new NotifyTelegramProcessor({ generate: vi.fn(async () => ({ url: "https://shope.ee/abc" })) } as any, { capture: vi.fn() }, sentry);
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => "bad gateway" });

    await expect(processor.process(makeJob())).rejects.toThrow("Telegram 502");

    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { fr: "FR-NOTIF-003" } });
    expect(JSON.stringify(sentry.captureException.mock.calls)).not.toContain("12345");
  });

  it("links, reports status, unsubscribes, and rejects wrong webhook secrets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00.000Z"));
    const controller = new TelegramWebhookController();
    const token = linkTokenFor(userId);

    await expect(controller.handle({ message: { text: "/start", chat: { id: 12345 } } }, "bad")).rejects.toMatchObject({ status: 403 });
    await expect(controller.handle({ message: { text: `/start ${token}`, chat: { id: 12345 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    expect(state.users.updateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(userId) },
      { $set: { telegramChatId: 12345, "notificationChannels.telegram": true } },
    );

    await expect(controller.handle({ message: { text: "/status", chat: { id: 12345 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    expect((fetch as any).mock.calls.at(-1)[1].body).toContain("Đang theo dõi: 4 / 200");

    await expect(controller.handle({ message: { text: "/unsubscribe", chat: { id: 12345 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    expect(state.users.updateOne).toHaveBeenCalledWith(
      { telegramChatId: 12345 },
      { $unset: { telegramChatId: "" }, $set: { "notificationChannels.telegram": false } },
    );

    await expect(controller.handle({ message: { text: "/help", chat: { id: 12345 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    await expect(controller.handle({ message: { text: "hello", chat: { id: 12345 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    await expect(controller.handle({ edited_message: {} }, "webhook-secret")).resolves.toEqual({ ok: true });
  });

  it("handles empty or expired /start tokens without linking", async () => {
    const controller = new TelegramWebhookController();
    state.users.find.mockReturnValueOnce({ toArray: vi.fn(async () => []) });

    await expect(controller.handle({ message: { text: "/start", chat: { id: 999 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    await expect(controller.handle({ message: { text: "/start expired", chat: { id: 999 } } }, "webhook-secret")).resolves.toEqual({ ok: true });
    expect(state.users.updateOne).not.toHaveBeenCalledWith(
      { _id: new ObjectId(userId) },
      expect.objectContaining({ $set: expect.objectContaining({ telegramChatId: 999 }) }),
    );
  });
});
