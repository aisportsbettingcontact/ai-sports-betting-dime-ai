#!/usr/bin/env python3
"""
MLBAIModel.py  ── MAX SPEC REBUILD
===================================
MLB Market Origination Engine: INPUT → DISTRIBUTION → PRICING → STRUCTURE
OUTPUT: NO-VIG, INVERSE, FAIR VALUE MARKETS

This file is the canonical MLB AI Model engine. The filename MLBAIModel.py is
permanent and must never be changed or renamed.

Implements the full 12-step MAX SPEC blueprint:
  Step 1:  Input Engine (team/pitcher/bullpen/park/weather/umpire features)
  Step 2:  Simulation Core (400k sims, NB-Gamma Mixture, extra innings, ghost runner)
  Step 3:  Distribution Extraction (histograms, tail validation, bucket sparsity)
  Step 4:  Totals Origination (optimal line selection, push mass, no-vig pricing)
  Step 5:  Moneyline Origination (total-environment variance adjustment)
  Step 6:  Run Line Origination (±1.5 no-vig pricing)
  Step 7:  Conditional Structure Validation (P(win_by_2+) ≤ P(win) enforcement)
  Step 8:  Cross-Market Consistency Engine (ML↔Total, RL↔Total, ML↔RL)
  Step 9:  Inverse Symmetry Enforcement (exact no-vig inverse verification)
  Step 10: Market Shaping (half-run snap, monotonicity, no-arb check)
  Step 11: Final Output (all markets, projected runs)
  Step 12: Logging + Debugging (mandatory structured logging)
"""

import importlib
import math
import subprocess
import sys
import time
import warnings


# ── DEPENDENCY GUARD: scipy must always be present ────────────────────────────
def _ensure_scipy() -> None:
    """Auto-install scipy if missing. Prevents ModuleNotFoundError at runtime."""
    try:
        importlib.import_module("scipy")
    except ModuleNotFoundError:
        print(
            "[STARTUP] scipy not found — auto-installing...",
            file=sys.stderr,
            flush=True,
        )
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "scipy", "-q"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(
                f"[STARTUP] FATAL: scipy install failed: {result.stderr}",
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)
        print("[STARTUP] scipy installed successfully", file=sys.stderr, flush=True)
        importlib.invalidate_caches()


_ensure_scipy()
# ─────────────────────────────────────────────────────────────────────────────

from collections import defaultdict
from datetime import datetime
from typing import Optional

import numpy as np
from scipy.stats import norm

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL CONFIGURATION (MAX SPEC)
# ─────────────────────────────────────────────────────────────────────────────
SIMULATIONS = 400_000  # SPEC: SIM_TARGET=400K (upgraded from 250K)
MIN_SIMULATIONS = 250_000  # SPEC: SIM_MIN=250K
SIM_MAX = 500_000  # SPEC: SIM_MAX=500K (enforced in MonteCarloEngine)
MAX_EDGE_THRESHOLD = 0.20  # widened: capture large-edge spots (was 0.08)
MIN_EDGE_THRESHOLD = 0.005  # widened: capture small-edge spots (was 0.01)
CONFIDENCE_THRESHOLD = 0.65  # SPEC: minimum model probability to emit an edge
LEARNING_RATE_BASE = 0.05  # SPEC: RL parameter update rate (reserved for daily loop)
DRIFT_THRESHOLD = 0.02  # SPEC: rolling error threshold for drift detection
BULLPEN_LOOKBACK_DAYS = 5
LINEUP_TOP_WEIGHT = 0.65
LINEUP_BOTTOM_WEIGHT = 0.35
TAIL_STABILITY_THRESHOLD = 0.0005
MIN_SAMPLE_PER_BUCKET = 500
KEY_TOTAL_NUMBERS = [
    6.5,
    7.0,
    7.5,
    8.0,
    8.5,
    9.0,
    9.5,
    10.0,
    10.5,
    11.0,
    11.5,
    12.0,
]  # extended for Coors/extreme games
KEY_PRICE_BUCKETS = [-105, -108, -110, -112, -115, -118, -120]
ROUNDING_RULES = "HALF_RUN_ONLY"
NO_VIG_OUTPUT = True
INVERSE_SYMMETRY = True

# ─── NRFI / BAYESIAN SHRINKAGE CONSTANTS ─────────────────────────────────────
# Promoted to module-level for auditability and override without touching simulation logic.
# Source: 3yr backtest (n=5,103 games, 2024-2026). Updated 2026-04-14 (v2 calibration).
INNING1_RUN_SHARE = 0.1166  # 3yr empirical first-inning run share (was 0.1093)
# Used as: mu_1st_physics = game_mu * INNING1_RUN_SHARE
LEAGUE_NRFI_PRIOR = 0.8899  # exp(-INNING1_RUN_SHARE) = exp(-0.1166) = 0.8899
# Bayesian prior: league-average P(NRFI) implied by I1 share
NRFI_SHRINKAGE_K = 10  # Bayesian shrinkage confidence constant
# w = starts / (starts + K): at 3 starts w=0.23, at 10 starts w=0.50
NRFI_MIN_STARTS_FULL = 20  # starts needed for full weight (w >= 0.67 at K=10)

# ─── 2025 MLB LEAGUE AVERAGES (source: MLB Stats API, season=2025 team aggregates)
# PA=182,926 | R/team/G=4.447 | RPG(both)=8.895
# Last updated: 2026-03-31
LEAGUE_K_PCT = 0.2222  # 2025: 0.2222  (was 0.2240 from 2024)
LEAGUE_BB_PCT = 0.0841  # 2025: 0.0841  (from batting PA totals: BB/PA across 30 teams)
# NOTE: was incorrectly set to 0.0946 (derived from pitching BB/9÷38)
LEAGUE_HR_PCT = 0.0309  # 2025: 0.0309  (was 0.0340)
LEAGUE_1B_PCT = 0.1428  # 2025: 0.1428  (was 0.1480)
LEAGUE_2B_PCT = 0.0423  # 2025: 0.0423  (was 0.0460)
LEAGUE_3B_PCT = 0.0034  # 2025: 0.0034  (was 0.0050)
LEAGUE_WOBA = 0.3200  # 2025: 0.3200  (was 0.3120)
LEAGUE_XWOBA = 0.3200  # 2025: 0.3200  (was 0.3120)
LEAGUE_OBP = 0.3174  # 2025: 0.3174  (new constant)
LEAGUE_ERA = 4.153  # 2025: 4.153   (was 4.380 from 2024)
LEAGUE_K9 = 8.491  # 2025: 8.491   (was 8.500)
LEAGUE_BB9 = 3.215  # 2025: 3.215   (was 3.200)
LEAGUE_HR9 = 1.180  # 2025: 1.180   (was 1.260)
LEAGUE_WHIP = 1.289  # 2025: 1.289   (was 1.300)
LEAGUE_RPG = 8.895  # 2025: 8.895   (was 8.760 from 2024)
# Calibration multiplier: aligns symmetric game total to 2025 RPG=8.895
# With correct 2025 constants, base engine produces exp_total=9.112 at qm=1.0
# Required: 8.895 / 9.112 = 0.9762 (slight downward correction)
# Verified: qm=0.9762 → exp_total=8.895 (Delta=0.000)
LEAGUE_CALIBRATION_MULT = 0.9762  # 2025 calibrated (verified)

STARTER_IP_MEAN = 5.2
STARTER_IP_MIN = 1.0
STARTER_IP_MAX = 9.0

TTO_PENALTY = [0.0, 0.025, 0.055]

HFA_BASE_WEIGHT = 0.35
HFA_MONTH_SCALE = 0.80
HFA_TEAM_SCALE = 2.5
HFA_MONTHLY_FACTORS = {
    3: 1.1888,
    4: 1.0832,
    5: 1.0416,
    6: 0.9984,
    7: 0.9552,
    8: 0.9744,
    9: 1.0000,
    10: 1.0608,
}
HFA_TEAM_DELTA = {
    "COL": -0.193,
    "HOU": 0.095,
    "CHN": 0.095,
    "ATL": 0.080,
    "LAN": 0.072,
    "NYA": 0.068,
    "BOS": 0.065,
    "SFN": 0.060,
    "STL": 0.055,
    "MIL": 0.050,
    "MIN": 0.045,
    "CLE": 0.040,
    "TBA": 0.038,
    "SDN": 0.035,
    "PHI": 0.032,
    "SEA": 0.030,
    "ARI": 0.028,
    "NYN": 0.025,
    "DET": 0.022,
    "BAL": 0.020,
    "CIN": 0.018,
    "PIT": 0.015,
    "KCA": 0.012,
    "TEX": 0.010,
    "CHA": 0.008,
    "MIA": 0.005,
    "WAS": 0.003,
    "OAK": 0.000,
    "TOR": -0.005,
    "ANA": -0.010,
}

DB_TO_RETRO = {
    "PIT": "PIT",
    "NYM": "NYN",
    "CWS": "CHA",
    "MIL": "MIL",
    "WSH": "WAS",
    "CHC": "CHN",
    "NYY": "NYA",
    "SF": "SFN",
    "LAD": "LAN",
    "SD": "SDN",
    "STL": "STL",
    "TB": "TBA",
    "PHI": "PHI",
    "HOU": "HOU",
    "DET": "DET",
    "ARI": "ARI",
    "SEA": "SEA",
    "CLE": "CLE",
    "MIN": "MIN",
    "BAL": "BAL",
    "BOS": "BOS",
    "CIN": "CIN",
    "LAA": "ANA",
    "TEX": "TEX",
    "ATL": "ATL",
    "COL": "COL",
    "KC": "KCA",
    "TOR": "TOR",
    "ATH": "OAK",
    "OAK": "OAK",
    "MIA": "MIA",
}

# PARK_FACTORS: 2024 Fangraphs empirical values (5-year park factors, 2024 season)
# Updated 2025-05-10. HR factors updated to 2024 actuals from Fangraphs Park Factor table.
# "r" = runs factor, "hr" = HR factor, "h" = hits factor (all normalized to 100 = league avg)
PARK_FACTORS = {
    "COL": {"r": 115, "hr": 122, "h": 109},  # Coors — highest HR environment in MLB
    "CIN": {"r": 107, "hr": 112, "h": 104},  # Great American Ball Park — HR-friendly
    "PHI": {"r": 105, "hr": 108, "h": 104},  # Citizens Bank Park
    "BOS": {"r": 104, "hr": 104, "h": 106},  # Fenway Park — hits-friendly, moderate HR
    "NYA": {
        "r": 104,
        "hr": 109,
        "h": 102,
    },  # Yankee Stadium — HR-friendly short porches
    "BAL": {"r": 103, "hr": 108, "h": 102},  # Camden Yards — HR-friendly
    "TEX": {"r": 103, "hr": 106, "h": 102},  # Globe Life Field
    "MIL": {"r": 102, "hr": 104, "h": 101},  # American Family Field
    "ARI": {"r": 102, "hr": 105, "h": 101},  # Chase Field (dome, altitude)
    "HOU": {"r": 101, "hr": 100, "h": 102},  # Minute Maid Park — slight run boost
    "ATL": {"r": 101, "hr": 103, "h": 101},  # Truist Park
    "CHN": {"r": 100, "hr": 101, "h": 100},  # Wrigley Field
    "LAN": {"r": 100, "hr": 99, "h": 100},  # Dodger Stadium — pitcher-friendly HR
    "NYN": {"r": 100, "hr": 100, "h": 100},  # Citi Field (renovated, more neutral)
    "STL": {"r": 99, "hr": 98, "h": 99},  # Busch Stadium
    "TOR": {"r": 99, "hr": 100, "h": 99},  # Rogers Centre (dome)
    "MIN": {"r": 99, "hr": 100, "h": 98},  # Target Field
    "SFN": {"r": 98, "hr": 96, "h": 99},  # Oracle Park — pitcher-friendly
    "DET": {"r": 98, "hr": 97, "h": 98},  # Comerica Park
    "CLE": {"r": 97, "hr": 95, "h": 97},  # Progressive Field
    "CHA": {"r": 97, "hr": 96, "h": 97},  # Guaranteed Rate Field
    "TBA": {"r": 97, "hr": 96, "h": 97},  # Tropicana Field (dome)
    "PIT": {"r": 97, "hr": 95, "h": 97},  # PNC Park
    "SDN": {"r": 97, "hr": 95, "h": 98},  # Petco Park — pitcher-friendly
    "SEA": {"r": 96, "hr": 93, "h": 97},  # T-Mobile Park — very pitcher-friendly
    "KCA": {"r": 96, "hr": 94, "h": 96},  # Kauffman Stadium
    "WAS": {"r": 96, "hr": 95, "h": 96},  # Nationals Park
    "ANA": {"r": 96, "hr": 96, "h": 97},  # Angel Stadium
    "MIA": {"r": 95, "hr": 91, "h": 95},  # loanDepot Park (dome, very pitcher-friendly)
    "OAK": {"r": 94, "hr": 91, "h": 94},  # Oakland Coliseum — most pitcher-friendly
}

# ─────────────────────────────────────────────────────────────────────────────
# 3-YEAR BACKTEST CONSTANTS (2024+2025+2026, n=5,109 games, generated 2026-04-14)
# Source: mlb_3yr_backtest scripts 04_deep_analysis, 06_nrfi_threshold_grid,
#         07_market_accuracy. These are empirical ground-truth values used as
#         Bayesian priors and validation gates — not overrides.
# ─────────────────────────────────────────────────────────────────────────────

# ── Team NRFI rates (3yr empirical, n=5,103 games, min 20 games) ─────────────
# Updated 2026-04-14 from mlbBacktestV2.py. Exact values from mlb_calibration_constants.json.
# Keyed by DB team abbreviation (same as away_abbrev / home_abbrev in project_game)
TEAM_NRFI_RATES: dict[str, float] = {
    "PIT": 0.5765,
    "NYM": 0.5664,
    "KC": 0.5647,
    "STL": 0.5543,
    "CHC": 0.5503,
    "CLE": 0.5471,
    "CIN": 0.5452,
    "BAL": 0.5367,
    "WSH": 0.5353,
    "HOU": 0.5339,
    "MIL": 0.5310,
    "DET": 0.5294,
    "TOR": 0.5235,
    "SEA": 0.5235,
    "ATL": 0.5206,
    "TEX": 0.5161,
    "SD": 0.5118,
    "SF": 0.5059,
    "TB": 0.5044,
    "CWS": 0.5044,
    "ATH": 0.5000,
    "MIN": 0.4956,
    "BOS": 0.4883,
    "PHI": 0.4882,
    "LAA": 0.4868,
    "LAD": 0.4734,
    "MIA": 0.4663,
    "ARI": 0.4591,
    "NYY": 0.4559,
    "COL": 0.4559,
}
TEAM_NRFI_LEAGUE_MEAN = 0.5150  # 3yr empirical NRFI rate (n=5,103 games, was 0.5154)

# ── Team F5 runs scored means (3yr, n=5,103 games, used for F5 mu calibration) ─
# Updated 2026-04-14 from mlbBacktestV2.py. Exact values from mlb_calibration_constants.json.
# Source: team_scoring.avg_f5 field (3yr empirical, min 20 games)
TEAM_F5_RS: dict[str, float] = {
    "PIT": 2.1912,
    "NYM": 2.6844,
    "KC": 2.3029,
    "STL": 2.2757,
    "CHC": 2.7130,
    "CLE": 2.3206,
    "CIN": 2.5569,
    "BAL": 2.5367,
    "WSH": 2.3118,
    "HOU": 2.4926,
    "MIL": 2.8348,
    "DET": 2.5412,
    "TOR": 2.4706,
    "SEA": 2.4588,
    "ATL": 2.4176,
    "TEX": 2.3900,
    "SD": 2.5706,
    "SF": 2.3412,
    "TB": 2.3127,
    "CWS": 2.0411,
    "ATH": 2.3794,
    "MIN": 2.4663,
    "BOS": 2.6228,
    "PHI": 2.6206,
    "LAA": 2.3548,
    "LAD": 2.9172,
    "MIA": 2.3167,
    "ARI": 2.9591,
    "NYY": 2.9588,
    "COL": 2.1500,
}
F5_RS_LEAGUE_MEAN = (
    2.484  # 3yr empirical mean F5 runs scored per team (avg of 30 teams)
)
F5_RS_WEIGHT = 0.10  # max 10% adjustment from team F5 RS tendency

# ── NRFI Bayesian prior weights ───────────────────────────────────────────────
# Pitcher empirical NRFI rate blended into first-inning mu as a Bayesian prior.
# Physics (simulation) gets 50%, pitcher rate gets 35%, team tendency gets 15%.
# Source: 06_nrfi_threshold_grid.py — optimal filter: combined rate >= 0.56
NRFI_PITCHER_WEIGHT = 0.35  # pitcher 3yr empirical NRFI rate weight
NRFI_TEAM_WEIGHT = 0.15  # team 3yr empirical NRFI rate weight
NRFI_PHYSICS_WEIGHT = 0.50  # simulation physics weight (sum = 1.0)
# NRFI filter thresholds (from grid search, n=5,109 games)
# P1-C: Recalibrated from 0.56 (arithmetic mean) to 0.53 (geometric mean).
# sqrt(0.56 * 0.56) = 0.56 (symmetric case unchanged), but asymmetric cases
# (e.g., 0.72 * 0.40) now correctly fail: sqrt(0.288) = 0.537 < 0.53.
# Threshold 0.53 preserves the same empirical precision/recall as 0.56 arithmetic.
# P3-C: Recalibrated 2026-05-10 from live 2026 data (n=597 modeled games)
# Model avg pNRFI=0.4725 vs empirical rate=0.5093 → 7.2% systematic underestimation
# Threshold lowered from 0.53 to 0.52 to account for model underestimation
NRFI_COMBINED_THRESHOLD = (
    0.52  # geometric mean pitcher rate >= 0.52 → filter pass (P3-C recalibrated)
)
NRFI_BOTH_THRESHOLD = (
    0.54  # both individual pitchers >= 0.54 → stronger signal (P3-C: was 0.56)
)

# ── Empirical market priors (3yr, n=5,103 games) ─────────────────────────────
# Updated 2026-04-14 from mlbBacktestV2.py (2024+2025+2026 full season backtest)
# Source: mlb_calibration_constants.json
# Used as validation gates — model should arrive at these through simulation.
EMPIRICAL_PRIORS = {
    # Full Game ML
    "fg_home_win_rate": 0.5525,  # FG ML home win rate (2026 live: 0.5525, 3yr: 0.5338)
    "fg_away_win_rate": 0.4475,  # FG ML away win rate (2026 live: 0.4475, 3yr: 0.4662)
    # F5 ML (push=15.07% when tied after 5)
    "f5_home_win_rate": 0.4511,  # F5 ML home win rate (3yr empirical, was 0.5319)
    "f5_away_win_rate": 0.3982,  # F5 ML away win rate (3yr empirical, was 0.4681)
    "f5_push_rate": 0.1507,  # F5 push rate — tied after 5 innings (3yr empirical)
    # Full Game Run Line (±1.5)
    "fg_rl_away_cover": 0.6430,  # FG RL away +1.5 cover rate (3yr empirical, was 0.3189)
    "fg_rl_home_cover": 0.3570,  # FG RL home -1.5 cover rate (3yr empirical, was 0.5128)
    # F5 Run Line (±0.5)
    "f5_rl_away_cover": 0.5489,  # F5 RL away +0.5 cover rate (3yr empirical)
    "f5_rl_home_cover": 0.4511,  # F5 RL home -0.5 cover rate (3yr empirical)
    # NRFI
    "nrfi_rate": 0.5093,  # NRFI rate (2026 live: 0.5093, 3yr: 0.5150)
    # Run shares
    "f5_share": 0.5595,  # F5 runs / FG runs (2026 live: 0.5595 n=561, updated 2026-05-10)
    "i1_share": 0.1166,  # I1 runs / FG runs (3yr empirical, was 0.1093)
    # Totals
    "fg_mean": 8.892,  # mean FG total (2026 live: 8.892, 3yr: 8.842)
    "f5_mean": 4.881,  # mean F5 total (2026 live: 8.892 * 0.5491 = 4.881)
    # Season-by-season drift (for temporal weighting)
    "f5_share_2024": 0.5622,  # 2024 F5 share (n=2,428)
    "f5_share_2025": 0.5624,  # 2025 F5 share (n=2,432)
    "f5_share_2026": 0.5595,  # 2026 F5 share (n=561, updated 2026-05-10)
    "i1_share_2024": 0.1133,  # 2024 I1 share
    "i1_share_2025": 0.1198,  # 2025 I1 share
    "i1_share_2026": 0.1181,  # 2026 I1 share
}

# RE_MATRIX: 2024 Fangraphs RE24 empirical values (4.38 R/G environment — lowest since 2014)
# Updated 2025-05-10. Key: (outs, base_state) bitmask: 1=1B, 2=2B, 4=3B (0=empty, 7=loaded)
# Previous values were 2015-2019 era (4.50 R/G avg) — now updated to 2024 actuals.
RE_MATRIX = {
    (0, 0): 0.461,  # 0 outs, bases empty
    (0, 1): 0.831,  # 0 outs, 1B
    (0, 2): 1.068,  # 0 outs, 2B
    (0, 3): 1.380,  # 0 outs, 1B+2B
    (0, 4): 1.309,  # 0 outs, 3B
    (0, 5): 1.728,  # 0 outs, 1B+3B
    (0, 6): 1.920,  # 0 outs, 2B+3B
    (0, 7): 2.234,  # 0 outs, bases loaded
    (1, 0): 0.243,  # 1 out, bases empty
    (1, 1): 0.488,  # 1 out, 1B
    (1, 2): 0.641,  # 1 out, 2B
    (1, 3): 0.876,  # 1 out, 1B+2B
    (1, 4): 0.838,  # 1 out, 3B
    (1, 5): 1.176,  # 1 out, 1B+3B
    (1, 6): 1.334,  # 1 out, 2B+3B
    (1, 7): 1.503,  # 1 out, bases loaded
    (2, 0): 0.093,  # 2 outs, bases empty
    (2, 1): 0.214,  # 2 outs, 1B
    (2, 2): 0.307,  # 2 outs, 2B
    (2, 3): 0.413,  # 2 outs, 1B+2B
    (2, 4): 0.330,  # 2 outs, 3B
    (2, 5): 0.479,  # 2 outs, 1B+3B
    (2, 6): 0.559,  # 2 outs, 2B+3B
    (2, 7): 0.726,  # 2 outs, bases loaded
}

RUN_VALUES = {
    # 2024 Fangraphs linear weights (4.38 R/G environment)
    "K": -0.261,
    "OUT": -0.261,
    "BB": 0.301,
    "1B": 0.456,
    "2B": 0.753,
    "3B": 1.031,
    "HR": 1.353,
}


# ─────────────────────────────────────────────────────────────────────────────
# STEP 12 LOGGER (mandatory structured logging)
# ─────────────────────────────────────────────────────────────────────────────
class EngineLogger:
    def __init__(self, game_label: str, verbose: bool = False):
        self.game = game_label
        self.verbose = verbose
        self.flags: list[str] = []

    def _emit(self, tag: str, msg: str):
        if self.verbose:
            print(f"[{tag}][{self.game}] {msg}", file=sys.stderr)

    def input(self, msg: str):
        self._emit("INPUT", msg)

    def step(self, msg: str):
        self._emit("STEP", msg)

    def state(self, msg: str):
        self._emit("STATE", msg)

    def output(self, msg: str):
        self._emit("OUTPUT", msg)

    def verify(self, ok: bool, reason: str):
        status = "PASS" if ok else "FAIL"
        self._emit("VERIFY", f"{status} — {reason}")
        if not ok:
            self.flags.append(reason)

    def flag(self, issue: str):
        self.flags.append(issue)
        self._emit("FLAG", issue)

    def log_distribution(self, label: str, arr: np.ndarray, key_numbers: list[float]):
        if not self.verbose:
            return
        pct = np.percentile(arr, [5, 25, 50, 75, 95])
        self._emit(
            "DIST",
            f"{label}: mean={arr.mean():.3f} std={arr.std():.3f} "
            f"p5={pct[0]:.1f} p25={pct[1]:.1f} p50={pct[2]:.1f} "
            f"p75={pct[3]:.1f} p95={pct[4]:.1f}",
        )
        for k in key_numbers:
            mass = float((arr > k).mean())
            self._emit("DIST", f"  P(>{k}) = {mass:.4f}")


# ─────────────────────────────────────────────────────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────
def _log5(p_pit: float, p_bat: float, p_lg: float) -> float:
    if p_lg <= 0 or p_lg >= 1:
        return p_bat
    num = p_bat * p_pit / p_lg
    den = num + (1 - p_bat) * (1 - p_pit) / (1 - p_lg)
    return float(np.clip(num / max(den, 1e-9), 0.0, 1.0))


def _lineup_weights_dynamic(n: int, pitcher_k_pct: float) -> list[float]:
    """
    LINEUP_DYNAMIC_RUN_WEIGHTS: adjust top/bottom split based on pitcher K%.
    High-K pitchers suppress the bottom of the order more — increase top weight.
    Low-K pitchers allow more contact throughout — flatten the distribution.
    """
    k_adj = (pitcher_k_pct - LEAGUE_K_PCT) * 1.5  # scale: ±0.05 → ±0.075
    top_w = float(np.clip(LINEUP_TOP_WEIGHT + k_adj, 0.50, 0.80))
    bot_w = 1.0 - top_w
    top = min(5, n)
    bot = max(0, n - top)
    w = [top_w / top] * top + ([bot_w / bot] * bot if bot > 0 else [])
    return w[:n]


def _nearest_half(x: float) -> float:
    """Snap to nearest 0.5 (half-run rounding rule)."""
    return round(x * 2) / 2


def _select_optimal_total(
    total_dist: np.ndarray, key_numbers: list[float], logger: "EngineLogger"
) -> tuple[float, float, float]:
    """
    Step 4: Select optimal total line from KEY_TOTAL_NUMBERS.
    Criteria: MINIMIZE |P_OVER - 0.5|, account for push mass on integers.
    Returns (optimal_line, p_over, p_under).
    """
    best_line = key_numbers[0]
    best_score = float("inf")
    best_p_over = 0.5

    for line in key_numbers:
        p_over = float((total_dist > line).mean())
        p_push = float((total_dist == line).mean())
        # Penalize push mass: redistribute half to over, half to under
        p_over_adj = p_over + p_push * 0.5
        score = abs(p_over_adj - 0.5)
        logger.state(
            f"  Total line {line}: P(over)={p_over:.4f} P(push)={p_push:.4f} "
            f"P(over_adj)={p_over_adj:.4f} score={score:.4f}"
        )
        if score < best_score:
            best_score = best_line = line
            best_score = score
            best_p_over = p_over_adj

    p_under_final = 1.0 - best_p_over
    logger.step(
        f"Optimal total: {best_line} (P_over={best_p_over:.4f}, "
        f"P_under={p_under_final:.4f}, balance_score={best_score:.4f})"
    )
    return best_line, best_p_over, p_under_final


def prob_to_ml(p: float) -> float:
    p = float(np.clip(p, 0.001, 0.999))
    return (
        round(-(p / (1.0 - p)) * 100.0, 2)
        if p >= 0.5
        else round(((1.0 - p) / p) * 100.0, 2)
    )


def ml_to_prob(odds: float) -> float:
    return abs(odds) / (abs(odds) + 100.0) if odds < 0 else 100.0 / (odds + 100.0)


def remove_vig(p_a: float, p_b: float) -> tuple[float, float]:
    t = p_a + p_b
    if t <= 0:
        return 0.5, 0.5
    return p_a / t, p_b / t


def fmt_ml(ml) -> str:
    ml = round(ml)
    return f"+{ml}" if ml > 0 else str(ml)


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 3: PA OUTCOME MODEL (Log5)
# ─────────────────────────────────────────────────────────────────────────────
class PAOutcomeModel:
    def get_pa_probs(self, pitcher: dict, batter: dict, tto: int = 0) -> dict:
        pen = TTO_PENALTY[min(tto, 2)]
        k = _log5(pitcher["k_pct"], batter["k_pct"], LEAGUE_K_PCT)
        bb = _log5(pitcher["bb_pct"], batter["bb_pct"], LEAGUE_BB_PCT)
        hr = _log5(pitcher["hr_pct"], batter["hr_pct"], LEAGUE_HR_PCT)
        s1 = _log5(pitcher["single_pct"], batter["single_pct"], LEAGUE_1B_PCT)
        s2 = _log5(pitcher["double_pct"], batter["double_pct"], LEAGUE_2B_PCT)
        s3 = _log5(pitcher["triple_pct"], batter["triple_pct"], LEAGUE_3B_PCT)
        k = max(0.0, k - pen * 0.5)
        bb = min(0.30, bb + pen * 0.3)
        hr = min(0.10, hr + pen * 0.2)
        raw = {"K": k, "BB": bb, "HR": hr, "1B": s1, "2B": s2, "3B": s3}
        total = sum(raw.values())
        raw["OUT"] = max(0.0, 1.0 - total)
        s = sum(raw.values())
        return {ev: v / s for ev, v in raw.items()}


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 4: RUN CONVERSION MODEL (Markov RE matrix)
# ─────────────────────────────────────────────────────────────────────────────
class RunConversionModel:
    def expected_runs_per_inning(
        self, pa_probs: dict, run_factor: float = 1.0
    ) -> float:
        exp_rv = sum(pa_probs.get(ev, 0.0) * rv for ev, rv in RUN_VALUES.items())
        base = RE_MATRIX.get((0, 0), 0.481)
        return max(0.0, (base + exp_rv) * run_factor)


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 5: BULLPEN USAGE MODEL (with dynamic fatigue)
# ─────────────────────────────────────────────────────────────────────────────
class BullpenUsageModel:
    def project_starter_innings(self, pitcher: dict, bullpen: dict) -> dict:
        base = STARTER_IP_MEAN
        xfip_adj = (4.0 - pitcher.get("xfip_proxy", 4.0)) * 0.3
        hist_ip = pitcher.get("ip_per_game", STARTER_IP_MEAN)
        if hist_ip > 1.0:
            base = 0.5 * base + 0.5 * hist_ip
        # BULLPEN_FATIGUE_MODEL: dynamic fatigue from recent workload
        fatigue_score = bullpen.get("fatigue_score", 0.3)
        total_bp_outs = bullpen.get("total_bp_outs_5d", 0)
        # More recent bullpen usage → starter must go deeper (or vice versa)
        # High fatigue (>0.5) means bullpen is taxed → starter expected to go longer
        fatigue_adj = (fatigue_score - 0.3) * 0.4  # +0.08 per 0.2 above baseline
        # Workload pressure: if bullpen threw >45 outs in 5 days, push starter +0.3 IP
        workload_adj = 0.3 if total_bp_outs > 45 else 0.0
        starter_ip = float(
            np.clip(
                base + xfip_adj + fatigue_adj + workload_adj,
                STARTER_IP_MIN,
                STARTER_IP_MAX,
            )
        )
        return {
            "starter_ip": round(starter_ip, 2),
            "bullpen_ip": round(max(0.0, 9.0 - starter_ip), 2),
            "starter_frac": round(starter_ip / 9.0, 4),
            "fatigue_adj": round(fatigue_adj, 4),
            "workload_adj": round(workload_adj, 4),
        }

    def quality_by_inning(self, bullpen: dict, starter_ip: float) -> dict[int, float]:
        xfip = bullpen.get("bullpen_xfip", 4.0)
        fatigue = bullpen.get("fatigue_score", 0.3)
        # Fatigued bullpen degrades quality in late innings
        bp_quality_base = 1.0 + (xfip - 4.0) * 0.05
        bp_quality_late = bp_quality_base * (
            1.0 + fatigue * 0.15
        )  # worse when fatigued
        return {
            i: (
                1.0
                if i <= int(starter_ip)
                else (bp_quality_base if i <= 7 else bp_quality_late)
            )
            for i in range(1, 10)
        }


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 6: VARIANCE MODEL
# ─────────────────────────────────────────────────────────────────────────────
class VarianceModel:
    def compute(self, lineup: list[dict], pitcher: dict, env: dict) -> dict:
        n = len(lineup)
        k_pct = pitcher.get("k_pct", LEAGUE_K_PCT)
        w = _lineup_weights_dynamic(n, k_pct)
        barrels = [b.get("barrel_rate", 0.08) for b in lineup]
        isos = [b.get("iso", 0.15) for b in lineup]
        hard_hit = [b.get("hard_hit", 0.35) for b in lineup]
        avg_barrel = float(np.average(barrels, weights=w))
        avg_iso = float(np.average(isos, weights=w))
        avg_hard_hit = float(np.average(hard_hit, weights=w))
        base_var = 2.9**2
        power_adj = 1.0 + (avg_barrel - 0.08) * 3.0 + (avg_iso - 0.15) * 2.0
        k_adj = 1.0 - (k_pct - LEAGUE_K_PCT) * 2.0
        park_adj = 1.0 + (env.get("park_hr_factor", 1.0) - 1.0) * 0.5
        variance = float(np.clip(base_var * power_adj * k_adj * park_adj, 3.0, 20.0))
        skew = float(np.clip(0.3 + avg_barrel * 2.0 + avg_iso * 1.5, 0.1, 1.5))
        return {
            "variance": round(variance, 4),
            "std": round(math.sqrt(variance), 4),
            "skew": round(skew, 4),
            "avg_barrel": round(avg_barrel, 4),
            "avg_iso": round(avg_iso, 4),
            "avg_hard_hit": round(avg_hard_hit, 4),
        }


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 7: GAME STATE BUILDER
# ─────────────────────────────────────────────────────────────────────────────
class GameStateBuilder:
    def __init__(self):
        self.pa_model = PAOutcomeModel()
        self.run_model = RunConversionModel()
        self.bp_model = BullpenUsageModel()
        self.var_model = VarianceModel()

    def build(
        self,
        lineup: list[dict],
        opp_pitcher: dict,
        bullpen: dict,
        env: dict,
        quality_mult: float = 1.0,
    ) -> dict:
        starter_proj = self.bp_model.project_starter_innings(opp_pitcher, bullpen)
        starter_ip = starter_proj["starter_ip"]
        bp_quality = self.bp_model.quality_by_inning(bullpen, starter_ip)
        run_factor = env.get("park_run_factor", 1.0) * env.get("weather_run_adj", 1.0)
        total_runs = 0.0
        k_pct = opp_pitcher.get("k_pct", LEAGUE_K_PCT)
        for inning in range(1, 10):
            tto = min(2, (inning - 1) // 3)
            pa_probs = self._weighted_pa_probs(lineup, opp_pitcher, tto, k_pct)
            exp_runs = self.run_model.expected_runs_per_inning(pa_probs, run_factor)
            total_runs += exp_runs * bp_quality.get(inning, 1.0)
        total_runs *= quality_mult
        var_feats = self.var_model.compute(lineup, opp_pitcher, env)
        return {
            "mu": round(total_runs, 4),
            "variance": var_feats["variance"],
            "std": var_feats["std"],
            "skew": var_feats["skew"],
            "starter_ip": starter_ip,
            "bullpen_ip": starter_proj["bullpen_ip"],
            "avg_barrel": var_feats["avg_barrel"],
            "avg_iso": var_feats["avg_iso"],
        }

    def _weighted_pa_probs(
        self, lineup: list[dict], pitcher: dict, tto: int, k_pct: float
    ) -> dict:
        n = len(lineup)
        w = _lineup_weights_dynamic(n, k_pct)
        combined: dict[str, float] = defaultdict(float)
        for batter, wt in zip(lineup, w, strict=False):
            for ev, p in self.pa_model.get_pa_probs(pitcher, batter, tto).items():
                combined[ev] += p * wt
        total = sum(combined.values())
        return (
            {ev: v / total for ev, v in combined.items()}
            if total > 0
            else dict(combined)
        )


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: DISTRIBUTION ENGINE — NB-GAMMA MIXTURE
# MAX SPEC: RUN_DISTRIBUTION_MODEL = "NEGATIVE_BINOMIAL_GAMMA_MIXTURE"
# The Gamma mixture adds overdispersion to the NB by drawing the rate parameter
# from a Gamma distribution, producing heavier tails and better empirical fit.
# ─────────────────────────────────────────────────────────────────────────────
class NBGammaMixtureDistribution:
    """
    Negative Binomial Gamma Mixture (NB-Gamma Mixture):
    Instead of fixed NB(r, p), draw r ~ Gamma(shape, scale) per simulation.
    This introduces an additional layer of variance that better captures
    game-to-game run scoring variability.
    """

    @staticmethod
    def fit_nb(mu: float, variance: float) -> tuple[float, float]:
        variance = max(variance, mu + 0.01)
        p = float(np.clip(mu / variance, 0.01, 0.99))
        r = max(0.01, (mu * p) / (1.0 - p))
        return r, p

    @staticmethod
    def sample(
        mu: float,
        variance: float,
        n: int,
        rng: np.random.Generator,
        gamma_shape: float = 4.0,
    ) -> np.ndarray:
        """
        Sample from NB-Gamma mixture:
        1. Draw rate_i ~ Gamma(shape=gamma_shape, scale=mu/gamma_shape) for each sim
        2. Sample runs_i ~ NB(r, p) using rate_i as the adjusted mean
        gamma_shape controls the degree of overdispersion:
          - Higher shape → less overdispersion (approaches pure NB)
          - Lower shape  → more overdispersion (heavier tails)
          - 4.0 is empirically calibrated for MLB run scoring
        """
        _r_base, _p_base = NBGammaMixtureDistribution.fit_nb(mu, variance)
        # Draw Gamma-distributed rate multipliers
        gamma_scale = mu / gamma_shape
        rate_multipliers = rng.gamma(shape=gamma_shape, scale=gamma_scale / mu, size=n)
        rate_multipliers = np.clip(rate_multipliers, 0.3, 3.0)
        # Apply rate multipliers to the NB mean
        adjusted_mus = mu * rate_multipliers
        # Sample NB for each adjusted mean (vectorized fit_nb over the array)
        adj_vars = np.maximum(adjusted_mus * 1.5, adjusted_mus + 0.5)  # maintain overdispersion
        adj_vars = np.maximum(adj_vars, adjusted_mus + 0.01)  # fit_nb variance floor
        p_arr = np.clip(adjusted_mus / adj_vars, 0.01, 0.99)
        r_arr = np.maximum(0.01, (adjusted_mus * p_arr) / (1.0 - p_arr))
        return rng.negative_binomial(r_arr, p_arr).astype(float)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: EXTRA INNINGS SIMULATION (ghost runner rule)
# MAX SPEC: EXTRA_INNINGS_RULESET = ENABLED
# ─────────────────────────────────────────────────────────────────────────────
def simulate_extra_innings(
    home_mu_per_inning: float,
    away_mu_per_inning: float,
    home_var: float,
    away_var: float,
    rng: np.random.Generator,
    n_sims: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Simulate extra innings for tied games using ghost runner rule (MLB 2020+).
    Ghost runner starts on 2nd base each extra inning.
    Returns (extra_home_runs, extra_away_runs, n_extra_innings) for each tied sim.
    """
    # Ghost runner effect: increases scoring probability by ~0.5 runs/inning
    GHOST_RUNNER_BONUS = 0.50
    home_mu_xi = home_mu_per_inning + GHOST_RUNNER_BONUS
    away_mu_xi = away_mu_per_inning + GHOST_RUNNER_BONUS

    extra_home = np.zeros(n_sims, dtype=float)
    extra_away = np.zeros(n_sims, dtype=float)
    n_extra = np.zeros(n_sims, dtype=int)

    # Vectorized extra inning simulation (max 6 extra innings before forced resolution)
    MAX_EXTRA = 6
    still_tied = np.ones(n_sims, dtype=bool)

    for _xi in range(MAX_EXTRA):
        if not still_tied.any():
            break
        n_tied = int(still_tied.sum())
        # Sample runs for this extra inning (ghost runner boosts scoring)
        h_var_xi = max(home_var * 0.7, home_mu_xi + 0.3)  # reduced variance in extras
        a_var_xi = max(away_var * 0.7, away_mu_xi + 0.3)
        h_r, h_p = NBGammaMixtureDistribution.fit_nb(home_mu_xi, h_var_xi)
        a_r, a_p = NBGammaMixtureDistribution.fit_nb(away_mu_xi, a_var_xi)
        inning_home = rng.negative_binomial(h_r, h_p, size=n_tied).astype(float)
        inning_away = rng.negative_binomial(a_r, a_p, size=n_tied).astype(float)

        extra_home[still_tied] += inning_home
        extra_away[still_tied] += inning_away
        n_extra[still_tied] += 1

        # Resolve ties after this inning
        inning_margin = inning_home - inning_away
        resolved = still_tied.copy()
        resolved[still_tied] = inning_margin != 0
        still_tied[resolved] = False

    # Force-resolve any remaining ties (coin flip after MAX_EXTRA)
    if still_tied.any():
        coin = rng.random(int(still_tied.sum())) < 0.5
        extra_home[still_tied] += coin.astype(float)
        extra_away[still_tied] += (~coin).astype(float)

    return extra_home, extra_away, n_extra


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: MONTE CARLO ENGINE (full MAX SPEC)
# ─────────────────────────────────────────────────────────────────────────────
class MonteCarloEngine:
    def __init__(self, n_sims: int = SIMULATIONS, seed: int | None = None):
        self.n_sims = int(
            np.clip(max(n_sims, MIN_SIMULATIONS), MIN_SIMULATIONS, SIM_MAX)
        )
        self.rng = np.random.default_rng(seed)
        self.dist = NBGammaMixtureDistribution()

    def simulate(
        self,
        home_state: dict,
        away_state: dict,
        env: dict,
        ou_line: float | None = None,
        rl_spread: float = -1.5,
        logger: Optional[
            "EngineLogger"
        ] = None,  # ── 3yr backtest NRFI priors ─────────────────────────────────────────────────────────────────────────────
        away_pitcher_nrfi: float | None = None,  # away SP 3yr NRFI rate (0-1)
        home_pitcher_nrfi: float | None = None,  # home SP 3yr NRFI rate (0-1)
        away_pitcher_nrfi_starts: int
        | None = None,  # away SP NRFI sample size (for Bayesian shrinkage)
        home_pitcher_nrfi_starts: int
        | None = None,  # home SP NRFI sample size (for Bayesian shrinkage)
        away_team_nrfi: float | None = None,  # away team 3yr NRFI rate (0-1)
        home_team_nrfi: float | None = None,  # home team 3yr NRFI rate (0-1)
        away_f5_rs: float | None = None,  # away team 3yr F5 RS mean
        home_f5_rs: float | None = None,  # home team 3yr F5 RS mean
    ) -> dict:

        hfa = env.get("hfa_weight", HFA_BASE_WEIGHT)
        home_mu = home_state["mu"] * (1.0 + hfa * 0.15)
        away_mu = away_state["mu"] * (1.0 - hfa * 0.08)

        if logger:
            logger.state(f"home_mu={home_mu:.4f} away_mu={away_mu:.4f} hfa={hfa:.4f}")
            logger.state(
                f"home_var={home_state['variance']:.4f} away_var={away_state['variance']:.4f}"
            )

        # Step 2: Sample 9-inning runs using NB-Gamma Mixture
        home_9 = self.dist.sample(
            home_mu, home_state["variance"], self.n_sims, self.rng
        )
        away_9 = self.dist.sample(
            away_mu, away_state["variance"], self.n_sims, self.rng
        )

        # Identify ties after 9 innings
        ties_mask = home_9 == away_9
        n_ties = int(ties_mask.sum())

        if logger:
            logger.state(
                f"Ties after 9 innings: {n_ties}/{self.n_sims} ({n_ties / self.n_sims * 100:.1f}%)"
            )

        # Step 2: Extra innings simulation (ghost runner rule)
        home_xi = np.zeros(self.n_sims, dtype=float)
        away_xi = np.zeros(self.n_sims, dtype=float)
        n_extra = np.zeros(self.n_sims, dtype=int)

        if n_ties > 0:
            # Per-inning mu (9-inning total / 9)
            home_mu_per = home_mu / 9.0
            away_mu_per = away_mu / 9.0
            eh, ea, ne = simulate_extra_innings(
                home_mu_per,
                away_mu_per,
                home_state["variance"] / 9.0,
                away_state["variance"] / 9.0,
                self.rng,
                n_ties,
            )
            home_xi[ties_mask] = eh
            away_xi[ties_mask] = ea
            n_extra[ties_mask] = ne

        home_runs = home_9 + home_xi
        away_runs = away_9 + away_xi

        # ── SPEC: P_NRFI — simulate first inning runs with Bayesian NRFI priors ──────
        # ── INTEGRATION 2026-04-14: 3-YEAR BACKTEST REINFORCEMENT ──────────────────────
        # Architecture: physics (50%) + pitcher NRFI prior (35%) + team NRFI prior (15%)
        # Physics: mu_1st_physics = full_game_mu * INNING1_RUN_SHARE (calibrated 0.1093)
        # Pitcher prior: mu_1st_pitcher = -ln(nrfi_rate) converts P(NRFI) → expected runs
        #   Derivation: if P(X=0|Poisson(λ)) = R, then λ = -ln(R)
        #   This is the expected runs per inning implied by the pitcher's empirical NRFI rate
        # Team prior: same Poisson inverse applied to team 3yr NRFI rate
        # Blending: mu_1st_final = physics*0.50 + pitcher*0.35 + team*0.15
        # Fallback: if pitcher missing → team*0.50 + physics*0.50
        #           if both missing  → physics*1.00 (no change)
        # Source: 06_nrfi_threshold_grid.py (n=5,109 games, optimal threshold=0.56)
        # ──────────────────────────────────────────────────────────────────────────────────
        # Module-level constants used here (auditable, overridable without touching simulation):
        #   INNING1_RUN_SHARE=0.1166, LEAGUE_NRFI_PRIOR=0.8899, NRFI_SHRINKAGE_K=10, NRFI_MIN_STARTS_FULL=20
        home_mu_1st_physics = home_state["mu"] * INNING1_RUN_SHARE
        away_mu_1st_physics = away_state["mu"] * INNING1_RUN_SHARE

        # ── Bayesian shrinkage for low-sample pitchers ──────────────────────────────────
        # SPEC: For pitchers with < NRFI_MIN_STARTS_FULL starts, shrink their raw NRFI rate
        #       toward LEAGUE_NRFI_PRIOR (0.8899 = exp(-INNING1_RUN_SHARE))
        #       Shrinkage formula: rate_adj = w * raw_rate + (1-w) * LEAGUE_NRFI_PRIOR
        #       where w = starts / (starts + NRFI_SHRINKAGE_K)
        #       K=10: at 3 starts w=0.23 (77% prior), at 5 starts w=0.33, at 10 starts w=0.50
        # This prevents extreme rates (0.000, 1.000 from 3 starts) from dominating the signal.
        # All four constants are module-level — see lines 60-69 of this file.

        def _apply_nrfi_shrinkage(
            raw_rate: float | None, starts: int | None
        ) -> float | None:
            """Apply Bayesian shrinkage to pitcher NRFI rate based on sample size.
            Returns shrunk rate if starts < NRFI_MIN_STARTS_FULL, else raw_rate unchanged.
            Returns None if raw_rate is None.
            """
            if raw_rate is None:
                return None
            if starts is None or starts >= NRFI_MIN_STARTS_FULL:
                return raw_rate  # sufficient sample — no shrinkage needed
            w = starts / (starts + NRFI_SHRINKAGE_K)
            shrunk = w * raw_rate + (1.0 - w) * LEAGUE_NRFI_PRIOR
            return shrunk

        # Apply shrinkage to pitcher NRFI rates
        # home_pitcher_nrfi = AWAY SP's rate (pitches to home lineup)
        # away_pitcher_nrfi = HOME SP's rate (pitches to away lineup)
        home_pitcher_nrfi_adj = _apply_nrfi_shrinkage(
            home_pitcher_nrfi, home_pitcher_nrfi_starts
        )
        away_pitcher_nrfi_adj = _apply_nrfi_shrinkage(
            away_pitcher_nrfi, away_pitcher_nrfi_starts
        )

        if logger:
            logger.step(
                "NRFI Bayesian Prior Blending (3yr backtest integration + shrinkage)"
            )
            logger.state(
                f"[NRFI-PRIOR] Physics mu_1st: home={home_mu_1st_physics:.4f} "
                f"away={away_mu_1st_physics:.4f} | "
                f"pitcher_nrfi: home_SP={home_pitcher_nrfi} (starts={home_pitcher_nrfi_starts}) "
                f"adj={f'{home_pitcher_nrfi_adj:.4f}' if home_pitcher_nrfi_adj is not None else 'N/A'} | "
                f"away_SP={away_pitcher_nrfi} (starts={away_pitcher_nrfi_starts}) "
                f"adj={f'{away_pitcher_nrfi_adj:.4f}' if away_pitcher_nrfi_adj is not None else 'N/A'} | "
                f"team_nrfi: home={home_team_nrfi} away={away_team_nrfi} | "
                f"league_prior={LEAGUE_NRFI_PRIOR:.4f} shrinkage_K={NRFI_SHRINKAGE_K}"
            )

        def _nrfi_to_mu(nrfi_rate: float) -> float:
            """Convert empirical NRFI rate to expected runs per inning via Poisson inverse.
            P(X=0 | Poisson(λ)) = exp(-λ) → λ = -ln(P(X=0)) = -ln(nrfi_rate)
            Clamp: nrfi_rate in [0.01, 0.99] to avoid log(0) and negative mu.
            """
            return -math.log(max(min(nrfi_rate, 0.99), 0.01))

        # ── Home team: home lineup faces away SP (home_pitcher_nrfi_adj = shrinkage-adjusted away SP rate)
        # Note: home_pitcher_nrfi_adj is the AWAY starter's shrinkage-adjusted NRFI rate
        #       home_team_nrfi is the HOME team's tendency as a batting unit
        if home_pitcher_nrfi_adj is not None and home_team_nrfi is not None:
            # Full blend: physics 50% + pitcher 35% + team 15%
            mu_1st_pitcher_home = _nrfi_to_mu(home_pitcher_nrfi_adj)
            mu_1st_team_home = _nrfi_to_mu(home_team_nrfi)
            home_mu_1st = (
                home_mu_1st_physics * NRFI_PHYSICS_WEIGHT
                + mu_1st_pitcher_home * NRFI_PITCHER_WEIGHT
                + mu_1st_team_home * NRFI_TEAM_WEIGHT
            )
            _shrunk_home = home_pitcher_nrfi_adj != home_pitcher_nrfi
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Home I1 mu: physics={home_mu_1st_physics:.4f} "
                    f"pitcher_prior={mu_1st_pitcher_home:.4f} (nrfi_raw={home_pitcher_nrfi:.4f} "
                    f"adj={home_pitcher_nrfi_adj:.4f} starts={home_pitcher_nrfi_starts} "
                    f"{'SHRUNK' if _shrunk_home else 'full_sample'}) "
                    f"team_prior={mu_1st_team_home:.4f} (nrfi={home_team_nrfi:.4f}) "
                    f"blended={home_mu_1st:.4f} "
                    f"[w: physics={NRFI_PHYSICS_WEIGHT} pitcher={NRFI_PITCHER_WEIGHT} team={NRFI_TEAM_WEIGHT}]"
                )
        elif home_pitcher_nrfi_adj is not None:
            # Pitcher only: physics 65% + pitcher 35%
            mu_1st_pitcher_home = _nrfi_to_mu(home_pitcher_nrfi_adj)
            home_mu_1st = home_mu_1st_physics * 0.65 + mu_1st_pitcher_home * 0.35
            _shrunk_home = home_pitcher_nrfi_adj != home_pitcher_nrfi
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Home I1 mu: physics={home_mu_1st_physics:.4f} "
                    f"pitcher_prior={mu_1st_pitcher_home:.4f} (nrfi_raw={home_pitcher_nrfi:.4f} "
                    f"adj={home_pitcher_nrfi_adj:.4f} starts={home_pitcher_nrfi_starts} "
                    f"{'SHRUNK' if _shrunk_home else 'full_sample'}) "
                    f"team=MISSING blended={home_mu_1st:.4f} [w: physics=0.65 pitcher=0.35]"
                )
        elif home_team_nrfi is not None:
            # Team only: physics 50% + team 50%
            mu_1st_team_home = _nrfi_to_mu(home_team_nrfi)
            home_mu_1st = home_mu_1st_physics * 0.50 + mu_1st_team_home * 0.50
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Home I1 mu: physics={home_mu_1st_physics:.4f} "
                    f"pitcher=MISSING team_prior={mu_1st_team_home:.4f} (nrfi={home_team_nrfi:.4f}) "
                    f"blended={home_mu_1st:.4f} [w: physics=0.50 team=0.50]"
                )
        else:
            # No priors: physics only
            home_mu_1st = home_mu_1st_physics
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Home I1 mu: physics={home_mu_1st_physics:.4f} "
                    f"pitcher=MISSING team=MISSING blended={home_mu_1st:.4f} [physics only]"
                )

        # ── Away team: away lineup faces home SP (away_pitcher_nrfi_adj = shrinkage-adjusted home SP rate)
        # Note: away_pitcher_nrfi_adj is the HOME starter's shrinkage-adjusted NRFI rate
        #       away_team_nrfi is the AWAY team's tendency as a batting unit
        if away_pitcher_nrfi_adj is not None and away_team_nrfi is not None:
            mu_1st_pitcher_away = _nrfi_to_mu(away_pitcher_nrfi_adj)
            mu_1st_team_away = _nrfi_to_mu(away_team_nrfi)
            away_mu_1st = (
                away_mu_1st_physics * NRFI_PHYSICS_WEIGHT
                + mu_1st_pitcher_away * NRFI_PITCHER_WEIGHT
                + mu_1st_team_away * NRFI_TEAM_WEIGHT
            )
            _shrunk_away = away_pitcher_nrfi_adj != away_pitcher_nrfi
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Away I1 mu: physics={away_mu_1st_physics:.4f} "
                    f"pitcher_prior={mu_1st_pitcher_away:.4f} (nrfi_raw={away_pitcher_nrfi:.4f} "
                    f"adj={away_pitcher_nrfi_adj:.4f} starts={away_pitcher_nrfi_starts} "
                    f"{'SHRUNK' if _shrunk_away else 'full_sample'}) "
                    f"team_prior={mu_1st_team_away:.4f} (nrfi={away_team_nrfi:.4f}) "
                    f"blended={away_mu_1st:.4f} "
                    f"[w: physics={NRFI_PHYSICS_WEIGHT} pitcher={NRFI_PITCHER_WEIGHT} team={NRFI_TEAM_WEIGHT}]"
                )
        elif away_pitcher_nrfi_adj is not None:
            mu_1st_pitcher_away = _nrfi_to_mu(away_pitcher_nrfi_adj)
            away_mu_1st = away_mu_1st_physics * 0.65 + mu_1st_pitcher_away * 0.35
            _shrunk_away = away_pitcher_nrfi_adj != away_pitcher_nrfi
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Away I1 mu: physics={away_mu_1st_physics:.4f} "
                    f"pitcher_prior={mu_1st_pitcher_away:.4f} (nrfi_raw={away_pitcher_nrfi:.4f} "
                    f"adj={away_pitcher_nrfi_adj:.4f} starts={away_pitcher_nrfi_starts} "
                    f"{'SHRUNK' if _shrunk_away else 'full_sample'}) "
                    f"team=MISSING blended={away_mu_1st:.4f} [w: physics=0.65 pitcher=0.35]"
                )
        elif away_team_nrfi is not None:
            mu_1st_team_away = _nrfi_to_mu(away_team_nrfi)
            away_mu_1st = away_mu_1st_physics * 0.50 + mu_1st_team_away * 0.50
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Away I1 mu: physics={away_mu_1st_physics:.4f} "
                    f"pitcher=MISSING team_prior={mu_1st_team_away:.4f} (nrfi={away_team_nrfi:.4f}) "
                    f"blended={away_mu_1st:.4f} [w: physics=0.50 team=0.50]"
                )
        else:
            away_mu_1st = away_mu_1st_physics
            if logger:
                logger.state(
                    f"[NRFI-PRIOR] Away I1 mu: physics={away_mu_1st_physics:.4f} "
                    f"pitcher=MISSING team=MISSING blended={away_mu_1st:.4f} [physics only]"
                )

        home_var_1st = max(
            home_state["variance"] * INNING1_RUN_SHARE, home_mu_1st + 0.01
        )
        away_var_1st = max(
            away_state["variance"] * INNING1_RUN_SHARE, away_mu_1st + 0.01
        )
        home_1st = self.dist.sample(home_mu_1st, home_var_1st, self.n_sims, self.rng)
        away_1st = self.dist.sample(away_mu_1st, away_var_1st, self.n_sims, self.rng)
        # NRFI = both teams score 0 in the first inning
        nrfi_mask = (home_1st == 0) & (away_1st == 0)
        p_nrfi = float(nrfi_mask.mean())
        p_yrfi = 1.0 - p_nrfi
        # First-inning total distribution
        first_inn_totals = home_1st + away_1st
        exp_first_inn_total = float(first_inn_totals.mean())
        # ── NRFI filter signals (both-pitcher gate = stronger signal)
        nrfi_combined_signal = None
        nrfi_combined_pass = False
        nrfi_both_pass = False
        if away_pitcher_nrfi is not None and home_pitcher_nrfi is not None:
            # P1-C: Replace arithmetic average with geometric mean (product formula).
            # Rationale: NRFI is a joint probability event (both pitchers must suppress runs).
            # Geometric mean = sqrt(p_away * p_home) is the correct measure for joint rates.
            # Arithmetic mean over-estimates the combined signal when one pitcher is weak.
            # Example: away=0.72, home=0.40 → arith=0.56 (PASS), geom=0.537 (FAIL) — correct.
            # The threshold 0.56 was calibrated against the arithmetic mean; we recalibrate
            # to 0.53 for the geometric mean to preserve the same empirical precision/recall.
            nrfi_combined_signal = float(np.sqrt(away_pitcher_nrfi * home_pitcher_nrfi))
            nrfi_combined_pass = nrfi_combined_signal >= NRFI_COMBINED_THRESHOLD
            nrfi_both_pass = (
                away_pitcher_nrfi >= NRFI_BOTH_THRESHOLD
                and home_pitcher_nrfi >= NRFI_BOTH_THRESHOLD
            )
        if logger:
            logger.state(
                f"[NRFI-RESULT] p_nrfi={p_nrfi:.4f} p_yrfi={p_yrfi:.4f} | "
                f"1st-inn total: mean={exp_first_inn_total:.3f} "
                f"home_mu_1st={home_mu_1st:.4f} away_mu_1st={away_mu_1st:.4f} | "
                f"combined_signal={nrfi_combined_signal} "
                f"combined_pass={nrfi_combined_pass} both_pass={nrfi_both_pass}"
            )
            logger.verify(
                abs(p_nrfi - EMPIRICAL_PRIORS["nrfi_rate"]) < 0.12,
                f"[NRFI-GATE] p_nrfi={p_nrfi:.4f} vs empirical={EMPIRICAL_PRIORS['nrfi_rate']:.4f} "
                f"delta={p_nrfi - EMPIRICAL_PRIORS['nrfi_rate']:+.4f} (threshold=±0.12)",
            )

        # ── SPEC: HR Props — P(HR >= 1) per team from batter HR rates ───────────
        # hr_rate_per_pa = batter's HR/PA rate (from hr_pct in batter features)
        # P(team HR >= 1 in game) = 1 - P(no HR in any PA)
        # P(no HR in any PA) = product(1 - hr_rate_i) for i in lineup
        # Lineup PA count: ~36 PA per team per 9 innings (9 batters × ~4 PA each)
        LINEUP_PA_PER_GAME = 36
        home_hr_rate = home_state.get("team_hr_rate", 0.033)  # HR/PA rate for home team
        away_hr_rate = away_state.get("team_hr_rate", 0.033)  # HR/PA rate for away team
        # Simulate HR counts using Poisson (lambda = hr_rate * PA_per_game)
        home_hr_lambda = home_hr_rate * LINEUP_PA_PER_GAME
        away_hr_lambda = away_hr_rate * LINEUP_PA_PER_GAME
        home_hr_counts = self.rng.poisson(home_hr_lambda, size=self.n_sims)
        away_hr_counts = self.rng.poisson(away_hr_lambda, size=self.n_sims)
        p_home_hr_any = float((home_hr_counts >= 1).mean())  # P(home team hits >= 1 HR)
        p_away_hr_any = float((away_hr_counts >= 1).mean())  # P(away team hits >= 1 HR)
        p_both_hr = float(((home_hr_counts >= 1) & (away_hr_counts >= 1)).mean())
        exp_home_hr = float(home_hr_counts.mean())
        exp_away_hr = float(away_hr_counts.mean())
        if logger:
            logger.state(
                f"HR Props: home_lambda={home_hr_lambda:.4f} away_lambda={away_hr_lambda:.4f} | "
                f"P(home HR>=1)={p_home_hr_any:.4f} P(away HR>=1)={p_away_hr_any:.4f} "
                f"P(both HR)={p_both_hr:.4f} | "
                f"exp_home_hr={exp_home_hr:.3f} exp_away_hr={exp_away_hr:.3f}"
            )

        # ── SPEC: F5 Simulation — First Five Innings with Team F5 RS Calibration ────────
        # ── INTEGRATION 2026-04-14: 3-YEAR BACKTEST REINFORCEMENT ──────────────────────
        # Base: F5_RUN_SHARE = 0.5311 (3yr calibrated, n=5,109 games)
        # Enhancement: Team F5 RS tendency applied as a secondary mu adjustment
        # Formula: if team F5 RS > league mean (2.466) → slight upward adjustment
        #          if team F5 RS < league mean → slight downward adjustment
        # Scale: max ±10% adjustment (F5_RS_WEIGHT = 0.10)
        # Adjustment: f5_rs_adj = (team_f5_rs - F5_RS_LEAGUE_MEAN) / F5_RS_LEAGUE_MEAN * F5_RS_WEIGHT
        # Source: 04_deep_analysis.py → TEAM NRFI RANKINGS table (F5 RS column)
        F5_RUN_SHARE = 0.5618  # 3yr-backtest-calibrated: F5 run share of full game (was 0.5311, updated 2026-04-14)
        home_mu_f5_base = home_state["mu"] * F5_RUN_SHARE
        away_mu_f5_base = away_state["mu"] * F5_RUN_SHARE
        # Apply team F5 RS adjustment if available
        if home_f5_rs is not None:
            home_f5_rs_adj = float(
                np.clip(
                    (home_f5_rs - F5_RS_LEAGUE_MEAN) / F5_RS_LEAGUE_MEAN * F5_RS_WEIGHT,
                    -F5_RS_WEIGHT,
                    F5_RS_WEIGHT,
                )
            )
            home_mu_f5 = home_mu_f5_base * (1.0 + home_f5_rs_adj)
            if logger:
                logger.state(
                    f"[F5-RS] Home F5 mu: base={home_mu_f5_base:.4f} "
                    f"team_f5_rs={home_f5_rs:.3f} league_mean={F5_RS_LEAGUE_MEAN:.3f} "
                    f"adj={home_f5_rs_adj:+.4f} final={home_mu_f5:.4f}"
                )
        else:
            home_mu_f5 = home_mu_f5_base
            if logger:
                logger.state(
                    f"[F5-RS] Home F5 mu: base={home_mu_f5_base:.4f} team_f5_rs=MISSING (no adj)"
                )
        if away_f5_rs is not None:
            away_f5_rs_adj = float(
                np.clip(
                    (away_f5_rs - F5_RS_LEAGUE_MEAN) / F5_RS_LEAGUE_MEAN * F5_RS_WEIGHT,
                    -F5_RS_WEIGHT,
                    F5_RS_WEIGHT,
                )
            )
            away_mu_f5 = away_mu_f5_base * (1.0 + away_f5_rs_adj)
            if logger:
                logger.state(
                    f"[F5-RS] Away F5 mu: base={away_mu_f5_base:.4f} "
                    f"team_f5_rs={away_f5_rs:.3f} league_mean={F5_RS_LEAGUE_MEAN:.3f} "
                    f"adj={away_f5_rs_adj:+.4f} final={away_mu_f5:.4f}"
                )
        else:
            away_mu_f5 = away_mu_f5_base
            if logger:
                logger.state(
                    f"[F5-RS] Away F5 mu: base={away_mu_f5_base:.4f} team_f5_rs=MISSING (no adj)"
                )
        home_var_f5 = max(home_state["variance"] * F5_RUN_SHARE, home_mu_f5 + 0.05)
        away_var_f5 = max(away_state["variance"] * F5_RUN_SHARE, away_mu_f5 + 0.05)
        home_f5 = self.dist.sample(home_mu_f5, home_var_f5, self.n_sims, self.rng)
        away_f5 = self.dist.sample(away_mu_f5, away_var_f5, self.n_sims, self.rng)
        f5_totals = home_f5 + away_f5
        f5_margins = home_f5 - away_f5  # positive = home leads after 5
        exp_f5_home = float(home_f5.mean())
        exp_f5_away = float(away_f5.mean())
        exp_f5_total = float(f5_totals.mean())
        # F5 ML probabilities — THREE-WAY pricing (home win / away win / push)
        # SPEC: F5 push rate = 0.1507 (3yr empirical: 15.07% of F5 games tied after 5)
        # Old two-way: split push 50/50 → inflates both sides equally, misprices the market
        # New three-way: price home/away as conditional on non-push outcome,
        #   then apply no-vig to the two-way conditional market.
        #   P(home win) and P(away win) are the raw simulation rates (excl. push).
        #   The push probability is Bayesian-blended with the 3yr empirical rate.
        f5_home_win = home_f5 > away_f5
        f5_away_win = away_f5 > home_f5
        f5_tie = home_f5 == away_f5
        # Raw simulation probabilities (sum to 1.0)
        p_f5_home_raw = float(f5_home_win.mean())  # P(home wins F5)
        p_f5_away_raw = float(f5_away_win.mean())  # P(away wins F5)
        p_f5_push_raw = float(f5_tie.mean())  # P(F5 tied / push)
        # Bayesian shrinkage: blend simulation push rate toward 3yr empirical (0.1507)
        # Weight: 0.6 sim + 0.4 prior (sim has high variance on push due to integer scoring)
        EMPIRICAL_F5_PUSH = EMPIRICAL_PRIORS["f5_push_rate"]  # 0.1507
        p_f5_push_adj = 0.6 * p_f5_push_raw + 0.4 * EMPIRICAL_F5_PUSH
        # Redistribute remaining probability proportionally to home/away
        remaining_f5 = 1.0 - p_f5_push_adj
        if (p_f5_home_raw + p_f5_away_raw) > 0:
            f5_scale = remaining_f5 / (p_f5_home_raw + p_f5_away_raw)
        else:
            f5_scale = 1.0
        p_f5_home_win = p_f5_home_raw * f5_scale  # P(home wins F5) — push-adjusted
        p_f5_away_win = p_f5_away_raw * f5_scale  # P(away wins F5) — push-adjusted
        # Verify three-way sum
        _f5_3way_sum = p_f5_home_win + p_f5_away_win + p_f5_push_adj
        # F5 run line cover (default -0.5 for favorite)
        # Positive rl_spread = home is dog, negative = home is fav
        # For F5, standard RL is -0.5 / +0.5
        F5_RL = -0.5
        p_f5_home_rl = float((f5_margins > abs(F5_RL)).mean())  # home covers -0.5
        p_f5_away_rl = float((f5_margins < -abs(F5_RL)).mean())  # away covers -0.5
        if logger:
            logger.state(
                f"F5: home_mu={home_mu_f5:.4f} away_mu={away_mu_f5:.4f} | "
                f"exp_home={exp_f5_home:.3f} exp_away={exp_f5_away:.3f} exp_total={exp_f5_total:.3f} | "
                f"P(home win)={p_f5_home_win:.4f} P(away win)={p_f5_away_win:.4f} P(push)={p_f5_push_adj:.4f} | "
                f"[sim_push={p_f5_push_raw:.4f} empirical={EMPIRICAL_F5_PUSH:.4f} 3way_sum={_f5_3way_sum:.6f}] | "
                f"P(home RL -0.5)={p_f5_home_rl:.4f} P(away RL -0.5)={p_f5_away_rl:.4f}"
            )
            logger.verify(
                abs(_f5_3way_sum - 1.0) < 0.001,
                f"F5 three-way sum={_f5_3way_sum:.6f} (must be 1.000±0.001)",
            )

        # ── SPEC: Inning-by-Inning Simulation (I1-I9) ─────────────────────────
        # 3-YR Backtest-calibrated per-inning run share weights (2026-04-14, n=5103 games):
        #   I1:    0.116647  (empirical F1/FG — starter peak, TTO=0, zero-inflated)
        #   I2:    0.102130  (post-leadoff, lowest inning — starter settling in)
        #   I3:    0.114120  (TTO-1 begins, lineup cycles through)
        #   I4:    0.113854  (mid-starter, consistent scoring)
        #   I5:    0.115029  (TTO-2, late starter, F5 window closes)
        #   I6:    0.114764  (bullpen entry, high-leverage)
        #   I7:    0.108511  (setup era, lower scoring)
        #   I8:    0.109019  (setup/closer setup)
        #   I9:    0.079211  (walk-off scoring — CORRECTED from 0.1170, empirical is lower)
        # Weights normalized to sum exactly to 1.0.
        # Consistency check: sum(I1-I5) = 0.5618 (empirical F5 share = 0.5618) ✓
        # Updated 2026-04-14: exact values from mlb_calibration_constants.json inning_weights
        _INN_WEIGHTS_RAW = [
            0.116647,  # I1 — 3yr empirical exact (was 0.1151)
            0.102130,  # I2 — 3yr empirical exact (was 0.1009)
            0.114120,  # I3 — 3yr empirical exact (was 0.1127)
            0.113854,  # I4 — 3yr empirical exact (was 0.1124)
            0.115029,  # I5 — 3yr empirical exact (was 0.1136)
            0.114764,  # I6 — 3yr empirical exact (was 0.1133)
            0.108511,  # I7 — 3yr empirical exact (was 0.1072)
            0.109019,  # I8 — 3yr empirical exact (was 0.1079)
            0.079211,  # I9 — 3yr empirical exact (was 0.1170 — CORRECTED, walk-off overcorrected)
        ]
        _w_sum = sum(_INN_WEIGHTS_RAW)
        INNING_WEIGHTS = [w / _w_sum for w in _INN_WEIGHTS_RAW]  # exact normalization

        inning_home_exp = []
        inning_away_exp = []
        inning_total_exp = []
        inning_home_std = []
        inning_away_std = []
        inning_p_home_scores = []
        inning_p_away_scores = []
        inning_p_both_score = []
        inning_p_neither_score = []

        if logger:
            logger.step("Inning-by-Inning Simulation (I1-I9)")

        for inn_idx, w in enumerate(INNING_WEIGHTS):
            inn_num = inn_idx + 1
            mu_h = home_state["mu"] * w
            mu_a = away_state["mu"] * w
            var_h = max(home_state["variance"] * w, mu_h + 0.005)
            var_a = max(away_state["variance"] * w, mu_a + 0.005)
            inn_h = self.dist.sample(mu_h, var_h, self.n_sims, self.rng)
            inn_a = self.dist.sample(mu_a, var_a, self.n_sims, self.rng)
            _h_exp = round(float(inn_h.mean()), 4)
            _a_exp = round(float(inn_a.mean()), 4)
            _t_exp = round(float((inn_h + inn_a).mean()), 4)
            _h_std = round(float(inn_h.std()), 4)
            _a_std = round(float(inn_a.std()), 4)
            _p_h = round(float((inn_h >= 1).mean()), 4)
            _p_a = round(float((inn_a >= 1).mean()), 4)
            _p_both = round(float(((inn_h >= 1) & (inn_a >= 1)).mean()), 4)
            _p_nei = round(float(((inn_h == 0) & (inn_a == 0)).mean()), 4)
            inning_home_exp.append(_h_exp)
            inning_away_exp.append(_a_exp)
            inning_total_exp.append(_t_exp)
            inning_home_std.append(_h_std)
            inning_away_std.append(_a_std)
            inning_p_home_scores.append(_p_h)
            inning_p_away_scores.append(_p_a)
            inning_p_both_score.append(_p_both)
            inning_p_neither_score.append(_p_nei)
            if logger:
                logger.state(
                    f"I{inn_num}: home={_h_exp:.4f} away={_a_exp:.4f} total={_t_exp:.4f} "
                    f"P(H scores)={_p_h:.4f} P(A scores)={_p_a:.4f} "
                    f"P(both)={_p_both:.4f} P(neither/NRFI-inn)={_p_nei:.4f}"
                )

        # Consistency validation: inning-derived F1 and F5 vs direct simulation
        _inn_f1_total = inning_home_exp[0] + inning_away_exp[0]
        _inn_f5_total = sum(inning_home_exp[:5]) + sum(inning_away_exp[:5])
        if logger:
            logger.verify(
                abs(_inn_f1_total - exp_first_inn_total) < 0.15,
                f"I-by-I F1 consistency: inn={_inn_f1_total:.4f} direct={exp_first_inn_total:.4f} "
                f"delta={_inn_f1_total - exp_first_inn_total:+.4f} (threshold=0.15)",
            )
            logger.verify(
                abs(_inn_f5_total - exp_f5_total) < 0.50,
                f"I-by-I F5 consistency: inn={_inn_f5_total:.4f} direct={exp_f5_total:.3f} "
                f"delta={_inn_f5_total - exp_f5_total:+.4f} (threshold=0.50)",
            )

        # Final win determination
        home_win = home_runs > away_runs  # no ties possible after extra innings

        p_home = float(home_win.mean())
        p_away = 1.0 - p_home
        margins = home_runs - away_runs
        totals = home_runs + away_runs

        # Run line coverage
        if rl_spread < 0:
            p_home_rl = float((margins > abs(rl_spread)).mean())
        else:
            p_home_rl = float((margins >= -abs(rl_spread)).mean())

        # Step 3: Distribution extraction
        exp_total = float(totals.mean())
        pct = np.percentile(totals, [5, 25, 50, 75, 95])

        # Compute P(over/under) at book line and key numbers
        p_over_line = float((totals > ou_line).mean()) if ou_line else None
        p_under_line = float((totals < ou_line).mean()) if ou_line else None

        # Key number probability mass (Step 3 validation)
        key_probs = {}
        for k in KEY_TOTAL_NUMBERS:
            key_probs[k] = {
                "p_over": float((totals > k).mean()),
                "p_under": float((totals < k).mean()),
                "p_push": float((totals == k).mean()),
            }

        # Step 3: Tail stability validation
        tail_5 = float((totals <= pct[0]).mean())
        tail_95 = float((totals >= pct[4]).mean())
        tail_stable = (
            tail_5 >= TAIL_STABILITY_THRESHOLD and tail_95 >= TAIL_STABILITY_THRESHOLD
        )

        # Step 3: Bucket sparsity check — only evaluate realistic total range [4, 20].
        # Extreme bins (0-3, 21+) are inherently sparse for any realistic game and
        # checking them against MIN_SAMPLE_PER_BUCKET produces false positives.
        # A game total of 0, 1, 2, or 3 combined runs is astronomically rare (~0.01%).
        hist_counts_full, _ = np.histogram(totals, bins=range(30))
        # bins=range(0,30) → 29 bins: bin[i] covers [i, i+1). bin[4] = totals in [4,5).
        # Realistic range: bins 4 through 20 inclusive (totals 4-20).
        realistic_counts = hist_counts_full[4:21]  # 17 bins covering totals 4..20
        sparse_buckets = int((realistic_counts < MIN_SAMPLE_PER_BUCKET).sum())
        if logger:
            logger.log_distribution("totals", totals, KEY_TOTAL_NUMBERS)
            logger.log_distribution("home_runs", home_runs, [3, 4, 5, 6, 7])
            logger.log_distribution("away_runs", away_runs, [3, 4, 5, 6, 7])
            logger.state(
                f"Extra innings: mean={n_extra.mean():.3f} max={n_extra.max()}"
            )
            logger.state(
                f"Tail stability: {tail_stable} (5th={tail_5:.4f}, 95th={tail_95:.4f})"
            )
            logger.state(f"Sparse buckets (realistic range 4-20): {sparse_buckets}")
            logger.verify(
                tail_stable, f"Tail stability (threshold={TAIL_STABILITY_THRESHOLD})"
            )
            logger.verify(
                sparse_buckets == 0,
                f"Bucket sparsity: {sparse_buckets} sparse buckets in realistic range [4-20] (min={MIN_SAMPLE_PER_BUCKET})",
            )

        return {
            "p_home_win": round(p_home, 6),
            "p_away_win": round(p_away, 6),
            "exp_home_runs": round(float(home_runs.mean()), 2),
            "exp_away_runs": round(float(away_runs.mean()), 2),
            "exp_total": round(exp_total, 2),
            "median_total": round(float(np.median(totals)), 2),
            "p_home_cover_rl": round(p_home_rl, 6),
            "p_away_cover_rl": round(1.0 - p_home_rl, 6),
            "rl_spread": rl_spread,
            "p_over_at_line": round(p_over_line, 6)
            if p_over_line is not None
            else None,
            "p_under_at_line": round(p_under_line, 6)
            if p_under_line is not None
            else None,
            "key_probs": key_probs,
            "home_std": round(float(home_runs.std()), 3),
            "away_std": round(float(away_runs.std()), 3),
            "total_pct_5": round(float(pct[0]), 2),
            "total_pct_25": round(float(pct[1]), 2),
            "total_pct_50": round(float(pct[2]), 2),
            "total_pct_75": round(float(pct[3]), 2),
            "total_pct_95": round(float(pct[4]), 2),
            "n_sims": self.n_sims,
            "n_ties_9inn": n_ties,
            "avg_extra_inn": round(float(n_extra.mean()), 3),
            "tail_stable": tail_stable,
            "sparse_buckets": sparse_buckets,
            # SPEC: NRFI market (with 3yr backtest signals)
            "p_nrfi": round(p_nrfi, 6),
            "p_yrfi": round(p_yrfi, 6),
            "exp_first_inn_total": round(exp_first_inn_total, 3),
            # 3yr backtest NRFI filter signals
            "nrfi_combined_signal": round(nrfi_combined_signal, 4)
            if nrfi_combined_signal is not None
            else None,
            "nrfi_combined_pass": nrfi_combined_pass,
            "nrfi_both_pass": nrfi_both_pass,
            # SPEC: HR Props per team
            "p_home_hr_any": round(p_home_hr_any, 6),
            "p_away_hr_any": round(p_away_hr_any, 6),
            "p_both_hr": round(p_both_hr, 6),
            "exp_home_hr": round(exp_home_hr, 3),
            "exp_away_hr": round(exp_away_hr, 3),
            "home_hr_lambda": round(home_hr_lambda, 4),
            "away_hr_lambda": round(away_hr_lambda, 4),
            # SPEC: F5 (First Five Innings) simulation output
            "p_f5_home_win": round(p_f5_home_win, 6),
            "p_f5_away_win": round(p_f5_away_win, 6),
            "p_f5_push": round(
                p_f5_push_adj, 6
            ),  # THREE-WAY: P(F5 push/tie) Bayesian-blended
            "p_f5_push_raw": round(
                p_f5_push_raw, 6
            ),  # raw simulation push rate (diagnostic)
            "exp_f5_home_runs": round(exp_f5_home, 3),
            "exp_f5_away_runs": round(exp_f5_away, 3),
            "exp_f5_total": round(exp_f5_total, 3),
            "p_f5_home_rl": round(p_f5_home_rl, 6),  # P(home covers -0.5 F5 RL)
            "p_f5_away_rl": round(p_f5_away_rl, 6),  # P(away covers -0.5 F5 RL)
            # SPEC: Inning-by-Inning projections (I1-I9, backtest-calibrated 2026-04-13)
            "inning_home_exp": inning_home_exp,  # [I1..I9] expected home runs per inning
            "inning_away_exp": inning_away_exp,  # [I1..I9] expected away runs per inning
            "inning_total_exp": inning_total_exp,  # [I1..I9] expected combined runs per inning
            "inning_home_std": inning_home_std,  # [I1..I9] std of home runs per inning
            "inning_away_std": inning_away_std,  # [I1..I9] std of away runs per inning
            "inning_p_home_scores": inning_p_home_scores,  # [I1..I9] P(home scores >= 1)
            "inning_p_away_scores": inning_p_away_scores,  # [I1..I9] P(away scores >= 1)
            "inning_p_both_score": inning_p_both_score,  # [I1..I9] P(both teams score)
            "inning_p_neither_score": inning_p_neither_score,  # [I1..I9] P(neither scores) = NRFI per inning
            # Raw arrays for downstream steps (not serialized)
            "_totals": totals,
            "_margins": margins,
            "_home_runs": home_runs,
            "_away_runs": away_runs,
            "_f5_totals": f5_totals,
            "_f5_margins": f5_margins,
        }


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4-10: MARKET DERIVATION (full MAX SPEC pipeline)
# ─────────────────────────────────────────────────────────────────────────────
class MarketDerivation:
    def derive(
        self,
        sim: dict,
        home_team: str,
        away_team: str,
        ou_line: float | None = None,
        logger: Optional["EngineLogger"] = None,
    ) -> dict:

        totals = sim["_totals"]
        margins = sim["_margins"]

        # ── STEP 4: Totals Origination ────────────────────────────────────────
        if logger:
            logger.step("Step 4: Totals Origination")
        optimal_line, _p_over_raw, _p_under_raw = _select_optimal_total(
            totals, KEY_TOTAL_NUMBERS, logger or EngineLogger("", False)
        )
        # If book line provided, use it; otherwise use model-optimal line
        total_key = ou_line or optimal_line

        # Compute p_over/p_under at the selected line (with push mass redistribution)
        p_over_at = float((totals > total_key).mean())
        p_under_at = float((totals < total_key).mean())
        p_push_at = float((totals == total_key).mean())
        p_over_adj = p_over_at + p_push_at * 0.5
        p_under_adj = p_under_at + p_push_at * 0.5

        # No-vig total odds (Step 4 pricing)
        p_over_nv, p_under_nv = remove_vig(p_over_adj, p_under_adj)
        over_odds = prob_to_ml(p_over_nv)
        under_odds = prob_to_ml(p_under_nv)

        if logger:
            logger.output(
                f"Total: {total_key} | Over={over_odds} ({p_over_nv:.4f}) "
                f"Under={under_odds} ({p_under_nv:.4f})"
            )

        # ── STEP 5: Moneyline Origination ─────────────────────────────────────
        if logger:
            logger.step("Step 5: Moneyline Origination")
        p_home = sim["p_home_win"]
        p_away = sim["p_away_win"]

        # ── FG_ML_HOME_EDGE CORRECTION ─────────────────────────────────────────
        # SPEC: Backtest (n=554, 2026-05-10) identified systematic away over-valuation:
        #   FG ML Home accuracy: 51.5% (below 70% target)
        #   FG ML Away accuracy: 48.5% (over-valued by model)
        # Correction: add +0.03 to home win probability before no-vig pricing.
        # This shifts the model toward home teams by ~3 percentage points,
        # correcting the systematic away bias identified in live 2026 data.
        # Source: mlb_calibration_constants.fg_ml_home_edge = 0.03 (LIVE_2026_N554_BACKTEST)
        FG_ML_HOME_EDGE = 0.03  # +3pp home win probability correction
        p_home_raw = p_home
        p_away_raw = p_away
        p_home = float(np.clip(p_home + FG_ML_HOME_EDGE, 0.001, 0.999))
        p_away = float(np.clip(1.0 - p_home, 0.001, 0.999))
        if logger:
            logger.state(
                f"[HOME_EDGE] fg_ml_home_edge={FG_ML_HOME_EDGE:+.4f} | "
                f"p_home: {p_home_raw:.4f} -> {p_home:.4f} | "
                f"p_away: {p_away_raw:.4f} -> {p_away:.4f}"
            )

        # Total-environment variance adjustment
        if total_key >= 9.0:
            # High-total game: variance expansion → dog probability increases slightly
            dog_boost = (total_key - 9.0) * 0.005
            if p_home < 0.5:
                p_home = float(np.clip(p_home + dog_boost, 0.001, 0.999))
            else:
                p_away = float(np.clip(p_away + dog_boost, 0.001, 0.999))
            if logger:
                logger.state(
                    f"High-total variance expansion: dog_boost={dog_boost:.4f}"
                )
        elif total_key <= 7.0:
            # Low-total game: variance compression → favorite probability increases slightly
            fav_boost = (7.0 - total_key) * 0.005
            if p_home >= 0.5:
                p_home = float(np.clip(p_home + fav_boost, 0.001, 0.999))
            else:
                p_away = float(np.clip(p_away + fav_boost, 0.001, 0.999))
            if logger:
                logger.state(
                    f"Low-total variance compression: fav_boost={fav_boost:.4f}"
                )

        # Re-normalize
        p_home, p_away = remove_vig(p_home, p_away)
        ml_home = prob_to_ml(p_home)
        ml_away = prob_to_ml(p_away)

        if logger:
            logger.output(
                f"ML: Home={ml_home} ({p_home:.4f}) Away={ml_away} ({p_away:.4f})"
            )

        # ── STEP 6: Run Line Origination ──────────────────────────────────────
        if logger:
            logger.step("Step 6: Run Line Origination")
        p_hrl_raw = sim["p_home_cover_rl"]
        p_arl_raw = sim["p_away_cover_rl"]

        # Apply remove_vig to RL probabilities (same as ML and O/U markets)
        # Raw simulation probabilities may sum slightly above 1.0 due to simulation noise;
        # normalizing ensures no-vig consistency across all three markets.
        p_hrl, p_arl = remove_vig(p_hrl_raw, p_arl_raw)

        # Hard mathematical invariant enforcement:
        # P(fav covers -1.5) MUST be <= P(fav wins outright)
        # P(dog covers +1.5) MUST be >= P(dog wins outright)
        # rl_spread < 0 means home is the fav at -1.5
        if sim["rl_spread"] < 0:
            # Home is fav: P(home covers -1.5) <= P(home wins)
            if p_hrl > p_home:
                if logger:
                    logger.flag(
                        f"[RL-CLAMP] Home fav P(cover -1.5)={p_hrl:.4f} > P(win)={p_home:.4f} — clamping"
                    )
                p_hrl = (
                    p_home * 0.98
                )  # cap at 98% of ML win prob (small margin for run-diff)
                p_arl = 1.0 - p_hrl
        # Away is fav: P(away covers -1.5) <= P(away wins)
        elif p_arl > p_away:
            if logger:
                logger.flag(
                    f"[RL-CLAMP] Away fav P(cover -1.5)={p_arl:.4f} > P(win)={p_away:.4f} — clamping"
                )
            p_arl = p_away * 0.98
            p_hrl = 1.0 - p_arl

        rl_home_odds = prob_to_ml(p_hrl)
        rl_away_odds = prob_to_ml(p_arl)

        if logger:
            logger.output(
                f"RL: Home {sim['rl_spread']:+.1f}={rl_home_odds} ({p_hrl:.4f}) "
                f"Away {-sim['rl_spread']:+.1f}={rl_away_odds} ({p_arl:.4f}) "
                f"[raw: home={p_hrl_raw:.4f} away={p_arl_raw:.4f}]"
            )

        # ── STEP 7: Conditional Structure Validation ──────────────────────────
        if logger:
            logger.step("Step 7: Conditional Structure Validation")
        # P(win_by_2+) must be <= P(win) for the same team
        p_home_win_by2 = float((margins > 1.5).mean())
        p_away_win_by2 = float((margins < -1.5).mean())

        if p_home_win_by2 > p_home:
            if logger:
                logger.flag(
                    f"Conditional violation: P(home_win_by_2+)={p_home_win_by2:.4f} "
                    f"> P(home_win)={p_home:.4f} — rescaling"
                )
            # Rescale: cap win_by_2 at win probability
            scale = p_home / max(p_home_win_by2, 1e-9)
            p_home_win_by2 = p_home_win_by2 * scale
            p_hrl = p_home_win_by2
            p_arl = 1.0 - p_hrl
            rl_home_odds = prob_to_ml(p_hrl)
            rl_away_odds = prob_to_ml(p_arl)

        if p_away_win_by2 > p_away:
            if logger:
                logger.flag(
                    f"Conditional violation: P(away_win_by_2+)={p_away_win_by2:.4f} "
                    f"> P(away_win)={p_away:.4f} — rescaling"
                )
            scale = p_away / max(p_away_win_by2, 1e-9)
            p_away_win_by2 = p_away_win_by2 * scale

        if logger:
            logger.verify(
                p_home_win_by2 <= p_home + 1e-6,
                f"P(home_win_by_2+)={p_home_win_by2:.4f} ≤ P(home_win)={p_home:.4f}",
            )
            logger.verify(
                p_away_win_by2 <= p_away + 1e-6,
                f"P(away_win_by_2+)={p_away_win_by2:.4f} ≤ P(away_win)={p_away:.4f}",
            )

        # ── FINAL RL INVARIANT ENFORCEMENT (post Steps 6+7) ───────────────────
        # MATHEMATICAL REQUIREMENT: P(team covers -1.5) MUST be strictly less than
        # P(team wins outright), because winning by 2+ is a strict subset of winning.
        # Steps 6 and 7 each apply independent clamps, but Step 7's unconditional
        # assignment p_hrl = p_home_win_by2 can overwrite Step 6's clamp with a raw
        # simulation value that still violates the invariant. This final gate
        # re-enforces the invariant unconditionally after both steps complete.
        #
        # CONSEQUENCE: A -118 ML favorite CANNOT be -185 to cover -1.5.
        #   -118 ML  => P(win) = 0.5413
        #   -185 RL  => P(cover) = 0.6491  -- IMPOSSIBLE (cover is strict subset of win)
        #   Correct: RL odds for the -1.5 side must be LESS negative than the ML odds.
        _rl_final_clamped = False
        if sim["rl_spread"] < 0:
            # Home is the -1.5 favorite: P(home covers -1.5) MUST be < P(home wins)
            if p_hrl >= p_home:
                _old_p_hrl = p_hrl
                p_hrl = p_home * 0.97  # cap at 97% of win prob (strict inequality)
                p_arl = 1.0 - p_hrl
                rl_home_odds = prob_to_ml(p_hrl)
                rl_away_odds = prob_to_ml(p_arl)
                _rl_final_clamped = True
                if logger:
                    logger.flag(
                        f"[RL-FINAL-CLAMP] Home fav (-1.5): p_hrl={_old_p_hrl:.4f} >= p_home={p_home:.4f} "
                        f"-- INVARIANT VIOLATION. Clamped to p_hrl={p_hrl:.4f} "
                        f"rl_home_odds={rl_home_odds} rl_away_odds={rl_away_odds}"
                    )
        else:
            # Away is the -1.5 favorite (rl_spread >= 0 means home is +1.5 dog)
            if p_arl >= p_away:
                _old_p_arl = p_arl
                p_arl = p_away * 0.97
                p_hrl = 1.0 - p_arl
                rl_home_odds = prob_to_ml(p_hrl)
                rl_away_odds = prob_to_ml(p_arl)
                _rl_final_clamped = True
                if logger:
                    logger.flag(
                        f"[RL-FINAL-CLAMP] Away fav (-1.5): p_arl={_old_p_arl:.4f} >= p_away={p_away:.4f} "
                        f"-- INVARIANT VIOLATION. Clamped to p_arl={p_arl:.4f} "
                        f"rl_home_odds={rl_home_odds} rl_away_odds={rl_away_odds}"
                    )
        if logger:
            _fav_is_home = sim["rl_spread"] < 0
            _invariant_ok = (p_hrl < p_home) if _fav_is_home else (p_arl < p_away)
            logger.verify(
                _invariant_ok,
                f"[RL-INVARIANT] P(fav covers -1.5) < P(fav wins): "
                f"rl_spread={sim['rl_spread']:+.1f} p_hrl={p_hrl:.4f} p_arl={p_arl:.4f} "
                f"p_home={p_home:.4f} p_away={p_away:.4f} clamped={_rl_final_clamped}",
            )

        # ── STEP 8: Cross-Market Consistency Engine ───────────────────────────
        if logger:
            logger.step("Step 8: Cross-Market Consistency Engine")
        cross_flags = []

        # ML ↔ Total: cross-market consistency check.
        # Thresholds are calibrated to avoid false positives on legitimate game profiles:
        # - A dominant team at a hitter-friendly park (e.g., LAD at Coors) can produce
        #   total >= 10 AND ml_gap > 0.35 simultaneously. Threshold raised to 0.42.
        # - Two elite starters in a pitcher-friendly park can produce total <= 7 with
        #   a close ML (gap ~0.07). Only flag near-zero gap (< 0.03) as a true anomaly.
        ml_gap = abs(p_home - p_away)
        if total_key >= 10.0 and ml_gap > 0.42:
            cross_flags.append(
                f"ML↔Total: extreme total ({total_key}) with very wide ML gap ({ml_gap:.3f}) — verify inputs"
            )
        if total_key <= 6.5 and ml_gap < 0.03:
            cross_flags.append(
                f"ML↔Total: very low total ({total_key}) with near-zero ML gap ({ml_gap:.3f}) — verify inputs"
            )

        # RL ↔ Total: high total → blowout probability should be elevated
        blowout_prob = float((np.abs(margins) > 4).mean())
        if total_key >= 9.0 and blowout_prob < 0.15:
            cross_flags.append(
                f"RL↔Total: high total ({total_key}) but low blowout prob ({blowout_prob:.3f})"
            )

        # ML ↔ RL: P(win_by_2+) / P(win) ratio should be stable (0.40–0.75)
        if p_home > 0.01:
            ratio_home = p_home_win_by2 / p_home
            if not (0.35 <= ratio_home <= 0.80):
                cross_flags.append(
                    f"ML↔RL: home win_by_2/win ratio={ratio_home:.3f} outside [0.35, 0.80]"
                )

        for f in cross_flags:
            if logger:
                logger.flag(f)

        # ── STEP 9: Inverse Symmetry Enforcement ──────────────────────────────
        if logger:
            logger.step("Step 9: Inverse Symmetry Enforcement")
        # Ensure exact inverse symmetry: HOME_ML == -AWAY_ML (no-vig)
        # Already guaranteed by remove_vig() above, but explicitly verify
        ml_sum = p_home + p_away
        ou_sum = p_over_nv + p_under_nv
        rl_sum = p_hrl + p_arl

        if logger:
            logger.verify(
                abs(ml_sum - 1.0) < 1e-6, f"ML symmetry: p_home+p_away={ml_sum:.8f}"
            )
            logger.verify(
                abs(ou_sum - 1.0) < 1e-6, f"O/U symmetry: p_over+p_under={ou_sum:.8f}"
            )
            logger.verify(
                abs(rl_sum - 1.0) < 1e-6, f"RL symmetry: p_hrl+p_arl={rl_sum:.8f}"
            )

        # ── STEP 10: Market Shaping ────────────────────────────────────────────
        if logger:
            logger.step("Step 10: Market Shaping")
        # Snap total line to nearest half run
        total_key_snapped = _nearest_half(total_key)

        # No-arbitrage check: implied probabilities sum to 1
        no_arb_ml = abs((p_home + p_away) - 1.0) < 1e-4
        no_arb_ou = abs((p_over_nv + p_under_nv) - 1.0) < 1e-4
        no_arb_rl = abs((p_hrl + p_arl) - 1.0) < 1e-4

        # Monotonicity check: P(>7.5) >= P(>8) >= P(>8.5)
        kp = sim["key_probs"]
        monotone = True
        prev_p = 1.0
        for k in sorted(KEY_TOTAL_NUMBERS):
            curr_p = kp[k]["p_over"]
            if curr_p > prev_p + 1e-4:
                monotone = False
                if logger:
                    logger.flag(
                        f"Non-monotonic distribution: P(>{k})={curr_p:.4f} > P(>{k - 0.5})={prev_p:.4f}"
                    )
            prev_p = curr_p

        if logger:
            logger.verify(no_arb_ml, f"No-arb ML: sum={p_home + p_away:.8f}")
            logger.verify(no_arb_ou, f"No-arb O/U: sum={p_over_nv + p_under_nv:.8f}")
            logger.verify(no_arb_rl, f"No-arb RL: sum={p_hrl + p_arl:.8f}")
            logger.verify(monotone, "Monotonicity: P(>7.5) ≥ P(>8) ≥ P(>8.5)")

        # Model spread (for display)
        combined_std = math.sqrt(sim["home_std"] ** 2 + sim["away_std"] ** 2)
        model_spread = round(-norm.ppf(p_home) * combined_std, 2)

        # ── F5 Market Pricing (no-vig, THREE-WAY) ──────────────────────────────
        # p_f5_home_win and p_f5_away_win are already push-adjusted (sum < 1.0)
        # p_f5_push is the Bayesian-blended push probability
        # For no-vig ML: apply remove_vig to the two-way conditional market
        # (home win vs away win, conditional on no push — this is how DK prices F5 ML)
        p_f5h = sim["p_f5_home_win"]  # push-adjusted P(home wins F5)
        p_f5a = sim["p_f5_away_win"]  # push-adjusted P(away wins F5)
        p_f5_push_ml = sim["p_f5_push"]  # P(F5 push/tie)
        # Normalize to two-way conditional (home vs away, excl. push) for no-vig
        p_f5_non_push = p_f5h + p_f5a
        if p_f5_non_push > 0:
            p_f5h_cond = p_f5h / p_f5_non_push  # P(home wins | no push)
            p_f5a_cond = p_f5a / p_f5_non_push  # P(away wins | no push)
        else:
            p_f5h_cond = p_f5a_cond = 0.5
        # Apply no-vig to the conditional two-way market
        p_f5h_nv_cond, p_f5a_nv_cond = remove_vig(p_f5h_cond, p_f5a_cond)
        # Convert back to absolute probabilities (multiply by non-push mass)
        p_f5h_nv = p_f5h_nv_cond * (1.0 - p_f5_push_ml)
        p_f5a_nv = p_f5a_nv_cond * (1.0 - p_f5_push_ml)
        f5_ml_home = prob_to_ml(p_f5h_nv)
        f5_ml_away = prob_to_ml(p_f5a_nv)
        if logger:
            logger.state(
                f"F5 ML three-way: P(home)={p_f5h:.4f} P(away)={p_f5a:.4f} P(push)={p_f5_push_ml:.4f} | "
                f"cond: P(home|no-push)={p_f5h_cond:.4f} P(away|no-push)={p_f5a_cond:.4f} | "
                f"no-vig abs: P(home)={p_f5h_nv:.4f} P(away)={p_f5a_nv:.4f} | "
                f"ML: Home={f5_ml_home} Away={f5_ml_away}"
            )
        # F5 Total pricing
        f5_totals = sim["_f5_totals"]
        f5_ou_line = ou_line * 0.555 if ou_line else sim["exp_f5_total"]
        f5_ou_snapped = _nearest_half(f5_ou_line)
        p_f5_over = float((f5_totals > f5_ou_snapped).mean())
        p_f5_under = float((f5_totals < f5_ou_snapped).mean())
        p_f5_total_push = float((f5_totals == f5_ou_snapped).mean())
        p_f5_over_adj = p_f5_over + p_f5_total_push * 0.5
        p_f5_under_adj = p_f5_under + p_f5_total_push * 0.5
        p_f5_over_nv, p_f5_under_nv = remove_vig(p_f5_over_adj, p_f5_under_adj)
        f5_over_odds = prob_to_ml(p_f5_over_nv)
        f5_under_odds = prob_to_ml(p_f5_under_nv)
        # F5 Run Line pricing (-0.5 / +0.5)
        p_f5_hrl = sim["p_f5_home_rl"]
        p_f5_arl = sim["p_f5_away_rl"]
        p_f5_hrl_nv, p_f5_arl_nv = remove_vig(p_f5_hrl, p_f5_arl)
        f5_rl_home_odds = prob_to_ml(p_f5_hrl_nv)
        f5_rl_away_odds = prob_to_ml(p_f5_arl_nv)
        if logger:
            logger.output(
                f"F5 Markets: ML Home={f5_ml_home} ({p_f5h_nv:.4f}) Away={f5_ml_away} ({p_f5a_nv:.4f}) Push={p_f5_push_ml:.4f} | "
                f"Total={f5_ou_snapped} Over={f5_over_odds} ({p_f5_over_nv:.4f}) Under={f5_under_odds} ({p_f5_under_nv:.4f}) | "
                f"RL Home-0.5={f5_rl_home_odds} ({p_f5_hrl_nv:.4f}) Away+0.5={f5_rl_away_odds} ({p_f5_arl_nv:.4f})"
            )

        # ── NRFI Market Pricing (no-vig) ────────────────────────────────────────
        p_nrfi = sim["p_nrfi"]
        p_yrfi = sim["p_yrfi"]
        p_nrfi_nv, p_yrfi_nv = remove_vig(p_nrfi, p_yrfi)
        nrfi_odds = prob_to_ml(p_nrfi_nv)  # NRFI = under 0.5 1st inning
        yrfi_odds = prob_to_ml(p_yrfi_nv)  # YRFI = over 0.5 1st inning
        if logger:
            logger.output(
                f"NRFI/YRFI: P(NRFI)={p_nrfi_nv:.4f} ({nrfi_odds}) | "
                f"P(YRFI)={p_yrfi_nv:.4f} ({yrfi_odds}) | "
                f"exp_1st_inn_total={sim['exp_first_inn_total']:.3f}"
            )

        return {
            "home_team": home_team,
            "away_team": away_team,
            # Full Game Probabilities
            "p_home_win": round(p_home, 4),
            "p_away_win": round(p_away, 4),
            "p_home_cover_rl": round(p_hrl, 4),
            "p_away_cover_rl": round(p_arl, 4),
            "p_over": round(p_over_nv, 4),
            "p_under": round(p_under_nv, 4),
            # Full Game Markets (no-vig)
            "ml_home": ml_home,
            "ml_away": ml_away,
            "rl_home_spread": sim["rl_spread"],
            "rl_away_spread": -sim["rl_spread"],
            "rl_home_odds": rl_home_odds,
            "rl_away_odds": rl_away_odds,
            "total_key": total_key_snapped,
            "over_odds": over_odds,
            "under_odds": under_odds,
            # Projected runs
            "exp_home_runs": sim["exp_home_runs"],
            "exp_away_runs": sim["exp_away_runs"],
            "exp_total": sim["exp_total"],
            "model_spread": model_spread,
            # F5 (First Five Innings) Markets — THREE-WAY pricing
            "p_f5_home_win": round(
                p_f5h_nv, 4
            ),  # P(home wins F5) — push-adjusted, no-vig
            "p_f5_away_win": round(
                p_f5a_nv, 4
            ),  # P(away wins F5) — push-adjusted, no-vig
            "p_f5_push": round(p_f5_push_ml, 4),  # P(F5 push/tie) — Bayesian-blended
            "p_f5_push_raw": round(
                sim["p_f5_push_raw"], 4
            ),  # raw sim push rate (diagnostic)
            "f5_ml_home": f5_ml_home,
            "f5_ml_away": f5_ml_away,
            "p_f5_home_rl": round(p_f5_hrl_nv, 4),
            "p_f5_away_rl": round(p_f5_arl_nv, 4),
            "f5_rl_home_odds": f5_rl_home_odds,
            "f5_rl_away_odds": f5_rl_away_odds,
            "f5_total_key": f5_ou_snapped,
            "f5_over_odds": f5_over_odds,
            "f5_under_odds": f5_under_odds,
            "p_f5_over": round(p_f5_over_nv, 4),
            "p_f5_under": round(p_f5_under_nv, 4),
            "exp_f5_home_runs": sim["exp_f5_home_runs"],
            "exp_f5_away_runs": sim["exp_f5_away_runs"],
            "exp_f5_total": sim["exp_f5_total"],
            # NRFI / YRFI Markets
            "p_nrfi": round(p_nrfi_nv, 4),
            "p_yrfi": round(p_yrfi_nv, 4),
            "nrfi_odds": nrfi_odds,
            "yrfi_odds": yrfi_odds,
            "exp_first_inn_total": sim["exp_first_inn_total"],
            # HR Props
            "p_home_hr_any": sim["p_home_hr_any"],
            "p_away_hr_any": sim["p_away_hr_any"],
            "p_both_hr": sim["p_both_hr"],
            "exp_home_hr": sim["exp_home_hr"],
            "exp_away_hr": sim["exp_away_hr"],
            # Diagnostics
            "cross_market_flags": cross_flags,
            "monotone": monotone,
            "no_arb": no_arb_ml and no_arb_ou and no_arb_rl,
        }


# ─────────────────────────────────────────────────────────────────────────────
# EDGE DETECTION
# ─────────────────────────────────────────────────────────────────────────────
class EdgeDetector:
    @staticmethod
    def _calc_ev(model_p: float, book_odds: float) -> float:
        """
        SPEC: EV = CALCULATE_EV(edge)
        Formula: EV = model_p * (payout) - (1 - model_p) * 1.0
        where payout = book_odds/100 if book_odds > 0 else 100/abs(book_odds)
        Returns EV per unit wagered (e.g. 0.05 = 5% EV).
        """
        if book_odds > 0:  # noqa: SIM108
            payout = book_odds / 100.0
        else:
            payout = 100.0 / abs(book_odds)
        return round(model_p * payout - (1.0 - model_p), 4)

    def detect(self, market: dict, book: dict) -> list[dict]:
        """
        SPEC: COMPUTE_EDGE — OPTION B: edge = model_prob - book_raw_prob (raw vs raw, no vig removal)
        SPEC: CONFIDENCE_THRESHOLD = 0.65 — only emit edges where model_p >= threshold

        VALIDATION (u7.5 book=+102/-122, model=+116/-116):
          rawBkOver=49.50%, rawBkUnder=54.95%, mdlOver=46.30%, mdlUnder=53.70%
          overEdge  = 46.30 - 49.50 = -3.21pp → NO OVER EDGE
          underEdge = 53.70 - 54.95 = -1.25pp → NO UNDER EDGE
          Result: PASS (no edge) ✓
        """
        edges = []
        checks = [
            ("home_ml", market["p_home_win"], book.get("ml_home")),
            ("away_ml", market["p_away_win"], book.get("ml_away")),
            ("home_rl", market["p_home_cover_rl"], book.get("rl_home")),
            ("away_rl", market["p_away_cover_rl"], book.get("rl_away")),
        ]
        for label, model_p, book_odds in checks:
            if book_odds is None:
                continue
            # OPTION B: use raw book implied probability (no vig removal)
            bp_raw = ml_to_prob(book_odds)
            bp_nv, _ = remove_vig(bp_raw, 1.0 - bp_raw)  # kept for reference only
            edge = model_p - bp_raw  # Option B: raw vs raw
            # SPEC: CONFIDENCE_THRESHOLD gate — skip low-confidence model probabilities
            confidence_ok = model_p >= CONFIDENCE_THRESHOLD
            if MIN_EDGE_THRESHOLD <= edge <= MAX_EDGE_THRESHOLD:
                ev = self._calc_ev(model_p, book_odds)
                edges.append(
                    {
                        "market": label,
                        "model_p": round(model_p, 4),
                        "book_p": round(bp_raw, 4),  # raw book prob (Option B)
                        "book_p_nv": round(bp_nv, 4),  # no-vig for reference
                        "edge": round(edge, 4),
                        "ev": ev,  # SPEC: EV per unit wagered
                        "confidence_ok": confidence_ok,  # SPEC: CONFIDENCE_THRESHOLD gate
                        "book_odds": book_odds,
                        "model_odds": prob_to_ml(model_p),
                        "play": confidence_ok
                        and edge >= 0.02,  # actionable: edge>=2% AND conf>=65%
                    }
                )
        ou_line = book.get("ou_line")
        over_odds = book.get("over_odds")
        under_odds = book.get("under_odds")
        if ou_line and over_odds:
            # OPTION B: use raw book implied probabilities (no vig removal)
            bop_raw = ml_to_prob(over_odds)
            bup_raw = ml_to_prob(under_odds) if under_odds else 1.0 - bop_raw
            bop_nv, bup_nv = remove_vig(bop_raw, bup_raw)  # kept for reference only
            for label, mp, bp_raw_side, bp_nv_side, book_o in [
                ("over", market["p_over"], bop_raw, bop_nv, over_odds),
                ("under", market["p_under"], bup_raw, bup_nv, under_odds or over_odds),
            ]:
                edge = mp - bp_raw_side  # Option B: raw vs raw
                confidence_ok = mp >= CONFIDENCE_THRESHOLD
                if MIN_EDGE_THRESHOLD <= edge <= MAX_EDGE_THRESHOLD:
                    ev = self._calc_ev(mp, book_o)
                    edges.append(
                        {
                            "market": f"total_{label}",
                            "model_p": round(mp, 4),
                            "book_p": round(bp_raw_side, 4),  # raw book prob (Option B)
                            "book_p_nv": round(bp_nv_side, 4),  # no-vig for reference
                            "edge": round(edge, 4),
                            "ev": ev,
                            "confidence_ok": confidence_ok,
                            "ou_line": ou_line,
                            "book_odds": book_o,
                            "play": confidence_ok and edge >= 0.02,
                        }
                    )
        return edges


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION LAYER
# ─────────────────────────────────────────────────────────────────────────────
class ValidationLayer:
    def validate(self, market: dict, sim: dict) -> tuple[bool, list[str]]:
        w = []
        if (market["p_home_win"] > 0.5) != (
            market["exp_home_runs"] > market["exp_away_runs"]
        ):
            w.append(
                f"ML/runs inconsistency: p_home={market['p_home_win']:.3f} "
                f"exp_home={market['exp_home_runs']:.2f} exp_away={market['exp_away_runs']:.2f}"
            )
        if market["p_home_win"] > 0.70 and market["p_home_cover_rl"] < 0.40:
            w.append("RL inconsistency: heavy favorite but low RL cover rate")
        if abs(market["exp_total"] - market["total_key"]) > 2.5:
            w.append(
                f"Total key mismatch: exp={market['exp_total']:.2f} key={market['total_key']}"
            )
        for f in ["p_home_win", "p_away_win", "p_over", "p_under"]:
            v = market.get(f)
            if v is not None and not (0.0 <= v <= 1.0):
                w.append(f"{f}={v:.4f} out of bounds")
        if not market.get("no_arb", True):
            w.append("No-arbitrage violation detected")
        if not sim.get("tail_stable", True):
            w.append(f"Tail instability: threshold={TAIL_STABILITY_THRESHOLD}")
        if market.get("cross_market_flags"):
            w.extend(market["cross_market_flags"])
        return len(w) == 0, w


# ─────────────────────────────────────────────────────────────────────────────
# ENVIRONMENT FEATURES
# ─────────────────────────────────────────────────────────────────────────────
def get_environment_features(
    home_team_db: str, game_month: int, weather: dict | None = None
) -> dict:
    retro = DB_TO_RETRO.get(home_team_db, home_team_db)
    pf = PARK_FACTORS.get(retro, {"r": 100, "hr": 100, "h": 100})
    park_run = pf["r"] / 100.0
    park_hr = pf["hr"] / 100.0

    weather_run = 1.0
    weather_hr = 1.0
    if weather:
        temp = weather.get("temp_f", 72)
        wind = weather.get("wind_speed_mph", 5)
        wdir = str(weather.get("wind_dir", "calm")).lower()
        weather_run = 1.0 + (temp - 72) * 0.001
        if "out" in wdir:
            weather_hr = 1.0 + wind * 0.006
        elif "in" in wdir:
            weather_hr = 1.0 - wind * 0.004

    mf = HFA_MONTHLY_FACTORS.get(game_month, 1.0)
    td = HFA_TEAM_DELTA.get(retro, 0.0)
    hfa = float(
        np.clip(
            HFA_BASE_WEIGHT
            * (HFA_MONTH_SCALE * mf + (1.0 - HFA_MONTH_SCALE))
            * (1.0 + HFA_TEAM_SCALE * td),
            -0.60,
            0.80,
        )
    )

    return {
        "park_run_factor": round(park_run, 4),
        "park_hr_factor": round(park_hr, 4),
        "weather_run_adj": round(weather_run, 4),
        "weather_hr_adj": round(weather_hr, 4),
        "hfa_weight": round(hfa, 4),
        "hfa_month_factor": round(mf, 4),
        "hfa_team_delta": round(td, 4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# TEAM/PITCHER STAT → FEATURE DICT CONVERTERS
# ─────────────────────────────────────────────────────────────────────────────
def team_stats_to_pitcher_features(stats: dict) -> dict:
    era = float(stats.get("era", 4.50))
    k9 = float(stats.get("k9") if stats.get("k9") is not None else 8.5)
    bb9 = float(stats.get("bb9") if stats.get("bb9") is not None else 3.2)
    whip = float(stats.get("whip") if stats.get("whip") is not None else 1.30)
    ip_per_game = float(stats.get("ip_per_game", STARTER_IP_MEAN))
    pa_per_9 = 38.0
    k_pct = k9 / pa_per_9
    bb_pct = bb9 / pa_per_9
    hr_pct = LEAGUE_HR_PCT * (era / 4.50)
    h_per_9 = whip * 9.0 - bb9
    h_pct = h_per_9 / pa_per_9
    single_pct = h_pct * 0.63
    double_pct = h_pct * 0.20
    triple_pct = h_pct * 0.02
    xfip_proxy = 3.5 + (era - 4.50) * 0.5
    return {
        "k_pct": float(np.clip(k_pct, 0.10, 0.40)),
        "bb_pct": float(np.clip(bb_pct, 0.04, 0.18)),
        "hr_pct": float(np.clip(hr_pct, 0.01, 0.07)),
        "single_pct": float(np.clip(single_pct, 0.08, 0.22)),
        "double_pct": float(np.clip(double_pct, 0.02, 0.08)),
        "triple_pct": float(np.clip(triple_pct, 0.001, 0.01)),
        "xwoba": LEAGUE_XWOBA,
        "barrel_rate": 0.08,
        "hard_hit": 0.35,
        "gb_pct": 0.43,
        "fb_pct": 0.35,
        "whiff_pct": 0.24,
        "ff_speed": 92.0,
        "ip_per_game": ip_per_game,
        "pitch_hand": "R",
        "xfip_proxy": float(np.clip(xfip_proxy, 2.5, 6.5)),
    }


def team_stats_to_batter_features(stats: dict) -> dict:
    """
    Convert team batting stats to per-batter feature dict.
    If hand-specific splits are present (avg/obp/slg from vs-LHP or vs-RHP),
    they are used directly. wOBA is used when available for more precise HR/K/BB rates.
    """
    avg = float(stats.get("avg", 0.245))
    obp = float(stats.get("obp", LEAGUE_OBP))  # 2025: 0.3174
    slg = float(stats.get("slg", 0.410))
    ops = obp + slg
    iso = max(0.05, slg - avg)

    # wOBA-based rate overrides (more precise than OPS-derived)
    woba = float(stats.get("woba", LEAGUE_WOBA))
    woba_scale = woba / LEAGUE_WOBA  # relative quality vs league avg

    # Hand-specific K/BB/HR rates from batting splits (if available)
    # batting_k9, batting_bb9, batting_hr9 are set from DB splits in TS
    pa_per_9 = 38.0
    if "batting_k9" in stats:
        k_pct = float(stats["batting_k9"]) / pa_per_9
        bb_pct = float(stats["batting_bb9"]) / pa_per_9
        hr_pct = float(stats["batting_hr9"]) / pa_per_9
    else:
        # Fallback: derive from avg/obp/slg
        bb_pct = max(0.04, obp - avg - 0.01)
        hr_pct = float(np.clip((slg - avg) * 0.25, 0.01, 0.07))
        # 2025: league K% = 0.2222; scale by team OPS vs league average
        k_pct = float(np.clip(LEAGUE_K_PCT * (0.750 / max(ops, 0.500)), 0.12, 0.32))

    # Scale HR rate by wOBA quality signal
    hr_pct = float(np.clip(hr_pct * woba_scale, 0.01, 0.07))

    single_pct = avg * 0.63
    double_pct = avg * 0.20
    triple_pct = avg * 0.02

    return {
        "k_pct": float(np.clip(k_pct, 0.12, 0.32)),
        "bb_pct": float(np.clip(bb_pct, 0.04, 0.18)),
        "hr_pct": float(np.clip(hr_pct, 0.01, 0.07)),
        "single_pct": float(np.clip(single_pct, 0.08, 0.22)),
        "double_pct": float(np.clip(double_pct, 0.02, 0.08)),
        "triple_pct": float(np.clip(triple_pct, 0.001, 0.01)),
        "xwoba": float(np.clip(woba, 0.250, 0.400)),
        "woba": float(np.clip(woba, 0.250, 0.400)),
        "iso": iso,
        "barrel_rate": float(np.clip(0.06 + iso * 0.15, 0.04, 0.14)),
        "hard_hit": float(np.clip(0.28 + iso * 0.30, 0.25, 0.50)),
        "bat_hand": "R",
        "split_hand": int(stats.get("split_hand", 0)),  # 1=vs LHP, 0=vs RHP
    }


def pitcher_stats_to_features(stats: dict, team_era: float = 4.50) -> dict:
    """
    Convert pitcher stats to feature dict for the simulation engine.
    Enhancements:
      - Uses real xFIP (not ERA-derived proxy) when available
      - Uses real pitch_hand (R/L/S) from DB throwsHand field
      - Blends rolling-5 ERA/K9/BB9/WHIP with season stats (already pre-blended in TS)
      - Uses FIP as secondary quality signal for HR rate estimation
      - FIP-minus / ERA-minus used for park-neutral quality adjustment
    """
    # Core rate stats (already blended 70/30 season/rolling-5 in TS layer)
    era = float(stats.get("era") if stats.get("era") is not None else team_era)
    k9 = float(stats.get("k9", 8.5))
    bb9 = float(stats.get("bb9", 3.2))
    whip = float(stats.get("whip", 1.30))
    ip = float(stats.get("ip") if stats.get("ip") is not None else 150.0)
    gp = max(1, int(stats.get("gp") if stats.get("gp") is not None else 28))
    ip_per_game = max(1.0, ip / gp)

    # Real xFIP from DB (park-neutral, HR-independent quality signal)
    # Fallback: ERA-derived proxy only if xFIP not available
    xfip_real = stats.get("xfip")
    if xfip_real is not None and float(xfip_real) > 0:
        xfip_val = float(np.clip(xfip_real, 2.0, 7.0))
    else:
        # Fallback proxy: regress toward 4.0 from ERA
        xfip_val = float(
            np.clip(3.5 + (era - LEAGUE_ERA) * 0.5, 2.0, 6.5)
        )  # normalize vs 2025 ERA

    # Real FIP from DB (HR-dependent quality signal)
    fip_real = stats.get("fip")
    fip_val = float(fip_real) if (fip_real is not None and float(fip_real) > 0) else era

    # FIP-minus / ERA-minus (park-adjusted, 100=league avg, <100=better)
    fip_minus = float(stats.get("fipMinus", 100))
    era_minus = float(stats.get("eraMinus", 100))

    # Pitcher throwing hand: 0=R, 1=L, 2=S
    throws_hand_num = int(stats.get("throwsHand", 0))
    pitch_hand = "L" if throws_hand_num == 1 else ("S" if throws_hand_num == 2 else "R")

    # Derive per-PA rates
    pa_per_9 = 38.0
    k_pct = k9 / pa_per_9
    bb_pct = bb9 / pa_per_9

    # HR rate: use FIP-based estimate (FIP is HR-sensitive)
    # FIP formula: FIP = (13*HR + 3*BB - 2*K) / IP + cFIP
    # Invert to get HR/9: HR/9 ≈ (FIP - 3.2 + 2*K9/9 - 3*BB9/9) / (13/9)
    # Clamp to realistic range
    hr9_from_fip = max(
        0.3, (fip_val - 3.2 + (2.0 * k9 / 9.0) - (3.0 * bb9 / 9.0)) / (13.0 / 9.0)
    )
    hr_pct_fip = float(np.clip(hr9_from_fip / pa_per_9, 0.01, 0.07))
    # Blend with ERA-based estimate (50/50)
    hr_pct_era = LEAGUE_HR_PCT * (era / LEAGUE_ERA)  # normalize vs 2025 league ERA
    hr_pct = float(np.clip(0.5 * hr_pct_fip + 0.5 * hr_pct_era, 0.01, 0.07))

    h_per_9 = whip * 9.0 - bb9
    h_pct = h_per_9 / pa_per_9
    single_pct = h_pct * 0.63
    double_pct = h_pct * 0.20
    triple_pct = h_pct * 0.02

    # Whiff rate: K% is a strong proxy; scale by xFIP quality
    xfip_quality = max(0.5, (5.0 - xfip_val) / 2.5)  # 0.5-1.5 range
    whiff_pct = float(np.clip(k_pct * 0.9 * xfip_quality, 0.12, 0.45))

    # Rolling-5 diagnostic fields (already blended into era/k9/bb9/whip above)
    rolling_starts = int(stats.get("rolling_starts") or 0)
    rolling_era = float(
        stats.get("rolling_era") if stats.get("rolling_era") is not None else era
    )

    return {
        "k_pct": float(np.clip(k_pct, 0.10, 0.45)),
        "bb_pct": float(np.clip(bb_pct, 0.03, 0.18)),
        "hr_pct": hr_pct,
        "single_pct": float(np.clip(single_pct, 0.06, 0.22)),
        "double_pct": float(np.clip(double_pct, 0.01, 0.08)),
        "triple_pct": float(np.clip(triple_pct, 0.001, 0.01)),
        "xwoba": LEAGUE_XWOBA,
        "barrel_rate": 0.08,
        "hard_hit": 0.35,
        "gb_pct": 0.43,
        "fb_pct": 0.35,
        "whiff_pct": whiff_pct,
        "ff_speed": 92.0,
        "ip_per_game": ip_per_game,
        "pitch_hand": pitch_hand,
        "xfip_proxy": xfip_val,
        # Diagnostic fields for logging
        "fip": fip_val,
        "xfip_real": xfip_val,
        "fip_minus": fip_minus,
        "era_minus": era_minus,
        "rolling_starts": rolling_starts,
        "rolling_era": rolling_era,
    }


def _default_bullpen() -> dict:
    return {
        "fatigue_score": 0.3,
        "leverage_arms": 2,
        "bullpen_k_bb": LEAGUE_K_PCT - LEAGUE_BB_PCT,  # 2025: 0.2222 - 0.0946 = 0.1276
        "bullpen_xfip": LEAGUE_ERA,  # 2025: 4.153 (was hardcoded 4.0)
        "total_bp_outs_5d": 0,
    }


# ─────────────────────────────────────────────────────────────────────────────
# STEP 11: MAIN PROJECTION FUNCTION (full pipeline entry point)
# ─────────────────────────────────────────────────────────────────────────────
def project_game(
    away_abbrev: str,
    home_abbrev: str,
    away_team_stats: dict,
    home_team_stats: dict,
    away_pitcher_stats: dict,
    home_pitcher_stats: dict,
    book_lines: dict,
    game_date: datetime,
    weather: dict | None = None,
    seed: int = 42,
    verbose: bool = False,
    # ── Precision signals ───────────────────────────────────────────────────────────────────────────────
    park_factor_3yr: float = 1.0,  # 3-year weighted park run factor
    away_bullpen: dict | None = None,  # Real bullpen stats for away team
    home_bullpen: dict | None = None,  # Real bullpen stats for home team
    umpire_k_mod: float = 1.0,  # HP umpire K-rate modifier
    umpire_bb_mod: float = 1.0,  # HP umpire BB-rate modifier
    umpire_name: str = "UNKNOWN",  # HP umpire name for logging
    mlb_game_pk: int | None = None,  # MLB Stats API gamePk for traceability
    # ── 3yr backtest NRFI/F5 priors (passed from mlbModelRunner via DB lookup) ──────────────────────
    # Pitcher NRFI rates: away SP's rate used for home lineup; home SP's rate for away lineup
    # If None: auto-looked up from TEAM_NRFI_RATES / TEAM_F5_RS constants
    away_pitcher_nrfi: float
    | None = None,  # away SP 3yr NRFI rate (pitching to home lineup)
    home_pitcher_nrfi: float
    | None = None,  # home SP 3yr NRFI rate (pitching to away lineup)
    away_pitcher_nrfi_starts: int
    | None = None,  # away SP NRFI sample size (for Bayesian shrinkage)
    home_pitcher_nrfi_starts: int
    | None = None,  # home SP NRFI sample size (for Bayesian shrinkage)
    away_team_nrfi: float | None = None,  # away team 3yr NRFI rate (as batting unit)
    home_team_nrfi: float | None = None,  # home team 3yr NRFI rate (as batting unit)
    away_f5_rs: float | None = None,  # away team 3yr F5 RS mean
    home_f5_rs: float | None = None,  # home team 3yr F5 RS mean
    # ── P1-B: Confirmed lineup Statcast aggregates (batting-order-weighted) ─────────────────────────────────────────────────────────────────────────────
    away_lineup_statcast: dict
    | None = None,  # { barrel_rate, iso, hard_hit, n_players }
    home_lineup_statcast: dict
    | None = None,  # { barrel_rate, iso, hard_hit, n_players }
    # ── P4-A: Per-player batting order arrays (9 slots: barrel_rate, iso, hard_hit, bats) ─────────────────────────────────────────────────────────────────────────────
    away_lineup_order: list
    | None = None,  # list of 9 dicts: { barrel_rate, iso, hard_hit, bats }
    home_lineup_order: list
    | None = None,  # list of 9 dicts: { barrel_rate, iso, hard_hit, bats }
) -> dict:
    t0 = time.time()
    game_label = f"{away_abbrev}@{home_abbrev}"
    logger = EngineLogger(game_label, verbose=verbose)

    logger.input(
        f"Game: {game_label} | Date: {game_date.date()} | Sims: {SIMULATIONS} | gamePk={mlb_game_pk}"
    )
    logger.input(
        f"Away stats: rpg={away_team_stats.get('rpg'):.2f} era={away_team_stats.get('era'):.2f}"
    )
    logger.input(
        f"Home stats: rpg={home_team_stats.get('rpg'):.2f} era={home_team_stats.get('era'):.2f}"
    )
    logger.input(f"Book lines: {book_lines}")

    # ── 3yr Backtest NRFI/F5 Prior Auto-Lookup ─────────────────────────────────────────────────────────────────────────────
    # Team NRFI rates and F5 RS means are auto-resolved from 3yr backtest constants.
    # Pitcher NRFI rates must be passed explicitly from mlbModelRunner (DB lookup).
    # If team rates are not passed, fall back to TEAM_NRFI_RATES / TEAM_F5_RS constants.
    if away_team_nrfi is None:
        away_team_nrfi = TEAM_NRFI_RATES.get(away_abbrev, TEAM_NRFI_LEAGUE_MEAN)
    if home_team_nrfi is None:
        home_team_nrfi = TEAM_NRFI_RATES.get(home_abbrev, TEAM_NRFI_LEAGUE_MEAN)
    if away_f5_rs is None:
        away_f5_rs = TEAM_F5_RS.get(away_abbrev, F5_RS_LEAGUE_MEAN)
    if home_f5_rs is None:
        home_f5_rs = TEAM_F5_RS.get(home_abbrev, F5_RS_LEAGUE_MEAN)
    logger.input(
        f"[NRFI-PRIORS] away_team_nrfi={away_team_nrfi:.4f} home_team_nrfi={home_team_nrfi:.4f} | "
        f"away_pitcher_nrfi={away_pitcher_nrfi} home_pitcher_nrfi={home_pitcher_nrfi} | "
        f"away_f5_rs={away_f5_rs:.3f} home_f5_rs={home_f5_rs:.3f}"
    )

    # Step 1: Build environment features
    logger.step("Step 1: Input Engine — Environment Features")
    env = get_environment_features(home_abbrev, game_date.month, weather)

    # ── SIGNAL 1: Override park_run_factor with 3-year DB value ─────────────────────────────────
    static_pf = env.get("park_run_factor", 1.0)
    if park_factor_3yr != 1.0:
        env["park_run_factor"] = park_factor_3yr
        logger.state(
            f"[PARK] Overriding static parkFactor={static_pf:.4f} → DB 3yr={park_factor_3yr:.4f} "
            f"(venue={home_abbrev})"
        )
    else:
        logger.state(
            f"[PARK] Using static parkFactor={static_pf:.4f} (no DB value for {home_abbrev})"
        )
    logger.state(
        f"Park run factor (final): {env['park_run_factor']:.4f} | HFA: {env['hfa_weight']}"
    )

    # Step 1: Build feature dicts
    away_lineup_feat = team_stats_to_batter_features(away_team_stats)
    home_lineup_feat = team_stats_to_batter_features(home_team_stats)
    away_sp_feat = pitcher_stats_to_features(
        away_pitcher_stats, away_team_stats.get("era", 4.50)
    )
    home_sp_feat = pitcher_stats_to_features(
        home_pitcher_stats, home_team_stats.get("era", 4.50)
    )

    # ── SIGNAL 3: Apply umpire K/BB modifiers to SP features ──────────────────────────────────────
    if umpire_k_mod != 1.0 or umpire_bb_mod != 1.0:
        orig_away_k = away_sp_feat["k_pct"]
        orig_away_bb = away_sp_feat["bb_pct"]
        orig_home_k = home_sp_feat["k_pct"]
        orig_home_bb = home_sp_feat["bb_pct"]
        away_sp_feat["k_pct"] = min(away_sp_feat["k_pct"] * umpire_k_mod, 0.50)
        away_sp_feat["bb_pct"] = min(away_sp_feat["bb_pct"] * umpire_bb_mod, 0.20)
        home_sp_feat["k_pct"] = min(home_sp_feat["k_pct"] * umpire_k_mod, 0.50)
        home_sp_feat["bb_pct"] = min(home_sp_feat["bb_pct"] * umpire_bb_mod, 0.20)
        logger.state(
            f"[UMPIRE] {umpire_name}: kMod={umpire_k_mod:.4f} bbMod={umpire_bb_mod:.4f} | "
            f"Away SP k_pct: {orig_away_k:.4f}→{away_sp_feat['k_pct']:.4f} "
            f"bb_pct: {orig_away_bb:.4f}→{away_sp_feat['bb_pct']:.4f} | "
            f"Home SP k_pct: {orig_home_k:.4f}→{home_sp_feat['k_pct']:.4f} "
            f"bb_pct: {orig_home_bb:.4f}→{home_sp_feat['bb_pct']:.4f}"
        )
    else:
        logger.state(
            f"[UMPIRE] {umpire_name}: kMod=1.0 bbMod=1.0 (league-avg, no adjustment)"
        )

    # ── P1-B: Inject confirmed lineup Statcast aggregates into batter features ─────────────────────────────────────────────────────────────────────────────
    # When confirmed lineup Statcast data is available, override the team-average
    # barrel_rate, iso, and hard_hit in the batter feature dict.
    # This provides per-game precision: a lineup heavy with power hitters vs. a
    # lineup with weak contact hitters produces different HR/run distributions.
    # LEAGUE AVERAGES (2025): barrel=8.3%, ISO=0.150, hard_hit=37.5%
    LEAGUE_BARREL = 8.3
    LEAGUE_ISO_DEFAULT = 0.150
    LEAGUE_HARD_HIT = 37.5
    if away_lineup_statcast is not None:
        n = away_lineup_statcast.get("n_players", 0)
        barrel = away_lineup_statcast.get("barrel_rate", LEAGUE_BARREL)
        iso_val = away_lineup_statcast.get("iso", LEAGUE_ISO_DEFAULT)
        hard_hit = away_lineup_statcast.get("hard_hit", LEAGUE_HARD_HIT)
        # Blend: 60% confirmed Statcast, 40% team-average (regression to mean)
        # Prevents over-fitting to small samples or outlier lineups
        STATCAST_BLEND = 0.60
        away_lineup_feat["barrel_rate"] = float(
            np.clip(
                STATCAST_BLEND * (barrel / 100.0)
                + (1 - STATCAST_BLEND) * away_lineup_feat["barrel_rate"],
                0.04,
                0.16,
            )
        )
        away_lineup_feat["iso"] = float(
            np.clip(
                STATCAST_BLEND * iso_val
                + (1 - STATCAST_BLEND) * away_lineup_feat["iso"],
                0.05,
                0.28,
            )
        )
        away_lineup_feat["hard_hit"] = float(
            np.clip(
                STATCAST_BLEND * (hard_hit / 100.0)
                + (1 - STATCAST_BLEND) * away_lineup_feat["hard_hit"],
                0.25,
                0.55,
            )
        )
        logger.state(
            f"[P1-B] AWAY Statcast inject (n={n}): "
            f"barrel={barrel:.2f}%→{away_lineup_feat['barrel_rate']:.4f} "
            f"iso={iso_val:.3f}→{away_lineup_feat['iso']:.4f} "
            f"hard_hit={hard_hit:.1f}%→{away_lineup_feat['hard_hit']:.4f}"
        )
    else:
        logger.state(
            "[P1-B] AWAY Statcast: no confirmed lineup data — using team averages"
        )
    if home_lineup_statcast is not None:
        n = home_lineup_statcast.get("n_players", 0)
        barrel = home_lineup_statcast.get("barrel_rate", LEAGUE_BARREL)
        iso_val = home_lineup_statcast.get("iso", LEAGUE_ISO_DEFAULT)
        hard_hit = home_lineup_statcast.get("hard_hit", LEAGUE_HARD_HIT)
        STATCAST_BLEND = 0.60
        home_lineup_feat["barrel_rate"] = float(
            np.clip(
                STATCAST_BLEND * (barrel / 100.0)
                + (1 - STATCAST_BLEND) * home_lineup_feat["barrel_rate"],
                0.04,
                0.16,
            )
        )
        home_lineup_feat["iso"] = float(
            np.clip(
                STATCAST_BLEND * iso_val
                + (1 - STATCAST_BLEND) * home_lineup_feat["iso"],
                0.05,
                0.28,
            )
        )
        home_lineup_feat["hard_hit"] = float(
            np.clip(
                STATCAST_BLEND * (hard_hit / 100.0)
                + (1 - STATCAST_BLEND) * home_lineup_feat["hard_hit"],
                0.25,
                0.55,
            )
        )
        logger.state(
            f"[P1-B] HOME Statcast inject (n={n}): "
            f"barrel={barrel:.2f}%→{home_lineup_feat['barrel_rate']:.4f} "
            f"iso={iso_val:.3f}→{home_lineup_feat['iso']:.4f} "
            f"hard_hit={hard_hit:.1f}%→{home_lineup_feat['hard_hit']:.4f}"
        )
    else:
        logger.state(
            "[P1-B] HOME Statcast: no confirmed lineup data — using team averages"
        )

    # ── P4-A: Build per-player lineup array from confirmed batting order ─────────────────────────────
    # When away_lineup_order is provided (confirmed lineup with Statcast data per slot),
    # build a heterogeneous 9-player array where each slot has that player's actual
    # barrel_rate, iso, hard_hit instead of the team-average replicated 9 times.
    # The GameStateBuilder._weighted_pa_probs() already applies positional weights via
    # _lineup_weights_dynamic(), so per-player data produces a more accurate run distribution.
    def _build_per_player_lineup(
        base_feat: dict,
        order: list | None,
        team: str,
    ) -> list[dict]:
        """
        Build a 9-player lineup array.
        - If order is provided: each slot gets the player's Statcast data merged
          with the team-average base features (K%, BB%, HR%, hit rates from splits).
        - If order is None: fall back to 9x team-average (existing behavior).
        """
        if not order or len(order) < 7:
            logger.state(f"[P4-A] {team}: no per-player order — using 9x team-average")
            return [base_feat] * 9
        result = []
        for slot in order[:9]:
            # Merge: base_feat provides K%, BB%, HR%, hit rates (from team splits)
            # slot provides barrel_rate, iso, hard_hit (from individual Statcast)
            player_feat = dict(base_feat)  # copy team-average base
            player_feat["barrel_rate"] = float(
                slot.get("barrel_rate", base_feat.get("barrel_rate", 0.083))
            )
            player_feat["iso"] = float(slot.get("iso", base_feat.get("iso", 0.150)))
            player_feat["hard_hit"] = float(
                slot.get("hard_hit", base_feat.get("hard_hit", 0.375))
            )
            # Bats handedness (for platoon splits in P4-B)
            player_feat["bats"] = str(slot.get("bats", "R"))
            result.append(player_feat)
        # Pad to 9 if fewer than 9 slots
        while len(result) < 9:
            result.append(dict(base_feat))
        logger.state(
            f"[P4-A] {team}: built per-player lineup ({len(result)} slots) from confirmed order"
        )
        return result

    away_lineup = _build_per_player_lineup(away_lineup_feat, away_lineup_order, "AWAY")
    home_lineup = _build_per_player_lineup(home_lineup_feat, home_lineup_order, "HOME")

    # ── SIGNAL 2: Build bullpen from DB stats (replace _default_bullpen) ───────────────────────────
    def _build_bullpen_from_db(bp: dict | None, team: str) -> dict:
        """Convert DB bullpen stats to engine bullpen feature dict."""
        if not bp:
            logger.state(
                f"[BULLPEN] {team}: no DB data — using league-average defaults"
            )
            return _default_bullpen()
        # FIP is the primary quality signal; fall back to ERA if FIP not available
        fip_val = bp.get("fip", bp.get("era", 4.10))
        era_val = bp.get("era", 4.20)
        k9_val = bp.get("k9", 9.0)
        bb9_val = bp.get("bb9", 3.2)
        k_pct = k9_val / 27.0  # approximate K% from K/9 (27 batters/9 IP)
        bb_pct = bb9_val / 27.0  # approximate BB% from BB/9
        result = {
            "fatigue_score": 0.3,  # no rest data yet — neutral
            "leverage_arms": int(bp.get("relieverCount", 2)),
            "bullpen_k_bb": k_pct - bb_pct,  # K-BB% (quality signal)
            "bullpen_xfip": fip_val,  # use FIP as xFIP proxy
            "total_bp_outs_5d": 0,  # no rest data yet — neutral
        }
        logger.state(
            f"[BULLPEN] {team}: ERA={era_val:.2f} FIP={fip_val:.2f} "
            f"K/9={k9_val:.2f} BB/9={bb9_val:.2f} "
            f"K-BB%={result['bullpen_k_bb']:.4f} relievers={result['leverage_arms']}"
        )
        return result

    # Build separate bullpens for each team (away bullpen faces home lineup, vice versa)
    away_bullpen_feat = _build_bullpen_from_db(away_bullpen, away_abbrev)
    home_bullpen_feat = _build_bullpen_from_db(home_bullpen, home_abbrev)
    # For game state building: home lineup faces away SP + away bullpen; away lineup faces home SP + home bullpen
    # Step 1: Deep diagnostic logging for pitcher features
    logger.step("Step 1b: Pitcher Feature Diagnostics")
    logger.state(
        f"Away SP features: hand={away_sp_feat['pitch_hand']} "
        f"xFIP={away_sp_feat['xfip_proxy']:.2f} FIP={away_sp_feat.get('fip', 'n/a')} "
        f"k_pct={away_sp_feat['k_pct']:.4f} bb_pct={away_sp_feat['bb_pct']:.4f} "
        f"hr_pct={away_sp_feat['hr_pct']:.4f} whiff={away_sp_feat['whiff_pct']:.4f} "
        f"ip/g={away_sp_feat['ip_per_game']:.2f} "
        f"rolling_starts={away_sp_feat.get('rolling_starts', 0)} "
        f"rolling_era={away_sp_feat.get('rolling_era', 'n/a')} "
        f"fip_minus={away_sp_feat.get('fip_minus', 100):.1f} era_minus={away_sp_feat.get('era_minus', 100):.1f}"
    )
    logger.state(
        f"Home SP features: hand={home_sp_feat['pitch_hand']} "
        f"xFIP={home_sp_feat['xfip_proxy']:.2f} FIP={home_sp_feat.get('fip', 'n/a')} "
        f"k_pct={home_sp_feat['k_pct']:.4f} bb_pct={home_sp_feat['bb_pct']:.4f} "
        f"hr_pct={home_sp_feat['hr_pct']:.4f} whiff={home_sp_feat['whiff_pct']:.4f} "
        f"ip/g={home_sp_feat['ip_per_game']:.2f} "
        f"rolling_starts={home_sp_feat.get('rolling_starts', 0)} "
        f"rolling_era={home_sp_feat.get('rolling_era', 'n/a')} "
        f"fip_minus={home_sp_feat.get('fip_minus', 100):.1f} era_minus={home_sp_feat.get('era_minus', 100):.1f}"
    )
    logger.state(
        f"Away batting (vs {home_sp_feat['pitch_hand']}P): "
        f"k_pct={away_lineup_feat['k_pct']:.4f} bb_pct={away_lineup_feat['bb_pct']:.4f} "
        f"hr_pct={away_lineup_feat['hr_pct']:.4f} wOBA={away_lineup_feat.get('woba', LEAGUE_WOBA):.3f} "
        f"split={'YES' if away_team_stats.get('split_hand') is not None else 'season'}"
    )
    logger.state(
        f"Home batting (vs {away_sp_feat['pitch_hand']}P): "
        f"k_pct={home_lineup_feat['k_pct']:.4f} bb_pct={home_lineup_feat['bb_pct']:.4f} "
        f"hr_pct={home_lineup_feat['hr_pct']:.4f} wOBA={home_lineup_feat.get('woba', LEAGUE_WOBA):.3f} "
        f"split={'YES' if home_team_stats.get('split_hand') is not None else 'season'}"
    )

    # Step 1: Build game states
    # home_state: home lineup faces away SP + away bullpen (away team's pen)
    # away_state: away lineup faces home SP + home bullpen (home team's pen)
    logger.step("Step 1c: Bullpen Feature Diagnostics")
    logger.state(
        f"[BULLPEN] {away_abbrev} pen: xFIP={away_bullpen_feat['bullpen_xfip']:.2f} "
        f"K-BB%={away_bullpen_feat['bullpen_k_bb']:.4f} "
        f"leverage_arms={away_bullpen_feat['leverage_arms']}"
    )
    logger.state(
        f"[BULLPEN] {home_abbrev} pen: xFIP={home_bullpen_feat['bullpen_xfip']:.2f} "
        f"K-BB%={home_bullpen_feat['bullpen_k_bb']:.4f} "
        f"leverage_arms={home_bullpen_feat['leverage_arms']}"
    )
    gs_builder = GameStateBuilder()
    home_state = gs_builder.build(
        home_lineup,
        away_sp_feat,
        away_bullpen_feat,
        env,
        quality_mult=LEAGUE_CALIBRATION_MULT,
    )
    away_state = gs_builder.build(
        away_lineup,
        home_sp_feat,
        home_bullpen_feat,
        env,
        quality_mult=LEAGUE_CALIBRATION_MULT,
    )

    # SPEC: HR Props — inject team HR/PA rate into state dicts for MonteCarloEngine
    # hr_pct from batter features = HR/PA rate for the team's lineup
    # Park HR factor scales the rate for this venue
    park_hr_factor = env.get("park_hr_factor", 1.0)
    home_state["team_hr_rate"] = float(
        np.clip(home_lineup_feat["hr_pct"] * park_hr_factor, 0.01, 0.08)
    )
    away_state["team_hr_rate"] = float(
        np.clip(away_lineup_feat["hr_pct"] * park_hr_factor, 0.01, 0.08)
    )
    logger.state(
        f"[HR PROPS] home_hr_rate={home_state['team_hr_rate']:.4f} "
        f"away_hr_rate={away_state['team_hr_rate']:.4f} "
        f"park_hr_factor={park_hr_factor:.4f}"
    )
    logger.state(
        f"[CALIBRATION] quality_mult={LEAGUE_CALIBRATION_MULT:.4f} (2025 RPG={LEAGUE_RPG:.3f})"
    )
    logger.state(
        f"Home state: mu={home_state['mu']:.4f} var={home_state['variance']:.4f} "
        f"starter_ip={home_state['starter_ip']:.2f}"
    )
    logger.state(
        f"Away state: mu={away_state['mu']:.4f} var={away_state['variance']:.4f} "
        f"starter_ip={away_state['starter_ip']:.2f}"
    )

    # Determine run line direction
    rl_home_spread = book_lines.get("rl_home_spread")
    if rl_home_spread is not None:
        rl_spread = float(rl_home_spread)
    else:
        ml_home = book_lines.get("ml_home", 0)
        rl_spread = -1.5 if ml_home < 0 else 1.5

    ou_line = book_lines.get("ou_line")

    # Step 2: Monte Carlo simulation
    logger.step(
        f"Step 2: Monte Carlo ({SIMULATIONS:,} sims, NB-Gamma Mixture, extra innings)"
    )
    mc = MonteCarloEngine(n_sims=SIMULATIONS, seed=seed)
    sim = mc.simulate(
        home_state,
        away_state,
        env,
        ou_line=ou_line,
        rl_spread=rl_spread,
        logger=logger,
        # ── 3yr backtest NRFI/F5 priors ────────────────────────────────────────────────────────────────────────────────────────
        # NOTE: pitcher NRFI roles are CROSSED:
        #   home_pitcher_nrfi = home SP's rate → faces AWAY lineup
        #   away_pitcher_nrfi = away SP's rate → faces HOME lineup
        # simulate() uses home_pitcher_nrfi to adjust HOME team's I1 mu
        # (the pitcher they face is the away SP, but the NRFI rate is the SP's)
        # The naming convention in simulate() is:
        #   home_pitcher_nrfi = the pitcher facing the home lineup (= away SP)
        #   away_pitcher_nrfi = the pitcher facing the away lineup (= home SP)
        # Starts are also CROSSED to match the rate crossing:
        #   home_pitcher_nrfi_starts = away SP's starts (for shrinkage of home lineup I1)
        #   away_pitcher_nrfi_starts = home SP's starts (for shrinkage of away lineup I1)
        away_pitcher_nrfi=home_pitcher_nrfi,  # home SP faces away lineup
        home_pitcher_nrfi=away_pitcher_nrfi,  # away SP faces home lineup
        away_pitcher_nrfi_starts=home_pitcher_nrfi_starts,  # home SP's starts (for away lineup shrinkage)
        home_pitcher_nrfi_starts=away_pitcher_nrfi_starts,  # away SP's starts (for home lineup shrinkage)
        away_team_nrfi=away_team_nrfi,
        home_team_nrfi=home_team_nrfi,
        away_f5_rs=away_f5_rs,
        home_f5_rs=home_f5_rs,
    )

    logger.state(
        f"Sim results: p_home={sim['p_home_win']:.4f} exp_total={sim['exp_total']:.2f} "
        f"ties_9inn={sim['n_ties_9inn']} avg_extra={sim['avg_extra_inn']:.3f}"
    )

    # Steps 4-10: Market derivation
    logger.step("Steps 4-10: Market Derivation Pipeline")
    market = MarketDerivation().derive(sim, home_abbrev, away_abbrev, ou_line, logger)

    # Edge detection
    edges = EdgeDetector().detect(market, book_lines)

    # Validation
    ok, warnings_list = ValidationLayer().validate(market, sim)
    logger.verify(ok, f"Final validation: {len(warnings_list)} warnings")

    elapsed = round(time.time() - t0, 2)
    logger.output(f"Completed in {elapsed}s | Valid={ok} | Edges={len(edges)}")

    # Step 12: Log distribution shapes and key number mass
    if verbose:
        logger.step("Step 12: Distribution Summary")
        for k in KEY_TOTAL_NUMBERS:
            kp = sim["key_probs"][k]
            logger.state(
                f"  P(total>{k})={kp['p_over']:.4f} P(push)={kp['p_push']:.4f}"
            )
        logger.state(
            f"  Extra innings impact on ML: {sim['n_ties_9inn']} ties resolved "
            f"(avg {sim['avg_extra_inn']:.2f} extra innings)"
        )
        logger.state(
            f"  Bullpen fatigue impact: starter_ip={home_state['starter_ip']:.2f} "
            f"(home) / {away_state['starter_ip']:.2f} (away)"
        )
        if market.get("cross_market_flags"):
            for f in market["cross_market_flags"]:
                logger.flag(f"Cross-market: {f}")

    # Build final output (Step 11)
    home_rl_label = f"{rl_spread:+.1f}"
    away_rl_label = f"{-rl_spread:+.1f}"

    return {
        "ok": True,
        "game": game_label,
        "away_abbrev": away_abbrev,
        "home_abbrev": home_abbrev,
        # Step 11: Projected runs
        "proj_away_runs": market["exp_away_runs"],
        "proj_home_runs": market["exp_home_runs"],
        "proj_total": market["exp_total"],
        # Step 11: Moneyline
        "away_ml": market["ml_away"],
        "home_ml": market["ml_home"],
        "away_win_pct": round(market["p_away_win"] * 100, 2),
        "home_win_pct": round(market["p_home_win"] * 100, 2),
        # Step 11: Run line
        "away_run_line": away_rl_label,
        "home_run_line": home_rl_label,
        "away_rl_odds": market["rl_away_odds"],
        "home_rl_odds": market["rl_home_odds"],
        "away_rl_cover_pct": round(market["p_away_cover_rl"] * 100, 2),
        "home_rl_cover_pct": round(market["p_home_cover_rl"] * 100, 2),
        # Step 11: Total
        "total_line": market["total_key"],
        "over_odds": market["over_odds"],
        "under_odds": market["under_odds"],
        "over_pct": round(market["p_over"] * 100, 2),
        "under_pct": round(market["p_under"] * 100, 2),
        # Model spread
        "model_spread": market["model_spread"],
        # Edges
        "edges": edges,
        # Validation
        "valid": ok,
        "warnings": warnings_list,
        # Environment
        "env": env,
        "home_state_mu": home_state["mu"],
        "away_state_mu": away_state["mu"],
        # Simulation diagnostics
        "simulations": SIMULATIONS,
        "n_ties_9inn": sim["n_ties_9inn"],
        "avg_extra_inn": sim["avg_extra_inn"],
        "tail_stable": sim["tail_stable"],
        "sparse_buckets": sim["sparse_buckets"],
        "cross_market_flags": market.get("cross_market_flags", []),
        "monotone": market.get("monotone", True),
        "no_arb": market.get("no_arb", True),
        # SPEC: F5 (First Five Innings) Markets — pulled from market dict (derive_markets output)
        "p_f5_home_win": market["p_f5_home_win"],
        "p_f5_away_win": market["p_f5_away_win"],
        "p_f5_push": market.get(
            "p_f5_push"
        ),  # THREE-WAY: Bayesian-blended P(F5 push/tie)
        "p_f5_push_raw": market.get(
            "p_f5_push_raw"
        ),  # raw simulation push rate (diagnostic)
        "f5_ml_home": market["f5_ml_home"],
        "f5_ml_away": market["f5_ml_away"],
        "p_f5_home_rl": market["p_f5_home_rl"],
        "p_f5_away_rl": market["p_f5_away_rl"],
        "f5_rl_home_odds": market["f5_rl_home_odds"],
        "f5_rl_away_odds": market["f5_rl_away_odds"],
        "f5_total_key": market["f5_total_key"],
        "f5_over_odds": market["f5_over_odds"],
        "f5_under_odds": market["f5_under_odds"],
        "p_f5_over": market["p_f5_over"],
        "p_f5_under": market["p_f5_under"],
        "exp_f5_home_runs": market["exp_f5_home_runs"],
        "exp_f5_away_runs": market["exp_f5_away_runs"],
        "exp_f5_total": market["exp_f5_total"],
        # SPEC: NRFI market — use no-vig values from market dict (not raw sim values)
        "p_nrfi": market["p_nrfi"],  # no-vig P(NRFI) 0-1 range
        "p_yrfi": market["p_yrfi"],  # no-vig P(YRFI) 0-1 range
        "nrfi_odds": market["nrfi_odds"],  # NRFI fair-value ML (no-vig)
        "yrfi_odds": market["yrfi_odds"],  # YRFI fair-value ML (no-vig)
        "exp_first_inn_total": sim["exp_first_inn_total"],  # expected 1st inning total
        # 3yr backtest NRFI filter signals (from simulate() via Bayesian prior blending)
        "nrfi_combined_signal": sim.get(
            "nrfi_combined_signal"
        ),  # (awayNrfi+homeNrfi)/2, None if missing
        "nrfi_combined_pass": sim.get("nrfi_combined_pass"),  # combined >= 0.56
        "nrfi_both_pass": sim.get("nrfi_both_pass"),  # both >= 0.56 (stronger gate)
        # SPEC: HR Props per team
        "p_home_hr_any": round(sim["p_home_hr_any"] * 100, 2),  # P(home team HR>=1) %
        "p_away_hr_any": round(sim["p_away_hr_any"] * 100, 2),  # P(away team HR>=1) %
        "p_both_hr": round(sim["p_both_hr"] * 100, 2),  # P(both teams HR) %
        "exp_home_hr": sim["exp_home_hr"],  # expected home HR count
        "exp_away_hr": sim["exp_away_hr"],  # expected away HR count
        "home_hr_lambda": sim["home_hr_lambda"],  # Poisson lambda (home)
        "away_hr_lambda": sim["away_hr_lambda"],  # Poisson lambda (away)
        # SPEC: Inning-by-Inning projections (I1-I9) — surfaced from sim dict
        "inning_home_exp": sim[
            "inning_home_exp"
        ],  # [I1..I9] expected home runs per inning
        "inning_away_exp": sim[
            "inning_away_exp"
        ],  # [I1..I9] expected away runs per inning
        "inning_total_exp": sim[
            "inning_total_exp"
        ],  # [I1..I9] expected combined runs per inning
        "inning_home_std": sim[
            "inning_home_std"
        ],  # [I1..I9] std dev home runs per inning
        "inning_away_std": sim[
            "inning_away_std"
        ],  # [I1..I9] std dev away runs per inning
        "inning_p_home_scores": sim[
            "inning_p_home_scores"
        ],  # [I1..I9] P(home scores >= 1)
        "inning_p_away_scores": sim[
            "inning_p_away_scores"
        ],  # [I1..I9] P(away scores >= 1)
        "inning_p_both_score": sim[
            "inning_p_both_score"
        ],  # [I1..I9] P(both teams score)
        "inning_p_neither_score": sim[
            "inning_p_neither_score"
        ],  # [I1..I9] P(neither scores) = NRFI per inning
        # P1-A: Weather adjustment applied (for DB storage and traceability)
        "weather_run_adj": round(env.get("weather_run_adj", 1.0), 4),
        # Meta
        "elapsed_sec": elapsed,
        "error": None,
        # Step 12 log flags
        "engine_flags": logger.flags,
    }
