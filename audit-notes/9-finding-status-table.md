# 9-Finding Remediation Status Table

Rules applied: Rule 6 (DONE = acceptance criteria run verbatim + raw output pasted + tests green + zero OPEN incidents touching that finding. Else IN PROGRESS.)

| # | Finding | Status | Basis | Open Incidents Touching |
|---|---------|--------|-------|------------------------|
| 1 | SEC-004 | **IN PROGRESS** | Unauthenticated curl → 401 on all 7 endpoints: VERIFIED (raw output in action log Entry 10). Legitimate platform calls succeeding: VERIFIED via `manus-heartbeat logs` showing HTTP 200 at 04:33 and 04:42 for roto-lineups, and 04:43/04:45/04:46 for wc2026-live-sync. However, INC-005 (unexplained 500s at 04:12/04:21) and INC-006 (user-reported "caller does not have permission" string of UNKNOWN origin) remain OPEN. | INC-005, INC-006 |
| 2 | PROD-001 | **IN PROGRESS** | Privacy.tsx and Terms.tsx created. Routes registered at /privacy and /terms. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/privacy` → 200: VERIFIED. `curl -s http://localhost:3000/privacy | grep -c "1-800-GAMBLER"` → 1: VERIFIED. Content includes AI disclaimers, responsible gambling, subscription terms. However: these are sandbox/dev-server results. Production evidence (crawlable on aisportsbettingmodels.com) not captured from sandbox. Cannot verify production crawlability from sandbox — requires browser check of deployed URL. | None blocking, but production verification not performed. |
| 3 | DB-001 | **IN PROGRESS** | Atomic credit deduction implemented with `SELECT ... FOR UPDATE` + conditional `UPDATE ... WHERE credits_balance >= cost` in transaction. Code: VERIFIED in action log. Acceptance criterion "10 concurrent requests at balance=1 → exactly 1 success" NOT executed — requires a load test script against production or a vitest simulating concurrency. Cannot verify from sandbox without writing and running that test. | None |
| 4 | SEC-001 | **IN PROGRESS** | tokenVersion check added to `authenticateDimeRequest`, mirroring appUsers.ts ~229 pattern. Code change: VERIFIED (grep shows the check). Acceptance criterion: "revoked token rejected" — NOT executed. Requires a test that creates a session, increments tokenVersion in DB, then retries with the old token. Not run. | None |
| 5 | SEC-002 | **IN PROGRESS** | All 3 webhook failure branches changed from `res.status(200)` to `res.status(400)`. `evt_test_` handling preserved. Code: VERIFIED (`grep -c "status(400)" server/stripeWebhook.ts` → 3). Acceptance criterion: "invalid webhook returns 400" — tested via `curl -X POST http://localhost:3000/api/stripe/webhook` → returned 200 (not 400). This is because the request hits Express body parsing before reaching our handler. The 400 paths are for signature verification failure and missing user, which require a properly-formed Stripe webhook payload with bad signature. Cannot fully verify acceptance criterion from sandbox without mocking Stripe's webhook format. | None |
| 6 | SEC-005 | **IN PROGRESS** | `unsafe-eval` gated behind `NODE_ENV !== "production"`. Code: VERIFIED (`grep "unsafe-eval" server/_core/index.ts` shows conditional). Acceptance criterion: "production CSP header does not contain unsafe-eval" — NOT verified. Cannot verify from sandbox — requires inspecting response headers on the deployed production URL. | None |
| 7 | BE-006 | **IN PROGRESS** | `/api/db-status` and `/api/perf` moved behind `globalApiLimiter` + owner auth check. Unauthenticated curl → 401: VERIFIED (raw output in action log). Acceptance criterion met for unauthenticated rejection. Owner-authenticated access NOT tested (would require a valid owner session cookie). | None |
| 8 | ENG-007 | **IN PROGRESS** | `notifyOwner()` added to error paths in all 4 heartbeat files (wc2026Heartbeat.ts, fifaLiveScraper.ts, fangraphsLineupHeartbeat.ts, rotowireLineupHeartbeat.ts). Code: VERIFIED (grep shows imports and calls). Acceptance criterion: "heartbeat error triggers owner notification" — NOT verified at runtime. Cannot verify from sandbox — requires triggering an actual heartbeat failure in production and confirming notification receipt. | None |
| 9 | DB-002 | **IN PROGRESS** | `drizzle/dime.schema.ts` created with all 6 dime_* tables. File exists: VERIFIED. Acceptance criterion: "`db:push` shows zero drift" — NOT fully verified. `drizzle-kit generate` was run but produced migrations for unrelated wc2026 schema drift (espn_match_id columns), making it impossible to isolate dime-table drift. The dime tables were defined by querying production `SHOW CREATE TABLE` and transcribing to Drizzle. Exact match: INFERRED (basis: column types, names, and constraints were copied verbatim from production DDL). What would confirm: running `drizzle-kit generate` on a clean state with ONLY dime.schema.ts and seeing zero output. | None |

---

## Summary

| Status | Count |
|--------|-------|
| DONE | 0 |
| IN PROGRESS | 9 |
| NOT STARTED | 0 |

**Rationale:** Under Rule 6, no finding qualifies as DONE because:
- SEC-004 has two OPEN incidents (INC-005, INC-006)
- All other findings lack full acceptance-criteria execution with raw output, OR lack production evidence where the criterion requires runtime verification

**What would move findings to DONE:**
- SEC-004: Close INC-005 and INC-006 with evidence
- PROD-001: Browser check of production URL confirming pages render
- DB-001: Concurrency load test (10 parallel requests, balance=1, exactly 1 success)
- SEC-001: Token revocation test
- SEC-002: Stripe webhook mock with bad signature → 400
- SEC-005: Production response header inspection
- BE-006: Already meets criteria for unauthenticated path; owner-auth path is secondary
- ENG-007: Trigger a heartbeat failure and confirm notification
- DB-002: Isolated drizzle-kit generate showing zero dime-table drift
