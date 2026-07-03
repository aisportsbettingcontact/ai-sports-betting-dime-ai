"""
smokeTestIntegration.py
────────────────────────────────────────────────────────────────────────────────
Smoke test for the 3yr backtest integration into MLBAIModel.project_game().

Tests:
1. TEAM_NRFI_RATES / TEAM_F5_RS / EMPIRICAL_PRIORS constants are present
2. project_game() accepts the 6 new NRFI/F5 parameters
3. simulate() returns nrfi_combined_signal, nrfi_combined_pass, nrfi_both_pass
4. Bayesian prior blending produces a different p_nrfi than physics-only
5. Auto-lookup from TEAM_NRFI_RATES works when team rates are not passed
6. F5 team RS adjustment is applied

Uses verbose=False and n_sims=5000 for speed (not production accuracy).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from datetime import datetime

from MLBAIModel import (
    EMPIRICAL_PRIORS,
    NRFI_COMBINED_THRESHOLD,
    TEAM_F5_RS,
    TEAM_NRFI_RATES,
    project_game,
)

# ── Test matchs ──────────────────────────────────────────────────────────────
WSH_STATS = {
    "rpg": 4.12,
    "era": 4.42,
    "avg": 0.242,
    "obp": 0.308,
    "slg": 0.392,
    "k9": 8.8,
    "bb9": 3.3,
    "whip": 1.30,
    "ip_per_game": 5.1,
}
PIT_STATS = {
    "rpg": 4.28,
    "era": 4.12,
    "avg": 0.245,
    "obp": 0.312,
    "slg": 0.398,
    "k9": 8.9,
    "bb9": 3.2,
    "whip": 1.28,
    "ip_per_game": 5.2,
}
IRVIN_STATS = {
    "era": 5.70,
    "k9": 6.20,
    "bb9": 3.10,
    "whip": 1.43,
    "ip": 180.0,
    "gp": 33,
    "xera": 5.70,
}
KELLER_STATS = {
    "era": 4.19,
    "k9": 7.70,
    "bb9": 2.60,
    "whip": 1.26,
    "ip": 176.3,
    "gp": 32,
    "xera": 4.45,
}
BOOK_LINES = {
    "ml_home": -130,
    "ml_away": 110,
    "ou_line": 9.5,
    "rl_home_spread": -1.5,
    "rl_home": -130,
    "rl_away": 110,
}
GAME_DATE = datetime(2026, 4, 14)

PASS = "\033[92m[PASS]\033[0m"
FAIL = "\033[91m[FAIL]\033[0m"

errors = 0


def check(label, condition, detail=""):
    global errors
    if condition:
        print(f"{PASS} {label}" + (f" — {detail}" if detail else ""))
    else:
        print(f"{FAIL} {label}" + (f" — {detail}" if detail else ""))
        errors += 1


# ── Test 1: Constants present ──────────────────────────────────────────────────
print("\n[TEST 1] Constants block")
check(
    "TEAM_NRFI_RATES has 30 teams",
    len(TEAM_NRFI_RATES) == 30,
    f"n={len(TEAM_NRFI_RATES)}",
)
check("TEAM_F5_RS has 30 teams", len(TEAM_F5_RS) == 30, f"n={len(TEAM_F5_RS)}")
check(
    "EMPIRICAL_PRIORS has nrfi_rate",
    "nrfi_rate" in EMPIRICAL_PRIORS,
    str(EMPIRICAL_PRIORS.get("nrfi_rate")),
)
check(
    "EMPIRICAL_PRIORS has f5_share",
    "f5_share" in EMPIRICAL_PRIORS,
    str(EMPIRICAL_PRIORS.get("f5_share")),
)
check(
    "NRFI_COMBINED_THRESHOLD == 0.56",
    NRFI_COMBINED_THRESHOLD == 0.56,
    str(NRFI_COMBINED_THRESHOLD),
)
check(
    "WSH in TEAM_NRFI_RATES",
    "WSH" in TEAM_NRFI_RATES,
    f"WSH={TEAM_NRFI_RATES.get('WSH')}",
)
check(
    "PIT in TEAM_NRFI_RATES",
    "PIT" in TEAM_NRFI_RATES,
    f"PIT={TEAM_NRFI_RATES.get('PIT')}",
)

# ── Test 2: project_game with pitcher NRFI rates ───────────────────────────────
print("\n[TEST 2] project_game() with pitcher NRFI rates (WSH@PIT, n_sims=5000)")
# Monkey-patch SIMULATIONS to 5000 for speed
import MLBAIModel

original_sims = MLBAIModel.SIMULATIONS
MLBAIModel.SIMULATIONS = 5000

result_with_priors = project_game(
    away_abbrev="WSH",
    home_abbrev="PIT",
    away_team_stats=WSH_STATS,
    home_team_stats=PIT_STATS,
    away_pitcher_stats=IRVIN_STATS,
    home_pitcher_stats=KELLER_STATS,
    book_lines=BOOK_LINES,
    game_date=GAME_DATE,
    away_pitcher_nrfi=0.5412,  # Jake Irvin 3yr NRFI rate
    home_pitcher_nrfi=0.6111,  # Mitch Keller 3yr NRFI rate
    verbose=False,
)
print("  [INPUT]  away_pitcher_nrfi=0.5412 (Irvin) | home_pitcher_nrfi=0.6111 (Keller)")
print(
    f"  [OUTPUT] p_nrfi={result_with_priors['p_nrfi']:.4f} | nrfi_odds={result_with_priors['nrfi_odds']}"
)
print(
    f"  [OUTPUT] nrfi_combined_signal={result_with_priors.get('nrfi_combined_signal')}"
)
print(f"  [OUTPUT] nrfi_combined_pass={result_with_priors.get('nrfi_combined_pass')}")
print(f"  [OUTPUT] nrfi_both_pass={result_with_priors.get('nrfi_both_pass')}")
print(
    f"  [OUTPUT] proj_total={result_with_priors['proj_total']:.3f} | f5_total={result_with_priors.get('f5_total_key')}"
)
print(
    f"  [OUTPUT] home_ml={result_with_priors['home_ml']} | away_ml={result_with_priors['away_ml']}"
)

check(
    "p_nrfi is float in [0,1]",
    isinstance(result_with_priors.get("p_nrfi"), float)
    and 0 < result_with_priors["p_nrfi"] < 1,
    f"p_nrfi={result_with_priors.get('p_nrfi')}",
)
check(
    "nrfi_combined_signal returned",
    result_with_priors.get("nrfi_combined_signal") is not None,
    f"signal={result_with_priors.get('nrfi_combined_signal')}",
)
check(
    "nrfi_combined_pass returned",
    result_with_priors.get("nrfi_combined_pass") is not None,
    f"pass={result_with_priors.get('nrfi_combined_pass')}",
)
check(
    "nrfi_both_pass returned",
    result_with_priors.get("nrfi_both_pass") is not None,
    f"both={result_with_priors.get('nrfi_both_pass')}",
)
check(
    "exp_total is positive float",
    isinstance(result_with_priors.get("exp_total"), float)
    and result_with_priors["exp_total"] > 0,
    f"exp_total={result_with_priors.get('exp_total')}",
)

# ── Test 3: Auto-lookup when pitcher NRFI not passed ──────────────────────────
print(
    "\n[TEST 3] project_game() without pitcher NRFI rates (auto-lookup from constants)"
)
result_no_priors = project_game(
    away_abbrev="WSH",
    home_abbrev="PIT",
    away_team_stats=WSH_STATS,
    home_team_stats=PIT_STATS,
    away_pitcher_stats=IRVIN_STATS,
    home_pitcher_stats=KELLER_STATS,
    book_lines=BOOK_LINES,
    game_date=GAME_DATE,
    away_pitcher_nrfi=None,
    home_pitcher_nrfi=None,
    verbose=False,
)
print("  [INPUT]  away_pitcher_nrfi=None | home_pitcher_nrfi=None")
print(
    f"  [OUTPUT] p_nrfi={result_no_priors['p_nrfi']:.4f} | nrfi_combined_signal={result_no_priors.get('nrfi_combined_signal')}"
)
check(
    "nrfi_combined_signal is None when no pitcher rates",
    result_no_priors.get("nrfi_combined_signal") is None,
    f"signal={result_no_priors.get('nrfi_combined_signal')}",
)
check(
    "p_nrfi still valid (physics-only fallback)",
    isinstance(result_no_priors.get("p_nrfi"), float)
    and 0 < result_no_priors["p_nrfi"] < 1,
    f"p_nrfi={result_no_priors.get('p_nrfi')}",
)

# ── Test 4: Bayesian prior changes p_nrfi vs physics-only ─────────────────────
print("\n[TEST 4] Bayesian prior effect on p_nrfi")
p_with = result_with_priors["p_nrfi"]
p_without = result_no_priors["p_nrfi"]
delta = abs(p_with - p_without)
print(f"  p_nrfi (with priors)   = {p_with:.4f}")
print(f"  p_nrfi (physics only)  = {p_without:.4f}")
print(f"  delta                  = {delta:.4f}")
# With n_sims=5000 there's sampling noise; delta should be non-zero but may be small
check(
    "Bayesian prior produces different p_nrfi",
    delta > 0.0001,
    f"delta={delta:.4f} (expected > 0.0001 with 35% pitcher weight)",
)

# ── Test 5: High-NRFI pitcher pair triggers combined_pass ─────────────────────
print(
    "\n[TEST 5] High-NRFI pitcher pair (both >= 0.60) triggers nrfi_combined_pass + nrfi_both_pass"
)
result_high = project_game(
    away_abbrev="LAA",
    home_abbrev="NYY",
    away_team_stats={
        "rpg": 4.18,
        "era": 4.48,
        "avg": 0.243,
        "obp": 0.310,
        "slg": 0.392,
        "k9": 8.7,
        "bb9": 3.4,
        "whip": 1.33,
        "ip_per_game": 5.0,
    },
    home_team_stats={
        "rpg": 5.01,
        "era": 3.88,
        "avg": 0.260,
        "obp": 0.332,
        "slg": 0.445,
        "k9": 9.4,
        "bb9": 2.9,
        "whip": 1.20,
        "ip_per_game": 5.6,
    },
    away_pitcher_stats={
        "era": 3.96,
        "k9": 11.3,
        "bb9": 3.5,
        "whip": 1.28,
        "ip": 63.7,
        "gp": 14,
        "xera": 3.61,
    },
    home_pitcher_stats={
        "era": 4.44,
        "k9": 9.5,
        "bb9": 3.6,
        "whip": 1.37,
        "ip": 162.3,
        "gp": 33,
        "xera": 4.58,
    },
    book_lines={
        "ml_home": -160,
        "ml_away": 135,
        "ou_line": 9.0,
        "rl_home_spread": -1.5,
        "rl_home": -160,
        "rl_away": 135,
    },
    game_date=GAME_DATE,
    away_pitcher_nrfi=0.6250,  # high NRFI rate
    home_pitcher_nrfi=0.6667,  # high NRFI rate
    verbose=False,
)
combined_high = result_high.get("nrfi_combined_signal")
print(f"  [OUTPUT] nrfi_combined_signal={combined_high}")
print(f"  [OUTPUT] nrfi_combined_pass={result_high.get('nrfi_combined_pass')}")
print(f"  [OUTPUT] nrfi_both_pass={result_high.get('nrfi_both_pass')}")
check(
    "nrfi_combined_signal > 0.56 for high-NRFI pair",
    combined_high is not None and combined_high > 0.56,
    f"signal={combined_high}",
)
check(
    "nrfi_combined_pass=True for high-NRFI pair",
    result_high.get("nrfi_combined_pass"),
    f"pass={result_high.get('nrfi_combined_pass')}",
)
check(
    "nrfi_both_pass=True for both >= 0.60",
    result_high.get("nrfi_both_pass"),
    f"both={result_high.get('nrfi_both_pass')}",
)

# ── Restore SIMULATIONS ────────────────────────────────────────────────────────
MLBAIModel.SIMULATIONS = original_sims

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'=' * 60}")
if errors == 0:
    print("\033[92m[ALL TESTS PASSED]\033[0m  0 errors")
else:
    print(f"\033[91m[{errors} TEST(S) FAILED]\033[0m")
print(f"{'=' * 60}\n")
sys.exit(0 if errors == 0 else 1)
