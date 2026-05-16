---
fr_id: FR-EXT-001
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.5/10
score_post_revision_1: 9.0/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 11
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-EXT-001 ships ship-grade after two rounds. The Chrome extension is simultaneously the highest-trust user surface (users grant it access to their Shopee sessions) AND the highest-risk surface (one wrong permission or auto-apply behavior → Chrome Web Store reject within days). The 5-principle ethics firewall (FR-LEGAL-002) is enforced at the manifest level (no `cookies` permission, no `<all_urls>`), at code level (static-audit grep), and at runtime (cookie-respect check). Multi-layer defense is the only way to ship this safely.

Round-1 (6 issues): static-audit grep against bundled JS for forbidden Shopee endpoints, button-debounce on rapid clicks, semver bump rule on manifest permission changes, Sentry capture in service worker, popup minimalism, dev-vs-production EXT_ID handling.
Round-2 (5 issues): button visual collision with Shopee modals (z-index), URL pattern resilience (A/B layouts), onboarding auto-open on install, English-locale fallback, semantic versioning on disclosure version.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Static audit against bundled JS missing
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #22 + §5 `static-audit.spec.ts` greps `dist/content.js` + `dist/background.js` for forbidden Shopee internal endpoints; AC11 + AC21 verify.

### ISS-002 — Rapid click → multiple API calls (no debounce)
- **severity:** warning · **rule_id:** ux + abuse
- **status:** RESOLVED — §1 #17 + §6 `isProcessing` lock + button.disabled 1s; AC17 verifies 1 call from 3 rapid clicks.

### ISS-003 — Manifest permission change doesn't trigger MAJOR bump
- **severity:** warning · **rule_id:** versioning
- **status:** RESOLVED — §1 #25 + AC15 + AC16: MAJOR bump on material permission change; users see Chrome re-prompt; release notes communicate.

### ISS-004 — Service worker errors uncaptured
- **severity:** error · **rule_id:** observability
- **status:** RESOLVED — §1 #28 + §6 `Sentry.init` in `background.js` with `tags.fr = "FR-EXT-001"`; FR-OBS-001 cross-reference.

### ISS-005 — Popup scope creep (could grow to in-popup watchlist UI)
- **severity:** info · **rule_id:** scope-discipline
- **status:** RESOLVED — §1 #24 + §9 Q2: popup deliberately minimal; single "Mở dashboard" link; in-popup watchlist deferred.

### ISS-006 — Dev (unpacked) vs production EXT_ID
- **severity:** warning · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #17 + §10 row 12 + §11 note: FR-AUTH-003 CORS whitelist supports both production EXT_ID + dev EXT_ID gated by NODE_ENV.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Z-index collision with Shopee overlays
- **severity:** warning · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #8 z-index 999999 + position:absolute; AC2 verifies; §10 row 16 documents.

### ISS-008 — A/B page layout breaks image selector
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #8 fallback to `document.body` if image selector fails; §10 row 8 documents.

### ISS-009 — Onboarding doesn't auto-open on install (lazy onboarding)
- **severity:** error · **rule_id:** compliance
- **status:** RESOLVED — §1 #18 + §6 `chrome.runtime.onInstalled` listener opens onboarding tab; AC5 verifies; Chrome 3/2025 Affiliate Ads Policy requires disclosure BEFORE feature encounter.

### ISS-010 — English-locale users see Vietnamese-only disclosure
- **severity:** warning · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #19 `chrome.i18n.getUILanguage()` detection; AC22 verifies English fallback.

### ISS-011 — Disclosure version not tracked separately from manifest version
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #20 + §6 `disclosureVersion: "v1"` separate from manifest version; allows manifest bump without disclosure re-consent if copy unchanged.

## §4 — Strengths preserved

- **Strict permission scope** (`storage` + `activeTab` only, no `tabs`/`webRequest`/`cookies`) makes Chrome Web Store review fast AND defends ethics principles at the manifest level — engineer cannot accidentally violate them.
- **No-Shopee-internal-API rule** enforced by static-audit grep at build time; defends both plan §B1 (legal exposure) AND principle 4 (ethical scraping).
- **Cookie-respect via `respect_other_publisher` flag** + cookie-detection regex preserves KOC attribution; ethically correct AND legally defensive (no commission-poaching claims).
- **Onboarding auto-opens on install** (not lazy) satisfies Chrome 3/2025 Affiliate Ads Policy "disclosure BEFORE feature encounter".
- **CORS pinning via FR-AUTH-003** prevents malicious extensions from impersonating our extension's API access.
- **Static-audit test** (grep against bundled JS) catches the principle violations definitively at build time — cheap, persistent guardrail.
- **Debounced clicks + z-index 999999 + fallback selectors** make the button robust against Shopee's UX experiments.
- **§10 has 17 failure-mode rows** including the subtle "Chrome A/B layout breaks selectors", "Sentry quota exhausted from SW errors", and "dev EXT_ID vs production EXT_ID" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR plus FR-WATCH-001 are the entire fast-tracking user experience. Combined with FR-LEGAL-002 (disclosure surfaces) and FR-AUTH-003 (cross-origin cookie auth), it forms the trustworthy-extension trio that Plan §J Phase 1 (300+ installs) depends on. The static-audit grep + manifest-lint enforce ethics principles at build time, making them resistant to engineer drift.

---

*End of FR-EXT-001 audit (round 2 final). Last revised: 2026-05-16.*
