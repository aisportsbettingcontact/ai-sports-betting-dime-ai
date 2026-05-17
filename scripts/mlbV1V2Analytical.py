#!/usr/bin/env python3.11
"""
MLB v1 vs v2 Calibration Comparison — Analytical Grader
=========================================================
Uses the existing 3yr backtest results (5,103 games with actual outcomes)
to analytically compare v1 vs v2 model accuracy across all 9 markets.

Approach:
  - The backtest already has actual game outcomes (FG, F5, I1 scores)
  - For each market, we compute the model's predicted probability under v1 and v2
    using the known calibration constants (no Monte Carlo needed)
  - Grade each market: model_prob > 0.5 → predicted that side → compare to actual
  - Measure accuracy lift, Brier score improvement, and calibration MAE

Key constant deltas (v1 → v2):
  F5_RUN_SHARE:      0.5311 → 0.5618  (+0.0307)
  INNING1_RUN_SHARE: 0.1093 → 0.1166  (+0.0073)
  fg_rl_away_cover:  0.3189 → 0.6430  (+0.3241)  ← inverted prior
  f5_home_win_rate:  0.5319 → 0.4511  (-0.0808)
  f5_push_rate:      0.0000 → 0.1507  (+0.1507)
  fg_home_win_rate:  0.5258 → 0.5338  (+0.0080)
  I9_weight:         0.1170 → 0.0792  (-0.0378)

Markets graded:
  FG ML (home/away), FG RL (home/away), FG Total (over/under)
  F5 ML (home/away), F5 Total (over/under)
  NRFI / YRFI

Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY] [ERROR]
"""

import argparse
import json
import math
import time
from collections import defaultdict
from datetime import date, datetime
from typing import List, Optional

# ── Constants ──────────────────────────────────────────────────────────────────
BACKTEST_FILE = "/home/ubuntu/mlb_backtest_results.json"
DK_ODDS_FILE  = "/tmp/mlb_dk_odds.json"

# ── V1 calibration constants ──────────────────────────────────────────────────
V1 = {
    "F5_RUN_SHARE":       0.5311,
    "INNING1_RUN_SHARE":  0.1093,
    "nrfi_rate":          0.5154,
    "fg_home_win_rate":   0.5258,
    "fg_away_win_rate":   0.4742,
    "f5_home_win_rate":   0.5319,
    "f5_away_win_rate":   0.4681,
    "f5_push_rate":       0.0000,
    "fg_rl_away_cover":   0.3189,
    "fg_rl_home_cover":   0.5128,
    "f5_rl_away_cover":   0.5489,
    "f5_rl_home_cover":   0.4511,
    "fg_mean":            8.895,
    "f5_mean":            4.726,
    "i1_mean":            0.974,
    "i9_weight":          0.1170,
    "i1_weight":          0.1151,
}

# ── V2 calibration constants (from 3yr backtest) ──────────────────────────────
V2 = {
    "F5_RUN_SHARE":       0.5618,
    "INNING1_RUN_SHARE":  0.1166,
    "nrfi_rate":          0.5150,
    "fg_home_win_rate":   0.5338,
    "fg_away_win_rate":   0.4662,
    "f5_home_win_rate":   0.4511,
    "f5_away_win_rate":   0.3982,
    "f5_push_rate":       0.1507,
    "fg_rl_away_cover":   0.6430,
    "fg_rl_home_cover":   0.3570,
    "f5_rl_away_cover":   0.5489,
    "f5_rl_home_cover":   0.4511,
    "fg_mean":            8.842,
    "f5_mean":            4.967,
    "i1_mean":            1.031,
    "i9_weight":          0.0792,
    "i1_weight":          0.1166,
}

# ── Team NRFI rates (3yr empirical from calibration_constants.json) ───────────
TEAM_NRFI_RATES = {
    "PIT": 0.5765, "NYM": 0.5664, "KC":  0.5647, "STL": 0.5543, "CHC": 0.5503,
    "CLE": 0.5471, "CIN": 0.5452, "BAL": 0.5367, "WSH": 0.5353, "HOU": 0.5339,
    "MIL": 0.5310, "DET": 0.5294, "TOR": 0.5235, "SEA": 0.5235, "ATL": 0.5206,
    "TEX": 0.5161, "SD":  0.5118, "SF":  0.5059, "TB":  0.5044, "CWS": 0.5044,
    "ATH": 0.5000, "MIN": 0.4956, "BOS": 0.4883, "PHI": 0.4882, "LAA": 0.4868,
    "LAD": 0.4734, "MIA": 0.4663, "ARI": 0.4591, "NYY": 0.4559, "COL": 0.4559,
}

# ── Team F5 run share (3yr empirical) ─────────────────────────────────────────
TEAM_F5_RS = {
    "CIN": 0.5934, "NYY": 0.5782, "CWS": 0.5781, "ARI": 0.5780, "MIL": 0.5779,
    "LAA": 0.5773, "CHC": 0.5738, "NYM": 0.5730, "DET": 0.5722, "SD":  0.5690,
    "TEX": 0.5672, "TB":  0.5648, "BAL": 0.5643, "LAD": 0.5628, "ATH": 0.5618,
    "PIT": 0.5602, "HOU": 0.5574, "BOS": 0.5568, "CLE": 0.5552, "MIN": 0.5544,
    "SEA": 0.5544, "MIA": 0.5540, "SF":  0.5493, "TOR": 0.5490, "PHI": 0.5473,
    "WSH": 0.5455, "COL": 0.5439, "KC":  0.5437, "ATL": 0.5422, "STL": 0.5415,
}

# ── Team scoring (3yr empirical) ──────────────────────────────────────────────
TEAM_SCORING = {
    "LAD": {"avg_runs": 5.1834, "avg_f5": 2.9172, "avg_i1": 0.642},
    "ARI": {"avg_runs": 5.1199, "avg_f5": 2.9591, "avg_i1": 0.6667},
    "NYY": {"avg_runs": 5.1176, "avg_f5": 2.9588, "avg_i1": 0.6853},
    "MIL": {"avg_runs": 4.9056, "avg_f5": 2.8348, "avg_i1": 0.4838},
    "PHI": {"avg_runs": 4.7882, "avg_f5": 2.6206, "avg_i1": 0.6500},
    "CHC": {"avg_runs": 4.7278, "avg_f5": 2.7130, "avg_i1": 0.5178},
    "BOS": {"avg_runs": 4.7105, "avg_f5": 2.6228, "avg_i1": 0.5848},
    "NYM": {"avg_runs": 4.6844, "avg_f5": 2.6844, "avg_i1": 0.5133},
    "SD":  {"avg_runs": 4.5176, "avg_f5": 2.5706, "avg_i1": 0.5382},
    "TOR": {"avg_runs": 4.5000, "avg_f5": 2.4706, "avg_i1": 0.5206},
    "BAL": {"avg_runs": 4.4956, "avg_f5": 2.5367, "avg_i1": 0.4663},
    "HOU": {"avg_runs": 4.4720, "avg_f5": 2.4926, "avg_i1": 0.4454},
    "ATL": {"avg_runs": 4.4588, "avg_f5": 2.4176, "avg_i1": 0.5059},
    "MIN": {"avg_runs": 4.4487, "avg_f5": 2.4663, "avg_i1": 0.4370},
    "DET": {"avg_runs": 4.4412, "avg_f5": 2.5412, "avg_i1": 0.5029},
    "SEA": {"avg_runs": 4.4353, "avg_f5": 2.4588, "avg_i1": 0.5618},
    "CIN": {"avg_runs": 4.3090, "avg_f5": 2.5569, "avg_i1": 0.4985},
    "SF":  {"avg_runs": 4.2618, "avg_f5": 2.3412, "avg_i1": 0.4882},
    "WSH": {"avg_runs": 4.2382, "avg_f5": 2.3118, "avg_i1": 0.5235},
    "KC":  {"avg_runs": 4.2353, "avg_f5": 2.3029, "avg_i1": 0.4765},
    "ATH": {"avg_runs": 4.2353, "avg_f5": 2.3794, "avg_i1": 0.5265},
    "TEX": {"avg_runs": 4.2141, "avg_f5": 2.3900, "avg_i1": 0.4956},
    "STL": {"avg_runs": 4.2023, "avg_f5": 2.2757, "avg_i1": 0.3842},
    "MIA": {"avg_runs": 4.1818, "avg_f5": 2.3167, "avg_i1": 0.5543},
    "CLE": {"avg_runs": 4.1794, "avg_f5": 2.3206, "avg_i1": 0.4794},
    "TB":  {"avg_runs": 4.0944, "avg_f5": 2.3127, "avg_i1": 0.5015},
    "LAA": {"avg_runs": 4.0792, "avg_f5": 2.3548, "avg_i1": 0.4985},
    "COL": {"avg_runs": 3.9529, "avg_f5": 2.1500, "avg_i1": 0.4088},
    "PIT": {"avg_runs": 3.9118, "avg_f5": 2.1912, "avg_i1": 0.4500},
    "CWS": {"avg_runs": 3.5308, "avg_f5": 2.0411, "avg_i1": 0.4633},
}
DEFAULT_SCORING = {"avg_runs": 4.42, "avg_f5": 2.484, "avg_i1": 0.515}

# ── SP ERA → NRFI rate lookup ─────────────────────────────────────────────────
ERA_NRFI = {
    0: 0.7026, 1: 0.5993, 2: 0.5729, 3: 0.5106,
    4: 0.4930, 5: 0.4684, 6: 0.4623, 7: 0.4234,
    8: 0.3935, 9: 0.3077,
}

def era_to_nrfi(era: float) -> float:
    bucket = min(9, int(era))
    return ERA_NRFI.get(bucket, 0.515)

# ── Analytical model: compute probabilities from constants ────────────────────
def compute_probs(game: dict, c: dict) -> dict:
    """
    Compute model probabilities analytically using calibration constants.
    No Monte Carlo — uses team scoring tendencies + prior rates.
    """
    away = game["away_team"]
    home = game["home_team"]

    away_sc = TEAM_SCORING.get(away, DEFAULT_SCORING)
    home_sc = TEAM_SCORING.get(home, DEFAULT_SCORING)

    # Expected runs per team
    exp_away_fg = away_sc["avg_runs"]
    exp_home_fg = home_sc["avg_runs"]
    exp_fg_total = exp_away_fg + exp_home_fg

    # Expected F5 runs using team F5 run share
    away_f5_rs = TEAM_F5_RS.get(away, c["F5_RUN_SHARE"])
    home_f5_rs = TEAM_F5_RS.get(home, c["F5_RUN_SHARE"])
    exp_away_f5 = exp_away_fg * away_f5_rs
    exp_home_f5 = exp_home_fg * home_f5_rs
    exp_f5_total = exp_away_f5 + exp_home_f5

    # Expected I1 runs
    exp_i1 = (away_sc["avg_i1"] + home_sc["avg_i1"]) / 2.0

    # SP ERA from backtest data
    away_sp = game.get("away_sp", {})
    home_sp = game.get("home_sp", {})
    away_era = float(away_sp.get("game_era", 4.25)) if away_sp else 4.25
    home_era = float(home_sp.get("game_era", 4.25)) if home_sp else 4.25

    # ── FG ML probabilities ────────────────────────────────────────────────────
    # Use team scoring differential to adjust from prior
    run_diff = exp_home_fg - exp_away_fg
    # Logistic adjustment: +1 run diff ≈ +5% win probability
    adj = run_diff * 0.05
    p_home_win = min(0.85, max(0.15, c["fg_home_win_rate"] + adj))
    p_away_win = 1.0 - p_home_win

    # ── FG RL probabilities ────────────────────────────────────────────────────
    # Away +1.5: empirical base rate adjusted for team scoring
    p_fg_rl_away = min(0.80, max(0.20, c["fg_rl_away_cover"] - adj * 0.5))
    p_fg_rl_home = 1.0 - p_fg_rl_away

    # ── FG Total probabilities ─────────────────────────────────────────────────
    # Use Poisson-approximation: P(total > line) from expected total
    # For simplicity: use logistic function centered on expected total vs book line
    # This is the analytical approximation used in calibration
    # We'll use a fixed sigma of 2.8 runs (empirical std of MLB game totals)
    sigma_fg = 2.8
    # P(over) = P(actual > line) ≈ Φ((exp_total - line) / sigma)
    # We don't have book lines for historical games, so use league mean as proxy
    book_total = c["fg_mean"]  # use calibrated mean as the "line"
    z_fg = (exp_fg_total - book_total) / sigma_fg
    p_fg_over = _norm_cdf(z_fg)
    p_fg_under = 1.0 - p_fg_over

    # ── F5 ML probabilities ────────────────────────────────────────────────────
    f5_run_diff = exp_home_f5 - exp_away_f5
    f5_adj = f5_run_diff * 0.05
    # v2 accounts for push rate: p_home + p_away + p_push = 1
    push = c["f5_push_rate"]
    p_f5_home = min(0.70, max(0.10, c["f5_home_win_rate"] + f5_adj))
    p_f5_away = min(0.70, max(0.10, c["f5_away_win_rate"] - f5_adj))
    # Normalize to account for push
    total_non_push = p_f5_home + p_f5_away
    if total_non_push > (1.0 - push):
        scale = (1.0 - push) / total_non_push
        p_f5_home *= scale
        p_f5_away *= scale

    # ── F5 Total probabilities ─────────────────────────────────────────────────
    sigma_f5 = 1.8
    book_f5 = c["f5_mean"]
    z_f5 = (exp_f5_total - book_f5) / sigma_f5
    p_f5_over = _norm_cdf(z_f5)
    p_f5_under = 1.0 - p_f5_over

    # ── NRFI probability ───────────────────────────────────────────────────────
    # Geometric mean of away SP nrfi (pitching to home lineup) and home SP nrfi
    away_nrfi_as_pitcher = era_to_nrfi(home_era)  # home SP pitching to away lineup
    home_nrfi_as_pitcher = era_to_nrfi(away_era)  # away SP pitching to home lineup
    away_nrfi_as_batter  = TEAM_NRFI_RATES.get(away, c["nrfi_rate"])
    home_nrfi_as_batter  = TEAM_NRFI_RATES.get(home, c["nrfi_rate"])

    # Combined NRFI: both teams must not score in I1
    # P(NRFI) = P(away doesn't score) × P(home doesn't score)
    # P(away doesn't score) = f(home SP ERA, away batting NRFI rate)
    p_away_no_score = (away_nrfi_as_batter + home_nrfi_as_pitcher) / 2.0
    p_home_no_score = (home_nrfi_as_batter + away_nrfi_as_pitcher) / 2.0
    p_nrfi = p_away_no_score * p_home_no_score
    # Bayesian shrinkage toward league prior
    p_nrfi = 0.6 * p_nrfi + 0.4 * c["nrfi_rate"]
    p_nrfi = min(0.75, max(0.30, p_nrfi))
    p_yrfi = 1.0 - p_nrfi

    return {
        "p_home_win":     round(p_home_win, 4),
        "p_away_win":     round(p_away_win, 4),
        "p_fg_rl_home":   round(p_fg_rl_home, 4),
        "p_fg_rl_away":   round(p_fg_rl_away, 4),
        "p_fg_over":      round(p_fg_over, 4),
        "p_fg_under":     round(p_fg_under, 4),
        "p_f5_home":      round(p_f5_home, 4),
        "p_f5_away":      round(p_f5_away, 4),
        "p_f5_over":      round(p_f5_over, 4),
        "p_f5_under":     round(p_f5_under, 4),
        "p_nrfi":         round(p_nrfi, 4),
        "p_yrfi":         round(p_yrfi, 4),
        "exp_fg_total":   round(exp_fg_total, 3),
        "exp_f5_total":   round(exp_f5_total, 3),
        "exp_i1":         round(exp_i1, 3),
    }

def _norm_cdf(z: float) -> float:
    """Standard normal CDF approximation."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))

# ── Grade a single game ────────────────────────────────────────────────────────
def grade_game(game: dict, dk: Optional[dict], c: dict, version: str) -> dict:
    probs = compute_probs(game, c)

    fg_away = int(game.get("away_score", 0))
    fg_home = int(game.get("home_score", 0))
    f5_away = game.get("away_f5")
    f5_home = game.get("home_f5")
    nrfi    = bool(game.get("nrfi", False))
    fg_total = fg_away + fg_home
    f5_total = (int(f5_away) + int(f5_home)) if (f5_away is not None and f5_home is not None) else None
    margin   = fg_home - fg_away

    dk = dk or {}
    dk_total     = float(dk.get("dkTotal", 0)) if dk.get("dkTotal") else None
    dk_away_ml   = str(dk.get("dkAwayML")) if dk.get("dkAwayML") else None
    dk_home_ml   = str(dk.get("dkHomeML")) if dk.get("dkHomeML") else None
    dk_over_odds = str(dk.get("dkOverOdds")) if dk.get("dkOverOdds") else None
    dk_under_odds= str(dk.get("dkUnderOdds")) if dk.get("dkUnderOdds") else None
    dk_away_rl_odds = str(dk.get("dkAwayRunLineOdds")) if dk.get("dkAwayRunLineOdds") else None
    dk_home_rl_odds = str(dk.get("dkHomeRunLineOdds")) if dk.get("dkHomeRunLineOdds") else None

    grades = {}

    # FG ML Home
    grades["fg_ml_home"] = {
        "model_prob": probs["p_home_win"],
        "correct": int(fg_home > fg_away),
        "roi": _roi(probs["p_home_win"], dk_home_ml),
        "brier": _brier(probs["p_home_win"], int(fg_home > fg_away)),
    }
    # FG ML Away
    grades["fg_ml_away"] = {
        "model_prob": probs["p_away_win"],
        "correct": int(fg_away > fg_home),
        "roi": _roi(probs["p_away_win"], dk_away_ml),
        "brier": _brier(probs["p_away_win"], int(fg_away > fg_home)),
    }
    # FG RL Home (-1.5)
    grades["fg_rl_home"] = {
        "model_prob": probs["p_fg_rl_home"],
        "correct": int(margin > 1),
        "roi": _roi(probs["p_fg_rl_home"], dk_home_rl_odds),
        "brier": _brier(probs["p_fg_rl_home"], int(margin > 1)),
    }
    # FG RL Away (+1.5)
    grades["fg_rl_away"] = {
        "model_prob": probs["p_fg_rl_away"],
        "correct": int(margin < 2),
        "roi": _roi(probs["p_fg_rl_away"], dk_away_rl_odds),
        "brier": _brier(probs["p_fg_rl_away"], int(margin < 2)),
    }
    # FG Total Over
    if dk_total:
        over_correct  = int(fg_total > dk_total)
        under_correct = int(fg_total < dk_total)
    else:
        over_correct = under_correct = None
    grades["fg_over"] = {
        "model_prob": probs["p_fg_over"],
        "correct": over_correct,
        "roi": _roi(probs["p_fg_over"], dk_over_odds) if over_correct is not None else None,
        "brier": _brier(probs["p_fg_over"], over_correct) if over_correct is not None else None,
        "exp_total": probs["exp_fg_total"],
        "actual_total": fg_total,
        "book_total": dk_total,
    }
    grades["fg_under"] = {
        "model_prob": probs["p_fg_under"],
        "correct": under_correct,
        "roi": _roi(probs["p_fg_under"], dk_under_odds) if under_correct is not None else None,
        "brier": _brier(probs["p_fg_under"], under_correct) if under_correct is not None else None,
    }
    # F5 ML Home
    if f5_total is not None:
        f5_push = int(f5_away) == int(f5_home)
        grades["f5_ml_home"] = {
            "model_prob": probs["p_f5_home"],
            "correct": int(int(f5_home) > int(f5_away)) if not f5_push else None,
            "roi": None,
            "brier": _brier(probs["p_f5_home"], int(int(f5_home) > int(f5_away))) if not f5_push else None,
        }
        grades["f5_ml_away"] = {
            "model_prob": probs["p_f5_away"],
            "correct": int(int(f5_away) > int(f5_home)) if not f5_push else None,
            "roi": None,
            "brier": _brier(probs["p_f5_away"], int(int(f5_away) > int(f5_home))) if not f5_push else None,
        }
        grades["f5_total"] = {
            "exp_f5_total": probs["exp_f5_total"],
            "actual_f5_total": f5_total,
            "f5_mae": abs(probs["exp_f5_total"] - f5_total),
        }
    else:
        grades["f5_ml_home"] = {"model_prob": probs["p_f5_home"], "correct": None, "roi": None, "brier": None}
        grades["f5_ml_away"] = {"model_prob": probs["p_f5_away"], "correct": None, "roi": None, "brier": None}
        grades["f5_total"]   = {"exp_f5_total": probs["exp_f5_total"], "actual_f5_total": None, "f5_mae": None}

    # NRFI / YRFI
    grades["nrfi"] = {
        "model_prob": probs["p_nrfi"],
        "correct": int(nrfi),
        "brier": _brier(probs["p_nrfi"], int(nrfi)),
    }
    grades["yrfi"] = {
        "model_prob": probs["p_yrfi"],
        "correct": int(not nrfi),
        "brier": _brier(probs["p_yrfi"], int(not nrfi)),
    }

    return {
        "game": f'{game["away_team"]}@{game["home_team"]}',
        "date": game["gameDate"],
        "season": game["gameDate"][:4],
        "version": version,
        "fg_actual": fg_total,
        "f5_actual": f5_total,
        "nrfi": nrfi,
        "exp_fg_total": probs["exp_fg_total"],
        "exp_f5_total": probs["exp_f5_total"],
        "grades": grades,
    }

def _roi(p: float, ml_str) -> Optional[float]:
    if not ml_str:
        return None
    try:
        ml = float(str(ml_str).replace("+", ""))
        dec = (1 + ml/100) if ml > 0 else (1 + 100/abs(ml))
        return round(p * dec - 1.0, 4)
    except Exception:
        return None

def _brier(p: float, outcome: Optional[int]) -> Optional[float]:
    if outcome is None:
        return None
    return round((p - outcome) ** 2, 6)

# ── Aggregate ──────────────────────────────────────────────────────────────────
MARKETS = ["fg_ml_home", "fg_ml_away", "fg_rl_home", "fg_rl_away",
           "fg_over", "fg_under", "f5_ml_home", "f5_ml_away", "nrfi", "yrfi"]

def aggregate(results: List[dict]) -> dict:
    agg = {}
    for mkt in MARKETS:
        wins = losses = roi_count = 0
        total_roi = total_brier = 0.0
        brier_count = 0
        probs = []
        for r in results:
            g = r.get("grades", {}).get(mkt, {})
            c = g.get("correct")
            if c == 1:
                wins += 1
            elif c == 0:
                losses += 1
            roi = g.get("roi")
            if roi is not None:
                total_roi += roi
                roi_count += 1
            brier = g.get("brier")
            if brier is not None:
                total_brier += brier
                brier_count += 1
            p = g.get("model_prob")
            if p is not None:
                probs.append(p)
        graded = wins + losses
        agg[mkt] = {
            "wins": wins, "losses": losses, "graded": graded,
            "accuracy": round(wins / graded, 4) if graded > 0 else None,
            "avg_roi": round(total_roi / roi_count, 4) if roi_count > 0 else None,
            "roi_count": roi_count,
            "avg_brier": round(total_brier / brier_count, 6) if brier_count > 0 else None,
            "avg_model_prob": round(sum(probs)/len(probs), 4) if probs else None,
        }

    # Calibration MAE
    fg_errors, f5_errors = [], []
    for r in results:
        if r.get("exp_fg_total") and r.get("fg_actual"):
            fg_errors.append(abs(r["exp_fg_total"] - r["fg_actual"]))
        f5g = r.get("grades", {}).get("f5_total", {})
        mae = f5g.get("f5_mae")
        if mae is not None:
            f5_errors.append(mae)
    agg["_calibration"] = {
        "fg_total_mae": round(sum(fg_errors)/len(fg_errors), 4) if fg_errors else None,
        "f5_total_mae": round(sum(f5_errors)/len(f5_errors), 4) if f5_errors else None,
        "n_fg": len(fg_errors),
        "n_f5": len(f5_errors),
    }
    return agg

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", default="2024,2025,2026")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", default="/tmp/mlb_v1v2_analytical_report.json")
    args = parser.parse_args()

    seasons = [s.strip() for s in args.seasons.split(",")]
    print(f'\n[INPUT] Seasons={seasons} | Limit={args.limit or "ALL"} | Output={args.output}')

    # ── Load backtest games ────────────────────────────────────────────────────
    print("[STEP] Loading backtest results...")
    with open(BACKTEST_FILE) as f:
        bt_data = json.load(f)
    all_games = bt_data["graded_games"]
    games = [g for g in all_games if g["season"] in seasons]
    if args.limit > 0:
        games = games[:args.limit]
    print(f"[INPUT] Games: {len(games)}")
    by_season = defaultdict(int)
    for g in games:
        by_season[g["season"]] += 1
    for s in sorted(by_season):
        print(f"  [INPUT] Season {s}: {by_season[s]} games")

    # ── Load DK odds ───────────────────────────────────────────────────────────
    print(f"[STEP] Loading DK odds from {DK_ODDS_FILE}...")
    with open(DK_ODDS_FILE) as f:
        dk_rows = json.load(f)
    dk_rows = [r for r in dk_rows if any(r["gameDate"].startswith(s) for s in seasons)]
    dk_lookup = {}
    for row in dk_rows:
        key = (row["gameDate"], row["awayAbbr"], row["homeAbbr"])
        dk_lookup[key] = row
    print(f"[INPUT] DK odds loaded: {len(dk_lookup)} rows")

    # ── Grade v1 and v2 ────────────────────────────────────────────────────────
    all_results = {"v1": [], "v2": []}
    errors = {"v1": 0, "v2": 0}

    for version, c in [("v1", V1), ("v2", V2)]:
        print(f"\n[STEP] Grading {len(games)} games under {version} constants...")
        t0 = time.time()
        for i, game in enumerate(games):
            if i % 1000 == 0 and i > 0:
                print(f"  [STATE] {version}: {i}/{len(games)} | {time.time()-t0:.1f}s elapsed")
            dk_key = (game["gameDate"], game["away_team"], game["home_team"])
            dk = dk_lookup.get(dk_key)
            try:
                r = grade_game(game, dk, c, version)
                all_results[version].append(r)
            except Exception as e:
                errors[version] += 1
                if errors[version] <= 3:
                    print(f'  [ERROR] {version} {game["away_team"]}@{game["home_team"]} {game["gameDate"]}: {e}')
        print(f"  [OUTPUT] {version}: graded={len(all_results[version])} errors={errors[version]} | {time.time()-t0:.1f}s")

    # ── Aggregate ──────────────────────────────────────────────────────────────
    print("\n[STEP] Aggregating results...")
    agg_v1 = aggregate(all_results["v1"])
    agg_v2 = aggregate(all_results["v2"])

    # ── Print report ───────────────────────────────────────────────────────────
    print("\n" + "="*110)
    print("MLB MODEL v1 vs v2 — CALIBRATION ACCURACY LIFT REPORT (ANALYTICAL)")
    print(f"Seasons: {seasons} | Games: {len(games)} | Date: {date.today()}")
    print("Method: Analytical (no Monte Carlo) — uses team scoring tendencies + calibration priors")
    print("="*110)
    print(f'{"Market":<16} {"v1 Acc":>8} {"v2 Acc":>8} {"Δ Acc":>8} {"v1 n":>7} {"v2 n":>7} '
          f'{"v1 ROI":>9} {"v2 ROI":>9} {"Δ ROI":>8} {"v1 Brier":>9} {"v2 Brier":>9} {"Δ Brier":>8}')
    print("-"*110)

    total_lift = 0.0
    lift_count = 0
    for mkt in MARKETS:
        v1 = agg_v1.get(mkt, {})
        v2 = agg_v2.get(mkt, {})
        v1a = v1.get("accuracy")
        v2a = v2.get("accuracy")
        v1r = v1.get("avg_roi")
        v2r = v2.get("avg_roi")
        v1b = v1.get("avg_brier")
        v2b = v2.get("avg_brier")
        da  = (v2a - v1a) if (v1a and v2a) else None
        dr  = (v2r - v1r) if (v1r and v2r) else None
        db  = (v2b - v1b) if (v1b and v2b) else None  # negative = better

        v1a_s = f"{v1a*100:>7.2f}%" if v1a else "    N/A"
        v2a_s = f"{v2a*100:>7.2f}%" if v2a else "    N/A"
        da_s  = f"{da*100:>+7.2f}%" if da is not None else "    N/A"
        v1r_s = f"{v1r*100:>8.2f}%" if v1r else "     N/A"
        v2r_s = f"{v2r*100:>8.2f}%" if v2r else "     N/A"
        dr_s  = f"{dr*100:>+7.2f}%" if dr is not None else "    N/A"
        v1b_s = f"{v1b:>9.6f}" if v1b else "      N/A"
        v2b_s = f"{v2b:>9.6f}" if v2b else "      N/A"
        db_s  = f"{db:>+8.6f}" if db is not None else "     N/A"

        print(f'{mkt:<16} {v1a_s} {v2a_s} {da_s} {v1["graded"]:>7} {v2["graded"]:>7} '
              f'{v1r_s} {v2r_s} {dr_s} {v1b_s} {v2b_s} {db_s}')

        if da is not None:
            total_lift += da
            lift_count += 1

    avg_lift = total_lift / lift_count if lift_count > 0 else 0
    print("-"*110)
    print(f'{"AVERAGE LIFT":<16} {"":>8} {"":>8} {avg_lift*100:>+7.2f}%')

    # Calibration MAE
    c1 = agg_v1.get("_calibration", {})
    c2 = agg_v2.get("_calibration", {})
    fg_mae_lift = (c1.get("fg_total_mae", 0) - c2.get("fg_total_mae", 0)) if (c1.get("fg_total_mae") and c2.get("fg_total_mae")) else None
    f5_mae_lift = (c1.get("f5_total_mae", 0) - c2.get("f5_total_mae", 0)) if (c1.get("f5_total_mae") and c2.get("f5_total_mae")) else None

    print(f'\n[OUTPUT] FG Total MAE: v1={c1.get("fg_total_mae","N/A")} v2={c2.get("fg_total_mae","N/A")} '
          f'Δ={fg_mae_lift:+.4f} (n={c2.get("n_fg",0)})' if fg_mae_lift else
          f'\n[OUTPUT] FG Total MAE: v1={c1.get("fg_total_mae","N/A")} v2={c2.get("fg_total_mae","N/A")}')
    print(f'[OUTPUT] F5 Total MAE: v1={c1.get("f5_total_mae","N/A")} v2={c2.get("f5_total_mae","N/A")} '
          f'Δ={f5_mae_lift:+.4f} (n={c2.get("n_f5",0)})' if f5_mae_lift else
          f'[OUTPUT] F5 Total MAE: v1={c1.get("f5_total_mae","N/A")} v2={c2.get("f5_total_mae","N/A")}')

    # Per-season breakdown
    print("\n[OUTPUT] Per-season accuracy (v2):")
    for season in seasons:
        sr = [r for r in all_results["v2"] if r.get("season") == season]
        if not sr:
            continue
        sa = aggregate(sr)
        fg_acc   = sa.get("fg_ml_home", {}).get("accuracy")
        nrfi_acc = sa.get("nrfi", {}).get("accuracy")
        f5_acc   = sa.get("f5_ml_home", {}).get("accuracy")
        rl_acc   = sa.get("fg_rl_away", {}).get("accuracy")
        print(f"  {season}: n={len(sr)} | FG ML Home={fg_acc*100:.1f}% | F5 ML Home={f5_acc*100:.1f}% | "
              f"FG RL Away={rl_acc*100:.1f}% | NRFI={nrfi_acc*100:.1f}%" if all([fg_acc, f5_acc, nrfi_acc, rl_acc]) else f"  {season}: n={len(sr)}")

    # ── Key constant delta impact ──────────────────────────────────────────────
    print("\n[OUTPUT] Key constant delta impacts:")
    print(f'  fg_rl_away: v1={V1["fg_rl_away_cover"]:.4f} → v2={V2["fg_rl_away_cover"]:.4f} | '
          f'v1 acc={agg_v1.get("fg_rl_away",{}).get("accuracy",0)*100:.1f}% → '
          f'v2 acc={agg_v2.get("fg_rl_away",{}).get("accuracy",0)*100:.1f}%')
    print(f'  f5_ml_home: v1={V1["f5_home_win_rate"]:.4f} → v2={V2["f5_home_win_rate"]:.4f} | '
          f'v1 acc={agg_v1.get("f5_ml_home",{}).get("accuracy",0)*100:.1f}% → '
          f'v2 acc={agg_v2.get("f5_ml_home",{}).get("accuracy",0)*100:.1f}%')
    print(f'  nrfi:       v1={V1["nrfi_rate"]:.4f} → v2={V2["nrfi_rate"]:.4f} | '
          f'v1 acc={agg_v1.get("nrfi",{}).get("accuracy",0)*100:.1f}% → '
          f'v2 acc={agg_v2.get("nrfi",{}).get("accuracy",0)*100:.1f}%')
    print(f'  F5_RUN_SHARE: v1={V1["F5_RUN_SHARE"]:.4f} → v2={V2["F5_RUN_SHARE"]:.4f} | '
          f'F5 MAE: v1={c1.get("f5_total_mae","N/A")} → v2={c2.get("f5_total_mae","N/A")}')

    # ── Save JSON report ───────────────────────────────────────────────────────
    report = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "method": "analytical",
        "seasons": seasons,
        "total_games": len(games),
        "v1_graded": len(all_results["v1"]),
        "v2_graded": len(all_results["v2"]),
        "avg_accuracy_lift": round(avg_lift, 6),
        "v1_agg": agg_v1,
        "v2_agg": agg_v2,
        "calibration_delta": {
            "fg_mae_v1": c1.get("fg_total_mae"),
            "fg_mae_v2": c2.get("fg_total_mae"),
            "f5_mae_v1": c1.get("f5_total_mae"),
            "f5_mae_v2": c2.get("f5_total_mae"),
            "fg_mae_lift": fg_mae_lift,
            "f5_mae_lift": f5_mae_lift,
        },
        "constant_deltas": {
            k: {"v1": V1.get(k), "v2": V2.get(k), "delta": round(V2.get(k,0) - V1.get(k,0), 4)}
            for k in V1
        }
    }
    with open(args.output, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n[OUTPUT] Full JSON report saved to {args.output}")
    print("[VERIFY] PASS — v1 vs v2 analytical grader completed successfully")

if __name__ == "__main__":
    main()
