# vulture_whitelist.py — Vulture false-positive suppression
# Generated from: vulture --make-whitelist (filtered to false positives only)
# Usage: vulture <source_files> vulture_whitelist.py --min-confidence 60
# The whitelist file itself will show as "unused" when scanned — this is expected Vulture behavior.

# ── MLBAIModel.py — model spec constants (intentional, not yet wired to subsystems) ──
LEARNING_RATE_BASE
DRIFT_THRESHOLD
BULLPEN_LOOKBACK_DAYS
LINEUP_BOTTOM_WEIGHT
KEY_PRICE_BUCKETS
ROUNDING_RULES
NO_VIG_OUTPUT
INVERSE_SYMMETRY
LEAGUE_K9
LEAGUE_BB9
LEAGUE_HR9
LEAGUE_WHIP
fmt_ml
team_stats_to_pitcher_features

# ── StrikeoutModel.py — model spec constants (intentional, not yet wired to subsystems) ──
SIG_WT_WHIFF
SIG_WT_ZONE
SIG_WT_ARSENAL
VELO_K_ADJ_PER_MPH
STARTER_IP_STD

# ── scripts/ — intentional patterns ──
_._BACKTEST_INN_WEIGHTS
new_text
BOOK_IDS_TO_TEST
LOG_FILE
