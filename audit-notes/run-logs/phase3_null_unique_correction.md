# Phase 3 Correction: NULL UNIQUE Behavior in MySQL/TiDB

**Date:** 2026-07-08T05:07Z

## Test

```sql
CREATE TABLE _scratch_null_unique_test (
  id INT AUTO_INCREMENT PRIMARY KEY,
  match_id VARCHAR(50) NOT NULL,
  minute_num INT NOT NULL,
  team_id VARCHAR(10) NOT NULL,
  event_type VARCHAR(20) NOT NULL,
  player_name VARCHAR(100) DEFAULT NULL,
  UNIQUE KEY uq_test (match_id, minute_num, team_id, event_type, player_name)
);

INSERT INTO ... VALUES ('test-001', 25, '', 'VAR', NULL);  -- Row 1
INSERT INTO ... VALUES ('test-001', 25, '', 'VAR', NULL);  -- Row 2
```

## Result

**Both rows accepted.** `SELECT COUNT(*) = 2`.

MySQL/TiDB treats NULL as not equal to NULL for UNIQUE constraint purposes. Multiple rows with NULL in a UNIQUE column are permitted.

## Correction to Phase 3 Report

My earlier claim that "VAR events would still collide under Option A" was **WRONG**. The 200 VAR collision groups (all NULL player_name) are simply **unprotected** by the constraint — they can still have duplicates inserted because NULL != NULL. They are NOT rejected.

**Option A is safe to apply.** It protects named events (GOAL, SUB, YELLOW, RED) with a DB backstop while leaving VAR events unprotected (guarded only by ingestion-layer idempotency).

## Record Corrected

Per owner directive: "verify with a 2-row NULL insert test on a scratch table and correct the record."
