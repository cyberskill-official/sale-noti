---
fr_id: FR-GROW-003
audited: 2026-05-16
auditor: manual (engineering-spec template v1)
verdict: PASS
score_pre_revision: 7.0/10
score_post_revision_1: 8.5/10
score_post_revision_2: 10/10
issues_open: 0
issues_resolved: 11
issues_critical: 0
template: engineering-spec@1
revised_at: 2026-05-16
final_revision: 2026-05-16 (round 2)
---

## §1 — Verdict summary

FR-GROW-003 ships ship-grade after two rounds. The "land on `/megasale/<slug>` not Shopee" funnel + auto-post-explicit-admin-approval architecture preserves growth-loop integrity while preventing inadvertent broadcast. The scope-trim of leaderboard/gamification (deferred Q5 to P3) is the right MVP call — engagement models without baseline data overfit.

Round-1: 6 issues (no event cap → banner fatigue, teaser disregards quiet hours, no cache strategy, auto-post bypasses our funnel, no past-event preservation, no countdown clock-skew handling). Round-2: 5 (status-flip race, concurrent admin edits, search dependency cliff, image hot-link 403, leaderboard scope creep).

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Event cap missing (banner fatigue risk)
- **severity:** warning · **rule_id:** ux-balance
- **status:** RESOLVED — §1 #10 caps 24/year + warns at 18; AC10 covers; §10 row 4.

### ISS-002 — Teaser push disregards quiet hours
- **severity:** error · **rule_id:** notification-discipline
- **status:** RESOLVED — §1 #11 + §6 `respectQuietHours: true`; AC8 verifies 23:30→07:00 defer.

### ISS-003 — No cache strategy (50K concurrent visits at day-of)
- **severity:** error · **rule_id:** scale-correctness
- **status:** RESOLVED — §1 #12 5-min Redis cache + admin manual invalidate; AC6 verifies < 50ms cache hit.

### ISS-004 — Auto-post linked directly to Shopee (bypasses our funnel)
- **severity:** error · **rule_id:** growth-architecture
- **status:** RESOLVED — §1 #8 links to `/megasale/<slug>`; AC7 verifies not-Shopee + disclosure present.

### ISS-005 — Past events 404 silently (SEO loss)
- **severity:** warning · **rule_id:** seo + ux
- **status:** RESOLVED — §1 #15 + AC12; past events remain accessible with "ended" banner + disabled stale CTAs.

### ISS-006 — Client clock skew misrenders countdown
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #13 server-time-anchored; AC15 ±2s tolerance.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Status not flipped if scheduler tick missed
- **severity:** warning · **rule_id:** scheduler-reliability
- **status:** RESOLVED — §10 row 3 hourly catch-up job promotes stale `live` events to `ended`.

### ISS-008 — Concurrent admin edits race
- **severity:** info · **rule_id:** consistency
- **status:** RESOLVED — §10 row 13 optimistic locking via `version` field.

### ISS-009 — Search service down at day-of (single point of failure)
- **severity:** error · **rule_id:** dependency-isolation
- **status:** RESOLVED — §10 row 1 serve last-cached list with `stale_warning`; admin alerted.

### ISS-010 — Product image hot-link blocked by Shopee
- **severity:** warning · **rule_id:** content-availability
- **status:** RESOLVED — §10 row 12 proxy via our CDN with 24h cache.

### ISS-011 — Leaderboard scope ambiguous in title vs body
- **severity:** info · **rule_id:** scope-clarity
- **status:** RESOLVED — §9 Q5 explicit deferral to P3 with reasoning (engagement model needs baseline data).

## §4 — Strengths preserved

- **24-event yearly cap** + warning at 18 is the right banner-fatigue gate; admin must consciously approve overage.
- **Auto-post links to our page, not Shopee** mirrors GROW-002 funnel philosophy — every channel converges on tracked attribution + watchlist conversion.
- **5-min cache + manual-invalidate** is the right trade-off for time-sensitive but not real-time mega-sale data; balances fresh-enough with day-of-spike survival.
- **Past-event preservation for SEO** turns one-time events into evergreen long-tail traffic.
- **§10 has 14 failure-mode rows** including the subtle "duplicate slug collision" + "Telegram bot blocked" recovery paths.
- **Scope discipline:** explicitly defers leaderboard/gamification to P3 rather than half-shipping at P2.

## §5 — Resolution

**Score = 10/10.** Ship. P2 growth lever, third highest leverage after GROW-001/002. Drives Vietnamese seasonal-traffic spikes per plan §F4 mega-sale-spike model.

---

*End of FR-GROW-003 audit (round 2 final). Last revised: 2026-05-16.*
