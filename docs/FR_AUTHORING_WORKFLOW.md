# SaleNoti — Feature-Request Authoring Workflow

**Owner:** Stephen Cheng (Founder)
**Status:** v1.0.0 — adopted 2026-05-16 with the initial 26-FR batch
**Use when:** authoring a new feature request before any code lands.

This document is the canonical playbook for sale-noti. Every FR that ships into SaleNoti starts here.

---

## §1 — The mental model

One FR = one atomic, testable, normative requirement. Smaller is better.

- **Atomic** — covers exactly one capability. If you can't test it independently with a single integration test, it's two FRs.
- **Testable** — the FR has a verification method (unit / integration / chaos / manual) and an acceptance signal.
- **Normative** — uses BCP-14 keywords (`MUST` / `SHOULD` / `COULD` / `MAY`) and is precise enough that two engineers reading it write the same code.

One FR → one task → (eventually) one PR.

---

## §2 — File layout

```
sale-noti/
└── docs/
    ├── README.md
    ├── FR_AUTHORING_WORKFLOW.md           ← this file (project-local)
    ├── SaleNoti — Plan.pdf                ← source plan
    └── feature-requests/                  ← single source of truth for live FRs
        ├── MANIFEST.json                  ← state file
        ├── BACKLOG.md                     ← phase-by-phase index
        ├── SESSION_PROGRESS.md
        ├── P0_AUDIT_SUMMARY.md
        ├── P1_AUDIT_SUMMARY.md
        ├── P2_AUDIT_SUMMARY.md
        ├── auth/                          ← one folder per module
        │   ├── FR-AUTH-001-google-oauth-authjs-v5.md
        │   ├── FR-AUTH-001-google-oauth-authjs-v5.audit.md
        │   └── ...
        ├── legal/  obs/  worker/  aff/  watch/
        ├── price/  notif/  ext/  bill/  grow/  admin/
```

| Convention | Value |
|---|---|
| FR-ID format | `FR-{MOD}-{NNN}` where `{MOD}` is from the closed catalogue (`AUTH`, `LEGAL`, `OBS`, `WORKER`, `AFF`, `WATCH`, `PRICE`, `NOTIF`, `EXT`, `BILL`, `GROW`, `ADMIN`) and `{NNN}` is zero-padded three digits, dense within the module (001, 002, 003 — never skip) |
| Filename | `FR-{MOD}-{NNN}-{slug}.md` where slug is kebab-case, ≤ 50 chars |
| Per-module folder | lowercase module code (`auth/`, `aff/`, etc.) |
| Status states | `draft` → `audited` → `accepted` → `building` → `shipped` (or `deferred` / `rejected`) |

---

## §3 — Authoring procedure (manual, MVP)

For each new FR:

1. Identify the module from §2's closed catalogue. Add a new entry to `BACKLOG.md` in the appropriate phase + module section.
2. Increment `MANIFEST.json` → `last_fr_id_per_module.<MODULE>`.
3. Create the markdown file in `docs/feature-requests/<module>/FR-<MOD>-<NNN>-<slug>.md` with the frontmatter (§6) and the 11 body sections (§4).
4. Two-round audit per §5. Both rounds documented in the corresponding `.audit.md` file using the engineering-spec template (§5.2).
5. When all issues are resolved and the score reaches 10/10, set `status: accepted` in the FR frontmatter.
6. Create a corresponding task (Cowork TaskCreate or TASKS.md) referencing the FR-ID.
7. Build (one FR per PR). On merge, set `status: shipped` and `shipped: <date>` in the FR frontmatter.

(P2+: this workflow can be automated via a project-local CLI; manual at MVP scale is the cheapest path.)

---

## §4 — FR body shape (11 mandatory sections)

```markdown
---
{frontmatter — see §6}
---

## §1 — Description (BCP-14 normative)
Numbered clauses with MUST / SHOULD / COULD / MAY. Each clause is independently testable.

## §2 — Why this design
Rationale per non-obvious decision. Cite the source plan section number when applicable.

## §3 — API contract & code shape
HTTP, GraphQL, function signatures, DB schema. Implementable.

## §4 — Acceptance criteria
Numbered, observable, automatable. One AC ≈ one test case.

## §5 — Verification
Test code in TypeScript (Jest/Vitest/Playwright). Concrete fixtures.

## §6 — Implementation skeleton
The 30–60 lines an engineer would actually write. Compilable.

## §7 — Dependencies
External (vendor, env, infra). Internal (FR-IDs).

## §8 — Example payloads
Sample requests / responses / DB rows / log lines.

## §9 — Open questions
Either resolved at authoring time (recommended for 10/10) OR explicitly deferred to a P-N re-batch.

## §10 — Failure modes inventory
Table of (Failure | Detection | Outcome | Recovery). 8–12 rows typical.

## §11 — Notes
Anything not normative but useful — historical context, related plan refs, sub-decisions punted to ops.
```

---

## §5 — Audit procedure

### §5.1 — Two rounds, always

- **Round 1:** find structural issues (missing sections, ambiguous BCP-14 clauses, security gaps, observability holes). Document each issue with `severity ∈ {error, warning, info}` and `rule_id`.
- **Round 2:** find subtler issues (concurrency races, edge cases, drift catchers, CI gates).

The starting score is typically 7.5–8.5; round-1 brings it to 9.0–9.5; round-2 closes to 10/10.

### §5.2 — Engineering-spec audit template (v1)

```markdown
---
fr_id: FR-<MOD>-<NNN>
audited: <ISO date>
auditor: manual (engineering-spec template v1)
verdict: PASS | PASS_WITH_REVISIONS | FAIL
score_pre_revision: X.X/10
score_post_revision_1: X.X/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: N
issues_critical: 0
template: engineering-spec@1
---

## §1 — Verdict summary
1–2 paragraphs: starting state, key issues, resolution.

## §2 — Round-1 findings (resolved)
- ISS-001 (severity) Title — RESOLVED §X.Y + AC<n>.
- ISS-002 ...

## §3 — Round-2 findings (resolved)
- ISS-00N (severity) Title — RESOLVED ...

## §4 — Strengths preserved
Bullet list of what stays.

## §5 — Resolution
Final score + ship verdict.
```

### §5.3 — Severity codes

- **error** — would break correctness, security, or production. Must resolve before accept.
- **warning** — would degrade UX or operability. Should resolve before accept; deferral requires explicit note.
- **info** — nice-to-have refinement. Resolution recommended but not blocking.

### §5.4 — 10/10 criteria

An FR scores 10/10 only when:

- All §1 clauses are BCP-14 normative.
- §2 explains every non-obvious decision (no "because I felt like it").
- §3 contract compiles or is directly translatable to compilable code.
- Each §4 AC is independently testable.
- §5 contains code, not prose.
- §6 skeleton is ≤ 60 lines and runs against §7 deps.
- §9 has zero open questions, OR each open one is explicitly punted to a named future FR.
- §10 enumerates ≥ 8 failure modes with concrete detection + recovery columns.
- Round-1 + Round-2 audit files exist with 0 issues_open and 0 issues_critical.

---

## §6 — Frontmatter schema

Required on every FR:

```yaml
---
id: FR-<MOD>-<NNN>                          # e.g., FR-AUTH-001
title: "<short imperative title>"
module: <MOD>                                # closed enum from §2 table
priority: MUST | SHOULD | COULD | MAY        # BCP-14
status: draft | audited | accepted | building | shipped | deferred | rejected
verify: T | I | A | D                        # Test | Inspection | Analysis | Demonstration
phase: P0 | P1 | P2 | P3 | P4
milestone: "<phase short label>"
slice: 1                                     # which slice within the module
owner: <person or role>
created: <ISO date>
related_frs: [FR-IDs]                        # cross-references
depends_on: [FR-IDs]                         # must be shipped before this can build
blocks: [FR-IDs]
effort_hours: <integer>
new_files:                                   # files this FR creates
  - <path>
modified_files:                              # files this FR edits
  - <path>
allowed_tools:                               # what the implementer may use
  - <tool>
disallowed_tools:                            # what's banned (with reason in §2 if needed)
  - <tool>
risk_if_skipped: "<one sentence>"
---
```

---

## §7 — Status lifecycle

```
draft
  ↓ (round 1 audit complete)
audited (round-1 verdict in .audit.md)
  ↓ (round 2 audit reaches 10/10)
accepted (status: accepted in FR frontmatter)
  ↓ (engineer picks up task, opens branch)
building
  ↓ (PR merges fulfilling AC4 fully)
shipped (status: shipped; shipped: <date> added)
```

Alternate terminal states:

- `deferred` — accepted but parked (resource/sequencing). Should have a `deferred_reason` field.
- `rejected` — author or reviewer decides not to build. Should have `rejected_reason`.
- `superseded` — replaced by a newer FR. Should have `superseded_by: FR-<NEW>`.

---

## §8 — Task integration

Two persistence paths (use whichever fits the moment):

### Path A — Cowork TaskCreate

In a Cowork session, the task list lives in the session UI; one task per FR.

### Path B — TASKS.md (project-local)

For long-running work, append to `TASKS.md` at the sale-noti project root:

```markdown
## AUTH module · slice 1

- [ ] FR-AUTH-001 — Google OAuth via Auth.js v5 pinned  ·  status: accepted  ·  est: 6h
- [ ] FR-AUTH-002 — Email magic-link  ·  status: accepted  ·  est: 5h
- [ ] FR-AUTH-003 — JWT session + refresh rotation  ·  status: accepted  ·  est: 5h
```

When a PR merges fulfilling an FR, tick the box and update `shipped:` in the FR markdown frontmatter.

---

## §9 — Worked example: FR-AUTH-001

See [`feature-requests/auth/FR-AUTH-001-google-oauth-authjs-v5.md`](feature-requests/auth/FR-AUTH-001-google-oauth-authjs-v5.md) and [`feature-requests/auth/FR-AUTH-001-google-oauth-authjs-v5.audit.md`](feature-requests/auth/FR-AUTH-001-google-oauth-authjs-v5.audit.md).

Score progression: 8.5 → 9.5 → 10/10 across two audit rounds. 6 issues found, 6 resolved, 0 critical.

---

## §10 — Re-batching for later phases

P3 + P4 FRs are roadmap rows in `BACKLOG.md §5–§6` today. Re-batch triggers (from `P2_AUDIT_SUMMARY.md §6`):

- P1+P2 MRR > 60M ₫/mo.
- MAU > 30K.
- Inbound B2B leads > 5/month confirming Price Intelligence demand.
- Any plan §H Risk Matrix row triggers (Shopee blocks extension, Affiliate API changes, ToS update).

Re-batch process: write a slice brief for the module → manually author 4–6 FRs per slice → audit two rounds per §5 → push to `BACKLOG.md`.

---

## §11 — Drift catchers (CI gates)

Mechanical enforcement that the workflow is followed:

| Check | Rule | Surface |
|---|---|---|
| FR-ID density | no skips within a module (001, 002, 003, ...) | `pnpm fr:check` |
| Frontmatter required fields | all of §6 present | `pnpm fr:check` |
| Audit file exists | every `FR-*.md` has matching `*.audit.md` | `pnpm fr:check` |
| 10/10 before accepted | `status: accepted` requires `score_post_revision_2: 10/10` in audit | `pnpm fr:check` |
| BCP-14 keywords | each §1 clause has at least one MUST/SHOULD/MAY | `pnpm fr:check` |
| Manifest sync | `last_fr_id_per_module.<MOD>` matches highest FR-ID in folder | `pnpm fr:check` |

(`pnpm fr:check` script lands as part of P0 OBS setup — `apps/api/scripts/fr-check.ts`.)

---

*End of workflow. Keep this file open while authoring.*
