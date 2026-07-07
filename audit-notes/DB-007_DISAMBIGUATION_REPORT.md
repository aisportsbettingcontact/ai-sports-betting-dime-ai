# DB-007 Disambiguation Report

**Date:** 2026-07-07T22:10Z  
**Purpose:** Resolve finding-substitution: DB-007 has meant three different things across sessions. Each is disambiguated below with its own sub-ID and independently verified status.

---

## DB-007a: espn_match_id column drift on ESPN tables (ORIGINAL finding)

**Original description:** `drizzle-kit generate` proposed ADD `espn_match_id` columns to multiple wc2026 tables, indicating schema files did not reflect production DDL.

**Tables in scope:** 7 per-match ESPN tables + 2 tables that always had it.

**Verification method:** `SHOW COLUMNS FROM <table> WHERE Field = 'espn_match_id'` on live DB.

**Evidence (live output from db007_verify.mjs, 2026-07-07T22:05:43Z):**

```
✅ wc2026_espn_matches: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
✅ wc2026_espn_team_stats: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
✅ wc2026_espn_match_stats: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
✅ wc2026_espn_expected_goals: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
✅ wc2026_espn_shot_map: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=MUL
✅ wc2026_espn_player_stats: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=MUL
✅ wc2026_espn_lineups: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=MUL

Tables that ALWAYS had espn_match_id in schema:
✅ wc2026_matches: espn_match_id EXISTS — Type=varchar(16)
✅ wc2026MatchOdds: espn_match_id EXISTS — Type=varchar(64)
```

**Note on wc2026_espn_glossary:** This is a reference/lookup table (stat abbreviation definitions), NOT a per-match data table. It correctly has NO `espn_match_id` in either schema or DB. It was erroneously included in the original DB-007 scope.

**Schema verification:** All 7 per-match ESPN tables have `espn_match_id` defined in `drizzle/schema.ts` (lines 2564-2971). The reconciliation confirms 0 deltas for all 7 tables.

**When reconciled:** These tables were already present in `drizzle/schema.ts` at checkpoint 852371f2 (the base checkpoint). They were part of the original ESPN ingester schema work. The snapshot rebuild (this session) brought the snapshot into alignment with the already-correct schema files.

**Status: RESOLVED** — espn_match_id exists in BOTH schema AND live DB for all 7 applicable tables. Schema ≡ DB proven via SHOW COLUMNS.

---

## DB-007b: 27 columns on wc2026_model_projections (design §2 additions)

**Original description:** 27 columns were added to `wc2026_model_projections` as part of the design §2 expansion (simulation outputs, edge calculations, etc.). These were added to the live DB via engine scripts but needed to be reflected in the Drizzle schema.

**Verification method:** Column count comparison + full column-name reconciliation.

**Evidence (live output from db007_verify.mjs, 2026-07-07T22:05:43Z):**

```
═══ PHASE 3: wc2026_model_projections — column count verification ═══

  Live DB column count: 86
  Schema column count: 86
  ✅ MATCH — 86 columns in both schema and DB
```

**Reconciliation table row:**
```
| wc2026_model_projections | ✅ MATCH | 86 | 86 | 0 | 0 |
```

**When reconciled:** The 27 columns were added to `drizzle/wc2026.schema.ts` in a prior session (checkpoint 852371f2 already contains them). The snapshot rebuild confirmed alignment.

**Status: RESOLVED** — 86/86 columns match between schema and live DB. 0 deltas.

---

## DB-007c: 3 columns on wc2026MatchOdds (odds_updated_at, odds_source, market_status)

**Original description:** 3 columns (`odds_updated_at`, `odds_source`, `market_status`) existed in the live DB (added as part of Slice 5 / Auth A) but were missing from the Drizzle schema definition.

**Fix applied:** Added to `drizzle/wc2026.schema.ts` lines 648-651 in this session (checkpoint 6f691a38).

**Verification method:** Column count + full reconciliation.

**Evidence — schema column count (exact):**

```bash
$ awk '/^export const wc2026MatchOdds = mysqlTable/,/^\);/' drizzle/wc2026.schema.ts | grep -cE '^\s+\w+:.*\('
53
```

**Full column enumeration (all 53, numbered):**

```
 1  id                          bigint("id", ...)
 2  matchId                     varchar("match_id", { length: 16 })
 3  espnMatchId                 varchar("espn_match_id", { length: 64 })
 4  espnSlug                    varchar("espn_slug", { length: 64 })
 5  betExplorerMatchId          varchar("bet_explorer_match_id", { length: 16 })
 6  betExplorerSlug             varchar("bet_explorer_slug", { length: 128 })
 7  worldCupStage               mysqlEnum("world_cup_stage", [...])
 8  worldCupRound               mysqlEnum("world_cup_round", [...])
 9  insertedAt                  timestamp("inserted_at")
10  insertMethod                varchar("insert_method", { length: 255 })
11  lastInsertedAt              timestamp("last_inserted_at")
12  lastInsertMethod            varchar("last_insert_method", { length: 255 })
13  awayTeam                    int("away_team")
14  homeTeam                    int("home_team")
15  lambdaAway                  double("lamba_away")
16  lambdaHome                  double("lamba_home")
17  modelProjectedAwayGoals     double("model_projected_away_goals")
18  modelProjectedHomeGoals     double("model_projected_home_goals")
19  bookAwayToAdvance           smallint("book_away_to_advance")
20  modelAwayToAdvance          smallint("model_away_to_advance")
21  bookHomeToAdvance           smallint("book_home_to_advance")
22  modelHomeToAdvance          smallint("model_home_to_advance")
23  bookAwayMl                  smallint("book_away_ml")
24  modelAwayMl                 smallint("model_away_ml")
25  bookAwayWd                  smallint("book_away_wd")
26  modelAwayWd                 smallint("model_away_wd")
27  bookDraw                    smallint("book_draw")
28  modelDraw                   smallint("model_draw")
29  bookNoDraw                  smallint("book_no_draw")
30  modelNoDraw                 smallint("model_no_draw")
31  bookHomeMl                  smallint("book_home_ml")
32  modelHomeMl                 smallint("model_home_ml")
33  bookHomeWd                  smallint("book_home_wd")
34  modelHomeWd                 smallint("model_home_wd")
35  bookPrimarySpread           double("book_primary_spread")
36  modelPrimarySpread          double("model_primary_spread")
37  bookAwayPrimarySpreadOdds   smallint("book_away_primary_spread_odds")
38  modelAwayPrimarySpreadOdds  smallint("model_away_primary_spread_odds")
39  bookHomePrimarySpreadOdds   smallint("book_home_primary_spread_odds")
40  modelHomePrimarySpreadOdds  smallint("model_home_primary_spread_odds")
41  bookTotal                   double("book_total")
42  modelTotal                  double("model_total")
43  bookOverOdds                smallint("book_over_odds")
44  modelOverOdds               smallint("model_over_odds")
45  bookUnderOdds               smallint("book_under_odds")
46  modelUnderOdds              smallint("model_under_odds")
47  bookBttsYes                 smallint("book_btts_yes")
48  modelBttsYes                smallint("model_btts_yes")
49  bookBttsNo                  smallint("book_btts_no")
50  modelBttsNo                 smallint("model_btts_no")
51  oddsUpdatedAt               datetime("odds_updated_at")         ← ADDED THIS SESSION
52  oddsSource                  varchar("odds_source", { length: 64 })  ← ADDED THIS SESSION
53  marketStatus                varchar("market_status", { length: 32 }) ← ADDED THIS SESSION
```

**Reconciliation table row:**
```
| wc2026MatchOdds | ✅ MATCH | 53 | 53 | 0 | 0 |
```

**Column count discrepancy resolution:** The prior claim of "50 columns" was the count BEFORE the 3-column fix. After the fix, the schema has 53 columns. The live DB has 53 columns. `drizzle-kit generate` reports "wc2026MatchOdds 53 columns 2 indexes 0 fks". All three agree.

**Status: RESOLVED** — 53/53 columns match between schema and live DB. 0 deltas.

---

## Reconciliation Script (db007_verify.mjs)

**Location:** `/home/ubuntu/ai-sports-betting/db007_verify.mjs`

**Method:**
1. Reads `drizzle/wc2026.schema.ts` and `drizzle/schema.ts`
2. For each target table, finds the `export const <name> = mysqlTable(` block
3. Extracts DB column names via regex on type constructors: `varchar("col_name"`, `int("col_name")`, etc.
4. Connects to live DB via `DATABASE_URL`
5. Runs `SHOW COLUMNS FROM <table>` for each table
6. Compares column name sets bidirectionally
7. Reports deltas

**Limitation (recorded for future reference):** This script compares column NAME SETS only — not full signatures (type, nullability, default, charset). It is the correct test for DB-007's missing-column scope and 0-deltas closes that scope. However, a type-level drift (e.g., varchar length mismatch, enum value list divergence like the DB-008 'r16' issue) would NOT be caught by this script. A future type+nullability comparison would strengthen the standing gate but is not required for DB-007 closure.

**Full raw output (2026-07-07T22:05:43Z):**

```
═══════════════════════════════════════════════════════════════════════
DB-007 THREE-WAY EQUIVALENCE PROOF — FULL EVIDENCE
═══════════════════════════════════════════════════════════════════════
Timestamp: 2026-07-07T22:05:43.376Z

═══ PHASE 2: ORIGINAL DB-007 — espn_match_id in live DB ═══

  ✅ wc2026_espn_matches: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
  ✅ wc2026_espn_team_stats: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
  ✅ wc2026_espn_match_stats: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
  ✅ wc2026_espn_expected_goals: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=UNI
  ✅ wc2026_espn_shot_map: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=MUL
  ✅ wc2026_espn_player_stats: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=MUL
  ✅ wc2026_espn_lineups: espn_match_id EXISTS — Type=varchar(32), Null=NO, Key=MUL
  ❌ wc2026_espn_glossary: espn_match_id MISSING FROM LIVE DB

  Tables that ALWAYS had espn_match_id in schema:
  ✅ wc2026_matches: espn_match_id EXISTS — Type=varchar(16)
  ✅ wc2026MatchOdds: espn_match_id EXISTS — Type=varchar(64)

═══ PHASE 3: wc2026_model_projections — column count verification ═══

  Live DB column count: 86
  Schema column count: 86
  ✅ MATCH — 86 columns in both schema and DB

═══ PHASE 4: FULL RECONCILIATION — Schema vs Live DB (all target tables) ═══

| Table | Status | Schema Cols | DB Cols | Only in Schema | Only in DB |
|-------|--------|-------------|---------|----------------|------------|
| wc2026_model_projections | ✅ MATCH | 86 | 86 | 0 | 0 |
| wc2026MatchOdds | ✅ MATCH | 53 | 53 | 0 | 0 |
| wc2026_espn_matches | ✅ MATCH | 41 | 41 | 0 | 0 |
| wc2026_espn_team_stats | ✅ MATCH | 23 | 23 | 0 | 0 |
| wc2026_espn_match_stats | ✅ MATCH | 89 | 89 | 0 | 0 |
| wc2026_espn_expected_goals | ✅ MATCH | 18 | 18 | 0 | 0 |
| wc2026_espn_shot_map | ✅ MATCH | 30 | 30 | 0 | 0 |
| wc2026_espn_player_stats | ✅ MATCH | 43 | 43 | 0 | 0 |
| wc2026_espn_lineups | ✅ MATCH | 17 | 17 | 0 | 0 |
| wc2026_espn_glossary | ✅ MATCH | 8 | 8 | 0 | 0 |
| wc2026_data_lineage | ✅ MATCH | 11 | 11 | 0 | 0 |
| wc2026_holdout_validation | ✅ MATCH | 11 | 11 | 0 | 0 |
| wc2026_market_edges | ✅ MATCH | 13 | 13 | 0 | 0 |
| wc2026_market_no_vig | ✅ MATCH | 9 | 9 | 0 | 0 |
| wc2026_model_grades | ✅ MATCH | 11 | 11 | 0 | 0 |
| wc2026_model_runs | ✅ MATCH | 13 | 13 | 0 | 0 |
| wc2026_provider_match_map | ✅ MATCH | 8 | 8 | 0 | 0 |
| wc2026_recommendations | ✅ MATCH | 21 | 21 | 0 | 0 |

**Total tables with deltas: 0**
**Overall: ✅ ALL TABLES MATCH — Schema ≡ DB PROVEN**
```

---

## Three-Way Status (explicit)

| Equivalence | Evidence | Result |
|-------------|----------|--------|
| Schema ≡ Snapshot | `drizzle-kit generate` → "No schema changes, nothing to migrate" (71 tables, exit 0) | ✅ PROVEN |
| Schema ≡ DB | `db007_verify.mjs` → 0 deltas across 18 tables (column-name comparison via SHOW COLUMNS) | ✅ PROVEN |
| Snapshot ≡ DB | Follows from (Schema ≡ Snapshot) ∧ (Schema ≡ DB) | ✅ PROVEN |

---

## Summary

| Finding ID | Scope | Status | Proof |
|-----------|-------|--------|-------|
| DB-007a | espn_match_id on 7 ESPN tables | RESOLVED | SHOW COLUMNS confirms presence in live DB; schema has them; 0 deltas |
| DB-007b | 27 cols on wc2026_model_projections | RESOLVED | 86/86 columns match schema↔DB |
| DB-007c | 3 cols on wc2026MatchOdds | RESOLVED | 53/53 columns match schema↔DB (fix applied this session) |

**DB-007 (composite): ALL THREE SUB-FINDINGS RESOLVED.**
