#!/usr/bin/env python3
"""fullgame-reinforcer-env-structure.py — is a single monthly league_env_mult
structurally sufficient?

Inputs: granular/fullgame/fullgame-reinforcer-master.csv (full population, 1555).
Residual convention: resid = actualTotal - projTotal (positive => model too LOW).

Outputs (granular/fullgame/):
  fullgame-reinforcer-env-parks.csv    per-park p1/p2 residuals + shrunk multipliers
  fullgame-reinforcer-env-slices.csv   totals bias per slice after p2 (and p1 ref)
  fullgame-reinforcer-env-regression.txt  OLS results (HC1 robust t), F-tests
Prints all key aggregates.
"""
import csv
import math
import os

import numpy as np

AUDIT = "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/audit-worktree/docs/audits/mlb-model-audit-2026"
FG = os.path.join(AUDIT, "granular", "fullgame")
MASTER = os.path.join(FG, "fullgame-reinforcer-master.csv")


def load():
    rows = []
    with open(MASTER) as f:
        for r in csv.DictReader(f):
            r["totalActual"] = float(r["totalActual"])
            r["p1_projTotal"] = float(r["p1_projTotal"])
            r["p2_projTotal"] = float(r["p2_projTotal"])
            r["parkFactor3yr"] = float(r["parkFactor3yr"]) if r["parkFactor3yr"] else 1.0
            r["lineOu"] = float(r["lineOu"]) if r["lineOu"] else None
            r["day"] = 1.0 if r["dayNight"] == "day" else 0.0
            r["dom"] = int(r["gameDate"][8:10])
            rows.append(r)
    return rows


def ols_hc1(X, y, names):
    """OLS with HC1 robust SEs. X includes intercept col."""
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    n, k = X.shape
    XtX_inv = np.linalg.inv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    e = y - X @ beta
    meat = X.T @ (X * (e ** 2)[:, None])
    cov = XtX_inv @ meat @ XtX_inv * (n / (n - k))
    se = np.sqrt(np.diag(cov))
    lines = [f"n={n} k={k}  R2={1 - e.var() / y.var():.4f}  resid_sd={e.std(ddof=k):.3f}"]
    for nm, b, s in zip(names, beta, se):
        t = b / s if s > 0 else float("nan")
        lines.append(f"  {nm:<22} {b:+.4f}  (se {s:.4f}, t {t:+.2f})")
    return beta, e, lines


def group_stats(rows, key_fn, r1_fn, r2_fn):
    """Per-group residual stats for p1 and p2."""
    groups = {}
    for r in rows:
        groups.setdefault(key_fn(r), []).append(r)
    out = []
    for g, rs in sorted(groups.items()):
        r1 = np.array([r1_fn(r) for r in rs])
        r2 = np.array([r2_fn(r) for r in rs])
        act = np.array([r["totalActual"] for r in rs])
        p1 = np.array([r["p1_projTotal"] for r in rs])
        p2 = np.array([r["p2_projTotal"] for r in rs])
        n = len(rs)
        t2 = r2.mean() / (r2.std(ddof=1) / math.sqrt(n)) if n > 2 and r2.std(ddof=1) > 0 else float("nan")
        out.append({
            "slice": g, "n": n,
            "ratio_p1": act.sum() / p1.sum(),
            "ratio_p2": act.sum() / p2.sum(),
            "bias_p1": r1.mean(), "bias_p2": r2.mean(),
            "sd_p2": r2.std(ddof=1) if n > 1 else float("nan"),
            "t_p2": t2,
            "mae_p1": np.abs(r1).mean(), "mae_p2": np.abs(r2).mean(),
        })
    return out


def main():
    rows = load()
    for r in rows:
        r["res1"] = r["totalActual"] - r["p1_projTotal"]
        r["res2"] = r["totalActual"] - r["p2_projTotal"]
    res1 = lambda r: r["res1"]
    res2 = lambda r: r["res2"]

    N = len(rows)
    print(f"population N={N}")
    all1 = np.array([r["res1"] for r in rows])
    all2 = np.array([r["res2"] for r in rows])
    print(f"season p1 bias={all1.mean():+.3f} MAE={np.abs(all1).mean():.3f} | "
          f"p2 bias={all2.mean():+.3f} MAE={np.abs(all2).mean():.3f}")

    # ---- slice tables -------------------------------------------------------
    slices = []
    def add(label, key_fn, subset=rows):
        for s in group_stats(subset, key_fn, res1, res2):
            s["family"] = label
            slices.append(s)

    add("month", lambda r: r["month"])
    add("dayNight", lambda r: r["dayNight"])
    add("roof", lambda r: r["roof"])
    add("monthXdayNight", lambda r: f"{r['month']}|{r['dayNight']}")
    add("park", lambda r: r["homeTeam"])
    add("lineBucket", lambda r: ("<=7.5" if r["lineOu"] <= 7.5 else
                                 "8-8.5" if r["lineOu"] <= 8.5 else
                                 "9-9.5" if r["lineOu"] <= 9.5 else ">=10")
        if r["lineOu"] is not None else "noline")
    add("doubleheader", lambda r: r["doubleHeader"])
    add("halfMonth", lambda r: f"{r['month']}|{'H1' if r['dom'] <= 15 else 'H2'}")
    # post-calibration regime only (May-Jul), key families
    may_jul = [r for r in rows if r["month"] >= "2026-05"]
    add("MJ-park", lambda r: r["homeTeam"], may_jul)
    add("MJ-dayNight", lambda r: r["dayNight"], may_jul)
    add("MJ-month", lambda r: r["month"], may_jul)
    add("MJ-lineBucket", lambda r: ("<=7.5" if r["lineOu"] <= 7.5 else
                                    "8-8.5" if r["lineOu"] <= 8.5 else
                                    "9-9.5" if r["lineOu"] <= 9.5 else ">=10")
        if r["lineOu"] is not None else "noline", may_jul)

    with open(os.path.join(FG, "fullgame-reinforcer-env-slices.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["family", "slice", "n", "ratio_p1", "ratio_p2",
                                          "bias_p1", "bias_p2", "sd_p2", "t_p2",
                                          "mae_p1", "mae_p2"])
        w.writeheader()
        for s in slices:
            w.writerow({k: (f"{v:.4f}" if isinstance(v, float) else v) for k, v in s.items()})

    # ---- per-park table with shrunk multipliers (season-level, descriptive) --
    park_rows = group_stats(rows, lambda r: r["homeTeam"], res1, res2)
    pf_by_team = {r["homeTeam"]: r["parkFactor3yr"] for r in rows}
    with open(os.path.join(FG, "fullgame-reinforcer-env-parks.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["park", "n", "parkFactor3yr", "ratio_p1", "ratio_p2", "bias_p2",
                    "t_p2", "shrunk_mult_n0_20", "shrunk_mult_n0_40", "shrunk_mult_n0_60"])
        for s in park_rows:
            rk = s["ratio_p2"]
            n = s["n"]
            shr = {n0: 1 + (n / (n + n0)) * (rk - 1) for n0 in (20, 40, 60)}
            w.writerow([s["slice"], n, f"{pf_by_team[s['slice']]:.4f}", f"{s['ratio_p1']:.4f}",
                        f"{rk:.4f}", f"{s['bias_p2']:+.4f}", f"{s['t_p2']:+.2f}",
                        f"{shr[20]:.4f}", f"{shr[40]:.4f}", f"{shr[60]:.4f}"])

    # ---- regressions --------------------------------------------------------
    out_lines = []
    months = sorted({r["month"] for r in rows})

    def build_X(subset, with_park_dummies=False, month_dummies=True):
        names = ["const", "parkFactor-1", "day", "roof", "line-8.5"]
        cols = [np.ones(len(subset)),
                np.array([r["parkFactor3yr"] - 1 for r in subset]),
                np.array([r["day"] for r in subset]),
                np.array([1.0 if r["roof"] == "roof" else 0.0 for r in subset]),
                np.array([(r["lineOu"] - 8.5) if r["lineOu"] is not None else 0.0
                          for r in subset])]
        if month_dummies:
            sub_months = sorted({r["month"] for r in subset})
            for m in sub_months[1:]:  # subset's own first month is the base level
                names.append(f"m:{m}")
                cols.append(np.array([1.0 if r["month"] == m else 0.0 for r in subset]))
        return np.column_stack(cols), names

    for label, subset in [("ALL (Mar-Jul), p2 residual", rows),
                          ("May-Jul (post-seed), p2 residual", may_jul)]:
        X, names = build_X(subset)
        y = np.array([r["res2"] for r in subset])
        _, e, lines = ols_hc1(X, y, names)
        out_lines.append(f"== OLS {label}: resid2 ~ park + day + roof + line + month ==")
        out_lines.extend(lines)
        out_lines.append("")

    # F-test: do 30 park dummies add signal beyond month dummies? (May-Jul, p2)
    y = np.array([r["res2"] for r in may_jul])
    X0_cols = [np.ones(len(may_jul))]
    X0_names = ["const"]
    for m in sorted({r["month"] for r in may_jul})[1:]:
        X0_cols.append(np.array([1.0 if r["month"] == m else 0.0 for r in may_jul]))
        X0_names.append(f"m:{m}")
    X0 = np.column_stack(X0_cols)
    parks = sorted({r["homeTeam"] for r in may_jul})
    Xp = np.column_stack(X0_cols + [
        np.array([1.0 if r["homeTeam"] == p else 0.0 for r in may_jul]) for p in parks[1:]])
    b0 = np.linalg.lstsq(X0, y, rcond=None)[0]
    bp = np.linalg.lstsq(Xp, y, rcond=None)[0]
    rss0 = ((y - X0 @ b0) ** 2).sum()
    rssp = ((y - Xp @ bp) ** 2).sum()
    df1 = Xp.shape[1] - X0.shape[1]
    df2 = len(y) - Xp.shape[1]
    F = ((rss0 - rssp) / df1) / (rssp / df2)
    from scipy.stats import f as fdist
    pval = 1 - fdist.cdf(F, df1, df2)
    out_lines.append(f"== F-test park dummies (May-Jul, p2 resid): F({df1},{df2})={F:.3f} p={pval:.4f} ==")

    # day/night t-test May-Jul
    d = np.array([r["res2"] for r in may_jul if r["day"] == 1])
    ng = np.array([r["res2"] for r in may_jul if r["day"] == 0])
    tt = (d.mean() - ng.mean()) / math.sqrt(d.var(ddof=1) / len(d) + ng.var(ddof=1) / len(ng))
    out_lines.append(f"day-night bias gap (May-Jul, p2): day {d.mean():+.3f} (n={len(d)}) vs "
                     f"night {ng.mean():+.3f} (n={len(ng)}), Welch t={tt:+.2f}")

    with open(os.path.join(FG, "fullgame-reinforcer-env-regression.txt"), "w") as f:
        f.write("\n".join(out_lines) + "\n")
    print("\n".join(out_lines))

    # quick month table to stdout
    print("\nmonth | n | p1 ratio (act/proj) | p2 ratio | p2 bias | envMultUsed")
    for s in [x for x in slices if x["family"] == "month"]:
        mu = next(r["envMultUsed"] for r in rows if r["month"] == s["slice"])
        print(f"{s['slice']} | {s['n']} | {s['ratio_p1']:.4f} | {s['ratio_p2']:.4f} | "
              f"{s['bias_p2']:+.3f} | {mu}")


if __name__ == "__main__":
    main()
