#!/usr/bin/env python3
"""fullgame-reinforcer-walkforward.py — walk-forward comparison of calibration
structures for the fullgame market, on the full replay population (1555 finals).

Every variant is fitted ONLY on games strictly earlier than the game being
scored (expanding monthly, expanding daily, or trailing-window daily), so every
number is deployable walk-forward. Evaluation window: 2026-05-01..2026-07-24
(the post-seed months; March-April are the protocol's seed period).

TOTALS variants (projTotal + pOver recentered with the p2 formula):
  T0  stored p2 (global env mult, monthly expanding refit)      [baseline]
  T1a/b/c  T0 x park ratio shrunk (n0=20/40/60)
  T2  T0 x day/night ratio
  T3  daily expanding global env mult (p2d-style)
  T4  daily trailing-300-game global env mult
  T5  T4 x park ratio shrunk (n0=40)
  TO  oracle same-month global mult (NOT deployable, upper-bound reference)
ML variants (p_away):
  M0  stored p2 (expanding monthly T on as-built p1)            [baseline]
  M5  raw p1 (as-built +0.03 edge, T=1)
  M6  de-edged p1 (edge 0, T=1)  — remove the home edge, nothing else
  M7  de-edged + DB constant 0.0178 edge, T=1
  M1  expanding monthly T on de-edged p1
  M2  expanding monthly joint (T, edge) fit
  M3  trailing-200-game T on as-built p1, refit daily
  M4  trailing-400-game T on de-edged p1, refit daily
Outputs: fullgame-reinforcer-walkforward.csv (+ per-month breakdown csv),
stdout summary with paired-bootstrap 95% CIs vs the baselines.
"""
import csv
import math
import os

import numpy as np
from scipy.optimize import minimize_scalar, minimize
from scipy.stats import norm

AUDIT = "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/audit-worktree/docs/audits/mlb-model-audit-2026"
FG = os.path.join(AUDIT, "granular", "fullgame")
MASTER = os.path.join(FG, "fullgame-reinforcer-master.csv")
EPS = 1e-9
EDGE_BUILT = 0.03
EDGE_DB = 0.01781473
EVAL_START = "2026-05-01"
SEED_TOTAL_SD = 4.6  # only used if train < 30 (never hit in May-Jul)
rng = np.random.default_rng(20260725)


def logit(p):
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def nll_vec(p, y):
    p = np.clip(p, EPS, 1 - EPS)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def fit_T(p_away, y_away):
    lo = logit(p_away)

    def nll(t):
        return float(np.mean(nll_vec(1 / (1 + np.exp(-lo / t)), y_away)))

    return float(minimize_scalar(nll, bounds=(0.2, 5.0), method="bounded").x)


def fit_joint(p_home_raw, y_home):
    def nll(x):
        t, e = x
        if t <= 0.2 or t > 5.0:
            return 10.0
        p = 1 / (1 + np.exp(-logit(np.clip(p_home_raw + e, EPS, 1 - EPS)) / t))
        return float(np.mean(nll_vec(p, y_home)))

    r = minimize(nll, x0=[1.2, 0.0], method="Nelder-Mead")
    return float(r.x[0]), float(r.x[1])


def load():
    rows = []
    with open(MASTER) as f:
        for r in csv.DictReader(f):
            rows.append({
                "gameId": int(r["gameId"]), "date": r["gameDate"], "month": r["month"],
                "startET": float(r["startET"]) if r["startET"] else 19.0,
                "park": r["homeTeam"], "day": r["dayNight"] == "day",
                "act": float(r["totalActual"]),
                "line": float(r["lineOu"]) if r["lineOu"] else None,
                "p1T": float(r["p1_projTotal"]), "p2T": float(r["p2_projTotal"]),
                "p1over": float(r["p1_pOver"]), "p2over": float(r["p2_pOver"]),
                "p1away": float(r["p1_pAwayMl"]), "p2away": float(r["p2_pAwayMl"]),
                "homeWin": int(r["homeWin"]),
            })
    rows.sort(key=lambda r: (r["date"], r["startET"], r["gameId"]))
    return rows


def main():
    rows = load()
    N = len(rows)
    dates = [r["date"] for r in rows]
    months = [r["month"] for r in rows]
    act = np.array([r["act"] for r in rows])
    p1T = np.array([r["p1T"] for r in rows])
    p1over = np.array([r["p1over"] for r in rows])
    parks = [r["park"] for r in rows]
    is_day = np.array([r["day"] for r in rows])
    p1away = np.array([r["p1away"] for r in rows])
    y_home = np.array([r["homeWin"] for r in rows], float)
    y_away = 1 - y_home
    p1home = 1 - p1away
    p_home_de = np.clip(p1home - EDGE_BUILT, EPS, 1 - EPS)
    line = np.array([r["line"] if r["line"] is not None else np.nan for r in rows])

    ev = np.array([d >= EVAL_START for d in dates])
    n_ev = int(ev.sum())
    print(f"N={N}, eval games (>= {EVAL_START}) = {n_ev}")

    uniq_months = sorted(set(months))
    month_arr = np.array(months)
    date_arr = np.array(dates)

    # ---------------- TOTALS variants ----------------------------------------
    # helper: training mask for month-expanding / daily / trailing
    def env_stats(mask):
        """global mult + residual sd + per-park ratios + day/night ratios on mask."""
        pa, aa = p1T[mask], act[mask]
        mult = aa.sum() / pa.sum()
        sd = float(np.std(pa - aa, ddof=1)) if mask.sum() >= 30 else SEED_TOTAL_SD
        pk = {}
        for p in set(np.array(parks)[mask]):
            sel = mask & (np.array(parks) == p)
            pk[p] = (act[sel].sum() / (p1T[sel].sum() * mult), int(sel.sum()))
        dn = {}
        for lab, sel0 in (("day", is_day), ("night", ~is_day)):
            sel = mask & sel0
            dn[lab] = (act[sel].sum() / (p1T[sel].sum() * mult), int(sel.sum()))
        return mult, sd, pk, dn

    # per-month expanding stats (replicates p2)
    m_stats = {}
    for m in uniq_months:
        mask = month_arr < m
        if mask.sum() >= 30:
            m_stats[m] = env_stats(mask)
    # daily expanding + trailing
    uniq_dates = sorted(set(dates))
    d_exp, d_tr = {}, {}
    TRAIL = 300
    for d in uniq_dates:
        if d < EVAL_START:
            continue
        mask = date_arr < d
        idx = np.where(mask)[0]
        if len(idx) >= 30:
            d_exp[d] = env_stats(mask)
            tr_mask = np.zeros(N, bool)
            tr_mask[idx[-TRAIL:]] = True
            d_tr[d] = env_stats(tr_mask)

    def shrunk(ratio, n, n0):
        return 1 + (n / (n + n0)) * (ratio - 1)

    variants_T = {}

    def proj_variant(name, mult_fn):
        """mult_fn(i) -> (mult_i, sd_i); returns projTotal & pOver arrays on eval."""
        pj = np.full(N, np.nan)
        pv = np.full(N, np.nan)
        for i in range(N):
            if not ev[i]:
                continue
            m_i, sd_i = mult_fn(i)
            pj[i] = p1T[i] * m_i
            pv[i] = norm.cdf(norm.ppf(np.clip(p1over[i], 1e-6, 1 - 1e-6))
                             + (pj[i] - p1T[i]) / sd_i)
        variants_T[name] = (pj, pv)

    proj_variant("T0_monthly_global(stored-p2)",
                 lambda i: (m_stats[months[i]][0], m_stats[months[i]][1]))
    for n0, tag in ((20, "T1a"), (40, "T1b"), (60, "T1c")):
        def f(i, n0=n0):
            mult, sd, pk, _ = m_stats[months[i]]
            r, n = pk.get(parks[i], (1.0, 0))
            return mult * shrunk(r, n, n0), sd
        proj_variant(f"{tag}_monthly+park(n0={n0})", f)

    def f_dn(i):
        mult, sd, _, dn = m_stats[months[i]]
        r, n = dn["day" if is_day[i] else "night"]
        return mult * r, sd
    proj_variant("T2_monthly+daynight", f_dn)
    proj_variant("T3_daily_expanding", lambda i: (d_exp[dates[i]][0], d_exp[dates[i]][1]))
    proj_variant("T4_daily_trailing300", lambda i: (d_tr[dates[i]][0], d_tr[dates[i]][1]))

    def f_t5(i):
        mult, sd, pk, _ = d_tr[dates[i]]
        r, n = pk.get(parks[i], (1.0, 0))
        return mult * shrunk(r, n, 40), sd
    proj_variant("T5_trailing300+park(n0=40)", f_t5)

    # oracle same-month (leaky reference)
    o_stats = {}
    for m in uniq_months:
        mask = month_arr == m
        o_stats[m] = (act[mask].sum() / p1T[mask].sum(),
                      float(np.std(p1T[mask] - act[mask], ddof=1)))
    proj_variant("TO_oracle_same_month(leaky)", lambda i: o_stats[months[i]])

    # sanity: T0 reproduces stored p2 (small delta expected: the pipeline's fit
    # excluded a handful of not-yet-final games at its run time)
    p2T_arr = np.array([r["p2T"] for r in rows])
    p2over_arr = np.array([r["p2over"] for r in rows])
    t0 = variants_T["T0_monthly_global(stored-p2)"][0]
    print(f"sanity: max|T0 - stored p2 projTotal| on eval = "
          f"{np.nanmax(np.abs(t0[ev] - p2T_arr[ev])):.4f}")
    # exact stored-p2 series as its own row
    variants_T["T0s_storedp2_exact"] = (np.where(ev, p2T_arr, np.nan),
                                        np.where(ev, p2over_arr, np.nan))

    # metrics
    push = ev & (act == line)
    ou_ok = ev & ~np.isnan(line) & (act != line)
    y_over = (act > line)[ou_ok].astype(float)
    print(f"eval pushes excluded from Brier: {int(push.sum())}; "
          f"O/U scored n={int(ou_ok.sum())}")

    res_T = []
    base_ae = base_br = None
    for name, (pj, pv) in variants_T.items():
        r_ = act[ev] - pj[ev]
        ae = np.abs(r_)
        br = (pv[ou_ok] - y_over) ** 2
        ll = nll_vec(pv[ou_ok], y_over)
        row = {"family": "totals", "variant": name, "n": int(ev.sum()),
               "bias": round(float(r_.mean()), 4), "mae": round(float(ae.mean()), 4),
               "rmse": round(float(np.sqrt((r_ ** 2).mean())), 4),
               "brier": round(float(br.mean()), 6), "logloss": round(float(ll.mean()), 6)}
        if name == "T0_monthly_global(stored-p2)":
            base_ae, base_br = ae, br
            row["d_mae"] = row["d_brier"] = 0.0
            row["mae_ci"] = row["brier_ci"] = ""
        else:
            d_ae = ae - base_ae
            d_br = br - base_br
            bs_ae = np.array([rng.choice(d_ae, len(d_ae)).mean() for _ in range(2000)])
            bs_br = np.array([rng.choice(d_br, len(d_br)).mean() for _ in range(2000)])
            row["d_mae"] = round(float(d_ae.mean()), 4)
            row["d_brier"] = round(float(d_br.mean()), 6)
            row["mae_ci"] = f"[{np.percentile(bs_ae,2.5):+.4f},{np.percentile(bs_ae,97.5):+.4f}]"
            row["brier_ci"] = f"[{np.percentile(bs_br,2.5):+.6f},{np.percentile(bs_br,97.5):+.6f}]"
        res_T.append(row)
        print(f"  {name:<32} bias {row['bias']:+.3f}  MAE {row['mae']:.4f} "
              f"(d {row['d_mae']:+.4f} {row['mae_ci']})  Brier {row['brier']:.6f} "
              f"(d {row['d_brier']:+.6f} {row['brier_ci']})")

    # ---------------- ML variants -------------------------------------------
    print()
    variants_M = {}
    variants_M["M0_monthlyT_asbuilt(stored-p2)"] = None  # filled below
    # expanding monthly fits
    mT_asbuilt, mT_de, mJoint = {}, {}, {}
    for m in uniq_months:
        mask = month_arr < m
        if mask.sum() >= 100:
            mT_asbuilt[m] = fit_T(p1away[mask], y_away[mask])
            mT_de[m] = fit_T(1 - p_home_de[mask], y_away[mask])
            mJoint[m] = fit_joint(p_home_de[mask], y_home[mask])
    # trailing window T
    trT_asbuilt, trT_de = {}, {}
    for d in uniq_dates:
        if d < EVAL_START:
            continue
        idx = np.where(date_arr < d)[0]
        trT_asbuilt[d] = fit_T(p1away[idx[-200:]], y_away[idx[-200:]])
        trT_de[d] = fit_T(1 - p_home_de[idx[-400:]], y_away[idx[-400:]])

    def ph(name, fn):
        p = np.full(N, np.nan)
        for i in range(N):
            if ev[i]:
                p[i] = fn(i)
        variants_M[name] = p

    p2away_arr = np.array([r["p2away"] for r in rows])
    variants_M["M0_monthlyT_asbuilt(stored-p2)"] = np.where(ev, 1 - p2away_arr, np.nan)
    ph("M5_raw_p1_edge0.03", lambda i: p1home[i])
    ph("M6_deedged_noT", lambda i: p_home_de[i])
    ph("M7_deedged+dbEdge0.0178", lambda i: min(1 - EPS, p_home_de[i] + EDGE_DB))
    ph("M1_monthlyT_deedged", lambda i: 1 / (1 + math.exp(
        -math.log(p_home_de[i] / (1 - p_home_de[i])) / mT_de[months[i]])))

    def f_m2(i):
        t, e = mJoint[months[i]]
        p = min(1 - EPS, max(EPS, p_home_de[i] + e))
        return 1 / (1 + math.exp(-math.log(p / (1 - p)) / t))
    ph("M2_monthly_joint_T_edge", f_m2)
    ph("M3_trailing200T_asbuilt", lambda i: 1 / (1 + math.exp(
        -math.log(p1home[i] / (1 - p1home[i])) / trT_asbuilt[dates[i]])))
    ph("M4_trailing400T_deedged", lambda i: 1 / (1 + math.exp(
        -math.log(p_home_de[i] / (1 - p_home_de[i])) / trT_de[dates[i]])))

    res_M = []
    base_br_m = None
    yh_ev = y_home[ev]
    for name, p in variants_M.items():
        pe = p[ev]
        br = (pe - yh_ev) ** 2
        ll = nll_vec(pe, yh_ev)
        row = {"family": "ml", "variant": name, "n": n_ev,
               "bias": round(float(pe.mean() - yh_ev.mean()), 4),
               "mae": "", "rmse": "",
               "brier": round(float(br.mean()), 6), "logloss": round(float(ll.mean()), 6)}
        if name.startswith("M0"):
            base_br_m = br
            row["d_mae"] = ""
            row["d_brier"] = 0.0
            row["mae_ci"] = row["brier_ci"] = ""
        else:
            d_br = br - base_br_m
            bs = np.array([rng.choice(d_br, len(d_br)).mean() for _ in range(2000)])
            row["d_mae"] = ""
            row["d_brier"] = round(float(d_br.mean()), 6)
            row["brier_ci"] = f"[{np.percentile(bs,2.5):+.6f},{np.percentile(bs,97.5):+.6f}]"
            row["mae_ci"] = ""
        res_M.append(row)
        print(f"  {name:<32} calib {row['bias']:+.4f}  Brier {row['brier']:.6f} "
              f"(d {row['d_brier'] if row['d_brier'] != '' else 0:+.6f} {row['brier_ci']})  "
              f"logloss {row['logloss']:.6f}")

    # ---------------- outputs ------------------------------------------------
    cols = ["family", "variant", "n", "bias", "mae", "rmse", "brier", "logloss",
            "d_mae", "mae_ci", "d_brier", "brier_ci"]
    with open(os.path.join(FG, "fullgame-reinforcer-walkforward.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r_ in res_T + res_M:
            w.writerow(r_)

    # per-month breakdown of headline variants
    heads_T = ["T0_monthly_global(stored-p2)", "T3_daily_expanding",
               "T4_daily_trailing300", "T5_trailing300+park(n0=40)"]
    heads_M = ["M0_monthlyT_asbuilt(stored-p2)", "M6_deedged_noT",
               "M2_monthly_joint_T_edge", "M4_trailing400T_deedged"]
    with open(os.path.join(FG, "fullgame-reinforcer-walkforward-monthly.csv"), "w",
              newline="") as f:
        w = csv.writer(f)
        w.writerow(["family", "variant", "month", "n", "bias", "mae", "brier"])
        for m in ["2026-05", "2026-06", "2026-07"]:
            sel = ev & (month_arr == m)
            sel_ou = ou_ok & (month_arr == m)
            y_ov_m = (act > line)[sel_ou].astype(float)
            for name in heads_T:
                pj, pv = variants_T[name]
                w.writerow(["totals", name, m, int(sel.sum()),
                            f"{(act[sel]-pj[sel]).mean():+.4f}",
                            f"{np.abs(act[sel]-pj[sel]).mean():.4f}",
                            f"{((pv[sel_ou]-y_ov_m)**2).mean():.6f}"])
            for name in heads_M:
                p = variants_M[name]
                w.writerow(["ml", name, m, int(sel.sum()),
                            f"{(p[sel]-y_home[sel]).mean():+.4f}", "",
                            f"{((p[sel]-y_home[sel])**2).mean():.6f}"])
    print("\nwrote walkforward CSVs")


if __name__ == "__main__":
    main()
