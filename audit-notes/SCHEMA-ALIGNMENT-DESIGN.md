# Schema-Alignment Session — Design Document

**Status:** READ-ONLY DESIGN — no writes, no DDL, no db:push  
**Date:** 2026-07-07  
**Author:** System  
**Gate:** Executes under owner explicit go, with live-DB backup as precondition one.

---

## DATA-002 CLOSE-OUT (3 items — RESOLVED)

### Item 1: Spread Edge Before/After

| Match | spread_edge (model-book) | Status |
|-------|--------------------------|--------|
| r16-089 | 0 (book=+1.5, model=+1.5) | UNCHANGED ✓ |
| r16-090 | -1 (book=+0.5, model=-0.5) | CHANGED from false-zero ✓ |
| r16-092 | 0 (book=+0.5, model=+0.5) | UNCHANGED ✓ |

Expected behavior confirmed: r16-089/092 edges unchanged (both book+model flipped together), r16-090 edge changed from 0 to -1 (real edge now visible).

### Item 2: r16-090 Model Convention — DEFINITIVE

The model_spread=-0.5 for r16-090 IS correct HOME convention:

- Model projects CAN 2.013 goals vs MAR 1.651 goals (CAN is model favorite)
- model_spread=-0.5 means "home (CAN) gives 0.5 goals" = CAN is spread favorite ✓
- model_H_odds=+113 means CAN -0.5 is slight underdog on spread (must win by 1+, model only projects +0.36 margin)
- Cross-validated against r16-089: model_spread=+1.5 (PAR gets 1.5), model_H_odds=-20509 (near-certain cover) — HOME convention confirmed

The sign convention is: **negative model_spread = home gives goals (home is spread favorite); positive = home gets goals (home is spread underdog)**. The fix correctly left r16-090 model unchanged.

### Item 3: Provenance/Schema Check

All 3 touched rows show odds_source='ESPN_INGEST' — known DB-014 stale label. DATA-002 fix only modified spread columns via raw SQL. DB-008 dual-def doesn't affect raw SQL UPDATEs. No re-stamp needed for DATA-002 scope.

---

## §1 — OBJECTIVE AND CONSTRAINTS

### System Objective

Reconcile the Drizzle schema definitions to match the live production database exactly, restore drizzle-kit operational capability (generate + migrate), and achieve zero drift between code and DB.

### Non-Functional Requirements

1. **Zero feed downtime** during the tournament — the live feed (matchesByDate, matchesByRound) must never return errors or empty results
2. **No data loss** — all existing rows, columns, and values must be preserved
3. **Full reversibility** — every change must be rollback-able within 5 minutes

### Failure Budget

If this goes wrong mid-World-Cup:

| System | Impact of Failure |
|--------|-------------------|
| Feed (matchesByDate/Round) | Users see no odds, no model projections — total product failure |
| DIME (wc2026Context) | AI analysis loses all odds context — degraded intelligence |
| Heartbeat (PublishProjections) | Cannot publish new model runs — stale projections |
| Engine writes (v22+) | Cannot write new R16/QF odds — pipeline blocked |

---

## §2 — CURRENT-STATE MODEL

### DB-007: Column Drift (wc2026_model_projections)

Live DB has **86 columns**. Drizzle defines **59 columns**. Zero columns in Drizzle are missing from live DB.

**27 columns in live DB NOT in Drizzle (truth direction: DB → adopt into schema):**

| Column | Type | Purpose |
|--------|------|---------|
| over_4_5 | double | Over 4.5 goals probability |
| home_clean_sheet | double | Home clean sheet probability |
| away_clean_sheet | double | Away clean sheet probability |
| ht_over_0_5 | double | Half-time over 0.5 probability |
| ht_over_1_5 | double | Half-time over 1.5 probability |
| ht_home_win | double | Half-time home win probability |
| ht_draw | double | Half-time draw probability |
| ht_away_win | double | Half-time away win probability |
| fav_fragility_score | double | Favorite fragility metric |
| draw_quality_score | double | Draw quality metric |
| underdog_viability | double | Underdog viability metric |
| xg_balance_ratio | double | xG balance ratio |
| book_odds | json | Raw book odds snapshot |
| home_goal_dist | json | Home goal distribution |
| away_goal_dist | json | Away goal distribution |
| home_win_by_1/2/3plus | double | Home win margin probabilities |
| away_win_by_1/2/3plus | double | Away win margin probabilities |
| full_output | json | Complete model output blob |
| calculation_method | varchar(64) | Engine calculation method |
| actual_simulations | int | Actual simulation count |
| xg_source | varchar(64) | xG data source |
| holdout_validated | tinyint(1) | Holdout validation flag |
| integrity_flags | json | Data integrity flags |

**Truth direction:** DB is authoritative — these columns were added by engine scripts via raw SQL ALTER TABLE. Schema must adopt them.

### DB-008: wc2026MatchOdds 3-Way Diff

| Metric | Live DB | schema.ts | wc2026.schema.ts |
|--------|---------|-----------|------------------|
| Column count | 53 | 46 | 50 |
| Has lambda/projected goals | ✓ | ✗ | ✓ |
| Has odds_source/market_status/odds_updated_at | ✓ | ✗ | ✗ |
| world_cup_round enum includes 'r16' | ✓ | ✗ | ✗ |
| matchId unique constraint | uq_wc2026_match_odds_match | idx_wc2026MatchOdds_matchId | uq_wc2026_match_odds_match |
| Has round/stage indexes | ✗ (live) | ✓ (defined) | ✗ |
| insertedAt nullability | DEFAULT CURRENT_TIMESTAMP ON UPDATE | .defaultNow() | .notNull().default(CURRENT_TIMESTAMP) |

**3 columns in live DB NOT in EITHER schema definition:**
- `odds_updated_at` (datetime)
- `odds_source` (varchar(64))
- `market_status` (varchar(32), NOT NULL DEFAULT 'UNKNOWN')

**4 columns in wc2026.schema.ts but NOT in schema.ts:**
- `lamba_away`, `lamba_home`, `model_projected_away_goals`, `model_projected_home_goals`

**Critical enum drift:** Live DB has `'r16'` in world_cup_round enum. BOTH schema files are missing it. This means Drizzle ORM queries filtering by round='r16' would fail type-checking.

**Canonical definition:** wc2026.schema.ts is closer to production (50 vs 46 columns). The canonical merged definition must be wc2026.schema.ts + 3 missing columns + enum fix.

**Router dual-import:** `wc2026Router.ts:32` imports from `../../drizzle/schema` (the 46-column version). This means the router's TypeScript types are INCOMPLETE — it cannot access lambda, projected goals, odds_source, or market_status via Drizzle ORM without raw SQL.

### DB-013: Orphan Tables (18 total)

**DROP candidates (10 backup/quarantine tables — no production readers, no active writers):**

| Table | Rows | Rationale |
|-------|------|-----------|
| wc2026_edges_bak_t3r | 54 | Tier 3 rollback backup |
| wc2026_mp_bak | 0 | Empty backup |
| wc2026_mp_dedup_archive | 14 | Dedup archive |
| wc2026_novig_bak_t3r | 63 | Tier 3 rollback backup |
| wc2026_odds_bak_t2 | 0 | Empty backup |
| wc2026_odds_bak_tier2 | 92 | Tier 2 rollback backup |
| wc2026_orphan_match_odds_quarantine | 12 | Quarantine (resolved) |
| wc2026_proj_bak_t3r | 92 | Tier 3 rollback backup |
| wc2026_proj_bak_tier2 | 92 | Tier 2 rollback backup |
| wc2026_rec_bak_t3r | 264 | Tier 3 rollback backup |

**ADOPT candidates (8 production tables — active writers/readers exist):**

| Table | Rows | Purpose |
|-------|------|---------|
| wc2026_data_lineage | 8 | Audit trail for data operations |
| wc2026_holdout_validation | 258 | Model holdout test results |
| wc2026_market_edges | 54 | Edge calculations per market/selection |
| wc2026_market_no_vig | 63 | No-vig probability calculations |
| wc2026_model_grades | 57 | Model quality metrics (Brier scores) |
| wc2026_model_runs | 20 | Engine run tracking |
| wc2026_provider_match_map | 92 | ESPN/BetExplorer ID mapping |
| wc2026_recommendations | 264 | Bet recommendations with status |

### DB-014: odds_source Mislabel

**Current state:** 80/84 rows have stale odds_source. Only 4 rows (v22 engine, r16-095/096) have correct value.

| odds_source (current) | insert_method | Correct odds_source | Count |
|------------------------|---------------|---------------------|-------|
| ESPN_INGEST | gs_metadata_backfill_v1 | google_sheets_seed | 60 |
| ESPN_INGEST | r32_metadata_backfill_v1/v2 | betexplorer | 15 |
| ESPN_INGEST | v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16* | betexplorer | 4 |
| betexplorer+draftkings_manual_advance | v22.0-*-R16-JUL7 | betexplorer+draftkings_manual_advance | 2 ✓ |
| betexplorer_bet365 | v21.1-RECAL-USA-FAV-1M-MC | betexplorer_bet365 | 1 ✓ |
| null | v20.0-*-R16-JUL6 | betexplorer | 1 |

**Engine sites that must write odds_source on UPDATE (currently don't):**
- `server/wc2026/v22_jul7_engine.mjs` (Phase 7 UPDATE block, ~line 674-708)
- `server/wc2026/betexplorer_scraper.py` (group-stage upsert, ~line 2805-2862)
- Any future engine that UPDATEs wc2026MatchOdds

**Zero code references to `odds_source` exist in any wc2026 engine file.** The column is only READ by DIME (wc2026Context.ts:75) and the router. It was only ever WRITTEN by the initial seed scripts (now deleted).

---

## §3 — DRIZZLE-KIT HANG ROOT CAUSE

### Diagnosis

The "hang" is **NOT a hang** — it is an **interactive prompt** waiting for user input:

```
Is wc2026MatchOdds table created or renamed from another table?
❯ + wc2026MatchOdds                          create table
```

**Root cause:** Drizzle-kit detects TWO definitions of `wc2026MatchOdds` across the schema files loaded by `drizzle.config.ts` (schema.ts:2993 AND wc2026.schema.ts:533). When it encounters this ambiguity during migration generation, it prompts the user to disambiguate. In non-interactive environments (CI, background processes, piped stdin), this prompt blocks indefinitely — appearing as a hang.

**Evidence:**
1. Process state was `T (stopped)` — SIGTSTP from trying to read terminal in background
2. With stdin closed (`< /dev/null`), the prompt renders but never advances
3. The prompt text explicitly names `wc2026MatchOdds` — the dual-defined table
4. 108 existing journal entries (path: `drizzle/meta/_journal.json`, idx 0–107) processed fine; the hang occurs only at the new diff stage where it encounters the duplicate table name

**Journal citation:**
- Path: `drizzle/meta/_journal.json`
- Total entries: 108 (idx 0 through 107) ✓
- Last 3: idx=105 `0105_puzzling_quicksilver` (v5), idx=106 `0106_espn_table_renames` (v7), idx=107 `0107_majestic_kinsey_walden` (v5)
- The version=7 anomaly at idx=106 corresponds to the ESPN table rename migration (applied externally, logged as no-op SQL)

### Fix

**Primary fix (resolves hang):** Remove the duplicate definition from `schema.ts:2993-3046` and keep only `wc2026.schema.ts:533-623` (the more complete version). Update the router import to source from `wc2026.schema.ts`. This eliminates the ambiguity that triggers the prompt.

**Secondary fix (if primary insufficient):** Add `--force` flag or configure `breakpoints: false` in drizzle.config.ts to suppress interactive prompts.

### Manual Zero-Drift Verification Path (substitute if drizzle-kit remains broken)

If drizzle-kit cannot be restored:
1. Generate expected DDL from Drizzle schema using `drizzle-kit introspect` (reverse direction)
2. Compare SHOW CREATE TABLE output against Drizzle definitions column-by-column
3. Validate with a script that asserts: for every column in schema, live DB has it; for every column in live DB, schema has it
4. Run this script as a CI gate on every schema change

---

## §4 — FAILURE-MODE ANALYSIS

### Slice 1: DB-008 Fix (Remove duplicate definition)

| Aspect | Assessment |
|--------|------------|
| Half-apply risk | MEDIUM — file edit + import rewrite across 2 files |
| Blast radius | Router + espnDbIngester TypeScript compilation. If import path wrong, server won't start |
| Idempotent | YES — removing a duplicate is idempotent |
| Reversible | YES — git revert |
| DIME-read risk | NONE — DIME uses raw SQL, not Drizzle ORM |
| Feed risk | MEDIUM — router uses Drizzle ORM. If import breaks, feed returns 500 |
| Rollback point | Git commit before edit |

**HARDENED CASCADE CHECK (Slice-1 precondition):**

69 files import from `drizzle/schema`. Of those, exactly **2 files** reference `wc2026MatchOdds` or its types:

| File | Imports from schema.ts | wc2026MatchOdds usage |
|------|------------------------|----------------------|
| `server/wc2026/wc2026Router.ts:32` | `wc2026MatchOdds`, `wc2026EspnMatches`, `type Wc2026MatchOddsRow` | ORM queries + type annotations (lines 157, 504, 770, 778, 805, 811, 824) |
| `server/wc2026/espnDbIngester.ts:38-47` | `wc2026EspnMatches`, `wc2026EspnTeamStats`, `wc2026EspnMatchStats`, `wc2026EspnExpectedGoals`, `wc2026EspnShotMap`, `wc2026EspnPlayerStats`, `wc2026EspnLineups`, `wc2026EspnGlossary` | ESPN tables only — does NOT import `wc2026MatchOdds` |

**Cascade proof:**
- `grep -rn "Wc2026MatchOddsRow\|InsertWc2026MatchOdds\|SelectWc2026MatchOdds" server/ client/ shared/` (excluding schema files) → **only wc2026Router.ts** (5 hits, all on lines 32/778/805/811/824)
- `grep -rn "wc2026MatchOdds" server/ client/ shared/ | grep import` (excluding schema files) → **only wc2026Router.ts:32**
- No other production file imports `wc2026MatchOdds` or its type aliases from `drizzle/schema`
- The 67 other importers (mlb*, nba*, nhl*, discord*, stripe*, etc.) import non-WC2026 symbols only

**Additional complication:** `wc2026EspnMatches` is defined ONLY in `drizzle/schema.ts` (not in `wc2026.schema.ts`). The router imports it alongside `wc2026MatchOdds`. Fix: either (a) move `wc2026EspnMatches` to `wc2026.schema.ts`, or (b) split the router import into two lines — one from each schema file. The espnDbIngester also imports 8 ESPN tables from `drizzle/schema.ts` — these must remain importable.

**Slice-1 import rewrite plan:**
```typescript
// wc2026Router.ts — BEFORE:
import { wc2026MatchOdds, wc2026EspnMatches, type Wc2026MatchOddsRow } from "../../drizzle/schema";

// wc2026Router.ts — AFTER:
import { wc2026MatchOdds, type Wc2026MatchOddsRow } from "../../drizzle/wc2026.schema";
import { wc2026EspnMatches } from "../../drizzle/schema";
```

**Verification gate:** `npx tsc --noEmit` must pass across the entire repo (not just the router).

### Slice 2: DB-007 Fix (Add 27 missing columns to schema)

| Aspect | Assessment |
|--------|------------|
| Half-apply risk | LOW — schema file edit only, no DB change (columns already exist in DB) |
| Blast radius | NONE on live readers — adding columns to schema doesn't affect existing queries |
| Idempotent | YES — adding already-existing columns is a no-op for the DB |
| Reversible | YES — git revert |
| DIME-read risk | NONE |
| Feed risk | NONE |
| Rollback point | Git commit |

### Slice 3: DB-013 Fix (DROP backup tables + ADOPT production orphans)

| Aspect | Assessment |
|--------|------------|
| Half-apply risk | MEDIUM — DROP is irreversible per table |
| Blast radius | LOW for drops (no readers). NONE for adopts (schema-only). |
| Idempotent | DROPs are idempotent (IF EXISTS). Adopts are file edits. |
| Reversible | DROPs: NO (data gone). Must backup first. Adopts: YES (git revert). |
| DIME-read risk | NONE — DIME doesn't read any orphan table |
| Feed risk | NONE |
| Rollback point | mysqldump of each table before DROP |

### Slice 4: DB-014 Fix (UPDATE odds_source on 80 rows)

| Aspect | Assessment |
|--------|------------|
| Half-apply risk | LOW — single UPDATE statement |
| Blast radius | DIME reads odds_source — changing it changes DIME context. But from stale→correct, so improvement. |
| Idempotent | YES — UPDATE WHERE odds_source='ESPN_INGEST' is idempotent |
| Reversible | YES — UPDATE back to 'ESPN_INGEST' |
| DIME-read risk | POSITIVE — DIME gets correct provenance |
| Feed risk | NONE — feed doesn't display odds_source |
| Rollback point | Before/after log |

### Slice 5: Enum fix (add 'r16' to world_cup_round)

| Aspect | Assessment |
|--------|------------|
| Half-apply risk | LOW — enum addition is non-destructive |
| Blast radius | NONE — adding a value doesn't affect existing rows |
| Idempotent | YES — ALTER TABLE MODIFY with expanded enum |
| Reversible | YES — remove from schema (DB already has it) |
| DIME-read risk | NONE |
| Feed risk | NONE |
| Rollback point | Schema file revert |

---

## §5 — DEPENDENCY-ORDERED IMPLEMENTATION SLICES

### Execution Order and Rationale

```
Slice 1 (DB-008) → Slice 5 (enum) → Slice 2 (DB-007) → Slice 4 (DB-014) → Slice 3 (DB-013) → Verify drizzle-kit
```

**Rationale:**
- DB-008 FIRST: Cannot drift-check a dual-defined table. Must consolidate before any other schema work.
- Enum SECOND: Must fix before drizzle-kit can generate clean diffs (r16 rows would fail validation).
- DB-007 THIRD: Column additions depend on clean single-source schema.
- DB-014 FOURTH: Data fix independent of schema but benefits from clean provenance.
- DB-013 LAST: DROPs are irreversible — do after everything else is stable.
- Verify drizzle-kit: Final gate — if generate runs clean, session succeeds.

---

### Slice 1: DB-008 — Consolidate wc2026MatchOdds to Single Definition

**Preconditions:** Git clean state, dev server stopped

**Commands/Edits:**
1. Delete lines 2993-3046 from `drizzle/schema.ts` (the incomplete 46-column definition)
2. Add 3 missing columns to `drizzle/wc2026.schema.ts:533` definition:
   - `oddsUpdatedAt: datetime("odds_updated_at")`
   - `oddsSource: varchar("odds_source", { length: 64 })`
   - `marketStatus: varchar("market_status", { length: 32 }).notNull().default("UNKNOWN")`
3. Fix enum: add `"r16"` to worldCupRound enum in wc2026.schema.ts
4. Update `server/wc2026/wc2026Router.ts:32`:
   - Change: `import { wc2026MatchOdds, ... } from "../../drizzle/schema"`
   - To: `import { wc2026MatchOdds, ... } from "../../drizzle/wc2026.schema"`
5. Remove the type exports from schema.ts (Wc2026MatchOddsRow, InsertWc2026MatchOdds)

**Verification:**
1. `npx tsc --noEmit` — TypeScript compiles clean
2. `pnpm test` — existing tests pass
3. Dev server starts and feed returns data
4. `drizzle-kit generate` runs without interactive prompt

**Rollback:** `git checkout -- drizzle/schema.ts drizzle/wc2026.schema.ts server/wc2026/wc2026Router.ts`

**Unblocks:** All subsequent slices + drizzle-kit operational

---

### Slice 2: DB-007 — Add 27 Missing Columns to wc2026_model_projections Schema

**Preconditions:** Slice 1 complete (clean schema state)

**Commands/Edits:**
1. Add 27 column definitions to `wc2026ModelProjections` in `drizzle/wc2026.schema.ts`
2. No DB changes needed — columns already exist in live DB

**Verification:**
1. `npx tsc --noEmit`
2. `drizzle-kit generate` produces no migration for wc2026_model_projections (already in sync)

**Rollback:** Git revert

**Unblocks:** Clean drizzle-kit diffs, type-safe access to all model columns

---

### Slice 3A: DB-013 — ADOPT Production Orphans (reversible, same authorization as Slices 1/2/4/5)

**Preconditions:** Slices 1-2 complete

**Commands/Edits:**
1. Add Drizzle definitions for 8 production orphan tables in `drizzle/wc2026.schema.ts`
2. Definitions derived from SHOW CREATE TABLE output (already captured)

**Verification:**
1. `npx tsc --noEmit`
2. `drizzle-kit generate` produces no migration for these tables (already in sync)
3. Feed smoke test passes

**Rollback:** Git revert

**Unblocks:** Type-safe access to production orphans, cleaner drizzle-kit state

---

### Slice 3B: DB-013 — DROP Backup Tables (IRREVERSIBLE — SEPARATE OWNER AUTHORIZATION REQUIRED)

**⚠️ This slice requires its own explicit yes/no AFTER all other slices are verified stable.**

**Preconditions:**
1. Slices 1, 5, 2, 4, 3A all complete and verified stable
2. mysqldump of each table taken AND restore-rehearsed (prove the dump is valid)
3. Separate explicit owner authorization

**Phase A — Backup + Restore Rehearsal:**
```bash
mysqldump --single-transaction [tables] > wc2026_backup_tables_archive.sql
# Restore rehearsal: create temp DB, import dump, verify row counts match
```

**Phase B — DROP (10 backup tables):**
```sql
DROP TABLE IF EXISTS
  wc2026_edges_bak_t3r,
  wc2026_mp_bak,
  wc2026_mp_dedup_archive,
  wc2026_novig_bak_t3r,
  wc2026_odds_bak_t2,
  wc2026_odds_bak_tier2,
  wc2026_orphan_match_odds_quarantine,
  wc2026_proj_bak_t3r,
  wc2026_proj_bak_tier2,
  wc2026_rec_bak_t3r;
```

**Verification:**
1. `SHOW TABLES LIKE 'wc2026_%bak%'` → 0 results
2. `drizzle-kit generate` produces no orphan warnings
3. Feed + DIME smoke tests pass

**Rollback:** IRREVERSIBLE — only recovery is from mysqldump archive

**Unblocks:** Clean drizzle-kit state (no orphan warnings), DB-002 full closure

---

### Slice 4: DB-014 — Fix odds_source Mislabel (80 rows)

**Preconditions:** None (independent of schema work, but logically follows)

**Commands:**
```sql
-- Group stage rows (seeded from Google Sheets, book odds from BetExplorer via engines)
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'gs_metadata_backfill%';

-- R32 rows (seeded from R32 backfill, book odds from BetExplorer)
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'r32_metadata_backfill%';

-- R16 rows written by v19 engine (BetExplorer source)
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'v19%';

-- v20 row with null odds_source
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'null' AND insert_method LIKE 'v20%';

-- BetExplorer scraper row
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method = 'wc2026_betexplorer_scraper_v4.py';
```

**Engine code fix (prevent future staleness):**
- Add `odds_source = '...'` to every engine UPDATE statement
- v22: add `odds_source = 'betexplorer+draftkings_manual_advance'` to Phase 7 UPDATE
- betexplorer_scraper.py: add `odds_source = 'betexplorer'` to upsert

**Verification:**
1. `SELECT DISTINCT odds_source FROM wc2026MatchOdds` — no 'ESPN_INGEST' remaining
2. DIME context query returns correct provenance

**Rollback:** `UPDATE wc2026MatchOdds SET odds_source = 'ESPN_INGEST' WHERE odds_source = 'betexplorer' AND ...`

**Unblocks:** Reliable provenance for DIME, audit trail integrity

---

## §6 — PRODUCTION-READINESS CHECKLIST + COMPLEXITY CHALLENGE

### Go/No-Go Gate

**Authorization A (Slices 1, 5, 2, 4, 3A — all reversible):**

| Checkpoint | Required | Status |
|------------|----------|--------|
| Live-DB full backup (mysqldump) | MANDATORY | Not yet taken |
| Dev server stopped during DDL | MANDATORY | — |
| Git clean state with checkpoint | MANDATORY | — |
| Hardened Slice-1 cascade proof in hand | MANDATORY | COMPLETE (see §4 above) |
| Drift proof green (drizzle-kit generate = no output) | MANDATORY | — |
| Feed smoke test (matchesByDate returns data) | MANDATORY | — |
| DIME smoke test (wc2026Context returns odds) | RECOMMENDED | — |
| Rollback rehearsed (restore from backup) | RECOMMENDED | — |
| r16-096 ESPN scrape complete | RECOMMENDED (avoid mid-session interruption) | — |

**Authorization B (Slice 3B — DROP, irreversible — SEPARATE explicit yes/no):**

| Checkpoint | Required | Status |
|------------|----------|--------|
| All other slices verified stable | MANDATORY | — |
| mysqldump of 10 tables taken | MANDATORY | — |
| Restore rehearsal proven (import into temp DB, row counts match) | MANDATORY | — |
| Separate explicit owner authorization | MANDATORY | — |

### Complexity Challenge: Orphan Table Disposition

**DROP (10 tables) — recommended:**

| Table | Verdict | Rationale |
|-------|---------|-----------|
| wc2026_edges_bak_t3r | DROP | Tier 3 backup, superseded by current data |
| wc2026_mp_bak | DROP | Empty, no purpose |
| wc2026_mp_dedup_archive | DROP | 14 rows, dedup resolved |
| wc2026_novig_bak_t3r | DROP | Tier 3 backup of no-vig data |
| wc2026_odds_bak_t2 | DROP | Empty, no purpose |
| wc2026_odds_bak_tier2 | DROP | Tier 2 backup, superseded |
| wc2026_orphan_match_odds_quarantine | DROP | 12 quarantined rows, issue resolved |
| wc2026_proj_bak_t3r | DROP | Tier 3 backup of projections |
| wc2026_proj_bak_tier2 | DROP | Tier 2 backup of projections |
| wc2026_rec_bak_t3r | DROP | Tier 3 backup of recommendations |

All backup tables are forensic snapshots from prior remediation rounds. They have zero active readers or writers. Their data is either empty or duplicated in the current production tables. Archiving to local mysqldump before DROP preserves forensic access without polluting the schema.

**ADOPT (8 tables) — recommended:**

All 8 production orphans have active writers (engine scripts) and/or active readers (router, DIME). They must be formalized in the schema to enable type-safe access and drizzle-kit drift detection.

---

## OUTPUT SUMMARY

### Result

A 5-slice dependency-ordered implementation plan for the schema-alignment session, grounded in live-DB inspection, with failure modes analyzed per slice and a production-readiness gate defined.

### Systems Touched

None — this is a read-only design document. All inspections were SELECT/SHOW queries.

### Verification Performed

- SHOW CREATE TABLE for 3 key tables (wc2026MatchOdds, wc2026_model_projections, wc2026_matches)
- INFORMATION_SCHEMA column comparison for drift detection
- 3-way diff (live DB vs schema.ts vs wc2026.schema.ts)
- Drizzle-kit generate execution to diagnose hang
- Reader map grep across all production server code
- Orphan table row counts and classification

### Remaining Risks

1. **drizzle-kit may have additional prompts** beyond the wc2026MatchOdds one (e.g., for orphan tables). Must test after Slice 1 fix.
2. **TiDB enum modification** may behave differently from MySQL — test ALTER TABLE MODIFY COLUMN with expanded enum on a non-critical table first.
3. **Router import change** (Slice 1 step 4) may have cascading type errors if other files import types from schema.ts. Must grep for all import sites.
4. **Backup table DROP** is irreversible — if any future forensic need arises, the mysqldump archive is the only recovery path.

### Go/No-Go Required From Owner

This plan executes under explicit owner authorization with:
- Live-DB backup as precondition one
- r16-096 ESPN scrape completed first (avoid mid-session interruption)
- Dev server stopped during execution
- Each slice verified independently before proceeding to next
