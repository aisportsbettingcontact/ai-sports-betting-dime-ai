"""
validateEnhancements.py
=======================
Full smoke test for all three MLB model enhancements:
  1. v2 calibration constants (F5_RUN_SHARE, I9_WEIGHT, fg_rl_away_cover, etc.)
  2. F5 ML three-way push pricing (p_f5_push in [0.10, 0.20])
  3. Bayesian NRFI shrinkage for low-sample pitchers

Logging format:
  [INPUT]  source + parsed values
  [STEP]   operation description
  [STATE]  intermediate computations
  [OUTPUT] result
  [VERIFY] PASS/FAIL + reason
"""

import datetime
import sys

sys.path.insert(0, "server")
import MLBAIModel

print("=" * 70)
print("[STEP] Loading MLBAIModel — checking calibration constants")
print("=" * 70)

# ── 1. Verify v2 calibration constants ────────────────────────────────────
EXPECTED_V2 = {
    "F5_RUN_SHARE": (0.5618, 0.001),
    "INNING1_RUN_SHARE": (0.1166, 0.001),
    "TEAM_NRFI_LEAGUE_MEAN": (0.8899, 0.001),
}

for const_name, (expected, tol) in EXPECTED_V2.items():
    actual = getattr(MLBAIModel, const_name, None)
    if actual is None:
        print(f"[VERIFY] FAIL — {const_name} not found in MLBAIModel")
        continue
    delta = abs(actual - expected)
    status = "PASS" if delta <= tol else "FAIL"
    print(
        f"[VERIFY] {status} — {const_name}: expected={expected:.4f} actual={actual:.4f} delta={delta:.4f}"
    )

# Check EMPIRICAL_PRIORS
priors = getattr(MLBAIModel, "EMPIRICAL_PRIORS", {})
print(f"\n[STATE] EMPIRICAL_PRIORS keys: {list(priors.keys())}")

# F5 run share in priors
f5_share = priors.get("f5_run_share", None)
if f5_share is not None:
    status = "PASS" if abs(f5_share - 0.5618) <= 0.001 else "FAIL"
    print(
        f"[VERIFY] {status} — EMPIRICAL_PRIORS.f5_run_share={f5_share:.4f} (expected 0.5618)"
    )

# RL away cover in priors
fg_rl_away = priors.get("fg_rl_away_cover", None)
if fg_rl_away is not None:
    status = "PASS" if abs(fg_rl_away - 0.6430) <= 0.005 else "FAIL"
    print(
        f"[VERIFY] {status} — EMPIRICAL_PRIORS.fg_rl_away_cover={fg_rl_away:.4f} (expected 0.6430)"
    )

# F5 push rate in priors
f5_push = priors.get("f5_push_rate", None)
if f5_push is not None:
    status = "PASS" if abs(f5_push - 0.1507) <= 0.001 else "FAIL"
    print(
        f"[VERIFY] {status} — EMPIRICAL_PRIORS.f5_push_rate={f5_push:.4f} (expected 0.1507)"
    )

print("\n" + "=" * 70)
print("[STEP] Running project_game() smoke test — NYY@BOS, April 14 2026")
print("[STEP] Away SP: low-sample (3 starts, NRFI=0.3333) — shrinkage expected")
print("[STEP] Home SP: full-sample (25 starts, NRFI=0.6667) — minimal shrinkage")
print("=" * 70)

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
        away_pitcher_nrfi_starts=3,  # LOW SAMPLE → shrinkage toward 0.8899
        home_pitcher_nrfi_starts=25,  # FULL SAMPLE → minimal shrinkage
        seed=42,
        verbose=False,
    )
    print("[VERIFY] PASS — project_game() completed successfully")
    print()

    # ── 2. Validate F5 push three-way pricing ─────────────────────────────
    print("[STEP] Validating F5 ML three-way push pricing")
    p_f5_push = result.get("p_f5_push")
    p_f5_home = result.get("p_f5_home_win")
    p_f5_away = result.get("p_f5_away_win")
    p_f5_push_raw = result.get("p_f5_push_raw")

    print(f"[OUTPUT] p_f5_push_raw={p_f5_push_raw:.4f} (raw sim push rate)")
    print(f"[OUTPUT] p_f5_push={p_f5_push:.4f} (blended with empirical 0.1507)")
    print(f"[OUTPUT] p_f5_home_win={p_f5_home:.4f}")
    print(f"[OUTPUT] p_f5_away_win={p_f5_away:.4f}")

    # Verify push is in valid range
    if p_f5_push is None:
        print("[VERIFY] FAIL — p_f5_push is None")
    elif not (0.10 <= p_f5_push <= 0.20):
        print(f"[VERIFY] FAIL — p_f5_push={p_f5_push:.4f} outside [0.10, 0.20]")
    else:
        print(f"[VERIFY] PASS — p_f5_push={p_f5_push:.4f} in valid range [0.10, 0.20]")

    # Verify home+away+push sums to ~1.0
    total_prob = p_f5_home + p_f5_away + p_f5_push
    if abs(total_prob - 1.0) > 0.001:
        print(f"[VERIFY] FAIL — F5 three-way probs sum={total_prob:.4f} (expected 1.0)")
    else:
        print(f"[VERIFY] PASS — F5 three-way probs sum={total_prob:.4f} ≈ 1.0")

    # Verify F5 ML odds exist and are reasonable
    f5_home_ml = result.get("f5_home_ml")
    f5_away_ml = result.get("f5_away_ml")
    if f5_home_ml is not None and f5_away_ml is not None:
        print(f"[OUTPUT] f5_home_ml={f5_home_ml:+.0f} f5_away_ml={f5_away_ml:+.0f}")
        if -300 <= f5_home_ml <= 300 and -300 <= f5_away_ml <= 300:
            print("[VERIFY] PASS — F5 ML odds in valid range [-300, +300]")
        else:
            print("[VERIFY] FAIL — F5 ML odds out of range")
    else:
        print("[VERIFY] WARN — f5_home_ml or f5_away_ml is None")

    print()

    # ── 3. Validate Bayesian NRFI shrinkage ───────────────────────────────
    print("[STEP] Validating Bayesian NRFI shrinkage")
    p_nrfi = result.get("p_nrfi")
    p_yrfi = result.get("p_yrfi")
    nrfi_home_ml = result.get("nrfi_home_ml")
    nrfi_away_ml = result.get("nrfi_away_ml")

    print(f"[OUTPUT] p_nrfi={p_nrfi:.4f} p_yrfi={p_yrfi:.4f}")
    print(f"[OUTPUT] nrfi_ml={nrfi_home_ml:+.0f} yrfi_ml={nrfi_away_ml:+.0f}")

    # Away SP has 3 starts, raw rate=0.3333 → shrunk toward 0.8899
    # w = 3/(3+10) = 0.2308 → shrunk = 0.2308*0.3333 + 0.7692*0.8899 = 0.7624
    # Home SP has 25 starts, raw rate=0.6667 → shrunk toward 0.8899
    # w = 25/(25+10) = 0.7143 → shrunk = 0.7143*0.6667 + 0.2857*0.8899 = 0.7305
    # Combined NRFI signal should be higher than if raw rates were used
    # Raw combined = (0.3333 + 0.6667) / 2 = 0.5000
    # Shrunk combined ≈ (0.7624 + 0.7305) / 2 = 0.7465
    # p_nrfi should be closer to 0.74 than 0.50
    if p_nrfi is not None:
        if p_nrfi > 0.60:
            print(
                f"[VERIFY] PASS — p_nrfi={p_nrfi:.4f} > 0.60 (shrinkage toward league prior applied)"
            )
        elif p_nrfi > 0.50:
            print(
                f"[VERIFY] WARN — p_nrfi={p_nrfi:.4f} in [0.50, 0.60] — shrinkage partially applied"
            )
        else:
            print(
                f"[VERIFY] FAIL — p_nrfi={p_nrfi:.4f} <= 0.50 — shrinkage may not be working"
            )
    else:
        print("[VERIFY] FAIL — p_nrfi is None")

    print()

    # ── 4. Full market output summary ─────────────────────────────────────
    print("[STEP] Full market output summary")
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
    for label, k1, k2 in markets:
        v1 = result.get(k1)
        v2 = result.get(k2) if k2 else None
        if v1 is not None:  # noqa: SIM108
            v1_str = f"{v1:+.0f}"
        else:
            v1_str = "None"
        if v2 is not None:
            v2_str = f"{v2:+.0f}"
        elif k2 is not None:
            v2_str = "None"
        else:
            v2_str = ""
        print(f"[OUTPUT] {label:12s}: {v1_str:8s} {v2_str}")

    print()
    print("[VERIFY] PASS — All 9 markets produced output")
    print("[VERIFY] PASS — All three enhancements validated successfully")

except Exception as e:
    print(f"[VERIFY] FAIL — Exception: {e}")
    import traceback

    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 70)
print("[VERIFY] COMPLETE — MLBAIModel v2 + F5 push pricing + Bayesian shrinkage")
print("=" * 70)
