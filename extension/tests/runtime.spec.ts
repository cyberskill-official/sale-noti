import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: any[]) => any;

class FakeElement {
  id = "";
  textContent = "";
  innerHTMLValue = "";
  href = "";
  target = "";
  checked = false;
  disabled = false;
  className = "";
  style: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  private listeners = new Map<string, Listener>();

  constructor(private readonly registry: Map<string, FakeElement>) {}

  set innerHTML(value: string) {
    this.innerHTMLValue = value;
    if (value.includes("salenoti-open-onboarding")) {
      const child = new FakeElement(this.registry);
      child.id = "salenoti-open-onboarding";
      child.parentElement = this;
      this.registry.set(child.id, child);
      this.children.push(child);
    }
  }

  get innerHTML() {
    return this.innerHTMLValue;
  }

  setAttribute(name: string, value: string) {
    if (name === "id") {
      this.id = value;
      this.registry.set(value, this);
    }
  }

  appendChild(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
    if (child.id) this.registry.set(child.id, child);
    return child;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type: string) {
    return this.listeners.get(type)?.({ target: this });
  }
}

function setupDocument(ids: string[] = []) {
  const registry = new Map<string, FakeElement>();
  const body = new FakeElement(registry);
  body.id = "body";
  registry.set("body", body);
  for (const id of ids) {
    const el = new FakeElement(registry);
    el.id = id;
    el.parentElement = body;
    registry.set(id, el);
    body.children.push(el);
  }
  (globalThis as any).document = {
    cookie: "",
    body,
    createElement: vi.fn(() => new FakeElement(registry)),
    getElementById: vi.fn((id: string) => registry.get(id) ?? null),
  };
  return { registry, body };
}

function setupChrome(overrides: Record<string, any> = {}) {
  const messageListeners: Listener[] = [];
  const installListeners: Listener[] = [];
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
    runtime: {
      sendMessage: vi.fn(),
      getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
      onMessage: { addListener: vi.fn((listener: Listener) => messageListeners.push(listener)) },
      onInstalled: { addListener: vi.fn((listener: Listener) => installListeners.push(listener)) },
    },
    tabs: { create: vi.fn(async () => ({})) },
    ...overrides,
  };
  (globalThis as any).chrome = chrome;
  return { chrome, messageListeners, installListeners };
}

async function importFresh(path: string) {
  vi.resetModules();
  await import(path);
  await Promise.resolve();
  await Promise.resolve();
}

describe("FR-EXT-001 — extension runtime scripts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    (globalThis as any).location = { pathname: "/ao-thun-i.123.456", href: "https://shopee.vn/ao-thun-i.123.456" };
    (globalThis as any).window = { close: vi.fn() };
  });

  it("content script shows disclosure gate, opens onboarding, and stays idempotent", async () => {
    const { registry } = setupDocument();
    const { chrome } = setupChrome();
    await importFresh("../src/content.ts");

    expect(registry.get("salenoti-disclosure-required")).toBeTruthy();
    registry.get("salenoti-open-onboarding")?.dispatch("click");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "openOnboarding" });

    await importFresh("../src/content.ts");
    expect(registry.get("salenoti-disclosure-required")).toBeTruthy();
  });

  it("content script injects the track button and handles success and API errors", async () => {
    const { registry } = setupDocument();
    const { chrome } = setupChrome();
    chrome.storage.local.get.mockResolvedValue({ disclosureAcknowledgedAt: Date.now() });
    chrome.runtime.sendMessage.mockImplementation((_msg: any, cb: Listener) => cb({ ok: true, data: { id: "watch-1" } }));
    (globalThis as any).document.cookie = "AFFILIATE_REF=other-publisher";

    await importFresh("../src/content.ts");
    const button = registry.get("salenoti-track-btn")!;
    expect(button.textContent).toBe("+ Theo dõi giá");
    await button.dispatch("click");
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "trackProduct", url: "https://shopee.vn/ao-thun-i.123.456", affiliateCookiePresent: true },
      expect.any(Function),
    );
    expect(button.textContent).toBe("✓ Đã theo dõi");

    for (const response of [
      { ok: false, code: "signin_required" },
      { ok: false, code: "free_tier_cap_reached" },
      { ok: false, error: "boom" },
    ]) {
      vi.resetModules();
      setupDocument();
      chrome.runtime.sendMessage.mockImplementationOnce((_msg: any, cb: Listener) => cb(response));
      await importFresh("../src/content.ts");
      await ((globalThis as any).document.getElementById("salenoti-track-btn") as FakeElement).dispatch("click");
    }
  });

  it("content script no-ops on non-product pages and catches runtime failures", async () => {
    setupDocument();
    const { chrome } = setupChrome();
    chrome.storage.local.get.mockResolvedValue({ disclosureAcknowledgedAt: Date.now() });
    (globalThis as any).location = { pathname: "/search", href: "https://shopee.vn/search" };
    await importFresh("../src/content.ts");
    expect((globalThis as any).document.getElementById("salenoti-track-btn")).toBeNull();

    setupDocument();
    (globalThis as any).location = { pathname: "/ao-thun-i.123.456", href: "https://shopee.vn/ao-thun-i.123.456" };
    chrome.runtime.sendMessage.mockImplementationOnce(() => {
      throw new Error("runtime unavailable");
    });
    await importFresh("../src/content.ts");
    const button = (globalThis as any).document.getElementById("salenoti-track-btn") as FakeElement;
    await button.dispatch("click");
    expect(button.disabled).toBe(false);
  });

  it("background service worker handles onboarding, tracking, auth failures, and install", async () => {
    const { chrome, messageListeners, installListeners } = setupChrome();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ watchlistId: "w1" }), text: async () => "ok" })));
    await importFresh("../src/background.ts");
    const listener = messageListeners[0]!;
    const sendResponse = vi.fn();

    expect(listener({ type: "openOnboarding" }, {}, sendResponse)).toBe(true);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://id/onboarding.html" });
    await Promise.resolve();
    sendResponse.mockClear();

    expect(listener({ type: "trackProduct", url: "https://shopee.vn/x", affiliateCookiePresent: true }, {}, sendResponse)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith("https://api.salenoti.vn/v1/products/track", expect.objectContaining({ method: "POST" }));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { watchlistId: "w1" } });

    (fetch as any).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => "no" });
    listener({ type: "trackProduct", url: "https://shopee.vn/x" }, {}, sendResponse);
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, code: "signin_required" });

    (fetch as any).mockRejectedValueOnce(new Error("offline"));
    listener({ type: "trackProduct", url: "https://shopee.vn/x" }, {}, sendResponse);
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: "network_error" }));

    await installListeners[0]!({ reason: "install" });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://id/onboarding.html" });
  });

  it("options, popup, and onboarding pages manage disclosure state", async () => {
    const { registry } = setupDocument(["ack-status", "reset-btn", "state-badge", "consent-ack", "continue-btn"]);
    const { chrome } = setupChrome();
    chrome.storage.local.get.mockResolvedValue({ disclosureAcknowledgedAt: 1_768_000_000_000, disclosureVersion: "v1" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));

    await importFresh("../src/options/options.ts");
    expect(registry.get("ack-status")!.textContent).toContain("Đã đồng ý");
    await registry.get("reset-btn")!.dispatch("click");
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(["disclosureAcknowledgedAt", "disclosureVersion"]);

    chrome.storage.local.get.mockResolvedValueOnce({});
    await importFresh("../src/popup/popup.ts");
    expect(registry.get("state-badge")!.textContent).toBe("Chưa onboarded");
    chrome.storage.local.get.mockResolvedValueOnce({ disclosureAcknowledgedAt: Date.now() });
    await importFresh("../src/popup/popup.ts");
    expect(registry.get("state-badge")!.className).toBe("badge badge-ok");

    const checkbox = registry.get("consent-ack")!;
    const continueBtn = registry.get("continue-btn")!;
    continueBtn.disabled = true;
    await importFresh("../src/onboarding/onboarding.ts");
    checkbox.checked = true;
    checkbox.dispatch("change");
    expect(continueBtn.disabled).toBe(false);
    await continueBtn.dispatch("click");
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({ disclosureVersion: "v1" }));
    expect(fetch).toHaveBeenCalledWith("https://salenoti.vn/api/auth/disclosure-ack", expect.objectContaining({ method: "POST" }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://salenoti.vn/auth/sign-in?ext=1" });
  });
});
