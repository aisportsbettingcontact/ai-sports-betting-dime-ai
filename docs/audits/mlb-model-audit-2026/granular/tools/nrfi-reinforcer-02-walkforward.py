#!/usr/bin/env python
"""nrfi-reinforcer-02-walkforward.py — NRFI REINFORCER step 2: walk-forward refit + baselines.

Refits the NRFI logistic exactly as the replay calibration layer does (verbatim
irls_logistic, ridge 1e-3, standardized features, union keyspace with 0.0 fill,
prediction clamp [0.10, 0.90]) at three cutoffs: 2026-05-01, 2026-06-01, 2026-07-01.
Each cutoff trains on games strictly before it and is evaluated on the cutoff's month.

Holdout comparison per month: refit (faithful), refit without the cutoffMs time feature,
(a) expanding climatology (train-window NRFI base rate), (b) live games.modelPNrfi,
(c) stored p2 pNrfi, plus stored p1. Paired log-loss deltas with SE on common games.

Inputs:  granular/nrfi/nrfi-reinforcer-features.csv (step 1)
Outputs: granular/nrfi/nrfi-reinforcer-betas.csv
         granular/nrfi/nrfi-reinforcer-holdout-metrics.csv
         granular/nrfi/nrfi-reinforcer-holdout-preds.csv
         granular/nrfi/nrfi-reinforcer-paired.csv
"""
from __future__ import annotations

import csv
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
NRFI_DIR = os.path.join(AUDIT, "granular", "nrfi")
FEATURES_CSV = os.path.join(NRFI_DIR, "nrfi-reinforcer-features.csv")
CALIBMETA_JSON = os.path.join(NRFI_DIR, "nrfi-reinforcer-calibmeta.json")

EPS = 1e-12
CUTOFFS = [("2026-05-01", "2026-05"), ("2026-06-01", "2026-06"), ("2026-07-01", "2026-07")]


def irls_logistic(X, y, ridge=1e-3, max_iter=50, tol=1e-8):
    """VERBATIM copy of tools/replay/calibrate_and_grade.py::irls_logistic (571-597)."""
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    Xs = (X - mu) / sd
    Xd = np.hstack([np.ones((Xs.shape[0], 1)), Xs])
    beta = np.zeros(Xd.shape[1])
    base = y.mean()
    beta[0] = math.log(min(max(base, 0.02), 0.98) / (1 - min(max(base, 0.02), 0.98)))
    for _ in range(max_iter):
        z = Xd @ beta
        p = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
        W = p * (1 - p)
        grad = Xd.T @ (y - p) - ridge * np.r_[0.0, beta[1:]]
        H = (Xd * W[:, None]).T @ Xd + ridge * np.eye(Xd.shape[1])
        try:
            step = np.linalg.solve(H, grad)
        except np.linalg.LinAlgError:
            break
        beta = beta + step
        if float(np.max(np.abs(step))) < tol:
            break
    return beta, mu, sd


def predict(model, fv, clamp=True):
    keys, beta, mu, sd = model["keys"], model["beta"], model["mu"], model["sd"]
    vec = np.array([fv.get(k, 0.0) for k in keys])
    xs = (vec - mu) / sd
    z = beta[0] + float(beta[1:] @ xs)
    p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
    if clamp:
        p = min(0.90, max(0.10, p))  # pipeline clamp, calibrate_and_grade.py:677
    return p


def fit(rows, keys_filter=None):
    feat_dicts = [r["fv"] for r in rows]
    y = [r["y"] for r in rows]
    keys = sorted(set().union(*[set(d.keys()) for d in feat_dicts]))
    if keys_filter:
        keys = [k for k in keys if keys_filter(k)]
    X = [[d.get(k, 0.0) for k in keys] for d in feat_dicts]
    beta, mu, sd = irls_logistic(np.array(X), np.array(y))
    return {"keys": keys, "beta": beta, "mu": mu, "sd": sd, "n_train": len(y)}


def logloss(p, y):
    p = min(1 - EPS, max(EPS, p))
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def auc(pairs):
    """Rank-based AUC with tie correction. pairs = [(p, y)]."""
    pos = [p for p, y in pairs if y == 1]
    neg = [p for p, y in pairs if y == 0]
    if not pos or not neg:
        return None
    allp = sorted(p for p, _ in pairs)
    import bisect
    wins = ties = 0.0
    for pp in pos:
        for nn in neg:
            if pp > nn:
                wins += 1
            elif pp == nn:
                ties += 1
    return (wins + 0.5 * ties) / (len(pos) * len(neg))


def metrics(pairs):
    """pairs = [(p, y)]. Returns dict of n, logloss, brier, hit (picks p!=0.5), auc."""
    n = len(pairs)
    if n == 0:
        return {"n": 0}
    ll = sum(logloss(p, y) for p, y in pairs) / n
    br = sum((p - y) ** 2 for p, y in pairs) / n
    picks = [(1 if p > 0.5 else 0, y) for p, y in pairs if p != 0.5]
    hit = (sum(1 for pk, y in picks if pk == y) / len(picks)) if picks else None
    return {"n": n, "logloss": round(ll, 5), "brier": round(br, 5),
            "n_picks": len(picks), "hit": None if hit is None else round(hit, 4),
            "auc": None if auc(pairs) is None else round(auc(pairs), 4)}


def load_rows():
    rows = []
    with open(FEATURES_CSV, newline="") as fh:
        rd = csv.DictReader(fh)
        feat_cols = [c for c in rd.fieldnames if c.startswith("feat.")]
        for r in rd:
            fv = {}
            for c in feat_cols:
                if r[c] != "":
                    fv[c[5:]] = float(r[c])
            rows.append({
                "game_id": int(r["game_id"]),
                "date": r["date"], "month": r["month"],
                "y": None if r["y_nrfi"] == "" else int(r["y_nrfi"]),
                "p_live": None if r["p_live"] == "" else float(r["p_live"]),
                "p_p1": None if r["p_p1"] == "" else float(r["p_p1"]),
                "p_p2": None if r["p_p2"] == "" else float(r["p_p2"]),
                "feat_ok": r["feat_ok"] == "1",
                "fv": fv,
            })
    return rows


def main():
    rows = load_rows()
    usable = [r for r in rows if r["y"] is not None and r["feat_ok"] and r["fv"]]
    print(f"population rows: {len(rows)}, usable (label+features): {len(usable)}")

    with open(CALIBMETA_JSON) as fh:
        calibmeta = json.load(fh)

    betas_out, metrics_out, preds_out, paired_out = [], [], [], []

    for cutoff, hold_month in CUTOFFS:
        train = [r for r in usable if r["date"] < cutoff]
        hold = [r for r in usable if r["month"] == hold_month]
        clim = sum(r["y"] for r in train) / len(train)

        m_faith = fit(train)
        m_notime = fit(train, keys_filter=lambda k: k != "cutoffMs")

        # beta trajectories (standardized scale), plus stored p2 betas for the month
        stored = (calibmeta.get(hold_month) or {}).get("nrfi") or {}
        stored_beta = dict(zip(stored.get("feature_keys", []), stored.get("beta", [])[1:])) \
            if stored.get("mode") == "logistic" else {}
        stored_int = stored.get("beta", [None])[0] if stored.get("mode") == "logistic" else None
        betas_out.append({"cutoff": cutoff, "feature": "(intercept)",
                          "beta_refit": round(float(m_faith["beta"][0]), 5),
                          "beta_refit_notime": round(float(m_notime["beta"][0]), 5),
                          "beta_stored_p2": stored_int,
                          "n_train_refit": m_faith["n_train"],
                          "n_train_stored": stored.get("n_train")})
        for i, k in enumerate(m_faith["keys"]):
            nt = (m_notime["keys"].index(k) if k in m_notime["keys"] else None)
            betas_out.append({
                "cutoff": cutoff, "feature": k,
                "beta_refit": round(float(m_faith["beta"][i + 1]), 5),
                "beta_refit_notime": (None if nt is None
                                      else round(float(m_notime["beta"][nt + 1]), 5)),
                "beta_stored_p2": (round(stored_beta[k], 5) if k in stored_beta else None),
                "n_train_refit": m_faith["n_train"],
                "n_train_stored": stored.get("n_train"),
            })

        series = {
            "refit": lambda r: predict(m_faith, r["fv"]),
            "refit_unclamped": lambda r: predict(m_faith, r["fv"], clamp=False),
            "refit_notime": lambda r: predict(m_notime, r["fv"]),
            "climatology": lambda r: clim,
            "live": lambda r: r["p_live"],
            "p1": lambda r: r["p_p1"],
            "p2": lambda r: r["p_p2"],
        }
        per_game = {}
        for name, f in series.items():
            pairs = []
            for r in hold:
                p = f(r)
                if p is None:
                    continue
                pairs.append((p, r["y"]))
                per_game.setdefault(r["game_id"], {"y": r["y"], "month": hold_month})[name] = p
            mm = metrics(pairs)
            mm.update({"month": hold_month, "series": name, "cutoff": cutoff,
                       "train_n": len(train), "train_base_rate": round(clim, 5)})
            metrics_out.append(mm)

        for gid, d in sorted(per_game.items()):
            d["game_id"] = gid
            preds_out.append(d)

        # paired deltas on common games
        for a, b in (("refit", "climatology"), ("refit", "p2"), ("refit_notime", "refit"),
                     ("p2", "climatology"), ("live", "climatology"), ("p2", "p1")):
            deltas = []
            for gid, d in per_game.items():
                if a in d and b in d:
                    deltas.append(logloss(d[a], d["y"]) - logloss(d[b], d["y"]))
            if not deltas:
                continue
            arr = np.array(deltas)
            se = float(arr.std(ddof=1) / math.sqrt(len(arr))) if len(arr) > 1 else float("nan")
            paired_out.append({
                "month": hold_month, "a": a, "b": b, "n": len(arr),
                "mean_logloss_delta_a_minus_b": round(float(arr.mean()), 6),
                "se": round(se, 6),
                "z": round(float(arr.mean()) / se, 2) if se > 0 else None,
            })

    # season-aggregate paired deltas (pool all three holdout months)
    pooled = {}
    for p in preds_out:
        pooled.setdefault(p["game_id"], p)
    for a, b in (("refit", "climatology"), ("refit", "p2"), ("refit_notime", "refit"),
                 ("refit_notime", "climatology"),
                 ("p2", "climatology"), ("live", "climatology"), ("p2", "p1")):
        deltas = [logloss(d[a], d["y"]) - logloss(d[b], d["y"])
                  for d in pooled.values() if a in d and b in d]
        if not deltas:
            continue
        arr = np.array(deltas)
        se = float(arr.std(ddof=1) / math.sqrt(len(arr)))
        paired_out.append({"month": "MAY-JUL", "a": a, "b": b, "n": len(arr),
                           "mean_logloss_delta_a_minus_b": round(float(arr.mean()), 6),
                           "se": round(se, 6),
                           "z": round(float(arr.mean()) / se, 2) if se > 0 else None})

    # pooled per-series metrics over the three holdout months
    for name in ("refit", "refit_unclamped", "refit_notime", "climatology", "live", "p1", "p2"):
        pairs = [(d[name], d["y"]) for d in pooled.values() if name in d]
        mm = metrics(pairs)
        mm.update({"month": "MAY-JUL", "series": name, "cutoff": "pooled",
                   "train_n": None, "train_base_rate": None})
        metrics_out.append(mm)

    def dump(path, rows_, cols):
        with open(path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=cols)
            w.writeheader()
            for r in rows_:
                w.writerow(r)

    dump(os.path.join(NRFI_DIR, "nrfi-reinforcer-betas.csv"), betas_out,
         ["cutoff", "feature", "beta_refit", "beta_refit_notime", "beta_stored_p2",
          "n_train_refit", "n_train_stored"])
    dump(os.path.join(NRFI_DIR, "nrfi-reinforcer-holdout-metrics.csv"), metrics_out,
         ["month", "series", "cutoff", "train_n", "train_base_rate", "n", "logloss",
          "brier", "n_picks", "hit", "auc"])
    dump(os.path.join(NRFI_DIR, "nrfi-reinforcer-paired.csv"), paired_out,
         ["month", "a", "b", "n", "mean_logloss_delta_a_minus_b", "se", "z"])
    cols = ["game_id", "month", "y", "refit", "refit_unclamped", "refit_notime",
            "climatology", "live", "p1", "p2"]
    with open(os.path.join(NRFI_DIR, "nrfi-reinforcer-holdout-preds.csv"), "w",
              newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for d in preds_out:
            w.writerow({c: (round(d[c], 5) if isinstance(d.get(c), float) else d.get(c))
                        for c in cols})

    for m in metrics_out:
        print(m)


if __name__ == "__main__":
    main()
