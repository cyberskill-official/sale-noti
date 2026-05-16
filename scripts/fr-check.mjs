#!/usr/bin/env node
/**
 * fr-check — drift catcher for the FR authoring workflow.
 * Enforces docs/FR_AUTHORING_WORKFLOW.md §11.
 *
 * Run: pnpm fr:check
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FR_ROOT = join(ROOT, "docs/feature-requests");

const MODULES = ["auth", "legal", "obs", "worker", "aff", "watch", "price", "notif", "ext", "bill", "grow", "admin"];
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Check 1: every FR-*.md has a matching .audit.md (and vice-versa)
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  const files = readdirSync(modDir);
  const frs = files.filter((f) => f.startsWith("FR-") && f.endsWith(".md") && !f.endsWith(".audit.md"));
  const audits = files.filter((f) => f.endsWith(".audit.md"));
  for (const fr of frs) {
    const expectedAudit = fr.replace(/\.md$/, ".audit.md");
    if (!audits.includes(expectedAudit)) errors.push(`Missing audit for ${mod}/${fr}`);
  }
}

// Check 2: FR-ID density per module (001, 002, 003 — no skips)
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  const nums = readdirSync(modDir)
    .filter((f) => /^FR-[A-Z]+-\d{3}-/.test(f) && !f.endsWith(".audit.md"))
    .map((f) => Number(f.match(/^FR-[A-Z]+-(\d{3})-/)[1]))
    .sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      errors.push(`FR-ID density broken in ${mod}/: expected FR-${mod.toUpperCase()}-${String(i + 1).padStart(3, "0")}, found ${String(nums[i]).padStart(3, "0")}`);
      break;
    }
  }
}

// Check 3: every FR has the required frontmatter fields
const REQUIRED_FIELDS = ["id", "title", "module", "priority", "status", "verify", "phase", "slice", "owner", "created"];
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => /^FR-/.test(x) && !x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      errors.push(`${mod}/${f}: missing frontmatter`);
      continue;
    }
    const fm = fmMatch[1];
    for (const field of REQUIRED_FIELDS) {
      if (!new RegExp(`^${field}:\\s`, "m").test(fm)) errors.push(`${mod}/${f}: missing frontmatter field "${field}"`);
    }
  }
}

// Check 4: status: accepted requires audit score_post_revision_2: 10/10
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => /^FR-/.test(x) && !x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    if (!/^status:\s+accepted/m.test(text)) continue;
    const auditPath = join(modDir, f.replace(/\.md$/, ".audit.md"));
    if (!existsSync(auditPath)) continue;
    const audit = readFileSync(auditPath, "utf8");
    if (!/^score_post_revision_2:\s+10\/10/m.test(audit)) {
      errors.push(`${mod}/${f}: status=accepted but audit lacks score_post_revision_2: 10/10`);
    }
  }
}

// Check 5: BCP-14 keywords in §1
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => /^FR-/.test(x) && !x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    const sec1 = text.match(/## §1[\s\S]*?(?=## §2)/);
    if (!sec1) {
      errors.push(`${mod}/${f}: missing §1 section`);
      continue;
    }
    if (!/\b(MUST|SHOULD|COULD|MAY)\b/.test(sec1[0])) {
      errors.push(`${mod}/${f}: §1 lacks BCP-14 keywords`);
    }
  }
}

// Check 6: effort_hours populated (FR_AUTHORING_WORKFLOW.md §11 + §13 hard rules)
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => /^FR-/.test(x) && !x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const m = fmMatch[1].match(/^effort_hours:\s*(\d+)\s*$/m);
    if (!m || Number(m[1]) < 1) errors.push(`${mod}/${f}: effort_hours missing or zero (AUTHORING §13 §11 drift catcher)`);
  }
}

// Check 7: audit issues_resolved ≥ 6 (FR_AUTHORING_WORKFLOW.md §14)
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    const m = text.match(/^issues_resolved:\s*(\d+)\s*$/m);
    if (!m) {
      errors.push(`${mod}/${f}: audit missing issues_resolved field`);
      continue;
    }
    if (Number(m[1]) < 6) errors.push(`${mod}/${f}: audit issues_resolved=${m[1]} < 6 (AUTHORING §14 hard floor)`);
  }
}

// Check 8: §10 failure-mode table has ≥ 10 rows
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => /^FR-/.test(x) && !x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    const sec10 = text.match(/## §10[\s\S]*?(?=## §11)/);
    if (!sec10) continue;
    // Count table data rows: pipe-delimited lines, exclude header + separator rows
    const rows = sec10[0]
      .split("\n")
      .filter((l) => /^\|\s*[^|\s-]/.test(l)) // starts with `| ` then a non-pipe, non-whitespace, non-dash char
      .filter((l) => !/^\|[\s|-]+\|$/.test(l)); // exclude pure-separator rows like `|---|---|`
    // Drop the header row (first non-separator row)
    const dataRowCount = Math.max(0, rows.length - 1);
    if (dataRowCount < 10) {
      errors.push(`${mod}/${f}: §10 failure-mode table has ${dataRowCount} rows, expected ≥ 10 (AUTHORING §11 drift catcher)`);
    }
  }
}

// Check 9: YAML-safe frontmatter — no unquoted `#` inside unquoted scalar or flow-array values
for (const mod of MODULES) {
  const modDir = join(FR_ROOT, mod);
  if (!existsSync(modDir)) continue;
  for (const f of readdirSync(modDir).filter((x) => /^FR-/.test(x) && !x.endsWith(".audit.md"))) {
    const text = readFileSync(join(modDir, f), "utf8");
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const lines = fmMatch[1].split("\n");
    for (const line of lines) {
      // Skip blank, comment-only, or list-item lines
      if (/^\s*(#|$|-\s)/.test(line)) continue;
      // Check `key: value` form with an unquoted `#`
      const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.+)$/i);
      if (!m) continue;
      const value = m[2];
      // Skip quoted scalar values
      if (/^".*"$/.test(value.trim()) || /^'.*'$/.test(value.trim())) continue;
      // Strip out any single- or double-quoted substrings (their contents are safe).
      const stripped = value.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
      // Flow-array: each element must be quoted if it contains `#`
      if (/^\[.*\]$/.test(value.trim())) {
        if (/\s#\S/.test(stripped)) {
          errors.push(`${mod}/${f}: frontmatter "${m[1]}" has unquoted '#' inside flow-array — YAML parses as comment (AUTHORING §13.1)`);
        }
        continue;
      }
      // Plain scalar: `#` preceded by whitespace is a comment start
      if (/\s+#\S/.test(stripped)) {
        errors.push(`${mod}/${f}: frontmatter "${m[1]}: ${value.slice(0, 50)}..." has unquoted '#' — YAML parses as trailing comment (AUTHORING §13.2)`);
      }
    }
  }
}

if (errors.length) {
  console.error(`❌ fr-check found ${errors.length} issues:`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✅ fr-check passed — all FRs conform to docs/FR_AUTHORING_WORKFLOW.md §11");
