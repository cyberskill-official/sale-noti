#!/usr/bin/env node
/**
 * legal-check — enforce FR-LEGAL-002 disclosure binding.
 * Catches drift in the canonical affiliate disclosure copy.
 *
 * Run: pnpm legal:check
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const require = createRequire(import.meta.url);
const { AFFILIATE_DISCLOSURE_VI } = require("../packages/disclosure-copy");

const CANONICAL_VI = AFFILIATE_DISCLOSURE_VI;
const CANONICAL_FRAGMENT_VI = "KHÔNG: tự áp coupon";

// Per FR-LEGAL-002 §1 #2: surfaces SHOULD import the canonical constant rather than re-type the copy.
// A file is conformant if it EITHER (a) contains the literal canonical text (markdown / listing surfaces) OR
// (b) imports AFFILIATE_DISCLOSURE_VI / AFFILIATE_DISCLOSURE_EN from the canonical module and references it.
const CANONICAL_IMPORT_RE =
  /import\s*\{[^}]*\bAFFILIATE_DISCLOSURE_(?:VI|EN)\b[^}]*\}\s*from\s*["'](?:[^"']*\/disclosure|@salenoti\/disclosure-copy)["']/;
const CANONICAL_REFERENCE_RE = /\bAFFILIATE_DISCLOSURE_(?:VI|EN)\b/;

const errors = [];

// Targets that MUST render the canonical disclosure (per FR-LEGAL-002 §1 #2-5)
const targets = [
  { name: "Chrome Web Store listing", path: "extension/public/store-listing.md", optional: true, importAllowed: false },
  {
    name: "Magic-link email template",
    path: "apps/web/src/server/email/templates/magic-link.tsx",
    optional: true,
    importAllowed: true,
  },
  {
    name: "Alert email template",
    path: "apps/web/src/server/email/templates/alert.tsx",
    optional: true,
    importAllowed: true,
  },
  {
    name: "API alert email template",
    path: "apps/api/src/notify/render-alert-email.ts",
    optional: false,
    importAllowed: true,
  },
  { name: "Disclosure copy constant", path: "apps/web/src/lib/disclosure.ts", optional: true, importAllowed: true },
  {
    name: "Affiliate disclosure copy",
    path: "docs/legal/affiliate-disclosure-copy.md",
    optional: false,
    importAllowed: false,
  },
];

for (const t of targets) {
  const fullPath = join(ROOT, t.path);
  if (!existsSync(fullPath)) {
    if (!t.optional) errors.push(`${t.name}: missing file ${t.path}`);
    continue;
  }
  const text = readFileSync(fullPath, "utf8");
  const hasLiteral = text.includes(CANONICAL_VI) || text.includes(CANONICAL_FRAGMENT_VI);
  const hasImport = t.importAllowed && CANONICAL_IMPORT_RE.test(text) && CANONICAL_REFERENCE_RE.test(text);
  if (!hasLiteral && !hasImport) {
    errors.push(
      `${t.name} (${t.path}): missing canonical disclosure paragraph (literal text or import of AFFILIATE_DISCLOSURE_VI from /disclosure required)`,
    );
  }
}

// Rule from FR-LEGAL-002 §1 #10 + FR-AFF-003 AC6: no ORDER BY commission anywhere in server code
function walk(dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".next" || f === "dist") continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, results);
    else if (/\.(ts|tsx|sql)$/.test(f)) results.push(p);
  }
  return results;
}

const apiSrc = join(ROOT, "apps/api/src");
const webServerSrc = join(ROOT, "apps/web/src/server");
const allFiles = [...walk(apiSrc), ...walk(webServerSrc)];

for (const f of allFiles) {
  const text = readFileSync(f, "utf8");
  if (/ORDER BY[^;)]*commission/i.test(text)) errors.push(`${f}: ORDER BY commission — violates FR-LEGAL-002 §1 #10`);
  if (/sortBy.*commission/i.test(text)) errors.push(`${f}: sortBy commission — violates FR-LEGAL-002 §1 #10`);
}

const requiredRuleFiles = [
  "eslint-rules/no-auto-apply-coupon.cjs",
  "eslint-rules/no-commission-ranking.cjs",
  "eslint-rules/disclosure-import-required.cjs",
];
for (const file of requiredRuleFiles) {
  if (!existsSync(join(ROOT, file))) errors.push(`${file}: missing required FR-LEGAL-002 ESLint rule`);
}

const requiredLegalDocs = ["docs/legal/ethics-principles.md", "docs/legal/transparency-report-template.md"];
for (const file of requiredLegalDocs) {
  if (!existsSync(join(ROOT, file))) errors.push(`${file}: missing required FR-LEGAL-002 legal document`);
}

for (const f of [
  ...walk(join(ROOT, "apps/web/src")),
  ...walk(join(ROOT, "apps/api/src")),
  ...walk(join(ROOT, "extension/src")),
]) {
  const normalized = f.replace(/\\/g, "/");
  if (normalized.endsWith("apps/web/src/lib/disclosure.ts")) continue;
  const text = readFileSync(f, "utf8");
  if (text.includes("SaleNoti là price-tracker affiliate") && text.includes("1.5%")) {
    errors.push(`${normalized}: hard-coded disclosure copy — import the canonical constant instead`);
  }
}

// Extension manifest: no <all_urls>
const manifestPath = join(ROOT, "extension/manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const hostPerms = manifest.host_permissions ?? [];
  if (hostPerms.some((p) => p === "<all_urls>"))
    errors.push(`extension/manifest.json: <all_urls> — violates FR-EXT-001 §1 #1`);
  if (manifest.manifest_version !== 3)
    errors.push(`extension/manifest.json: not Manifest V3 — violates FR-EXT-001 §1 #1`);
}

if (errors.length) {
  console.error(`❌ legal-check found ${errors.length} issues:`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✅ legal-check passed — disclosure surfaces intact, no commission-rate ranking, manifest scope clean");
