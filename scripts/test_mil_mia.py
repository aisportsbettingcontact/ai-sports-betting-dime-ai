#!/usr/bin/env python3
"""
Direct test of MLBAIModel for MIL@MIA (2026-04-17)
Robert Gasser (league-avg) vs Janson Junk
Runs with unbuffered output so we can see exactly where it stalls
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
from datetime import datetime

from MLBAIModel import project_game

print("[INPUT] MIL@MIA — Robert Gasser(R) vs Janson Junk(R)", flush=True)
print("[STATE] Gasser: league-avg (ERA=4.50, FIP=4.50, xFIP=4.50)", flush=True)
print("[STATE] Junk: from DB stats", flush=True)

# MIL team stats (2025)
MIL_STATS = {
    "rpg": 4.72,
    "era": 3.89,
    "avg": 0.254,
    "obp": 0.321,
    "slg": 0.415,
    "k9": 9.2,
    "bb9": 3.1,
    "whip": 1.22,
    "ip_per_game": 5.4,
    "f5_rs": 2.48,
    "nrfi_rate": 0.531,
}

# MIA team stats (2025)
MIA_STATS = {
    "rpg": 4.18,
    "era": 4.41,
    "avg": 0.258,
    "obp": 0.324,
    "slg": 0.408,
    "k9": 8.8,
    "bb9": 3.4,
    "whip": 1.31,
    "ip_per_game": 5.2,
    "f5_rs": 2.32,
    "nrfi_rate": 0.4663,
}

# Robert Gasser — league-average (no 2024/2025 season stats, TJ surgery)
GASSER_STATS = {
    "era": 4.50,
    "fip": 4.50,
    "xfip": 4.50,
    "k9": 9.0,
    "bb9": 3.1,
    "whip": 1.26,
    "ip_per_game": 5.3,
    "war": 1.0,
    "throws_hand": 1,  # L
    "gb_rate": 0.45,
    "fb_rate": 0.35,
    "ld_rate": 0.20,
    "hr_per_9": 1.2,
    "babip": 0.300,
    "rolling_era": None,
    "rolling_fip": None,
    "rolling_k9": None,
    "rolling_bb9": None,
    "rolling_ip": None,
    "rolling_starts": None,
}

# Janson Junk — from DB (2025 season)
JUNK_STATS = {
    "era": 4.85,
    "fip": 4.92,
    "xfip": 4.78,
    "k9": 7.8,
    "bb9": 3.2,
    "whip": 1.38,
    "ip_per_game": 4.9,
    "war": 0.3,
    "throws_hand": 2,  # R
    "gb_rate": 0.42,
    "fb_rate": 0.38,
    "ld_rate": 0.20,
    "hr_per_9": 1.4,
    "babip": 0.310,
    "rolling_era": None,
    "rolling_fip": None,
    "rolling_k9": None,
    "rolling_bb9": None,
    "rolling_ip": None,
    "rolling_starts": None,
}

BOOK_LINES = {
    "away_ml": -105,
    "home_ml": -115,
    "away_rl": -1.5,
    "home_rl": 1.5,
    "away_rl_odds": 165,
    "home_rl_odds": -200,
    "total": 8.5,
    "over_odds": -110,
    "under_odds": -110,
}

print("[STEP] Calling project_game with verbose=True...", flush=True)

try:
    result = project_game(
        away_abbrev="MIL",
        home_abbrev="MIA",
        away_team_stats=MIL_STATS,
        home_team_stats=MIA_STATS,
        away_pitcher_stats=GASSER_STATS,
        home_pitcher_stats=JUNK_STATS,
        book_lines=BOOK_LINES,
        game_date=datetime(2026, 4, 17),
        park_factor_3yr=0.9844,
        away_bullpen={"era": 4.30, "fip": 3.18},
        home_bullpen={"era": 3.33, "fip": 3.16},
        umpire_k_mod=1.0,
        umpire_bb_mod=1.0,
        umpire_name="UNKNOWN",
        away_pitcher_nrfi=0.8571,
        home_pitcher_nrfi=0.6316,
        away_pitcher_nrfi_starts=7,
        home_pitcher_nrfi_starts=19,
        away_team_nrfi=0.531,
        home_team_nrfi=0.4663,
        away_f5_rs=2.48,
        home_f5_rs=2.32,
        verbose=True,
    )
    print("[OUTPUT] Result:", result.get("ok"), flush=True)
    print("[OUTPUT] ML:", result.get("away_ml"), result.get("home_ml"), flush=True)
    print("[OUTPUT] RL:", result.get("away_rl"), result.get("home_rl"), flush=True)
    print("[OUTPUT] Total:", result.get("total"), flush=True)
    print("[VERIFY] PASS — MIL@MIA model completed successfully", flush=True)
except Exception as e:
    print("[FAIL] Exception:", str(e), flush=True)
    import traceback

    traceback.print_exc()
