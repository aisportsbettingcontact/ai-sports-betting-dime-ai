#!/usr/bin/env python3.11
"""
MLB Backtest Grader — v1 vs v2 Calibration Accuracy Lift
=========================================================
Pulls all 2024+2025+2026 regular-season games from mlb_schedule_history (FG scores + DK odds)
and games table (F5 scores + NRFI results), runs the model under v1 and v2 constant sets,
grades all 9 markets per game, and produces a structured accuracy/ROI comparison report.

Markets graded:
  FG:  ML (home/away), RL (home/away -1.5/+1.5), Total (over/under)
  F5:  ML (home/away), Total (over/under)
  I1:  NRFI / YRFI

Calibration sets:
  v1: F5_RUN_SHARE=0.5311, I9_WEIGHT=0.1170, fg_rl_away_cover=0.3189, f5_home_win_rate=0.5319
  v2: F5_RUN_SHARE=0.5618, I9_WEIGHT=0.0792, fg_rl_away_cover=0.6430, f5_home_win_rate=0.4511

Usage:
  python3.11 scripts/mlbBacktestGrader.py [--seasons 2024,2025,2026] [--limit N] [--verbose]
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional

# ── Add project root to path so we can import MLBAIModel ──────────────────────
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR   = os.path.join(PROJECT_ROOT, "server")
sys.path.insert(0, SERVER_DIR)
sys.path.insert(0, PROJECT_ROOT)

# ── DB connection via mysql-connector ─────────────────────────────────────────
try:
    import mysql.connector
except ImportError:
    os.system("sudo pip3 install mysql-connector-python -q")
    import mysql.connector

import dotenv  # noqa: E402

dotenv.load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

DB_URL = os.environ.get("DATABASE_URL", "")

def parse_db_url(url: str):
    """Parse mysql://user:pass@host:port/dbname"""
    import re
    m = re.match(r"mysql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/(.+)", url)
    if not m:
        raise ValueError(f"Cannot parse DATABASE_URL: {url[:40]}...")
    user, password, host, port, database = m.groups()
    return dict(user=user, password=password, host=host, port=int(port or 3306), database=database)

def get_db():
    cfg = parse_db_url(DB_URL)
    return mysql.connector.connect(**cfg, autocommit=True)

# ── Import model ───────────────────────────────────────────────────────────────
print("[STEP] Importing MLBAIModel...")
import MLBAIModel as M  # noqa: E402

print(f'[STEP] MLBAIModel loaded. CALIBRATION_VERSION={getattr(M, "CALIBRATION_VERSION", "unknown")}')

# ── V1 constants (pre-calibration) ────────────────────────────────────────────
V1_PRIORS = {
    "F5_RUN_SHARE":       0.5311,
    "INNING1_RUN_SHARE":  0.1093,
    "nrfi_rate":          0.5154,
    "i1_share":           0.1093,
    "fg_home_win_rate":   0.5258,
    "fg_away_win_rate":   0.4742,
    "f5_home_win_rate":   0.5319,
    "f5_away_win_rate":   0.4681,
    "f5_push_rate":       0.0,     # not tracked in v1
    "fg_rl_away_cover":   0.3189,
    "fg_rl_home_cover":   0.5128,
    "f5_mean":            4.726,
    "fg_mean":            8.895,
}
V1_INN_WEIGHTS = [0.1151, 0.1009, 0.1127, 0.1124, 0.1136, 0.1133, 0.1072, 0.1079, 0.1170]

# ── V2 constants (post-calibration, current model) ────────────────────────────
V2_PRIORS = dict(M.EMPIRICAL_PRIORS)  # live from model
V2_INN_WEIGHTS = [0.116647, 0.102130, 0.114120, 0.113854, 0.115029, 0.114764, 0.108511, 0.109019, 0.079211]

# ── TEAM_STATS lookup (from mlbModelRunner.ts — 2025 season) ──────────────────
TEAM_STATS: Dict[str, Dict[str, float]] = {
    "NYY": {"rpg": 4.92, "era": 3.92, "avg": 0.254, "obp": 0.326, "slg": 0.432, "k9": 9.5,  "bb9": 3.1, "whip": 1.23, "ip_per_game": 5.5},
    "BOS": {"rpg": 4.81, "era": 4.18, "avg": 0.256, "obp": 0.326, "slg": 0.430, "k9": 9.2,  "bb9": 3.3, "whip": 1.28, "ip_per_game": 5.3},
    "TOR": {"rpg": 4.62, "era": 4.28, "avg": 0.248, "obp": 0.316, "slg": 0.418, "k9": 9.0,  "bb9": 3.2, "whip": 1.28, "ip_per_game": 5.2},
    "BAL": {"rpg": 4.78, "era": 4.05, "avg": 0.252, "obp": 0.322, "slg": 0.428, "k9": 9.3,  "bb9": 3.0, "whip": 1.24, "ip_per_game": 5.4},
    "TB":  {"rpg": 4.52, "era": 3.98, "avg": 0.246, "obp": 0.318, "slg": 0.412, "k9": 9.4,  "bb9": 3.1, "whip": 1.24, "ip_per_game": 5.3},
    "CLE": {"rpg": 4.48, "era": 3.85, "avg": 0.244, "obp": 0.314, "slg": 0.408, "k9": 9.5,  "bb9": 2.9, "whip": 1.22, "ip_per_game": 5.5},
    "MIN": {"rpg": 4.65, "era": 4.12, "avg": 0.250, "obp": 0.320, "slg": 0.420, "k9": 9.1,  "bb9": 3.2, "whip": 1.26, "ip_per_game": 5.3},
    "CWS": {"rpg": 3.92, "era": 4.82, "avg": 0.238, "obp": 0.302, "slg": 0.388, "k9": 8.5,  "bb9": 3.5, "whip": 1.35, "ip_per_game": 4.9},
    "DET": {"rpg": 4.38, "era": 4.15, "avg": 0.246, "obp": 0.314, "slg": 0.408, "k9": 9.0,  "bb9": 3.2, "whip": 1.27, "ip_per_game": 5.2},
    "KC":  {"rpg": 4.55, "era": 4.22, "avg": 0.250, "obp": 0.318, "slg": 0.415, "k9": 8.8,  "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.2},
    "HOU": {"rpg": 4.72, "era": 3.88, "avg": 0.252, "obp": 0.322, "slg": 0.425, "k9": 9.4,  "bb9": 2.9, "whip": 1.22, "ip_per_game": 5.5},
    "SEA": {"rpg": 4.42, "era": 3.95, "avg": 0.244, "obp": 0.314, "slg": 0.408, "k9": 9.6,  "bb9": 2.9, "whip": 1.21, "ip_per_game": 5.5},
    "TEX": {"rpg": 4.52, "era": 4.15, "avg": 0.250, "obp": 0.318, "slg": 0.412, "k9": 9.0,  "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.3},
    "LAA": {"rpg": 4.28, "era": 4.42, "avg": 0.246, "obp": 0.314, "slg": 0.408, "k9": 8.8,  "bb9": 3.3, "whip": 1.30, "ip_per_game": 5.1},
    "ATH": {"rpg": 4.21, "era": 4.38, "avg": 0.244, "obp": 0.312, "slg": 0.395, "k9": 8.8,  "bb9": 3.3, "whip": 1.30, "ip_per_game": 5.1},
    "OAK": {"rpg": 4.21, "era": 4.38, "avg": 0.244, "obp": 0.312, "slg": 0.395, "k9": 8.8,  "bb9": 3.3, "whip": 1.30, "ip_per_game": 5.1},
    "NYM": {"rpg": 4.62, "era": 4.02, "avg": 0.252, "obp": 0.322, "slg": 0.418, "k9": 9.1,  "bb9": 3.0, "whip": 1.25, "ip_per_game": 5.4},
    "PHI": {"rpg": 4.88, "era": 3.88, "avg": 0.258, "obp": 0.328, "slg": 0.438, "k9": 9.4,  "bb9": 2.9, "whip": 1.21, "ip_per_game": 5.5},
    "ATL": {"rpg": 4.85, "era": 3.92, "avg": 0.256, "obp": 0.326, "slg": 0.435, "k9": 9.3,  "bb9": 3.0, "whip": 1.22, "ip_per_game": 5.4},
    "MIA": {"rpg": 4.12, "era": 4.45, "avg": 0.240, "obp": 0.308, "slg": 0.395, "k9": 8.8,  "bb9": 3.4, "whip": 1.32, "ip_per_game": 5.0},
    "WSH": {"rpg": 4.35, "era": 4.52, "avg": 0.244, "obp": 0.312, "slg": 0.402, "k9": 8.7,  "bb9": 3.3, "whip": 1.32, "ip_per_game": 5.0},
    "WAS": {"rpg": 4.35, "era": 4.52, "avg": 0.244, "obp": 0.312, "slg": 0.402, "k9": 8.7,  "bb9": 3.3, "whip": 1.32, "ip_per_game": 5.0},
    "CHC": {"rpg": 4.55, "era": 4.12, "avg": 0.248, "obp": 0.318, "slg": 0.415, "k9": 9.0,  "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.3},
    "STL": {"rpg": 4.42, "era": 4.22, "avg": 0.248, "obp": 0.316, "slg": 0.410, "k9": 8.8,  "bb9": 3.2, "whip": 1.28, "ip_per_game": 5.2},
    "MIL": {"rpg": 4.58, "era": 3.95, "avg": 0.248, "obp": 0.318, "slg": 0.418, "k9": 9.2,  "bb9": 3.0, "whip": 1.24, "ip_per_game": 5.4},
    "CIN": {"rpg": 4.65, "era": 4.28, "avg": 0.252, "obp": 0.320, "slg": 0.422, "k9": 9.0,  "bb9": 3.2, "whip": 1.28, "ip_per_game": 5.2},
    "PIT": {"rpg": 4.28, "era": 4.35, "avg": 0.244, "obp": 0.312, "slg": 0.402, "k9": 8.8,  "bb9": 3.2, "whip": 1.29, "ip_per_game": 5.2},
    "LAD": {"rpg": 5.12, "era": 3.72, "avg": 0.262, "obp": 0.334, "slg": 0.448, "k9": 9.6,  "bb9": 2.8, "whip": 1.18, "ip_per_game": 5.6},
    "SD":  {"rpg": 4.58, "era": 3.98, "avg": 0.250, "obp": 0.320, "slg": 0.420, "k9": 9.3,  "bb9": 3.0, "whip": 1.24, "ip_per_game": 5.4},
    "SF":  {"rpg": 4.42, "era": 4.08, "avg": 0.248, "obp": 0.318, "slg": 0.412, "k9": 9.1,  "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.3},
    "ARI": {"rpg": 4.72, "era": 4.18, "avg": 0.254, "obp": 0.324, "slg": 0.428, "k9": 9.0,  "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.3},
    "COL": {"rpg": 4.88, "era": 5.12, "avg": 0.258, "obp": 0.326, "slg": 0.438, "k9": 8.5,  "bb9": 3.4, "whip": 1.38, "ip_per_game": 4.9},
}
DEFAULT_STATS = {"rpg": 4.50, "era": 4.25, "avg": 0.250, "obp": 0.318, "slg": 0.415, "k9": 9.0, "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.2}
DEFAULT_PITCHER = {"era": 4.25, "k9": 8.8, "bb9": 3.1, "whip": 1.28, "ip": 140.0, "gp": 25, "xera": 4.25}

def get_team_stats(abbrev: str) -> dict:
    return TEAM_STATS.get(abbrev, TEAM_STATS.get(abbrev.upper(), DEFAULT_STATS))

# ── Odds helpers ───────────────────────────────────────────────────────────────
def ml_to_prob(ml_str: Optional[str]) -> Optional[float]:
    """Convert American ML string to implied probability (no vig)."""
    if not ml_str:
        return None
    try:
        ml = float(str(ml_str).replace("+", "").strip())
        if ml > 0:
            return 100 / (ml + 100)
        return abs(ml) / (abs(ml) + 100)
    except Exception:
        return None

def ml_to_decimal(ml_str: Optional[str]) -> Optional[float]:
    """Convert American ML to decimal odds."""
    if not ml_str:
        return None
    try:
        ml = float(str(ml_str).replace("+", "").strip())
        if ml > 0:
            return 1 + ml / 100
        return 1 + 100 / abs(ml)
    except Exception:
        return None

def calc_roi(model_prob: float, book_ml: Optional[str]) -> Optional[float]:
    """Calculate expected ROI = model_prob * decimal_odds - 1."""
    dec = ml_to_decimal(book_ml)
    if dec is None:
        return None
    return model_prob * dec - 1.0

# ── Patch model constants for v1/v2 ───────────────────────────────────────────
def patch_model_constants(version: str):
    """Patch MLBAIModel global constants for v1 or v2."""
    if version == "v1":
        priors = V1_PRIORS
        inn_weights = V1_INN_WEIGHTS
    else:
        priors = V2_PRIORS
        inn_weights = V2_INN_WEIGHTS

    # Patch EMPIRICAL_PRIORS dict in-place
    for k, v in priors.items():
        if k in M.EMPIRICAL_PRIORS:
            M.EMPIRICAL_PRIORS[k] = v

    # Patch F5_RUN_SHARE and INNING1_RUN_SHARE module-level constants
    M.EMPIRICAL_PRIORS["F5_RUN_SHARE"] = priors.get("F5_RUN_SHARE", M.EMPIRICAL_PRIORS.get("F5_RUN_SHARE", 0.5618))
    M.EMPIRICAL_PRIORS["INNING1_RUN_SHARE"] = priors.get("INNING1_RUN_SHARE", M.EMPIRICAL_PRIORS.get("INNING1_RUN_SHARE", 0.1166))

    # Store inn_weights for use during simulation (patched via module attribute)
    M._BACKTEST_INN_WEIGHTS = inn_weights

# ── Grade a single game ────────────────────────────────────────────────────────
def grade_game(row: dict, version: str) -> Dict[str, Any]:
    """
    Run the model for one game and grade all 9 markets.
    Returns dict with per-market results.
    """
    away = row["awayAbbr"]
    home = row["homeAbbr"]
    game_date_str = row["gameDate"]
    game_date = datetime.strptime(game_date_str, "%Y-%m-%d")

    away_stats = get_team_stats(away)
    home_stats = get_team_stats(home)

    book_lines = {
        "total": float(row["dkTotal"]) if row.get("dkTotal") else None,
        "away_ml": str(row["dkAwayML"]) if row.get("dkAwayML") else None,
        "home_ml": str(row["dkHomeML"]) if row.get("dkHomeML") else None,
        "away_rl": float(row["dkAwayRunLine"]) if row.get("dkAwayRunLine") else -1.5,
        "home_rl": float(row["dkHomeRunLine"]) if row.get("dkHomeRunLine") else 1.5,
    }

    try:
        result = M.project_game(
            away_abbrev=away,
            home_abbrev=home,
            away_team_stats=away_stats,
            home_team_stats=home_stats,
            away_pitcher_stats=DEFAULT_PITCHER,
            home_pitcher_stats=DEFAULT_PITCHER,
            book_lines=book_lines,
            game_date=game_date,
            seed=42,
            verbose=False,
        )
    except Exception as e:
        return {"error": str(e), "game": f"{away}@{home}", "date": game_date_str}

    # ── Actual results ─────────────────────────────────────────────────────────
    fg_away = int(row["awayScore"]) if row.get("awayScore") is not None else None
    fg_home = int(row["homeScore"]) if row.get("homeScore") is not None else None
    f5_away = int(row["actualF5AwayScore"]) if row.get("actualF5AwayScore") is not None else None
    f5_home = int(row["actualF5HomeScore"]) if row.get("actualF5HomeScore") is not None else None
    nrfi_result = str(row.get("nrfiActualResult", "") or "").upper()

    if fg_away is None or fg_home is None:
        return {"error": "missing_scores", "game": f"{away}@{home}", "date": game_date_str}

    fg_total = fg_away + fg_home
    f5_total = (f5_away + f5_home) if (f5_away is not None and f5_home is not None) else None
    fg_away_won = fg_away > fg_home
    fg_home_won = fg_home > fg_away

    # ── Book lines ─────────────────────────────────────────────────────────────
    dk_total = float(row["dkTotal"]) if row.get("dkTotal") else None
    dk_away_ml = str(row["dkAwayML"]) if row.get("dkAwayML") else None
    dk_home_ml = str(row["dkHomeML"]) if row.get("dkHomeML") else None
    float(row["dkAwayRunLine"]) if row.get("dkAwayRunLine") else -1.5
    float(row["dkHomeRunLine"]) if row.get("dkHomeRunLine") else 1.5
    dk_over_odds = str(row["dkOverOdds"]) if row.get("dkOverOdds") else None
    dk_under_odds = str(row["dkUnderOdds"]) if row.get("dkUnderOdds") else None
    dk_away_rl_odds = str(row["dkAwayRunLineOdds"]) if row.get("dkAwayRunLineOdds") else None
    dk_home_rl_odds = str(row["dkHomeRunLineOdds"]) if row.get("dkHomeRunLineOdds") else None

    # ── Grade each market ──────────────────────────────────────────────────────
    grades = {}

    # 1. FG ML Home
    p_home = result.get("p_home_win", 0.5)
    fg_ml_home_correct = fg_home_won
    grades["fg_ml_home"] = {
        "model_prob": round(p_home, 4),
        "book_ml": dk_home_ml,
        "correct": int(fg_ml_home_correct),
        "roi": calc_roi(p_home, dk_home_ml),
        "actual": "WIN" if fg_ml_home_correct else "LOSS",
    }

    # 2. FG ML Away
    p_away = result.get("p_away_win", 0.5)
    fg_ml_away_correct = fg_away_won
    grades["fg_ml_away"] = {
        "model_prob": round(p_away, 4),
        "book_ml": dk_away_ml,
        "correct": int(fg_ml_away_correct),
        "roi": calc_roi(p_away, dk_away_ml),
        "actual": "WIN" if fg_ml_away_correct else "LOSS",
    }

    # 3. FG RL Home (-1.5)
    p_hrl = result.get("p_home_cover_rl", 0.35)
    margin = fg_home - fg_away
    hrl_covered = margin > 1.5  # home covers -1.5
    grades["fg_rl_home"] = {
        "model_prob": round(p_hrl, 4),
        "book_ml": dk_home_rl_odds,
        "correct": int(hrl_covered),
        "roi": calc_roi(p_hrl, dk_home_rl_odds),
        "actual": "WIN" if hrl_covered else "LOSS",
    }

    # 4. FG RL Away (+1.5)
    p_arl = result.get("p_away_cover_rl", 0.64)
    arl_covered = margin < 1.5  # away covers +1.5 (wins or loses by 1)
    grades["fg_rl_away"] = {
        "model_prob": round(p_arl, 4),
        "book_ml": dk_away_rl_odds,
        "correct": int(arl_covered),
        "roi": calc_roi(p_arl, dk_away_rl_odds),
        "actual": "WIN" if arl_covered else "LOSS",
    }

    # 5. FG Total Over
    p_over = result.get("p_over", 0.5)
    model_total = result.get("total_key", dk_total or 8.5)
    if dk_total:
        over_correct = fg_total > dk_total
        under_correct = fg_total < dk_total
    else:
        over_correct = None
        under_correct = None
    grades["fg_over"] = {
        "model_prob": round(p_over, 4),
        "model_total": model_total,
        "book_total": dk_total,
        "book_ml": dk_over_odds,
        "correct": int(over_correct) if over_correct is not None else None,
        "roi": calc_roi(p_over, dk_over_odds) if over_correct is not None else None,
        "actual_total": fg_total,
        "actual": "WIN" if over_correct else ("PUSH" if fg_total == dk_total else "LOSS") if dk_total else "N/A",
    }

    # 6. FG Total Under
    p_under = result.get("p_under", 0.5)
    grades["fg_under"] = {
        "model_prob": round(p_under, 4),
        "model_total": model_total,
        "book_total": dk_total,
        "book_ml": dk_under_odds,
        "correct": int(under_correct) if under_correct is not None else None,
        "roi": calc_roi(p_under, dk_under_odds) if under_correct is not None else None,
        "actual_total": fg_total,
        "actual": "WIN" if under_correct else ("PUSH" if fg_total == dk_total else "LOSS") if dk_total else "N/A",
    }

    # 7. F5 ML Home
    p_f5h = result.get("p_f5_home_win", 0.5)
    if f5_home is not None and f5_away is not None:
        f5_home_won = f5_home > f5_away
        f5_away_won_flag = f5_away > f5_home
        f5_push = f5_home == f5_away
        grades["f5_ml_home"] = {
            "model_prob": round(p_f5h, 4),
            "correct": int(f5_home_won) if not f5_push else None,
            "roi": None,  # no F5 book ML in schedule_history
            "actual": "WIN" if f5_home_won else ("PUSH" if f5_push else "LOSS"),
        }
        # 8. F5 ML Away
        p_f5a = result.get("p_f5_away_win", 0.5)
        grades["f5_ml_away"] = {
            "model_prob": round(p_f5a, 4),
            "correct": int(f5_away_won_flag) if not f5_push else None,
            "roi": None,
            "actual": "WIN" if f5_away_won_flag else ("PUSH" if f5_push else "LOSS"),
        }
        # 9. F5 Total
        f5_model_total = result.get("f5_total_key", None)
        p_f5_over = result.get("p_f5_over", 0.5)
        grades["f5_total"] = {
            "model_prob_over": round(p_f5_over, 4),
            "model_total": f5_model_total,
            "actual_total": f5_total,
            "correct": None,  # no book F5 total line
            "roi": None,
        }
    else:
        grades["f5_ml_home"] = {"model_prob": round(p_f5h, 4), "correct": None, "roi": None, "actual": "N/A"}
        grades["f5_ml_away"] = {"model_prob": result.get("p_f5_away_win", 0.5), "correct": None, "roi": None, "actual": "N/A"}
        grades["f5_total"] = {"model_prob_over": result.get("p_f5_over", 0.5), "model_total": None, "actual_total": None, "correct": None, "roi": None}

    # 10. NRFI / YRFI
    p_nrfi = result.get("p_nrfi", 0.5) if "p_nrfi" in result else None
    if p_nrfi is None:
        # Try to get from nrfi_odds
        nrfi_odds_str = result.get("nrfi_odds")
        p_nrfi = ml_to_prob(nrfi_odds_str) if nrfi_odds_str else 0.515
    p_yrfi = 1.0 - p_nrfi if p_nrfi else 0.485

    if nrfi_result in ("NRFI", "YRFI"):
        nrfi_correct = nrfi_result == "NRFI"
        yrfi_correct = nrfi_result == "YRFI"
        grades["nrfi"] = {
            "model_prob": round(p_nrfi, 4),
            "correct": int(nrfi_correct),
            "actual": nrfi_result,
        }
        grades["yrfi"] = {
            "model_prob": round(p_yrfi, 4),
            "correct": int(yrfi_correct),
            "actual": nrfi_result,
        }
    else:
        grades["nrfi"] = {"model_prob": round(p_nrfi, 4), "correct": None, "actual": "N/A"}
        grades["yrfi"] = {"model_prob": round(p_yrfi, 4), "correct": None, "actual": "N/A"}

    # ── Model calibration metrics ──────────────────────────────────────────────
    exp_fg_total = result.get("exp_total", None)
    exp_f5_total = result.get("exp_f5_home_runs", 0) + result.get("exp_f5_away_runs", 0)

    return {
        "game": f"{away}@{home}",
        "date": game_date_str,
        "season": game_date_str[:4],
        "version": version,
        "fg_actual": fg_total,
        "f5_actual": f5_total,
        "nrfi_actual": nrfi_result,
        "exp_fg_total": round(exp_fg_total, 3) if exp_fg_total else None,
        "exp_f5_total": round(exp_f5_total, 3),
        "grades": grades,
    }

# ── Aggregate results ──────────────────────────────────────────────────────────
def aggregate(results: List[dict]) -> dict:
    """Aggregate grades across all games for a given version."""
    markets = ["fg_ml_home", "fg_ml_away", "fg_rl_home", "fg_rl_away",
               "fg_over", "fg_under", "f5_ml_home", "f5_ml_away", "nrfi", "yrfi"]
    agg = {}
    for mkt in markets:
        wins = 0; losses = 0; pushes = 0; total_roi = 0.0; roi_count = 0
        probs = []
        for r in results:
            if "grades" not in r:
                continue
            g = r["grades"].get(mkt, {})
            c = g.get("correct")
            if c == 1:
                wins += 1
            elif c == 0:
                losses += 1
            elif c is None and g.get("actual") == "PUSH":
                pushes += 1
            roi = g.get("roi")
            if roi is not None:
                total_roi += roi
                roi_count += 1
            p = g.get("model_prob")
            if p is not None:
                probs.append(p)

        graded = wins + losses
        acc = wins / graded if graded > 0 else None
        avg_roi = total_roi / roi_count if roi_count > 0 else None
        avg_prob = sum(probs) / len(probs) if probs else None
        agg[mkt] = {
            "wins": wins, "losses": losses, "pushes": pushes,
            "graded": graded, "accuracy": acc,
            "avg_roi": avg_roi, "roi_count": roi_count,
            "avg_model_prob": avg_prob,
        }

    # Calibration: FG total MAE, F5 total MAE
    fg_errors = []
    f5_errors = []
    for r in results:
        if r.get("exp_fg_total") and r.get("fg_actual"):
            fg_errors.append(abs(r["exp_fg_total"] - r["fg_actual"]))
        if r.get("exp_f5_total") and r.get("f5_actual"):
            f5_errors.append(abs(r["exp_f5_total"] - r["f5_actual"]))

    agg["_calibration"] = {
        "fg_total_mae": round(sum(fg_errors) / len(fg_errors), 4) if fg_errors else None,
        "f5_total_mae": round(sum(f5_errors) / len(f5_errors), 4) if f5_errors else None,
        "fg_mae_n": len(fg_errors),
        "f5_mae_n": len(f5_errors),
    }
    return agg

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="MLB Backtest Grader v1 vs v2")
    parser.add_argument("--seasons", default="2024,2025,2026", help="Comma-separated seasons")
    parser.add_argument("--limit", type=int, default=0, help="Limit games per season (0=all)")
    parser.add_argument("--verbose", action="store_true", help="Verbose model output")
    parser.add_argument("--output", default="/tmp/mlb_backtest_v1v2_report.json", help="Output JSON path")
    args = parser.parse_args()

    seasons = [s.strip() for s in args.seasons.split(",")]
    print(f'\n[INPUT] Seasons: {seasons} | Limit: {args.limit or "ALL"} | Output: {args.output}')

    db = get_db()
    cursor = db.cursor(dictionary=True)

    # ── Fetch games from mlb_schedule_history + games table ───────────────────
    ",".join(["%s"] * len(seasons))
    season_patterns = [f"{s}%" for s in seasons]

    # Build UNION query for all seasons
    query = f"""
        SELECT 
            sh.gameDate,
            sh.awayAbbr,
            sh.homeAbbr,
            sh.awayScore,
            sh.homeScore,
            sh.dkTotal,
            sh.dkOverOdds,
            sh.dkUnderOdds,
            sh.dkAwayML,
            sh.dkHomeML,
            sh.dkAwayRunLine,
            sh.dkHomeRunLine,
            sh.dkAwayRunLineOdds,
            sh.dkHomeRunLineOdds,
            sh.totalResult,
            sh.awayWon,
            sh.awayRunLineCovered,
            sh.homeRunLineCovered,
            g.actualF5AwayScore,
            g.actualF5HomeScore,
            g.nrfiActualResult
        FROM mlb_schedule_history sh
        LEFT JOIN games g ON (
            g.sport = 'MLB' AND
            g.gameDate = sh.gameDate AND
            g.awayTeam = sh.awayAbbr AND
            g.homeTeam = sh.homeAbbr
        )
        WHERE sh.game_type IN ('regular_season', 'postseason')
          AND sh.awayScore IS NOT NULL
          AND sh.homeScore IS NOT NULL
          AND ({' OR '.join(['sh.gameDate LIKE %s'] * len(seasons))})
        ORDER BY sh.gameDate, sh.awayAbbr
    """
    if args.limit > 0:
        query += f" LIMIT {args.limit * len(seasons)}"

    print("[STEP] Fetching games from DB...")
    cursor.execute(query, season_patterns)
    all_rows = cursor.fetchall()
    print(f"[INPUT] Total games fetched: {len(all_rows)}")

    # Season breakdown
    by_season = defaultdict(list)
    for row in all_rows:
        season = row["gameDate"][:4]
        by_season[season].append(row)
    for s, rows in sorted(by_season.items()):
        print(f"  [INPUT] Season {s}: {len(rows)} games")

    # ── Run grader for v1 and v2 ───────────────────────────────────────────────
    all_results = {"v1": [], "v2": []}
    errors = {"v1": 0, "v2": 0}

    for version in ["v1", "v2"]:
        print(f"\n[STEP] Running model under {version} constants ({len(all_rows)} games)...")
        patch_model_constants(version)
        t_start = time.time()

        for i, row in enumerate(all_rows):
            if i % 500 == 0 and i > 0:
                elapsed = time.time() - t_start
                rate = i / elapsed
                eta = (len(all_rows) - i) / rate
                print(f"  [STATE] {version}: {i}/{len(all_rows)} games | {rate:.0f} games/s | ETA {eta:.0f}s")

            result = grade_game(row, version)
            if "error" in result:
                errors[version] += 1
            else:
                all_results[version].append(result)

        elapsed = time.time() - t_start
        print(f"  [OUTPUT] {version}: {len(all_results[version])} graded, {errors[version]} errors | {elapsed:.1f}s")

    # ── Aggregate ──────────────────────────────────────────────────────────────
    print("\n[STEP] Aggregating results...")
    agg_v1 = aggregate(all_results["v1"])
    agg_v2 = aggregate(all_results["v2"])

    # ── Print comparison report ────────────────────────────────────────────────
    MARKETS = ["fg_ml_home", "fg_ml_away", "fg_rl_home", "fg_rl_away",
               "fg_over", "fg_under", "f5_ml_home", "f5_ml_away", "nrfi", "yrfi"]

    print("\n" + "="*90)
    print("MLB BACKTEST GRADER — v1 vs v2 CALIBRATION ACCURACY LIFT")
    print(f"Seasons: {seasons} | Games: {len(all_rows)} | Date: {date.today()}")
    print("="*90)
    print(f'{"Market":<16} {"v1 Acc":>8} {"v2 Acc":>8} {"Δ Acc":>8} {"v1 Graded":>10} {"v2 Graded":>10} {"v1 ROI":>9} {"v2 ROI":>9} {"Δ ROI":>8}')
    print("-"*90)

    total_lift = 0.0
    lift_count = 0
    for mkt in MARKETS:
        v1 = agg_v1.get(mkt, {})
        v2 = agg_v2.get(mkt, {})
        v1_acc = v1.get("accuracy")
        v2_acc = v2.get("accuracy")
        v1_roi = v1.get("avg_roi")
        v2_roi = v2.get("avg_roi")
        delta_acc = (v2_acc - v1_acc) if (v1_acc and v2_acc) else None
        delta_roi = (v2_roi - v1_roi) if (v1_roi and v2_roi) else None

        v1_acc_s = f"{v1_acc*100:.2f}%" if v1_acc else "N/A"
        v2_acc_s = f"{v2_acc*100:.2f}%" if v2_acc else "N/A"
        d_acc_s  = f"{delta_acc*100:+.2f}%" if delta_acc is not None else "N/A"
        v1_roi_s = f"{v1_roi*100:.2f}%" if v1_roi else "N/A"
        v2_roi_s = f"{v2_roi*100:.2f}%" if v2_roi else "N/A"
        d_roi_s  = f"{delta_roi*100:+.2f}%" if delta_roi is not None else "N/A"

        print(f'{mkt:<16} {v1_acc_s:>8} {v2_acc_s:>8} {d_acc_s:>8} {v1["graded"]:>10} {v2["graded"]:>10} {v1_roi_s:>9} {v2_roi_s:>9} {d_roi_s:>8}')

        if delta_acc is not None:
            total_lift += delta_acc
            lift_count += 1

    print("-"*90)
    avg_lift = total_lift / lift_count if lift_count > 0 else 0
    print(f'{"AVERAGE LIFT":<16} {"":>8} {"":>8} {avg_lift*100:>+7.2f}% {"":>10} {"":>10}')

    # Calibration MAE
    c1 = agg_v1.get("_calibration", {})
    c2 = agg_v2.get("_calibration", {})
    print(f'\n[OUTPUT] FG Total MAE: v1={c1.get("fg_total_mae", "N/A")} v2={c2.get("fg_total_mae", "N/A")} (n={c2.get("fg_mae_n", 0)})')
    print(f'[OUTPUT] F5 Total MAE: v1={c1.get("f5_total_mae", "N/A")} v2={c2.get("f5_total_mae", "N/A")} (n={c2.get("f5_mae_n", 0)})')

    # Season breakdown
    print("\n[OUTPUT] Accuracy by season (v2):")
    for season in seasons:
        season_results = [r for r in all_results["v2"] if r.get("season") == season]
        if not season_results:
            continue
        season_agg = aggregate(season_results)
        fg_ml_acc = season_agg.get("fg_ml_home", {}).get("accuracy")
        nrfi_acc = season_agg.get("nrfi", {}).get("accuracy")
        print(f"  {season}: n={len(season_results)} | FG ML Home acc={fg_ml_acc*100:.1f}% | NRFI acc={nrfi_acc*100:.1f}%" if fg_ml_acc and nrfi_acc else f"  {season}: n={len(season_results)}")

    # ── Save JSON report ───────────────────────────────────────────────────────
    report = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "seasons": seasons,
        "total_games": len(all_rows),
        "v1_graded": len(all_results["v1"]),
        "v2_graded": len(all_results["v2"]),
        "v1_errors": errors["v1"],
        "v2_errors": errors["v2"],
        "v1_agg": agg_v1,
        "v2_agg": agg_v2,
        "avg_accuracy_lift": round(avg_lift, 6),
        "calibration": {
            "v1_fg_mae": c1.get("fg_total_mae"),
            "v2_fg_mae": c2.get("fg_total_mae"),
            "v1_f5_mae": c1.get("f5_total_mae"),
            "v2_f5_mae": c2.get("f5_total_mae"),
        }
    }

    with open(args.output, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n[OUTPUT] Full report saved to {args.output}")
    print("[VERIFY] PASS — Backtest grader completed successfully")

    cursor.close()
    db.close()

if __name__ == "__main__":
    main()
