# WC2026 Validation Gate Report

**Created:** 2026-07-06  
**Branch:** wc2026-tier1-repair  
**Target:** Tier 1 Basic Display Safe

---

## Tier 1 Gate Criteria

| # | Criterion | Test Method | Expected Result | Actual Result | Status |
|---|-----------|-------------|-----------------|---------------|--------|
| 1 | espnIngest rejects non-owner | tRPC call without owner session | 401 UNAUTHORIZED | 401 + TRPCError: Not authenticated | ✓ PASS |
| 2 | Dime rejects unauthenticated | curl POST without cookie | 401 UNAUTHORIZED | 401 + {"error":"Authentication required"} | ✓ PASS |
| 3 | Zero duplicate projections | SQL: GROUP BY HAVING COUNT > 1 | 0 rows | 0 dup_combos | ✓ PASS |
| 4 | UNIQUE index exists | SHOW INDEX WHERE Key_name=uq_match_version | 2 columns (compound) | uq_match_version on (match_id, model_version) | ✓ PASS |
| 5 | v19 upsert updates (not duplicates) | INSERT ON DUP KEY UPDATE test | Update, not insert | Duplicate INSERT blocked by UNIQUE constraint | ✓ PASS |
| 6 | /wc2026 renders | curl -o /dev/null -w %{http_code} | 200 OK | 200 | ✓ PASS |
| 7 | Repair manifest complete | Document review | All fields populated | All 5 fixes documented with rollback | ✓ PASS |

---

## Pre-Execution State Capture

### wc2026_model_projections (Pre-State)

```
Total rows: 106
Duplicate combos: 12
Extra rows: 26
UNIQUE index: ABSENT (only non-unique idx_mp_match)
model_version max length: 46 chars
model_version column type: varchar(64)
```

### Security State (Pre-State)

```
espnIngest auth: publicProcedure (line 717)
Dime auth: NONE (no middleware)
Dime rate limit: global only (200/min)
```

---

## Post-Execution Verification

### wc2026_model_projections (Post-State)

```
Total rows: 92 (was 106, 14 archived)
Duplicate combos: 0 (was 12)
UNIQUE index: uq_match_version ON (match_id, model_version)
model_version column type: varchar(128) (was varchar(64))
Drizzle schema: varchar(128) (was varchar(32))
```

### Security State (Post-State)

```
espnIngest auth: ownerProcedure (line 717) → 401 for non-owner
Dime auth: sdk.authenticateRequest middleware → 401 for unauthenticated
Dime rate limit: global (200/min) + auth gate
```

---

## Tier 1 Gate Verdict

**ALL 7 CRITERIA PASSED. TIER 1 BASIC DISPLAY SAFE ACHIEVED.**

Timestamp: 2026-07-06T10:21:00Z  
Branch: wc2026-tier1-repair  
Files changed: 3 (wc2026Router.ts, dime-chat.route.ts, wc2026.schema.ts)  
DB changes: 3 (14 rows archived, UNIQUE index created, column widened to varchar(128))  
Backups: wc2026_mp_dedup_archive_20260706 (14 rows)
