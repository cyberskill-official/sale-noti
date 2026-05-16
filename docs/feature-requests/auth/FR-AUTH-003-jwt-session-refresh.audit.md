---
fr_id: FR-AUTH-003
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

FR-AUTH-003 ships ship-grade after two rounds. JWT session + refresh-token rotation with reuse-detection is the entire auth foundation — every API call's identity flows through this. The two failure modes that matter most: (a) a leaked refresh token granting permanent access if rotation/reuse-detection is wrong, (b) cross-origin extension auth weakening to wildcard CORS letting any extension impersonate. Both are addressed via the unique-index reuse-detection path and pinned-EXT_ID CORS.

Round-1 (6 issues): atomic transaction for find/update/insert, concurrent rotation race, AUTH_SECRET rotation N-1 acceptance, clock-skew tolerance, multi-device session list, raw-token-in-Sentry redaction.
Round-2 (5 issues): rate-limit per-IP for refresh storms, TTL retention vs audit forensics, CORS preflight cache, per-family revocation visibility, idempotent sign-out.

All 11 issues resolved with citable §1 normative clauses + §6 implementation evidence + §10 failure-mode rows.

## §2 — Round-1 findings (all resolved)

### ISS-001 — Find/update/insert not atomic (TOCTOU race)
- **severity:** error · **rule_id:** correctness
- **status:** RESOLVED — §1 #3 + #4 `session.withTransaction()` with retry-once on abort; §6 `rotateRefresh` wraps all three ops in single txn; AC17 verifies concurrent rotation race.

### ISS-002 — Concurrent rotations from web + extension hit reuse-detection false-positive
- **severity:** warning · **rule_id:** ux-correctness
- **status:** RESOLVED — §10 row 11 documents accepted behavior; transaction serializes (one wins); rare in practice; mitigated by short access TTL (web refreshes mostly at 15-min boundary).

### ISS-003 — AUTH_SECRET rotation invalidates all tokens (storm risk)
- **severity:** warning · **rule_id:** ops-reliability
- **status:** RESOLVED — §1 #15 N-1 acceptance via `AUTH_SECRET_N_MINUS_1` env; §6 `verifyAccessToken` loop; AC13 verifies 1h window then rejection.

### ISS-004 — Strict clock comparison rejects valid edge clients
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #14 + §6 `clockTolerance: 60` in jwt.verify; AC11+AC12 verify ±60s boundary.

### ISS-005 — Multi-device session visibility missing
- **severity:** info · **rule_id:** spec-completeness
- **status:** RESOLVED — §1 #9 + #10 `GET /api/auth/sessions` + `DELETE /api/auth/sessions/:familyId`; AC14+AC15+AC16 verify list, revoke, owner-check.

### ISS-006 — Raw token / email leak into Sentry context
- **severity:** error · **rule_id:** pii-correctness
- **status:** RESOLVED — §1 #12 + §6 Sentry capture redacts to `userId: hashed`, `family`, `ip_hash_prefix`; AC20 verifies no `@` in capture, no raw token.

## §3 — Round-2 findings (all resolved)

### ISS-007 — Per-IP refresh rate-limit missing (storm protection)
- **severity:** warning · **rule_id:** abuse-prevention
- **status:** RESOLVED — §1 #7 dual-tier 30/min/user + 100/min/ip.

### ISS-008 — TTL purges audit rows mid-investigation
- **severity:** info · **rule_id:** ops-correctness
- **status:** RESOLVED — §1 #16 TTL `expireAfterSeconds: 30 * 86400` + 30-day buffer past natural expiry; §10 row 17 documents accepted trade-off.

### ISS-009 — CORS preflight not cached (5-15ms per request overhead)
- **severity:** info · **rule_id:** performance
- **status:** RESOLVED — §3 OPTIONS response `Access-Control-Max-Age: 600` (10 min cache).

### ISS-010 — Per-family revocation reason invisible to user
- **severity:** info · **rule_id:** ux-correctness
- **status:** RESOLVED — §1 #2 `revokeReason` field; visible in `GET /api/auth/sessions` UX as "Revoked: suspicious activity" / "Revoked: user signout".

### ISS-011 — Sign-out endpoint not idempotent
- **severity:** info · **rule_id:** correctness
- **status:** RESOLVED — §1 #8 "MUST return 200 even if the cookies were missing (idempotent)"; covers double-click sign-out + retry-on-flaky-network.

## §4 — Strengths preserved

- **Atomic transaction for find/update/insert** eliminates TOCTOU race where reuse-detection could be defeated by precise timing.
- **Reuse-detection on the second use** (not the first) is the OAuth 2.1 §6.2 / RFC 6819 §5.2.2 best practice; either the attacker or the user triggers detection, and the family is revoked either way.
- **Path-scoped refresh cookie** (`Path=/api/auth/refresh`) limits XSS exposure — even compromised JavaScript on `/dashboard` can't access the refresh cookie.
- **Pinned `chrome-extension://<EXT_ID>` CORS** prevents malicious extensions from impersonating our extension; wildcard `*` would be a CSRF nightmare across all installed extensions.
- **AUTH_SECRET N-1 acceptance** enables graceful secret rotation without forcing simultaneous user-base refresh (which would spike DB load).
- **Clock-skew ±60s tolerance** prevents legitimate edge clients (mobile, extension) from being rejected at exp boundaries.
- **Multi-device session visibility + DELETE endpoint** provides both security (revoke unknown sessions) AND trust signal (users see what we see).
- **Hash-only DB storage** of refresh tokens means DB compromise yields no live credentials.
- **§10 has 17 failure-mode rows** including the subtle "concurrent rotations from web + extension", "EXT_ID rotation at Chrome Web Store", and "sentry-capture-leaks-raw-token" recovery paths.

## §5 — Resolution

**Score = 10/10.** Ship. This FR underwrites every authenticated API call in the system — FR-BILL-001 plan checks, FR-WATCH-001 user identity, FR-NOTIF-001 alert dispatch attribution. A correct, audited rotation+reuse-detection model is the minimum viable security posture for a B2C product handling payment data.

---

*End of FR-AUTH-003 audit (round 2 final). Last revised: 2026-05-16.*
