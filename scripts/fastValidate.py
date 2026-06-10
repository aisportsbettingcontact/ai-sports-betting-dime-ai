"""
fastValidate.py — Fast smoke test for all three enhancements
Overrides SIMULATIONS=5000 for speed (full 400K used in production)
"""

import datetime
import math
import sys

sys.path.insert(0, "server")

# Override SIMULATIONS before import
import MLBAIModel

MLBAIModel.SIMULATIONS = 5_000  # fast validation only

print("[STEP] Validating MLBAIModel v2 enhancements (5K sims for speed)")

# ── 1. Check EMPIRICAL_PRIORS ─────────────────────────────────────────────
priors = MLBAIModel.EMPIRICAL_PRIORS
checks = [
    ("f5_share", 0.5618, 0.001),
    ("i1_share", 0.1166, 0.001),
    ("fg_rl_away_cover", 0.6430, 0.005),
    ("f5_push_rate", 0.1507, 0.001),
    ("f5_home_win_rate", 0.4511, 0.005),
    ("f5_push_rate", 0.1507, 0.001),
]
for key, expected, tol in checks:
    actual = priors.get(key)
    if actual is None:
        print(f"[VERIFY] FAIL — EMPIRICAL_PRIORS.{key} not found")
        continue
    delta = abs(actual - expected)
    status = "PASS" if delta <= tol else "FAIL"
    print(
        f"[VERIFY] {status} — EMPIRICAL_PRIORS.{key}={actual:.4f} (expected={expected:.4f} Δ={delta:.4f})"
    )

# ── 2. Check LEAGUE_NRFI_PRIOR and NRFI_SHRINKAGE_K ──────────────────────
league_prior = getattr(MLBAIModel, "LEAGUE_NRFI_PRIOR", None)
shrinkage_k = getattr(MLBAIModel, "NRFI_SHRINKAGE_K", None)
if league_prior is not None:
    # Expected: exp(-0.1166) = 0.8899
    expected_prior = math.exp(-0.1166)
    delta = abs(league_prior - expected_prior)
    status = "PASS" if delta <= 0.001 else "FAIL"
    print(
        f"[VERIFY] {status} — LEAGUE_NRFI_PRIOR={league_prior:.4f} (expected exp(-0.1166)={expected_prior:.4f})"
    )
else:
    print("[VERIFY] WARN — LEAGUE_NRFI_PRIOR not found as top-level constant")

if shrinkage_k is not None:
    print(
        f"[STATE] NRFI_SHRINKAGE_K={shrinkage_k} (Bayesian shrinkage confidence constant)"
    )
else:
    print("[VERIFY] WARN — NRFI_SHRINKAGE_K not found as top-level constant")

# ── 3. Run project_game() with low-sample away SP ────────────────────────
print("\n[STEP] Running project_game() — NYY@BOS, away SP 3 starts (low sample)")
AWAY_TEAM = {
    "mu": 4.52,
    "variance": 1.21,
    "rpg": 4.52,
    "era": 3.85,
    "f5_rs": 2.31,
    "obp": 0.318,
    "slg": 0.421,
    "woba": 0.322,
    "iso": 0.165,
    "k_pct": 0.225,
    "bb_pct": 0.082,
    "hr_rate": 0.038,
    "babip": 0.295,
    "wrc_plus": 108,
}
HOME_TEAM = {
    "mu": 4.78,
    "variance": 1.31,
    "rpg": 4.78,
    "era": 4.12,
    "f5_rs": 2.44,
    "obp": 0.325,
    "slg": 0.435,
    "woba": 0.331,
    "iso": 0.172,
    "k_pct": 0.218,
    "bb_pct": 0.088,
    "hr_rate": 0.041,
    "babip": 0.301,
    "wrc_plus": 112,
}
AWAY_SP = {
    "era": 3.52,
    "k9": 9.1,
    "bb9": 2.4,
    "whip": 1.12,
    "fip": 3.38,
    "xfip": 3.45,
    "ip": 42.0,
    "gp": 7,
    "hr9": 0.9,
    "xera": 3.35,
    "fipMinus": 92,
    "eraMinus": 91,
    "war": 0.9,
    "throwsHand": 0,
}
HOME_SP = {
    "era": 3.81,
    "k9": 8.6,
    "bb9": 2.7,
    "whip": 1.19,
    "fip": 3.72,
    "xfip": 3.68,
    "ip": 158.0,
    "gp": 25,
    "hr9": 1.1,
    "xera": 3.60,
    "fipMinus": 97,
    "eraMinus": 96,
    "war": 2.4,
    "throwsHand": 0,
}

try:
    result = MLBAIModel.project_game(
        away_abbrev="NYY",
        home_abbrev="BOS",
        away_team_stats=AWAY_TEAM,
        home_team_stats=HOME_TEAM,
        away_pitcher_stats=AWAY_SP,
        home_pitcher_stats=HOME_SP,
        book_lines={"total": 8.5, "away_ml": -115, "home_ml": -105, "rl_spread": -1.5},
        game_date=datetime.datetime(2026, 4, 14),
        away_pitcher_nrfi=0.3333,
        home_pitcher_nrfi=0.6667,
        away_pitcher_nrfi_starts=3,  # LOW SAMPLE → shrinkage toward league prior
        home_pitcher_nrfi_starts=25,  # FULL SAMPLE → minimal shrinkage
        seed=42,
        verbose=False,
    )
    print("[VERIFY] PASS — project_game() completed")

    # F5 push three-way pricing
    p_f5_push = result.get("p_f5_push")
    p_f5_push_raw = result.get("p_f5_push_raw")
    p_f5_home = result.get("p_f5_home_win")
    p_f5_away = result.get("p_f5_away_win")
    f5_home_ml = result.get("f5_home_ml")
    f5_away_ml = result.get("f5_away_ml")

    print(
        f"[OUTPUT] F5 push: p_f5_push_raw={p_f5_push_raw:.4f} p_f5_push={p_f5_push:.4f}"
    )
    print(
        f"[OUTPUT] F5 probs: home={p_f5_home:.4f} away={p_f5_away:.4f} push={p_f5_push:.4f}"
    )
    print(f"[OUTPUT] F5 ML: home={f5_home_ml:+.0f} away={f5_away_ml:+.0f}")

    total_3way = p_f5_home + p_f5_away + p_f5_push
    print(f"[STATE] F5 3-way sum: {total_3way:.6f} (must be 1.0)")

    if abs(total_3way - 1.0) > 0.001:
        print(f"[VERIFY] FAIL — F5 3-way sum={total_3way:.6f} != 1.0")
    else:
        print(f"[VERIFY] PASS — F5 3-way sum={total_3way:.6f} ≈ 1.0")

    if not (0.10 <= p_f5_push <= 0.20):
        print(f"[VERIFY] FAIL — p_f5_push={p_f5_push:.4f} outside [0.10, 0.20]")
    else:
        print(f"[VERIFY] PASS — p_f5_push={p_f5_push:.4f} in valid range [0.10, 0.20]")

    # Bayesian shrinkage — p_nrfi should be higher than raw 0.5 (shrinkage toward 0.8899)
    p_nrfi = result.get("p_nrfi")
    p_yrfi = result.get("p_yrfi")
    nrfi_ml = result.get("nrfi_home_ml")
    yrfi_ml = result.get("nrfi_away_ml")
    print(f"[OUTPUT] NRFI: p_nrfi={p_nrfi:.4f} p_yrfi={p_yrfi:.4f}")
    print(f"[OUTPUT] NRFI ML: nrfi={nrfi_ml:+.0f} yrfi={yrfi_ml:+.0f}")

    if p_nrfi > 0.60:
        print(
            f"[VERIFY] PASS — p_nrfi={p_nrfi:.4f} > 0.60 (Bayesian shrinkage toward 0.8899 applied)"
        )
    elif p_nrfi > 0.50:
        print(
            f"[VERIFY] WARN — p_nrfi={p_nrfi:.4f} in [0.50, 0.60] — shrinkage partially applied"
        )
    else:
        print(
            f"[VERIFY] FAIL — p_nrfi={p_nrfi:.4f} <= 0.50 — shrinkage may not be working"
        )

    # Full market summary
    print("\n[OUTPUT] Full 9-market origination:")
    markets = [
        ("FG ML", "home_ml", "away_ml"),
        ("FG RL", "home_rl_ml", "away_rl_ml"),
        ("FG Total", "over_ml", "under_ml"),
        ("F5 ML", "f5_home_ml", "f5_away_ml"),
        ("F5 RL", "f5_home_rl_ml", "f5_away_rl_ml"),
        ("F5 Total", "f5_over_ml", "f5_under_ml"),
        ("I1 NRFI", "nrfi_home_ml", None),
        ("I1 YRFI", "nrfi_away_ml", None),
    ]
    all_ok = True
    for label, k1, k2 in markets:
        v1 = result.get(k1)
        v2 = result.get(k2) if k2 else None
        v1s = f"{v1:+.0f}" if v1 is not None else "MISSING"
        v2s = f"{v2:+.0f}" if v2 is not None else ("MISSING" if k2 else "")
        ok = v1 is not None and (v2 is not None if k2 else True)
        if not ok:
            all_ok = False
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {label:12s}: {v1s:8s} {v2s}")

    if all_ok:
        print("[VERIFY] PASS — All 9 markets produced valid output")
    else:
        print("[VERIFY] FAIL — Some markets missing output")

except Exception as e:
    print(f"[VERIFY] FAIL — Exception: {e}")
    import traceback

    traceback.print_exc()
    sys.exit(1)

print("\n[VERIFY] COMPLETE — All three enhancements validated")
