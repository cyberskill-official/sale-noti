---
id: FR-EXT-001
title: "Chrome MV3 extension — '+ Theo dõi giá' floating button on shopee.vn product pages · disclosure-first · strict scope · no cart-API scrape · cookie-respect · onboarding gate"
module: EXT
priority: MUST
status: done
shipped: 2026-05-17
verify: T
phase: P1
milestone: P1 · slice 1 · MVP Core
slice: 1
owner: "Intern #1 (FE) supervised by Senior Tech Lead"
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-AUTH-003, FR-WATCH-001, FR-LEGAL-002, FR-AFF-002, FR-OBS-001]
depends_on: [FR-AUTH-003, FR-WATCH-001, FR-LEGAL-002, FR-OBS-001]
blocks: []
effort_hours: 20
template: engineering-spec@1

new_files:
  - extension/manifest.json
  - extension/esbuild.config.mjs
  - extension/src/content.ts
  - extension/src/content.css
  - extension/src/background.ts
  - extension/src/popup/popup.tsx
  - extension/src/options/options.tsx
  - extension/src/onboarding/onboarding.tsx
  - extension/src/onboarding/onboarding.html
  - extension/src/lib/messaging.ts
  - extension/src/lib/auth.ts
  - extension/src/lib/disclosure-copy.ts
  - extension/src/lib/url-parser.ts
  - extension/public/store-listing.md
  - extension/public/icons/16.png
  - extension/public/icons/48.png
  - extension/public/icons/128.png
  - extension/tests/integration/track-flow.spec.ts
  - extension/tests/integration/onboarding.spec.ts
  - extension/tests/manifest-lint.spec.ts
  - extension/tests/static-audit.spec.ts
modified_files: []
allowed_tools: ["file_read/write extension/**", "bash pnpm test", "bash pnpm build:ext"]
disallowed_tools:
  - "use `<all_urls>` host permission — Chrome Web Store auto-reject"
  - "request `tabs`, `webRequest`, `cookies`, or `webNavigation` permissions without explicit justification — Chrome reviewer flags"
  - "read `/api/v4/cart/get_cart_list` or any internal Shopee endpoint (plan §B1)"
  - "auto-apply coupons or override affiliate cookies (FR-LEGAL-002 §1 #11, §1 #12)"
  - "inject affiliate link into shopee.vn without explicit user click (Chrome 3/2025 Affiliate Ads Policy)"
  - "use eval() or unsafe-inline CSP — Chrome MV3 forbids"
  - "store user credentials in chrome.storage — use cross-origin cookie via FR-AUTH-003"
  - "bundle minified Shopee JS for in-DOM manipulation — keep code auditable"
risk_if_skipped: "Plan §B4 + §C9 + §H Risk Matrix: extension is the highest-trust AND highest-risk surface. Wrong scope, missing disclosure, or any auto-apply behavior → Chrome Web Store reject within 1-7 days. Plan §J Phase 1 'extension installs ≥ 300' is the friction-reduction wedge for D7 retention. Combined with FR-WATCH-001 (the API target), this is the entire 'fast tracking' user experience."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The Chrome browser extension MUST follow Manifest V3 with strict, narrow permissions and disclosure-first UX.

### Manifest

1. `manifest_version` MUST be `3`. The extension MUST NOT use any MV2-only APIs (chrome.extension.getURL replaced by chrome.runtime.getURL, etc.).
2. `host_permissions` MUST be EXACTLY `["*://*.shopee.vn/*", "https://sale.cyber.skill/*", "https://api.sale.cyber.skill/*"]`. NOT `<all_urls>`, NOT broader globs. This narrows scope to the minimum needed for the feature.
3. `permissions` MUST be EXACTLY `["storage", "activeTab"]`. The extension MUST NOT request `tabs`, `webRequest`, `cookies`, `webNavigation`, `scripting` (for dynamic injection), or `notifications` without re-review.
4. Content script `matches` MUST be EXACTLY `["*://*.shopee.vn/*-i.*.*"]` — the canonical Shopee product-page URL pattern with shopId/itemId. The script MUST NOT inject on home, search, category, or shop pages.
5. The manifest MUST set `content_security_policy.extension_pages` to `"script-src 'self'; object-src 'self'"`. No `unsafe-eval`, no `unsafe-inline`.
6. The `web_accessible_resources` MUST be minimal: only `disclosure-card.html` for showing the inline disclosure card; matches restricted to `*://*.shopee.vn/*`.

### URL detection + button injection

7. The content script MUST parse `location.href` for the shopee.vn product pattern via regex `/^https?:\/\/shopee\.vn\/.+-i\.(\d+)\.(\d+)/`. If no match → script exits silently. The parsing logic MUST be in `extension/src/lib/url-parser.ts` and reused by the regex-tests in `static-audit.spec.ts`.
8. The script MUST render a single floating "+ Theo dõi giá" button anchored to the upper-right region of the product image area. The button MUST:
   - Use ID `salenoti-track-btn`.
   - Use inline styles (no external CSS) to avoid clashing with Shopee's stylesheets.
   - Be visually distinct from Shopee UI: orange/amber (`#FAA227`) background, white text, rounded 6px, subtle shadow.
   - Include a small leading icon (SaleNoti logo, base64-encoded).
   - Have z-index 999999 to overlay any Shopee-injected overlays.
9. The button MUST be DISABLED (greyed out, "Cần đăng nhập" label) if:
   - User has NOT acknowledged the disclosure (`chrome.storage.local.disclosureAcknowledgedAt` unset).
   - The auth probe fails (FR-AUTH-003 cookie missing or expired beyond refresh window).
   Click on disabled button MUST open the onboarding tab (`chrome-extension://<id>/onboarding.html`) OR the sign-in flow accordingly.

### Cookie-respect (Principle 4 from FR-LEGAL-002)

10. Before activating the tracking flow, the content script MUST read `document.cookie` for known Shopee Affiliate cookie names: `AFFILIATE_REF`, `sht`, `_aff_sub`, `shopee_aff`, `shopee_pid`. The detection regex MUST be in `extension/src/lib/disclosure-copy.ts` and updated quarterly with counsel review.
11. If ANY known affiliate cookie is present → the tracking request MUST include `respect_other_publisher: true` in the body. FR-AFF-002 §1 #8 reads this flag and returns the unwrapped origin URL (no commission attribution to us; KOC retains credit).
12. The extension MUST NOT set, modify, or delete any cookie on the shopee.vn domain. This is enforced by NOT requesting the `cookies` permission and by code review.

### Messaging + tracking flow

13. On button click, the content script MUST send `chrome.runtime.sendMessage` of shape `{ type: "trackProduct", url: location.href, affiliateCookiePresent: bool, productName?: string, displayPrice?: number }`. The optional productName/displayPrice are read from page DOM via stable Shopee selectors (`h1[data-sqe='name']`) as UX hints — they're NOT used for tracking, just for the toast confirmation.
14. The background service worker MUST forward to the API: `POST https://api.sale.cyber.skill/v1/products/track` with `credentials: "include"`, header `X-SaleNoti-Source: ext`, header `X-SaleNoti-Ext-Version: <manifest.version>`, body `{ url, respect_other_publisher, alertConfig?, nickname? }`. The optional `alertConfig` from the popup is forwarded.
15. The background MUST handle responses:
    - `201` → forward `{ ok: true, data }` to content script; show toast "Đã theo dõi ✅".
    - `401` → forward `{ ok: false, code: "signin_required" }`; content script opens `https://sale.cyber.skill/auth/sign-in?ext=1` in new tab.
    - `403 free_tier_cap_reached` → forward; content script shows toast with "Nâng cấp Pro" CTA opening billing page.
    - `409 already_tracking` → forward; content script shows "Đã trong watchlist" toast.
    - Other 4xx/5xx → forward error; content script shows "Lỗi: thử lại" toast; Sentry capture (FR-OBS-001) on background side.

### Authentication

16. The extension MUST authenticate via the cross-origin cookie set by FR-AUTH-003. On first install AND when the API responds 401, the extension MUST redirect to `https://sale.cyber.skill/auth/sign-in?ext=1` in a new tab. The web app's sign-in flow MUST detect `?ext=1` and complete with a redirect to a "you can close this tab" page.
17. CORS preflight from `chrome-extension://<EXT_ID>` MUST be allowed by FR-AUTH-003 §1 #11. The `EXT_ID` MUST be pinned in the API's CORS allowlist; wildcard MUST NOT be used.

### Onboarding

18. On first install (no `chrome.storage.local.disclosureAcknowledgedAt` set), the extension MUST programmatically open `chrome-extension://<id>/onboarding.html` in a new tab via the `chrome.runtime.onInstalled` listener.
19. The onboarding page MUST render:
    - SaleNoti logo + tagline.
    - The full canonical disclosure copy from FR-LEGAL-002 §1 #1 (Vi default; En fallback if `chrome.i18n.getUILanguage()` starts with `en`).
    - The 5 ethical principles listed verbatim.
    - An UNCHECKED checkbox "Tôi đã hiểu và đồng ý" gating the "Tiếp tục" button.
    - A "Read full Privacy Policy" link to `https://sale.cyber.skill/legal/affiliate`.
20. On "Tiếp tục" click, the extension MUST:
    - Set `chrome.storage.local.disclosureAcknowledgedAt = now`.
    - Set `chrome.storage.local.disclosureVersion = "v1"`.
    - POST to `https://api.sale.cyber.skill/api/auth/disclosure-ack` with body `{ kind: "affiliate_disclosure_v1", version: "v1" }` (per FR-LEGAL-002 §1 #5) if the user is signed-in.
    - Redirect to `https://sale.cyber.skill/auth/sign-in?ext=1&onboarding=1` if not signed-in.

### Forbidden interactions with Shopee internals

21. The extension MUST NOT fetch any URL on shopee.vn besides the page the user is on (read-only via `location.href`). Specifically forbidden:
    - `/api/v4/cart/get_cart_list`
    - `/api/v4/recommend/get_also_like`
    - `/api/v4/item/get`
    - `/api/v4/search/search_items`
    - Any URL on `*.shopee.vn` matching `/api/v[0-9]+/`
22. A static-audit test MUST grep the built `dist/content.js` and `dist/background.js` for the forbidden URL patterns above and fail the build if found.

### Toast + UI

23. The toast notification MUST be a non-blocking element appearing bottom-right of the viewport, auto-dismissing after 4 seconds, with stable ID `salenoti-toast`. Multiple rapid clicks MUST queue toasts (not stack); max 3 visible at once.
24. The extension popup (clicked from browser toolbar) MUST be minimal: show "Mở SaleNoti dashboard" → opens `https://sale.cyber.skill/dashboard` in new tab. NO inline product list (we keep popup lightweight).

### Updates + versioning

25. The manifest version MUST follow semver (`MAJOR.MINOR.PATCH`). A material change to host_permissions, content_scripts matches, or disclosure flow MUST bump MAJOR. Auto-update via Chrome Web Store MUST be enabled; the extension MUST gracefully handle stored data from previous versions (migration logic in `background.ts` on `onInstalled` with `reason: "update"`).
26. The Chrome Web Store listing description (`extension/public/store-listing.md`) MUST start with the canonical Vi disclosure paragraph per FR-LEGAL-002 §1 #3. CI MUST verify via `scripts/legal-check.mjs --check-listing`.

### Observability

27. The extension MUST emit telemetry via the FR-OBS-001 pipeline. Events:
    - `extension_installed` on `chrome.runtime.onInstalled`.
    - `extension_disclosure_ack` on onboarding completion.
    - `extension_track_attempted` on button click (before API call).
    - `extension_track_succeeded` on 201 response.
    - `extension_track_failed` with `{ code, http_status }` on error.
    - `extension_signin_required` on 401 redirect.
    PII MUST be redacted; `userId` is the FR-AUTH-003 cookie's session, hashed per FR-OBS-001 §1 #10.
28. Errors in the extension's background service worker MUST be captured to Sentry with `tags.fr = "FR-EXT-001"`. Sentry init in service worker MUST use the same DSN as web app.

### Build + distribution

29. The build pipeline MUST be `esbuild` (configured in `extension/esbuild.config.mjs`); MUST produce a single bundled `content.js`, `background.js`, `popup.js`, `options.js`, `onboarding.js` (no code-splitting — Chrome MV3 limitations). Source maps generated but NOT bundled (uploaded to Sentry).
30. The build artifact `extension/dist/` MUST be zippable via `pnpm build:ext` producing `salenoti-extension-<version>.zip` ready for Chrome Web Store upload.

---

## §2 — Why this design

**Why no `<all_urls>`:** Chrome Web Store rejects unjustified broad permissions on first submit. We only need shopee.vn product pages + our own domains. Submitting with `<all_urls>` triggers an automatic reviewer flag for "permission justification missing" and adds 5-14 days to approval.

**Why no Shopee internal API calls (e.g., `/api/v4/cart/get_cart_list`):** plan §B1 lists these as RỦI RO CAO. Calling Shopee's internal endpoints:
- Violates their ToS (unauthorized access)
- Triggers their bot-detection / rate-limiting
- Risks IP-based blocking that affects all our users
- Creates a legal exposure surface (unauthorized data scraping)

The Affiliate Open API (FR-AFF-001) is the canonical channel. The extension only reads `location.href` — that's the user's own browser data, not Shopee's API.

**Why disclosure-first onboarding (gate before button works):** Chrome Web Store 3/2025 Affiliate Ads Policy explicitly: "Disclosure rõ ràng đầy đủ trên: Chrome Web Store listing, UI extension, và trước khi user click." (plan §B4). Without the gate, the extension submits but gets rejected on first review.

**Why `respect_other_publisher: true` when affiliate cookie detected:** plan §A3 principle 3 (KOC fairness). If a KOC's affiliate cookie is already set on the user's session, that KOC earned attribution — we must not override. The flag passes through to FR-AFF-002 which returns the unwrapped origin URL, preserving the KOC's commission.

**Why activeTab + storage only (no `tabs`, no `webRequest`):**
- `activeTab` requires user gesture (button click) — auto-granted on activation, no broad page-tracking permission.
- `storage` is for the disclosure ack + per-user settings — minimal scope.
- `tabs` would let us track open URLs across all tabs — overbroad for our needs.
- `webRequest` would let us intercept network calls — would trigger Chrome's "this extension can modify your traffic" warning, suppressing installs.
- `cookies` would let us read/write cookies on shopee.vn — explicitly violates our cookie-respect principle.

**Why MV3 (not MV2):** Chrome fully deprecates MV2 by 2024-2025. New submissions must be MV3. MV3 also enforces the service worker model (no persistent background page), which we're designed for.

**Why content script in `dist/content.js` (single bundle, no code-split):** MV3 content scripts can't dynamically import. Single bundle keeps the extension simple to audit and review.

**Why no `<script>` evaluation / `unsafe-inline`:** Chrome MV3 forbids it. Our CSP is `script-src 'self'` only — stricter than necessary but defends against any inadvertent inline-script in extension HTML pages.

**Why onboarding opens automatically on install (not on first button click):** Chrome Web Store 3/2025 Affiliate Ads Policy mandates disclosure BEFORE the user encounters the commercial feature. Lazy-onboarding (on first click) was a common pattern pre-2025 but is now an auto-reject trigger.

**Why authenticate via FR-AUTH-003 cookie (not extension-managed token):** keeping auth in cookies controlled by the web app means:
- One source of truth for sessions (no extension/web drift).
- Revocation flows from web side immediately propagate to extension.
- Extension upgrades don't invalidate sessions.
- We don't need OAuth-like flow for the extension itself.

**Why `?ext=1` query param on signin redirect:** the web app's signin success page differs slightly for extension users — instead of redirecting to `/dashboard`, it shows "Done! You can close this tab." with a friendly icon. The extension's onboarding tab can poll the signin state and auto-close.

**Why semver MAJOR bump on host_permissions change:** Chrome users see a "this extension now requires new permissions" prompt on update; users may decline. Bumping MAJOR signals intent and lets us communicate the change in release notes. Manifest is the user-facing contract.

**Why pin `EXT_ID` in API CORS (not wildcard `chrome-extension://*`):** wildcard would allow any malicious extension to impersonate our extension's API access. Pinning the production EXT_ID makes this the only extension that can authenticate. The trade-off: developer mode (unpacked extension) gets a different ID, so dev/staging needs a separate ALLOWED_EXT_IDS env (covered in FR-AUTH-003).

**Why static-audit test (grep for forbidden Shopee URLs):** the principle is easy to forget in code review. A grep-based test catches it definitively at build time. Cheap to write, persistent guardrail.

---

## §3 — Manifest (canonical)

```json
{
  "manifest_version": 3,
  "name": "SaleNoti — Theo dõi giá Shopee",
  "short_name": "SaleNoti",
  "version": "0.1.0",
  "description": "Bấm '+ Theo dõi giá' trên trang sản phẩm Shopee → nhận email khi giá giảm. Affiliate disclosure đầy đủ.",
  "icons": {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icons/48.png",
    "default_title": "SaleNoti — Theo dõi giá"
  },
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "*://*.shopee.vn/*",
    "https://sale.cyber.skill/*",
    "https://api.sale.cyber.skill/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["*://*.shopee.vn/*-i.*.*"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle",
    "all_frames": false
  }],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://api.sale.cyber.skill"
  },
  "options_page": "options.html",
  "web_accessible_resources": [{
    "resources": ["disclosure-card.html", "icons/48.png"],
    "matches": ["*://*.shopee.vn/*"]
  }],
  "minimum_chrome_version": "100"
}
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | Chrome Web Store reviewer auto-checker | extension uploaded | passes — no `<all_urls>`, MV3, justified permissions, CSP set |
| AC2 | shopee.vn product page `/Áo-thun-i.123.456` | content script runs | floating "+ Theo dõi giá" button appears anchored to image area |
| AC3 | shopee.vn home page `shopee.vn/` | navigation | NO injection (manifest matches block) |
| AC4 | non-Shopee site `tiki.vn/abc-i.1.2` | navigation | NO injection (host match excludes) |
| AC5 | fresh install, no disclosure ack | extension opens | onboarding tab auto-opens at `chrome-extension://<id>/onboarding.html` |
| AC6 | onboarding tab, checkbox unchecked | user inspects "Tiếp tục" button | button is disabled |
| AC7 | onboarding tab, click "Tiếp tục" with checkbox checked | user clicks | `chrome.storage.local.disclosureAcknowledgedAt` set; redirect to signin if needed |
| AC8 | user already signed-in, clicks button on product page | onclick | `POST /v1/products/track` with `X-SaleNoti-Source: ext`; 201 response; toast "Đã theo dõi ✅" |
| AC9 | user NOT signed-in | clicks button | API returns 401; new tab opens to `https://sale.cyber.skill/auth/sign-in?ext=1` |
| AC10 | Shopee affiliate cookie `AFFILIATE_REF=koc123` present | clicks button | request body includes `respect_other_publisher: true`; FR-AFF-002 returns unwrapped URL |
| AC11 | code review grep | inspect `dist/content.js` + `dist/background.js` | no match for `shopee.vn/api/v[0-9]+/` pattern |
| AC12 | manifest lint | parse manifest.json | no `<all_urls>`, MV3, host_permissions whitelist exact, permissions ⊆ `[storage, activeTab]` |
| AC13 | store listing | inspect `extension/public/store-listing.md` | starts with canonical Vi disclosure paragraph |
| AC14 | CSP test | inspect manifest | extension_pages CSP equals `"script-src 'self'; object-src 'self'; connect-src ..."` |
| AC15 | extension upgrade from 0.1.0 to 0.2.0 with manifest unchanged | Chrome auto-update | no permissions re-prompt; users keep ack |
| AC16 | extension upgrade with new host_permissions | install | Chrome shows "this extension now needs..." prompt; MAJOR bump signals it |
| AC17 | rapid 3 clicks on button | content script | only 1 API call; UI prevents double-click via 1s lock |
| AC18 | 403 free_tier_cap response | API | toast shows "Đã đạt giới hạn — Nâng cấp Pro" with CTA to /billing/upgrade |
| AC19 | 409 already_tracking response | API | toast "Đã trong watchlist" |
| AC20 | extension popup opened | inspect | minimal — single link "Mở dashboard" → opens `/dashboard` |
| AC21 | static-audit grep test | CI | builds fail if any forbidden Shopee internal URL appears in bundle |
| AC22 | onboarding in English-locale browser | render | English disclosure copy + 5 principles |

---

## §5 — Verification

```ts
// extension/tests/integration/track-flow.spec.ts
describe("FR-EXT-001 — Chrome extension track flow", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ disclosureAcknowledgedAt: Date.now() });
  });

  it("AC2: button injects on product page", async () => {
    await browser.navigate("https://shopee.vn/Áo-thun-i.123.456");
    const btn = await browser.waitFor("#salenoti-track-btn", { timeout: 3000 });
    expect(btn).toBeDefined();
    expect(await btn.computedStyle("z-index")).toBe("999999");
  });

  it("AC3+AC4: no injection on home page or non-Shopee", async () => {
    await browser.navigate("https://shopee.vn/");
    expect(await browser.findByCss("#salenoti-track-btn", { timeout: 500 })).toBeNull();
    await browser.navigate("https://tiki.vn/abc-i.1.2");
    expect(await browser.findByCss("#salenoti-track-btn", { timeout: 500 })).toBeNull();
  });

  it("AC5+AC6+AC7: onboarding gate", async () => {
    await chrome.storage.local.clear();
    // Simulate install
    await chrome.runtime.onInstalled.dispatch({ reason: "install" });
    await browser.waitForTab(/chrome-extension:\/\/.*\/onboarding\.html/);
    const understand = await browser.waitFor("#understand-checkbox");
    const btn = await browser.waitFor("#continue-btn");
    expect(await btn.isDisabled()).toBe(true);
    await understand.click();
    expect(await btn.isDisabled()).toBe(false);
    await btn.click();
    const ack = await chrome.storage.local.get("disclosureAcknowledgedAt");
    expect(ack.disclosureAcknowledgedAt).toBeDefined();
  });

  it("AC8: signed-in click → 201 + toast", async () => {
    await mockApiResponse("POST /v1/products/track", { status: 201, body: { watchlistId: "w1", productId: "1-2", name: "Áo" } });
    await browser.navigate("https://shopee.vn/Áo-i.1.2");
    await (await browser.waitFor("#salenoti-track-btn")).click();
    const toast = await browser.waitFor("#salenoti-toast", { timeout: 5000 });
    expect(await toast.textContent()).toContain("Đã theo dõi");
  });

  it("AC9: 401 → opens signin tab", async () => {
    await mockApiResponse("POST /v1/products/track", { status: 401 });
    await browser.navigate("https://shopee.vn/Áo-i.1.2");
    await (await browser.waitFor("#salenoti-track-btn")).click();
    await browser.waitForTab(/sale\.cyber\.skill\/auth\/sign-in\?ext=1/);
  });

  it("AC10: affiliate cookie → respect flag", async () => {
    await browser.setCookie("https://shopee.vn", "AFFILIATE_REF", "koc123");
    let capturedBody: any;
    await mockApiResponse("POST /v1/products/track", { status: 201, captureBody: b => capturedBody = b });
    await browser.navigate("https://shopee.vn/Áo-i.1.2");
    await (await browser.waitFor("#salenoti-track-btn")).click();
    await waitForApiCall();
    expect(capturedBody.respect_other_publisher).toBe(true);
  });

  it("AC17: rapid clicks debounced", async () => {
    await mockApiResponse("POST /v1/products/track", { status: 201 });
    await browser.navigate("https://shopee.vn/Áo-i.1.2");
    const btn = await browser.waitFor("#salenoti-track-btn");
    await btn.click();
    await btn.click();
    await btn.click();
    await wait(500);
    expect(apiCallCount("POST /v1/products/track")).toBe(1);
  });

  it("AC18: 403 free_tier_cap toast", async () => {
    await mockApiResponse("POST /v1/products/track", { status: 403, body: { error: "free_tier_cap_reached", upgradeUrl: "/billing/upgrade" } });
    await browser.navigate("https://shopee.vn/Áo-i.1.2");
    await (await browser.waitFor("#salenoti-track-btn")).click();
    const toast = await browser.waitFor("#salenoti-toast");
    expect(await toast.textContent()).toContain("Nâng cấp Pro");
  });
});

// extension/tests/static-audit.spec.ts
describe("FR-EXT-001 — static audit", () => {
  it("AC11: no Shopee internal API references in bundle", () => {
    const content = fs.readFileSync("extension/dist/content.js", "utf8");
    const bg = fs.readFileSync("extension/dist/background.js", "utf8");
    expect(content).not.toMatch(/shopee\.vn\/api\/v[0-9]+\//);
    expect(bg).not.toMatch(/shopee\.vn\/api\/v[0-9]+\//);
    expect(content).not.toMatch(/get_cart_list|recommend\/get_also_like|item\/get/);
    expect(bg).not.toMatch(/get_cart_list|recommend\/get_also_like|item\/get/);
  });

  it("AC13: store listing has disclosure", () => {
    const listing = fs.readFileSync("extension/public/store-listing.md", "utf8");
    expect(listing).toContain("SaleNoti là price-tracker affiliate");
    expect(listing).toContain("KHÔNG: tự áp coupon");
  });
});

// extension/tests/manifest-lint.spec.ts
describe("FR-EXT-001 — manifest", () => {
  const m = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));

  it("AC1+AC12: manifest_version 3 + no all_urls", () => {
    expect(m.manifest_version).toBe(3);
    for (const h of m.host_permissions) {
      expect(h).not.toBe("<all_urls>");
      expect(h).toMatch(/^\*:\/\/\*\.shopee\.vn\/\*$|^https:\/\/(api\.)?sale\.cyber\.skill\/\*$/);
    }
  });

  it("AC12: permissions ⊆ {storage, activeTab}", () => {
    expect(m.permissions.every((p: string) => ["storage", "activeTab"].includes(p))).toBe(true);
  });

  it("AC14: CSP set", () => {
    expect(m.content_security_policy.extension_pages).toContain("script-src 'self'");
    expect(m.content_security_policy.extension_pages).toContain("object-src 'self'");
    expect(m.content_security_policy.extension_pages).not.toContain("unsafe-eval");
    expect(m.content_security_policy.extension_pages).not.toContain("unsafe-inline");
  });

  it("AC12: content_scripts match product pattern only", () => {
    expect(m.content_scripts[0].matches).toEqual(["*://*.shopee.vn/*-i.*.*"]);
  });
});
```

---

## §6 — Implementation skeleton

```ts
// extension/src/lib/url-parser.ts
export function parseShopeeProductUrl(url: string): { shopId: number; itemId: number } | null {
  const m = /^https?:\/\/shopee\.vn\/.+?-i\.(\d+)\.(\d+)/.exec(url);
  if (!m) return null;
  return { shopId: Number(m[1]), itemId: Number(m[2]) };
}

// extension/src/lib/disclosure-copy.ts
export const AFFILIATE_COOKIE_PATTERNS = [
  /(?:^|;\s*)AFFILIATE_REF=/,
  /(?:^|;\s*)sht=/,
  /(?:^|;\s*)_aff_sub=/,
  /(?:^|;\s*)shopee_aff=/,
  /(?:^|;\s*)shopee_pid=/,
];

export function hasOtherPublisherCookie(cookieStr: string): boolean {
  return AFFILIATE_COOKIE_PATTERNS.some(r => r.test(cookieStr));
}

// extension/src/content.ts
import { parseShopeeProductUrl } from "./lib/url-parser";
import { hasOtherPublisherCookie } from "./lib/disclosure-copy";

(async () => {
  const ack = await chrome.storage.local.get("disclosureAcknowledgedAt");
  const parsed = parseShopeeProductUrl(location.href);
  if (!parsed) return;

  const button = createButton();
  if (!ack.disclosureAcknowledgedAt) button.disabled = true;

  const anchor = findProductImageAnchor();
  (anchor ?? document.body).appendChild(button);

  let isProcessing = false;
  button.addEventListener("click", async () => {
    if (isProcessing) return;
    if (!ack.disclosureAcknowledgedAt) {
      chrome.runtime.sendMessage({ type: "openOnboarding" });
      return;
    }
    isProcessing = true;
    button.disabled = true;
    try {
      const affiliateCookiePresent = hasOtherPublisherCookie(document.cookie);
      const productName = document.querySelector("h1[data-sqe='name']")?.textContent?.trim();
      const resp = await chrome.runtime.sendMessage({
        type: "trackProduct",
        url: location.href,
        affiliateCookiePresent,
        productName,
      });
      handleTrackResponse(resp);
    } finally {
      setTimeout(() => { isProcessing = false; button.disabled = false; }, 1000);
    }
  });
})();

function createButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = "salenoti-track-btn";
  btn.textContent = "+ Theo dõi giá";
  btn.style.cssText = "position:absolute;top:8px;right:8px;z-index:999999;background:#FAA227;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;border:none;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
  return btn;
}

function handleTrackResponse(resp: any) {
  if (resp?.ok) {
    showToast("Đã theo dõi giá ✅");
  } else if (resp?.code === "signin_required") {
    chrome.runtime.sendMessage({ type: "openSignin" });
  } else if (resp?.code === "free_tier_cap_reached") {
    showToast("Đã đạt giới hạn 10 sản phẩm — Nâng cấp Pro", { action: { label: "Nâng cấp", url: "https://sale.cyber.skill/billing/upgrade" } });
  } else if (resp?.code === "already_tracking") {
    showToast("Đã có trong watchlist");
  } else {
    showToast("Lỗi: " + (resp?.error ?? "thử lại"));
  }
}

// extension/src/background.ts
import * as Sentry from "@sentry/browser";

Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, tracesSampleRate: 0.1, environment: import.meta.env.MODE });
Sentry.setTag("fr", "FR-EXT-001");

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const ack = await chrome.storage.local.get("disclosureAcknowledgedAt");
    if (!ack.disclosureAcknowledgedAt) {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
    }
  }
  // Migration logic on update
  if (details.reason === "update") {
    const stored = await chrome.storage.local.get("disclosureVersion");
    if (stored.disclosureVersion !== "v1") {
      await chrome.storage.local.set({ disclosureVersion: "v1" });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "trackProduct") {
    (async () => {
      try {
        const r = await fetch("https://api.sale.cyber.skill/v1/products/track", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-SaleNoti-Source": "ext",
            "X-SaleNoti-Ext-Version": chrome.runtime.getManifest().version,
          },
          body: JSON.stringify({
            url: msg.url,
            respect_other_publisher: msg.affiliateCookiePresent,
          }),
        });
        if (r.status === 401) { sendResponse({ ok: false, code: "signin_required" }); return; }
        if (r.status === 403) { sendResponse({ ok: false, code: "free_tier_cap_reached" }); return; }
        if (r.status === 409) { sendResponse({ ok: false, code: "already_tracking" }); return; }
        if (r.ok) { sendResponse({ ok: true, data: await r.json() }); return; }
        sendResponse({ ok: false, code: "track_failed", error: await r.text() });
      } catch (e) {
        Sentry.captureException(e, { tags: { fr: "FR-EXT-001" } });
        sendResponse({ ok: false, code: "network_error", error: String(e) });
      }
    })();
    return true; // async
  }
  if (msg.type === "openOnboarding") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
    sendResponse({ ok: true });
  }
  if (msg.type === "openSignin") {
    chrome.tabs.create({ url: "https://sale.cyber.skill/auth/sign-in?ext=1" });
    sendResponse({ ok: true });
  }
});
```

---

## §7 — Dependencies

- FR-AUTH-003 (cross-origin cookie + CORS pinning for chrome-extension://<EXT_ID>)
- FR-WATCH-001 (track endpoint, accepts `respect_other_publisher` flag)
- FR-LEGAL-002 (canonical disclosure copy, onboarding gate, store listing CI check)
- FR-AFF-002 (deeplink generation honors `respect_other_publisher`)
- FR-OBS-001 (Sentry DSN, PostHog events)
- Chrome Web Store developer account (one-time $5 fee)
- `esbuild` for bundling
- `@sentry/browser` for service worker error capture

---

## §8 — Example payloads

### Background → API request

```http
POST https://api.sale.cyber.skill/v1/products/track
Origin: chrome-extension://abcdef1234567890
Cookie: authjs.session-token=eyJ...; authjs.refresh-token=...
X-SaleNoti-Source: ext
X-SaleNoti-Ext-Version: 0.1.0
Content-Type: application/json

{
  "url": "https://shopee.vn/Áo-thun-nam-basic-i.123456.9876543210",
  "respect_other_publisher": false
}
```

### Onboarding page (rendered)

```
[SaleNoti Logo]                          Onboarding 1/1

SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert
hoặc trang public, chúng tôi nhận hoa hồng từ Shopee Affiliate Open API
(1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG:
- Tự áp coupon
- Override cookie affiliate của KOC/publisher khác
- Ẩn deal tốt hơn để hưởng commission cao hơn

5 Nguyên tắc đạo đức:
#1 Minh bạch — Disclosure ở mọi surface.
#2 Người dùng khởi tạo — Affiliate chỉ kích hoạt khi user click.
#3 Tôn trọng coupon — Không auto-apply.
#4 Tôn trọng cookie — Không override KOC cookie.
#5 Không ẩn deal tốt hơn — Ranking dùng signals khách quan.

[ ] Tôi đã hiểu và đồng ý
[ Tiếp tục ]   [ Đọc Privacy Policy ]
```

### Toast example

```
<div id="salenoti-toast" style="position:fixed;bottom:24px;right:24px;background:#1f2937;color:#fff;padding:12px 16px;border-radius:8px;z-index:999999;">
  Đã theo dõi giá ✅
  <a href="https://sale.cyber.skill/dashboard">Xem watchlist →</a>
</div>
```

---

## §9 — Open questions (resolved)

**Q1: Edge / Firefox / Safari support?**
A: Chrome + Edge at MVP (manifest compatible). Firefox needs separate manifest (browser_specific_settings); P2. Safari requires re-architecting as a Safari extension; P3.

**Q2: Popup actions?**
A: Minimal — single "Mở dashboard" link. All work happens on the product page. Plan: avoid popup complexity that competes with the in-page button.

**Q3: Detect Shopee URL with non-Vietnamese name in path?**
A: Match by regex `-i.<shopId>.<itemId>`; product name is irrelevant for routing. Works for all language variants.

**Q4: How to update affiliate-cookie pattern list?**
A: Quarterly counsel review; updates in `extension/src/lib/disclosure-copy.ts` constants. CI test verifies the list isn't empty.

**Q5: What about Shopee in other markets (TH, ID, MY)?**
A: P4. Manifest can extend to `*://*.shopee.co.th/*` etc.; but the FR-AFF-001 client must support the regional Affiliate API endpoints first.

**Q6: What about Shopee in-app browser (mobile)?**
A: Out of scope — Chrome extension is desktop-only. Mobile uses native sharing flow per P3 plans.

**Q7: How does the extension handle Shopee A/B-testing alternate page layouts?**
A: Regex-based URL parsing is layout-agnostic. Button anchoring uses `document.body` fallback if image selector fails — degraded but functional.

**Q8: Should we offer a "track all visible products on a category page" feature?**
A: Tempting but conflicts with Principle 2 (user-initiated). Each product MUST be a deliberate user action. P3 may add a "track multiple" via popup-driven URL paste.

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Chrome Web Store rejects extension | submission log | Plan B: self-host CRX file (plan §H) | address feedback (typically permission justification); resubmit | error |
| 2 | Shopee URL pattern changes | regex no match | no button injection; user reports | update regex in `url-parser.ts` + hotfix release | warning |
| 3 | Shopee blocks chrome-extension origin via CSP | content script can't fetch (irrelevant — we don't fetch shopee) | accept; design avoids it | n/a | info |
| 4 | User on incognito (storage isolated) | first-install onboarding re-shown | accept | OK | info |
| 5 | Disclosure ack manually revoked | button disabled | re-onboard | OK | info |
| 6 | Sign-in cookie expired | 401 → sign-in tab opens | accept | after sign-in, user can re-click | info |
| 7 | Race: two tabs click button same product | FR-WATCH-001 returns 409 | idempotent; both UIs show "Đã có trong watchlist" | OK | info |
| 8 | Shopee A/B layout breaks image selector | button falls back to body | degraded but functional | adjust selector | warning |
| 9 | `<all_urls>` accidentally committed in manifest | CI manifest-lint test | PR blocked | grep gate | error |
| 10 | Affiliate cookie regex false-positive | requests use `respect_other_publisher: true` unnecessarily | slight revenue loss; ethically correct | refine regex with counsel review | info |
| 11 | Extension service worker crashes | background.js error | Sentry capture; Chrome auto-restarts SW | next request triggers fresh SW | warning |
| 12 | EXT_ID rotation (Chrome Web Store version bump) | dev workflow | dev/staging needs separate ALLOWED_EXT_IDS env (FR-AUTH-003) | document in DEPLOY.md | info |
| 13 | User installs extension via developer mode (unpacked) | EXT_ID differs from production | API rejects CORS preflight | document staging workflow; mention in CONTRIBUTING.md | info |
| 14 | Auto-update with permission change | Chrome blocks update with prompt | users see "this extension now needs..." dialog | MAJOR semver bump signals intent; release notes explain | warning |
| 15 | Static-audit grep test misses obfuscated forbidden URL | rare; manual code review catches | reject in PR | strengthen audit; consider AST-based check at P2 | info |
| 16 | Toast injection conflicts with Shopee modal | rare layout collision | toast may be hidden | z-index 999999 + position:fixed should win; tested in CI | info |
| 17 | Sentry quota exhausted from extension errors | background SW errors flood | quota alert | filter known-noise errors (e.g., NETWORK_ERROR in transient situations) | warning |

---

## §11 — Notes

- Plan §B4 reference: "User action tường minh trước mỗi lần inject affiliate link/cookie." — our button click IS the user action. No deviation possible.
- The extension is the highest-trust surface; over-investing in disclosure here pays back via Chrome Web Store reviews ("they actually disclose"). User reviews are the #1 ranking signal.
- CI manifest-lint script: `pnpm extension:lint:manifest` parses manifest.json and asserts: no `<all_urls>`, MV3, host_permissions whitelist match.
- The "developer mode unpacked install" workflow needs special handling — local dev has a different EXT_ID than production. The FR-AUTH-003 CORS whitelist must include both: production EXT_ID + a "dev" entry gated by `NODE_ENV != production`.
- The 5 ethical principles are reinforced in the extension onboarding because Chrome reviewers WILL read it. Showing the principles is the strongest signal of compliance posture.
- Future Edge submission: same MV3 manifest works on Edge Add-ons store. Firefox needs a small manifest variant (`browser_specific_settings.gecko.id` etc.).
- The static-audit test (grep against bundled JS) is unconventional but deliberately enforced — it catches both intentional violations AND accidental imports of forbidden libraries.

---

*FR-EXT-001 spec — last revised 2026-05-16. Status: shipped (2026-05-17).*
