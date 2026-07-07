# Authorization A Execution State

## Current Status
- r16-096 (SUI vs COL) ESPN ID=760508 is IN PROGRESS (4' as of 2026-07-07 ~20:00 UTC)
- Match date in DB: 2026-07-07
- DB status: SCHEDULED (needs update to FT after final)
- Must wait for FINAL before proceeding

## r16-096 ESPN Scrape Protocol (same as r16-095)
1. PRE-FLIGHT: confirm match state = FINAL in ESPN payload
2. Assert team names + date match DB fixture (SUI vs COL, 2026-07-07)
3. SCORELINE GATE: verify final scoreline matches
4. Run wc2026ESPNScraper.mjs scoped to espn_match_id=760508
5. WRITE stat blocks idempotently
6. POST-WRITE VERIFY: re-read all tables, confirm ~130 rows
7. Run-log: espn_wc26-r16-096_{ISO}.log
8. TEST-001 pre-cleared (expect harness false-negative on wc2026_espn_match_odds)

## After r16-096 Scrape — Schema Alignment Execution Order
1. Live-DB mysqldump + restore rehearsal
2. Dev server stop + git checkpoint
3. Slice 1: DB-008 — Remove duplicate wc2026MatchOdds from schema.ts:2993-3046
   - Keep wc2026.schema.ts:533-623 (more complete)
   - Add 3 missing columns: odds_updated_at, odds_source, market_status
   - Fix enum: add 'r16' to worldCupRound (this IS Slice 5, folded in)
   - Rewrite router import:
     FROM: import { wc2026MatchOdds, wc2026EspnMatches, type Wc2026MatchOddsRow } from "../../drizzle/schema";
     TO:   import { wc2026MatchOdds, type Wc2026MatchOddsRow } from "../../drizzle/wc2026.schema";
           import { wc2026EspnMatches } from "../../drizzle/schema";
   - Verify: tsc --noEmit, feed smoke, DIME smoke
4. Slice 5: Enum fix (may be folded into Slice 1 above)
5. Slice 2: DB-007 — Add 27 missing columns to wc2026ModelProjections in wc2026.schema.ts
   - Columns: over_4_5, home_clean_sheet, away_clean_sheet, ht_over_0_5, ht_over_1_5,
     ht_home_win, ht_draw, ht_away_win, fav_fragility_score, draw_quality_score,
     underdog_viability, xg_balance_ratio, book_odds (json), home_goal_dist (json),
     away_goal_dist (json), home_win_by_1, home_win_by_2, home_win_by_3plus,
     away_win_by_1, away_win_by_2, away_win_by_3plus, full_output (json),
     calculation_method (varchar(64) NOT NULL DEFAULT 'ANALYTICAL_DIXON_COLES'),
     actual_simulations (int NOT NULL DEFAULT 0), xg_source (varchar(64)),
     holdout_validated (tinyint(1)/boolean NOT NULL DEFAULT false), integrity_flags (json)
   - Verify: tsc --noEmit, drizzle-kit generate no migration for this table
6. Slice 4: DB-014 — UPDATE odds_source on 80 rows
   - gs_metadata_backfill → 'betexplorer' (60 rows)
   - r32_metadata_backfill → 'betexplorer' (15 rows)
   - v19 engine → 'betexplorer' (4 rows)
   - v20 null → 'betexplorer' (1 row)
   - wc2026_betexplorer_scraper_v4.py → 'betexplorer' (1 row, if ESPN_INGEST)
   - Verify: SELECT DISTINCT odds_source — no ESPN_INGEST remaining
7. Slice 3A: ADOPT 8 production orphan tables into wc2026.schema.ts
   - wc2026_data_lineage, wc2026_holdout_validation, wc2026_market_edges,
     wc2026_market_no_vig, wc2026_model_grades, wc2026_model_runs,
     wc2026_provider_match_map, wc2026_recommendations
   - Verify: tsc --noEmit, drizzle-kit generate no migration
8. Final gate: drizzle-kit generate runs clean, no prompt, no diff

## Key File Locations
- Design doc: /home/ubuntu/ai-sports-betting/audit-notes/SCHEMA-ALIGNMENT-DESIGN.md
- INCIDENTS: /home/ubuntu/ai-sports-betting/audit-notes/INCIDENTS.md
- Action log: /home/ubuntu/ai-sports-betting/audit-notes/remediation-action-log.md
- Run logs: /home/ubuntu/ai-sports-betting/audit-notes/run-logs/

## DB-008 Cascade Proof (COMPLETE)
- Only wc2026Router.ts:32 imports wc2026MatchOdds from drizzle/schema
- espnDbIngester.ts imports ESPN tables only (not wc2026MatchOdds)
- 67 other importers use non-WC2026 symbols only
- wc2026EspnMatches lives ONLY in schema.ts (not wc2026.schema.ts)
  → Router import must be split into two lines
