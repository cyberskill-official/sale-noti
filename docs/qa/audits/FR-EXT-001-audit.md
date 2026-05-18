# FR-EXT-001 Audit Report

**FR:** Chrome MV3 extension track button  
**Audit date:** 2026-05-19  
**State:** shipped + strict-audited  
**Failure count:** 1 resolved coverage/tooling issue

## Audit Verdict

The extension passes static and runtime validation for Manifest V3 scope, narrow Shopee VN host permissions, no cart scraping, required icons, disclosure-gated content injection, background tracking messages, onboarding disclosure persistence, options reset, and popup state display.

The audit initially found coverage tooling was absent for the extension package. `@vitest/coverage-v8` is now configured, and runtime tests import the content script, background service worker, onboarding, options, and popup modules under mocked Chrome/DOM APIs.

## Edge-Case Matrix

| Vector | Case | Result |
| --- | --- | --- |
| Manifest scope | Host permissions | `*://*.shopee.vn/*`, no `<all_urls>` |
| Product matcher | Content script pattern | `*://*.shopee.vn/*-i.*.*` |
| Disclosure | No local acknowledgement | Shows disclosure-required panel |
| Idempotency | Content script imports twice | Does not duplicate panel/button |
| Existing publisher | Affiliate cookie present | Sends `affiliateCookiePresent: true` |
| API result | success/sign-in/cap/error/network | Button/toast state handled |
| Background | `openOnboarding` | Opens extension onboarding page |
| Tracking | `trackProduct` | Calls backend with source `ext`; maps 401/network |
| Install | `onInstalled` reason install | Opens onboarding |
| Runtime pages | popup/options/onboarding | Manage disclosure state and sign-in flow |

## Raw Terminal Results

```text
$ pnpm --filter @salenoti/extension exec vitest run tests/manifest.spec.ts tests/runtime.spec.ts
Test Files  2 passed (2)
Tests       8 passed (8)
```

```text
$ pnpm --filter @salenoti/extension exec vitest run tests/manifest.spec.ts tests/runtime.spec.ts --coverage --coverage.include=src/content.ts --coverage.include=src/background.ts --coverage.include=src/options/options.ts --coverage.include=src/onboarding/onboarding.ts --coverage.include=src/popup/popup.ts --coverage.reporter=text
All files       96.87% statements, 79.59% branches, 100% funcs, 96.87% lines
background.ts   92.5% statements, 92.5% lines
content.ts      98.42% statements, 98.42% lines
onboarding.ts   100% statements, 100% lines
options.ts      90% statements, 90% lines
popup.ts        100% statements, 100% lines
```

```text
$ pnpm --filter @salenoti/extension exec tsc --noEmit
$ pnpm --filter @salenoti/extension exec eslint "src/**/*.ts"
$ pnpm --filter @salenoti/extension exec node esbuild.config.mjs
extension: built dist/
```

## Live Verification

Manual Chrome Web Store/load-unpacked review is still a human gate. Local build emits `dist/` with manifest, scripts, and icons.

