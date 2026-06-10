#!/usr/bin/env python3
"""
MLB AI DERIVED MARKET ENGINE — STRIKEOUT PROJECTION MODEL  (Variant D)
=======================================================================
Production model as of 2026-03-26. Back-tested on 4,750 starts (2025 season).

ARCHITECTURE — VARIANT D UPGRADES
-----------------------------------
  1. NegBin Dispersion (r = 22.20)
       Replaces the legacy K_VARIANCE_SCALE-derived r. Fitted via Method-of-Moments
       on 4,750 actual 2025 starter K distributions. Eliminates over-dispersion that
       previously made the tails too fat and the distribution too flat.

  2. Multiplicative TTO Degradation  [1.0, 0.891, 0.832]
       Replaces the legacy additive TTO_K_PENALTY. Derived from 2025 Retrosheet:
         TTO-1: K% = 23.7%  (multiplier = 1.000)
         TTO-2: K% = 21.1%  (multiplier = 0.891)
         TTO-3: K% = 19.7%  (multiplier = 0.832)
       Applied multiplicatively to combined_k so the degradation scales with
       pitcher strength (elite pitchers degrade more in absolute terms).

  3. OLS Calibration Layer  kProj_cal = 1.0305 * kProj_raw + 0.3314
       Post-hoc bias correction fitted on 2,350 back-test starts. Eliminates the
       +0.46 systematic under-projection present in earlier variants.
       Applied to expected_k before NegBin parameters are computed so the full
       distribution is centered on the calibrated mean.

  4. Calibrated IP Constants
       STARTER_IP_MEAN = 5.2804, STARTER_IP_STD = 1.2431 (from 2025 Retrosheet)
       PA_PER_INNING   = 4.05   (130,204 PAs / 32,158 starter-inning-slots, inn 1-6)

BACK-TEST RESULTS (2025 season, n=4,750 starts)
-------------------------------------------------
  MAE   : 1.714  (vs. 2.000 Baseline, 1.953 Variant C)
  RMSE  : 2.142  (vs. 2.561 Baseline, 2.499 Variant C)
  Bias  : 0.000  (vs. +1.502 Baseline, -1.470 Variant C)
  PropAcc: 79.3% (vs. 76.6% Baseline, 77.3% Variant C)

USAGE
------
    python StrikeoutModel.py \\
        --plays         /path/to/plays.csv \\
        --statcast      /path/to/statcast.json \\
        --crosswalk     /path/to/crosswalk.csv \\
        --game-date     YYYY-MM-DD \\
        --away-team     NYA \\
        --home-team     SFN \\
        --away-pitcher  friem001 \\
        --home-pitcher  webbl001 \\
        --away-lineup   grish001 judgea001 bellic001 riceb001 stang001 chisj001 cabaj001 mcmah001 wella001 \\
        --home-lineup   arraez001 chapm001 dever001 adama001 leejh001 ramoh001 schmc001 bailp001 baderh001 \\
        --away-market   6.5 -115 -105 \\
        --home-market   5.5 +110 -130 \\
        --output        /path/to/output.html
"""

import argparse
import json
import math
import warnings
from datetime import datetime

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ============================================================
# CONSTANTS
# ============================================================
LEAGUE_K_PCT = 0.224
LEAGUE_BB_PCT = 0.083
LEAGUE_HR_PCT = 0.034
LEAGUE_1B_PCT = 0.148
LEAGUE_2B_PCT = 0.046
LEAGUE_3B_PCT = 0.005
LEAGUE_WOBA = 0.312
LEAGUE_XWOBA = 0.312

LEAGUE_WHIFF_PCT = 24.5
LEAGUE_Z_SWING_MISS = 16.5
LEAGUE_OZ_SWING_MISS = 36.0
LEAGUE_F_STRIKE_PCT = 61.0
LEAGUE_IZ_CONTACT = 83.5
LEAGUE_OZ_CONTACT = 63.0

# League standard deviations for z-score normalization (2025 Statcast)
SD_WHIFF_PCT = 5.8  # pct points
SD_F_STRIKE_PCT = 5.2
SD_IZ_CONTACT = 5.5
SD_OZ_CONTACT = 8.4
SD_FF_SPEED = 2.8  # mph

# Signal weights for combined K rate (sum to 1.0)
SIG_WT_LOG5 = 0.40  # Log5 matchup rate
SIG_WT_WHIFF = 0.25  # Pitcher whiff z-score
SIG_WT_ZONE = 0.20  # Zone/contact z-score
SIG_WT_ARSENAL = 0.15  # Velo + pitch mix z-score

VELO_K_ADJ_PER_MPH = 0.0035
VELO_BASELINE_MPH = 93.0
PITCH_K_WEIGHTS = {"fastball": 0.30, "breaking": 0.45, "offspeed": 0.25}
TTO_K_MULT = [
    1.0,
    0.891,
    0.832,
]  # Variant D: multiplicative TTO degradation (2025 calibrated)
NEGBIN_R = 22.20  # Variant D: NegBin dispersion r (MoM from 2025, n=4750 starts)
STARTER_IP_MEAN = 5.2804  # 2025 calibrated
STARTER_IP_STD = 1.2431  # 2025 calibrated
PA_PER_INNING = (
    4.05  # 2025 calibrated: 130,204 PAs / 32,158 starter-inning-slots (inn 1-6)
)
# OLS post-hoc calibration layer: kProj_cal = CAL_ALPHA * kProj + CAL_BETA
# Fit on 2,350 starts from 2025 Retrosheet back-test. Eliminates +0.46 raw bias.
CAL_ALPHA = 1.0305  # OLS slope  (2025 back-test, n=2350)
CAL_BETA = 0.3314  # OLS intercept (2025 back-test, n=2350)

# Empirical platoon K rates (2025 Retrosheet)
PLATOON_K_RATES = {
    ("L", "L"): 0.240,
    ("L", "R"): 0.226,
    ("R", "L"): 0.218,
    ("R", "R"): 0.225,
}

# Empirical league K rates by inning (2025 Retrosheet)
LEAGUE_K_BY_INNING = {
    1: 0.2241,
    2: 0.2198,
    3: 0.2187,
    4: 0.2165,
    5: 0.2152,
    6: 0.2139,
    7: 0.2178,
    8: 0.2195,
    9: 0.2210,
}

# Empirical lineup-spot PA weights (2025 Retrosheet, 193,367 PAs)
K_LINEUP_SPOT_WEIGHTS = [
    1.0873,
    1.0614,
    1.0383,
    1.0150,
    0.9901,
    0.9638,
    0.9365,
    0.9073,
    0.8802,
]

# Bayesian shrinkage thresholds
MIN_K_PA_PLATOON = 50
MIN_K_PA_HA = 30
MIN_K_PA_INNING = 15
MIN_K_PA_LINEU = 10

# Team display names
TEAM_NAMES = {
    "ARI": ("Arizona", "Diamondbacks", "#A71930", "#E3D4AD"),
    "ATL": ("Atlanta", "Braves", "#CE1141", "#13274F"),
    "BAL": ("Baltimore", "Orioles", "#DF4601", "#000000"),
    "BOS": ("Boston", "Red Sox", "#BD3039", "#0C2340"),
    "CHA": ("Chicago", "White Sox", "#27251F", "#C4CED4"),
    "CHN": ("Chicago", "Cubs", "#0E3386", "#CC3433"),
    "CIN": ("Cincinnati", "Reds", "#C6011F", "#000000"),
    "CLE": ("Cleveland", "Guardians", "#00385D", "#E31937"),
    "COL": ("Colorado", "Rockies", "#33006F", "#C4CED4"),
    "DET": ("Detroit", "Tigers", "#0C2340", "#FA4616"),
    "HOU": ("Houston", "Astros", "#002D62", "#EB6E1F"),
    "KCA": ("Kansas City", "Royals", "#004687", "#BD9B60"),
    "ANA": ("Los Angeles", "Angels", "#BA0021", "#003263"),
    "LAN": ("Los Angeles", "Dodgers", "#005A9C", "#EF3E42"),
    "MIA": ("Miami", "Marlins", "#00A3E0", "#EF3340"),
    "MIL": ("Milwaukee", "Brewers", "#FFC52F", "#12284B"),
    "MIN": ("Minnesota", "Twins", "#002B5C", "#D31145"),
    "NYA": ("New York", "Yankees", "#003087", "#C4CED4"),
    "NYN": ("New York", "Mets", "#002D72", "#FF5910"),
    "OAK": ("Oakland", "Athletics", "#003831", "#EFB21E"),
    "PHI": ("Philadelphia", "Phillies", "#E81828", "#002D72"),
    "PIT": ("Pittsburgh", "Pirates", "#27251F", "#FDB827"),
    "SDN": ("San Diego", "Padres", "#2F241D", "#FFC425"),
    "SEA": ("Seattle", "Mariners", "#0C2C56", "#005C5C"),
    "SFN": ("San Francisco", "Giants", "#FD5A1E", "#F5A623"),
    "STL": ("St. Louis", "Cardinals", "#C41E3A", "#0C2340"),
    "TBA": ("Tampa Bay", "Rays", "#092C5C", "#8FBCE6"),
    "TEX": ("Texas", "Rangers", "#003278", "#C0111F"),
    "TOR": ("Toronto", "Blue Jays", "#134A8E", "#1D2D5C"),
    "WAS": ("Washington", "Nationals", "#AB0003", "#14225A"),
}


# ============================================================
# HELPERS
# ============================================================
def _log5(p_pit: float, p_bat: float, p_lg: float) -> float:
    if p_lg <= 0 or p_lg >= 1:
        return p_lg
    num = (p_pit * p_bat) / p_lg
    den = num + ((1 - p_pit) * (1 - p_bat)) / (1 - p_lg)
    return num / den if den > 0 else 0.0


def _shrink_k(obs_k: int, obs_pa: int, league_rate: float, min_pa: int) -> float:
    if obs_pa < 1:
        return float(league_rate)
    weight = min(1.0, obs_pa / max(min_pa, 1))
    return float(weight * (obs_k / obs_pa) + (1.0 - weight) * league_rate)


def _pct(val, pa, count) -> float:
    if val is not None and not (isinstance(val, float) and math.isnan(val)):
        return float(val) / 100.0
    return float(count) / pa if pa > 0 else 0.0


def _rate(count, pa) -> float:
    return float(count) / pa if pa > 0 else 0.0


def _p2ml(p: float) -> str:
    p = float(np.clip(p, 0.001, 0.999))
    if p >= 0.5:
        return f"-{round((p / (1 - p)) * 100)}"
    return f"+{round(((1 - p) / p) * 100)}"


# ============================================================
# DATA INGESTION
# ============================================================
class DataIngestion:
    def __init__(self, plays_path: str, statcast_path: str, crosswalk_path: str):
        self.plays_path = plays_path
        self.statcast_path = statcast_path
        self.crosswalk_path = crosswalk_path
        self.plays: pd.DataFrame | None = None
        self.statcast_batters: dict[int, dict] = {}
        self.statcast_pitchers: dict[int, dict] = {}
        self.crosswalk: dict[str, int] = {}
        # Per-player split tables (populated by _compute_splits)
        self.pitcher_splits_platoon: dict = {}
        self.pitcher_splits_ha: dict = {}
        self.pitcher_splits_inning: dict = {}
        self.batter_splits_platoon: dict = {}
        self.batter_splits_ha: dict = {}
        self.batter_splits_lineu: dict = {}

    def load(self) -> "DataIngestion":
        print("Loading data sources...")
        self._load_plays()
        self._load_statcast()
        self._load_crosswalk()
        return self

    def _load_plays(self):
        print(f"  Plays: {self.plays_path}")
        self.plays = pd.read_csv(self.plays_path, low_memory=False)
        self.plays["game_date"] = pd.to_datetime(
            self.plays["gid"].str[3:11], format="%Y%m%d", errors="coerce"
        )
        self.plays["home_team"] = self.plays["gid"].str[:3]
        self.plays["month"] = self.plays["game_date"].dt.month
        self._compute_splits()

    def _compute_splits(self):
        """Build 6 per-player K-rate split tables from Retrosheet play-by-play data."""
        p = self.plays
        has_lp = "lp" in p.columns
        has_bathand = "bathand" in p.columns
        has_pithand = "pithand" in p.columns
        # Support both 'inn' (legacy format) and 'inning' (2025 fresh plays format)
        if "inn" not in p.columns and "inning" in p.columns:
            p = p.copy()
            p["inn"] = p["inning"]
            self.plays = p
        has_inning = "inn" in p.columns

        # ---- Pitcher platoon splits (vs L / vs R) ----
        if has_pithand and has_bathand:
            grp = p.groupby(["pitcher", "bathand"])["k"].agg(["sum", "count"])
            for (pid, bh), row in grp.iterrows():
                d = self.pitcher_splits_platoon.setdefault(str(pid), {})
                d[str(bh)] = {"k": int(row["sum"]), "pa": int(row["count"])}

        # ---- Pitcher home/away splits (top_bot=1 → pitcher is home) ----
        grp = p.groupby(["pitcher", "top_bot"])["k"].agg(["sum", "count"])
        for (pid, tb), row in grp.iterrows():
            d = self.pitcher_splits_ha.setdefault(str(pid), {})
            loc = "home" if int(tb) == 1 else "away"
            d[loc] = {"k": int(row["sum"]), "pa": int(row["count"])}

        # ---- Pitcher by inning ----
        if has_inning:
            grp = p.groupby(["pitcher", "inn"])["k"].agg(["sum", "count"])
            for (pid, inn), row in grp.iterrows():
                try:
                    inn_int = int(inn)
                except (ValueError, TypeError):
                    continue
                d = self.pitcher_splits_inning.setdefault(str(pid), {})
                d[inn_int] = {"k": int(row["sum"]), "pa": int(row["count"])}

        # ---- Batter platoon splits (vs L / vs R) ----
        if has_pithand and has_bathand:
            grp = p.groupby(["batter", "pithand"])["k"].agg(["sum", "count"])
            for (bid, ph), row in grp.iterrows():
                d = self.batter_splits_platoon.setdefault(str(bid), {})
                d[str(ph)] = {"k": int(row["sum"]), "pa": int(row["count"])}

        # ---- Batter home/away splits (top_bot=0 → batter is home) ----
        grp = p.groupby(["batter", "top_bot"])["k"].agg(["sum", "count"])
        for (bid, tb), row in grp.iterrows():
            d = self.batter_splits_ha.setdefault(str(bid), {})
            loc = "home" if int(tb) == 0 else "away"
            d[loc] = {"k": int(row["sum"]), "pa": int(row["count"])}

        # ---- Batter by lineup spot ----
        if has_lp:
            p2 = p.copy()
            p2["_lp"] = np.where((p2["lp"] >= 1) & (p2["lp"] <= 9), p2["lp"], np.nan)
            p2 = p2.dropna(subset=["_lp"])
            p2["_lp"] = p2["_lp"].astype(int)
            grp = p2.groupby(["batter", "_lp"])["k"].agg(["sum", "count"])
            for (bid, spot), row in grp.iterrows():
                d = self.batter_splits_lineu.setdefault(str(bid), {})
                d[int(spot)] = {"k": int(row["sum"]), "pa": int(row["count"])}

        print(
            f"  Splits: pit_platoon={len(self.pitcher_splits_platoon)} "
            f"pit_ha={len(self.pitcher_splits_ha)} "
            f"pit_inn={len(self.pitcher_splits_inning)} "
            f"bat_platoon={len(self.batter_splits_platoon)} "
            f"bat_ha={len(self.batter_splits_ha)} "
            f"bat_lineu={len(self.batter_splits_lineu)}"
        )

    def _load_statcast(self):
        print(f"  Statcast: {self.statcast_path}")
        with open(self.statcast_path) as f:
            sc = json.load(f)
        for rec in sc.get("batters", []):
            pid = rec.get("player_id")
            if pid:
                self.statcast_batters[int(pid)] = rec
        for rec in sc.get("pitchers", []):
            pid = rec.get("player_id")
            if pid:
                self.statcast_pitchers[int(pid)] = rec

    def _load_crosswalk(self):
        print(f"  Crosswalk: {self.crosswalk_path}")
        cw = pd.read_csv(self.crosswalk_path)
        for _, row in cw.iterrows():
            if pd.notna(row.get("sc_id")):
                self.crosswalk[str(row["rs_id"])] = int(row["sc_id"])


# ============================================================
# FEATURE ENGINEERING
# ============================================================
class FeatureEngineer:
    def __init__(self, data: DataIngestion):
        self.data = data
        self._pitcher_cache: dict = {}
        self._batter_cache: dict = {}

    def _rs_pitcher(self, rs_id: str) -> dict:
        p = self.data.plays[self.data.plays["pitcher"] == rs_id]
        pa = len(p)
        if pa == 0:
            return {
                "pa": 0,
                "k_pct": LEAGUE_K_PCT,
                "bb_pct": LEAGUE_BB_PCT,
                "hr_pct": LEAGUE_HR_PCT,
                "single_pct": LEAGUE_1B_PCT,
                "double_pct": LEAGUE_2B_PCT,
                "triple_pct": LEAGUE_3B_PCT,
            }
        return {
            "pa": pa,
            "k_pct": p["k"].sum() / pa,
            "bb_pct": p["walk"].sum() / pa,
            "hr_pct": p["hr"].sum() / pa,
            "single_pct": p["single"].sum() / pa,
            "double_pct": p["double"].sum() / pa,
            "triple_pct": p["triple"].sum() / pa,
        }

    def _rs_batter(self, rs_id: str) -> dict:
        b = self.data.plays[self.data.plays["batter"] == rs_id]
        pa = len(b)
        if pa == 0:
            return {
                "pa": 0,
                "k_pct": LEAGUE_K_PCT,
                "bb_pct": LEAGUE_BB_PCT,
                "hr_pct": LEAGUE_HR_PCT,
                "single_pct": LEAGUE_1B_PCT,
                "double_pct": LEAGUE_2B_PCT,
                "triple_pct": LEAGUE_3B_PCT,
            }
        return {
            "pa": pa,
            "k_pct": b["k"].sum() / pa,
            "bb_pct": b["walk"].sum() / pa,
            "hr_pct": b["hr"].sum() / pa,
            "single_pct": b["single"].sum() / pa,
            "double_pct": b["double"].sum() / pa,
            "triple_pct": b["triple"].sum() / pa,
        }

    def get_pitcher_features(self, rs_id: str) -> dict:
        if rs_id in self._pitcher_cache:
            return self._pitcher_cache[rs_id]
        sc_id = self.data.crosswalk.get(rs_id)
        sc = self.data.statcast_pitchers.get(sc_id, {}) if sc_id else {}
        pa = int(sc.get("pa") or 0)
        if pa > 0:
            feats = {
                "rs_id": rs_id,
                "sc_id": sc_id,
                "pa": pa,
                "k_pct": _pct(sc.get("k_percent"), pa, sc.get("strikeout", 0)),
                "bb_pct": _pct(sc.get("bb_percent"), pa, sc.get("walk", 0)),
                "hr_pct": _rate(sc.get("home_run", 0), pa),
                "single_pct": _rate(sc.get("single", 0), pa),
                "double_pct": _rate(sc.get("double", 0), pa),
                "triple_pct": _rate(sc.get("triple", 0), pa),
                "xwoba": float(sc.get("xwoba") or LEAGUE_XWOBA),
                "barrel_rate": (float(sc.get("barrel_batted_rate") or 8.0)) / 100.0,
                "hard_hit": (float(sc.get("hard_hit_percent") or 35.0)) / 100.0,
                "gb_pct": (float(sc.get("groundballs_percent") or 43.0)) / 100.0,
                "fb_pct": (float(sc.get("flyballs_percent") or 35.0)) / 100.0,
                "ff_speed": float(sc.get("ff_avg_speed") or VELO_BASELINE_MPH),
                "ip_per_game": STARTER_IP_MEAN,
                "pitch_hand": sc.get("pitch_hand") or sc.get("p_throws") or "R",
                "xfip_proxy": float(sc.get("xera") or 4.0),
                "whiff_pct": (float(sc.get("whiff_percent") or LEAGUE_WHIFF_PCT))
                / 100.0,
                "z_swing_miss_pct": (
                    float(sc.get("z_swing_miss_percent") or LEAGUE_Z_SWING_MISS)
                )
                / 100.0,
                "oz_swing_miss_pct": (
                    float(sc.get("oz_swing_miss_percent") or LEAGUE_OZ_SWING_MISS)
                )
                / 100.0,
                "f_strike_pct": (
                    float(sc.get("f_strike_percent") or LEAGUE_F_STRIKE_PCT)
                )
                / 100.0,
                "iz_contact_pct": (
                    float(sc.get("iz_contact_percent") or LEAGUE_IZ_CONTACT)
                )
                / 100.0,
                "oz_contact_pct": (
                    float(sc.get("oz_contact_percent") or LEAGUE_OZ_CONTACT)
                )
                / 100.0,
                "n_fastball_pct": float(sc.get("n_fastball_formatted") or 50.0),
                "n_breaking_pct": float(sc.get("n_breaking_formatted") or 30.0),
                "n_offspeed_pct": float(sc.get("n_offspeed_formatted") or 20.0),
                "arm_angle": float(sc.get("arm_angle") or 45.0),
                "name": sc.get("last_name, first_name", rs_id),
                "games": int(sc.get("p_game") or 0),
                "innings": str(sc.get("p_formatted_ip") or "0.0"),
            }
        else:
            rs_feats = self._rs_pitcher(rs_id)
            feats = {
                "rs_id": rs_id,
                "sc_id": sc_id,
                "pa": rs_feats["pa"],
                "k_pct": rs_feats["k_pct"],
                "bb_pct": rs_feats["bb_pct"],
                "hr_pct": rs_feats["hr_pct"],
                "single_pct": rs_feats["single_pct"],
                "double_pct": rs_feats["double_pct"],
                "triple_pct": rs_feats["triple_pct"],
                "xwoba": LEAGUE_XWOBA,
                "barrel_rate": 0.08,
                "hard_hit": 0.35,
                "gb_pct": 0.43,
                "fb_pct": 0.35,
                "ff_speed": 92.0,
                "ip_per_game": STARTER_IP_MEAN,
                "pitch_hand": "R",
                "xfip_proxy": 4.0,
                "whiff_pct": LEAGUE_WHIFF_PCT / 100.0,
                "z_swing_miss_pct": LEAGUE_Z_SWING_MISS / 100.0,
                "oz_swing_miss_pct": LEAGUE_OZ_SWING_MISS / 100.0,
                "f_strike_pct": LEAGUE_F_STRIKE_PCT / 100.0,
                "iz_contact_pct": LEAGUE_IZ_CONTACT / 100.0,
                "oz_contact_pct": LEAGUE_OZ_CONTACT / 100.0,
                "n_fastball_pct": 50.0,
                "n_breaking_pct": 30.0,
                "n_offspeed_pct": 20.0,
                "arm_angle": 45.0,
                "name": rs_id,
                "games": 0,
                "innings": "0.0",
            }
        self._pitcher_cache[rs_id] = feats
        return feats

    def get_batter_features(self, rs_id: str) -> dict:
        if rs_id in self._batter_cache:
            return self._batter_cache[rs_id]
        sc_id = self.data.crosswalk.get(rs_id)
        sc = self.data.statcast_batters.get(sc_id, {}) if sc_id else {}
        pa = int(sc.get("pa") or 0)
        if pa > 0:
            feats = {
                "rs_id": rs_id,
                "sc_id": sc_id,
                "pa": pa,
                "k_pct": _pct(sc.get("k_percent"), pa, sc.get("strikeout", 0)),
                "bb_pct": _pct(sc.get("bb_percent"), pa, sc.get("walk", 0)),
                "hr_pct": _rate(sc.get("home_run", 0), pa),
                "single_pct": _rate(sc.get("single", 0), pa),
                "double_pct": _rate(sc.get("double", 0), pa),
                "triple_pct": _rate(sc.get("triple", 0), pa),
                "xwoba": float(sc.get("xwoba") or LEAGUE_XWOBA),
                "woba": float(sc.get("woba") or LEAGUE_WOBA),
                "bat_hand": sc.get("stand") or "R",
                "whiff_pct": (float(sc.get("whiff_percent") or LEAGUE_WHIFF_PCT))
                / 100.0,
                "z_swing_miss_pct": (
                    float(sc.get("z_swing_miss_percent") or LEAGUE_Z_SWING_MISS)
                )
                / 100.0,
                "oz_swing_miss_pct": (
                    float(sc.get("oz_swing_miss_percent") or LEAGUE_OZ_SWING_MISS)
                )
                / 100.0,
                "iz_contact_pct": (
                    float(sc.get("iz_contact_percent") or LEAGUE_IZ_CONTACT)
                )
                / 100.0,
                "oz_contact_pct": (
                    float(sc.get("oz_contact_percent") or LEAGUE_OZ_CONTACT)
                )
                / 100.0,
                "swing_pct": (float(sc.get("swing_percent") or 47.0)) / 100.0,
                "name": sc.get("last_name, first_name", rs_id),
            }
        else:
            rs_feats = self._rs_batter(rs_id)
            feats = {
                "rs_id": rs_id,
                "sc_id": sc_id,
                "pa": rs_feats["pa"],
                "k_pct": rs_feats["k_pct"],
                "bb_pct": rs_feats["bb_pct"],
                "hr_pct": rs_feats["hr_pct"],
                "single_pct": rs_feats["single_pct"],
                "double_pct": rs_feats["double_pct"],
                "triple_pct": rs_feats["triple_pct"],
                "xwoba": LEAGUE_XWOBA,
                "woba": LEAGUE_WOBA,
                "bat_hand": "R",
                "whiff_pct": LEAGUE_WHIFF_PCT / 100.0,
                "z_swing_miss_pct": LEAGUE_Z_SWING_MISS / 100.0,
                "oz_swing_miss_pct": LEAGUE_OZ_SWING_MISS / 100.0,
                "iz_contact_pct": LEAGUE_IZ_CONTACT / 100.0,
                "oz_contact_pct": LEAGUE_OZ_CONTACT / 100.0,
                "swing_pct": 0.47,
                "name": rs_id,
            }
        self._batter_cache[rs_id] = feats
        return feats


# ============================================================
# STRIKEOUT PROJECTION MODEL
# ============================================================
class StrikeoutProjectionModel:
    def project(
        self,
        pitcher_feats: dict,
        lineup_feats: list,
        projected_ip: float,
        rng=None,
        n_sims: int = 100_000,
        pitcher_rs_id: str = "",
        lineup_rs_ids: list[str] | None = None,
        lineup_spots: list[int] | None = None,
        is_home_pitcher: bool = True,
        data: DataIngestion | None = None,
    ) -> dict:

        if rng is None:
            rng = np.random.default_rng(42)

        n = max(len(lineup_feats), 1)

        # Empirical lineup-spot PA weights
        if lineup_spots and len(lineup_spots) == n:
            raw_w = [K_LINEUP_SPOT_WEIGHTS[min(s - 1, 8)] for s in lineup_spots]
        else:
            raw_w = [K_LINEUP_SPOT_WEIGHTS[min(i, 8)] for i in range(n)]
        total_w = sum(raw_w) or 1.0
        weights = [w / total_w for w in raw_w]

        pit_hand = pitcher_feats.get("pitch_hand", "R")
        pit_ha = "home" if is_home_pitcher else "away"
        bat_loc = "away" if is_home_pitcher else "home"

        # ---- Per-player split lookup helpers ----
        def _pit_k_vs_hand(bh: str) -> float:
            lg = PLATOON_K_RATES.get((pit_hand, bh), LEAGUE_K_PCT)
            if not data or not pitcher_rs_id:
                return float(pitcher_feats.get("k_pct", lg))
            sp = data.pitcher_splits_platoon.get(pitcher_rs_id, {}).get(bh, {})
            return _shrink_k(sp.get("k", 0), sp.get("pa", 0), lg, MIN_K_PA_PLATOON)

        def _pit_k_ha() -> float:
            base = float(pitcher_feats.get("k_pct", LEAGUE_K_PCT))
            if not data or not pitcher_rs_id:
                return base
            sp = data.pitcher_splits_ha.get(pitcher_rs_id, {}).get(pit_ha, {})
            return _shrink_k(sp.get("k", 0), sp.get("pa", 0), base, MIN_K_PA_HA)

        def _bat_k_vs_hand(rs_id: str, bf: dict) -> float:
            lg = PLATOON_K_RATES.get((pit_hand, bf.get("bat_hand", "R")), LEAGUE_K_PCT)
            if not data or not rs_id:
                return float(bf.get("k_pct", lg))
            sp = data.batter_splits_platoon.get(rs_id, {}).get(pit_hand, {})
            return _shrink_k(sp.get("k", 0), sp.get("pa", 0), lg, MIN_K_PA_PLATOON)

        def _bat_k_ha(rs_id: str, bf: dict) -> float:
            base = float(bf.get("k_pct", LEAGUE_K_PCT))
            if not data or not rs_id:
                return base
            sp = data.batter_splits_ha.get(rs_id, {}).get(bat_loc, {})
            return _shrink_k(sp.get("k", 0), sp.get("pa", 0), base, MIN_K_PA_HA)

        def _bat_k_lineu(rs_id: str, bf: dict, spot: int) -> float:
            base = float(bf.get("k_pct", LEAGUE_K_PCT))
            if not data or not rs_id:
                return base
            sp = data.batter_splits_lineu.get(rs_id, {}).get(spot, {})
            return _shrink_k(sp.get("k", 0), sp.get("pa", 0), base, MIN_K_PA_LINEU)

        # ---- Signal 1: Per-player Log5 matchup K rates ----
        rs_ids = lineup_rs_ids or [""] * n
        spots = lineup_spots or list(range(1, n + 1))
        pit_k_ha_rate = _pit_k_ha()

        batter_k_probs = []
        matchup_rows = []
        for i, (bf, wt) in enumerate(zip(lineup_feats, weights, strict=False)):
            bat_hand = bf.get("bat_hand", "R")
            rs_id = rs_ids[i] if i < len(rs_ids) else ""
            spot = spots[i] if i < len(spots) else (i + 1)

            pit_k_vs = _pit_k_vs_hand(bat_hand)
            bat_k_vs = _bat_k_vs_hand(rs_id, bf)
            bat_k_ha = _bat_k_ha(rs_id, bf)
            bat_k_lu = _bat_k_lineu(rs_id, bf, spot)

            bat_base = float(bf.get("k_pct", LEAGUE_K_PCT))
            ha_adj = bat_k_ha / bat_base if bat_base > 0 else 1.0
            lu_adj = bat_k_lu / bat_base if bat_base > 0 else 1.0
            bat_k_adj = float(np.clip(bat_k_vs * ha_adj * lu_adj, 0.03, 0.65))

            lg_k = PLATOON_K_RATES.get((pit_hand, bat_hand), LEAGUE_K_PCT)
            k_log5 = _log5(pit_k_vs, bat_k_adj, lg_k)
            batter_k_probs.append((k_log5, wt, bat_hand))
            matchup_rows.append(
                {
                    "name": bf.get("name", rs_id),
                    "hand": bat_hand,
                    "spot": spot,
                    "k_pct_raw": round(bat_base * 100, 1),
                    "k_vs": round(bat_k_vs * 100, 1),
                    "k_ha": round(bat_k_ha * 100, 1),
                    "k_lu": round(bat_k_lu * 100, 1),
                    "k_log5": round(k_log5 * 100, 1),
                    "weight": round(wt, 4),
                }
            )

        # Log5 weighted average
        raw_log5_k = sum(p * w for p, w, _ in batter_k_probs)
        pit_k_anchor = float(pitcher_feats.get("k_pct", LEAGUE_K_PCT))

        # ---- Signals 2–4: Z-score computation ----
        w_arr = weights[:n]
        w_sum = sum(w_arr) or 1.0
        w_norm = [w / w_sum for w in w_arr]

        # Signal 2: Whiff
        pit_whiff = float(pitcher_feats.get("whiff_pct", LEAGUE_WHIFF_PCT / 100.0))
        lu_whiff = sum(
            b.get("whiff_pct", LEAGUE_WHIFF_PCT / 100.0) * w
            for b, w in zip(lineup_feats, w_norm, strict=False)
        )
        whiff_z = (pit_whiff * 100 - LEAGUE_WHIFF_PCT) / SD_WHIFF_PCT
        lu_whiff_z = (lu_whiff * 100 - LEAGUE_WHIFF_PCT) / SD_WHIFF_PCT
        whiff_signal = 0.70 * whiff_z + 0.30 * lu_whiff_z

        # Signal 3: Zone / Contact
        pit_f_str = float(
            pitcher_feats.get("f_strike_pct", LEAGUE_F_STRIKE_PCT / 100.0)
        )
        pit_iz_con = float(
            pitcher_feats.get("iz_contact_pct", LEAGUE_IZ_CONTACT / 100.0)
        )
        pit_oz_con = float(
            pitcher_feats.get("oz_contact_pct", LEAGUE_OZ_CONTACT / 100.0)
        )
        lu_iz_con = sum(
            b.get("iz_contact_pct", LEAGUE_IZ_CONTACT / 100.0) * w
            for b, w in zip(lineup_feats, w_norm, strict=False)
        )
        lu_oz_con = sum(
            b.get("oz_contact_pct", LEAGUE_OZ_CONTACT / 100.0) * w
            for b, w in zip(lineup_feats, w_norm, strict=False)
        )
        f_str_z = (pit_f_str * 100 - LEAGUE_F_STRIKE_PCT) / SD_F_STRIKE_PCT
        iz_con_z = -(pit_iz_con * 100 - LEAGUE_IZ_CONTACT) / SD_IZ_CONTACT
        oz_con_z = -(pit_oz_con * 100 - LEAGUE_OZ_CONTACT) / SD_OZ_CONTACT
        lu_iz_z = -(lu_iz_con * 100 - LEAGUE_IZ_CONTACT) / SD_IZ_CONTACT
        lu_oz_z = -(lu_oz_con * 100 - LEAGUE_OZ_CONTACT) / SD_OZ_CONTACT
        zone_signal = (
            0.35 * f_str_z
            + 0.35 * oz_con_z
            + 0.15 * iz_con_z
            + 0.10 * lu_oz_z
            + 0.05 * lu_iz_z
        )

        # Signal 4: Arsenal / Velocity
        ff_speed = float(pitcher_feats.get("ff_speed", VELO_BASELINE_MPH))
        velo_z = (ff_speed - VELO_BASELINE_MPH) / SD_FF_SPEED
        n_fast = float(pitcher_feats.get("n_fastball_pct", 50.0)) / 100.0
        n_break = float(pitcher_feats.get("n_breaking_pct", 30.0)) / 100.0
        n_off = float(pitcher_feats.get("n_offspeed_pct", 20.0)) / 100.0
        mix_sum = n_fast + n_break + n_off
        if mix_sum > 0:
            n_fast /= mix_sum
            n_break /= mix_sum
            n_off /= mix_sum
        mix_k_wt = (
            n_fast * PITCH_K_WEIGHTS["fastball"]
            + n_break * PITCH_K_WEIGHTS["breaking"]
            + n_off * PITCH_K_WEIGHTS["offspeed"]
        )
        mix_z = (mix_k_wt - 0.3333) / 0.05
        arsenal_signal = 0.60 * velo_z + 0.40 * mix_z

        # ---- Combined K rate: calibrated additive signal blend ----
        # Base: 40% Log5 matchup + 60% pitcher K rate anchor
        base_k_rate = SIG_WT_LOG5 * raw_log5_k + (1.0 - SIG_WT_LOG5) * pit_k_anchor
        # Additive adjustments: each signal scaled by league K rate SD (~0.04)
        # Weights calibrated to match market lines across pitcher archetypes:
        #   w_whiff=-2.834 (whiff already in Log5; negative corrects for double-count)
        #   w_zone=3.342   (zone/contact is the dominant K signal)
        #   w_arsenal=0.50 (velo/mix is minor)
        LEAGUE_K_SD = 0.040
        combined_k = float(
            np.clip(
                base_k_rate
                + LEAGUE_K_SD
                * (
                    -2.834 * whiff_signal + 3.342 * zone_signal + 0.500 * arsenal_signal
                ),
                0.04,
                0.60,
            )
        )

        # Convenience aliases for HTML output
        whiff_mult = 1.0 + float(np.clip(whiff_signal * 0.040, -0.15, 0.20))
        zone_mult = 1.0 + float(np.clip(zone_signal * 0.040, -0.15, 0.20))
        arsenal_mult = 1.0 + float(np.clip(arsenal_signal * 0.020, -0.08, 0.10))

        # ---- Signals 5+6: Per-inning K rates with empirical TTO degradation ----
        def _pit_k_inning(inn_1: int) -> float:
            lg_inn = LEAGUE_K_BY_INNING.get(inn_1, LEAGUE_K_PCT)
            if not data or not pitcher_rs_id:
                return lg_inn
            sp = data.pitcher_splits_inning.get(pitcher_rs_id, {}).get(inn_1, {})
            return _shrink_k(sp.get("k", 0), sp.get("pa", 0), lg_inn, MIN_K_PA_INNING)

        pa_per_inn = PA_PER_INNING
        ip = float(np.clip(projected_ip, 1.0, 9.0))
        full_inn = int(ip)
        part_frac = ip - full_inn
        expected_k = 0.0
        inning_rates = []

        for inn in range(9):
            inn_1 = inn + 1
            pit_inn_k = _pit_k_inning(inn_1)
            lg_inn = LEAGUE_K_BY_INNING.get(inn_1, LEAGUE_K_PCT)
            # Inning scale: used ONLY for per-inning breakdown display, not EK total
            # Cap tightly at 1.10 since inning splits have high variance
            inn_scale = min(1.10, max(0.90, pit_inn_k / max(lg_inn, 0.01)))
            tto = min(2, inn // 3)
            # EK uses flat combined_k with TTO penalty only (no inning scale)
            r_ek = max(
                0.03, combined_k * TTO_K_MULT[tto]
            )  # Variant D: multiplicative TTO
            # Display rate uses inning scale + multiplicative TTO for granularity
            r_display = max(0.03, combined_k * inn_scale * TTO_K_MULT[tto])
            inning_rates.append(r_display)
            if inn < full_inn:
                expected_k += r_ek * pa_per_inn

        if part_frac > 0 and full_inn < 9:
            r_ek_partial = max(
                0.03, combined_k * TTO_K_MULT[min(2, full_inn // 3)]
            )  # Variant D
            expected_k += r_ek_partial * pa_per_inn * part_frac

        # ---- OLS calibration layer (Variant D, 2025 back-test, n=2350) ----
        # kProj_cal = CAL_ALPHA * expected_k + CAL_BETA
        # Eliminates +0.46 systematic under-projection bias (MAE: 1.729 → 1.714)
        expected_k = float(np.clip(CAL_ALPHA * expected_k + CAL_BETA, 0.1, 20.0))
        k_per_9 = (expected_k / max(ip, 0.1)) * 9.0
        # ---- Signal 7+8: Negative Binomial distribution ----
        # Variant D: fixed NegBin r=22.20 calibrated from 2025 season (MoM estimator)
        # Replaces derived variance scale which over-dispersed the distribution
        nb_r = NEGBIN_R
        nb_p = float(np.clip(nb_r / (nb_r + max(expected_k, 0.3)), 0.01, 0.99))
        # PMF for 0–10+
        dist_pcts = []
        for k in range(10):
            try:
                p_k = (
                    math.gamma(k + nb_r)
                    / (math.factorial(k) * math.gamma(nb_r))
                    * (nb_p**nb_r)
                    * ((1 - nb_p) ** k)
                )
            except (OverflowError, ValueError):
                p_k = 0.0
            dist_pcts.append(round(p_k * 100, 1))
        dist_pcts.append(round(max(0.0, 100.0 - sum(dist_pcts)), 1))

        # Monte Carlo for prop line probabilities
        samps = rng.negative_binomial(max(0.01, nb_r), nb_p, size=n_sims).astype(float)
        k_low = float(np.percentile(samps, 5))
        k_high = float(np.percentile(samps, 95))
        k_med = float(np.median(samps))

        # Prop line at nearest 0.5
        k_line = round(round(expected_k * 2) / 2, 1)
        p_over = float((samps > k_line).mean())
        p_under = float((samps <= k_line).mean())

        # Also compute half-step lines
        k_line_lo = max(0.5, k_line - 0.5)
        k_line_hi = k_line + 0.5
        p_over_lo = float((samps > k_line_lo).mean())
        p_over_hi = float((samps > k_line_hi).mean())
        # Store raw probabilities for market comparison (keyed by line value)
        # These will be overridden by generate_html when market line differs from model line
        p_over_market = p_over
        p_under_market = p_under

        return {
            # Core projection
            "k_proj": round(expected_k, 2),
            "k_proj_low": round(k_low, 2),
            "k_proj_high": round(k_high, 2),
            "k_median": round(k_med, 2),
            "k_per_9": round(k_per_9, 2),
            "k_pct_matchup": round(combined_k, 4),
            "projected_ip": round(ip, 2),
            # Prop line
            "k_line": k_line,
            "k_line_lo": k_line_lo,
            "k_line_hi": k_line_hi,
            "p_over_k_line": round(p_over, 4),
            "p_under_k_line": round(p_under, 4),
            "p_over_lo": round(p_over_lo, 4),
            "p_over_hi": round(p_over_hi, 4),
            "p_over_market": round(p_over_market, 4),
            "p_under_market": round(p_under_market, 4),
            "k_line_odds_over": _p2ml(p_over),
            "k_line_odds_under": _p2ml(p_under),
            # raw samples for market-line re-evaluation
            "_samps": samps,
            # Distribution
            "dist_pcts": dist_pcts,
            # Signal breakdown
            "signal": {
                "base_k_rate": round(base_k_rate, 4),
                "whiff_mult": round(whiff_mult, 4),
                "zone_mult": round(zone_mult, 4),
                "arsenal_mult": round(arsenal_mult, 4),
                "combined_k": round(combined_k, 4),
                "pit_k_ha_rate": round(pit_k_ha_rate, 4),
                "pit_whiff": round(pit_whiff, 4),
                "lu_whiff": round(lu_whiff, 4),
                "pit_f_strike": round(pit_f_str, 4),
                "ff_speed": round(ff_speed, 1),
                "inning_rates": [round(r, 4) for r in inning_rates[: full_inn + 1]],
            },
            # Matchup detail
            "matchup_rows": matchup_rows,
            # Pitcher info
            "name": _format_name(pitcher_feats.get("name", pitcher_rs_id)),
            "hand": pit_hand,
            "rs_id": pitcher_rs_id,
            "games": pitcher_feats.get("games", 0),
            "innings": pitcher_feats.get("innings", "0.0"),
        }


def _format_name(raw: str) -> str:
    """Convert 'Last, First' to 'First Last'."""
    if "," in raw:
        parts = raw.split(",", 1)
        return f"{parts[1].strip()} {parts[0].strip()}"
    return raw


# ============================================================
# HTML GENERATOR
# ============================================================


def generate_html(
    away_team: str,
    home_team: str,
    game_date: str,
    away_proj: dict,
    home_proj: dict,
    output_path: str,
    away_market: dict | None = None,
    home_market: dict | None = None,
):

    a_city, a_name, a_col1, a_col2 = TEAM_NAMES.get(
        away_team, (away_team, "", "#003087", "#C4CED4")
    )
    h_city, h_name, h_col1, h_col2 = TEAM_NAMES.get(
        home_team, (home_team, "", "#FD5A1E", "#27251F")
    )

    try:
        dt = datetime.strptime(game_date, "%Y-%m-%d")
        date_str = dt.strftime("%B %d, %Y")
    except Exception:
        date_str = game_date

    a_init = "".join(p[0] for p in away_proj["name"].split() if p)[:2].upper()
    h_init = "".join(p[0] for p in home_proj["name"].split() if p)[:2].upper()

    def _prop_edge_color(p: float) -> str:
        if p >= 0.60:
            return "#39FF14"
        if p >= 0.55:
            return "#B060FF"
        if p <= 0.40:
            return "#FF2D55"
        return "#EDF2F7"

    # Edge colors
    a_over_col = _prop_edge_color(away_proj["p_over_k_line"])
    a_under_col = _prop_edge_color(away_proj["p_under_k_line"])
    h_over_col = _prop_edge_color(home_proj["p_over_k_line"])
    h_under_col = _prop_edge_color(home_proj["p_under_k_line"])

    # Consensus book odds for display in the prop card boxes
    # If market data is provided, use those odds; otherwise fall back to model-derived odds
    def _fmt_ml(ml: int) -> str:
        return f"+{ml}" if ml > 0 else str(ml)

    if away_market:
        a_over_odds_disp = _fmt_ml(away_market["over_ml"])
        a_under_odds_disp = _fmt_ml(away_market["under_ml"])
    else:
        a_over_odds_disp = away_proj["k_line_odds_over"]
        a_under_odds_disp = away_proj["k_line_odds_under"]

    if home_market:
        h_over_odds_disp = _fmt_ml(home_market["over_ml"])
        h_under_odds_disp = _fmt_ml(home_market["under_ml"])
    else:
        h_over_odds_disp = home_proj["k_line_odds_over"]
        h_under_odds_disp = home_proj["k_line_odds_under"]

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Strikeout Props — {away_proj["name"]} vs {home_proj["name"]}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap');
  :root {{
    --a-col:{a_col1}; --a-l:{a_col2};
    --h-col:{h_col1}; --h-l:{h_col2};
    --neon-over:#39FF14; --neon-under:#FF2D55; --neon-k:#B060FF;
    --bg:#06090D; --bg2:#090E14; --bg3:#0C1219; --bg4:#101820;
    --border:#182433; --border2:#1E3048;
    --text:#EDF2F7; --muted:#3A5A7A; --muted2:#1E3048;
  }}
  *{{box-sizing:border-box;margin:0;padding:0;}}
  body{{background:#030508;padding:20px;}}
  .card{{font-family:'Barlow',sans-serif;background:var(--bg);border-radius:16px;overflow:hidden;border:1px solid var(--border2);max-width:980px;margin:0 auto;}}

  /* ── HEADER ── */
  .hdr{{background:var(--bg2);padding:18px 22px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border2);position:relative;}}
  .hdr::before{{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--a-col) 0%,transparent 44%,transparent 56%,var(--h-col) 100%);}}
  .tblk{{display:flex;align-items:center;gap:12px;}}
  .tlogo{{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;flex-shrink:0;}}
  .logo-a{{background:radial-gradient(circle at 35% 35%,color-mix(in srgb,var(--a-col) 70%,#fff),var(--a-col));color:var(--a-l);}}
  .logo-h{{background:radial-gradient(circle at 35% 35%,color-mix(in srgb,var(--h-col) 70%,#fff),var(--h-col));color:var(--h-l);font-size:11px;}}
  .tname{{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--text);line-height:1.1;}}
  .tsub{{font-size:10px;color:var(--muted);letter-spacing:.5px;margin-top:2px;}}
  .tbadge{{font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:2px 7px;border-radius:3px;margin-top:5px;display:inline-block;}}
  .badge-away{{background:rgba(0,48,135,.2);color:#6A9AE0;border:1px solid rgba(0,48,135,.4);}}
  .badge-home{{background:rgba(253,90,30,.15);color:#FD8A50;border:1px solid rgba(253,90,30,.35);}}
  .vblk{{text-align:center;}}
  .vat{{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);letter-spacing:4px;text-transform:uppercase;}}
  .gmeta{{font-size:10px;color:var(--muted);margin-top:4px;}}
  .glive{{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--neon-over);margin-top:6px;}}
  .gdot{{width:5px;height:5px;border-radius:50%;background:var(--neon-over);animation:blink 1.4s infinite;}}
  @keyframes blink{{0%,100%{{opacity:1}}50%{{opacity:.2}}}}

  /* ── PITCHER MATCHUP ── */
  .pitchers{{display:grid;grid-template-columns:1fr 1px 1fr;background:var(--bg2);border-bottom:1px solid var(--border2);}}
  .pitcher-block{{padding:16px 20px;display:flex;flex-direction:column;align-items:center;gap:8px;}}
  .pitcher-avatar{{width:64px;height:64px;border-radius:50%;background:var(--bg3);border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;}}
  .avatar-initials{{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;}}
  .pitcher-name{{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;}}
  .pitcher-hand{{font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;}}
  .v-divider{{background:var(--border);}}

  /* ── PROP LINE SECTION ── */
  .prop-section{{padding:14px 16px;border-bottom:1px solid var(--border);}}
  .prop-grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px;}}
  .prop-card{{background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:14px 16px;}}
  .prop-pitcher{{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;}}
  .prop-line-row{{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}}
  .prop-line-lbl{{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;}}
  .prop-line-val{{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:var(--neon-k);}}
  .prop-line-sub{{font-family:'Barlow Condensed',sans-serif;font-size:11px;color:var(--muted);}}
  .prop-odds-row{{display:flex;gap:8px;margin-top:8px;}}
  .prop-odds-box{{flex:1;background:var(--bg4);border-radius:6px;padding:8px 10px;text-align:center;}}
  .odds-dir{{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:3px;}}
  .odds-pct{{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:800;}}
  .odds-ml{{font-family:'Barlow Condensed',sans-serif;font-size:11px;color:var(--muted);margin-top:2px;}}
  .prop-stats-row{{display:flex;gap:10px;margin-top:10px;}}
  .prop-stat{{flex:1;text-align:center;}}
  .prop-stat-val{{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;color:var(--text);}}
  .prop-stat-lbl{{font-family:'Barlow Condensed',sans-serif;font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-top:2px;}}
  .prop-range{{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);margin-top:8px;text-align:center;}}

  /* ── SECTION LABELS ── */
  .sec-lbl{{font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}}

  /* ── DISTRIBUTION TABLE ── */
  .dist-section{{padding:12px 16px;border-bottom:1px solid var(--border);}}
  .dist-wrap{{display:grid;grid-template-columns:1fr 1fr;gap:10px;}}
  table.dist{{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px;}}
  table.dist th{{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);background:var(--bg4);padding:4px 2px;text-align:center;border:1px solid var(--border);}}
  table.dist td{{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;text-align:center;padding:4px 2px;border:1px solid var(--border);color:#3A5A7A;background:var(--bg3);}}
  table.dist td.cat{{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);background:var(--bg4);text-align:left;padding-left:6px;}}
  table.dist td.avg{{background:var(--bg4);color:var(--neon-k);}}
  .hk1{{background:rgba(176,96,255,.06)!important;color:#7030C0!important;}}
  .hk2{{background:rgba(176,96,255,.14)!important;color:#9050E0!important;}}
  .hk3{{background:rgba(176,96,255,.24)!important;color:var(--neon-k)!important;}}
  .hk4{{background:rgba(176,96,255,.36)!important;color:var(--neon-k)!important;border-color:rgba(176,96,255,.35)!important;}}

  /* ── SIGNAL BREAKDOWN ── */
  .signal-section{{padding:12px 16px;border-bottom:1px solid var(--border);}}
  .signal-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px;}}
  .signal-card{{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;}}
  .signal-title{{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}}
  .signal-row{{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--border);}}
  .signal-row:last-child{{border-bottom:none;}}
  .signal-lbl{{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);}}
  .signal-val{{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--text);}}
  .signal-val.pos{{color:var(--neon-over);}}
  .signal-val.neg{{color:var(--neon-under);}}
  .signal-val.k{{color:var(--neon-k);}}

  /* ── MATCHUP TABLE ── */
  .matchup-section{{padding:12px 16px;border-bottom:1px solid var(--border);}}
  .matchup-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px;}}
  table.matchup-tbl{{width:100%;border-collapse:collapse;font-size:10px;}}
  table.matchup-tbl th{{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);background:var(--bg4);padding:4px 4px;text-align:center;border:1px solid var(--border);}}
  table.matchup-tbl td{{font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:600;text-align:center;padding:4px 4px;border:1px solid var(--border);background:var(--bg3);color:var(--text);}}
  table.matchup-tbl td:nth-child(2){{text-align:left;}}
  .muted{{color:var(--muted)!important;}}

  /* ── INNING TABLE ── */
  .inn-section{{padding:12px 16px;border-bottom:1px solid var(--border);}}
  .inn-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px;}}
  table.inn-tbl{{width:100%;border-collapse:collapse;font-size:11px;}}
  table.inn-tbl th{{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);background:var(--bg4);padding:4px 3px;text-align:center;border:1px solid var(--border);}}
  table.inn-tbl td{{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;text-align:center;padding:4px 3px;border:1px solid var(--border);background:var(--bg3);color:var(--muted);}}

  /* ── HISTOGRAM ── */
  .hist-section{{padding:14px 16px 16px;}}
  .charts-grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px;}}
  .chart-wrap{{position:relative;width:100%;height:200px;}}
  .pitcher-chart-lbl{{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;}}

  /* ── CELL CLASSES ── */
  .cell-k{{background:rgba(176,96,255,.1)!important;color:var(--neon-k)!important;}}
  .cell-hi{{background:rgba(57,255,20,.08)!important;color:var(--neon-over)!important;}}
  .cell-warn{{background:rgba(255,45,85,.07)!important;color:#FF6080!important;}}

  /* ── MARKET COMPARISON ── */
  .mkt-section{{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:10px;}}
  .mkt-cmp-card{{background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 14px;}}
  .mkt-cmp-title{{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;}}
  .mkt-cmp-row{{display:flex;gap:8px;align-items:stretch;}}
  .mkt-col{{flex:1;background:var(--bg4);border-radius:6px;padding:8px 10px;min-width:0;}}
  .mkt-col-lbl{{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;}}
  .mkt-col-val{{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;color:var(--text);line-height:1;}}
  .mkt-col-sub{{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--muted);margin-top:3px;}}
  .mkt-verdict{{text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;}}
  .mkt-verdict-badge{{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;letter-spacing:3px;padding:4px 12px;border-radius:4px;border:1px solid;margin:4px 0;}}
</style>
</head>
<body>
<div class="card">

  <!-- HEADER -->
  <div class="hdr">
    <div class="tblk">
      <div class="tlogo logo-a">{away_team}</div>
      <div>
        <div class="tname">{a_city}</div>
        <div class="tsub">{a_name}</div>
        <div class="tbadge badge-away">Away</div>
      </div>
    </div>
    <div class="vblk">
      <div class="vat">Strikeout Props</div>
      <div class="gmeta">MLB · AI Projection</div>
      <div class="gmeta">{date_str}</div>
      <div class="glive"><span class="gdot"></span>Model Output</div>
    </div>
    <div class="tblk">
      <div style="text-align:right">
        <div class="tname">{h_city}</div>
        <div class="tsub">{h_name}</div>
        <div class="tbadge badge-home">Home</div>
      </div>
      <div class="tlogo logo-h">{home_team}</div>
    </div>
  </div>

  <!-- PITCHER MATCHUP -->
  <div class="pitchers">
    <div class="pitcher-block">
      <div class="pitcher-avatar">
        <div class="avatar-initials" style="color:{a_col2}">{a_init}</div>
      </div>
      <div class="pitcher-name" style="color:{a_col2}">{away_proj["name"]}</div>
      <div class="pitcher-hand">{away_proj["hand"]}HP · {a_city} · {away_proj["games"]} GS · {away_proj["innings"]} IP</div>
    </div>
    <div class="v-divider"></div>
    <div class="pitcher-block">
      <div class="pitcher-avatar">
        <div class="avatar-initials" style="color:{h_col2}">{h_init}</div>
      </div>
      <div class="pitcher-name" style="color:{h_col2}">{home_proj["name"]}</div>
      <div class="pitcher-hand">{home_proj["hand"]}HP · {h_city} · {home_proj["games"]} GS · {home_proj["innings"]} IP</div>
    </div>
  </div>

  <!-- PROP LINES -->
  <div class="prop-section">
    <div class="sec-lbl">Strikeout Prop Lines</div>
    <div class="prop-grid">

      <!-- Away Pitcher Prop -->
      <div class="prop-card">
        <div class="prop-pitcher" style="color:{a_col2}">{away_proj["name"]}</div>
        <div class="prop-line-row">
          <div>
            <div class="prop-line-lbl">Projected K Line</div>
            <div class="prop-line-val">{away_proj["k_line"]}</div>
            <div class="prop-line-sub">K Projection: <strong style="color:var(--neon-k)">{away_proj["k_proj"]}</strong> &nbsp;|&nbsp; K/9: {away_proj["k_per_9"]}</div>
          </div>
          <div style="text-align:right">
            <div class="prop-line-lbl">Proj IP</div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;color:var(--text)">{away_proj["projected_ip"]}</div>
            <div class="prop-line-sub">Matchup K%: {away_proj["k_pct_matchup"] * 100:.1f}%</div>
          </div>
        </div>
        <div class="prop-odds-row">
          <div class="prop-odds-box">
            <div class="odds-dir" style="color:var(--neon-over)">OVER {away_proj["k_line"]}</div>
            <div class="odds-pct" style="color:{a_over_col}">{away_proj["p_over_k_line"] * 100:.1f}%</div>
            <div class="odds-ml">{a_over_odds_disp}</div>
          </div>
          <div class="prop-odds-box">
            <div class="odds-dir" style="color:var(--neon-under)">UNDER {away_proj["k_line"]}</div>
            <div class="odds-pct" style="color:{a_under_col}">{away_proj["p_under_k_line"] * 100:.1f}%</div>
            <div class="odds-ml">{a_under_odds_disp}</div>
          </div>
          <div class="prop-odds-box">
            <div class="odds-dir" style="color:var(--neon-over)">OVER {away_proj["k_line_hi"]}</div>
            <div class="odds-pct" style="color:var(--text)">{away_proj["p_over_hi"] * 100:.1f}%</div>
            <div class="odds-ml">{_p2ml(away_proj["p_over_hi"])}</div>
          </div>
        </div>
        <div class="prop-range">5th–95th pct: <strong style="color:var(--neon-k)">{away_proj["k_proj_low"]:.1f} – {away_proj["k_proj_high"]:.1f} K</strong> &nbsp;|&nbsp; Median: {away_proj["k_median"]:.1f}</div>
      </div>

      <!-- Home Pitcher Prop -->
      <div class="prop-card">
        <div class="prop-pitcher" style="color:{h_col2}">{home_proj["name"]}</div>
        <div class="prop-line-row">
          <div>
            <div class="prop-line-lbl">Projected K Line</div>
            <div class="prop-line-val">{home_proj["k_line"]}</div>
            <div class="prop-line-sub">K Projection: <strong style="color:var(--neon-k)">{home_proj["k_proj"]}</strong> &nbsp;|&nbsp; K/9: {home_proj["k_per_9"]}</div>
          </div>
          <div style="text-align:right">
            <div class="prop-line-lbl">Proj IP</div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;color:var(--text)">{home_proj["projected_ip"]}</div>
            <div class="prop-line-sub">Matchup K%: {home_proj["k_pct_matchup"] * 100:.1f}%</div>
          </div>
        </div>
        <div class="prop-odds-row">
          <div class="prop-odds-box">
            <div class="odds-dir" style="color:var(--neon-over)">OVER {home_proj["k_line"]}</div>
            <div class="odds-pct" style="color:{h_over_col}">{home_proj["p_over_k_line"] * 100:.1f}%</div>
            <div class="odds-ml">{h_over_odds_disp}</div>
          </div>
          <div class="prop-odds-box">
            <div class="odds-dir" style="color:var(--neon-under)">UNDER {home_proj["k_line"]}</div>
            <div class="odds-pct" style="color:{h_under_col}">{home_proj["p_under_k_line"] * 100:.1f}%</div>
            <div class="odds-ml">{h_under_odds_disp}</div>
          </div>
          <div class="prop-odds-box">
            <div class="odds-dir" style="color:var(--neon-over)">OVER {home_proj["k_line_hi"]}</div>
            <div class="odds-pct" style="color:var(--text)">{home_proj["p_over_hi"] * 100:.1f}%</div>
            <div class="odds-ml">{_p2ml(home_proj["p_over_hi"])}</div>
          </div>
        </div>
        <div class="prop-range">5th–95th pct: <strong style="color:var(--neon-k)">{home_proj["k_proj_low"]:.1f} – {home_proj["k_proj_high"]:.1f} K</strong> &nbsp;|&nbsp; Median: {home_proj["k_median"]:.1f}</div>
      </div>

    </div>
  </div>


</div>

</body>
</html>
"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML prop card saved → {output_path}")


# ============================================================
# MAIN
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="MLB Strikeout Projection Model")
    parser.add_argument("--plays", required=True)
    parser.add_argument("--statcast", required=True)
    parser.add_argument("--crosswalk", required=True)
    parser.add_argument("--game-date", required=True)
    parser.add_argument("--away-team", required=True)
    parser.add_argument("--home-team", required=True)
    parser.add_argument("--away-pitcher", required=True)
    parser.add_argument("--home-pitcher", required=True)
    parser.add_argument("--away-lineup", nargs="+", default=[])
    parser.add_argument("--home-lineup", nargs="+", default=[])
    parser.add_argument("--projected-ip", type=float, default=STARTER_IP_MEAN)
    parser.add_argument("--output", required=True)
    # Market lines (optional): format: LINE OVER_ML UNDER_ML  e.g. "6.5 +105 -135"
    parser.add_argument(
        "--away-market", nargs=3, metavar=("LINE", "OVER_ML", "UNDER_ML"), default=None
    )
    parser.add_argument(
        "--home-market", nargs=3, metavar=("LINE", "OVER_ML", "UNDER_ML"), default=None
    )
    parser.add_argument(
        "--json-output", default=None, help="Path to write JSON projection results"
    )
    args = parser.parse_args()

    def _parse_market(mkt_args) -> dict:
        if not mkt_args:
            return None
        line, over_ml, under_ml = mkt_args
        return {
            "line": float(line),
            "over_ml": int(over_ml.replace("+", "")),
            "under_ml": int(under_ml.replace("+", "")),
        }

    away_market = _parse_market(args.away_market)
    home_market = _parse_market(args.home_market)

    # 1. Load data
    data = DataIngestion(args.plays, args.statcast, args.crosswalk).load()
    fe = FeatureEngineer(data)

    # 2. Build lineups — use CLI args if provided, else auto-detect from plays
    def _auto_lineup(team: str, n: int = 9) -> list[str]:
        plays = data.plays
        if "batteam" in plays.columns:
            ids = (
                plays[plays["batteam"] == team]["batter"].value_counts().index.tolist()
            )
        else:
            ids = plays["batter"].value_counts().index.tolist()
        # Filter out pitcher RS IDs
        ids = [i for i in ids if i not in [args.away_pitcher, args.home_pitcher]]
        return ids[:n]

    away_lineup = (
        args.away_lineup[:9] if args.away_lineup else _auto_lineup(args.away_team)
    )
    home_lineup = (
        args.home_lineup[:9] if args.home_lineup else _auto_lineup(args.home_team)
    )

    # Pad to 9 if needed
    while len(away_lineup) < 9:
        away_lineup.append("")
    while len(home_lineup) < 9:
        home_lineup.append("")

    away_lineup_feats = [fe.get_batter_features(bid) for bid in away_lineup]
    home_lineup_feats = [fe.get_batter_features(bid) for bid in home_lineup]

    # 3. Get pitcher features
    away_pitcher_feats = fe.get_pitcher_features(args.away_pitcher)
    home_pitcher_feats = fe.get_pitcher_features(args.home_pitcher)

    # 4. Project strikeouts
    print("Running Strikeout Projections...")
    rng = np.random.default_rng(42)
    k_model = StrikeoutProjectionModel()

    # Away pitcher faces Home lineup
    away_proj = k_model.project(
        pitcher_feats=away_pitcher_feats,
        lineup_feats=home_lineup_feats,
        projected_ip=args.projected_ip,
        rng=rng,
        n_sims=100_000,
        pitcher_rs_id=args.away_pitcher,
        lineup_rs_ids=home_lineup,
        lineup_spots=list(range(1, 10)),
        is_home_pitcher=False,
        data=data,
    )

    # Home pitcher faces Away lineup
    home_proj = k_model.project(
        pitcher_feats=home_pitcher_feats,
        lineup_feats=away_lineup_feats,
        projected_ip=args.projected_ip,
        rng=rng,
        n_sims=100_000,
        pitcher_rs_id=args.home_pitcher,
        lineup_rs_ids=away_lineup,
        lineup_spots=list(range(1, 10)),
        is_home_pitcher=True,
        data=data,
    )

    # 5. Print summary
    print(f"\n{'=' * 60}")
    print(f"  {away_proj['name']} ({args.away_team}, Away, {away_proj['hand']}HP)")
    print(
        f"  K Proj: {away_proj['k_proj']}  |  Line: {away_proj['k_line']}  |  K/9: {away_proj['k_per_9']}"
    )
    print(
        f"  Over {away_proj['k_line']}: {away_proj['p_over_k_line'] * 100:.1f}% ({away_proj['k_line_odds_over']})"
    )
    print(
        f"  Under {away_proj['k_line']}: {away_proj['p_under_k_line'] * 100:.1f}% ({away_proj['k_line_odds_under']})"
    )
    print(
        f"  5th–95th: {away_proj['k_proj_low']:.1f}–{away_proj['k_proj_high']:.1f}  Median: {away_proj['k_median']:.1f}"
    )
    print()
    print(f"  {home_proj['name']} ({args.home_team}, Home, {home_proj['hand']}HP)")
    print(
        f"  K Proj: {home_proj['k_proj']}  |  Line: {home_proj['k_line']}  |  K/9: {home_proj['k_per_9']}"
    )
    print(
        f"  Over {home_proj['k_line']}: {home_proj['p_over_k_line'] * 100:.1f}% ({home_proj['k_line_odds_over']})"
    )
    print(
        f"  Under {home_proj['k_line']}: {home_proj['p_under_k_line'] * 100:.1f}% ({home_proj['k_line_odds_under']})"
    )
    print(
        f"  5th–95th: {home_proj['k_proj_low']:.1f}–{home_proj['k_proj_high']:.1f}  Median: {home_proj['k_median']:.1f}"
    )
    print(f"{'=' * 60}")

    # 6. Generate HTML
    generate_html(
        away_team=args.away_team,
        home_team=args.home_team,
        game_date=args.game_date,
        away_proj=away_proj,
        home_proj=home_proj,
        output_path=args.output,
        away_market=away_market,
        home_market=home_market,
    )

    # 7. Write JSON output if requested
    if args.json_output:
        import json as _json

        def _proj_to_json(proj: dict, market: dict, side: str) -> dict:
            """Serialize a proj dict to a JSON-safe structure for DB ingestion."""
            # Compute market-adjusted probabilities if market line differs from model line
            raw_samps = proj.get("_samps")
            bk_line = market["line"] if market else proj["k_line"]
            if raw_samps is not None and market and bk_line != proj["k_line"]:
                import numpy as _np

                p_over_mkt = float((_np.asarray(raw_samps) > bk_line).mean())
                p_under_mkt = float((_np.asarray(raw_samps) <= bk_line).mean())
            else:
                p_over_mkt = proj.get("p_over_market", proj["p_over_k_line"])
                p_under_mkt = proj.get("p_under_market", proj["p_under_k_line"])

            def _p2ml(p):
                if p <= 0:
                    return -99999
                if p >= 1:
                    return 99999
                if p < 0.5:
                    return round(100 / p - 100)
                return round(-(p / (1 - p)) * 100)

            def _fmt_ml(ml):
                return f"+{ml}" if ml > 0 else str(ml)

            # Edge calculation vs book
            edge_over = edge_under = 0.0
            verdict = "PASS"
            best_side = "OVER"
            best_edge = 0.0
            best_ml_str = ""
            if market:

                def _be(ml):
                    if ml > 0:
                        return 100.0 / (ml + 100.0)
                    if ml < 0:
                        return abs(ml) / (abs(ml) + 100.0)
                    return 0.5

                be_over = _be(market["over_ml"])
                be_under = _be(market["under_ml"])
                edge_over = p_over_mkt - be_over
                edge_under = p_under_mkt - be_under
                if edge_over >= edge_under:
                    best_side = "OVER"
                    best_edge = edge_over
                    best_ml_str = _fmt_ml(market["over_ml"])
                else:
                    best_side = "UNDER"
                    best_edge = edge_under
                    best_ml_str = _fmt_ml(market["under_ml"])
                verdict = (
                    "EDGE"
                    if best_edge >= 0.03
                    else ("FADE" if best_edge <= -0.03 else "NEUTRAL")
                )

            # Signal breakdown (human-readable)
            sig = proj.get("signal", {})
            signal_breakdown = {
                "base_k_rate": f"{sig.get('base_k_rate', 0) * 100:.1f}%",
                "whiff_mult": f"{sig.get('whiff_mult', 1):.3f}x",
                "zone_mult": f"{sig.get('zone_mult', 1):.3f}x",
                "arsenal_mult": f"{sig.get('arsenal_mult', 1):.3f}x",
                "combined_k": f"{sig.get('combined_k', 0) * 100:.1f}%",
                "pit_k_ha": f"{sig.get('pit_k_ha_rate', 0) * 100:.1f}%",
                "pit_whiff": f"{sig.get('pit_whiff', 0) * 100:.1f}%",
                "lu_whiff": f"{sig.get('lu_whiff', 0) * 100:.1f}%",
                "pit_f_strike": f"{sig.get('pit_f_strike', 0) * 100:.1f}%",
                "ff_speed": f"{sig.get('ff_speed', 0):.1f} mph",
            }

            # Matchup rows (simplified)
            matchup_rows = [
                {
                    "spot": r.get("spot", i + 1),
                    "name": r.get("name", ""),
                    "hand": r.get("hand", ""),
                    "kRate": r.get("k_pct_raw", 0),
                    "adj": r.get("k_log5", 0),
                    "expK": round(r.get("k_log5", 0) / 100.0, 3),
                }
                for i, r in enumerate(proj.get("matchup_rows", []))
            ]

            # Distribution (0-15 Ks)
            dist_pcts = proj.get("dist_pcts", [])
            distribution = {
                "bins": list(range(len(dist_pcts))),
                "probs": [round(p, 2) for p in dist_pcts],
            }

            # Inning breakdown
            inning_rates = sig.get("inning_rates", [])
            inning_breakdown = [
                {"inn": i + 1, "kPct": round(r * 100, 1)}
                for i, r in enumerate(inning_rates)
            ]

            model_over_odds = _fmt_ml(_p2ml(proj["p_over_k_line"]))
            model_under_odds = _fmt_ml(_p2ml(proj["p_under_k_line"]))

            return {
                "side": side,
                "pitcherName": proj["name"],
                "pitcherHand": proj["hand"],
                "retrosheetId": proj["rs_id"],
                "kProj": str(round(proj["k_proj"], 2)),
                "kLine": str(proj["k_line"]),
                "kPer9": str(round(proj["k_per_9"], 2)),
                "kMedian": str(round(proj["k_median"], 2)),
                "kP5": str(round(proj["k_proj_low"], 2)),
                "kP95": str(round(proj["k_proj_high"], 2)),
                "bookLine": str(market["line"]) if market else None,
                "bookOverOdds": _fmt_ml(market["over_ml"]) if market else None,
                "bookUnderOdds": _fmt_ml(market["under_ml"]) if market else None,
                "pOver": str(round(p_over_mkt, 4)),
                "pUnder": str(round(p_under_mkt, 4)),
                "modelOverOdds": model_over_odds,
                "modelUnderOdds": model_under_odds,
                "edgeOver": str(round(edge_over, 4)),
                "edgeUnder": str(round(edge_under, 4)),
                "verdict": verdict,
                "bestEdge": str(round(best_edge, 4)),
                "bestSide": best_side,
                "bestMlStr": best_ml_str,
                "signalBreakdown": signal_breakdown,
                "matchupRows": matchup_rows,
                "distribution": distribution,
                "inningBreakdown": inning_breakdown,
            }

        json_result = {
            "awayTeam": args.away_team,
            "homeTeam": args.home_team,
            "gameDate": args.game_date,
            "away": _proj_to_json(away_proj, away_market, "away"),
            "home": _proj_to_json(home_proj, home_market, "home"),
        }
        with open(args.json_output, "w", encoding="utf-8") as jf:
            _json.dump(json_result, jf, indent=2)
        print(f"JSON results saved → {args.json_output}")


if __name__ == "__main__":
    main()
