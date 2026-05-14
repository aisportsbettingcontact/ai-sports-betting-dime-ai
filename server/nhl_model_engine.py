#!/usr/bin/env python3
"""
nhl_model_engine.py — NHL Sharp Line Origination Engine v2.0
=============================================================
Implements the Sharp Line Origination Engine specification:
  • Correlated Negative Binomial goal distributions (overdispersion k≈7-10, rho≈0.12-0.18)
  • 200,000 Monte Carlo simulations
  • OFF_rating / DEF_rating from weighted NaturalStatTrick metrics
  • Goalie multiplier: goalie_effect = GSAX/shots_faced → goalie_multiplier = 1 − goalie_effect
  • Fatigue factors (normal=1.00, 1-day=0.97, B2B=0.94)
  • Home ice = 1.04
  • Pace factor from combined shot rate
  • ALL markets (ML, puck line, total) originate from the SAME joint scoring distribution
  • No market is independently estimated — fully internally consistent

Protocol:
  STDIN  → single JSON object (NhlModelInput)
  STDOUT → single JSON line (NhlModelResult) — LAST line of stdout

Input schema:
  {
    "away_team":          "Boston Bruins",
    "home_team":          "Tampa Bay Lightning",
    "away_abbrev":        "BOS",
    "home_abbrev":        "TBL",
    "away_goalie":        "Jeremy Swayman",
    "home_goalie":        "Andrei Vasilevskiy",
    "away_goalie_gsax":   6.4,       # Goals Saved Above Expected (season total)
    "home_goalie_gsax":   2.1,
    "away_goalie_gp":     38,        # Games played (for per-game normalization)
    "home_goalie_gp":     32,
    "away_goalie_shots_faced": 1050, # Season shots faced (for goalie_effect = GSAX/shots_faced)
    "home_goalie_shots_faced": 920,
    "away_rest_days":     2,         # Days since last game (2+ = normal rest)
    "home_rest_days":     1,         # 1 = 1-day rest, 0 = back-to-back
    "mkt_puck_line":      -1.5,
    "mkt_away_pl_odds":   -132,
    "mkt_home_pl_odds":   112,
    "mkt_total":          6.0,
    "mkt_over_odds":      -101,
    "mkt_under_odds":     101,
    "mkt_away_ml":        135,
    "mkt_home_ml":        -155,
    "team_stats": {
      "BOS": {
        "xGF_60":   2.85,   "xGA_60":   2.41,   // Expected Goals For/Against per 60
        "HDCF_60":  1.12,   "HDCA_60":  0.91,   // High-Danger Corsi For/Against per 60
        "SCF_60":   26.4,   "SCA_60":   23.8,   // Scoring Chances For/Against per 60
        "CF_60":    57.2,   "CA_60":    51.3,   // Corsi For/Against per 60
        "SH_pct":   10.2,   "SV_pct":   91.8,
        "CF_pct":   53.1,   "SCF_pct":  51.8,
        "HDCF_pct": 54.2,   "xGF_pct":  52.3,
        "xGA_pct":  47.7,   "GF":       180,
        "GA":       155
      },
      "TBL": { ... }
    }
  }

Output schema (last line of stdout):
  {
    "ok": true,
    "game": "Boston Bruins @ Tampa Bay Lightning",
    "away_name": "Boston Bruins",
    "home_name": "Tampa Bay Lightning",
    "proj_away_goals": 2.73,
    "proj_home_goals": 3.18,
    "away_puck_line": "+1.5",
    "away_puck_line_odds": -218,
    "home_puck_line": "-1.5",
    "home_puck_line_odds": 218,
    "away_ml": 135,
    "home_ml": -135,
    "total_line": 6.0,
    "over_odds": -101,
    "under_odds": 101,
    "away_win_pct": 42.3,
    "home_win_pct": 57.7,
    "away_pl_cover_pct": 68.6,
    "home_pl_cover_pct": 31.4,
    "over_pct": 48.2,
    "under_pct": 51.8,
    "edges": [...],
    "error": null
  }
"""

import json
import sys
import time

import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS  (Section 4 & 6 of Sharp Line Origination Engine spec)
# ─────────────────────────────────────────────────────────────────────────────

SIMULATIONS = 200_000  # Section 6: N = 200,000 games
LEAGUE_GOAL_RATE = 3.10  # Section 4: all-sit goals/team/game (2025-26 calibrated with corrected DEF formula)
HOME_ICE = 1.04  # Section 4: home_ice = 1.04

# Negative Binomial dispersion (Section 5: k ≈ 7–10)
NB_K = 8.0  # Dispersion parameter k; Var(G) = mu + mu²/k

# Goal correlation between teams (Section 5: rho ≈ 0.12–0.18)
# Implemented via shared pace component
GOAL_CORRELATION = 0.15  # Shared game-pace factor weight

# Fatigue factors (Section 4)
FATIGUE_NORMAL = 1.00  # 2+ days rest
FATIGUE_ONE_DAY = 0.97  # 1 day rest
FATIGUE_B2B = 0.94  # Back-to-back (0 days rest)

# League averages for normalization (NaturalStatTrick 2025-26 season, 5v5, all situations)
# Verified against actual scraped NST data (32 teams, March 2026):
#   xGF/60=2.662  HDCF/60=11.457  SCF/60=26.975  CF/60=57.171
#   xGA/60=2.660  HDCA/60=11.453  SCA/60=26.952  CA/60=57.132
# NOTE: HDCF/60 is ~11.5 (scoring chance events), NOT ~1.05 (which was wrong by 10x)
LEAGUE_XGF_60 = 2.662  # Expected Goals For per 60
LEAGUE_XGA_60 = 2.660  # Expected Goals Against per 60
LEAGUE_HDCF_60 = 11.457  # High-Danger Corsi For per 60 (NOT 1.05 — actual NST value)
LEAGUE_HDCA_60 = 11.453  # High-Danger Corsi Against per 60
LEAGUE_SCF_60 = 26.975  # Scoring Chances For per 60
LEAGUE_SCA_60 = 26.952  # Scoring Chances Against per 60
LEAGUE_CF_60 = 57.171  # Corsi For per 60 (pace proxy)
# LEAGUE_CA_60 removed — Corsi Against is the mirror of CF_60 and is not used in any
# compute_off_rating / compute_def_rating / compute_pace_factor formula.

# Edge detection thresholds — referenced by classify_edge() and detect_edges() conf bands
PUCK_LINE_EDGE_THRESHOLD = 0.06  # 6pp probability edge for puck line
ML_EDGE_THRESHOLD = 0.05  # 5pp probability edge for moneyline
TOTAL_EDGE_THRESHOLD = (
    0.08  # 8pp probability edge for totals (half-point lines need more separation)
)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — TEAM STRENGTH ESTIMATION
# OFF_rating and DEF_rating per the Sharp Line Origination Engine spec
# ─────────────────────────────────────────────────────────────────────────────


def compute_off_rating(stats: dict) -> float:
    """
    Section 2 — OFFENSE MODEL:
      OFF_rating =
          0.40 * (xGF_60  / LEAGUE_XGF_60)    — expected goals quality
        + 0.25 * (HDCF_60 / LEAGUE_HDCF_60)   — high-danger volume
        + 0.20 * (SCF_60  / LEAGUE_SCF_60)    — scoring chance volume
        + 0.15 * (CF_60   / LEAGUE_CF_60)     — overall shot attempt pace

    All stats from NaturalStatTrick rate=y table (per-60 format).
    Values > 1 = stronger offense, < 1 = weaker offense.
    Raises ValueError if any required stat is missing.
    """
    xgf_60 = stats.get("xGF_60")
    hdcf_60 = stats.get("HDCF_60")
    scf_60 = stats.get("SCF_60")
    cf_60 = stats.get("CF_60")

    missing = [
        k
        for k, v in [
            ("xGF_60", xgf_60),
            ("HDCF_60", hdcf_60),
            ("SCF_60", scf_60),
            ("CF_60", cf_60),
        ]
        if v is None
    ]
    if missing:
        raise ValueError(
            f"compute_off_rating: missing required stats: {missing}. No fallback — all per-60 stats must be present."
        )

    rating = (
        0.40 * (float(xgf_60) / LEAGUE_XGF_60)
        + 0.25 * (float(hdcf_60) / LEAGUE_HDCF_60)
        + 0.20 * (float(scf_60) / LEAGUE_SCF_60)
        + 0.15 * (float(cf_60) / LEAGUE_CF_60)
    )

    return max(0.50, min(2.00, rating))


def compute_def_rating(stats: dict) -> float:
    """
    Section 2 — DEFENSE MODEL:
      DEF_rating =
          0.40 * (xGA_60  / LEAGUE_XGA_60)    — expected goals allowed ratio
        + 0.30 * (HDCA_60 / LEAGUE_HDCA_60)   — high-danger chances allowed ratio
        + 0.30 * (SCA_60  / LEAGUE_SCA_60)    — scoring chances allowed ratio

    Used as a MULTIPLIER on opponent expected goals:
      mu_opponent = LEAGUE_GOAL_RATE * OFF_opponent * DEF_defending_team

    Correct direction:
      DEF > 1.0 = weak defense (allows more than avg) → opponent scores MORE
      DEF < 1.0 = strong defense (allows less than avg) → opponent scores LESS
      DEF = 1.0 = league-average defense

    All stats from NaturalStatTrick rate=y table (per-60 format).
    Raises ValueError if any required stat is missing.
    """
    xga_60 = stats.get("xGA_60")
    hdca_60 = stats.get("HDCA_60")
    sca_60 = stats.get("SCA_60")

    missing = [
        k
        for k, v in [("xGA_60", xga_60), ("HDCA_60", hdca_60), ("SCA_60", sca_60)]
        if v is None
    ]
    if missing:
        raise ValueError(
            f"compute_def_rating: missing required stats: {missing}. No fallback — all per-60 stats must be present."
        )

    # Guard against division by zero (a team with 0 xGA/60 is impossible but protect anyway)
    xga_60 = max(float(xga_60), 0.01)
    hdca_60 = max(float(hdca_60), 0.01)
    sca_60 = max(float(sca_60), 0.01)

    # stat/league: > 1.0 when team allows MORE than average (weak defense)
    # This is the correct direction: mu_opponent = LEAGUE_GOAL_RATE * OFF_opponent * DEF_defending
    rating = (
        0.40 * (xga_60 / LEAGUE_XGA_60)
        + 0.30 * (hdca_60 / LEAGUE_HDCA_60)
        + 0.30 * (sca_60 / LEAGUE_SCA_60)
    )

    return max(0.50, min(2.00, rating))


def compute_pace_factor(away_stats: dict, home_stats: dict) -> float:
    """
    Section 4: Pace adjustment derived from combined Corsi For per 60.
    CF_60 is the total shot attempt rate (shots on goal + missed + blocked).
    pace_factor = combined_CF60 / (2 * LEAGUE_CF_60)
    Clamped to [0.85, 1.15] to prevent extreme outliers.

    Uses CF_60 (available in NST rate=y table) instead of SA_60 (not available).
    """
    away_cf = away_stats.get("CF_60") or LEAGUE_CF_60
    home_cf = home_stats.get("CF_60") or LEAGUE_CF_60
    combined = (float(away_cf) + float(home_cf)) / 2.0
    factor = combined / LEAGUE_CF_60
    return max(0.85, min(1.15, factor))


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — GOALIE MODEL
# goalie_effect = GSAX / shots_faced  (Bayesian-regressed toward 0)
# goalie_multiplier = 1 − goalie_effect
# Typical values: elite=0.94, average=1.00, weak=1.06
# ─────────────────────────────────────────────────────────────────────────────

# Bayesian regression constant for goalie GSAx.
# A goalie's observed GSAx/SA rate is blended with the league mean (0.0) using:
#   regressed_effect = raw_effect * (SA / (SA + GOALIE_REGRESSION_K))
# With K=500, a goalie with 500 SA gets 50% weight, 1000 SA gets 67%, 100 SA gets 17%.
# This prevents tiny-sample outliers (e.g. 1 GP backup) from dominating.
GOALIE_REGRESSION_K = 500  # shots-against prior equivalent


def compute_goalie_multiplier(gsax: float, shots_faced: int, gp: int, goalie_regression_k: float = GOALIE_REGRESSION_K) -> float:
    """
    Section 3 — GOALIE MODEL (Bayesian-regressed):
      raw_effect       = GSAX / shots_faced
      regressed_effect = raw_effect × (SA / (SA + K))   ← shrinks small samples toward 0
      goalie_multiplier = 1 − regressed_effect
    Typical values:
      Elite goalie (1000+ SA)  → multiplier ≈ 0.94  (saves ~6% more than expected)
      Average goalie           → multiplier ≈ 1.00
      Weak goalie (1000+ SA)   → multiplier ≈ 1.06
      Backup (< 200 SA)        → multiplier ≈ 1.00  (regressed heavily to mean)
    Clamped to [0.88, 1.12] — tighter range since regression already handles outliers.
    goalie_regression_k: Bayesian prior strength (default=500 for regular season;
      use 200 for playoffs where goalies have 200-350 SA over 11-20 games).
    """
    if shots_faced is None or shots_faced <= 0:
        # Fall back to per-game normalization if shots_faced not available
        if gp is None or gp <= 0:
            return 1.0
        # Estimate shots_faced from GP (NHL avg ~28 shots/game)
        shots_faced = gp * 28
    gsax = float(gsax or 0.0)
    shots_faced = float(shots_faced)
    raw_effect = gsax / shots_faced
    # Bayesian regression: weight raw signal by sample size relative to prior
    regression_weight = shots_faced / (shots_faced + goalie_regression_k)
    regressed_effect = raw_effect * regression_weight
    multiplier = 1.0 - regressed_effect
    # Tighter clamp since regression already handles outliers
    return max(0.88, min(1.12, multiplier))


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — FATIGUE FACTOR
# ─────────────────────────────────────────────────────────────────────────────


def compute_fatigue_factor(rest_days: int | None) -> float:
    """
    Section 4 — Fatigue adjustments:
      Normal rest (2+ days) → 1.00
      1 day rest            → 0.97
      Back-to-back (0 days) → 0.94
    """
    if rest_days is None:
        return FATIGUE_NORMAL
    if rest_days == 0:
        return FATIGUE_B2B
    if rest_days == 1:
        return FATIGUE_ONE_DAY
    return FATIGUE_NORMAL


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — EXPECTED GOALS MODEL
# mu_home = league_goal_rate * OFF_home * DEF_away * goalie_multiplier_away * home_ice * fatigue * pace
# mu_away = league_goal_rate * OFF_away * DEF_home * goalie_multiplier_home * fatigue * pace
# ─────────────────────────────────────────────────────────────────────────────


def project_goals(
    away_stats: dict,
    home_stats: dict,
    away_goalie_gsax: float,
    away_goalie_shots_faced: int,
    away_goalie_gp: int,
    home_goalie_gsax: float,
    home_goalie_shots_faced: int,
    home_goalie_gp: int,
    away_rest_days: int | None,
    home_rest_days: int | None,
    league_goal_rate: float = LEAGUE_GOAL_RATE,
    goalie_regression_k: float = GOALIE_REGRESSION_K,
) -> tuple[float, float]:
    """
    Section 4 — Pure Expected Goals Model.

    No market anchoring. The model stands on its own math:
      mu_home = league_goal_rate * OFF_home * DEF_away * goalie_multiplier_away_goalie * home_ice * fatigue_home * pace
      mu_away = league_goal_rate * OFF_away * DEF_home * goalie_multiplier_home_goalie * fatigue_away * pace

    Note: goalie_multiplier for the HOME team's expected goals is the AWAY goalie's multiplier
    (the away goalie is defending against home team shots), and vice versa.
    """
    off_away = compute_off_rating(away_stats)
    def_away = compute_def_rating(away_stats)
    off_home = compute_off_rating(home_stats)
    def_home = compute_def_rating(home_stats)

    # Goalie multipliers: away goalie defends home team shots, home goalie defends away team shots
    gm_away_goalie = compute_goalie_multiplier(
        away_goalie_gsax, away_goalie_shots_faced, away_goalie_gp, goalie_regression_k
    )
    gm_home_goalie = compute_goalie_multiplier(
        home_goalie_gsax, home_goalie_shots_faced, home_goalie_gp, goalie_regression_k
    )

    fatigue_away = compute_fatigue_factor(away_rest_days)
    fatigue_home = compute_fatigue_factor(home_rest_days)

    pace = compute_pace_factor(away_stats, home_stats)

    # Section 4 formulas:
    # mu_home = league_goal_rate * OFF_home * DEF_away * goalie_multiplier_away * home_ice * fatigue_home * pace
    # mu_away = league_goal_rate * OFF_away * DEF_home * goalie_multiplier_home * fatigue_away * pace
    mu_home = (
        league_goal_rate
        * off_home
        * def_away
        * gm_away_goalie  # away goalie faces home team shots
        * HOME_ICE
        * fatigue_home
        * pace
    )
    mu_away = (
        league_goal_rate
        * off_away
        * def_home
        * gm_home_goalie  # home goalie faces away team shots
        * fatigue_away
        * pace
    )

    # Ensure non-negative minimums
    mu_away = max(0.50, mu_away)
    mu_home = max(0.50, mu_home)

    return round(mu_away, 4), round(mu_home, 4)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5 — SCORING DISTRIBUTION MODEL
# Correlated Negative Binomial: G ~ NB(mu, k), with goal correlation rho≈0.15
# ─────────────────────────────────────────────────────────────────────────────


def sample_correlated_nb(
    mu_away: float, mu_home: float, n: int, rng: np.random.Generator | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """
    Section 5 — Correlated Negative Binomial goal distributions.

    G_home ~ NB(mu_home, k_home)
    G_away ~ NB(mu_away, k_away)

    Variance: Var(G) = mu + mu²/k   (overdispersed vs Poisson)
    Goal correlation rho ≈ 0.12–0.18 via shared game-pace component.

    Implementation:
      1. Sample a shared pace multiplier from Gamma(shape=1/rho, scale=rho) ≈ 1.0
         This introduces the inter-team correlation without changing marginal means.
      2. For each team, sample from NB(mu * pace_mult, k) using Gamma-Poisson mixture:
         - lambda_i ~ Gamma(k, mu_i/k)   [Gamma scale parameterization]
         - goals_i  ~ Poisson(lambda_i * pace_mult)
    """
    k = NB_K
    rho = GOAL_CORRELATION
    _rng = rng if rng is not None else np.random.default_rng()

    # Shared pace multiplier (introduces correlation between teams)
    # Gamma(shape=1/rho, scale=rho) has mean=1, variance=rho
    pace_shape = 1.0 / rho
    pace_mult = _rng.gamma(pace_shape, rho, size=n)  # mean=1, var=rho

    # NB via Gamma-Poisson mixture for away team
    # lambda_away ~ Gamma(k, mu_away/k)  →  mean=mu_away, var=mu_away²/k
    lambda_away = _rng.gamma(k, mu_away / k, size=n) * pace_mult
    goals_away = _rng.poisson(lambda_away)

    # NB via Gamma-Poisson mixture for home team
    lambda_home = _rng.gamma(k, mu_home / k, size=n) * pace_mult
    goals_home = _rng.poisson(lambda_home)

    return goals_away, goals_home


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 6 — MONTE CARLO SIMULATION
# ─────────────────────────────────────────────────────────────────────────────


def run_simulation(
    mu_away: float, mu_home: float, rng: np.random.Generator | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """
    Section 6: Run N=200,000 correlated NB simulations.
    Pass a seeded rng for deterministic output; omit for non-deterministic (legacy).
    Returns (away_scores, home_scores) arrays of length SIMULATIONS.
    """
    return sample_correlated_nb(mu_away, mu_home, SIMULATIONS, rng=rng)


# ─────────────────────────────────────────────────────────────────────────────
# SECTIONS 7–10 — PROBABILITY OUTPUTS & MARKET ORIGINATION
# All markets derived from the SAME joint distribution (Section 11 consistency)
# ─────────────────────────────────────────────────────────────────────────────


def calculate_probs(away_scores: np.ndarray, home_scores: np.ndarray) -> dict:
    """
    Sections 7–10: Calculate all probabilities from the joint simulation.

    Section 7 — Probability Outputs:
      home_win_prob = home_wins / N
      away_win_prob = 1 − home_win_prob

    Section 9 — Puck Line:
      P(home −1.5) = P(margin ≥ 2)
      P(away +1.5) = 1 − P(home −1.5)

    Section 10 — Total:
      E_total = mean(total_goals), rounded to nearest 0.5
      P(total > line), P(total < line)

    All three markets derive from the same (away_scores, home_scores) arrays.
    """
    n = len(away_scores)
    totals = away_scores + home_scores
    margin = home_scores.astype(int) - away_scores.astype(
        int
    )  # positive = home winning

    # Section 7: Moneyline probabilities
    home_wins = float(np.sum(home_scores > away_scores)) / n
    away_wins = float(np.sum(away_scores > home_scores)) / n
    # Ties (OT games) are split evenly between ML outcomes
    ties = float(np.sum(home_scores == away_scores)) / n
    home_win_prob = home_wins + 0.5 * ties
    away_win_prob = away_wins + 0.5 * ties

    # Normalize to sum to 1.0 (handles floating point)
    total_prob = home_win_prob + away_win_prob
    if total_prob > 0:
        home_win_prob /= total_prob
        away_win_prob /= total_prob

    # ── Section 9: Puck Line Origination Engine ─────────────────────────────
    # Per spec (Sections 2–7 of Puck Line Origination Engine):
    #
    # Step 1: Determine favorite by win probability
    #   favorite = HOME if home_win_prob > away_win_prob else AWAY
    #
    # Step 2: Compute P_win_by_2_or_more and P_win_by_3_or_more for the FAVORITE
    #   (margin = home - away; positive = home winning)
    #
    # Step 3: Determine spread
    #   if P_win_by_3_or_more >= 0.36 → spread = ±2.5
    #   else                          → spread = ±1.5
    #
    # Step 4: P_favorite_cover = P_win_by_2_or_more (if -1.5) or P_win_by_3_or_more (if -2.5)
    # Step 5: P_underdog_cover = 1 - P_favorite_cover
    # Step 6: Assign to home/away based on who is favorite

    fav_is_home = home_win_prob > away_win_prob

    # Wins by 2+ and 3+ for the FAVORITE (from the margin distribution)
    if fav_is_home:
        wins_by_2 = float(np.sum(margin >= 2)) / n
        wins_by_3 = float(np.sum(margin >= 3)) / n
    else:
        wins_by_2 = float(np.sum(margin <= -2)) / n
        wins_by_3 = float(np.sum(margin <= -3)) / n

    # Determine spread: -2.5 if favorite wins by 3+ at least 36% of the time
    if wins_by_3 >= 0.36:
        puck_line_spread = 2.5  # favorite = -2.5, underdog = +2.5
        p_favorite_cover = wins_by_3
    else:
        puck_line_spread = 1.5  # favorite = -1.5, underdog = +1.5
        p_favorite_cover = wins_by_2

    p_underdog_cover = 1.0 - p_favorite_cover

    # Hard mathematical invariant: P(fav covers -1.5) MUST be <= P(fav wins outright)
    # P(win by 2+) <= P(win) always. Enforce before converting to odds.
    fav_win_prob = home_win_prob if fav_is_home else away_win_prob
    if p_favorite_cover > fav_win_prob:
        # Clamp: cap at 98% of fav win probability
        p_favorite_cover = fav_win_prob * 0.98
        p_underdog_cover = 1.0 - p_favorite_cover

    # Assign cover probabilities to home/away
    if fav_is_home:
        home_pl_cover = p_favorite_cover
        away_pl_cover = p_underdog_cover
        home_pl_spread = -puck_line_spread
        away_pl_spread = +puck_line_spread
    else:
        away_pl_cover = p_favorite_cover
        home_pl_cover = p_underdog_cover
        away_pl_spread = -puck_line_spread
        home_pl_spread = +puck_line_spread

    # Section 10: Total — find the best line (nearest 0.5)
    e_total = float(np.mean(totals))
    # Round E_total to nearest 0.5
    best_line = round(e_total * 2) / 2.0
    # Ensure line is in realistic NHL range [4.5, 8.5]
    best_line = max(4.5, min(8.5, best_line))

    # P(total > line) and P(total < line)
    over_prob = float(np.sum(totals > best_line)) / n
    under_prob = float(np.sum(totals < best_line)) / n
    push_prob = 1.0 - over_prob - under_prob

    # Redistribute push probability evenly
    over_prob += push_prob * 0.5
    under_prob += push_prob * 0.5

    # Section 11 consistency check:
    # P(home_win) + P(away_win) = 1 ✓ (enforced above)
    # E_total = mu_home + mu_away ✓ (by construction)
    # P(home −1.5) ≤ P(home_win) ✓ (winning by 2+ ≤ winning at all)

    return {
        "away_win": away_win_prob,
        "home_win": home_win_prob,
        "away_pl_cover": away_pl_cover,
        "home_pl_cover": home_pl_cover,
        "away_pl_spread": away_pl_spread,  # e.g. +1.5 or -2.5
        "home_pl_spread": home_pl_spread,  # e.g. -1.5 or +2.5
        "puck_line_spread": puck_line_spread,  # 1.5 or 2.5 (absolute value)
        "fav_is_home": fav_is_home,
        "best_total_line": best_line,
        "over_prob": over_prob,
        "under_prob": under_prob,
        "e_total": e_total,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PROBABILITY ↔ AMERICAN MONEYLINE CONVERSION
# Sections 8, 9, 10: Convert probabilities to American odds
# ─────────────────────────────────────────────────────────────────────────────


def prob_to_ml(p: float) -> int:
    """
    Section 8: Convert win probability to American moneyline (no vig, fair value).

    If p > 0.5:  favorite_odds = −100 × (p / (1 − p))
    If p < 0.5:  underdog_odds = +100 × ((1 − p) / p)
    If p = 0.5:  ±100
    """
    p = max(0.001, min(0.999, p))
    if p >= 0.5:
        return -round((p / (1.0 - p)) * 100)
    return round(((1.0 - p) / p) * 100)


def ml_to_prob(ml: int) -> float:
    """Convert American moneyline to implied win probability (no vig removal)."""
    if ml < 0:
        return abs(ml) / (abs(ml) + 100.0)
    return 100.0 / (ml + 100.0)


def format_ml(ml: int) -> str:
    """Format moneyline as string with sign."""
    return f"+{ml}" if ml > 0 else str(ml)


# ─────────────────────────────────────────────────────────────────────────────
# SHARP EDGE DETECTION ENGINE
# Industry-grade method per spec: distribution-translated, vig-removed, EV+price
# ─────────────────────────────────────────────────────────────────────────────


def build_total_distribution(
    away_scores: np.ndarray,
    home_scores: np.ndarray,
) -> dict[int, int]:
    """
    Build a score_counts dict from simulation arrays.
    Keys are total goals (0..N), values are simulation counts.
    Used to compute P(total > line) for ANY threshold line.
    """
    totals = (away_scores + home_scores).astype(int)
    unique, counts = np.unique(totals, return_counts=True)
    return {int(k): int(v) for k, v in zip(unique, counts)}


def build_margin_distribution(
    away_scores: np.ndarray,
    home_scores: np.ndarray,
) -> dict[int, int]:
    """
    Build a margin_counts dict from simulation arrays.
    margin = home_goals - away_goals
    Positive = home winning, negative = away winning.
    Used to compute P(home margin >= 2) and P(away margin >= -1) for ANY line.
    """
    margins = home_scores.astype(int) - away_scores.astype(int)
    unique, counts = np.unique(margins, return_counts=True)
    return {int(k): int(v) for k, v in zip(unique, counts)}


def prob_total_over(score_counts: dict[int, int], line: float, n: int) -> float:
    """P(total > line) from score distribution. Section 2 of spec."""
    wins = sum(count for score, count in score_counts.items() if score > line)
    return wins / n


def prob_total_under(score_counts: dict[int, int], line: float, n: int) -> float:
    """P(total < line) from score distribution. Section 2 of spec."""
    wins = sum(count for score, count in score_counts.items() if score < line)
    return wins / n


def prob_margin_cover(
    margin_dist: dict[int, int], threshold: int, n: int, home_covers: bool
) -> float:
    """
    P(home covers puck line at threshold) from margin distribution.
    margin = home_goals - away_goals
    home_covers=True:  P(margin >= threshold)  e.g. home -1.5 → threshold=2
    home_covers=False: P(margin <= -threshold) e.g. away +1.5 → threshold=2 → P(margin <= -2)
    """
    if home_covers:
        wins = sum(
            count for margin, count in margin_dist.items() if margin >= threshold
        )
    else:
        wins = sum(
            count for margin, count in margin_dist.items() if margin <= -threshold
        )
    return wins / n


def remove_vig(prob_a: float, prob_b: float) -> tuple[float, float]:
    """
    Remove vig from raw implied probabilities. Section 4 of spec.
    true_A = prob_A / (prob_A + prob_B)
    """
    total = prob_a + prob_b
    if total <= 0:
        return 0.5, 0.5
    return prob_a / total, prob_b / total


def payout_from_odds(odds: int) -> float:
    """Payout per $1 wagered. Section 9 of spec."""
    if odds < 0:
        return 100.0 / abs(odds)
    return odds / 100.0


def expected_value(probability: float, odds: int) -> float:
    """EV = p * payout - (1 - p). Section 10 of spec."""
    payout = payout_from_odds(odds)
    return probability * payout - (1.0 - probability)


def classify_edge(prob_edge: float) -> str:
    """Edge classification. Section 12 of spec."""
    if prob_edge >= TOTAL_EDGE_THRESHOLD:  # 0.08 — ELITE
        return "ELITE EDGE"
    if prob_edge >= ML_EDGE_THRESHOLD:  # 0.05 — STRONG
        return "STRONG EDGE"
    if prob_edge >= 0.03:  # 0.03 — PLAYABLE
        return "PLAYABLE EDGE"
    if prob_edge >= 0.015:  # 0.015 — SMALL
        return "SMALL EDGE"
    return "NO EDGE"


def detect_edges(
    probs: dict,
    away_scores: np.ndarray,
    home_scores: np.ndarray,
    mkt_away_pl_odds: int | None,
    mkt_home_pl_odds: int | None,
    mkt_over_odds: int | None,
    mkt_under_odds: int | None,
    mkt_away_ml: int | None,
    mkt_home_ml: int | None,
    mkt_total: float | None,
    mkt_away_spread: float | None = None,
) -> list[dict]:
    """
    Industry-grade Sharp Edge Detection Engine.

    Key improvements over naive approach:
    1. Distribution-translated probabilities: compute P(event at MARKET threshold)
       from the score distribution, not at the model's own line.
    2. Vig removal: normalize raw implied probabilities to get true no-vig market probs.
    3. EV calculation: p_model * payout - (1 - p_model)
    4. Price edge: fair_odds - market_odds
    5. Edge classification: ELITE/STRONG/PLAYABLE/SMALL/NO EDGE

    EDGE DIRECTION RULE (confirmed):
      An edge exists ONLY when model implied probability > book break-even probability.
      i.e. edge = p_model - p_market_no_vig > 0 (and above threshold)
      - Underdog (+odds): edge if model gives HIGHER probability than book prices
        e.g. book +170 (37.0% BE) vs model 40.0% → edge = +3.0pp → EDGE
        e.g. book +170 (37.0% BE) vs model 34.0% → edge = -3.0pp → NO EDGE
      - Favorite (-odds): edge if model gives HIGHER probability than book prices
        e.g. book -112 (52.8% BE) vs model 55.0% → edge = +2.2pp → EDGE
        e.g. book -112 (52.8% BE) vs model 51.5% → edge = -1.3pp → NO EDGE
    """
    n = len(away_scores)
    edges = []

    # Build score and margin distributions
    total_dist = build_total_distribution(away_scores, home_scores)
    margin_dist = build_margin_distribution(away_scores, home_scores)

    print(
        "[EdgeDetect] ┌─────────────────────────────────────────────────────",
        file=sys.stderr,
    )
    print(
        f"[EdgeDetect] │  EDGE DETECTION AUDIT (N={n:,} simulations)", file=sys.stderr
    )
    print(
        "[EdgeDetect] │  Rule: edge = p_model - p_market_no_vig > 0 → EDGE",
        file=sys.stderr,
    )
    print(
        "[EdgeDetect] │  Thresholds: ML≥5pp PLAYABLE, PL≥6pp PLAYABLE, TOT≥8pp PLAYABLE",
        file=sys.stderr,
    )
    print("[EdgeDetect] │  Minimum to report: ≥1.5pp (SMALL EDGE)", file=sys.stderr)
    print(
        "[EdgeDetect] ├─────────────────────────────────────────────────────",
        file=sys.stderr,
    )

    # ── TOTAL MARKET ─────────────────────────────────────────────────────────
    if (
        mkt_over_odds is not None
        and mkt_under_odds is not None
        and mkt_total is not None
    ):
        # Step 1: Raw implied probabilities from market odds
        p_over_raw = ml_to_prob(mkt_over_odds)
        p_under_raw = ml_to_prob(mkt_under_odds)

        # Step 2: Remove vig → true no-vig market probabilities
        p_over_market, p_under_market = remove_vig(p_over_raw, p_under_raw)

        # Step 3: Distribution-translated model probabilities at MARKET threshold
        # This is the key improvement: use P(total > mkt_total) not P(total > model_line)
        p_over_model = prob_total_over(total_dist, mkt_total, n)
        p_under_model = prob_total_under(total_dist, mkt_total, n)

        # Step 4: Fair odds from model probabilities
        fair_over_odds = prob_to_ml(p_over_model)
        fair_under_odds = prob_to_ml(p_under_model)

        # Step 5: Probability edge (model vs vig-free market)
        edge_over = p_over_model - p_over_market
        edge_under = p_under_model - p_under_market

        # Step 6: EV calculation
        ev_over = expected_value(p_over_model, mkt_over_odds)
        ev_under = expected_value(p_under_model, mkt_under_odds)

        # Step 7: Price edge
        price_edge_over = fair_over_odds - mkt_over_odds
        price_edge_under = fair_under_odds - mkt_under_odds

        # Step 8: Classify and emit edges
        classification_over = classify_edge(edge_over)
        classification_under = classify_edge(edge_under)

        # ── DEEP DIAGNOSTIC LOG: TOTAL ──
        vig_pct_total = (p_over_raw + p_under_raw - 1.0) * 100
        print(f"[EdgeDetect] │  TOTAL @ {mkt_total}", file=sys.stderr)
        print(
            f"[EdgeDetect] │    Book odds: OVER {mkt_over_odds:+d}  UNDER {mkt_under_odds:+d}  (vig={vig_pct_total:.2f}%)",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book implied (raw):    OVER={p_over_raw * 100:.2f}%  UNDER={p_under_raw * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book break-even (no-vig): OVER={p_over_market * 100:.2f}%  UNDER={p_under_market * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Model probability @{mkt_total}: OVER={p_over_model * 100:.2f}%  UNDER={p_under_model * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Edge (model - break-even): OVER={edge_over * 100:+.2f}pp  UNDER={edge_under * 100:+.2f}pp",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Fair odds: OVER={fair_over_odds:+d}  UNDER={fair_under_odds:+d}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Price edge: OVER={price_edge_over:+.0f}  UNDER={price_edge_under:+.0f}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    EV: OVER={ev_over * 100:+.2f}%  UNDER={ev_under * 100:+.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Verdict: OVER={classification_over}  UNDER={classification_under}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Threshold check: OVER edge {edge_over * 100:+.2f}pp {'≥' if edge_over >= 0.015 else '<'} 1.5pp → {'REPORT' if edge_over >= 0.015 else 'SUPPRESS'}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Threshold check: UNDER edge {edge_under * 100:+.2f}pp {'≥' if edge_under >= 0.015 else '<'} 1.5pp → {'REPORT' if edge_under >= 0.015 else 'SUPPRESS'}",
            file=sys.stderr,
        )

        if edge_over >= 0.015:  # SMALL EDGE or better
            edges.append(
                {
                    "type": "TOTAL",
                    "side": f"OVER {mkt_total}",
                    "model_prob": round(p_over_model * 100, 2),
                    "mkt_prob": round(p_over_market * 100, 2),
                    "mkt_prob_raw": round(p_over_raw * 100, 2),
                    "edge_vs_be": round(edge_over * 100, 2),
                    "ev": round(ev_over * 100, 2),
                    "fair_odds": fair_over_odds,
                    "price_edge": round(price_edge_over, 0),
                    "classification": classification_over,
                    "conf": "HIGH"
                    if edge_over >= TOTAL_EDGE_THRESHOLD
                    else ("MOD" if edge_over >= ML_EDGE_THRESHOLD else "LOW"),
                }
            )

        if edge_under >= 0.015:
            edges.append(
                {
                    "type": "TOTAL",
                    "side": f"UNDER {mkt_total}",
                    "model_prob": round(p_under_model * 100, 2),
                    "mkt_prob": round(p_under_market * 100, 2),
                    "mkt_prob_raw": round(p_under_raw * 100, 2),
                    "edge_vs_be": round(edge_under * 100, 2),
                    "ev": round(ev_under * 100, 2),
                    "fair_odds": fair_under_odds,
                    "price_edge": round(price_edge_under, 0),
                    "classification": classification_under,
                    "conf": "HIGH"
                    if edge_under >= TOTAL_EDGE_THRESHOLD
                    else ("MOD" if edge_under >= ML_EDGE_THRESHOLD else "LOW"),
                }
            )

    # ── PUCK LINE MARKET ───────────────────────────────────────────────────────────────────
    if mkt_away_pl_odds is not None and mkt_home_pl_odds is not None:
        # Raw implied probabilities
        p_away_pl_raw = ml_to_prob(mkt_away_pl_odds)
        p_home_pl_raw = ml_to_prob(mkt_home_pl_odds)

        # Remove vig
        p_away_pl_market, p_home_pl_market = remove_vig(p_away_pl_raw, p_home_pl_raw)

        # Distribution-translated model probabilities at the MARKET's puck line threshold.
        # The market always prices ±1.5 (threshold=2 goals).
        # CRITICAL: must use the BOOK's favorite, NOT the model's favorite.
        # The model and book can disagree on who the favorite is (e.g. model has STL -1.5
        # but book has WPG -1.5). Using probs["fav_is_home"] (model's favorite) would compute
        # the model's odds at its OWN line, not the book's line.
        # margin = home_goals - away_goals
        #   If BOOK HOME is -1.5 favorite: P(home covers -1.5) = P(margin >= 2); P(away covers +1.5) = 1 - that
        #   If BOOK AWAY is -1.5 favorite: P(away covers -1.5) = P(margin <= -2); P(home covers +1.5) = 1 - that
        mkt_pl_threshold = 2  # market ±1.5 → need to win by 2+ goals to cover
        # Book's -1.5 favorite: use mkt_away_spread (signed spread for away team).
        # mkt_away_spread > 0 means away is at +1.5 (underdog) → home is the -1.5 favorite.
        # mkt_away_spread < 0 means away is at -1.5 (favorite) → away is the -1.5 favorite.
        # NEVER use odds to determine this: underdog's +1.5 odds can be more negative than
        # favorite's -1.5 odds (e.g. STL +1.5 at -290 vs WPG -1.5 at +100).
        # mkt_away_spread is passed explicitly as a parameter (not from module-level inp)
        if mkt_away_spread is not None:
            book_fav_is_home = (
                float(mkt_away_spread) > 0
            )  # away at +1.5 → home is -1.5 fav
        else:
            # Fallback: use model's own favorite determination
            book_fav_is_home = probs["fav_is_home"]
        if book_fav_is_home:
            # Book: home is the -1.5 favorite
            p_home_pl_model = prob_margin_cover(
                margin_dist, mkt_pl_threshold, n, home_covers=True
            )  # P(home wins by 2+)
            p_away_pl_model = 1.0 - p_home_pl_model  # P(away covers +1.5)
        else:
            # Book: away is the -1.5 favorite
            p_away_pl_model = prob_margin_cover(
                margin_dist, mkt_pl_threshold, n, home_covers=False
            )  # P(away wins by 2+)
            p_home_pl_model = 1.0 - p_away_pl_model  # P(home covers +1.5)

        # Fair odds
        fair_away_pl_odds = prob_to_ml(p_away_pl_model)
        fair_home_pl_odds = prob_to_ml(p_home_pl_model)

        # Probability edges
        edge_away_pl = p_away_pl_model - p_away_pl_market
        edge_home_pl = p_home_pl_model - p_home_pl_market

        # EV
        ev_away_pl = expected_value(p_away_pl_model, mkt_away_pl_odds)
        ev_home_pl = expected_value(p_home_pl_model, mkt_home_pl_odds)

        # Price edge
        price_edge_away_pl = fair_away_pl_odds - mkt_away_pl_odds
        price_edge_home_pl = fair_home_pl_odds - mkt_home_pl_odds

        # Classify
        class_away_pl = classify_edge(edge_away_pl)
        class_home_pl = classify_edge(edge_home_pl)

        # Use the model's puck line spread for the edge label (±1.5 or ±2.5)
        away_pl_label = f"AWAY {probs['away_pl_spread']:+.1f}"
        home_pl_label = f"HOME {probs['home_pl_spread']:+.1f}"

        # ── DEEP DIAGNOSTIC LOG: PUCK LINE ──
        vig_pct_pl = (p_away_pl_raw + p_home_pl_raw - 1.0) * 100
        book_fav_label = "HOME" if book_fav_is_home else "AWAY"
        print(
            f"[EdgeDetect] │  PUCK LINE ±1.5 (book fav={book_fav_label}, model fav={'HOME' if probs['fav_is_home'] else 'AWAY'})",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book odds: AWAY {mkt_away_pl_odds:+d}  HOME {mkt_home_pl_odds:+d}  (vig={vig_pct_pl:.2f}%)",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book implied (raw):    AWAY={p_away_pl_raw * 100:.2f}%  HOME={p_home_pl_raw * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book break-even (no-vig): AWAY={p_away_pl_market * 100:.2f}%  HOME={p_home_pl_market * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Model probability @±1.5: AWAY={p_away_pl_model * 100:.2f}%  HOME={p_home_pl_model * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Edge (model - break-even): AWAY={edge_away_pl * 100:+.2f}pp  HOME={edge_home_pl * 100:+.2f}pp",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Fair odds: AWAY={fair_away_pl_odds:+d}  HOME={fair_home_pl_odds:+d}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Price edge: AWAY={price_edge_away_pl:+.0f}  HOME={price_edge_home_pl:+.0f}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    EV: AWAY={ev_away_pl * 100:+.2f}%  HOME={ev_home_pl * 100:+.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Verdict: AWAY={class_away_pl}  HOME={class_home_pl}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Threshold check: AWAY edge {edge_away_pl * 100:+.2f}pp {'≥' if edge_away_pl >= 0.015 else '<'} 1.5pp → {'REPORT' if edge_away_pl >= 0.015 else 'SUPPRESS'}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Threshold check: HOME edge {edge_home_pl * 100:+.2f}pp {'≥' if edge_home_pl >= 0.015 else '<'} 1.5pp → {'REPORT' if edge_home_pl >= 0.015 else 'SUPPRESS'}",
            file=sys.stderr,
        )

        if edge_away_pl >= 0.015:
            edges.append(
                {
                    "type": "PUCK_LINE",
                    "side": away_pl_label,
                    "model_prob": round(p_away_pl_model * 100, 2),
                    "mkt_prob": round(p_away_pl_market * 100, 2),
                    "mkt_prob_raw": round(p_away_pl_raw * 100, 2),
                    "edge_vs_be": round(edge_away_pl * 100, 2),
                    "ev": round(ev_away_pl * 100, 2),
                    "fair_odds": fair_away_pl_odds,
                    "price_edge": round(price_edge_away_pl, 0),
                    "classification": class_away_pl,
                    "conf": "HIGH"
                    if edge_away_pl >= PUCK_LINE_EDGE_THRESHOLD
                    else ("MOD" if edge_away_pl >= ML_EDGE_THRESHOLD else "LOW"),
                }
            )

        if edge_home_pl >= 0.015:
            edges.append(
                {
                    "type": "PUCK_LINE",
                    "side": home_pl_label,
                    "model_prob": round(p_home_pl_model * 100, 2),
                    "mkt_prob": round(p_home_pl_market * 100, 2),
                    "mkt_prob_raw": round(p_home_pl_raw * 100, 2),
                    "edge_vs_be": round(edge_home_pl * 100, 2),
                    "ev": round(ev_home_pl * 100, 2),
                    "fair_odds": fair_home_pl_odds,
                    "price_edge": round(price_edge_home_pl, 0),
                    "classification": class_home_pl,
                    "conf": "HIGH"
                    if edge_home_pl >= PUCK_LINE_EDGE_THRESHOLD
                    else ("MOD" if edge_home_pl >= ML_EDGE_THRESHOLD else "LOW"),
                }
            )

    # ── MONEYLINE MARKET ─────────────────────────────────────────────────────
    if mkt_away_ml is not None and mkt_home_ml is not None:
        # Raw implied probabilities
        p_away_ml_raw = ml_to_prob(mkt_away_ml)
        p_home_ml_raw = ml_to_prob(mkt_home_ml)

        # Remove vig
        p_away_ml_market, p_home_ml_market = remove_vig(p_away_ml_raw, p_home_ml_raw)

        # Model probabilities (from simulation)
        p_away_ml_model = probs["away_win"]
        p_home_ml_model = probs["home_win"]

        # Fair odds
        fair_away_ml_odds = prob_to_ml(p_away_ml_model)
        fair_home_ml_odds = prob_to_ml(p_home_ml_model)

        # Probability edges
        edge_away_ml = p_away_ml_model - p_away_ml_market
        edge_home_ml = p_home_ml_model - p_home_ml_market

        # EV
        ev_away_ml = expected_value(p_away_ml_model, mkt_away_ml)
        ev_home_ml = expected_value(p_home_ml_model, mkt_home_ml)

        # Price edge
        price_edge_away_ml = fair_away_ml_odds - mkt_away_ml
        price_edge_home_ml = fair_home_ml_odds - mkt_home_ml

        # Classify
        class_away_ml = classify_edge(edge_away_ml)
        class_home_ml = classify_edge(edge_home_ml)

        # ── DEEP DIAGNOSTIC LOG: MONEYLINE ──
        vig_pct_ml = (p_away_ml_raw + p_home_ml_raw - 1.0) * 100
        print("[EdgeDetect] │  MONEYLINE", file=sys.stderr)
        print(
            f"[EdgeDetect] │    Book odds: AWAY {mkt_away_ml:+d}  HOME {mkt_home_ml:+d}  (vig={vig_pct_ml:.2f}%)",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book implied (raw):    AWAY={p_away_ml_raw * 100:.2f}%  HOME={p_home_ml_raw * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Book break-even (no-vig): AWAY={p_away_ml_market * 100:.2f}%  HOME={p_home_ml_market * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Model probability: AWAY={p_away_ml_model * 100:.2f}%  HOME={p_home_ml_model * 100:.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Edge (model - break-even): AWAY={edge_away_ml * 100:+.2f}pp  HOME={edge_home_ml * 100:+.2f}pp",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Fair odds: AWAY={fair_away_ml_odds:+d}  HOME={fair_home_ml_odds:+d}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Price edge: AWAY={price_edge_away_ml:+.0f}  HOME={price_edge_home_ml:+.0f}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    EV: AWAY={ev_away_ml * 100:+.2f}%  HOME={ev_home_ml * 100:+.2f}%",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Verdict: AWAY={class_away_ml}  HOME={class_home_ml}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Threshold check: AWAY edge {edge_away_ml * 100:+.2f}pp {'≥' if edge_away_ml >= 0.015 else '<'} 1.5pp → {'REPORT' if edge_away_ml >= 0.015 else 'SUPPRESS'}",
            file=sys.stderr,
        )
        print(
            f"[EdgeDetect] │    Threshold check: HOME edge {edge_home_ml * 100:+.2f}pp {'≥' if edge_home_ml >= 0.015 else '<'} 1.5pp → {'REPORT' if edge_home_ml >= 0.015 else 'SUPPRESS'}",
            file=sys.stderr,
        )

        if edge_away_ml >= 0.015:
            edges.append(
                {
                    "type": "ML",
                    "side": "AWAY ML",
                    "model_prob": round(p_away_ml_model * 100, 2),
                    "mkt_prob": round(p_away_ml_market * 100, 2),
                    "mkt_prob_raw": round(p_away_ml_raw * 100, 2),
                    "edge_vs_be": round(edge_away_ml * 100, 2),
                    "ev": round(ev_away_ml * 100, 2),
                    "fair_odds": fair_away_ml_odds,
                    "price_edge": round(price_edge_away_ml, 0),
                    "classification": class_away_ml,
                    "conf": "HIGH"
                    if edge_away_ml >= TOTAL_EDGE_THRESHOLD
                    else ("MOD" if edge_away_ml >= ML_EDGE_THRESHOLD else "LOW"),
                }
            )

        if edge_home_ml >= 0.015:
            edges.append(
                {
                    "type": "ML",
                    "side": "HOME ML",
                    "model_prob": round(p_home_ml_model * 100, 2),
                    "mkt_prob": round(p_home_ml_market * 100, 2),
                    "mkt_prob_raw": round(p_home_ml_raw * 100, 2),
                    "edge_vs_be": round(edge_home_ml * 100, 2),
                    "ev": round(ev_home_ml * 100, 2),
                    "fair_odds": fair_home_ml_odds,
                    "price_edge": round(price_edge_home_ml, 0),
                    "classification": class_home_ml,
                    "conf": "HIGH"
                    if edge_home_ml >= TOTAL_EDGE_THRESHOLD
                    else ("MOD" if edge_home_ml >= ML_EDGE_THRESHOLD else "LOW"),
                }
            )

    # ── FINAL EDGE SUMMARY ──
    print(
        "[EdgeDetect] ├─────────────────────────────────────────────────────",
        file=sys.stderr,
    )
    if edges:
        print(f"[EdgeDetect] │  EDGES FLAGGED ({len(edges)}):", file=sys.stderr)
        for e in edges:
            print(
                f"[EdgeDetect] │    ► {e['type']} {e['side']}: {e['classification']} | model={e['model_prob']:.2f}% BE={e['mkt_prob']:.2f}% edge={e['edge_vs_be']:+.2f}pp EV={e['ev']:+.2f}% fair={e['fair_odds']:+d}",
                file=sys.stderr,
            )
    else:
        print(
            "[EdgeDetect] │  NO EDGES FLAGGED (all markets within threshold)",
            file=sys.stderr,
        )
    print(
        "[EdgeDetect] └─────────────────────────────────────────────────────",
        file=sys.stderr,
    )

    return edges


# ───────────────────────────────────────────────────────────────────────────────
# SECTION 11 — CONSISTENCY VALIDATION
# ─────────────────────────────────────────────────────────────────────────────


def validate_consistency(probs: dict, mu_away: float, mu_home: float) -> list[str]:
    """
    Section 11 — Consistency Constraints:
    1. P(home_win) + P(away_win) = 1
    2. E_total = mu_home + mu_away
    3. P(home −1.5) ≤ P(home_win)
    4. All markets from same distribution ✓ (by construction)

    Returns list of violation messages (empty = all constraints satisfied).
    """
    violations = []

    # Constraint 1: probabilities sum to 1
    prob_sum = probs["home_win"] + probs["away_win"]
    if abs(prob_sum - 1.0) > 0.001:
        violations.append(f"C1 VIOLATION: P(home)+P(away)={prob_sum:.4f} ≠ 1.0")

    # Constraint 2: E_total ≈ mu_home + mu_away
    expected_total = mu_away + mu_home
    sim_total = probs["e_total"]
    if abs(sim_total - expected_total) > 0.30:
        violations.append(
            f"C2 WARNING: E_total_sim={sim_total:.3f} vs mu_sum={expected_total:.3f}"
        )

    # Constraint 3: P(fav covers -1.5) ≤ P(fav wins outright)
    # Only applies to the FAVORITE's cover probability (winning by 2+).
    # The underdog's cover probability (P(underdog covers +1.5)) is always > P(underdog wins)
    # and that is mathematically correct, not a violation.
    fav_is_home = probs.get("fav_is_home", True)
    if fav_is_home:
        fav_pl_cover = probs["home_pl_cover"]
        fav_win_prob = probs["home_win"]
        fav_label = "home"
    else:
        fav_pl_cover = probs["away_pl_cover"]
        fav_win_prob = probs["away_win"]
        fav_label = "away"
    if fav_pl_cover > fav_win_prob + 0.001:
        violations.append(
            f"C3 VIOLATION: P({fav_label}-1.5)={fav_pl_cover:.4f} > P({fav_label}_win)={fav_win_prob:.4f}"
        )

    return violations


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 12 — FINAL MARKET OUTPUT
# ─────────────────────────────────────────────────────────────────────────────


def originate_game(inp: dict) -> dict:
    """
    Full Sharp Line Origination Engine pipeline:
    1. Load team stats from input
    2. Compute OFF_rating and DEF_rating (Section 2)
    3. Compute goalie multipliers (Section 3)
    4. Project mu_away and mu_home (Section 4)
    5. Run 200k correlated NB simulation (Sections 5–6)
    6. Calculate all probabilities from joint distribution (Section 7)
    7. Originate ML, puck line, total from SAME distribution (Sections 8–10)
    8. Validate consistency constraints (Section 11)
    9. Detect edges
    10. Return Section 12 market output
    """
    away_name = inp["away_team"]
    home_name = inp["home_team"]
    away_abbrev = inp.get("away_abbrev", "AWAY")
    home_abbrev = inp.get("home_abbrev", "HOME")

    # ── PLAYOFF MODE ──────────────────────────────────────────────────────────
    # When playoff_mode=True, override LEAGUE_GOAL_RATE and GOALIE_REGRESSION_K
    # to reflect playoff scoring environment:
    #   - Playoff avg GF/G = 2.881 (vs regular season 3.158) → 8.8% reduction
    #   - Playoff LEAGUE_GOAL_RATE = 2.83 (all-sit, calibrated for playoff pace)
    #   - Goalie regression K = 200 (smaller prior for playoff sample sizes ~200-350 SA)
    # Team stats passed in playoff_mode must be computed from playoff GF/G rates
    # normalized against PLAYOFF league averages (not regular season averages).
    playoff_mode = bool(inp.get("playoff_mode", False))
    if playoff_mode:
        effective_league_goal_rate = 2.83   # Playoff all-sit goals/team/game (2025-26 calibrated)
        effective_goalie_regression_k = 200  # Smaller prior: playoff goalies have 200-350 SA
        print(f"[NHLModel]   ► PLAYOFF MODE: league_goal_rate={effective_league_goal_rate} goalie_k={effective_goalie_regression_k}", file=sys.stderr)
    else:
        effective_league_goal_rate = LEAGUE_GOAL_RATE
        effective_goalie_regression_k = GOALIE_REGRESSION_K

    # Deterministic seeded RNG: seed derived from game identity so identical inputs
    # always produce identical outputs. Seed = hash(away_abbrev + home_abbrev + game_date).
    _game_key = f"{away_abbrev}@{home_abbrev}:{inp.get('game_date', '')}"
    _seed = int(abs(hash(_game_key))) % (2**31)
    _rng = np.random.default_rng(_seed)

    team_stats = inp.get("team_stats", {})
    away_stats = team_stats.get(away_abbrev) or team_stats.get(away_name)
    home_stats = team_stats.get(home_abbrev) or team_stats.get(home_name)

    if not away_stats or not home_stats:
        return {
            "ok": False,
            "error": f"Missing team stats for {away_abbrev} or {home_abbrev}. Available: {list(team_stats.keys())}",
        }

    # Goalie inputs
    away_goalie_gsax = float(inp.get("away_goalie_gsax") or 0.0)
    away_goalie_shots_faced = int(inp.get("away_goalie_shots_faced") or 0)
    away_goalie_gp = int(inp.get("away_goalie_gp") or 1)
    home_goalie_gsax = float(inp.get("home_goalie_gsax") or 0.0)
    home_goalie_shots_faced = int(inp.get("home_goalie_shots_faced") or 0)
    home_goalie_gp = int(inp.get("home_goalie_gp") or 1)

    # Schedule inputs
    away_rest_days = inp.get("away_rest_days")
    home_rest_days = inp.get("home_rest_days")

    # Market inputs
    mkt_away_ml = inp.get("mkt_away_ml")
    mkt_home_ml = inp.get("mkt_home_ml")
    mkt_total = inp.get("mkt_total")
    mkt_away_pl_odds = inp.get("mkt_away_pl_odds")
    mkt_home_pl_odds = inp.get("mkt_home_pl_odds")
    mkt_over_odds = inp.get("mkt_over_odds")
    mkt_under_odds = inp.get("mkt_under_odds")

    # ── Logging ──────────────────────────────────────────────────────────────
    print(
        "\n[NHLModel] ════════════════════════════════════════════════════",
        file=sys.stderr,
    )
    print(f"[NHLModel] ► ORIGINATING: {away_name} @ {home_name}", file=sys.stderr)
    print(
        f"[NHLModel]   Away goalie: {inp.get('away_goalie', '?')} | GSAx={away_goalie_gsax:.2f} | GP={away_goalie_gp} | SF={away_goalie_shots_faced}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Home goalie: {inp.get('home_goalie', '?')} | GSAx={home_goalie_gsax:.2f} | GP={home_goalie_gp} | SF={home_goalie_shots_faced}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Rest: away={away_rest_days}d home={home_rest_days}d",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Market: PL={mkt_away_pl_odds}/{mkt_home_pl_odds} | Total={mkt_total} ({mkt_over_odds}/{mkt_under_odds}) | ML={mkt_away_ml}/{mkt_home_ml}",
        file=sys.stderr,
    )

    t0 = time.time()

    # ── Step 2: Team strength ratings ────────────────────────────────────────
    off_away = compute_off_rating(away_stats)
    def_away = compute_def_rating(away_stats)
    off_home = compute_off_rating(home_stats)
    def_home = compute_def_rating(home_stats)
    print(
        f"[NHLModel]   OFF: {away_abbrev}={off_away:.4f} {home_abbrev}={off_home:.4f}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   DEF: {away_abbrev}={def_away:.4f} {home_abbrev}={def_home:.4f}",
        file=sys.stderr,
    )

    # ── Step 3: Goalie multipliers ────────────────────────────────────────────
    gm_away = compute_goalie_multiplier(
        away_goalie_gsax, away_goalie_shots_faced, away_goalie_gp
    )
    gm_home = compute_goalie_multiplier(
        home_goalie_gsax, home_goalie_shots_faced, home_goalie_gp
    )
    print(
        f"[NHLModel]   Goalie multipliers: {away_abbrev}={gm_away:.4f} {home_abbrev}={gm_home:.4f}",
        file=sys.stderr,
    )

    # ── Step 4: Expected goals ────────────────────────────────────────────────
    mu_away, mu_home = project_goals(
        away_stats,
        home_stats,
        away_goalie_gsax,
        away_goalie_shots_faced,
        away_goalie_gp,
        home_goalie_gsax,
        home_goalie_shots_faced,
        home_goalie_gp,
        away_rest_days,
        home_rest_days,
        league_goal_rate=effective_league_goal_rate,
        goalie_regression_k=effective_goalie_regression_k,
    )
    print(
        f"[NHLModel]   μ_away={mu_away:.4f}  μ_home={mu_home:.4f}  E_total={mu_away + mu_home:.4f}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Fatigue: away={compute_fatigue_factor(away_rest_days):.2f} home={compute_fatigue_factor(home_rest_days):.2f}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Pace factor: {compute_pace_factor(away_stats, home_stats):.4f}",
        file=sys.stderr,
    )

    # ── Steps 5–6: Monte Carlo simulation ────────────────────────────────────
    print(
        f"[NHLModel]   Running {SIMULATIONS:,} correlated NB simulations (k={NB_K}, rho={GOAL_CORRELATION})...",
        file=sys.stderr,
    )
    away_scores, home_scores = run_simulation(mu_away, mu_home, rng=_rng)

    # ── Step 7: Probabilities ─────────────────────────────────────────────────
    probs = calculate_probs(away_scores, home_scores)
    print(
        f"[NHLModel]   Win%: {away_abbrev}={probs['away_win'] * 100:.2f}% {home_abbrev}={probs['home_win'] * 100:.2f}%",
        file=sys.stderr,
    )
    pl_spread = probs["puck_line_spread"]
    fav_label = home_abbrev if probs["fav_is_home"] else away_abbrev
    print(f"[NHLModel]   PL spread: ±{pl_spread} | Fav={fav_label}", file=sys.stderr)
    print(
        f"[NHLModel]   PL%:  {away_abbrev}{probs['away_pl_spread']:+.1f}={probs['away_pl_cover'] * 100:.2f}% {home_abbrev}{probs['home_pl_spread']:+.1f}={probs['home_pl_cover'] * 100:.2f}%",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Total: line={probs['best_total_line']} over={probs['over_prob'] * 100:.2f}% under={probs['under_prob'] * 100:.2f}%",
        file=sys.stderr,
    )
    # ── Steps 8–10: Market origination ───────────────────────────────────────────
    # Section 8: Moneyline
    model_away_ml = prob_to_ml(probs["away_win"])
    model_home_ml = prob_to_ml(probs["home_win"])

    # Section 9: Puck line (dynamic spread from origination engine)
    model_away_pl_spread = probs["away_pl_spread"]  # e.g. +1.5 or -2.5
    model_home_pl_spread = probs["home_pl_spread"]  # e.g. -1.5 or +2.5
    model_away_pl_odds = prob_to_ml(probs["away_pl_cover"])
    model_home_pl_odds = prob_to_ml(probs["home_pl_cover"])

    # Validation: spread must be ±1.5 or ±2.5 (Section 8 of spec)
    allowed_spreads = {-2.5, -1.5, 1.5, 2.5}
    if (
        model_away_pl_spread not in allowed_spreads
        or model_home_pl_spread not in allowed_spreads
    ):
        raise ValueError(
            f"PUCK LINE VALIDATION FAILED: away={model_away_pl_spread} home={model_home_pl_spread} — must be in {allowed_spreads}"
        )
    if abs(model_away_pl_spread) != abs(model_home_pl_spread):
        raise ValueError(
            f"PUCK LINE VALIDATION FAILED: |away|={abs(model_away_pl_spread)} != |home|={abs(model_home_pl_spread)}"
        )
    if model_away_pl_spread != -model_home_pl_spread:
        raise ValueError(
            f"PUCK LINE VALIDATION FAILED: away={model_away_pl_spread} != -home={model_home_pl_spread}"
        )

    # Section 10: Total
    model_total_line = probs["best_total_line"]
    model_over_odds = prob_to_ml(probs["over_prob"])
    model_under_odds = prob_to_ml(probs["under_prob"])

    print(
        f"[NHLModel]   ML:    {format_ml(model_away_ml)} / {format_ml(model_home_ml)}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   PL:    {model_away_pl_spread:+.1f} {format_ml(model_away_pl_odds)} / {model_home_pl_spread:+.1f} {format_ml(model_home_pl_odds)}",
        file=sys.stderr,
    )
    print(
        f"[NHLModel]   Total: {model_total_line} ({format_ml(model_over_odds)} / {format_ml(model_under_odds)})",
        file=sys.stderr,
    )

    # ── Step 8: Consistency validation ───────────────────────────────────────────
    violations = validate_consistency(probs, mu_away, mu_home)
    if violations:
        for v in violations:
            print(f"[NHLModel]   ⚠ {v}", file=sys.stderr)
    else:
        print(
            "[NHLModel]   ✓ All Section 11 consistency constraints satisfied",
            file=sys.stderr,
        )

    # ── Step 9: Sharp Edge Detection (distribution-translated, vig-removed, EV+price) ──
    edges = detect_edges(
        probs,
        away_scores,
        home_scores,
        mkt_away_pl_odds,
        mkt_home_pl_odds,
        mkt_over_odds,
        mkt_under_odds,
        mkt_away_ml,
        mkt_home_ml,
        mkt_total,
        mkt_away_spread=inp.get("mkt_away_spread"),
    )

    # ── Step 10: Compute model fair odds AT the BOOK's lines ─────────────────
    # This is the core of the edge-finding framework:
    # Display model odds at the SAME line as the book, not the model's derived line.
    # e.g. if book has O/U 6.5, show model's fair odds at 6.5 (not at model's 6.0)
    n_sim = len(away_scores)
    total_dist = build_total_distribution(away_scores, home_scores)
    margin_dist = build_margin_distribution(away_scores, home_scores)

    # Model fair odds at BOOK total line
    if mkt_total is not None:
        p_over_at_mkt = prob_total_over(total_dist, mkt_total, n_sim)
        p_under_at_mkt = prob_total_under(total_dist, mkt_total, n_sim)
        # Redistribute push probability
        push_at_mkt = 1.0 - p_over_at_mkt - p_under_at_mkt
        p_over_at_mkt += push_at_mkt * 0.5
        p_under_at_mkt += push_at_mkt * 0.5
        mkt_total_model_over_odds = prob_to_ml(p_over_at_mkt)
        mkt_total_model_under_odds = prob_to_ml(p_under_at_mkt)
        print(
            f"[NHLModel]   Model odds @ book total {mkt_total}: O={format_ml(mkt_total_model_over_odds)} U={format_ml(mkt_total_model_under_odds)}",
            file=sys.stderr,
        )
    else:
        mkt_total_model_over_odds = model_over_odds
        mkt_total_model_under_odds = model_under_odds

    # Model fair odds at BOOK puck line (always ±1.5 in NHL)
    # CRITICAL: must determine which team is the -1.5 favorite before computing cover probabilities.
    # margin = home_goals - away_goals (positive = home winning)
    #
    # If HOME is favorite (-1.5):
    #   P(home covers -1.5) = P(home wins by 2+) = P(margin >= 2)
    #   P(away covers +1.5) = 1 - P(home covers -1.5)
    #
    # If AWAY is favorite (-1.5):
    #   P(away covers -1.5) = P(away wins by 2+) = P(margin <= -2)
    #   P(home covers +1.5) = 1 - P(away covers -1.5)
    #
    # CRITICAL: use the BOOK's favorite to determine which team covers -1.5 at the market line.
    # The model and book can disagree on who the favorite is. Using the model's fav_is_home
    # would compute the model's odds at its OWN origination line, not the book's ±1.5 line.
    # Use mkt_away_spread (signed spread for away team) — the only reliable indicator.
    # mkt_away_spread > 0 means away is at +1.5 (underdog) → home is the -1.5 favorite.
    # mkt_away_spread < 0 means away is at -1.5 (favorite) → away is the -1.5 favorite.
    mkt_away_spread_val = inp.get("mkt_away_spread")
    if mkt_away_spread_val is not None:
        book_fav_is_home_disp = float(mkt_away_spread_val) > 0
    else:
        # Fallback: use model's own favorite determination
        book_fav_is_home_disp = probs["fav_is_home"]
    if book_fav_is_home_disp:
        # Book: home is the -1.5 favorite
        p_home_pl_at_mkt = prob_margin_cover(
            margin_dist, 2, n_sim, home_covers=True
        )  # P(home wins by 2+)
        p_away_pl_at_mkt = 1.0 - p_home_pl_at_mkt  # P(away covers +1.5)
    else:
        # Book: away is the -1.5 favorite
        p_away_pl_at_mkt = prob_margin_cover(
            margin_dist, 2, n_sim, home_covers=False
        )  # P(away wins by 2+)
        p_home_pl_at_mkt = 1.0 - p_away_pl_at_mkt  # P(home covers +1.5)
    mkt_pl_model_home_odds = prob_to_ml(p_home_pl_at_mkt)
    mkt_pl_model_away_odds = prob_to_ml(p_away_pl_at_mkt)
    print(
        f"[NHLModel]   Model odds @ book PL ±1.5 (book_fav={'HOME' if book_fav_is_home_disp else 'AWAY'}, model_fav={'HOME' if probs['fav_is_home'] else 'AWAY'}): away={format_ml(mkt_pl_model_away_odds)} ({p_away_pl_at_mkt * 100:.2f}%) home={format_ml(mkt_pl_model_home_odds)} ({p_home_pl_at_mkt * 100:.2f}%)",
        file=sys.stderr,
    )

    elapsed = time.time() - t0
    print(
        f"[NHLModel]   ✓ Done in {elapsed:.3f}s | Edges detected: {len(edges)}",
        file=sys.stderr,
    )
    print(
        "[NHLModel] ════════════════════════════════════════════════════\n",
        file=sys.stderr,
    )

    # ── Section 12: Final market output ──────────────────────────────────────
    return {
        "ok": True,
        "game": f"{away_name} @ {home_name}",
        "away_name": away_name,
        "home_name": home_name,
        "away_abbrev": away_abbrev,
        "home_abbrev": home_abbrev,
        "away_goalie": inp.get("away_goalie"),
        "home_goalie": inp.get("home_goalie"),
        # Projected goals (Section 4)
        "proj_away_goals": round(mu_away, 2),
        "proj_home_goals": round(mu_home, 2),
        # Puck line (Section 9) — ±1.5 or ±2.5 based on distribution
        "away_puck_line": f"{model_away_pl_spread:+.1f}",
        "away_puck_line_odds": model_away_pl_odds,
        "home_puck_line": f"{model_home_pl_spread:+.1f}",
        "home_puck_line_odds": model_home_pl_odds,
        "puck_line_spread": probs["puck_line_spread"],  # 1.5 or 2.5 (absolute)
        # Model fair odds AT the BOOK's ±1.5 puck line (for side-by-side display)
        # These are the odds to show next to the book's +1.5/-1.5 line
        "mkt_pl_away_odds": mkt_pl_model_away_odds,
        "mkt_pl_home_odds": mkt_pl_model_home_odds,
        # Model cover% AT the BOOK's ±1.5 puck line (must match mkt_pl_away/home_odds)
        # p_away_pl_at_mkt = P(away covers the book's away spread)
        # p_home_pl_at_mkt = P(home covers the book's home spread)
        "mkt_pl_away_cover_pct": round(p_away_pl_at_mkt * 100, 2),
        "mkt_pl_home_cover_pct": round(p_home_pl_at_mkt * 100, 2),
        # Moneylines (Section 8)
        "away_ml": model_away_ml,
        "home_ml": model_home_ml,
        # Total (Section 10) — model's own derived line
        "total_line": model_total_line,
        "over_odds": model_over_odds,
        "under_odds": model_under_odds,
        # Model fair odds AT the BOOK's total line (for side-by-side display)
        # e.g. if book has 6.5, these are model's fair odds at 6.5
        "mkt_total_over_odds": mkt_total_model_over_odds,
        "mkt_total_under_odds": mkt_total_model_under_odds,
        # Probabilities (Section 7)
        "away_win_pct": round(probs["away_win"] * 100, 2),
        "home_win_pct": round(probs["home_win"] * 100, 2),
        "away_pl_cover_pct": round(probs["away_pl_cover"] * 100, 2),
        "home_pl_cover_pct": round(probs["home_pl_cover"] * 100, 2),
        "over_pct": round(probs["over_prob"] * 100, 2),
        "under_pct": round(probs["under_prob"] * 100, 2),
        # Edges
        "edges": edges,
        # Diagnostics
        "consistency_violations": violations,
        "error": None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# STDIN/STDOUT PROTOCOL
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            result = {"ok": False, "error": "Empty input"}
        else:
            inp = json.loads(raw)
            # Batch mode: if input is a list, process all games and return list of results.
            # Single-game mode: if input is a dict, process one game and return one result.
            if isinstance(inp, list):
                result = []
                for game_inp in inp:
                    try:
                        result.append(originate_game(game_inp))
                    except Exception as ge:
                        import traceback

                        result.append(
                            {
                                "ok": False,
                                "error": str(ge),
                                "traceback": traceback.format_exc(),
                                "game": f"{game_inp.get('away_abbrev', '?')} @ {game_inp.get('home_abbrev', '?')}",
                            }
                        )
            else:
                result = originate_game(inp)
    except json.JSONDecodeError as e:
        result = {"ok": False, "error": f"JSON parse error: {e}"}
    except Exception as e:
        import traceback

        result = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}

    # Output ONLY the JSON result on the last line of stdout
    print(json.dumps(result))
