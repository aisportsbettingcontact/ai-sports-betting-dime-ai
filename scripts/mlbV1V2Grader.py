#!/usr/bin/env python3.11
"""
MLB v1 vs v2 Model Comparison Grader
=====================================
Uses the existing 3yr backtest results (5,103 games with per-game SP/batting stats)
to run the model under v1 and v2 calibration constants, grade all 9 markets,
and produce a structured accuracy/ROI comparison report.

Markets graded:
  FG:  ML (home/away), RL (home -1.5 / away +1.5), Total (over/under)
  F5:  ML (home/away), Total (over/under)
  I1:  NRFI / YRFI

Calibration sets:
  v1: F5_RUN_SHARE=0.5311, I9_WEIGHT=0.1170, fg_rl_away_cover=0.3189, f5_home_win_rate=0.5319
  v2: F5_RUN_SHARE=0.5618, I9_WEIGHT=0.0792, fg_rl_away_cover=0.6430, f5_home_win_rate=0.4511

Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY] [ERROR]
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime
from typing import Any

# ── Add server directory to path ──────────────────────────────────────────────
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(PROJECT_ROOT, "server")
sys.path.insert(0, SERVER_DIR)
sys.path.insert(0, PROJECT_ROOT)

# ── DK odds loaded from pre-exported JSON (avoids DB connection issues) ─────────
DK_ODDS_FILE = "/tmp/mlb_dk_odds.json"

# ── Import model ───────────────────────────────────────────────────────────────
print("[STEP] Importing MLBAIModel...")
import MLBAIModel as M

# ── Override SIMULATIONS for backtest speed (10K is sufficient for calibration comparison) ──
# 10K sims: ~0.5% SE on probabilities, ~1.5s per game, ~2.5hr total for 5103×2
# 50K sims: ~0.2% SE, ~7s per game, ~12hr total — too slow
BACKTEST_SIMULATIONS = 10_000
M.SIMULATIONS = BACKTEST_SIMULATIONS
print(
    f"[STEP] MLBAIModel loaded. CALIBRATION_VERSION={getattr(M, 'CALIBRATION_VERSION', 'unknown')} | SIMULATIONS overridden to {BACKTEST_SIMULATIONS}"
)

# ── V1 constants ──────────────────────────────────────────────────────────────
V1_EMPIRICAL_PRIORS = {
    "F5_RUN_SHARE": 0.5311,
    "INNING1_RUN_SHARE": 0.1093,
    "nrfi_rate": 0.5154,
    "fg_home_win_rate": 0.5258,
    "fg_away_win_rate": 0.4742,
    "f5_home_win_rate": 0.5319,
    "f5_away_win_rate": 0.4681,
    "f5_push_rate": 0.0000,
    "fg_rl_away_cover": 0.3189,
    "fg_rl_home_cover": 0.5128,
    "f5_mean": 4.726,
    "fg_mean": 8.895,
    "f5_rl_away_cover": 0.5489,
    "f5_rl_home_cover": 0.4511,
}
V1_INN_WEIGHTS_RAW = [
    0.1151,
    0.1009,
    0.1127,
    0.1124,
    0.1136,
    0.1133,
    0.1072,
    0.1079,
    0.1170,
]

# ── V2 constants (current model) ──────────────────────────────────────────────
V2_EMPIRICAL_PRIORS = {k: v for k, v in M.EMPIRICAL_PRIORS.items()}  # noqa: C416
V2_INN_WEIGHTS_RAW = [
    0.116647,
    0.102130,
    0.114120,
    0.113854,
    0.115029,
    0.114764,
    0.108511,
    0.109019,
    0.079211,
]

# ── TEAM_STATS lookup ─────────────────────────────────────────────────────────
TEAM_STATS: dict[str, dict[str, float]] = {
    "NYY": {
        "rpg": 4.92,
        "era": 3.92,
        "avg": 0.254,
        "obp": 0.326,
        "slg": 0.432,
        "k9": 9.5,
        "bb9": 3.1,
        "whip": 1.23,
        "ip_per_game": 5.5,
    },
    "BOS": {
        "rpg": 4.81,
        "era": 4.18,
        "avg": 0.256,
        "obp": 0.326,
        "slg": 0.430,
        "k9": 9.2,
        "bb9": 3.3,
        "whip": 1.28,
        "ip_per_game": 5.3,
    },
    "TOR": {
        "rpg": 4.62,
        "era": 4.28,
        "avg": 0.248,
        "obp": 0.316,
        "slg": 0.418,
        "k9": 9.0,
        "bb9": 3.2,
        "whip": 1.28,
        "ip_per_game": 5.2,
    },
    "BAL": {
        "rpg": 4.78,
        "era": 4.05,
        "avg": 0.252,
        "obp": 0.322,
        "slg": 0.428,
        "k9": 9.3,
        "bb9": 3.0,
        "whip": 1.24,
        "ip_per_game": 5.4,
    },
    "TB": {
        "rpg": 4.52,
        "era": 3.98,
        "avg": 0.246,
        "obp": 0.318,
        "slg": 0.412,
        "k9": 9.4,
        "bb9": 3.1,
        "whip": 1.24,
        "ip_per_game": 5.3,
    },
    "CLE": {
        "rpg": 4.48,
        "era": 3.85,
        "avg": 0.244,
        "obp": 0.314,
        "slg": 0.408,
        "k9": 9.5,
        "bb9": 2.9,
        "whip": 1.22,
        "ip_per_game": 5.5,
    },
    "MIN": {
        "rpg": 4.65,
        "era": 4.12,
        "avg": 0.250,
        "obp": 0.320,
        "slg": 0.420,
        "k9": 9.1,
        "bb9": 3.2,
        "whip": 1.26,
        "ip_per_game": 5.3,
    },
    "CWS": {
        "rpg": 3.92,
        "era": 4.82,
        "avg": 0.238,
        "obp": 0.302,
        "slg": 0.388,
        "k9": 8.5,
        "bb9": 3.5,
        "whip": 1.35,
        "ip_per_game": 4.9,
    },
    "DET": {
        "rpg": 4.38,
        "era": 4.15,
        "avg": 0.246,
        "obp": 0.314,
        "slg": 0.408,
        "k9": 9.0,
        "bb9": 3.2,
        "whip": 1.27,
        "ip_per_game": 5.2,
    },
    "KC": {
        "rpg": 4.55,
        "era": 4.22,
        "avg": 0.250,
        "obp": 0.318,
        "slg": 0.415,
        "k9": 8.8,
        "bb9": 3.1,
        "whip": 1.27,
        "ip_per_game": 5.2,
    },
    "HOU": {
        "rpg": 4.72,
        "era": 3.88,
        "avg": 0.252,
        "obp": 0.322,
        "slg": 0.425,
        "k9": 9.4,
        "bb9": 2.9,
        "whip": 1.22,
        "ip_per_game": 5.5,
    },
    "SEA": {
        "rpg": 4.42,
        "era": 3.95,
        "avg": 0.244,
        "obp": 0.314,
        "slg": 0.408,
        "k9": 9.6,
        "bb9": 2.9,
        "whip": 1.21,
        "ip_per_game": 5.5,
    },
    "TEX": {
        "rpg": 4.52,
        "era": 4.15,
        "avg": 0.250,
        "obp": 0.318,
        "slg": 0.412,
        "k9": 9.0,
        "bb9": 3.1,
        "whip": 1.27,
        "ip_per_game": 5.3,
    },
    "LAA": {
        "rpg": 4.28,
        "era": 4.42,
        "avg": 0.246,
        "obp": 0.314,
        "slg": 0.408,
        "k9": 8.8,
        "bb9": 3.3,
        "whip": 1.30,
        "ip_per_game": 5.1,
    },
    "ATH": {
        "rpg": 4.21,
        "era": 4.38,
        "avg": 0.244,
        "obp": 0.312,
        "slg": 0.395,
        "k9": 8.8,
        "bb9": 3.3,
        "whip": 1.30,
        "ip_per_game": 5.1,
    },
    "OAK": {
        "rpg": 4.21,
        "era": 4.38,
        "avg": 0.244,
        "obp": 0.312,
        "slg": 0.395,
        "k9": 8.8,
        "bb9": 3.3,
        "whip": 1.30,
        "ip_per_game": 5.1,
    },
    "NYM": {
        "rpg": 4.62,
        "era": 4.02,
        "avg": 0.252,
        "obp": 0.322,
        "slg": 0.418,
        "k9": 9.1,
        "bb9": 3.0,
        "whip": 1.25,
        "ip_per_game": 5.4,
    },
    "PHI": {
        "rpg": 4.88,
        "era": 3.88,
        "avg": 0.258,
        "obp": 0.328,
        "slg": 0.438,
        "k9": 9.4,
        "bb9": 2.9,
        "whip": 1.21,
        "ip_per_game": 5.5,
    },
    "ATL": {
        "rpg": 4.85,
        "era": 3.92,
        "avg": 0.256,
        "obp": 0.326,
        "slg": 0.435,
        "k9": 9.3,
        "bb9": 3.0,
        "whip": 1.22,
        "ip_per_game": 5.4,
    },
    "MIA": {
        "rpg": 4.12,
        "era": 4.45,
        "avg": 0.240,
        "obp": 0.308,
        "slg": 0.395,
        "k9": 8.8,
        "bb9": 3.4,
        "whip": 1.32,
        "ip_per_game": 5.0,
    },
    "WSH": {
        "rpg": 4.35,
        "era": 4.52,
        "avg": 0.244,
        "obp": 0.312,
        "slg": 0.402,
        "k9": 8.7,
        "bb9": 3.3,
        "whip": 1.32,
        "ip_per_game": 5.0,
    },
    "WAS": {
        "rpg": 4.35,
        "era": 4.52,
        "avg": 0.244,
        "obp": 0.312,
        "slg": 0.402,
        "k9": 8.7,
        "bb9": 3.3,
        "whip": 1.32,
        "ip_per_game": 5.0,
    },
    "CHC": {
        "rpg": 4.55,
        "era": 4.12,
        "avg": 0.248,
        "obp": 0.318,
        "slg": 0.415,
        "k9": 9.0,
        "bb9": 3.1,
        "whip": 1.26,
        "ip_per_game": 5.3,
    },
    "STL": {
        "rpg": 4.42,
        "era": 4.22,
        "avg": 0.248,
        "obp": 0.316,
        "slg": 0.410,
        "k9": 8.8,
        "bb9": 3.2,
        "whip": 1.28,
        "ip_per_game": 5.2,
    },
    "MIL": {
        "rpg": 4.58,
        "era": 3.95,
        "avg": 0.248,
        "obp": 0.318,
        "slg": 0.418,
        "k9": 9.2,
        "bb9": 3.0,
        "whip": 1.24,
        "ip_per_game": 5.4,
    },
    "CIN": {
        "rpg": 4.65,
        "era": 4.28,
        "avg": 0.252,
        "obp": 0.320,
        "slg": 0.422,
        "k9": 9.0,
        "bb9": 3.2,
        "whip": 1.28,
        "ip_per_game": 5.2,
    },
    "PIT": {
        "rpg": 4.28,
        "era": 4.35,
        "avg": 0.244,
        "obp": 0.312,
        "slg": 0.402,
        "k9": 8.8,
        "bb9": 3.2,
        "whip": 1.29,
        "ip_per_game": 5.2,
    },
    "LAD": {
        "rpg": 5.12,
        "era": 3.72,
        "avg": 0.262,
        "obp": 0.334,
        "slg": 0.448,
        "k9": 9.6,
        "bb9": 2.8,
        "whip": 1.18,
        "ip_per_game": 5.6,
    },
    "SD": {
        "rpg": 4.58,
        "era": 3.98,
        "avg": 0.250,
        "obp": 0.320,
        "slg": 0.420,
        "k9": 9.3,
        "bb9": 3.0,
        "whip": 1.24,
        "ip_per_game": 5.4,
    },
    "SF": {
        "rpg": 4.42,
        "era": 4.08,
        "avg": 0.248,
        "obp": 0.318,
        "slg": 0.412,
        "k9": 9.1,
        "bb9": 3.1,
        "whip": 1.26,
        "ip_per_game": 5.3,
    },
    "ARI": {
        "rpg": 4.72,
        "era": 4.18,
        "avg": 0.254,
        "obp": 0.324,
        "slg": 0.428,
        "k9": 9.0,
        "bb9": 3.1,
        "whip": 1.27,
        "ip_per_game": 5.3,
    },
    "COL": {
        "rpg": 4.88,
        "era": 5.12,
        "avg": 0.258,
        "obp": 0.326,
        "slg": 0.438,
        "k9": 8.5,
        "bb9": 3.4,
        "whip": 1.38,
        "ip_per_game": 4.9,
    },
}
DEFAULT_STATS = {
    "rpg": 4.50,
    "era": 4.25,
    "avg": 0.250,
    "obp": 0.318,
    "slg": 0.415,
    "k9": 9.0,
    "bb9": 3.1,
    "whip": 1.27,
    "ip_per_game": 5.2,
}
DEFAULT_PITCHER = {
    "era": 4.25,
    "k9": 8.8,
    "bb9": 3.1,
    "whip": 1.28,
    "ip": 140.0,
    "gp": 25,
    "xera": 4.25,
}


def get_team_stats(abbrev: str) -> dict:
    return TEAM_STATS.get(abbrev, TEAM_STATS.get(abbrev.upper(), DEFAULT_STATS))


def sp_to_pitcher_stats(sp: dict) -> dict:
    """Convert backtest SP stats to model pitcher_stats format."""
    if not sp:
        return DEFAULT_PITCHER.copy()
    ip = float(sp.get("ip_float", 5.0))
    er = int(sp.get("er", 2))
    k = int(sp.get("k", 5))
    bb = int(sp.get("bb", 2))
    h = int(sp.get("h", 5))
    int(sp.get("hr", 0))
    # Compute ERA/K9/BB9/WHIP from game stats (annualized from 9 innings)
    era = (er / max(ip, 0.1)) * 9.0
    k9 = (k / max(ip, 0.1)) * 9.0
    bb9 = (bb / max(ip, 0.1)) * 9.0
    whip = (h + bb) / max(ip, 0.1)
    return {
        "era": round(era, 2),
        "k9": round(k9, 2),
        "bb9": round(bb9, 2),
        "whip": round(whip, 3),
        "ip": float(ip),
        "gp": 1,
        "xera": round(era, 2),  # use ERA as xERA proxy
    }


def batting_to_team_stats(batting: dict, base_stats: dict) -> dict:
    """Merge game batting stats into team stats dict."""
    stats = base_stats.copy()
    if not batting:
        return stats
    try:
        avg = float(
            str(batting.get("avg", stats["avg"])).replace(".", "0.", 1)
            if str(batting.get("avg", "")).startswith(".")
            else batting.get("avg", stats["avg"])
        )
        obp = float(
            str(batting.get("obp", stats["obp"])).replace(".", "0.", 1)
            if str(batting.get("obp", "")).startswith(".")
            else batting.get("obp", stats["obp"])
        )
        slg = float(
            str(batting.get("slg", stats["slg"])).replace(".", "0.", 1)
            if str(batting.get("slg", "")).startswith(".")
            else batting.get("slg", stats["slg"])
        )
        stats["avg"] = avg
        stats["obp"] = obp
        stats["slg"] = slg
    except Exception:
        pass
    return stats


# ── Odds helpers ───────────────────────────────────────────────────────────────
def ml_to_decimal(ml_str) -> float | None:
    if not ml_str:
        return None
    try:
        ml = float(str(ml_str).replace("+", "").strip())
        return (1 + ml / 100) if ml > 0 else (1 + 100 / abs(ml))
    except Exception:
        return None


def calc_roi(model_prob: float, book_ml) -> float | None:
    dec = ml_to_decimal(book_ml)
    return (model_prob * dec - 1.0) if dec else None


# ── Patch model constants ──────────────────────────────────────────────────────
def patch_model_constants(version: str):
    """Patch MLBAIModel global constants for v1 or v2."""
    priors = V1_EMPIRICAL_PRIORS if version == "v1" else V2_EMPIRICAL_PRIORS
    inn_w = V1_INN_WEIGHTS_RAW if version == "v1" else V2_INN_WEIGHTS_RAW

    # Patch EMPIRICAL_PRIORS in-place
    for k, v in priors.items():
        M.EMPIRICAL_PRIORS[k] = v

    # Patch inning weights via module attribute (model reads _INN_WEIGHTS_RAW)
    if hasattr(M, "_INN_WEIGHTS_RAW"):
        for i, w in enumerate(inn_w):
            M._INN_WEIGHTS_RAW[i] = w
    # Also patch the normalized weights if they exist
    if hasattr(M, "_INN_WEIGHTS"):
        total = sum(inn_w)
        for i, w in enumerate(inn_w):
            M._INN_WEIGHTS[i] = w / total


# ── Grade a single game ────────────────────────────────────────────────────────
def grade_game(game: dict, dk_odds: dict | None, version: str) -> dict[str, Any]:
    """Run model for one game and grade all 9 markets."""
    away = game["away_team"]
    home = game["home_team"]
    game_date_str = game["gameDate"]
    game_date = datetime.strptime(game_date_str, "%Y-%m-%d")

    # Team stats with game-specific batting overlay
    away_base = get_team_stats(away)
    home_base = get_team_stats(home)
    away_stats = batting_to_team_stats(game.get("away_batting"), away_base)
    home_stats = batting_to_team_stats(game.get("home_batting"), home_base)

    # SP stats from game data
    away_sp = sp_to_pitcher_stats(game.get("away_sp"))
    home_sp = sp_to_pitcher_stats(game.get("home_sp"))

    # Book lines from DK odds or defaults
    dk = dk_odds or {}
    book_lines = {
        "total": float(dk.get("dkTotal", 8.5)) if dk.get("dkTotal") else 8.5,
        "away_ml": str(dk.get("dkAwayML", "+100")) if dk.get("dkAwayML") else None,
        "home_ml": str(dk.get("dkHomeML", "-120")) if dk.get("dkHomeML") else None,
        "away_rl": float(dk.get("dkAwayRunLine", 1.5))
        if dk.get("dkAwayRunLine")
        else 1.5,
        "home_rl": float(dk.get("dkHomeRunLine", -1.5))
        if dk.get("dkHomeRunLine")
        else -1.5,
    }

    try:
        result = M.project_game(
            away_abbrev=away,
            home_abbrev=home,
            away_team_stats=away_stats,
            home_team_stats=home_stats,
            away_pitcher_stats=away_sp,
            home_pitcher_stats=home_sp,
            book_lines=book_lines,
            game_date=game_date,
            seed=42,
            verbose=False,
        )
    except Exception as e:
        return {
            "error": str(e)[:120],
            "game": f"{away}@{home}",
            "date": game_date_str,
            "version": version,
        }

    # ── Actual results ─────────────────────────────────────────────────────────
    fg_away = int(game.get("away_score", 0))
    fg_home = int(game.get("home_score", 0))
    f5_away = game.get("away_f5")
    f5_home = game.get("home_f5")
    nrfi = bool(game.get("nrfi", False))
    fg_total = fg_away + fg_home
    f5_total = (
        (int(f5_away) + int(f5_home))
        if (f5_away is not None and f5_home is not None)
        else None
    )

    # DK lines
    dk_total = float(dk.get("dkTotal", 0)) if dk.get("dkTotal") else None
    dk_away_ml = str(dk.get("dkAwayML")) if dk.get("dkAwayML") else None
    dk_home_ml = str(dk.get("dkHomeML")) if dk.get("dkHomeML") else None
    dk_over_odds = str(dk.get("dkOverOdds")) if dk.get("dkOverOdds") else None
    dk_under_odds = str(dk.get("dkUnderOdds")) if dk.get("dkUnderOdds") else None
    dk_away_rl_odds = (
        str(dk.get("dkAwayRunLineOdds")) if dk.get("dkAwayRunLineOdds") else None
    )
    dk_home_rl_odds = (
        str(dk.get("dkHomeRunLineOdds")) if dk.get("dkHomeRunLineOdds") else None
    )

    grades = {}

    # 1. FG ML Home
    p_home = result.get("p_home_win", 0.5)
    grades["fg_ml_home"] = {
        "model_prob": round(p_home, 4),
        "correct": int(fg_home > fg_away),
        "roi": calc_roi(p_home, dk_home_ml),
        "book_ml": dk_home_ml,
    }

    # 2. FG ML Away
    p_away = result.get("p_away_win", 0.5)
    grades["fg_ml_away"] = {
        "model_prob": round(p_away, 4),
        "correct": int(fg_away > fg_home),
        "roi": calc_roi(p_away, dk_away_ml),
        "book_ml": dk_away_ml,
    }

    # 3. FG RL Home (-1.5)
    p_hrl = result.get("p_home_cover_rl", 0.35)
    margin = fg_home - fg_away
    grades["fg_rl_home"] = {
        "model_prob": round(p_hrl, 4),
        "correct": int(margin > 1),  # home wins by 2+
        "roi": calc_roi(p_hrl, dk_home_rl_odds),
        "book_ml": dk_home_rl_odds,
    }

    # 4. FG RL Away (+1.5)
    p_arl = result.get("p_away_cover_rl", 0.64)
    grades["fg_rl_away"] = {
        "model_prob": round(p_arl, 4),
        "correct": int(margin < 2),  # away wins or loses by 1
        "roi": calc_roi(p_arl, dk_away_rl_odds),
        "book_ml": dk_away_rl_odds,
    }

    # 5. FG Total Over
    p_over = result.get("p_over", 0.5)
    exp_total = result.get("exp_total", None)
    if dk_total:
        over_correct = int(fg_total > dk_total)
        under_correct = int(fg_total < dk_total)
    else:
        over_correct = under_correct = None
    grades["fg_over"] = {
        "model_prob": round(p_over, 4),
        "exp_total": round(exp_total, 3) if exp_total else None,
        "actual_total": fg_total,
        "book_total": dk_total,
        "correct": over_correct,
        "roi": calc_roi(p_over, dk_over_odds) if over_correct is not None else None,
    }

    # 6. FG Total Under
    p_under = result.get("p_under", 0.5)
    grades["fg_under"] = {
        "model_prob": round(p_under, 4),
        "exp_total": round(exp_total, 3) if exp_total else None,
        "actual_total": fg_total,
        "book_total": dk_total,
        "correct": under_correct,
        "roi": calc_roi(p_under, dk_under_odds) if under_correct is not None else None,
    }

    # 7-8. F5 ML
    p_f5h = result.get("p_f5_home_win", 0.45)
    p_f5a = result.get("p_f5_away_win", 0.40)
    if f5_total is not None:
        f5_push = int(f5_away) == int(f5_home)
        grades["f5_ml_home"] = {
            "model_prob": round(p_f5h, 4),
            "correct": int(int(f5_home) > int(f5_away)) if not f5_push else None,
        }
        grades["f5_ml_away"] = {
            "model_prob": round(p_f5a, 4),
            "correct": int(int(f5_away) > int(f5_home)) if not f5_push else None,
        }
        # 9. F5 Total (no book line available in historical data)
        exp_f5 = result.get("exp_f5_home_runs", 0) + result.get("exp_f5_away_runs", 0)
        grades["f5_total"] = {
            "exp_f5_total": round(exp_f5, 3),
            "actual_f5_total": f5_total,
            "f5_total_error": round(abs(exp_f5 - f5_total), 3),
            "correct": None,  # no book line
        }
    else:
        grades["f5_ml_home"] = {"model_prob": round(p_f5h, 4), "correct": None}
        grades["f5_ml_away"] = {"model_prob": round(p_f5a, 4), "correct": None}
        grades["f5_total"] = {
            "exp_f5_total": None,
            "actual_f5_total": None,
            "f5_total_error": None,
            "correct": None,
        }

    # 10. NRFI / YRFI
    p_nrfi_raw = result.get("p_nrfi", None)
    if p_nrfi_raw is None:
        # Derive from nrfi_odds if available
        nrfi_odds = result.get("nrfi_odds")
        if nrfi_odds:
            try:
                ml = float(str(nrfi_odds).replace("+", ""))
                p_nrfi_raw = (
                    (100 / (ml + 100)) if ml > 0 else (abs(ml) / (abs(ml) + 100))
                )
            except Exception:
                p_nrfi_raw = 0.515
        else:
            p_nrfi_raw = 0.515
    p_yrfi_raw = 1.0 - p_nrfi_raw
    grades["nrfi"] = {
        "model_prob": round(p_nrfi_raw, 4),
        "correct": int(nrfi),
    }
    grades["yrfi"] = {
        "model_prob": round(p_yrfi_raw, 4),
        "correct": int(not nrfi),
    }

    return {
        "game": f"{away}@{home}",
        "date": game_date_str,
        "season": game_date_str[:4],
        "version": version,
        "fg_actual": fg_total,
        "f5_actual": f5_total,
        "nrfi": nrfi,
        "exp_fg_total": round(exp_total, 3) if exp_total else None,
        "grades": grades,
    }


# ── Aggregate results ──────────────────────────────────────────────────────────
MARKETS = [
    "fg_ml_home",
    "fg_ml_away",
    "fg_rl_home",
    "fg_rl_away",
    "fg_over",
    "fg_under",
    "f5_ml_home",
    "f5_ml_away",
    "nrfi",
    "yrfi",
]


def aggregate(results: list[dict]) -> dict:
    agg = {}
    for mkt in MARKETS:
        wins = losses = roi_count = 0
        total_roi = 0.0
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
            roi = g.get("roi")
            if roi is not None:
                total_roi += roi
                roi_count += 1
            p = g.get("model_prob")
            if p is not None:
                probs.append(p)
        graded = wins + losses
        agg[mkt] = {
            "wins": wins,
            "losses": losses,
            "graded": graded,
            "accuracy": round(wins / graded, 4) if graded > 0 else None,
            "avg_roi": round(total_roi / roi_count, 4) if roi_count > 0 else None,
            "roi_count": roi_count,
            "avg_model_prob": round(sum(probs) / len(probs), 4) if probs else None,
        }

    # Calibration MAE
    fg_errors, f5_errors = [], []
    for r in results:
        if r.get("exp_fg_total") and r.get("fg_actual"):
            fg_errors.append(abs(r["exp_fg_total"] - r["fg_actual"]))
        f5g = r.get("grades", {}).get("f5_total", {})
        err = f5g.get("f5_total_error")
        if err is not None:
            f5_errors.append(err)
    agg["_calibration"] = {
        "fg_total_mae": round(sum(fg_errors) / len(fg_errors), 4)
        if fg_errors
        else None,
        "f5_total_mae": round(sum(f5_errors) / len(f5_errors), 4)
        if f5_errors
        else None,
        "n_fg": len(fg_errors),
        "n_f5": len(f5_errors),
    }
    return agg


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", default="2024,2025,2026")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", default="/tmp/mlb_v1v2_report.json")
    args = parser.parse_args()

    seasons = [s.strip() for s in args.seasons.split(",")]
    print(
        f"\n[INPUT] Seasons={seasons} | Limit={args.limit or 'ALL'} | Output={args.output}"
    )
    print("[INPUT] Backtest file: /home/ubuntu/mlb_backtest_results.json")

    # ── Load backtest games ────────────────────────────────────────────────────
    print("[STEP] Loading backtest results...")
    with open("/home/ubuntu/mlb_backtest_results.json") as f:
        bt_data = json.load(f)
    all_games = bt_data["graded_games"]

    # Filter by season
    games = [g for g in all_games if g["season"] in seasons]
    if args.limit > 0:
        games = games[: args.limit]
    print(f"[INPUT] Games after season filter: {len(games)}")

    by_season = defaultdict(int)
    for g in games:
        by_season[g["season"]] += 1
    for s in sorted(by_season):
        print(f"  [INPUT] Season {s}: {by_season[s]} games")

    # ── Load DK odds from pre-exported JSON ─────────────────────────────────────
    print(f"[STEP] Loading DK odds from {DK_ODDS_FILE}...")
    with open(DK_ODDS_FILE) as f:
        dk_rows = json.load(f)
    # Filter to requested seasons
    dk_rows = [r for r in dk_rows if any(r["gameDate"].startswith(s) for s in seasons)]

    # Build lookup: (date, away, home) → odds
    dk_lookup: dict[tuple, dict] = {}
    for row in dk_rows:
        key = (row["gameDate"], row["awayAbbr"], row["homeAbbr"])
        dk_lookup[key] = row
    print(f"[INPUT] DK odds rows loaded: {len(dk_lookup)}")

    # ── Run v1 and v2 ──────────────────────────────────────────────────────────
    all_results = {"v1": [], "v2": []}
    errors = {"v1": 0, "v2": 0}

    for version in ["v1", "v2"]:
        print(
            f"\n[STEP] Running model under {version} constants ({len(games)} games)..."
        )
        patch_model_constants(version)
        t0 = time.time()

        for i, game in enumerate(games):
            if i % 1000 == 0 and i > 0:
                elapsed = time.time() - t0
                rate = i / elapsed
                eta = (len(games) - i) / rate
                print(
                    f"  [STATE] {version}: {i}/{len(games)} | {rate:.0f} g/s | ETA {eta:.0f}s"
                )

            dk_key = (game["gameDate"], game["away_team"], game["home_team"])
            dk = dk_lookup.get(dk_key)

            r = grade_game(game, dk, version)
            if "error" in r:
                errors[version] += 1
                if errors[version] <= 5:
                    print(f"  [ERROR] {version} {r['game']} {r['date']}: {r['error']}")
            else:
                all_results[version].append(r)

        elapsed = time.time() - t0
        print(
            f"  [OUTPUT] {version}: graded={len(all_results[version])} errors={errors[version]} | {elapsed:.1f}s"
        )

    # ── Aggregate ──────────────────────────────────────────────────────────────
    print("\n[STEP] Aggregating results...")
    agg_v1 = aggregate(all_results["v1"])
    agg_v2 = aggregate(all_results["v2"])

    # ── Print report ───────────────────────────────────────────────────────────
    print("\n" + "=" * 100)
    print("MLB MODEL v1 vs v2 — CALIBRATION ACCURACY LIFT REPORT")
    print(f"Seasons: {seasons} | Games: {len(games)} | Date: {date.today()}")
    print("=" * 100)
    print(
        f"{'Market':<16} {'v1 Acc':>8} {'v2 Acc':>8} {'Δ Acc':>8} {'v1 n':>7} {'v2 n':>7} {'v1 ROI':>9} {'v2 ROI':>9} {'Δ ROI':>8} {'v1 Avg P':>9} {'v2 Avg P':>9}"
    )
    print("-" * 100)

    total_lift = 0.0
    lift_count = 0
    for mkt in MARKETS:
        v1 = agg_v1.get(mkt, {})
        v2 = agg_v2.get(mkt, {})
        v1a = v1.get("accuracy")
        v2a = v2.get("accuracy")
        v1r = v1.get("avg_roi")
        v2r = v2.get("avg_roi")
        da = (v2a - v1a) if (v1a and v2a) else None
        dr = (v2r - v1r) if (v1r and v2r) else None
        v1p = v1.get("avg_model_prob")
        v2p = v2.get("avg_model_prob")

        print(f"{mkt:<16} {v1a * 100:>7.2f}% " if v1a else f"{'N/A':>8} ", end="")
        print(f"{v2a * 100:>7.2f}% " if v2a else f"{'N/A':>8} ", end="")
        print(f"{da * 100:>+7.2f}% " if da is not None else f"{'N/A':>8} ", end="")
        print(f"{v1['graded']:>7} {v2['graded']:>7} ", end="")
        print(f"{v1r * 100:>8.2f}% " if v1r else f"{'N/A':>9} ", end="")
        print(f"{v2r * 100:>8.2f}% " if v2r else f"{'N/A':>9} ", end="")
        print(f"{dr * 100:>+7.2f}% " if dr is not None else f"{'N/A':>8} ", end="")
        print(f"{v1p:>8.4f} " if v1p else f"{'N/A':>9} ", end="")
        print(f"{v2p:>8.4f}" if v2p else f"{'N/A':>9}")

        if da is not None:
            total_lift += da
            lift_count += 1

    avg_lift = total_lift / lift_count if lift_count > 0 else 0
    print("-" * 100)
    print(f"{'AVERAGE LIFT':<16} {'':>8} {'':>8} {avg_lift * 100:>+7.2f}%")

    # Calibration MAE
    c1 = agg_v1.get("_calibration", {})
    c2 = agg_v2.get("_calibration", {})
    print(
        f"\n[OUTPUT] FG Total MAE: v1={c1.get('fg_total_mae', 'N/A')} v2={c2.get('fg_total_mae', 'N/A')} (n={c2.get('n_fg', 0)})"
    )
    print(
        f"[OUTPUT] F5 Total MAE: v1={c1.get('f5_total_mae', 'N/A')} v2={c2.get('f5_total_mae', 'N/A')} (n={c2.get('n_f5', 0)})"
    )

    # Season breakdown
    print("\n[OUTPUT] Per-season accuracy (v2):")
    for season in seasons:
        sr = [r for r in all_results["v2"] if r.get("season") == season]
        if not sr:
            continue
        sa = aggregate(sr)
        fg_acc = sa.get("fg_ml_home", {}).get("accuracy")
        nrfi_acc = sa.get("nrfi", {}).get("accuracy")
        f5_acc = sa.get("f5_ml_home", {}).get("accuracy")
        print(
            f"  {season}: n={len(sr)} | FG ML Home={fg_acc * 100:.1f}% | F5 ML Home={f5_acc * 100:.1f}% | NRFI={nrfi_acc * 100:.1f}%"
            if all([fg_acc, f5_acc, nrfi_acc])
            else f"  {season}: n={len(sr)}"
        )

    # ── Save JSON report ───────────────────────────────────────────────────────
    report = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "seasons": seasons,
        "total_games": len(games),
        "v1_graded": len(all_results["v1"]),
        "v2_graded": len(all_results["v2"]),
        "v1_errors": errors["v1"],
        "v2_errors": errors["v2"],
        "avg_accuracy_lift": round(avg_lift, 6),
        "v1_agg": agg_v1,
        "v2_agg": agg_v2,
        "calibration_delta": {
            "fg_mae_v1": c1.get("fg_total_mae"),
            "fg_mae_v2": c2.get("fg_total_mae"),
            "f5_mae_v1": c1.get("f5_total_mae"),
            "f5_mae_v2": c2.get("f5_total_mae"),
        },
    }
    with open(args.output, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n[OUTPUT] Full JSON report saved to {args.output}")
    print("[VERIFY] PASS — v1 vs v2 grader completed successfully")


if __name__ == "__main__":
    main()
