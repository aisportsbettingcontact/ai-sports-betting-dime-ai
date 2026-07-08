# Workstream W P2-P5 Context

## P1 COMPLETE: DB-009 closed (59/59 no_book_odds → odds_snapshots_closing)

## P2: 3 Missing ESPN Matches
- r16-091 (BRA vs NOR) = ESPN 760504
- r16-092 (MEX vs ENG) = ESPN 760505
- r32-086 = ESPN 760499 (shot_map only)

### What's needed:
- r16-091 + r16-092: FULL ESPN ingest (team_stats, match_stats, xG, shot_map, player_stats, lineups)
- r32-086: shot_map only

### Method: Run wc2026ESPNScraper.mjs for each ESPN match ID
- Script location: server/wc2026/wc2026ESPNScraper.mjs or similar
- Tables populated: wc2026_team_stats, wc2026_match_stats, wc2026_xg, wc2026_shot_map, wc2026_player_stats, wc2026_lineups

## P3: FROZEN_BOOK_ODDS Recovery (55/92 gap → 37/92 present)
- r32-086, 087, 088: Derive from wc2026MatchOdds book columns
- r16-089, r16-090: DATA-001 swap fix (fix_seeded_odds_v2.mjs)
- r16-092: NOT present, needs derivation from wc2026MatchOdds
- Group stage (72): OWNER DECISION — derive from odds_snapshots_closing?

## P4: Remaining stat/odds coverage gaps
- 12 missing wc2026MatchOdds group matches (g-025–g-028, g-037–g-044): derive from odds_snapshots
- 27 matches ESPN propagation (match_stats/events): ESPN data in espn_* tables, propagate via ingester
- 30 missing lineups: ESPN lineups exist, propagate

## P5: Final reconciliation + scorecard update

## wc2026MatchOdds columns (confirmed):
- book_home_ml, book_away_ml, book_draw, book_home_wd, book_away_wd, book_no_draw
- book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds
- book_total, book_over_odds, book_under_odds
- book_btts_yes, book_btts_no, book_home_to_advance, book_away_to_advance
- model_* equivalents for all above
- odds_source, odds_updated_at, market_status

## wc2026_odds_snapshots columns:
- id, match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing
- Market values: 1X2, TOTAL, ASIAN_HANDICAP, BTTS
- Selection values: home, away, draw, over, under, no_draw, yes, no

## wc2026_frozen_book_odds columns (need to check):
- TBD - check schema
