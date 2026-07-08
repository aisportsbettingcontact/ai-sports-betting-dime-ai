# B1: WC2026 Table Inventory

**Query run:** 2026-07-08T01:20Z
**Total tables:** 38
**Total rows:** 20,294

## Row Counts (from SHOW TABLES LIKE 'wc2026%' + COUNT(*))

| # | Table | Rows | Category |
|---|-------|------|----------|
| 0 | wc2026_data_lineage | 8 | Drizzle-managed |
| 1 | wc2026_edges_bak_t3r | 54 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 2 | wc2026_espn_bracket | 32 | Drizzle-managed |
| 3 | wc2026_espn_expected_goals | 90 | Drizzle-managed (ESPN) |
| 4 | wc2026_espn_glossary | 20 | Drizzle-managed (ESPN) |
| 5 | wc2026_espn_lineups | 4559 | Drizzle-managed (ESPN) |
| 6 | wc2026_espn_match_stats | 90 | Drizzle-managed (ESPN) |
| 7 | wc2026_espn_matches | 92 | Drizzle-managed (ESPN) |
| 8 | wc2026_espn_player_stats | 2806 | Drizzle-managed (ESPN) |
| 9 | wc2026_espn_shot_map | 2251 | Drizzle-managed (ESPN) |
| 10 | wc2026_espn_team_stats | 90 | Drizzle-managed (ESPN) |
| 11 | wc2026_frozen_book_odds | 37 | Drizzle-managed |
| 12 | wc2026_holdout_validation | 258 | Drizzle-managed (ADOPTED) |
| 13 | wc2026_lineups | 2484 | Drizzle-managed |
| 14 | wc2026_market_edges | 54 | Drizzle-managed (ADOPTED) |
| 15 | wc2026_market_no_vig | 63 | Drizzle-managed (ADOPTED) |
| 16 | wc2026_match_events | 1422 | Drizzle-managed |
| 17 | wc2026_match_stats | 63 | Drizzle-managed |
| 18 | wc2026_matches | 104 | Drizzle-managed (MASTER) |
| 19 | wc2026_model_grades | 57 | Drizzle-managed (ADOPTED) |
| 20 | wc2026_model_projections | 96 | Drizzle-managed |
| 21 | wc2026_model_runs | 20 | Drizzle-managed (ADOPTED) |
| 22 | wc2026_mp_bak | 0 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 23 | wc2026_mp_dedup_archive | 14 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 24 | wc2026_novig_bak_t3r | 63 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 25 | wc2026_odds_bak_t2 | 0 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 26 | wc2026_odds_bak_tier2 | 92 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 27 | wc2026_odds_snapshots | 4384 | Drizzle-managed |
| 28 | wc2026_orphan_match_odds_quarantine | 12 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 29 | wc2026_proj_bak_t3r | 92 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 30 | wc2026_proj_bak_tier2 | 92 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 31 | wc2026_provider_match_map | 92 | Drizzle-managed |
| 32 | wc2026_rec_bak_t3r | 264 | ORPHAN/BACKUP (DB-013 DROP candidate) |
| 33 | wc2026_recommendations | 264 | Drizzle-managed (ADOPTED) |
| 34 | wc2026_team_aliases | 26 | Drizzle-managed (ADOPTED) |
| 35 | wc2026_teams | 49 | Drizzle-managed |
| 36 | wc2026_venues | 16 | Drizzle-managed |
| 37 | wc2026MatchOdds | 84 | Drizzle-managed |

## Classification

### Drizzle-managed tables (28): Active production tables
- wc2026_matches (104) — MASTER fixture table
- wc2026MatchOdds (84) — Book + model odds
- wc2026_espn_matches (92) — ESPN match summaries
- wc2026_espn_team_stats (90) — ESPN team stats per match
- wc2026_espn_match_stats (90) — ESPN match stats
- wc2026_espn_expected_goals (90) — ESPN xG data
- wc2026_espn_shot_map (2251) — ESPN shot events
- wc2026_espn_player_stats (2806) — ESPN player stats
- wc2026_espn_lineups (4559) — ESPN lineups
- wc2026_espn_glossary (20) — ESPN stat abbreviation reference
- wc2026_espn_bracket (32) — ESPN bracket data
- wc2026_model_projections (96) — Model projection outputs
- wc2026_odds_snapshots (4384) — Historical odds snapshots
- wc2026_frozen_book_odds (37) — Frozen pre-kickoff odds
- wc2026_holdout_validation (258) — Model holdout validation
- wc2026_recommendations (264) — Betting recommendations
- wc2026_market_edges (54) — Market edge calculations
- wc2026_market_no_vig (63) — No-vig fair odds
- wc2026_model_grades (57) — Model grading results
- wc2026_model_runs (20) — Model run metadata
- wc2026_match_events (1422) — Match events (goals, cards, etc.)
- wc2026_match_stats (63) — Match statistics
- wc2026_lineups (2484) — Match lineups
- wc2026_teams (49) — Team reference data
- wc2026_venues (16) — Venue reference data
- wc2026_team_aliases (26) — Team name aliases
- wc2026_provider_match_map (92) — Provider ID mapping
- wc2026_data_lineage (8) — Data lineage tracking

### DB-013 DROP candidates (10): Backup/orphan tables
- wc2026_edges_bak_t3r (54)
- wc2026_mp_bak (0)
- wc2026_mp_dedup_archive (14)
- wc2026_novig_bak_t3r (63)
- wc2026_odds_bak_t2 (0)
- wc2026_odds_bak_tier2 (92)
- wc2026_orphan_match_odds_quarantine (12)
- wc2026_proj_bak_t3r (92)
- wc2026_proj_bak_tier2 (92)
- wc2026_rec_bak_t3r (264)

## Ground Truth
- Total matches: 104 (48 group + 16 R32 + 16 R16 + ... but ONLY group+R32+some R16 played so far)
- Matches played (status=FT): need to query
- ESPN baseline: ~129-138 rows per match (from r16-095/096)
