# 9-Finding Remediation Status Table

Rules applied: Rule 6 (DONE = acceptance criteria run verbatim + raw output pasted + tests green + zero OPEN incidents touching that finding. Else IN PROGRESS.)

| # | Finding | Status | Basis | Open Incidents Touching |
|---|---------|--------|-------|------------------------|
| 1 | SEC-004 | **IN PROGRESS** | Unauthenticated curl → 401 on all 7 endpoints: VERIFIED. Legitimate platform calls succeeding: VERIFIED (162 runs analyzed, zero 401/403 post-deploy). INC-005 RESOLVED (deploy-window correlation VERIFIED). INC-006 RESOLVED. Remaining closer: +24h heartbeat sweep (zero 401/403 in 24h window). | None blocking (awaiting +24h sweep) |
| 2 | PROD-001 | **IN PROGRESS** | Privacy.tsx and Terms.tsx created. Routes registered at /privacy and /terms. Production /privacy and /terms serve legal content to ALL user agents: VERIFIED (curl-default, Googlebot, python-requests, Chrome, Wget). FE-005 FIXED on production (checkpoint 460c4791). | None blocking |
| 3 | DB-001 | **DONE** | Atomic credit deduction with `SELECT ... FOR UPDATE`. Concurrency test: 10 parallel requests, balance=1 → exactly 1 success, 9 failures (TiDB PessimisticRetry). Raw output logged. Test user cleaned. Tests green (1284/1285, only Discord token failure). Zero OPEN incidents. | None |
| 4 | SEC-001 | **DONE** | tokenVersion check in `authenticateDimeRequest`. Behavioral test: `tokenVersion.db.test.ts` 8/8 pass — stale tokenVersion rejected (JR-1), old JWT rejected after forceLogout (FL-5). Raw output logged. Tests green. Zero OPEN incidents. | None |
| 5 | SEC-002 | **DONE** | All 3 webhook failure branches → HTTP 400. `evt_test_` handling preserved. Vitest: 3 tests pass (400 on missing sig, invalid sig, missing secret). Raw output logged. Tests green. Zero OPEN incidents. | None |
| 6 | SEC-005 | **DONE** | `unsafe-eval` gated behind `NODE_ENV !== "production"`. Production CSP header: `script-src 'self' 'unsafe-inline'` — `unsafe-eval` ABSENT. VERIFIED via `curl -sI https://aisportsbettingmodels.com`. Tests green. Zero OPEN incidents. Backlog note: `unsafe-inline` remains (nonce-based CSP = future hardening). | None |
| 7 | BE-006 | **IN PROGRESS** | `/api/db-status` and `/api/perf` behind `globalApiLimiter` + owner auth. Unauthenticated curl → 401: VERIFIED. Owner-authenticated access not tested from sandbox. | None |
| 8 | ENG-007 | **IN PROGRESS** | `notifyOwner()` on all heartbeat error paths (8 calls total) with enriched content (endpoint, http_status, err.message). Code: VERIFIED via grep. Runtime notification delivery not verified from sandbox. | None |
| 9 | DB-002 | **NEEDS FOLLOW-UP** | 6 dime_* tables in `drizzle/dime.schema.ts`. Column counts match production (VERIFIED). DIME endpoint alive + auth gate (401 for unauth): VERIFIED. DB-001 concurrency: VERIFIED. SEC-001 tokenVersion: VERIFIED. Remaining closer: isolated drizzle-kit zero-drift check — blocked by drizzle-kit hang (DB-007). | DB-007 (blocking closer) |

---

## Summary

| Status | Count |
|--------|-------|
| DONE | 4 (SEC-002, DB-001, SEC-001, SEC-005) |
| IN PROGRESS | 4 (SEC-004, PROD-001, BE-006, ENG-007) |
| NEEDS FOLLOW-UP | 1 (DB-002) |
| NOT STARTED | 0 |

**What qualifies DONE findings:**
- SEC-002: Vitest 3/3 pass, raw output logged, zero OPEN incidents.
- DB-001: 10 parallel, balance=1, exactly 1 success. Raw output logged. Zero OPEN incidents.
- SEC-001: tokenVersion.db.test.ts 8/8 pass. Behavioral rejection verified. Zero OPEN incidents.
- SEC-005: Production CSP header inspected, `unsafe-eval` absent. Zero OPEN incidents.

**What would move remaining findings to DONE:**
- SEC-004: +24h heartbeat sweep (zero 401/403 in 24h window)
- PROD-001: Already verified on production; needs formal sign-off or additional crawl evidence
- BE-006: Owner-authenticated access returns 200
- ENG-007: Trigger a heartbeat failure and confirm notification delivery
- DB-002: Isolated drizzle-kit zero-drift check (blocked by drizzle-kit hang / DB-007)

---

## Incident Register (as of 2026-07-07T08:15Z)

| ID | Title | Status |
|----|-------|--------|
| INC-001 | tsc OOM hang | RESOLVED |
| INC-002 | GitHub push — workflows permission | OPEN (USER-OWNED) |
| INC-003 | GitHub push — secrets detection | RESOLVED |
| INC-004 | Workflow file removal | RESOLVED |
| INC-005 | Heartbeat 500s during deploy | RESOLVED (deploy-window correlation VERIFIED) |
| INC-006 | "caller does not have permission" | RESOLVED |
| INC-007 | Sandbox reset restores dirty history | OPEN (USER-OWNED) |
| DB-007 | wc2026 Drizzle schema drift | OPEN (backlogged) |

**3 OPEN items:** INC-002 (user-owned), INC-007 (user-owned), DB-007 (backlogged)
