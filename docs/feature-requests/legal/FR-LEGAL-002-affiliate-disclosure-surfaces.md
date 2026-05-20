---
id: FR-LEGAL-002
title: "Affiliate disclosure surfaces — listing · onboarding · alert email · every affiliate-tagged link · transparency report · 5-ethics firewall"
module: LEGAL
priority: MUST
status: done
shipped: 2026-05-17
verify: I
phase: P0
milestone: P0 · slice 1 · Pre-MVP Foundation
slice: 1
owner: Stephen Cheng (Founder)
created: 2026-05-16
last_revised: 2026-05-16
related_frs: [FR-LEGAL-001, FR-NOTIF-001, FR-NOTIF-002, FR-NOTIF-003, FR-AFF-002, FR-AFF-003, FR-AFF-004, FR-EXT-001, FR-GROW-002]
depends_on: []
blocks: [FR-NOTIF-001, FR-NOTIF-002, FR-NOTIF-003, FR-AFF-002, FR-EXT-001, FR-GROW-002]
effort_hours: 8
template: engineering-spec@1

new_files:
  - apps/web/src/lib/disclosure.ts
  - apps/web/src/components/disclosure/AffiliateDisclosureCard.tsx
  - apps/web/src/components/disclosure/PreClickInterstitial.tsx
  - apps/web/src/components/disclosure/OnboardingDisclosureStep.tsx
  - apps/web/src/components/disclosure/__tests__/disclosure.spec.tsx
  - extension/disclosure/onboarding.html
  - extension/disclosure/onboarding.tsx
  - docs/legal/affiliate-disclosure-copy.md
  - docs/legal/transparency-report-template.md
  - docs/legal/ethics-principles.md
  - eslint-rules/no-auto-apply-coupon.js
  - eslint-rules/no-commission-ranking.js
  - scripts/legal-check.mjs
modified_files:
  - apps/web/src/server/email/templates/magic-link.tsx
  - apps/web/src/server/email/templates/alert.tsx
  - apps/web/src/server/email/templates/base-template.tsx
  - extension/manifest.json
  - extension/public/store-listing.md
  - eslint.config.mjs
  - .github/workflows/ci.yml
allowed_tools: ["file_read/write apps/web/**", "file_read/write extension/**", "file_read/write docs/legal/**", "file_read/write eslint-rules/**", "bash pnpm test", "bash pnpm legal:check"]
disallowed_tools:
  - "ship any affiliate-tagged link without the canonical disclosure copy nearby — FTC 16 CFR §255.5 'clear and conspicuous' violation"
  - "auto-apply coupons of any form — Chrome Web Store 3/2025 Affiliate Ads Policy explicit"
  - "override affiliate cookies from another publisher — Plan §A3 principle 3 (KOC fairness)"
  - "rank deals by internal commission rate — Plan §A3 principle 5 (no hide-better-deals)"
  - "edit the canonical disclosure copy without versioning + re-consent flow"
  - "use machine-translated disclosure — Vi version is authoritative, professionally drafted"
risk_if_skipped: "Plan §A2 (Honey scandal lesson — caused class-action lawsuit, $30M+ damages, permanent brand destruction) + §B4 (Chrome Affiliate Ads Policy 3/2025, enforced 10/6/2025) + §B5 (no override / no hijack / no hide) + §H Risk Matrix (Chrome Web Store reject extension at first submit). Without disclosure surfaces at all four touchpoints (listing, onboarding, in-app, every link), Chrome Web Store will reject; FTC enforcement actions follow; brand integrity destroyed before MVP launches. This FR is the single biggest moat in the product."
---

## §1 — Description (BCP-14 normative)

This document SHALL be interpreted per BCP-14 (RFC 2119/8174). The product surface MUST display affiliate disclosure at every touchpoint where an affiliate-tagged link, coupon, or commission may be involved.

### Canonical copy

1. The canonical disclosure copy MUST be defined as a single string constant in `apps/web/src/lib/disclosure.ts`, exported as `AFFILIATE_DISCLOSURE_VI` and `AFFILIATE_DISCLOSURE_EN`. The constants MUST be versioned via `DISCLOSURE_VERSION` (currently `"v1"`). The Vi text MUST be:
   > "SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public, chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn."

   The En text MUST be:
   > "SaleNoti is an affiliate price-tracker. When you click a deal in an alert or public page, we earn commission via the Shopee Affiliate Open API (1.5%–5% by category). You pay no extra. We DO NOT: auto-apply coupons, override affiliate cookies from other creators, or hide better deals to chase higher commissions."

2. The canonical disclosure MUST be the only string source for ALL disclosure surfaces. Re-typing the copy in any other file is forbidden; usage MUST import from `@/lib/disclosure`. The custom ESLint rule `disclosure-import-required` MUST flag string literals containing "Shopee" + "affiliate" + commission percentages anywhere outside `disclosure.ts`.

### Surface 1: Chrome Web Store listing

3. The Chrome Web Store extension listing description (`extension/public/store-listing.md`) MUST begin with the canonical Vi disclosure as the FIRST paragraph (above the product description). CI MUST verify this via `scripts/legal-check.mjs` — the build MUST fail if the disclosure is missing or modified.

### Surface 2: Web app onboarding

4. The web app first-sign-in onboarding MUST render `<OnboardingDisclosureStep />` as the first step (before "Track your first product" CTA). The user MUST click "I understand and agree" (Vietnamese: "Tôi đã hiểu và đồng ý") to advance. The dismissal MUST be tracked: `users.consents[]` MUST include `{ kind: "affiliate_disclosure_v1", version: "v1", grantedAt, ip_hash, ua_hash }`.

### Surface 3: Browser extension onboarding

5. The browser extension (FR-EXT-001) onboarding (first-install full-page tab) MUST render the full disclosure + the 5 ethical principles. The user MUST click "I understand" to proceed; that click MUST POST to `/api/auth/disclosure-ack` (extension cross-origin authenticated). Without acknowledgment, the extension MUST stay in a degraded state showing the onboarding modal on every Shopee.vn page visit.

### Surface 4: Every email (alert, transactional, marketing)

6. EVERY email sent by the platform MUST include the canonical disclosure paragraph in the footer, above the "manage notifications" link. The React Email base template (`apps/web/src/server/email/templates/base-template.tsx`) MUST inject `AFFILIATE_DISCLOSURE_VI` (Vi default) or `AFFILIATE_DISCLOSURE_EN` (when user locale is en) from the constant. Snapshot tests on alert email + magic-link email MUST verify presence.

### Surface 5: Every affiliate-tagged link CTA

7. EVERY UI surface rendering an affiliate-tagged "Mua trên Shopee" or equivalent CTA MUST display `<AffiliateDisclosureCard variant="inline" />` inline (max 2 lines) AND link to the full `/legal/affiliate` page. Surfaces affected: public deal page (FR-GROW-002), dashboard watchlist row, mega-sale list (FR-GROW-003 §1 #6), in-app product detail.

### Surface 6: Pre-click interstitial

8. The system MUST show a `<PreClickInterstitial />` modal on the user's FIRST affiliate-link click per browser session. The interstitial MUST display the full disclosure + the destination URL hostname (`shopee.vn`) + a "Continue" / "Cancel" choice. On "Continue", a `salenoti.pre_click_v1=1` cookie is set with 30-day TTL; subsequent clicks within the cookie window skip the interstitial. The "Cancel" choice MUST return the user to the previous page without firing the affiliate link.

### Surface 7: Public transparency report

9. The system MUST publish a Transparency Report quarterly at `/transparency/<YYYY-Q[1-4]>` (e.g., `/transparency/2026-q3`). The report MUST be generated from the template at `docs/legal/transparency-report-template.md` and MUST include:
   - Total commission earned (₫ and USD).
   - Total alerts sent (by trigger type).
   - Alert → Click CTR (overall + by trigger).
   - Click → Conversion rate.
   - All active affiliate networks (Shopee Open API; future: AccessTrade, etc.).
   - Per-network revenue share.
   - 5-principle ethics audit ("all green" or itemized deviations).
   - Privacy + breach incident log (FR-LEGAL-001 ties in).
   - DPO signature + date.
   The first report MUST be published within 14 days of quarter end. Late publication MUST trigger a Sentry alert.

### The 5 Ethical Principles (firewall)

10. The system MUST publish the 5 ethical principles at `/legal/affiliate` AND `docs/legal/ethics-principles.md`:
    - **Principle 1 (Transparency):** Disclosure on every surface where affiliate is involved.
    - **Principle 2 (User-initiated):** Affiliate links activate ONLY on explicit user click; no auto-redirects.
    - **Principle 3 (Coupon respect):** No auto-application; surface known codes as copy-paste text only.
    - **Principle 4 (Cookie respect):** No override of existing affiliate cookies from other publishers (KOCs).
    - **Principle 5 (No hide-better-deals):** Ranking uses observable user-value signals (price drop %, popularity, KOC verification) — NEVER internal commission rate.

11. The system MUST enforce Principle 3 via the ESLint rule `no-auto-apply-coupon` (in `eslint-rules/`) that fails CI if any code attempts to inject promo codes into Shopee checkout. Pattern matches: `applyCoupon|autoApplyPromo|injectPromoCode|setCouponField`.

12. The system MUST enforce Principle 4 via the FR-EXT-001 cookie-check (extension reads existing Shopee Affiliate cookie before setting our own; if present, leaves untouched). FR-EXT-001 §1 #5 enforces this; FR-LEGAL-002 AC7 cross-checks.

13. The system MUST enforce Principle 5 via the ESLint rule `no-commission-ranking` that fails CI on any `ORDER BY commission_rate` or equivalent in ranking queries. Additional check: grep across `apps/web/src/server/ranking/**` MUST return zero hits for "commission".

### Quarterly review

14. The 5 ethical principles MUST be reviewed quarterly by the founder (DPO) + counsel. Any deviation found MUST be: (a) documented in the next Transparency Report, (b) remediated within 14 days, (c) re-consent flow triggered if user-facing change.

### Open-source revenue model

15. The affiliate revenue calculator MUST be open-sourced at `/legal/affiliate#revenue-model` so any user can audit the math:
    ```
    ARPU = alerts_sent × CTR × conversion_rate × AOV × commission_rate
    ```
    The page MUST link to the live Transparency Report for current actuals. P2 may add a public spreadsheet via Google Sheets.

### Consent storage

16. Both consents (`affiliate_disclosure_v1` AND `privacy_v1` from FR-LEGAL-001) MUST be stored as separate entries in `users.consents[]`. A user signing up acknowledges BOTH; subsequent UI changes affecting either trigger re-consent of that specific kind only.

---

## §2 — Why this design

**Why a 5-principle ethics frame:** Plan §A3 enumerates exactly 5 (transparency, user-initiated, coupon-respect, cookie-respect, no-hide-better-deals). These ARE the "code of ethics" anti-Honey playbook. Wording them once (in `docs/legal/ethics-principles.md`) and binding every code surface (ESLint rules, ranking SQL, UI components) to them prevents principle drift over time. Without a canonical list, future engineers will gradually erode each principle individually with no audit trail.

**Why disclosure at every surface, not just `/legal/affiliate`:** FTC 16 CFR §255.5 ("Endorsement Guides") requires disclosure "clear and conspicuous" — meaning proximate to the action where the financial relationship is relevant. A buried legal page doesn't satisfy. Chrome Web Store 3/2025 Affiliate Ads Policy is even more explicit: disclosure must appear in (a) the Store listing description, (b) the extension's onboarding UI, and (c) on every page/email where a benefit is conferred to the user via the extension. This FR codifies all three plus the in-app pre-click moment.

**Why pre-click interstitial (not just inline disclosure):** the strongest "clear and conspicuous" pattern. Honey's catastrophic 2024 loss of trust came partly from users feeling deceived at the click moment ("I thought I was just visiting Amazon, not triggering an affiliate transaction"). An interstitial makes the affiliate relationship undeniable at the action moment — one click is a small UX cost (vs the alternative of being sued for FTC violations). Cookie-track makes it one-time-per-session, not every click, so habitual users don't suffer recurring friction.

**Why quarterly Transparency Report (not annual, not monthly):** plan §A3 principle 5 ("Có Privacy Policy theo chuẩn PDPL VN ... transparency report quarterly"). Annual is too long — by the time deviation surfaces, the damage is done. Weekly/monthly is operational overhead without proportional trust gain. Quarterly matches the SOC 2 / PCI compliance cadence operators expect from serious B2C SaaS.

**Why open-source the revenue calculator:** plan §A3 principle 4. Anyone can check our math against their personal alert log. This is what Honey didn't have — Honey's commission model was opaque, leading users to feel betrayed when it became public. We use radical transparency as the differentiator. The calculator is one paragraph + one formula; nothing proprietary; high trust dividend.

**Why ESLint rules instead of code review alone:** code review catches mistakes when reviewers are alert; rules catch them always. The two ESLint rules (`no-auto-apply-coupon`, `no-commission-ranking`) plus the `disclosure-import-required` rule mean a junior engineer cannot accidentally ship a violation of principles 2-5 — the CI blocks the PR. This makes the principles enforceable at the codebase level, not just policy level.

**Why two separate consents (privacy + affiliate disclosure):** they govern different processing categories. Privacy consent covers data processing (what we collect, why, retention); affiliate-disclosure consent covers the commercial relationship (we earn commission, here's how much). A user could conceivably accept one and not the other (e.g., decline marketing emails but accept affiliate disclosure). Separating them in `users.consents[]` lets withdrawal of one not invalidate the other.

**Why authoritative-Vietnamese (not English-first):** Plan §F1 personas (Gen-Z VN, Mẹ bỉm sữa VN) are Vietnamese-speaking. The disclosure must work in their primary language. English is a fallback for the small B2B / international audience. Plan §F1 + Vietnamese legal precedence (PDPL applies in Vi) both point this way.

**Why versioned constants + re-consent on change:** the canonical wording is the artifact. Any material change to the wording (adding a new commission source, removing a guarantee, etc.) MUST trigger re-acknowledgment — otherwise old users' "I consented to v1" becomes meaningless once the language drifts. Semantic versioning (`v1` → `v2` for material change; `v1.1` patch for typo-only) communicates which is which.

**Why open-source the calculator on `/legal/affiliate` (not GitHub first):** zero setup, immediately discoverable from the disclosure footer. GitHub mirror happens at P2 when public scrutiny of the formula becomes more valuable than its incremental visibility. The page also lets us inline a live calculator widget in P2.

---

## §3 — Canonical components

```tsx
// apps/web/src/lib/disclosure.ts
export const AFFILIATE_DISCLOSURE_VI = "SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public, chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác, ẩn deal tốt hơn để hưởng commission cao hơn.";

export const AFFILIATE_DISCLOSURE_EN = "SaleNoti is an affiliate price-tracker. When you click a deal in an alert or public page, we earn commission via the Shopee Affiliate Open API (1.5%–5% by category). You pay no extra. We DO NOT: auto-apply coupons, override affiliate cookies from other creators, or hide better deals to chase higher commissions.";

export const DISCLOSURE_VERSION = "v1" as const;

export const FIVE_PRINCIPLES_VI = [
  { id: 1, title: "Minh bạch", body: "Disclosure xuất hiện ở mọi surface có affiliate." },
  { id: 2, title: "Người dùng khởi tạo", body: "Affiliate link chỉ kích hoạt khi user click; không auto-redirect." },
  { id: 3, title: "Tôn trọng coupon", body: "Không auto-apply; chỉ surface known codes dạng copy-paste." },
  { id: 4, title: "Tôn trọng cookie", body: "Không override affiliate cookie của KOC/publisher khác." },
  { id: 5, title: "Không ẩn deal tốt hơn", body: "Ranking dùng signals khách quan — không bao giờ dùng commission rate." },
] as const;

// apps/web/src/components/disclosure/AffiliateDisclosureCard.tsx
import { AFFILIATE_DISCLOSURE_VI, AFFILIATE_DISCLOSURE_EN } from "@/lib/disclosure";

export function AffiliateDisclosureCard({ variant = "card" }: { variant?: "card" | "inline" | "footer" }) {
  const locale = useLocale();
  const copy = locale === "en" ? AFFILIATE_DISCLOSURE_EN : AFFILIATE_DISCLOSURE_VI;
  const cls = {
    card: "border border-amber-300 bg-amber-50 p-4 rounded-lg",
    inline: "text-xs text-gray-600 mt-1",
    footer: "text-[11px] text-gray-500 mt-6 border-t pt-4",
  }[variant];
  return (
    <div className={cls} data-testid="aff-disclosure" data-version={DISCLOSURE_VERSION}>
      <p>{copy}</p>
      <a href="/legal/affiliate" className="underline text-amber-700 text-xs">{locale === "en" ? "Read full →" : "Đọc đầy đủ →"}</a>
    </div>
  );
}

// apps/web/src/components/disclosure/PreClickInterstitial.tsx
export function PreClickInterstitial({ targetUrl, productName, onContinue, onCancel }: Props) {
  return (
    <Modal>
      <h2 className="text-lg font-bold">Bạn sắp chuyển sang Shopee</h2>
      <AffiliateDisclosureCard variant="card" />
      <p className="mt-3 text-sm">Sản phẩm: <b>{productName}</b></p>
      <p className="mt-1 text-xs text-gray-500">Đích đến: {new URL(targetUrl).hostname}</p>
      <div className="mt-4 flex gap-2">
        <button onClick={onContinue} className="bg-amber-500 text-white px-4 py-2 rounded">Continue to Shopee →</button>
        <button onClick={onCancel} className="border px-4 py-2 rounded">Hủy</button>
      </div>
    </Modal>
  );
}
```

---

## §4 — Acceptance criteria

| id | given | when | then |
|---|---|---|---|
| AC1 | `<AffiliateDisclosureCard />` | rendered on `/deal/<slug>`, watchlist row, mega-sale page | each surface contains the canonical disclosure text |
| AC2 | first affiliate-link click in session | user clicks "Mua trên Shopee" | `<PreClickInterstitial />` opens; cookie `salenoti.pre_click_v1=1` set with 30-day TTL on Continue |
| AC3 | second click in same session | user clicks another affiliate link | interstitial does NOT appear (cookie present) |
| AC4 | 30 days later, cookie expired | user clicks | interstitial returns |
| AC5 | magic-link email | render | footer contains exact `AFFILIATE_DISCLOSURE_VI` substring |
| AC6 | alert email | render | footer contains exact `AFFILIATE_DISCLOSURE_VI` substring; snapshot test enforces |
| AC7 | Chrome Web Store listing | `scripts/legal-check.mjs` runs in CI | reads `extension/public/store-listing.md`, asserts first non-empty paragraph matches canonical Vi; build fails on mismatch |
| AC8 | browser extension first install | onboarding modal | full-page disclosure + 5 principles; "I understand" click triggers POST to `/api/auth/disclosure-ack` |
| AC9 | extension without disclosure ack | user visits shopee.vn | extension shows onboarding modal blocking interaction; degraded state |
| AC10 | new user signup | DB after submission | `users.consents[]` contains `privacy_v1` AND `affiliate_disclosure_v1` |
| AC11 | existing affiliate cookie on shopee.vn session | FR-EXT-001 cookie check | extension does NOT override; AC7 in FR-EXT-001 cross-references |
| AC12 | engineer writes `applyCoupon()` call | ESLint runs | `no-auto-apply-coupon` rule flags; PR blocked |
| AC13 | engineer writes `ORDER BY commission_rate` in ranking SQL | ESLint + grep CI | `no-commission-ranking` rule flags; PR blocked |
| AC14 | quarter end (e.g., 2026-09-30) | T+14 days no report published | Sentry alert fires; founder notified to publish |
| AC15 | Transparency Report published | rendered at `/transparency/2026-q3` | contains all 9 required fields (commission, alerts, CTR, conversion, networks, share, ethics, breach, signature) |
| AC16 | 5 principles page | rendered at `/legal/affiliate` | all 5 principles displayed verbatim with `FIVE_PRINCIPLES_VI`; revenue calculator visible |
| AC17 | counsel updates disclosure wording (v1 → v2) | next user sign-in | re-consent flow renders; new `affiliate_disclosure_v2` consent required |
| AC18 | engineer types `"SaleNoti" + "affiliate" + "1.5%"` outside `disclosure.ts` | ESLint runs | `disclosure-import-required` rule flags; PR blocked |
| AC19 | user clicks "Cancel" on pre-click interstitial | UI state | returns to previous page; affiliate link NOT fired; no cookie set |
| AC20 | English-locale user | onboarding + alert email | renders `AFFILIATE_DISCLOSURE_EN`; disclosure card uses English text |

---

## §5 — Verification

```ts
// apps/web/tests/integration/legal.disclosure-surfaces.spec.ts
describe("FR-LEGAL-002 — disclosure at every surface", () => {
  it("AC5+AC6: emails contain canonical disclosure", () => {
    const ml = render(<MagicLinkEmail url="https://x" email="u@y.com" />);
    expect(ml).toContain(AFFILIATE_DISCLOSURE_VI);
    const al = render(<AlertEmail {...fixtureProps} />);
    expect(al).toContain(AFFILIATE_DISCLOSURE_VI);
    expect(al).toContain("KHÔNG: tự áp coupon");
  });

  it("AC7: legal-check CI gate on store listing", async () => {
    const result = await runScript("scripts/legal-check.mjs", "--check-listing");
    expect(result.exitCode).toBe(0);

    const tampered = "Some non-canonical text\n\nSaleNoti là extension...";
    fs.writeFileSync("extension/public/store-listing.md", tampered);
    const result2 = await runScript("scripts/legal-check.mjs", "--check-listing");
    expect(result2.exitCode).not.toBe(0);
    expect(result2.stderr).toContain("disclosure missing or modified");
  });

  it("AC10: signup persists both consents", async () => {
    await api.post("/api/auth/signup").send({
      email: "u@x.com",
      consents: { privacy_v1: true, affiliate_disclosure_v1: true, version: { privacy: "2026-05-16", affiliate: "v1" } },
    });
    const user = await db.users.findOne({ email: "u@x.com" });
    const kinds = user.consents.map((c: any) => c.kind);
    expect(kinds).toContain("privacy_v1");
    expect(kinds).toContain("affiliate_disclosure_v1");
  });

  it("AC12: no-auto-apply-coupon ESLint rule", async () => {
    const code = `function bad() { applyCoupon("CODE123"); }`;
    const result = await runESLint(code);
    expect(result.errors).toContainEqual(expect.objectContaining({
      messageId: expect.stringMatching(/coupon/i),
    }));
  });

  it("AC13: no-commission-ranking rule + grep gate", async () => {
    const sqlFiles = glob.sync("apps/web/src/server/ranking/**/*.sql");
    for (const f of sqlFiles) {
      const txt = fs.readFileSync(f, "utf8");
      expect(txt).not.toMatch(/ORDER BY[^;]*commission/i);
      expect(txt).not.toMatch(/ORDER BY[^;]*offer_rate/i);
    }
  });

  it("AC18: disclosure-import-required rule", async () => {
    const badCode = `const x = "SaleNoti là price-tracker affiliate. (1.5%-5%)";`;
    const result = await runESLint(badCode, { filename: "apps/web/src/components/Other.tsx" });
    expect(result.errors[0].messageId).toBe("disclosureImportRequired");
  });

  it("AC2+AC3+AC4: pre-click interstitial cookie lifecycle", async () => {
    const page = await browser.newPage();
    await page.goto("/deal/test");
    await page.click('[data-testid="buy-on-shopee"]');
    await expect(page.locator('[data-testid="pre-click-modal"]')).toBeVisible();
    await page.click('[data-testid="pre-click-continue"]');
    const cookies = await page.context().cookies();
    expect(cookies.find(c => c.name === "salenoti.pre_click_v1")).toBeDefined();

    await page.goto("/deal/test2");
    await page.click('[data-testid="buy-on-shopee"]');
    await expect(page.locator('[data-testid="pre-click-modal"]')).not.toBeVisible();
  });

  it("AC14: transparency report deadline alert", async () => {
    mockTime(new Date("2026-10-15")); // 15 days after Q3 end
    await db.transparencyReports.deleteMany({ quarter: "2026-q3" });
    await transparencyMonitorCron.run();
    expect(sentryMock.lastCapture.tags.fr).toBe("FR-LEGAL-002");
    expect(sentryMock.lastCapture.message).toMatch(/Transparency.*late/i);
  });
});
```

Custom ESLint rules:

```js
// eslint-rules/no-auto-apply-coupon.js
module.exports = {
  meta: { type: "problem", docs: { description: "Forbid auto-apply coupon code per FR-LEGAL-002 §1 #11" }, schema: [] },
  create(context) {
    return {
      CallExpression(node) {
        const txt = context.getSourceCode().getText(node);
        if (/applyCoupon|autoApplyPromo|injectPromoCode|setCouponField|fillCouponInput/i.test(txt)) {
          context.report({ node, message: "Auto-applying coupons violates FR-LEGAL-002 §1 #11 (Principle 3)." });
        }
      },
    };
  },
};

// eslint-rules/no-commission-ranking.js
module.exports = {
  meta: { type: "problem", docs: { description: "Forbid ranking by commission rate per FR-LEGAL-002 §1 #13" }, schema: [] },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (/ORDER BY[^;]*commission/i.test(node.value)) {
          context.report({ node, message: "Ranking by commission_rate violates FR-LEGAL-002 §1 #13 (Principle 5)." });
        }
      },
      TemplateLiteral(node) {
        const txt = context.getSourceCode().getText(node);
        if (/ORDER BY[^;]*commission/i.test(txt)) {
          context.report({ node, message: "Ranking by commission_rate violates FR-LEGAL-002 §1 #13 (Principle 5)." });
        }
      },
    };
  },
};
```

---

## §6 — Implementation skeleton

```ts
// apps/web/src/components/disclosure/OnboardingDisclosureStep.tsx
"use client";
import { useState } from "react";
import { AFFILIATE_DISCLOSURE_VI, FIVE_PRINCIPLES_VI, DISCLOSURE_VERSION } from "@/lib/disclosure";

export function OnboardingDisclosureStep({ onAccept }: { onAccept: () => void }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Trước khi bắt đầu — Một số điều bạn nên biết</h1>
      <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
        <p className="text-sm">{AFFILIATE_DISCLOSURE_VI}</p>
      </div>
      <h2 className="text-lg font-semibold mb-2">5 Nguyên tắc đạo đức của chúng tôi</h2>
      <ul className="space-y-2 mb-6">
        {FIVE_PRINCIPLES_VI.map(p => (
          <li key={p.id} className="text-sm">
            <b>#{p.id} {p.title}.</b> {p.body}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 mb-4">
        <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)} />
        <span className="text-sm">Tôi đã hiểu và đồng ý với các nguyên tắc trên</span>
      </label>
      <button
        disabled={!understood}
        onClick={async () => {
          await fetch("/api/auth/disclosure-ack", { method: "POST", body: JSON.stringify({ kind: "affiliate_disclosure_v1", version: DISCLOSURE_VERSION }) });
          onAccept();
        }}
        className="bg-blue-600 disabled:bg-gray-300 text-white px-6 py-2 rounded"
      >
        Tiếp tục →
      </button>
    </div>
  );
}

// scripts/legal-check.mjs
import fs from "fs";
import { AFFILIATE_DISCLOSURE_VI } from "../apps/web/src/lib/disclosure.js";

const args = process.argv.slice(2);
if (args.includes("--check-listing")) {
  const listing = fs.readFileSync("extension/public/store-listing.md", "utf8");
  const firstPara = listing.split("\n\n").find(p => p.trim().length > 0);
  if (!firstPara || !firstPara.includes(AFFILIATE_DISCLOSURE_VI)) {
    console.error("ERROR: extension/public/store-listing.md must start with canonical disclosure (missing or modified).");
    process.exit(1);
  }
  console.log("✓ Store listing disclosure verified");
}
if (args.includes("--check-emails")) {
  // similar check on email templates importing the constant
}
```

---

## §7 — Dependencies

- FR-AUTH-001/002 (consent storage layer; users.consents[])
- FR-NOTIF-001/002/003 (email/push/Telegram templates use base template footer)
- FR-EXT-001 (extension onboarding renders disclosure)
- FR-GROW-002 (public deal page renders disclosure card)
- FR-GROW-003 (mega-sale page renders disclosure card)
- React Email (`@react-email/components`) for transactional email rendering
- ESLint 9 (flat config) for custom rules

---

## §8 — Example payloads

### Chrome Web Store listing description (first paragraph — verbatim)

```
SaleNoti là price-tracker affiliate. Khi bạn click vào deal trong alert hoặc trang public,
chúng tôi nhận hoa hồng từ Shopee Affiliate Open API (1.5%–5% tùy ngành hàng). Bạn không
trả thêm. Chúng tôi KHÔNG: tự áp coupon, override cookie affiliate của KOC/publisher khác,
ẩn deal tốt hơn để hưởng commission cao hơn.

— SaleNoti là extension theo dõi giá Shopee, gửi alert khi giá giảm theo trigger bạn đặt.
[continues with product description]
```

### Transparency Report — Q3 2026 sample

```
# SaleNoti Transparency Report — 2026 Q3
## Affiliate revenue
- Total commission earned: 4,725,000 ₫ ($188)
- Alerts sent: 8,400
- Alert→Click CTR: 28%
- Click→Conversion: 4.2%
- Average commission rate: 3.1%

## Active affiliate networks
- Shopee Affiliate Open API VN (direct) — 95% revenue
- AccessTrade VN (fallback) — 5%

## 5-principle ethics audit
- Principle 1 (Transparency): ✅ All surfaces verified
- Principle 2 (User-initiated): ✅ Zero auto-redirects logged
- Principle 3 (Coupon respect): ✅ ESLint rule blocks; zero violations
- Principle 4 (Cookie respect): ✅ Extension cookie-check verified
- Principle 5 (No hide-better-deals): ✅ Ranking SQL audit passed

## Privacy & breach log
0 incidents.

## DPO: Stephen Cheng · 2026-10-14
```

---

## §9 — Open questions (resolved)

**Q1: Dismissible disclosure after one acknowledgment, or always-visible?**
A: Onboarding card requires explicit ack (one-time). Subsequent surfaces (alerts, deal pages, footer) are always visible. Pre-click interstitial is once-per-session via cookie. Users can ALWAYS reach the full text via `/legal/affiliate` link.

**Q2: Translate to English only, or all locales?**
A: Vi (authoritative) + En. Plan §F1 personas + plan §F4 international ambitions. Other locales added per future P4 multi-region work.

**Q3: Open-source revenue calc on GitHub or in privacy page?**
A: Privacy page first (zero setup, immediate discoverability). GitHub mirror at P2 when public scrutiny adds value.

**Q4: Auto-apply coupons — "never" or "with user consent"?**
A: Never. Plan §A3 principle 3 + Chrome 3/2025 Policy text are unambiguous. Even user consent doesn't override platform policy; we'd lose the extension over it.

**Q5: How do we handle KOC referral attribution?**
A: We don't override existing publisher cookies. If a user came to Shopee via a KOC's link and then triggers our alert, the KOC's commission is preserved. Our affiliate link applies only when no prior cookie is present.

**Q6: What if Shopee changes the commission rate range (e.g., 1.5-5% → 1-3%)?**
A: That's a material change requiring `affiliate_disclosure_v2`. Re-consent flow + new Transparency Report disclosure.

**Q7: Quarterly report — what if a quarter has zero revenue (early MVP)?**
A: Publish anyway. "0 ₫ commission this quarter — pre-launch / launch phase" is itself a trust signal. Transparency is about the cadence + the truth, not about the magnitude.

---

## §10 — Failure modes inventory

| # | mode | trigger | detection | resolution | severity |
|---|---|---|---|---|---|
| 1 | Disclosure copy drift across surfaces | snapshot test fails CI | PR blocked | update central constant + re-run | error |
| 2 | User dismisses pre-click interstitial via DevTools/cookie deletion | n/a (informational) | interstitial returns next session | by design — accept | info |
| 3 | Chrome Web Store rejects listing for disclosure wording | submission log | counsel reviews; update listing per reviewer guidance | resubmit; plan §H mitigation: "self-host CRX file" as Plan B | error |
| 4 | Engineer adds auto-apply code | ESLint `no-auto-apply-coupon` rule | PR blocked | code review reinforces; principle in `CONTRIBUTING.md` | error |
| 5 | Engineer ranks by commission accidentally | ESLint `no-commission-ranking` + grep CI check | build fails | refactor ORDER BY | error |
| 6 | Counsel updates wording mid-quarter | manual review | constant updated; users re-consent on next sign-in | force re-ack flow on next sign-in (AC17) | warning |
| 7 | Transparency Report late (>14d post-quarter) | scheduled cron | Sentry alert | founder publishes within 48h or post-mortem | warning |
| 8 | Affiliate-tagged link without disclosure card on a new page | visual regression test + manual audit | PR blocked if test exists | add `<AffiliateDisclosureCard />`; expand tests | warning |
| 9 | Existing publisher cookie hijack attempted | extension test (FR-EXT-001 AC) | E2E test fails | refactor extension to skip if cookie present | error |
| 10 | Pre-click cookie clobbered cross-domain | one extra interstitial per session | minor UX cost | acceptable | info |
| 11 | Engineer hardcodes disclosure copy outside `disclosure.ts` | ESLint `disclosure-import-required` rule | PR blocked | refactor to import from constant | error |
| 12 | Disclosure rendered with markdown that strips formatting in email client | email render test in Gmail/Outlook/iOS Mail | rendering audit | use plain prose, no rich formatting in disclosure copy | warning |
| 13 | Translation drift (Vi vs En meaning slightly different) | counsel review on update | annual review catches | counsel sign-off on any version bump for both languages | warning |
| 14 | Transparency report contains accidental PII (e.g., specific user counts low enough to identify) | review before publish | aggregation guards (no fewer than N users in any subgroup) | redact or aggregate further | warning |
| 15 | Counsel disagrees with our wording (e.g., "1.5%-5%" is misleading because actual avg is 3%) | feedback cycle | publish actual avg in next Transparency Report; consider wording update | balance specificity with accuracy | info |
| 16 | New affiliate network added (e.g., AccessTrade) | counsel review | update Transparency Report; potentially update disclosure copy if commission range shifts | material change → v2 + re-consent | warning |
| 17 | User-locale detection fails (defaults wrong) | fallback to Vi | unrelated risk; Vi is the safe authoritative default | accept | info |

---

## §11 — Notes

- The wording in §1 #1 is the canonical artefact for this FR. Any change requires a new FR (`FR-LEGAL-002a` or similar) and a re-consent flow for existing users.
- The 5 ethical principles act as the moral firewall — when a future FR tries to optimize revenue, run it past §1 #10 first. If it violates any principle, redesign.
- Plan §A3 closing line: "Đây không phải là nice-to-have. Đây là moat" — quote it on the legal landing page above the 5 principles.
- The ESLint rules + grep CI checks are unusual but justified: principles are easy to write down and easy to forget. Code-level enforcement is cheap and persistent.
- The Transparency Report cadence (quarterly) is intentionally aligned with SOC 2 / PCI cadences — when we mature to those compliance frameworks (P3), the existing quarterly pattern absorbs naturally.
- Pre-click interstitial cookie lifetime (30 days) matches the typical Shopee Affiliate cookie lifetime — they're conceptually aligned: a single "session of intent" to shop.
- If a user signs up via the extension (instead of the web app first), the extension onboarding doubles as the web-app consent: the `affiliate_disclosure_v1` consent is created during extension install, and the web app's onboarding skips this step if the consent is already present.

---

*FR-LEGAL-002 spec — last revised 2026-05-16. Status: shipped (2026-05-17).*
