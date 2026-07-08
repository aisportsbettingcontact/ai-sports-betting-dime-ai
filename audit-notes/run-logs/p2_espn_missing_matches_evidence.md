# P2: Missing ESPN Matches — Evidence Log

**Date:** 2026-07-08T07:00:00Z
**Scope:** 3 matches missing from ESPN tables (r16-091, r16-092, r32-086)

## Execution

| Match | ESPN ID | Status | Duration | Tables Written |
|---|---|---|---|---|
| r16-091 (BRA vs NOR) | 760504 | ✅ DATA WRITTEN | 169.8s | 7/7 (127 rows) |
| r16-092 (COL vs ENG) | 760505 | ✅ DATA WRITTEN | 228.7s | 7/7 (112 rows) |
| r32-086 (ARG vs SUI) | 760499 | ✅ DATA WRITTEN | 175.1s | 7/7 (121 rows) |

## Row Counts Post-Ingest

| Match | espn_matches | team_stats | match_stats | xg | shot_map | player_stats | lineups |
|---|---|---|---|---|---|---|---|
| 760504 | 1 | 1 | 1 | 1 | 23 | 30 | 50 |
| 760505 | 1 | 1 | 1 | 1 | 26 | 31 | 52 |
| 760499 | 1 | 1 | 1 | 1 | 39 | 32 | 47 |

## Notes

- All 3 runs report "FAIL: 3" — these are false failures caused by the scraper's verification step
  expecting 9 phases (including the dropped `wc2026_espn_match_odds` table). The ingester itself
  reports `success=false` because it counts the odds phase as failed.
- Actual data integrity: all 7 remaining ESPN tables populated correctly for all 3 matches.
- Fix applied to `wc2026ESPNScraper.mjs`: removed `wc2026_espn_match_odds` from verification loop
  and odds spot-check section (table was dropped in DB-013).

## Verification

```sql
-- All 3 matches now present in ESPN tables
espn_matches=1 team_stats=1 match_stats=1 xg=1 shot_map>0 player_stats>0 lineups>0
```

## P2 VERDICT: COMPLETE — 3/3 matches populated.
