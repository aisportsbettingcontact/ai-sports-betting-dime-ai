#!/usr/bin/env python3
"""fullgame-reinforcer-temp-homeedge.py — ML temperature stability + home-edge
assessment on the full replay population (1555 finals).

1. Rolling 200-game T fit (step 25) on p1 pAwayMl vs away-win outcome —
   trajectory CSV + SVG plot.
2. Per-month (month-only, NOT expanding) T fits — stationarity check; expanding
   fits re-derived to verify calibMeta values.
3. Home-edge: p1 was generated with FG_ML_HOME_EDGE=0.03 (additive to p_home in
   prob space, sum-to-1 by construction). The de-adjusted p_home_raw =
   p_home_p1 - 0.03 is exact up to the [0.001,0.999] clip. Fit the season-optimal
   additive edge e* (NLL-minimizing p_home = p_home_raw + e), profile-likelihood
   CI, and compare NLL/Brier at e in {0 (no edge), 0.0178 (DB constant),
   0.03 (as built), e*}. Also joint (T, e) fit and rolling e trajectory.
Outputs: fullgame-reinforcer-temp-trajectory.csv,
         fullgame-reinforcer-homeedge.csv,
         fullgame-reinforcer-temp-trajectory.svg, stdout summary.
"""
import csv
import math
import os

import numpy as np
from scipy.optimize import minimize_scalar, minimize

AUDIT = "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/audit-worktree/docs/audits/mlb-model-audit-2026"
FG = os.path.join(AUDIT, "granular", "fullgame")
MASTER = os.path.join(FG, "fullgame-reinforcer-master.csv")
EPS = 1e-9
HOME_EDGE_BUILT = 0.03
HOME_EDGE_DB = 0.01781473  # mlb_calibration_constants.fg_ml_home_edge


def logit(p):
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def nll_vec(p, y):
    p = np.clip(p, EPS, 1 - EPS)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def brier_vec(p, y):
    return float(np.mean((p - y) ** 2))


def fit_T(p_away, y_away):
    lo = logit(p_away)

    def nll(t):
        p = 1 / (1 + np.exp(-lo / t))
        return nll_vec(p, y_away)

    res = minimize_scalar(nll, bounds=(0.2, 5.0), method="bounded")
    return float(res.x), nll(res.x)


def main():
    rows = []
    with open(MASTER) as f:
        for r in csv.DictReader(f):
            rows.append({
                "gameId": int(r["gameId"]), "gameDate": r["gameDate"],
                "month": r["month"],
                "startET": float(r["startET"]) if r["startET"] else 19.0,
                "p1_away": float(r["p1_pAwayMl"]), "p2_away": float(r["p2_pAwayMl"]),
                "homeWin": int(r["homeWin"]),
            })
    rows.sort(key=lambda r: (r["gameDate"], r["startET"], r["gameId"]))
    N = len(rows)
    p1a = np.array([r["p1_away"] for r in rows])
    ya = np.array([1 - r["homeWin"] for r in rows], float)  # away win
    yh = 1 - ya
    p1h = 1 - p1a
    months = np.array([r["month"] for r in rows])
    print(f"N={N}; season away-win rate={ya.mean():.4f}; home-win rate={yh.mean():.4f}")
    print(f"mean p1 p_home={p1h.mean():.4f} (includes +0.03 edge); "
          f"mean p2 p_home={np.mean([1 - r['p2_away'] for r in rows]):.4f}")

    # ---- rolling 200-game T ------------------------------------------------
    W, STEP = 200, 25
    p_home_raw_all = np.clip(p1h - HOME_EDGE_BUILT, EPS, 1 - EPS)
    traj = []
    for start in range(0, N - W + 1, STEP):
        sl = slice(start, start + W)
        t, _ = fit_T(p1a[sl], ya[sl])
        t_de, _ = fit_T(1 - p_home_raw_all[sl], ya[sl])  # T on de-edged probs
        # rolling additive home edge delta (T fixed at 1): p_home + d
        d_grid = np.linspace(-0.10, 0.10, 401)
        nlls = [nll_vec(p1h[sl] + d, yh[sl]) for d in d_grid]
        d_hat = float(d_grid[int(np.argmin(nlls))])
        traj.append({
            "windowStart": rows[start]["gameDate"],
            "windowEnd": rows[start + W - 1]["gameDate"],
            "centerIdx": start + W // 2,
            "centerDate": rows[start + W // 2]["gameDate"],
            "T": round(t, 4),
            "T_deEdged": round(t_de, 4),
            "homeDelta": round(d_hat, 4),
            "impliedEdge": round(HOME_EDGE_BUILT + d_hat, 4),
            "homeWinRate": round(float(yh[sl].mean()), 4),
            "meanPHome": round(float(p1h[sl].mean()), 4),
        })
    with open(os.path.join(FG, "fullgame-reinforcer-temp-trajectory.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(traj[0].keys()))
        w.writeheader()
        w.writerows(traj)
    Ts = np.array([t["T"] for t in traj])
    Tsd = np.array([t["T_deEdged"] for t in traj])
    hwr = np.array([t["homeWinRate"] for t in traj])
    print(f"\nrolling-200 T: n_windows={len(traj)} min={Ts.min():.3f} max={Ts.max():.3f} "
          f"mean={Ts.mean():.3f} sd={Ts.std(ddof=1):.3f}")
    print(f"rolling-200 T (de-edged p): min={Tsd.min():.3f} max={Tsd.max():.3f} "
          f"mean={Tsd.mean():.3f} sd={Tsd.std(ddof=1):.3f}")
    print(f"corr(T, window homeWinRate) = {np.corrcoef(Ts, hwr)[0,1]:+.3f}; "
          f"corr(T_deEdged, homeWinRate) = {np.corrcoef(Tsd, hwr)[0,1]:+.3f}; "
          f"windows at 5.0 bound: T={int((Ts>=4.999).sum())}, "
          f"deEdged={int((Tsd>=4.999).sum())}")

    # ---- per-month T (month-only) + expanding verification ------------------
    print("\nmonth-only T fits (stationarity; as-built p1 vs de-edged):")
    uniq = sorted(set(months))
    for m in uniq:
        sel = months == m
        t, _ = fit_T(p1a[sel], ya[sel])
        t_de, _ = fit_T(1 - p_home_raw_all[sel], ya[sel])
        print(f"  {m}: n={int(sel.sum())} T={t:.4f} T_deEdged={t_de:.4f}")
    print("expanding T fits (replicating walk-forward calibMeta):")
    for m in ["2026-05", "2026-06", "2026-07"]:
        sel = months < m
        t, _ = fit_T(p1a[sel], ya[sel])
        print(f"  fit on < {m}: n={int(sel.sum())} T={t:.4f}")
    t_season, _ = fit_T(p1a, ya)
    print(f"full-season T={t_season:.4f}")

    # ---- home edge assessment ----------------------------------------------
    p_home_raw = np.clip(p1h - HOME_EDGE_BUILT, EPS, 1 - EPS)  # exact de-adjust

    def nll_edge(e):
        return nll_vec(p_home_raw + e, yh)

    res = minimize_scalar(nll_edge, bounds=(-0.05, 0.10), method="bounded")
    e_star, nll_star = float(res.x), float(res.fun)
    # profile-likelihood 95% CI: 2*N*(nll(e)-nll*) <= 3.841
    grid = np.linspace(-0.05, 0.10, 1501)
    prof = np.array([nll_edge(e) for e in grid])
    inside = grid[2 * N * (prof - nll_star) <= 3.841]
    ci_lo, ci_hi = float(inside.min()), float(inside.max())

    cand = [("no_edge_e0", 0.0), ("db_constant_e0.0178", HOME_EDGE_DB),
            ("as_built_e0.03", HOME_EDGE_BUILT), (f"fitted_e{e_star:.4f}", e_star)]
    out = []
    print(f"\nhome-edge profile: e*={e_star:.4f} (95% CI [{ci_lo:.4f}, {ci_hi:.4f}])")
    for name, e in cand:
        p = np.clip(p_home_raw + e, EPS, 1 - EPS)
        out.append({"variant": name, "edge": round(e, 5),
                    "nll": round(nll_vec(p, yh), 6),
                    "brier": round(brier_vec(p, yh), 6),
                    "meanPHome": round(float(p.mean()), 4),
                    "homeWinRate": round(float(yh.mean()), 4),
                    "calibInLarge": round(float(p.mean() - yh.mean()), 4)})
        print(f"  {name:<22} nll={out[-1]['nll']:.6f} brier={out[-1]['brier']:.6f} "
              f"calib-in-large={out[-1]['calibInLarge']:+.4f}")

    # joint (T, e): p_home = sigmoid(logit(p_home_raw + e)/T)
    def nll_joint(x):
        t, e = x
        if t <= 0.2:
            return 10.0
        p = 1 / (1 + np.exp(-logit(np.clip(p_home_raw + e, EPS, 1 - EPS)) / t))
        return nll_vec(p, yh)

    rj = minimize(nll_joint, x0=[1.3, 0.02], method="Nelder-Mead")
    t_j, e_j = float(rj.x[0]), float(rj.x[1])
    p_joint = 1 / (1 + np.exp(-logit(np.clip(p_home_raw + e_j, EPS, 1 - EPS)) / t_j))
    out.append({"variant": "joint_T_and_edge", "edge": round(e_j, 5),
                "nll": round(nll_vec(p_joint, yh), 6),
                "brier": round(brier_vec(p_joint, yh), 6),
                "meanPHome": round(float(p_joint.mean()), 4),
                "homeWinRate": round(float(yh.mean()), 4),
                "calibInLarge": round(float(p_joint.mean() - yh.mean()), 4)})
    print(f"  joint fit: T={t_j:.4f} edge={e_j:.4f} nll={out[-1]['nll']:.6f} "
          f"brier={out[-1]['brier']:.6f}")
    # T-only on as-built p1 (what p2 does), for reference
    p_t = 1 / (1 + np.exp(-logit(p1h) / t_season))
    out.append({"variant": "T_only_on_asbuilt_p1", "edge": HOME_EDGE_BUILT,
                "nll": round(nll_vec(p_t, yh), 6), "brier": round(brier_vec(p_t, yh), 6),
                "meanPHome": round(float(p_t.mean()), 4),
                "homeWinRate": round(float(yh.mean()), 4),
                "calibInLarge": round(float(p_t.mean() - yh.mean()), 4)})
    out.append({"variant": "profile_CI", "edge": f"[{ci_lo:.4f},{ci_hi:.4f}]",
                "nll": "", "brier": "", "meanPHome": "", "homeWinRate": "",
                "calibInLarge": ""})
    with open(os.path.join(FG, "fullgame-reinforcer-homeedge.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    # per-month home edge (raw): actual home rate vs mean raw p_home
    print("\nper-month home rate vs raw model p_home (edge the data wanted):")
    for m in uniq:
        sel = months == m
        gap = float(yh[sel].mean() - p_home_raw[sel].mean())
        print(f"  {m}: n={int(sel.sum())} homeRate={yh[sel].mean():.4f} "
              f"rawPHome={p_home_raw[sel].mean():.4f} impliedEdge={gap:+.4f}")

    # ---- SVG plot of T trajectory ------------------------------------------
    svg_w, svg_h, pad = 900, 380, 55
    xs = np.arange(len(traj))
    t_lo, t_hi = 0.8, max(2.2, Ts.max() + 0.1)

    def X(i):
        return pad + (svg_w - 2 * pad) * (i / max(1, len(traj) - 1))

    def Y(t):
        return svg_h - pad - (svg_h - 2 * pad) * ((t - t_lo) / (t_hi - t_lo))

    pts = " ".join(f"{X(i):.1f},{Y(t):.1f}" for i, t in zip(xs, Ts))
    ticks = []
    for tv in np.arange(1.0, t_hi + 0.001, 0.25):
        ticks.append(f'<line x1="{pad}" y1="{Y(tv):.1f}" x2="{svg_w-pad}" y2="{Y(tv):.1f}" stroke="#ddd"/>'
                     f'<text x="{pad-8}" y="{Y(tv)+4:.1f}" text-anchor="end" font-size="11">{tv:.2f}</text>')
    labels = []
    seen = set()
    for i, t in enumerate(traj):
        m = t["centerDate"][:7]
        if m not in seen:
            seen.add(m)
            labels.append(f'<text x="{X(i):.1f}" y="{svg_h-pad+18}" font-size="11">{m}</text>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{svg_w}" height="{svg_h}" font-family="monospace">
<rect width="{svg_w}" height="{svg_h}" fill="white"/>
<text x="{svg_w/2}" y="22" text-anchor="middle" font-size="14">FG ML temperature T — rolling 200-game windows (step 25), p1 raw model</text>
{''.join(ticks)}
<line x1="{pad}" y1="{Y(1.0):.1f}" x2="{svg_w-pad}" y2="{Y(1.0):.1f}" stroke="#999" stroke-dasharray="4"/>
<line x1="{pad}" y1="{Y(t_season):.1f}" x2="{svg_w-pad}" y2="{Y(t_season):.1f}" stroke="#c33" stroke-dasharray="6 3"/>
<text x="{svg_w-pad+4}" y="{Y(t_season)+4:.1f}" font-size="11" fill="#c33">season {t_season:.2f}</text>
<polyline points="{pts}" fill="none" stroke="#0a7" stroke-width="2"/>
{''.join(labels)}
<text x="{pad}" y="{svg_h-8}" font-size="11">window center date (chronological)</text>
</svg>'''
    with open(os.path.join(FG, "fullgame-reinforcer-temp-trajectory.svg"), "w") as f:
        f.write(svg)
    print(f"\nwrote trajectory CSV/SVG ({len(traj)} windows)")


if __name__ == "__main__":
    main()
