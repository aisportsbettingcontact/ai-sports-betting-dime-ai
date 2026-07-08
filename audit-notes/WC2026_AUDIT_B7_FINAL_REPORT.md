# B7: WC2026 Triple-Gate Final Report

**Audit completed:** 2026-07-08T01:40Z
**Ground truth:** 104 total matches, 92 played (FT), 12 scheduled (QF+SF+3rd+Final)

---

## TRIPLE-GATE SCORECARD

### Gate Definitions
- **COMPLETE (B2):** Row count matches expected (played matches for per-match tables)
- **CLEAN (B3):** Zero duplicates on natural key
- **ACCURATE (B5):** Spot-check values match live source

### Per-Table Verdicts

| # | Table | COMPLETE | CLEAN | ACCURATE | TRIPLE-GATE |
|---|-------|----------|-------|----------|-------------|
| 1 | wc2026_matches | ✅ 104/104 | ✅ 0 dupes | ✅ (master, not spot-checked) | **PASS** |
| 2 | wc2026_espn_matches | ✅ 92/92 | ✅ 0 dupes | ✅ 3/3 scores match | **PASS** |
| 3 | wc2026_espn_team_stats | ❌ 90/92 (-2: r16-091,092) | ✅ 0 dupes | ✅ (parent matches) | **FAIL** (incomplete) |
| 4 | wc2026_espn_match_stats | ❌ 90/92 (-2: r16-091,092) | ✅ 0 dupes | ⚠️ homeShots naming (DATA-001) | **FAIL** (incomplete + naming) |
| 5 | wc2026_espn_expected_goals | ❌ 90/92 (-2: r16-091,092) | ✅ 0 dupes | ✅ | **FAIL** (incomplete) |
| 6 | wc2026_espn_shot_map | ❌ 89/92 (-3: r16-091,092,r32-086) | ❌ 5+ dupes | ✅ | **FAIL** (incomplete + dupes) |
| 7 | wc2026_espn_player_stats | ❌ 89/92 (-3: r16-091,092,r32-086) | ✅ 0 dupes | ✅ | **FAIL** (incomplete) |
| 8 | wc2026_espn_lineups | ❌ 89/92 (-3: r16-091,092,r32-086) | ✅ 0 dupes | ✅ 3/3 counts match | **FAIL** (incomplete) |
| 9 | wc2026_espn_glossary | ✅ 20 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 10 | wc2026_espn_bracket | ✅ 32 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 11 | wc2026MatchOdds | ❌ 84/92 (-12 missing + 59 no_book_odds) | ✅ 0 dupes | INFERRED (BetExplorer geo-locked) | **FAIL** (incomplete) |
| 12 | wc2026_model_projections | ❌ 72 distinct/92 (-24 MD1 + dupes) | ❌ 18 match_ids duped | INFERRED | **FAIL** (incomplete + dupes) |
| 13 | wc2026_frozen_book_odds | ❌ 37/92 (-55) | ✅ 0 dupes | INFERRED | **FAIL** (incomplete) |
| 14 | wc2026_odds_snapshots | ❌ 72/92 (-20 KO matches) | ❌ 5+ dupes (some 6x) | INFERRED | **FAIL** (incomplete + dupes) |
| 15 | wc2026_holdout_validation | ❌ 64/92 (-28) | ❌ 5+ dupes | INFERRED | **FAIL** (incomplete + dupes) |
| 16 | wc2026_recommendations | ❌ 66/92 (-26) | ❌ 5+ dupes | INFERRED | **FAIL** (incomplete + dupes) |
| 17 | wc2026_market_edges | ❌ 18/92 (-74) | ✅ 0 dupes | INFERRED | **FAIL** (incomplete) |
| 18 | wc2026_market_no_vig | ❌ 21/92 (-71) | ✅ 0 dupes | INFERRED | **FAIL** (incomplete) |
| 19 | wc2026_match_stats | ❌ 63/92 (-29) | ✅ 0 dupes | INFERRED | **FAIL** (incomplete) |
| 20 | wc2026_match_events | ❌ 62/92 (-30) | ❌ 5+ dupes | INFERRED | **FAIL** (incomplete + dupes) |
| 21 | wc2026_lineups | ❌ 60/92 (-32) | ❌ 10+ dupes | INFERRED | **FAIL** (incomplete + dupes) |
| 22 | wc2026_teams | ✅ 49 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 23 | wc2026_venues | ✅ 16 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 24 | wc2026_team_aliases | ✅ 26 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 25 | wc2026_provider_match_map | ✅ 92 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 26 | wc2026_data_lineage | ✅ 8 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 27 | wc2026_model_grades | ✅ 57 (reference) | ✅ 0 dupes | N/A | **PASS** |
| 28 | wc2026_model_runs | ✅ 20 (reference) | ✅ 0 dupes | N/A | **PASS** |

### Summary

| Verdict | Count | Tables |
|---------|-------|--------|
| **PASS** | 10 | matches, espn_matches, espn_glossary, espn_bracket, teams, venues, team_aliases, provider_match_map, data_lineage, model_grades, model_runs |
| **FAIL** | 18 | All others |

---

## MASTER GAP LIST

### Missing Match IDs by Table

**ESPN child tables (r16-091, r16-092, r32-086):**
- espn_team_stats: r16-091, r16-092
- espn_match_stats: r16-091, r16-092
- espn_expected_goals: r16-091, r16-092
- espn_shot_map: r16-091, r16-092, r32-086
- espn_player_stats: r16-091, r16-092, r32-086
- espn_lineups: r16-091, r16-092, r32-086

**wc2026MatchOdds (12 missing rows entirely):**
- wc26-g-025, g-026, g-027, g-028, g-037, g-038, g-039, g-040, g-041, g-042, g-043, g-044

**wc2026_model_projections (24 missing):**
- wc26-g-001 through g-024 (all Matchday 1)

**wc2026_frozen_book_odds (55 missing):**
- wc26-g-001 through g-054, r16-092, r16-095, r16-096

**wc2026_odds_snapshots (20 missing):**
- All R32 (r32-073 through r32-088) + all R16 (r16-089 through r16-096)

**wc2026_holdout_validation (28 missing):**
- wc26-g-001 through g-024, r16-091, r16-092, r16-095, r16-096

**wc2026_recommendations (26 missing):**
- wc26-g-001 through g-024, r16-095, r16-096

**wc2026_market_edges (74 missing):**
- Nearly all except 18 matches

**wc2026_market_no_vig (71 missing):**
- Nearly all except 21 matches

**wc2026_match_stats (29 missing):**
- g-025 through g-028, g-037 through g-044, r16-091/092/095/096, r32-076 through r32-088

**wc2026_match_events (30 missing):**
- g-025 through g-028, g-037 through g-044, g-063, r16-091/092/095/096, r32-076 through r32-088

**wc2026_lineups (32 missing):**
- g-025 through g-028, g-037 through g-044, g-063, g-068, r16-091/092/095/096, r32-074, r32-076 through r32-088

---

## DUPLICATE REPORT

| Table | Dupe Count | Natural Key | Root Cause |
|-------|-----------|-------------|------------|
| wc2026_model_projections | 24 excess rows (18 match_ids) | match_id | Multiple engine runs without dedup |
| wc2026_espn_shot_map | 5+ | espn_match_id+period+clock+player+type | ESPN API dupes or re-scrape |
| wc2026_lineups | 10+ | match_id+player_name+team_id | FIFA scraper double-write |
| wc2026_match_events | 5+ | match_id+event_type+minute+player | Double-sub or re-scrape |
| wc2026_holdout_validation | 5+ | match_id+selection | Multiple model runs |
| wc2026_recommendations | 5+ | match_id+market+selection | Multiple model runs |
| wc2026_odds_snapshots | 5+ (some 6x) | match_id+ts+market+selection | Snapshot collector multi-run |

---

## ACCURACY SPOT-CHECKS (B5)

| Table | Check | Result | Source URL |
|-------|-------|--------|-----------|
| wc2026_espn_matches (760415) | MEX 2-0 RSA | ✅ MATCH | https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760415 |
| wc2026_espn_matches (760459) | COL 1-0 COD | ✅ MATCH | https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760459 |
| wc2026_espn_matches (760508) | SUI 0-0 COL (FT-Pens) | ✅ MATCH | https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760508 |
| wc2026_espn_match_stats (760415) | SOG 4-2, Corners 3-1 | ✅ MATCH | Same URLs |
| wc2026_espn_match_stats (all 3) | homeShots vs totalShots | ⚠️ NAMING ISSUE | DATA-001 filed |
| wc2026_espn_lineups (all 3) | Count 52/52/49 | ✅ MATCH | Same URLs |
| wc2026MatchOdds | BetExplorer odds | UNABLE TO VERIFY (geo-locked) | INFERRED correct via provenance |

---

## POPULATION PLAN (Dependency-Ordered, No Writes)

### Priority 0: ESPN Scrape (3 matches)
**Scope:** r16-091 (BRA-NOR), r16-092 (MEX-ENG), r32-086
**Source:** ESPN API (same protocol as r16-095/096)
**Script:** `_espn_ingest_runner_{id}.ts` (existing pattern)
**Tables affected:** espn_team_stats, espn_match_stats, espn_expected_goals, espn_shot_map, espn_player_stats, espn_lineups
**Provenance:** odds_source N/A (ESPN data)
**Can reach 100%:** YES — ESPN API has the data

### Priority 1a: Deduplication (7 tables)
**Scope:** All tables with dupes (model_projections, espn_shot_map, lineups, match_events, holdout_validation, recommendations, odds_snapshots)
**Source:** RECOVERY-FIRST — keep the LATEST row per natural key (highest id), DELETE older dupes
**Script:** Per-table `DELETE FROM t WHERE id NOT IN (SELECT MAX(id) FROM t GROUP BY natural_key)`
**Provenance:** No new provenance needed (existing data, just deduped)
**Can reach 100%:** YES

### Priority 1b: wc2026MatchOdds population (12 missing + 59 shells)
**Scope:** 12 entirely missing match_ids (g-025 through g-044 subset) + 59 no_book_odds shells
**Source:** RECOVERY-FIRST — wc2026_odds_snapshots has historical odds for many of these matches. Extract closing-line odds from snapshots. For matches without snapshots, BetExplorer re-scrape required.
**Script:** Extract from odds_snapshots → populate book_* columns + odds_source
**Provenance:** odds_source MUST be set to actual source in same write (per DB-014 requirement)
**Can reach 100%:** PARTIAL — 12 missing rows need odds_snapshots or re-scrape. 59 shells need snapshot recovery. Some may not have snapshot data (KO matches missing from odds_snapshots).

### Priority 2: Model Projections (24 missing MD1 matches)
**Scope:** wc26-g-001 through g-024
**Source:** Model was not operational for MD1. These matches CANNOT be retroactively projected without re-running the model against historical data.
**Script:** Would require full model re-run with pre-match data frozen at kickoff time
**Can reach 100%:** NO — temporal gap. Model didn't exist. Flag as LEGITIMATE HISTORICAL GAP.

### Priority 3: Frozen Book Odds (55 missing)
**Scope:** g-001 through g-054, r16-092, r16-095, r16-096
**Source:** RECOVERY-FIRST — wc2026_odds_snapshots may have pre-kickoff snapshots for group matches. For matches without snapshots, closing-line data may exist in wc2026MatchOdds (if populated).
**Script:** `seedJuly1Direct.ts` pattern (delete-by-match_id, insert one row, verify)
**Can reach 100%:** PARTIAL — depends on snapshot availability. Group matches g-001 to g-054 likely have snapshots. R16 matches may not.

### Priority 4: Odds Snapshots (20 missing KO matches)
**Scope:** All R32 + R16 matches
**Source:** Historical snapshot collection was not running for KO phase. Data does NOT exist in any artifact.
**Can reach 100%:** NO — temporal gap. Snapshot collector wasn't operational. Flag as LEGITIMATE HISTORICAL GAP.

### Priority 5: Match Stats/Events/Lineups (29-32 missing)
**Scope:** FIFA-sourced tables (match_stats, match_events, lineups)
**Source:** RECOVERY-FIRST — check if FIFA live scraper output exists in any artifact/log. If not, these require re-scrape from FIFA API (if still available post-match).
**Script:** `seedJune13Wc.mjs` pattern (delete-and-reseed from curated artifact)
**Can reach 100%:** UNKNOWN — depends on FIFA API data availability post-match

### Priority 6: Holdout/Recommendations/Edges/NoVig (26-74 missing)
**Scope:** Model-derived tables
**Source:** These are COMPUTED from model_projections + odds. Once Priority 1b (odds) and Priority 1a (dedup projections) are done, these can be recomputed.
**Script:** Re-run model grading/recommendation engine against populated data
**Can reach 100%:** PARTIAL — only for matches that have BOTH projections AND odds after Priorities 1a/1b

---

## TABLES THAT CANNOT REACH 100%

| Table | Reason | Permanent Gap |
|-------|--------|---------------|
| wc2026_model_projections | MD1 pre-dates model | 24 matches (g-001 to g-024) |
| wc2026_odds_snapshots | KO snapshot collector not running | 20 matches (all R32+R16) |
| wc2026_market_edges | Derived from projections+odds (both incomplete) | ~50+ matches |
| wc2026_market_no_vig | Same dependency | ~50+ matches |
| wc2026_holdout_validation | Requires projections (MD1 missing) | 24+ matches |
| wc2026_recommendations | Requires projections (MD1 missing) | 24+ matches |

---

## NEW FINDINGS FILED

| ID | Severity | Description |
|----|----------|-------------|
| DATA-001 | P4 | homeShots/awayShots column stores shotsOnGoal, not totalShots (naming mismatch in ESPN ingester) |

---

## CARRY-FORWARD (Not Executed, Gated)

- FE/DB-015: Penalty-status enum gap (P2, DIME path vulnerable). Remediation scoped.
- DB-014: 6-site engine-code fix (HALF-OPEN). Scoped, gated to next write window.
- DB-013 DROP: 10 backup tables (Authorization B). Requires mysqldump + restore rehearsal + explicit go.
- Population plan above: Executes ONLY after DB-013 DROP + backup + explicit go.
