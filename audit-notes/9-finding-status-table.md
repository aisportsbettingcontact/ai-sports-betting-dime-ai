# 9-Finding Remediation Status Table

Rules applied: Rule 6 (DONE = acceptance criteria run verbatim + raw output pasted + tests green + zero OPEN incidents touching that finding. Else IN PROGRESS.)

| # | Finding | Status | Basis | Open Incidents Touching |
|---|---------|--------|-------|------------------------|
| 1 | SEC-004 | **IN PROGRESS** | Unauthenticated curl → 401 on all 7 endpoints: VERIFIED. Legitimate platform calls succeeding: VERIFIED (162 runs analyzed, zero 401/403 post-deploy, 6 consecutive 200s). INC-006 RESOLVED (SEC-004 exonerated). However, INC-005 (deploy-window 500s) remains OPEN with INFERRED root cause. | INC-005 |
| 2 | PROD-001 | **IN PROGRESS** | Privacy.tsx and Terms.tsx created. Routes registered at /privacy and /terms. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/privacy` → 200: VERIFIED. Content includes compliance text, AI disclaimers, 1-800-GAMBLER: VERIFIED. Production crawlability not verified from sandbox. | None blocking |
| 3 | DB-001 | **IN PROGRESS** | Atomic credit deduction implemented with `SELECT ... FOR UPDATE` + conditional `UPDATE ... WHERE credits_balance >= cost` in transaction. Code: VERIFIED. Acceptance criterion "10 concurrent requests at balance=1 → exactly 1 success" NOT executed (requires load test). | None |
| 4 | SEC-001 | **IN PROGRESS** | tokenVersion check added to `authenticateDimeRequest`. Vitest: structural assertion passes (3 tests). Code change: VERIFIED. Full behavioral end-to-end test (revoked token rejected) not run. | None |
| 5 | SEC-002 | **DONE** | All 3 webhook failure branches → HTTP 400. `evt_test_` handling preserved. Vitest: 3 tests pass (400 on missing sig, invalid sig, missing secret). Raw output logged. Tests green. Zero OPEN incidents. | None |
| 6 | SEC-005 | **IN PROGRESS** | `unsafe-eval` gated behind `NODE_ENV !== "production"`. Code: VERIFIED. Production CSP header inspection not possible from sandbox. | None |
| 7 | BE-006 | **IN PROGRESS** | `/api/db-status` and `/api/perf` behind `globalApiLimiter` + owner auth. Unauthenticated curl → 401: VERIFIED. Owner-authenticated access not tested from sandbox. | None |
| 8 | ENG-007 | **IN PROGRESS** | `notifyOwner()` on all heartbeat error paths (8 calls total) with enriched content (endpoint, http_status, err.message). Code: VERIFIED via grep. Runtime notification delivery not verified from sandbox. | None |
| 9 | DB-002 | **IN PROGRESS** | 6 dime_* tables in `drizzle/dime.schema.ts`. Column counts match production (VERIFIED via information_schema query). `drizzle-kit generate` shows unrelated wc2026 drift (DB-007, separate finding). Dime tables specifically are clean. | DB-007 (tangential, not blocking) |

---

## Summary

| Status | Count |
|--------|-------|
| DONE | 1 (SEC-002) |
| IN PROGRESS | 8 |
| NOT STARTED | 0 |

**What qualifies SEC-002 as DONE:** Acceptance criteria run verbatim (vitest 3/3 pass), raw output logged in action log Entry 16, tests green, zero OPEN incidents touching SEC-002.

**What would move remaining findings to DONE:**
- SEC-004: Close INC-005 (owner verifies deploy logs show restart at 04:10–04:25 UTC)
- PROD-001: Browser check of production URL confirming pages render
- DB-001: Concurrency load test (10 parallel requests, balance=1, exactly 1 success)
- SEC-001: Token revocation behavioral test
- SEC-005: Production response header inspection (`Content-Security-Policy` lacks `unsafe-eval`)
- BE-006: Owner-authenticated access returns 200
- ENG-007: Trigger a heartbeat failure and confirm notification delivery
- DB-002: Isolated drizzle-kit generate showing zero dime-table drift (blocked by DB-007 noise)

---

## Incident Register (as of 2026-07-07T06:05Z)

| ID | Title | Status |
|----|-------|--------|
| INC-001 | tsc OOM hang | RESOLVED |
| INC-002 | GitHub push — workflows permission | OPEN |
| INC-003 | GitHub push — secrets detection | RESOLVED |
| INC-004 | Workflow file removal | RESOLVED |
| INC-005 | Heartbeat 500s during deploy | OPEN (INFERRED) |
| INC-006 | "caller does not have permission" | RESOLVED |
| INC-007 | Sandbox reset restores dirty history | OPEN |
| DB-007 | wc2026 Drizzle schema drift | OPEN |

**4 OPEN items:** INC-002, INC-005, INC-007, DB-007
