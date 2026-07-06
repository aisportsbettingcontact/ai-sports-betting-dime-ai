# WC2026 Repair Manifest

**Created:** 2026-07-06  
**Branch:** wc2026-tier1-repair  
**Scope:** Tier 1 Basic Display Safe

---

## Fix A1: espnIngest → ownerProcedure

| Attribute | Value |
|-----------|-------|
| File | `server/wc2026/wc2026Router.ts` |
| Line | 717 |
| Pre-state | `publicProcedure.mutation` |
| Change | Replace `publicProcedure` with `ownerProcedure` |
| Post-state | `ownerProcedure.mutation` |
| Verification | Non-owner call returns 403 |
| Rollback | Revert `ownerProcedure` → `publicProcedure` |
| Status | COMPLETE ✓ |

---

## Fix A2: Dime Backend Auth

| Attribute | Value |
|-----------|-------|
| File | `server/dime-chat.route.ts` |
| Line | 80-91 (new auth block) |
| Pre-state | Zero auth middleware on POST /api/dime/chat |
| Change | Added `sdk.authenticateRequest(req)` before Claude call, returns 401 on failure |
| Post-state | Unauthenticated requests return 401, no Claude API call made |
| Verification | `curl -X POST /api/dime/chat` returns 401 |
| Rollback | Remove lines 80-91 and the `import { sdk }` on line 18 |
| Status | COMPLETE ✓ |

---

## Fix A3: Deduplicate Projections

| Attribute | Value |
|-----------|-------|
| Table | `wc2026_model_projections` |
| Pre-state | 13 duplicate (match_id, model_version) combos, 14 extra rows, 106 total |
| Change | Archived 14 extras to `wc2026_mp_dedup_archive`, kept highest id per combo |
| Post-state | 0 duplicates, 92 total rows |
| Verification | GROUP BY HAVING COUNT > 1 returns 0 rows ✓ |
| Rollback | `INSERT INTO wc2026_model_projections SELECT p.* FROM wc2026_model_projections_backup WHERE p.id IN (SELECT id FROM wc2026_mp_dedup_archive)` |
| Status | COMPLETE ✓ |

---

## Fix A4: Add UNIQUE Index

| Attribute | Value |
|-----------|-------|
| Table | `wc2026_model_projections` |
| Pre-state | idx_mp_match (NON_UNIQUE) on match_id only |
| Change | `CREATE UNIQUE INDEX uq_match_version ON wc2026_model_projections(match_id, model_version)` |
| Post-state | UNIQUE constraint enforced, duplicate INSERT correctly rejected |
| Verification | SHOW INDEX confirms uq_match_version; duplicate INSERT fails with exit status 1 ✓ |
| Rollback | `DROP INDEX uq_match_version ON wc2026_model_projections` |
| Status | COMPLETE ✓ |

---

## Fix A5: Align Drizzle varchar(128)

| Attribute | Value |
|-----------|-------|
| File | `drizzle/wc2026.schema.ts` line 254 |
| Pre-state | Drizzle: varchar(32), Live DB: varchar(64) — DRIFT |
| Change | Drizzle → varchar(128), Live DB → ALTER COLUMN varchar(128), uniqueIndex updated to compound (matchId, modelVersion) |
| Post-state | Drizzle and DB both varchar(128), UNIQUE index on (match_id, model_version) in both |
| Verification | INFORMATION_SCHEMA shows `model_version|varchar(128)|NO` ✓ |
| Rollback | `ALTER TABLE wc2026_model_projections MODIFY COLUMN model_version VARCHAR(64) NOT NULL DEFAULT 'v1.0'` |
| Status | COMPLETE ✓ |

---

## Backups Created

| Backup | Table/File | Created At | Row Count |
|--------|-----------|------------|-----------|
| — | — | — | — |

---

## SQL Executed

| # | SQL Statement | Result | Rows Affected |
|---|---------------|--------|---------------|
| — | — | — | — |

---

## Final Tier 1 Gate Status

| Gate | Status |
|------|--------|
| Non-owner espnIngest → 403 | PENDING |
| Unauthenticated Dime → 401 | PENDING |
| Duplicate query → 0 rows | PENDING |
| UNIQUE index exists | PENDING |
| v19 upsert functional | PENDING |
| /wc2026 renders | PENDING |
