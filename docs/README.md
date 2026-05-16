# SaleNoti — Documentation Index

**Project:** SaleNoti — Vietnamese price-tracking + sale-notification platform on Shopee (Phase 1) → multi-platform B2C + B2B Price Intelligence (Phase 3+) → Regional SEA + AI (Phase 4).

**Founder:** Stephen Cheng (Trịnh Thái Anh) · CyberSkill JSC
**Source plan:** [`SaleNoti — Plan.pdf`](SaleNoti%20—%20Plan.pdf) (34 pages, Vietnamese, May 2026)
**Authoring workflow:** [`FR_AUTHORING_WORKFLOW.md`](FR_AUTHORING_WORKFLOW.md) (project-local)
**Memory protocol:** [`../AGENTS.md`](../AGENTS.md) (proxy to the shared protocol)

---

## §1 — Where things live

```
sale-noti/
├── AGENTS.md                 — memory protocol proxy
├── CLAUDE.md                 — @AGENTS.md
└── docs/
    ├── README.md             — this file
    ├── FR_AUTHORING_WORKFLOW.md   — project-local authoring + audit playbook
    ├── SaleNoti — Plan.pdf   — 34-page founder plan (input)
    └── feature-requests/     — the engineering surface
        ├── BACKLOG.md        — phase-by-phase index, 42 FRs
        ├── MANIFEST.json     — state file
        ├── SESSION_PROGRESS.md
        ├── P0_AUDIT_SUMMARY.md   — Pre-MVP Foundation (8 FRs)
        ├── P1_AUDIT_SUMMARY.md   — MVP Core + Extension (12 FRs)
        ├── P2_AUDIT_SUMMARY.md   — Growth & Monetization (6 FRs)
        ├── auth/                  AUTH-001..003
        ├── legal/                 LEGAL-001..002
        ├── obs/                   OBS-001
        ├── worker/                WORKER-001..002
        ├── aff/                   AFF-001..004
        ├── watch/                 WATCH-001..003
        ├── price/                 PRICE-001..002
        ├── notif/                 NOTIF-001..003
        ├── ext/                   EXT-001
        ├── bill/                  BILL-001
        ├── grow/                  GROW-001..003
        └── admin/                 ADMIN-001
```

---

## §2 — Quick orientation by role

**Founder · roadmap & priorities**
→ [`feature-requests/BACKLOG.md`](feature-requests/BACKLOG.md) §1 totals · §7 cross-cutting watch-items.

**Senior Tech Lead · build sequence**
→ [`feature-requests/P0_AUDIT_SUMMARY.md`](feature-requests/P0_AUDIT_SUMMARY.md) §4 dependency unlock · [`P1_AUDIT_SUMMARY.md`](feature-requests/P1_AUDIT_SUMMARY.md) §4.

**Intern Developer · "what do I build this week?"**
→ [`feature-requests/SESSION_PROGRESS.md`](feature-requests/SESSION_PROGRESS.md) §4 "Week 1–2 (P0 build)" through "Week 2–8 (P1 build)" · then pick an `accepted` FR from the assigned module and follow its §3/§6 code shape.

**Legal counsel · compliance scope**
→ [`feature-requests/legal/FR-LEGAL-001-pdpl-dpia-dpo.md`](feature-requests/legal/FR-LEGAL-001-pdpl-dpia-dpo.md) (PDPL DPIA + DPO + A05) · [`legal/FR-LEGAL-002-affiliate-disclosure-surfaces.md`](feature-requests/legal/FR-LEGAL-002-affiliate-disclosure-surfaces.md) (5 ethical principles + transparency report).

**Marketing/Growth lead · viral mechanics**
→ [`feature-requests/grow/`](feature-requests/grow/) · plan §F1 personas + §F2 channels in source PDF.

**Investor/advisor · scope at a glance**
→ [`feature-requests/BACKLOG.md`](feature-requests/BACKLOG.md) §1 phase table + [`SESSION_PROGRESS.md`](feature-requests/SESSION_PROGRESS.md) §2 totals · 42 FRs, 5 phases, ~22 person-weeks calendar.

---

## §3 — How an FR becomes code

```
plan PDF
   ↓
BACKLOG.md (phase / module / slice index)
   ↓
FR markdown (BCP-14 normative spec)
   ↓
Audit markdown (engineering-spec@1 template, 2 rounds → 10/10)
   ↓
Task (TaskCreate, one per FR)
   ↓
PR (one FR per PR)
   ↓
shipped: <date> in FR frontmatter
```

All 26 P0/P1/P2 FRs are currently `status: accepted` ready to build. P3+P4 are roadmap rows in BACKLOG.md §5–§6.

---

## §4 — Build order (locked)

**P0 — week 0–2 (Pre-MVP Foundation)**

1. FR-LEGAL-001 (DPIA filing starts ~14 d before A05 ack)
2. FR-AUTH-001 → FR-AUTH-002 → FR-AUTH-003 (single chain, ~16 h)
3. FR-OBS-001 (4 h, parallel to AUTH)
4. FR-WORKER-001 → FR-WORKER-002 (chain, ~11 h)
5. FR-LEGAL-002 (4 h, parallel to OBS, depends on AUTH-002 for email integration)

**P1 — week 2–8 (MVP Core + Extension)**

6. FR-AFF-001 (8 h, parallel to PRICE-001)
7. FR-PRICE-001 (6 h)
8. FR-AFF-003 → FR-AFF-002 → FR-AFF-004 (~13 h)
9. FR-PRICE-002 (4 h)
10. FR-WATCH-001 → FR-WATCH-002 → FR-WATCH-003 (~15 h)
11. FR-NOTIF-001 → FR-NOTIF-002 (~11 h)
12. FR-EXT-001 (12 h, parallel with NOTIF)

**P2 — week 8–18 (Growth & Monetization)**

13. FR-BILL-001 (12 h, needs Stripe + VNPay + MoMo merchant accounts ~4-week lead)
14. FR-NOTIF-003 (6 h)
15. FR-GROW-001 → FR-GROW-002 → FR-GROW-003 (~19 h)
16. FR-ADMIN-001 (3 h)

---

## §5 — Compliance & ethics moat

This project's wedge is NOT cost; it's TRUST. Three artefacts hold the line:

1. **PDPL filing live before any data collection** — FR-LEGAL-001 §1 #1. Mechanically blocks the marketing waitlist from capturing email until DPIA is filed.
2. **Disclosure paragraph in every affiliate-tagged surface** — FR-LEGAL-002 §1 #4. Snapshot tests in CI prevent drift.
3. **Five ethical principles enforced in code** — no commission-rate ranking (grep), no auto-apply coupons (ESLint rule), respect-other-publisher cookie, open-source revenue calculator, quarterly transparency report.

Plan §A3 closing line: *"Đây không phải là nice-to-have. Đây là moat."* Treat every PR that touches an affiliate surface against these three.

---

## §6 — Where to extend

When new features ship, they MUST be added to BACKLOG.md AND get a FR markdown before code lands. The full procedure (manual at MVP scale) lives in [`FR_AUTHORING_WORKFLOW.md`](FR_AUTHORING_WORKFLOW.md). The short loop:

1. Identify module + phase; pick the next dense FR-ID for that module.
2. Add a row to `feature-requests/BACKLOG.md` in the right phase + slice section.
3. Bump `feature-requests/MANIFEST.json` → `last_fr_id_per_module.<MOD>`.
4. Create `feature-requests/<module>/FR-<MOD>-<NNN>-<slug>.md` with the §6 frontmatter and the 11 body sections (workflow §4).
5. Two-round audit per workflow §5; reach 10/10 before flipping `status: accepted`.

For P3 + P4 re-batch, see `feature-requests/P2_AUDIT_SUMMARY.md §6` (trigger conditions).

---

*Last updated: 2026-05-16 (initial batch — 26 FRs, P0+P1+P2 ready to build).*
