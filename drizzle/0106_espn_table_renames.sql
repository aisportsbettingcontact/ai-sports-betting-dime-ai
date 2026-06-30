-- Migration 0106: ESPN table renames + drop wc2026_betting_splits
-- All ESPN scraper tables renamed to use wc2026_espn_ prefix
-- wc2026_betting_splits dropped (VSIN pipeline table no longer needed)
-- Applied directly via Node.js rename script (drizzle/rename_espn_tables.mjs)
-- This file records the operation in the migration journal only.

-- Tables renamed (already applied):
-- wc2026_matches        → wc2026_espn_matches
-- wc2026_match_odds     → wc2026_espn_match_odds
-- wc2026_team_stats     → wc2026_espn_team_stats
-- wc2026_expected_goals → wc2026_espn_expected_goals
-- wc2026_shot_map       → wc2026_espn_shot_map
-- wc2026_player_stats   → wc2026_espn_player_stats
-- wc2026_glossary       → wc2026_espn_glossary

-- Table dropped (already applied):
-- wc2026_betting_splits

SELECT 1; -- no-op placeholder so drizzle-kit can parse this file
