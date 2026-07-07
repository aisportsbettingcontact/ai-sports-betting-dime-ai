# Remediation Execution Summary — aisportsbettingmodels.com

**Date:** 2026-07-07  
**Scope:** Audit Report V2 + Fable 5 Verdict (Section 7 authoritative)  
**Operator:** Manus AI  
**Target:** Production deployment for paying users

---

## Per-Finding Status Table

| # | Finding ID | Severity | Title | Status | Evidence | Notes |
|---|-----------|----------|-------|--------|----------|-------|
| 1 | SEC-004 | P0 | Heartbeat endpoints unauthenticated | ✅ PASS | 7/7 endpoints return 401 unauthenticated | Cron-still-fires half requires post-publish dashboard verification |
| 2 | PROD-001 | P0 | Missing Privacy Policy & Terms of Service | ✅ PASS | /privacy and /terms return 200; content includes 1-800-GAMBLER, AI disclaimers, compliance vocab | SPA-rendered; crawlable by JS-capable engines |
| 3 | DB-001 | P1 | Non-atomic credit deduction (race condition) | ✅ PASS | SELECT...FOR UPDATE in transaction; -1 return on insufficient balance | Production concurrency test deferred to soak v5 |
| 4 | SEC-001 | P1 | Missing tokenVersion check in Dime auth | ✅ PASS | tokenVersion check added mirroring appUsers.ts ~229 | Invalidated sessions now rejected |
| 5 | SEC-002 | P1 | Stripe webhook returns 200 on failure | ✅ PASS | curl → HTTP 400 on missing signature | evt_test_ handling preserved |
| 6 | SEC-005 | P1 | unsafe-eval in production CSP | ✅ PASS | Conditional on NODE_ENV !== "production" | Dev HMR unaffected |
| 7 | BE-006 | P2 | /api/db-status and /api/perf exposed | ✅ PASS | Both return 401 unauthenticated; owner-only + rate limited | — |
| 8 | ENG-007 | P2 | No owner notification on heartbeat failures | ✅ PASS | notifyOwner() added to all 8 error paths across 4 files | — |
| 9 | DB-002 | P2 | 6 dime_* tables missing from Drizzle schema | ✅ PASS | dime.schema.ts created; drizzle-kit recognizes all 6 tables | Migration blocked by unrelated wc2026 drift; tables already exist in prod |

---

## Test Results

| Metric | Value |
|--------|-------|
| Test files passed | 58/59 |
| Tests passed | 1284/1285 |
| Duration | 39.20s |
| Only failure | `discord.bot.token.test.ts` — pre-existing credential issue (Discord token revoked) |

---

## Incomplete Items (Stated Plainly)

1. **SEC-004 second half** — Cannot verify from sandbox that scheduled heartbeats still fire after adding auth gates. The Manus Heartbeat platform injects `X-Manus-Task-Uid` headers that trigger the `isCron` short-circuit in `sdk.authenticateRequest()`. This must be verified post-publish by checking the Manus Heartbeat dashboard for successful invocations.

2. **DB-001 concurrency test** — Cannot run 10 concurrent authenticated requests from sandbox (requires valid Dime auth tokens). The `SELECT ... FOR UPDATE` pattern is provably correct for MySQL/TiDB row-level locking. Full production concurrency validation deferred to soak test v5.

3. **DB-002 migration** — `drizzle-kit generate` produces migrations for both the 6 new dime tables AND unrelated wc2026 schema drift (espn_match_id columns, frozen_book_odds columns). Running `drizzle-kit migrate` would apply all changes. Since the dime tables already exist in production, the schema file is correct and zero drift exists for those 6 tables specifically. The wc2026 drift is pre-existing and out of scope.

---

## Files Modified

| File | Finding(s) | Change Type |
|------|-----------|-------------|
| `server/_core/types/manusTypes.ts` | §5c/SEC-004 | +taskUid field |
| `server/_core/sdk.ts` | §5c/SEC-004 | +CRON_OPEN_ID_PREFIX, AuthenticatedUser, buildCronUser, isCron short-circuit |
| `server/wc2026/wc2026Heartbeat.ts` | SEC-004, ENG-007 | +auth gates (4), +notifyOwner (4) |
| `server/wc2026/fifaLiveScraper.ts` | SEC-004, ENG-007 | +auth gate (1), +notifyOwner (2) |
| `server/fangraphsLineupHeartbeat.ts` | SEC-004, ENG-007 | +auth gate (1), +notifyOwner (1) |
| `server/rotowireLineupHeartbeat.ts` | SEC-004, ENG-007 | +auth gate (1), +notifyOwner (1) |
| `client/src/pages/Privacy.tsx` | PROD-001 | New file |
| `client/src/pages/Terms.tsx` | PROD-001 | New file |
| `client/src/App.tsx` | PROD-001 | +lazy imports, +routes |
| `server/dime-wc2026.route.ts` | DB-001, SEC-001 | Atomic deduction + tokenVersion check |
| `server/stripeWebhook.ts` | SEC-002 | 3 failure branches → HTTP 400 |
| `server/_core/index.ts` | SEC-005, BE-006 | Conditional unsafe-eval + auth on diagnostics |
| `drizzle/dime.schema.ts` | DB-002 | New file (6 tables) |
| `drizzle.config.ts` | DB-002 | +dime.schema.ts in schema array |

---
