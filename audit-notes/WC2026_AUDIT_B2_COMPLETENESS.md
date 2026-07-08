# B2: WC2026 Completeness Audit

**Query run:** 2026-07-08T01:25Z
**Ground truth:** 92 played (status=FT), 12 scheduled = 104 total
**ESPN IDs mapped:** 92/92 played (100%)

## Match-Level Tables (1 row per match expected)

| Table | Rows | Distinct IDs | Expected | Delta | Missing |
|-------|------|-------------|----------|-------|---------|
| wc2026_espn_matches | 92 | 92 | 92 | 0 | NONE |
| wc2026_espn_team_stats | 90 | 90 | 92 | -2 | r16-091, r16-092 |
| wc2026_espn_match_stats | 90 | 90 | 92 | -2 | r16-091, r16-092 |
| wc2026_espn_expected_goals | 90 | 90 | 92 | -2 | r16-091, r16-092 |
| wc2026_model_projections | 96 | 72 | 104 | -32 | g-001 thru g-024, qf-097 thru qf-100, sf-101, sf-102, 3rd-103, final-104 |
| wc2026MatchOdds | 84 | 84 | 104 | -20 | g-025 thru g-028, g-037 thru g-044, qf-097 thru qf-100, sf-101, sf-102, 3rd-103, final-104 |
| wc2026_match_stats | 63 | 63 | 92 | -29 | g-025 thru g-028, g-037 thru g-044, r16-091/092/095/096, r32-076 thru r32-088 |
| wc2026_frozen_book_odds | 37 | 37 | 92 | -55 | g-001 thru g-054, r16-092, r16-095, r16-096 |
| wc2026_market_no_vig | 63 | 21 | 92 | -71 | g-002 thru g-072, r16-095, r16-096 |

## Multi-Row Tables

| Table | Rows | Distinct Match IDs | Expected | Delta | Missing |
|-------|------|-------------------|----------|-------|---------|
| wc2026_espn_shot_map | 2251 | 89 | 92 | -3 | r16-091, r16-092, r32-086 |
| wc2026_espn_player_stats | 2806 | 89 | 92 | -3 | r16-091, r16-092, r32-086 |
| wc2026_espn_lineups | 4559 | 89 | 92 | -3 | r16-091, r16-092, r32-086 |
| wc2026_match_events | 1422 | 62 | 92 | -30 | g-025 thru g-028, g-037 thru g-044, g-063, r16-091/092/095/096, r32-076 thru r32-088 |
| wc2026_lineups | 2484 | 60 | 92 | -32 | g-025 thru g-028, g-037 thru g-044, g-063, g-068, r16-091/092/095/096, r32-074, r32-076 thru r32-088 |
| wc2026_odds_snapshots | 4384 | 72 | 92 | -20 | r16-091 thru r16-096, r32-073 thru r32-088 |
| wc2026_holdout_validation | 258 | 64 | 92 | -28 | g-001 thru g-024, r16-091/092/095/096 |
| wc2026_recommendations | 264 | 66 | 92 | -26 | g-001 thru g-024, r16-095, r16-096 |
| wc2026_market_edges | 54 | 18 | 92 | -74 | g-001 thru g-072, r16-095, r16-096 |

## Gap Classification

### Pattern 1: r16-091, r16-092 (today's matches, not yet scraped)
- Missing from: espn_team_stats, espn_match_stats, espn_expected_goals, espn_shot_map, espn_player_stats, espn_lineups
- Classification: **COVERAGE GAP** — matches played (FT), ESPN scrape not yet executed
- Note: espn_matches HAS these (92 rows) but child tables don't (90 rows)

### Pattern 2: r32-086 (ESPN child tables only)
- Missing from: espn_shot_map, espn_player_stats, espn_lineups
- Classification: **COVERAGE GAP** — match played, partial scrape (match-level data exists but child tables missing)

### Pattern 3: g-001 thru g-024 (first 24 group matches)
- Missing from: model_projections, holdout_validation, recommendations, frozen_book_odds
- Classification: **COVERAGE GAP** — these were the earliest matches, model pipeline wasn't running yet

### Pattern 4: g-025 thru g-044 (middle group matches)
- Missing from: wc2026MatchOdds, match_stats, match_events, lineups
- Classification: **COVERAGE GAP** — odds/stats pipeline gaps for MD2 group matches

### Pattern 5: All KO matches (r32-073 thru r32-088, r16-091 thru r16-096)
- Missing from: odds_snapshots (20 missing = all R32 + R16 matches)
- Classification: **COVERAGE GAP** — odds snapshot collection didn't run for knockout phase

### Pattern 6: Most group matches (g-002 thru g-072)
- Missing from: market_no_vig (71 missing), market_edges (74 missing)
- Classification: **COVERAGE GAP** — no-vig/edge calculations only ran for a subset

### Pattern 7: Future matches (qf-097 thru final-104)
- Missing from: model_projections, wc2026MatchOdds
- Classification: **LEGITIMATE — UNPLAYED** — these matches haven't happened yet

### Pattern 8: r16-095, r16-096 (just played today)
- Missing from: many tables (match_stats, match_events, lineups, odds_snapshots, holdout, recommendations, market_no_vig, market_edges, frozen_book_odds)
- Classification: **COVERAGE GAP** — today's matches, pipeline hasn't processed them yet beyond ESPN scrape
