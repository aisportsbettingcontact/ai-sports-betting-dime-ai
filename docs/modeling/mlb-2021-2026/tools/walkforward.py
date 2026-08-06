#!/usr/bin/env python3
"""H1: walk-forward harness — matrix assembly, iteration ladder, calibration, metrics,
per-game artifacts, verdicts. Frozen contract: WALK-FORWARD-CONFIG.yaml. Seeds=42.

Usage: walkforward.py assemble | run [--market M] | verdicts
Markets: fg_ml fg_rl fg_total f5_ml f5_rl f5_total nrfi
"""
import os, sys, json, subprocess, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")
from sklearn.linear_model import LogisticRegression, PoissonRegressor
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

RUN = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(RUN, "features"); P = os.path.join(RUN, "predictions")
np.random.seed(42)
FOLDS = [(2019, 2020, 2021), (2020, 2021, 2022), (2021, 2022, 2023),
         (2022, 2023, 2024), (2023, 2024, 2025), (2024, 2025, 2026)]  # (train_end, calib, score)
TRAIN_START = 2012  # tier-B depth; tier-D subsets applied via masks

def ledger(op, expected, actual, status, artifacts, rows=None, warn=None):
    ev = {"phase": "P4-walkforward", "operation": op, "purpose": "walk-forward execution",
          "command": "walkforward.py", "expected": expected, "actual": actual,
          "exit_status": status, "evidence": "VERIFIED", "artifacts": artifacts,
          "rows": rows or {}, "warnings": warn or [], "next": ""}
    subprocess.run([sys.executable, os.path.join(RUN, "ledger.py"), "append", json.dumps(ev)],
                   check=True, capture_output=True)

# ------------------------------------------------------------------ assembly
def assemble():
    spine = pd.read_csv(os.path.join(F, "spine.tsv"), sep="\t", low_memory=False, na_values=["\\N", ""])
    outc = pd.read_csv(os.path.join(F, "game_outcomes.tsv"), sep="\t", low_memory=False, na_values=["\\N", ""])
    m = pd.read_parquet(os.path.join(RUN, "matchups.parquet"))
    pa = pd.read_parquet(os.path.join(F, "pitcher_asof.parquet"))
    pi = pd.read_parquet(os.path.join(F, "pitcher_inn1_asof.parquet"))
    ba = pd.read_parquet(os.path.join(F, "batter_asof.parquet"))
    ta = pd.read_parquet(os.path.join(F, "team_asof.parquet"))
    pen = pd.read_parquet(os.path.join(F, "bullpen_asof.parquet"))
    pf = pd.read_parquet(os.path.join(F, "park_asof.parquet"))
    ua = pd.read_parquet(os.path.join(F, "ump_asof.parquet"))
    people = pd.read_csv(os.path.join(F, "people.tsv"), sep="\t", na_values=["\\N", ""]).set_index("mlbam_id")

    spine["date"] = pd.to_datetime(spine["official_date"])
    df = spine.merge(outc[["game_pk","final_away","final_home","f5_away","f5_home","inn1_runs","reached_5"]],
                     on="game_pk", how="inner")
    df = df.merge(m.drop(columns=["season","official_date","home_team_id","away_team_id"]), on="game_pk", how="left")

    # pitcher state as-of via merge_asof on the pitcher's own appearance dates
    date_of = spine.set_index("game_pk")["date"]
    pa["date"] = pa["game_pk"].map(date_of); pa = pa.dropna(subset=["date"]).sort_values("date")
    pi["date"] = pi["game_pk"].map(date_of); pi = pi.dropna(subset=["date"]).sort_values("date")
    pstate = pa.merge(pi[["game_pk","pitcher_id","p_inn1_scored_rate_20"]].rename(columns={"pitcher_id":"mlbam_id"}),
                      on=["game_pk","mlbam_id"], how="left")
    pcols = [c for c in pstate.columns if c.startswith("p_")]
    pstate["mlbam_id"] = pd.to_numeric(pstate["mlbam_id"], errors="coerce").astype("float64")
    pstate["date"] = pd.to_datetime(pstate["date"])
    pright = pstate[["date","mlbam_id"] + pcols].dropna(subset=["mlbam_id"]).sort_values("date")
    def attach_pitcher(df, id_col, prefix):
        left = df[["game_pk","date",id_col]].rename(columns={id_col: "mlbam_id"}).copy()
        left["mlbam_id"] = pd.to_numeric(left["mlbam_id"], errors="coerce").astype("float64")
        left["date"] = pd.to_datetime(left["date"])
        ok = left.dropna(subset=["mlbam_id"]).sort_values("date")
        got = pd.merge_asof(ok, pright, on="date", by="mlbam_id", allow_exact_matches=True)
        got = got.set_index("game_pk")[pcols].add_prefix(prefix)
        return df.merge(got, left_on="game_pk", right_index=True, how="left")
    for idc, pre in [("home_starter_expected","hs_"), ("away_starter_expected","as_"),
                     ("home_starter_actual","hso_"), ("away_starter_actual","aso_")]:
        df = attach_pitcher(df, idc, pre)
    for idc, pre in [("home_starter_expected","hs_"), ("away_starter_expected","as_")]:
        hand = df[idc].map(people["pitch_hand"]) if idc in df else None
        df[pre + "hand_L"] = (hand == "L").astype(float)

    # lineup aggregate: pool-weighted batter as-of rates
    ba["date"] = ba["game_pk"].map(date_of); ba = ba.dropna(subset=["date"]).sort_values(["mlbam_id","date"])
    bcols = ["b_so_10","b_so_40","b_bb_40","b_hr_162","b_h_40","b_hardhit_40","b_whiffs_40","b_ooz_swings_40","b_launch_40"]
    bcols = [c for c in bcols if c in ba.columns]
    blast = ba.groupby("mlbam_id").apply(lambda g: g.set_index("date")[bcols], include_groups=False)
    def lineup_agg(pool_json, d):
        if not isinstance(pool_json, str): return None
        pool = json.loads(pool_json)
        vals, wts = [], []
        for pid, (n, slot) in pool.items():
            try: series = blast.loc[int(pid)]
            except KeyError: continue
            prior = series[series.index < d]
            if not len(prior): continue
            w = n * (1.0 / (1.0 + 0.15 * max(slot - 1, 0)))
            vals.append(prior.iloc[-1].values.astype(float)); wts.append(w)
        if not vals: return None
        V = np.vstack(vals); W = np.array(wts)
        with np.errstate(invalid="ignore"):
            return np.nansum(V * W[:, None], axis=0) / np.nansum((~np.isnan(V)) * W[:, None], axis=0)
    for side, poolc in [("h","home_pool"), ("a","away_pool")]:
        agg = [lineup_agg(r[poolc], r["date"]) for _, r in df[[poolc,"date"]].iterrows()]
        A = np.vstack([x if x is not None else [np.nan]*len(bcols) for x in agg])
        for j, c in enumerate(bcols): df[f"{side}l_{c}"] = A[:, j]

    # team / pen / park / ump / context
    for side, tc in [("h","home_team_id"), ("a","away_team_id")]:
        df = df.merge(ta.rename(columns={"team":tc}).add_prefix(f"{side}t_").rename(
            columns={f"{side}t_game_pk":"game_pk", f"{side}t_{tc}":tc}), on=["game_pk",tc], how="left")
        pside = pen.rename(columns={"team_id":tc})
        pside["date"] = pd.to_datetime(pside["official_date"])
        left = df[["game_pk","date",tc]].sort_values("date")
        got = pd.merge_asof(left, pside[["date",tc,"pen_outs_prev3","pen_era_30","pen_k_30"]].sort_values("date"),
                            on="date", by=tc).set_index("game_pk")[["pen_outs_prev3","pen_era_30","pen_k_30"]].add_prefix(f"{side}p_")
        df = df.merge(got, left_on="game_pk", right_index=True, how="left")
    df = df.merge(pf.rename(columns={"asof_season":"season"}), on=["season","venue_id"], how="left")
    df = df.merge(ua.rename(columns={"mlbam_id":"ump_id"}), on="game_pk", how="left")
    df["is_night"] = (df["day_night"] == "night").astype(float)
    df["temp"] = df["temp_f"].where(df["temp_f"] > 0)
    df["is_postseason"] = (~df["game_type"].isin(["R"])).astype(float)

    # interactions (iteration-4 family)
    df["x_whiff_edge"] = (df["hs_p_whiffs_10_"] if "hs_p_whiffs_10_" in df else df.get("hs_p_whiffs_10", np.nan))
    for side, s_pre, l_pre in [("h","hs_","al_"), ("a","as_","hl_")]:
        wf = f"{s_pre}p_whiffs_10"; lw = f"{l_pre}b_whiffs_40"
        if wf in df and lw in df: df[f"x_{side}_whiff"] = df[wf] * df[lw]
        cf = f"{s_pre}p_zone_pitches_10"; lc = f"{l_pre}b_ooz_swings_40"
        if cf in df and lc in df: df[f"x_{side}_chase"] = (1 - df[cf]) * df[lc]
        hh = f"{s_pre}p_inplay_hardhit_10"; lh = f"{l_pre}b_hardhit_40"
        if hh in df and lh in df: df[f"x_{side}_hard"] = df[hh] * df[lh]

    # outcomes + exclusions
    df["y_home_win"] = (df["final_home"] > df["final_away"]).astype(int)
    df["margin"] = df["final_home"] - df["final_away"]
    df["total"] = df["final_home"] + df["final_away"]
    df["f5_margin"] = df["f5_home"] - df["f5_away"]
    df["f5_total"] = df["f5_home"] + df["f5_away"]
    df["y_nrfi"] = (df["inn1_runs"] == 0).astype(int)
    excl = []
    excl.append(pd.DataFrame({"game_pk": df.loc[df["margin"] == 0, "game_pk"], "market": "fg_ml", "reason": "tie_game"}))
    short = df["innings"] < 5
    for mk in ["f5_ml","f5_rl","f5_total","nrfi"]:
        excl.append(pd.DataFrame({"game_pk": df.loc[short, "game_pk"], "market": mk, "reason": "under_5_innings"}))
    pd.concat(excl).to_csv(os.path.join(RUN, "exclusion-ledger.csv"), index=False)

    df.to_parquet(os.path.join(RUN, "matrix.parquet"))
    ledger("assemble-matrix", "per-game feature matrix", f"{len(df)} games x {df.shape[1]} cols",
           "PASS", ["matrix.parquet","exclusion-ledger.csv"], rows={"games": int(len(df)), "cols": int(df.shape[1])})
    print(f"[matrix] {len(df)} games x {df.shape[1]} cols")

# ------------------------------------------------------------------ metrics
def _ll(y, p): p = np.clip(p, 1e-6, 1 - 1e-6); return float(-np.mean(y*np.log(p) + (1-y)*np.log(1-p)))
def _brier(y, p): return float(np.mean((p - y) ** 2))
def _ece(y, p, bins=10):
    idx = np.minimum((p * bins).astype(int), bins - 1); e = 0.0
    for b in range(bins):
        m = idx == b
        if m.sum() >= 20: e += m.mean() * abs(p[m].mean() - y[m].mean())
    return float(e)
def _slope_intercept(y, p):
    z = np.log(np.clip(p,1e-6,1-1e-6)/np.clip(1-p,1e-6,1-1e-6))
    lr = LogisticRegression(C=1e6).fit(z.reshape(-1,1), y)
    return float(lr.coef_[0][0]), float(lr.intercept_[0])
def _auc(y, p):
    from sklearn.metrics import roc_auc_score
    return float(roc_auc_score(y, p)) if len(set(y)) > 1 else np.nan
def boot_delta_ll(y, p1, p0, dates, B=400):
    rng = np.random.default_rng(42); ud = np.unique(dates); out = []
    l1 = -(y*np.log(np.clip(p1,1e-6,1)) + (1-y)*np.log(np.clip(1-p1,1e-6,1)))
    l0 = -(y*np.log(np.clip(p0,1e-6,1)) + (1-y)*np.log(np.clip(1-p0,1e-6,1)))
    dser = pd.Series(l0 - l1); dgrp = dser.groupby(pd.Series(dates)).mean()
    for _ in range(B):
        samp = rng.choice(dgrp.values, size=len(dgrp), replace=True); out.append(samp.mean())
    return float(np.mean(out)), float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))
def crps_pmf(pmf_grid, values, y):
    """CRPS from discrete pmf over integer support."""
    cdf = np.cumsum(pmf_grid, axis=1)
    Y = (values[None, :] >= y[:, None]).astype(float)
    return float(np.mean(np.sum((cdf - Y) ** 2, axis=1)))

# ------------------------------------------------------------------ ladder
FAMS = {
    1: ["is_night","hs_hand_L","as_hand_L","game_number"],
    2: "starter", 3: "lineup", 4: "interact", 5: "pen", 6: "context7",
}
def family_cols(df, fam):
    if fam == "starter": return [c for c in df.columns if c.startswith(("hs_","as_")) and df[c].dtype != object]
    if fam == "lineup": return [c for c in df.columns if c.startswith(("hl_","al_"))]
    if fam == "interact": return [c for c in df.columns if c.startswith("x_")]
    if fam == "pen": return [c for c in df.columns if c.startswith(("hp_","ap_"))]
    if fam == "context7": return [c for c in ["park_run_idx","u_kshare_60","ht_t_rpg_15","ht_t_rpg_75","at_t_rpg_15","at_t_rpg_75","ht_t_rest","at_t_rest","temp"] if c in df.columns]
    return fam

def run_market(market):
    df = pd.read_parquet(os.path.join(RUN, "matrix.parquet"))
    df = df[df["game_type"] == "R"].copy()
    # Contract clarification (ledgered pre-scoring): 2020-21 doubleheader games were scheduled
    # 7 innings — excluded from full-game distribution/handicap markets (kept for F5/NRFI,
    # where innings 1-5 are unaffected, and for fg_ml where a win is a win).
    seven = (df["season"].isin([2020, 2021])) & (df["double_header"] != "N")
    if market in ("fg_total", "fg_rl"):
        df = df[~seven]
    df["date_key"] = df["date"].astype(str)
    ycol = {"fg_ml":"y_home_win","nrfi":"y_nrfi"}.get(market)
    if market == "fg_rl": df["y"] = (df["margin"] >= 2).astype(int); ycol = "y"; df = df[df["margin"] != 0]
    elif market == "f5_ml": df["y"] = (df["f5_margin"] > 0).astype(int); ycol = "y"; df = df[(df["innings"] >= 5) & (df["f5_margin"] != 0)]
    elif market == "f5_rl": df["y"] = (df["f5_margin"] >= 1).astype(int); ycol = "y"; df = df[df["innings"] >= 5]
    elif market == "fg_total": ycol = "total"
    elif market == "f5_total": ycol = "f5_total"; df = df[df["innings"] >= 5]
    elif market == "nrfi": df = df[df["innings"] >= 5]
    elif market == "fg_ml": df = df[df["margin"] != 0]
    df = df.dropna(subset=[ycol])
    is_dist = market in ("fg_total","f5_total")

    results, preds_out = [], []
    cum_cols = list(FAMS[1])
    ladders = [(1, FAMS[1])] + [(i, family_cols(df, FAMS[i])) for i in range(2, 7)]
    lad_cum = []
    acc = []
    for it, cols in ladders:
        acc = acc + [c for c in cols if c in df.columns]
        lad_cum.append((it, list(dict.fromkeys(acc))))

    for (tr_end, cal, sc) in FOLDS:
        tr = df[(df["season"] >= TRAIN_START) & (df["season"] <= tr_end)]
        ca = df[df["season"] == cal]; te = df[df["season"] == sc]
        if not len(te): continue
        base_p = None
        for it, cols in lad_cum:
            cols = [c for c in cols if df[c].notna().mean() > 0.30]
            Xtr = tr[cols].astype(float); Xca = ca[cols].astype(float); Xte = te[cols].astype(float)
            med = Xtr.median()
            Xtr, Xca, Xte = Xtr.fillna(med), Xca.fillna(med), Xte.fillna(med)
            if not is_dist:
                ytr, yca, yte = tr[ycol].values, ca[ycol].values, te[ycol].values
                lr = LogisticRegression(C=1.0, max_iter=2000, random_state=42).fit(Xtr, ytr)
                gb = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, max_depth=4,
                                                    random_state=42).fit(Xtr, ytr)
                p_lr, p_gb = lr.predict_proba(Xte)[:,1], gb.predict_proba(Xte)[:,1]
                pca_lr, pca_gb = lr.predict_proba(Xca)[:,1], gb.predict_proba(Xca)[:,1]
                pick = "lr" if _ll(yca, pca_lr) <= _ll(yca, pca_gb) else "gb"
                p_raw = p_lr if pick == "lr" else p_gb
                pca = pca_lr if pick == "lr" else pca_gb
                iso = IsotonicRegression(out_of_bounds="clip").fit(pca, yca)
                p_cal = np.clip(iso.predict(p_raw), 1e-4, 1-1e-4)
                if it == 1 and base_p is None: base_p = p_cal.copy()
                sl, ic = _slope_intercept(yte, p_cal)
                d, lo, hi = boot_delta_ll(yte, p_cal, base_p, te["date_key"].values)
                row = {"market": market, "fold": sc, "iteration": it, "model": pick, "n": len(te),
                       "logloss": _ll(yte, p_cal), "brier": _brier(yte, p_cal), "auc": _auc(yte, p_cal),
                       "ece": _ece(yte, p_cal), "cal_slope": sl, "cal_intercept": ic,
                       "dll_vs_baseline": d, "dll_lo": lo, "dll_hi": hi, "features": len(cols)}
                if it == max(x[0] for x in lad_cum):
                    for gpk, dt, y_, p_ in zip(te["game_pk"], te["date_key"], yte, p_cal):
                        preds_out.append({"game_pk": int(gpk), "date": dt, "market": market, "fold": sc,
                                          "p": round(float(p_),5), "y": int(y_), "series": "deployable"})
            else:
                ytr, yca, yte = tr[ycol].values, ca[ycol].values, te[ycol].values
                # per-side Poisson GLM -> NB sim of totals
                halves = []
                for tgt, pre_own, pre_opp in [("final_home","h","a"), ("final_away","a","h")] if market == "fg_total" else [("f5_home","h","a"), ("f5_away","a","h")]:
                    pr = PoissonRegressor(alpha=1.0, max_iter=500).fit(Xtr, tr[tgt].values)
                    halves.append((pr.predict(Xte), pr.predict(Xca), pr.predict(Xtr), tr[tgt].values))
                disp_resid = np.concatenate([(h[3] - h[2]) for h in halves])
                mu_all = np.concatenate([h[2] for h in halves])
                var_ratio = max(1.05, float(np.var(disp_resid) / np.mean(mu_all)))
                rng = np.random.default_rng(42); NS = 4000
                mu_te = halves[0][0] + halves[1][0]
                grid = np.arange(0, 31)
                pmf = np.zeros((len(te), len(grid)))
                for i in range(len(te)):
                    lam = max(mu_te[i], 0.1); r = lam / (var_ratio - 1)
                    draws = rng.negative_binomial(r, r / (r + lam), NS)
                    cnt = np.bincount(np.clip(draws, 0, 30), minlength=31)
                    pmf[i] = cnt / NS
                crps = crps_pmf(pmf, grid, yte.astype(int))
                if it == 1 and base_p is None: base_p = pmf.copy()
                row = {"market": market, "fold": sc, "iteration": it, "model": "pois-nb-sim", "n": len(te),
                       "crps": crps, "mae": float(np.mean(np.abs(mu_te - yte))),
                       "bias": float(np.mean(mu_te - yte)), "var_ratio": var_ratio, "features": len(cols)}
                if it == max(x[0] for x in lad_cum):
                    for gpk, dt, y_, mu_ in zip(te["game_pk"], te["date_key"], yte, mu_te):
                        preds_out.append({"game_pk": int(gpk), "date": dt, "market": market, "fold": sc,
                                          "mu": round(float(mu_),3), "y": int(y_), "series": "deployable"})
            results.append(row)
            print(f"[{market}] fold {sc} it{it}: " + json.dumps({k: (round(v,5) if isinstance(v,float) else v) for k,v in row.items() if k not in ('market','fold','iteration')}))
    res = pd.DataFrame(results)
    res.to_csv(os.path.join(RUN, f"results_{market}.csv"), index=False)
    with open(os.path.join(P, f"predictions_{market}.jsonl"), "w") as f:
        for r in preds_out: f.write(json.dumps(r) + "\n")
    ledger(f"walkforward-{market}", "iteration ladder across 6 folds",
           f"{len(res)} result rows; final-iteration predictions persisted",
           "PASS", [f"results_{market}.csv", f"predictions/predictions_{market}.jsonl"],
           rows={"result_rows": int(len(res)), "predictions": len(preds_out)})

if __name__ == "__main__":
    os.makedirs(P, exist_ok=True)
    if sys.argv[1] == "assemble": assemble()
    elif sys.argv[1] == "run": run_market(sys.argv[2])
