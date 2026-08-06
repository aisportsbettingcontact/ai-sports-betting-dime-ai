#!/usr/bin/env python3
"""NRFI MODELER step 2 — full-population verification of the replay NRFI projections.

Consumes granular/nrfi/nrfi-modeler-extract.json (built by step 1 from the live DB via
the pipeline's own asof_features + nrfi_feature_vector code) and verifies, for the ENTIRE
1,555-game population:

  A. p1 (wf-19288f01-p1) pNrfi distribution/range, overall and by month.
  B. Seed months (2026-03, 2026-04): p2 == p1 passthrough, exact.
  C. May+ months: stored p2 pNrfi reproducible from calibMeta betas + nrfi_features:
       - reconstruct each month's training set exactly as NrfiWalkForward.fit does
         (final games in months < m with an actual NRFI outcome, feature keys equal to
         the first training game's key set), re-derive the standardization (mu, sd)
         irls_logistic used, refit as a cross-check on the stored betas, then
       - recompute every game's prediction with the STORED calibMeta betas; where the
         game's feature keys mismatch the model's keys the pipeline silently falls back
         to p1 passthrough (predict() returns None) — replicated;
       - tolerance 1e-4; every violator listed.

Outputs in granular/nrfi/:
  nrfi-modeler-p1-distribution.csv     per-game population ledger (p1, p2, actuals)
  nrfi-modeler-p2-verification.csv     per-game reproduction result (all 1,555)
  nrfi-modeler-violators.csv           rows with abs_diff > 1e-4
  nrfi-modeler-monthly-calibration.csv per-month training reconstruction + beta check
  nrfi-modeler-keyset-census.csv       feature key-set census (the collapse mechanism)
  nrfi-modeler-aggregates.json         all headline numbers used in the report
"""
import csv
import json
import math
import os
import sys
from collections import Counter, defaultdict

import numpy as np

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIT_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", ".."))
REPLAY_DIR = os.path.join(AUDIT_DIR, "tools", "replay")
OUT_DIR = os.path.join(AUDIT_DIR, "granular", "nrfi")
sys.path.insert(0, REPLAY_DIR)

from calibrate_and_grade import irls_logistic, month_of, sigmoid  # noqa: E402

TOL = 1e-4
SEED_MONTHS = {"2026-03", "2026-04"}
FULL_KEY_COUNT = 23  # both starters have a 2026 as-of rate -> nrfi_rate_2026_asof present


def pct(x, q):
    return float(np.percentile(x, q))


def main():
    with open(os.path.join(OUT_DIR, "nrfi-modeler-extract.json")) as f:
        ex = json.load(f)
    games = ex["games"]
    p2 = {int(k): v for k, v in ex["p2"].items()}
    assert len(games) == len(p2), (len(games), len(p2))

    by_month = defaultdict(list)
    for g in games:
        g["month"] = month_of(g["gameDate"])
        by_month[g["month"]].append(g)
    months = sorted(by_month)

    # ---------------- consistency: one calibMeta.nrfi block per month ----------------
    meta_by_month = {}
    meta_variants = {}
    for gid, row in p2.items():
        m = month_of(row["gameDate"])
        sig = json.dumps(row["nrfi_meta"], sort_keys=True)
        meta_variants.setdefault(m, Counter())[sig] += 1
    for m, ctr in meta_variants.items():
        sig = ctr.most_common(1)[0][0]
        meta_by_month[m] = json.loads(sig)

    # ---------------- key-set census ----------------
    keyset_counter = Counter()
    for g in games:
        sig = "|".join(g["keys"]) if g["keys"] else "FEATURE_ERROR"
        keyset_counter[(g["month"], sig)] += 1

    # ---------------- training reconstruction + per-game verification ----------------
    monthly_rows = []
    models = {}   # month -> dict(keys, beta_stored, mu, sd) or None
    for m in months:
        if m in SEED_MONTHS:
            continue
        meta = meta_by_month[m]["nrfi_meta"] if "nrfi_meta" in meta_by_month[m] else meta_by_month[m]
        # meta_by_month values are the p2 row's nrfi block directly
        stored_keys = meta.get("feature_keys")
        stored_beta = meta.get("beta")
        train_months = [mm for mm in months if mm < m]
        candidates = []   # (gid, y, keys, vec) final + outcome, chronological
        for mm in train_months:
            for g in by_month[mm]:
                if not g["is_final"] or g["actual_nrfi"] is None:
                    continue
                candidates.append(g)
        # replicate NrfiWalkForward.fit key filtering
        keys = None
        X, y, used_ids = [], [], []
        skipped_keys = 0
        for g in candidates:
            if g["keys"] is None:
                continue
            if keys is None:
                keys = g["keys"]
            if g["keys"] != keys:
                skipped_keys += 1
                continue
            X.append(g["vec"]); y.append(g["actual_nrfi"]); used_ids.append(g["gameId"])
        keyset_match = (keys == stored_keys)
        n_recon = len(y)
        beta_max_diff = None
        beta_reproduced = None
        if keyset_match and n_recon >= 50:
            beta_fit, mu, sd = irls_logistic(np.array(X), np.array(y))
            beta_fit_r = [round(float(b), 6) for b in beta_fit]
            beta_max_diff = max(abs(a - b) for a, b in zip(beta_fit_r, stored_beta))
            beta_reproduced = beta_max_diff <= 1e-6
            models[m] = {"keys": stored_keys, "beta": stored_beta,
                         "mu": mu.tolist(), "sd": sd.tolist()}
        else:
            models[m] = None
        monthly_rows.append({
            "month": m, "mode_stored": meta.get("mode"),
            "n_train_stored": meta.get("n_train"),
            "n_candidates_final_outcome": len(candidates),
            "n_train_reconstructed": n_recon,
            "n_skipped_keyset_mismatch": skipped_keys,
            "keyset_match_stored": keyset_match,
            "beta_max_abs_diff_refit": beta_max_diff,
            "beta_reproduced_1e6": beta_reproduced,
            "meta_variants_in_month": len(meta_variants[m]),
        })

    # per-game verification
    ver_rows = []
    violators = []
    for g in games:
        gid = g["gameId"]
        m = g["month"]
        stored_p2 = p2[gid]["pNrfi"]
        p1v = g["p1_pNrfi"]
        if m in SEED_MONTHS:
            expected = p1v
            source = "seed_passthrough"
            keys_match = None
        else:
            model = models.get(m)
            keys_match = bool(model and g["keys"] == model["keys"])
            if keys_match:
                mu = np.array(model["mu"]); sd = np.array(model["sd"])
                xs = (np.array(g["vec"]) - mu) / sd
                z = model["beta"][0] + float(np.dot(np.array(model["beta"][1:]), xs))
                expected = sigmoid(max(-30, min(30, z)))
                source = "logistic"
            else:
                expected = p1v
                source = "fallback_passthrough"
        diff = abs(expected - stored_p2) if (expected is not None and stored_p2 is not None) else None
        # stored value is decimal(7,5): compare against the 5dp-rounded expectation too
        diff_rounded = (abs(round(expected, 5) - stored_p2)
                        if (expected is not None and stored_p2 is not None) else None)
        viol = diff is not None and diff > TOL
        row = {
            "gameId": gid, "gameDate": g["gameDate"], "month": m,
            "expected_source": source, "keys_match_model": keys_match,
            "p1_pNrfi": p1v, "stored_p2_pNrfi": stored_p2,
            "expected_p2_pNrfi": None if expected is None else round(expected, 7),
            "abs_diff": None if diff is None else round(diff, 8),
            "abs_diff_after_5dp_round": None if diff_rounded is None else round(diff_rounded, 8),
            "violation_gt_1e4": viol,
            "feature_error": g["feature_error"],
        }
        ver_rows.append(row)
        if viol:
            violators.append(row)

    # ---------------- p1 distribution (A) ----------------
    def dist_stats(vals, actuals=None):
        v = np.array([x for x in vals if x is not None], dtype=float)
        out = {
            "n": int(v.size), "min": float(v.min()), "max": float(v.max()),
            "mean": float(v.mean()), "sd": float(v.std(ddof=1)),
            "p01": pct(v, 1), "p05": pct(v, 5), "p25": pct(v, 25),
            "p50": pct(v, 50), "p75": pct(v, 75), "p95": pct(v, 95), "p99": pct(v, 99),
        }
        if actuals is not None:
            pairs = [(p, a) for p, a in actuals if p is not None and a is not None]
            if pairs:
                pv = np.array([p for p, _ in pairs]); av = np.array([a for _, a in pairs])
                out["n_graded"] = int(av.size)
                out["empirical_nrfi_rate"] = float(av.mean())
                out["brier"] = float(np.mean((pv - av) ** 2))
                out["logloss"] = float(-np.mean(
                    av * np.log(np.clip(pv, 1e-9, 1)) +
                    (1 - av) * np.log(np.clip(1 - pv, 1e-9, 1))))
        return out

    p1_overall = dist_stats([g["p1_pNrfi"] for g in games],
                            [(g["p1_pNrfi"], g["actual_nrfi"]) for g in games if g["is_final"]])
    p2_overall = dist_stats([p2[g["gameId"]]["pNrfi"] for g in games],
                            [(p2[g["gameId"]]["pNrfi"], g["actual_nrfi"]) for g in games if g["is_final"]])
    p1_by_month = {m: dist_stats([g["p1_pNrfi"] for g in by_month[m]],
                                 [(g["p1_pNrfi"], g["actual_nrfi"]) for g in by_month[m] if g["is_final"]])
                   for m in months}

    # ---------------- write CSVs ----------------
    def write_csv(name, rows, cols):
        with open(os.path.join(OUT_DIR, name), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k) for k in cols})

    write_csv("nrfi-modeler-p1-distribution.csv",
              [{"gameId": g["gameId"], "gameDate": g["gameDate"], "month": g["month"],
                "p1_pNrfi": g["p1_pNrfi"], "p2_pNrfi": p2[g["gameId"]]["pNrfi"],
                "is_final": g["is_final"], "actual_nrfi": g["actual_nrfi"],
                "n_feature_keys": len(g["keys"]) if g["keys"] else None}
               for g in games],
              ["gameId", "gameDate", "month", "p1_pNrfi", "p2_pNrfi", "is_final",
               "actual_nrfi", "n_feature_keys"])

    ver_cols = ["gameId", "gameDate", "month", "expected_source", "keys_match_model",
                "p1_pNrfi", "stored_p2_pNrfi", "expected_p2_pNrfi", "abs_diff",
                "abs_diff_after_5dp_round", "violation_gt_1e4", "feature_error"]
    write_csv("nrfi-modeler-p2-verification.csv", ver_rows, ver_cols)
    write_csv("nrfi-modeler-violators.csv", violators, ver_cols)
    write_csv("nrfi-modeler-monthly-calibration.csv", monthly_rows,
              list(monthly_rows[0].keys()) if monthly_rows else [])

    ks_rows = [{"month": m, "n_keys": (len(sig.split("|")) if sig != "FEATURE_ERROR" else None),
                "count": c, "keyset": sig}
               for (m, sig), c in sorted(keyset_counter.items())]
    write_csv("nrfi-modeler-keyset-census.csv", ks_rows, ["month", "n_keys", "count", "keyset"])

    # ---------------- aggregates ----------------
    seed_rows = [r for r in ver_rows if r["month"] in SEED_MONTHS]
    may_rows = [r for r in ver_rows if r["month"] not in SEED_MONTHS]
    logi_rows = [r for r in may_rows if r["expected_source"] == "logistic"]
    fall_rows = [r for r in may_rows if r["expected_source"] == "fallback_passthrough"]
    agg = {
        "population_n": len(games),
        "p1_version": ex["p1_version"], "p2_version": ex["p2_version"],
        "months": {m: len(by_month[m]) for m in months},
        "feature_errors": sum(1 for g in games if g["feature_error"]),
        "p1_distribution_overall": p1_overall,
        "p2_distribution_overall": p2_overall,
        "p1_distribution_by_month": p1_by_month,
        "seed": {
            "n": len(seed_rows),
            "n_exact_equal": sum(1 for r in seed_rows if r["abs_diff"] == 0),
            "max_abs_diff": max((r["abs_diff"] for r in seed_rows), default=None),
            "violations": sum(1 for r in seed_rows if r["violation_gt_1e4"]),
        },
        "may_plus": {
            "n": len(may_rows),
            "n_logistic_applied": len(logi_rows),
            "n_fallback_passthrough": len(fall_rows),
            "max_abs_diff": max((r["abs_diff"] for r in may_rows if r["abs_diff"] is not None),
                                default=None),
            "violations": len(violators),
            "logistic_pred_range": (
                [min(r["stored_p2_pNrfi"] for r in logi_rows),
                 max(r["stored_p2_pNrfi"] for r in logi_rows)] if logi_rows else None),
        },
        "monthly_calibration": monthly_rows,
        "jun_jul_beta_identical": (
            meta_by_month.get("2026-06", {}).get("beta") ==
            meta_by_month.get("2026-07", {}).get("beta")),
        "n_p2_meta_variants": {m: len(v) for m, v in meta_variants.items()},
    }
    with open(os.path.join(OUT_DIR, "nrfi-modeler-aggregates.json"), "w") as f:
        json.dump(agg, f, indent=1)
    print(json.dumps(agg, indent=1))


if __name__ == "__main__":
    main()
