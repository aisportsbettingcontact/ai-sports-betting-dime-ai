# V1 Finding Disposition — Evidence Collected

## Production DB Queries (2026-07-07T08:45Z)

### FINDING-001 (Duplicate projections)
- Query: `SELECT COUNT(*) FROM (SELECT match_id, model_version, COUNT(*) as c FROM wc2026_model_projections GROUP BY match_id, model_version HAVING c > 1) t`
- Result: **0 duplicate combos** (was 12 combos / 26 extras in v1)
- Status: REMEDIATED (duplicates removed + UNIQUE constraint added)

### FINDING-002 (Missing UNIQUE index on match_id + model_version)
- Query: `SELECT INDEX_NAME, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME='wc2026_model_projections' AND INDEX_NAME='uq_match_version'`
- Result: **uq_match_version EXISTS, NON_UNIQUE=0 (i.e., IS UNIQUE), columns: match_id + model_version**
- Status: REMEDIATED (compound UNIQUE index now exists)

### FINDING-003 (38.7% null proj_spread)
- Query: `SELECT COUNT(*) FROM wc2026_model_projections WHERE proj_spread IS NULL`
- Result: **33 null out of 94 total (35.1%)**
- Status: OPEN — still present, slight improvement (was 41/106)

### FINDING-004 (72 MatchOdds match_id format mismatch wc26-gs-)
- Query: `SELECT COUNT(*) FROM wc2026MatchOdds WHERE match_id LIKE 'wc26-gs-%'`
- Result: **0 rows with wc26-gs- format** (total: 82 rows, all wc26-g-NNN format)
- Status: REMEDIATED (match_ids remapped)

### FINDING-005 (Public espnIngest mutation)
- Code check: `server/wc2026/wc2026Router.ts:717: espnIngest: ownerProcedure`
- Status: REMEDIATED (changed from publicProcedure to ownerProcedure)

### FINDING-006 (No Dime WC2026 context injection)
- Status: UNKNOWN — requires code inspection of dime-chat.route.ts context section

### FINDING-007 (Low odds population 21/92)
- Current: 82 total rows in wc2026MatchOdds (was 92)
- Status: UNKNOWN — needs book_home_ml population check

### FINDING-008 (Dime chat auth gap)
- Code check: `server/dime-chat.route.ts:79: await sdk.authenticateRequest(req)`
- Status: REMEDIATED (backend auth gate added)

### FINDING-009 (Legacy null probabilities)
- Status: UNKNOWN — needs specific query on v3-champion-2026 rows

### FINDING-010 (Lineage tracking gaps)
- Status: UNKNOWN — needs wc2026_data_lineage check

### FINDING-011 (UNIQUE on match_id by design → upgraded to HIGH)
- Now: uq_match_version is UNIQUE on (match_id, model_version) — correct compound key
- Status: REMEDIATED (redesigned from single-column to compound)

### FINDING-012 (Schema-to-DB drift — uq_mp_match missing)
- Now: uq_match_version exists in live DB as UNIQUE(match_id, model_version)
- Status: PARTIALLY REMEDIATED — original uq_mp_match drift fixed, but DB-007 documents remaining drift

### FINDING-013 (FK declared in code but missing in DB)
- Query: `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_NAME='wc2026_model_projections' AND CONSTRAINT_TYPE='FOREIGN KEY'`
- Result: **0 FK constraints**
- Status: OPEN — FK still missing in live DB

### FINDING-014 (v18/v19 zero edge, zero nv_prob)
- Status: UNKNOWN — needs edge/nv_prob query on latest versions

### FINDING-015 (Backtest xG data leakage)
- Status: UNKNOWN — needs code inspection of v19/v20 engine

### FINDING-016 (No CLV tracking infrastructure)
- Status: UNKNOWN — needs table/column check

### FINDING-017 (wc2026_match_odds missing match_id index)
- Query: `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME='wc2026MatchOdds' AND COLUMN_NAME='match_id'`
- Result: **uq_wc2026_match_odds_match EXISTS**
- Status: REMEDIATED (index now exists)

### FINDING-018 (130 MJS scripts committed to git)
- Status: OPEN — scripts still present (confirmed by file count earlier)

### FINDING-019 (Cloud computer has no version control)
- Status: UNKNOWN — needs cloud computer check

### FINDING-020 (model_version varchar(32) mismatch)
- Query: `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='wc2026_model_projections' AND COLUMN_NAME='model_version'`
- Result: **varchar(128)** (was varchar(32) in v1 audit)
- Status: REMEDIATED (column widened to varchar(128))
