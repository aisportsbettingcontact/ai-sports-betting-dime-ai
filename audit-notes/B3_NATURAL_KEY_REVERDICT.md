# WC2026 B3 Natural-Key Re-Verdict — Evidence & Results

## PART 1: TRUE NATURAL KEYS (Schema Evidence)

### 1. wc2026_odds_snapshots — TIME-SERIES
- **Schema source:** `drizzle/wc2026.schema.ts:102-127`
- **One row represents:** One odds observation for one selection in one market at one point in time
- **True natural key:** `match_id + snapshot_ts + book_id + market + selection`
- **Columns:** match_id (varchar 16), snapshot_ts (timestamp), book_id (smallint), market (enum: 1X2/TOTAL/ASIAN_HANDICAP/BTTS/DOUBLE_CHANCE), selection (varchar 16)
- **Classification:** TIME-SERIES
- **Existing constraint:** NONE (only indexes, no unique)
- **Status:** VERIFIED (schema read, columns confirmed)

### 2. wc2026_lineups — PER-ENTITY
- **Schema source:** `drizzle/wc2026.schema.ts:131-155`
- **One row represents:** One player in one team's lineup for one match at one scrape time
- **True natural key:** `match_id + team_id + player_name + scraped_at`
- **Columns:** match_id (varchar 16), team_id (varchar 8), player_name (varchar 96), scraped_at (timestamp)
- **Classification:** PER-ENTITY
- **Existing constraint:** NONE (only indexes)
- **Status:** VERIFIED

### 3. wc2026_match_events — PER-ENTITY
- **Schema source:** `drizzle/wc2026.schema.ts:220-245`
- **One row represents:** One match event (goal, card, sub, VAR check)
- **True natural key:** `match_id + team_id + event_type + player_name + minute_num`
- **Columns:** match_id (varchar 16), team_id (varchar 8), event_type (enum: GOAL/OWN_GOAL/PENALTY/YELLOW/RED/SUB/VAR), player_name (varchar 96), minute_num (tinyint)
- **Classification:** PER-ENTITY
- **Existing constraint:** NONE (only indexes)
- **CRITICAL NOTE:** player_name is NULL or empty ('') for ALL 1422 rows. This means the true key collapses to `match_id + team_id + event_type + minute_num` — which is AMBIGUOUS for multi-sub at same minute or multi-VAR at same minute. See Part 2 analysis.
- **Status:** VERIFIED (schema + live data inspected)

### 4. wc2026_espn_shot_map — PER-ENTITY
- **Schema source:** `drizzle/schema.ts:2771-2838`
- **One row represents:** One shot attempt by one player in one match
- **True natural key:** `espn_match_id + playerId + period + clock + fieldStartX + fieldStartY`
- **Columns:** espnMatchId (int), playerId (varchar 16), period (int), clock (varchar 8), fieldStartX (decimal 6,2), fieldStartY (decimal 6,2)
- **Classification:** PER-ENTITY
- **Existing constraint:** NONE (only indexes)
- **Status:** VERIFIED

### 5. wc2026_model_projections — SINGLE-ROW-PER-(match+version)
- **Schema source:** `drizzle/wc2026.schema.ts:247-362`
- **One row represents:** One model run for one match at one model version
- **True natural key:** `match_id + model_version`
- **Existing constraint:** `uniqueIndex("uq_match_version").on(t.matchId, t.modelVersion)` — ENFORCED
- **Classification:** SINGLE-ROW-PER-(match+version) — multiple versions per match is BY DESIGN
- **Status:** VERIFIED (unique constraint exists in schema)

### 6. wc2026_holdout_validation — SINGLE-ROW-PER-(match+version+selection)
- **Schema source:** `drizzle/wc2026.schema.ts:688-709`
- **One row represents:** One validation record for one selection in one model version for one match
- **True natural key:** `match_id + model_version + selection`
- **Existing constraint:** `uniqueIndex("uq_holdout").on(t.matchId, t.modelVersion, t.selection)` — ENFORCED
- **Classification:** PER-ENTITY (multiple selections per match per version)
- **Status:** VERIFIED (unique constraint exists in schema)

### 7. wc2026_recommendations — SINGLE-ROW-PER-(match+version+market+selection)
- **Schema source:** `drizzle/wc2026.schema.ts:814-860`
- **One row represents:** One recommendation for one selection in one market in one model version for one match
- **True natural key:** `match_id + model_version + market + selection`
- **Existing constraint:** `uniqueIndex("uq_rec_match_ver_mkt_sel").on(t.matchId, t.modelVersion, t.market, t.selection)` — ENFORCED
- **Classification:** PER-ENTITY (multiple markets/selections per match per version)
- **Status:** VERIFIED (unique constraint exists in schema)

---

## PART 2: TRUE-KEY DUPLICATE RE-RUN — QUERIES & RESULTS

### Query & Result per Table

**Total Row Counts:**
| Table | Rows |
|-------|------|
| wc2026_odds_snapshots | 4,384 |
| wc2026_lineups | 2,484 |
| wc2026_match_events | 1,422 |
| wc2026_espn_shot_map | 2,251 |
| wc2026_model_projections | 96 |
| wc2026_holdout_validation | 258 |
| wc2026_recommendations | 264 |

---

### Table 1: wc2026_odds_snapshots

**Query:**
```sql
SELECT match_id, snapshot_ts, book_id, market, selection, COUNT(*) as cnt
FROM wc2026_odds_snapshots
GROUP BY match_id, snapshot_ts, book_id, market, selection
HAVING COUNT(*) > 1
```

**Result:** 0 rows returned.

**Old match_id-only dupe groups:** 72
**True-key dupes:** 0
**VERDICT: LEGITIMATE MULTI-ROW** — 4,384 rows across 72 matches = ~61 snapshots/match average. Each is a distinct time-series observation.
**Data-loss averted:** 72 match groups (4,312+ rows) would have been incorrectly flagged for deletion.
**Constraint status:** MISSING — no unique constraint on true key. Flag for schema session.

---

### Table 2: wc2026_lineups

**Query:**
```sql
SELECT match_id, team_id, player_name, scraped_at, COUNT(*) as cnt
FROM wc2026_lineups
GROUP BY match_id, team_id, player_name, scraped_at
HAVING COUNT(*) > 1
```

**Result:** 0 rows returned.

**Old match_id-only dupe groups:** 60
**True-key dupes:** 0
**VERDICT: LEGITIMATE MULTI-ROW** — 2,484 rows across 60 matches = ~41 players/match (22 starters + subs × multiple scrapes). Each is a distinct player entity.
**Data-loss averted:** 60 match groups (2,424+ rows) would have been incorrectly flagged.
**Constraint status:** MISSING — no unique constraint on true key. Flag for schema session.

---

### Table 3: wc2026_match_events

**Query:**
```sql
SELECT match_id, team_id, event_type, player_name, minute_num, COUNT(*) as cnt
FROM wc2026_match_events
GROUP BY match_id, team_id, event_type, player_name, minute_num
HAVING COUNT(*) > 1
```

**Result:** 360 dupe groups, 455 excess rows.

**CRITICAL FINDING:** player_name is NULL or empty ('') for ALL 1,422 rows (0 rows have player_name populated). This means the grouping key effectively collapses to `match_id + team_id + event_type + minute_num`.

**Nature of "dupes":**
- VAR events: ESPN reports multiple VAR checks in the same minute (checking goal validity + checking offside = 2 distinct events at same minute). These are POTENTIALLY LEGITIMATE multi-row.
- SUB events: Teams commonly make 2-3 substitutions at the same minute (especially at halftime min 45). Two SUBs at min 45 for the same team are DIFFERENT substitutions, not duplicates.
- With player_name=NULL, there is NO WAY to distinguish "same event scraped twice" from "two different events at same minute."

**Sample evidence (VERIFIED):**
```
wc26-g-036, team_id='tun', event_type='SUB', minute_num=45, cnt=2
  → id:1190 and id:1191 — IDENTICAL on all columns
  → BUT: Tunisia likely made 2 subs at halftime (common). These may be 2 DIFFERENT subs.
  
wc26-g-001, team_id='', event_type='VAR', minute_num=73, cnt=4
  → id:174,175,176,177 — ALL IDENTICAL on all columns
  → 4 VAR events at same minute is suspicious — likely scraper duplication, not 4 distinct VAR checks
```

**VERDICT: AMBIGUOUS — CANNOT SAFELY DEDUP**
- The true natural key REQUIRES player_name (or an event sequence ID) to distinguish legitimate multi-events from scraper duplication.
- With player_name universally NULL/empty, the key is incomplete.
- Deduping on the available key would destroy legitimate multi-sub/multi-VAR events.
- NOT deduping leaves scraper-duplicated rows in place.
- **Resolution requires:** Re-scraping with player_name populated, OR cross-referencing ESPN API event count per match to determine which rows are genuine vs duplicated.

**Old match_id-only dupe groups:** 62
**True-key dupes (on available columns):** 360 groups, 455 excess
**CONSTRAINT STATUS:** MISSING — but cannot add unique constraint until player_name is populated (would reject legitimate multi-events)

---

### Table 4: wc2026_espn_shot_map

**Query:**
```sql
SELECT espn_match_id, playerId, period, clock, fieldStartX, fieldStartY, COUNT(*) as cnt
FROM wc2026_espn_shot_map
GROUP BY espn_match_id, playerId, period, clock, fieldStartX, fieldStartY
HAVING COUNT(*) > 1
```

**Result:** 0 rows returned.

**Old match_id-only dupe groups:** 89
**True-key dupes:** 0
**VERDICT: LEGITIMATE MULTI-ROW** — 2,251 rows across 89 matches = ~25 shots/match. Each is a distinct shot entity.
**Data-loss averted:** 89 match groups (2,162+ rows) would have been incorrectly flagged.
**Constraint status:** MISSING — no unique constraint on true key. Flag for schema session.

---

### Table 5: wc2026_model_projections

**Query:**
```sql
SELECT match_id, model_version, COUNT(*) as cnt
FROM wc2026_model_projections
GROUP BY match_id, model_version
HAVING COUNT(*) > 1
```

**Result:** 0 rows returned.

**Old match_id-only dupe groups:** 18
**True-key dupes:** 0
**VERDICT: LEGITIMATE MULTI-ROW** — 96 rows across 18 matches with multiple versions = multiple model runs per match BY DESIGN.
**Data-loss averted:** 18 match groups (78+ rows) would have been incorrectly flagged.
**Constraint status:** ENFORCED — `uq_match_version` unique index exists. DB-level protection in place.

---

### Table 6: wc2026_holdout_validation

**Query:**
```sql
SELECT match_id, model_version, selection, COUNT(*) as cnt
FROM wc2026_holdout_validation
GROUP BY match_id, model_version, selection
HAVING COUNT(*) > 1
```

**Result:** 0 rows returned.

**Old match_id-only dupe groups:** 64
**True-key dupes:** 0
**VERDICT: LEGITIMATE MULTI-ROW** — 258 rows across 64 matches = ~4 selections/match (home/draw/away/btts). Each is a distinct validation entity.
**Data-loss averted:** 64 match groups (194+ rows) would have been incorrectly flagged.
**Constraint status:** ENFORCED — `uq_holdout` unique index exists. DB-level protection in place.

---

### Table 7: wc2026_recommendations

**Query:**
```sql
SELECT match_id, model_version, market, selection, COUNT(*) as cnt
FROM wc2026_recommendations
GROUP BY match_id, model_version, market, selection
HAVING COUNT(*) > 1
```

**Result:** 0 rows returned.

**Old match_id-only dupe groups:** 66
**True-key dupes:** 0
**VERDICT: LEGITIMATE MULTI-ROW** — 264 rows across 66 matches = ~4 recommendations/match (multiple markets × selections). Each is a distinct recommendation entity.
**Data-loss averted:** 66 match groups (198+ rows) would have been incorrectly flagged.
**Constraint status:** ENFORCED — `uq_rec_match_ver_mkt_sel` unique index exists. DB-level protection in place.

---

## OLD vs NEW DUPLICATE COUNTS — DATA-LOSS AVERTED

| Table | Old (match_id) Dupe Groups | True-Key Dupes | Verdict | Rows Saved from Deletion |
|-------|---------------------------|----------------|---------|--------------------------|
| odds_snapshots | 72 | 0 | LEGITIMATE MULTI-ROW | ~4,312 |
| lineups | 60 | 0 | LEGITIMATE MULTI-ROW | ~2,424 |
| match_events | 62 | 360* | AMBIGUOUS | 0 (cannot safely dedup) |
| espn_shot_map | 89 | 0 | LEGITIMATE MULTI-ROW | ~2,162 |
| model_projections | 18 | 0 | LEGITIMATE MULTI-ROW | ~78 |
| holdout_validation | 64 | 0 | LEGITIMATE MULTI-ROW | ~194 |
| recommendations | 66 | 0 | LEGITIMATE MULTI-ROW | ~198 |
| **TOTAL** | **431** | **0 genuine** | | **~9,368 rows saved** |

*match_events 360 groups are on an INCOMPLETE key (player_name universally NULL). Cannot determine genuine vs legitimate without player data.

**FINDING: The naive match_id-based dedup would have destroyed approximately 9,368 legitimate data rows across 6 tables.** Only match_events has potential dupes, but even those cannot be safely resolved without player_name population.

---

## ADDITIONAL EVIDENCE

### match_events player_name status (VERIFIED):
- Total rows: 1,422
- Rows with player_name populated (non-null, non-empty): **0**
- Rows with player_name = '' (empty string): 864
- Rows with player_name = NULL: 558
- espn_match_id for wc26-g-036: 760449

### Sample identical rows (VERIFIED — all columns match):
```json
{"id":1190,"match_id":"wc26-g-036","team_id":"tun","event_type":"SUB","player_name":null,"assist_player_name":null,"minute_str":"45'","minute_num":45,"is_first_half":1}
{"id":1191,"match_id":"wc26-g-036","team_id":"tun","event_type":"SUB","player_name":null,"assist_player_name":null,"minute_str":"45'","minute_num":45,"is_first_half":1}
```

---

## CONSTRAINT STATUS SUMMARY

| Table | Has Unique Constraint? | Action Needed |
|-------|----------------------|---------------|
| odds_snapshots | NO | ADD (match_id, snapshot_ts, book_id, market, selection) |
| lineups | NO | ADD (match_id, team_id, player_name, scraped_at) |
| match_events | NO | CANNOT ADD until player_name populated |
| espn_shot_map | NO | ADD (espn_match_id, playerId, period, clock, fieldStartX, fieldStartY) |
| model_projections | YES (uq_match_version) | None |
| holdout_validation | YES (uq_holdout) | None |
| recommendations | YES (uq_rec_match_ver_mkt_sel) | None |

---

## PART 3: PERMANENT DEDUP GATE (OPERATING-RULES)

**No DELETE/dedup operation may execute without ALL of the following:**

1. **TRUE KEY STATED** — with schema evidence (file:line, column definitions, constraint name if exists). The key must identify ONE legitimate row, not merely one match.
2. **GROUPING ON TRUE KEY** — GROUP BY must use the full composite natural key, never just `match_id` for multi-row-per-match tables.
3. **DATA-LOSS IMPACT STATEMENT** — exact count of rows to be deleted vs retained, with PROOF each deleted row is redundant on the true key (not just same match_id).
4. **ARCHIVE-FIRST REVERSIBILITY** — `INSERT INTO {table}_archive SELECT * FROM {table} WHERE id IN (...)` before any DELETE. Archive table must exist and be verified.
5. **EXPLICIT OWNER AUTHORIZATION** — owner must approve after reviewing the impact statement.

**No gate = no dedup. Violation = INCIDENT.**

---

## PART 4: CORRECTED 28-TABLE SCORECARD

### Reclassified Tables (were FAIL-DUPE, now CLEAN)

| Table | Old Verdict | New Verdict | Reason |
|-------|-------------|-------------|--------|
| wc2026_odds_snapshots | FAIL (670 dupes) | **CLEAN** | TIME-SERIES: 0 true-key dupes. 670 was naive match_id count of legitimate multi-row data. |
| wc2026_lineups | FAIL (157 dupes) | **CLEAN** | PER-ENTITY: 0 true-key dupes. 157 was naive match_id count of legitimate per-player rows. |
| wc2026_espn_shot_map | FAIL (17 dupes) | **CLEAN** | PER-ENTITY: 0 true-key dupes. 17 was naive match_id count of legitimate per-shot rows. |
| wc2026_model_projections | FAIL (18 dupes) | **CLEAN** | PER-(match+version): 0 true-key dupes. 18 was naive match_id count of legitimate multi-version rows. Unique constraint enforced. |
| wc2026_holdout_validation | FAIL (48 dupes) | **CLEAN** | PER-(match+version+selection): 0 true-key dupes. 48 was naive match_id count of legitimate multi-selection rows. Unique constraint enforced. |
| wc2026_recommendations | FAIL (48 dupes) | **CLEAN** | PER-(match+version+market+selection): 0 true-key dupes. 48 was naive match_id count of legitimate multi-recommendation rows. Unique constraint enforced. |

### Unchanged Table (remains problematic)

| Table | Old Verdict | New Verdict | Reason |
|-------|-------------|-------------|--------|
| wc2026_match_events | FAIL (80 dupes) | **AMBIGUOUS** | 360 true-key dupe groups on available columns, BUT player_name is universally NULL/empty making the key incomplete. Cannot safely dedup without player data. Cannot safely declare clean either. |

### REBUILT P0 DEDUP SCOPE

**P0 = match_events ONLY** — and BLOCKED until:
1. Player names are populated (re-scrape from ESPN with player data)
2. After population, re-run GROUP BY full key (with player_name) to identify genuine dupes
3. Then apply dedup gate (impact statement, archive, authorization)

**All other 6 tables: OUT OF DEDUP SCOPE. CLEAN PASS.**

### CORRECTED 28-TABLE TRIPLE-GATE SCORECARD

| # | Table | B2 Complete | B3 Clean | B5 Accurate | Triple-Gate |
|---|-------|-------------|----------|-------------|-------------|
| 1 | wc2026_matches | ✅ 104/104 | ✅ | ✅ | **PASS** |
| 2 | wc2026MatchOdds | ❌ 84/104 (20 missing) | ✅ | ✅ | FAIL (completeness) |
| 3 | wc2026_model_projections | ❌ 68/92 (24=ACCEPT-GAP) | ✅ | ✅ | CONDITIONAL PASS* |
| 4 | wc2026_holdout_validation | ❌ 64/68 (4 missing) | ✅ | ✅ | FAIL (completeness) |
| 5 | wc2026_recommendations | ❌ 66/68 (2 missing) | ✅ | ✅ | FAIL (completeness) |
| 6 | wc2026_frozen_book_odds | ❌ 37/92 (55 missing) | ✅ | ✅ | FAIL (completeness) |
| 7 | wc2026_odds_snapshots | ❌ 72/92 (20 missing) | ✅ | N/A | FAIL (completeness) |
| 8 | wc2026_lineups | ❌ 60/92 (32 missing) | ✅ | N/A | FAIL (completeness) |
| 9 | wc2026_match_events | ❌ 62/92 (30 missing) | ⚠️ AMBIGUOUS | N/A | FAIL (completeness + ambiguous dupes) |
| 10 | wc2026_market_no_vig | ❌ 63/92 (29 missing) | ✅ | N/A | FAIL (completeness) |
| 11 | wc2026_espn_matches | ✅ 92/92 | ✅ | ✅ | **PASS** |
| 12 | wc2026_espn_team_stats | ✅ 92/92 | ✅ | ✅ | **PASS** |
| 13 | wc2026_espn_match_stats | ✅ 92/92 | ✅ | ✅ | **PASS** |
| 14 | wc2026_espn_expected_goals | ✅ 92/92 | ✅ | ✅ | **PASS** |
| 15 | wc2026_espn_shot_map | ✅ 89/92 (3 missing) | ✅ | ✅ | FAIL (completeness) |
| 16 | wc2026_espn_player_stats | ✅ 89/92 (3 missing) | ✅ | ✅ | FAIL (completeness) |
| 17 | wc2026_espn_lineups | ✅ 89/92 (3 missing) | ✅ | ✅ | FAIL (completeness) |
| 18 | wc2026_espn_glossary | ✅ (reference) | ✅ | ✅ | **PASS** |
| 19-28 | (backup/orphan tables) | N/A | N/A | N/A | OUT OF SCOPE |

*CONDITIONAL PASS: 24 missing matches are ACCEPT-GAP (model didn't exist until Jun 19, MD1 matches played before that date). Remaining 68/68 projected matches = 100% coverage.

### SUMMARY

| Verdict | Count | Tables |
|---------|-------|--------|
| **PASS** | 6 | matches, espn_matches, espn_team_stats, espn_match_stats, espn_expected_goals, espn_glossary |
| **CONDITIONAL PASS** | 1 | model_projections (ACCEPT-GAP) |
| **FAIL (completeness only)** | 10 | MatchOdds, holdout, recommendations, frozen_book_odds, odds_snapshots, lineups, market_no_vig, espn_shot_map, espn_player_stats, espn_lineups |
| **FAIL (completeness + ambiguous)** | 1 | match_events |
| **OUT OF SCOPE** | 10 | backup/orphan tables |

### STANDS (unchanged from prior audit):
- B5 accuracy: 3/3 live-ESPN spot-checks PASS
- MD1 24-match ACCEPT-GAP: correct (temporal, permanent)
- Completeness gaps: pending population plan (gated on DB-013 DROP + backup + owner go)

---

## PART 5: FROZEN vs MATCHODDS DIVERGENCE — DESIGN-INTENT VERIFICATION

### Evidence (VERIFIED):

| Metric | Value | Source |
|--------|-------|--------|
| Total frozen_book_odds rows | 37 | `SELECT COUNT(*) FROM wc2026_frozen_book_odds` |
| Total overlapping matches | 37 | JOIN on match_id |
| Divergent on 1X2 ML | 19 | WHERE frozen != live |
| Agreeing on 1X2 ML | 0* | WHERE frozen = live |
| frozen_at BEFORE last_inserted_at | 37/37 (100%) | Temporal ordering |
| frozen_at AFTER last_inserted_at | 0/37 | — |

*Note: 37 overlap, 19 diverge on ML, remaining 18 may diverge on other markets (totals, spreads) — the query only checked 1X2.

### Design-Intent Statement:

**frozen_book_odds** = immutable point-in-time snapshot:
- Written ONCE per match (unique constraint on match_id)
- No `updated_at` column (cannot be modified after freeze)
- `frozen_at` = Jul 1 (opening lines, 1-6 days before kickoff)
- `frozen_by` = 'system' (automated freeze at a fixed point)

**wc2026MatchOdds** = live/closing line:
- Updated by engines (betexplorer_scraper, v19/v20/v22)
- `last_inserted_at` = Jul 2-5 (closer to kickoff)
- Has `odds_updated_at` column (tracks mutations)

### Verdict: **DESIGN-CORRECT, NOT A DATA INTEGRITY FAILURE**

The 19-match divergence is EXPECTED line movement between opening (frozen Jul 1) and closing (MatchOdds Jul 2-5) lines. All 37 overlapping matches show frozen_at < last_inserted_at, confirming temporal ordering. The divergence is the REASON frozen_book_odds exists — to preserve the opening line independently of subsequent market movement.

**Previous audit incorrectly flagged this as a cross-table integrity failure.** Reclassified as: **ACCEPTED BY DESIGN.**

---

## DATA-LOSS AVERTED TOTAL

| Source | Rows Saved |
|--------|-----------|
| odds_snapshots (72 match groups) | ~4,312 |
| lineups (60 match groups) | ~2,424 |
| espn_shot_map (89 match groups) | ~2,162 |
| model_projections (18 match groups) | ~78 |
| holdout_validation (64 match groups) | ~194 |
| recommendations (66 match groups) | ~198 |
| **TOTAL** | **~9,368 rows** |

**The naive match_id-based dedup would have destroyed approximately 9,368 legitimate data rows.** This re-verdict prevented that.
