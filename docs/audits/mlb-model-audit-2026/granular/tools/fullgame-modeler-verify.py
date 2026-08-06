#!/usr/bin/env python3
"""fullgame MODELER — full-population verification of the replay projections.

Inputs: the read-only DB snapshot produced by fullgame-modeler-extract.sh
(TSV, \\N = NULL) plus census/game-universe.csv. No DB writes, no DB reads.

Checks (every one over the ENTIRE 1,555-game pk-final population):
  A. population identity: p1 gameIds == p2 gameIds == census pk finals
  B. p1 internal consistency: pAwayMl/pOver/pAwayRl in (0,1);
     |projAwayScore+projHomeScore-projTotal| <= 0.02  (+ supplementary F5/NRFI ranges)
  C. p2 == documented transform of p1 under the row's own calibMeta params
     (temperature on ML, env-mult on scores/totals, Normal recenter on pOver/pF5Over,
      RL passthrough, NRFI passthrough where prior-only), tolerance 1e-3 per field
  D. calibMeta integrity: month == month(gameDate); identical across a month;
     seed months carry the documented seed constants; fitted_on_months strictly < month;
     p1_version correct; asOfCutoffMs(p2) == asOfCutoffMs(p1)
  E. fitted-table re-derivation: refit league_env_mult, T_fg, T_f5, total_sd,
     f5_total_sd, k_factor (DB-only actuals) per month with the protocol's exact
     estimators and compare to stored calibMeta (hr_factor refit is coverage-limited
     DB-only; reported with its n for transparency, not as a defect gate)
  F. live vs p1 vs p2 projTotal / pAwayMl distributions by month + pairwise deltas

The transform / estimator code below is a line-faithful port of
tools/replay/calibrate_and_grade.py (temperature_scale, recenter_over_prob,
fit_temperature, _fit_on) — same EPS, same clamps, same scipy calls.
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
from scipy.optimize import minimize_scalar
from scipy.stats import norm

SNAP = sys.argv[1]
OUT = sys.argv[2]
AUDIT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CENSUS_CSV = os.path.join(os.path.dirname(AUDIT), "census", "game-universe.csv")

P1V, P2V = "wf-19288f01-p1", "wf-19288f01-p2"
SEED_MONTHS = {"2026-03", "2026-04"}
SEED_TOTAL_SD, SEED_F5_TOTAL_SD = 4.5, 2.9
EPS = 1e-6
TOL = 1e-3          # task tolerance, per field
ADD_TOL = 0.02      # additivity tolerance (task spec)

os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- exact ports
def clamp_p(p):
    return min(1.0 - EPS, max(EPS, p))


def logit(p):
    p = clamp_p(p)
    return math.log(p / (1.0 - p))


def sigmoid(x):
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def temperature_scale(p, t):
    if p is None:
        return None
    if not t or abs(t - 1.0) < 1e-9:
        return p
    return sigmoid(logit(p) / t)


def recenter_over_prob(p_over1, proj1, proj2, sd):
    if p_over1 is None:
        return None
    if proj1 is None or proj2 is None or sd is None or sd <= 0:
        return p_over1
    z1 = norm.ppf(clamp_p(p_over1))
    return float(norm.cdf(z1 + (proj2 - proj1) / sd))


def fit_temperature(pairs):
    if len(pairs) < 20:
        return 1.0, len(pairs)
    logits = np.array([logit(p) for p, _ in pairs])
    ys = np.array([y for _, y in pairs], dtype=float)

    def nll(t):
        z = logits / t
        p = 1.0 / (1.0 + np.exp(-z))
        p = np.clip(p, EPS, 1 - EPS)
        return float(-np.mean(ys * np.log(p) + (1 - ys) * np.log(1 - p)))

    res = minimize_scalar(nll, bounds=(0.2, 5.0), method="bounded")
    return float(res.x), len(pairs)


# ---------------------------------------------------------------- TSV loading
def load_tsv(name):
    path = os.path.join(SNAP, name)
    with open(path) as f:
        header = f.readline().rstrip("\n").split("\t")
        rows = []
        for line in f:
            parts = line.rstrip("\n").split("\t")
            rows.append({h: (None if v == "\\N" else v) for h, v in zip(header, parts)})
    return rows


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def month_of(d):
    return str(d)[:7]


# census: population definition
census = {}
with open(CENSUS_CSV) as f:
    rd = csv.DictReader(f)
    for r in rd:
        if r["gamesId"]:
            census[int(r["gamesId"])] = r

pk_finals = {gid for gid, r in census.items()
             if r["schedStatus"] == "complete" and r["mlbGamePk"]}
all_finals = {gid for gid, r in census.items() if r["schedStatus"] == "complete"}

replay = load_tsv("replay-games.tsv")
games_rows = load_tsv("games.tsv")
linescores = {int(r["gameId"]): r for r in load_tsv("linescores.tsv") if r["gameId"]}
p1_props = load_tsv("replay-props-p1.tsv")
live_k_rows = load_tsv("live-kprops.tsv")
live_hr_rows = load_tsv("live-hrprops.tsv")

games = {int(r["id"]): r for r in games_rows}
p1 = {int(r["gameId"]): r for r in replay if r["modelVersion"] == P1V}
p2 = {int(r["gameId"]): r for r in replay if r["modelVersion"] == P2V}

report = {}  # section -> lines, assembled at the end by the .md writer


# ---------------------------------------------------------------- A. population
pop = {
    "census_finals": len(all_finals),
    "census_pk_finals": len(pk_finals),
    "p1_rows": len(p1),
    "p2_rows": len(p2),
    "p1_minus_pop": sorted(set(p1) - pk_finals),
    "pop_minus_p1": sorted(pk_finals - set(p1)),
    "p2_minus_p1": sorted(set(p2) - set(p1)),
    "p1_minus_p2": sorted(set(p1) - set(p2)),
    "dup_p1_gameIds": len([r for r in replay if r["modelVersion"] == P1V]) - len(p1),
    "dup_p2_gameIds": len([r for r in replay if r["modelVersion"] == P2V]) - len(p2),
}

# ---------------------------------------------------------------- B. p1 consistency
b_rows, b_viol = [], []
for gid in sorted(p1):
    r = p1[gid]
    m = month_of(r["gameDate"])
    pa, po, prl = num(r["pAwayMl"]), num(r["pOver"]), num(r["pAwayRl"])
    pas, phs, pt = num(r["projAwayScore"]), num(r["projHomeScore"]), num(r["projTotal"])
    add_diff = (abs(pas + phs - pt) if None not in (pas, phs, pt) else None)
    checks = {
        "pAwayMl_in01": pa is not None and 0.0 < pa < 1.0,
        "pOver_in01": po is not None and 0.0 < po < 1.0,
        "pAwayRl_in01": prl is not None and 0.0 < prl < 1.0,
        "additivity": add_diff is not None and add_diff <= ADD_TOL,
        # supplementary (other markets' fields on the same row)
        "pF5AwayMl_in01": (lambda v: v is not None and 0 < v < 1)(num(r["pF5AwayMl"])),
        "pF5Over_in01": (lambda v: v is not None and 0 < v < 1)(num(r["pF5Over"])),
        "pF5AwayRl_in01": (lambda v: v is not None and 0 < v < 1)(num(r["pF5AwayRl"])),
        "pNrfi_in01": (lambda v: v is not None and 0 < v < 1)(num(r["pNrfi"])),
    }
    core_fail = [k for k in ("pAwayMl_in01", "pOver_in01", "pAwayRl_in01", "additivity")
                 if not checks[k]]
    supp_fail = [k for k in checks if k not in
                 ("pAwayMl_in01", "pOver_in01", "pAwayRl_in01", "additivity")
                 and not checks[k]]
    b_rows.append({
        "gameId": gid, "gameDate": r["gameDate"], "month": m,
        "pAwayMl": r["pAwayMl"], "pOver": r["pOver"], "pAwayRl": r["pAwayRl"],
        "projAwayScore": r["projAwayScore"], "projHomeScore": r["projHomeScore"],
        "projTotal": r["projTotal"],
        "additivity_abs_diff": f"{add_diff:.6f}" if add_diff is not None else "",
        "core_violations": ";".join(core_fail), "supp_violations": ";".join(supp_fail),
    })
    if core_fail:
        b_viol.append(b_rows[-1])

with open(os.path.join(OUT, "fullgame-modeler-p1-consistency.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(b_rows[0].keys()))
    w.writeheader()
    w.writerows(b_rows)

# ---------------------------------------------------------------- D. calibMeta integrity
meta_by_gid = {}
meta_issues = []
metas_by_month = defaultdict(set)
for gid in sorted(p2):
    r = p2[gid]
    m = month_of(r["gameDate"])
    try:
        meta = json.loads(r["calibMeta"]) if r["calibMeta"] else None
    except json.JSONDecodeError:
        meta = None
    meta_by_gid[gid] = meta
    if meta is None:
        meta_issues.append((gid, m, "calibMeta missing/unparseable"))
        continue
    metas_by_month[m].add(json.dumps(meta, sort_keys=True))
    if meta.get("month") != m:
        meta_issues.append((gid, m, f"meta.month={meta.get('month')} != gameDate month"))
    if meta.get("p1_version") != P1V:
        meta_issues.append((gid, m, f"p1_version={meta.get('p1_version')}"))
    fom = meta.get("fitted_on_months", [])
    if any(mm >= m for mm in fom):
        meta_issues.append((gid, m, f"fitted_on_months not strictly earlier: {fom}"))
    if m in SEED_MONTHS:
        seed_ok = (meta.get("seed") is True and meta.get("league_env_mult") == 1.0
                   and meta.get("T_fg") == 1.0 and meta.get("T_f5") == 1.0
                   and meta.get("total_sd") == SEED_TOTAL_SD
                   and meta.get("f5_total_sd") == SEED_F5_TOTAL_SD
                   and meta.get("nrfi", {}).get("mode") == "prior_only_passthrough")
        if not seed_ok:
            meta_issues.append((gid, m, "seed month params != documented seed constants"))
    else:
        if meta.get("seed") is not False:
            meta_issues.append((gid, m, "non-seed month flagged seed"))
    if p1.get(gid) and r["asOfCutoffMs"] != p1[gid]["asOfCutoffMs"]:
        meta_issues.append((gid, m, "asOfCutoffMs differs from p1"))
    if r["provenance"] != "walkforward_replay" or p1[gid]["provenance"] != "walkforward_replay":
        meta_issues.append((gid, m, "provenance != walkforward_replay"))

month_meta_uniform = {m: len(s) for m, s in sorted(metas_by_month.items())}

# ---------------------------------------------------------------- C. p2 transform check
c_rows, c_viol = [], []
nrfi_logistic_n = 0
nrfi_logistic_eq_p1 = 0
for gid in sorted(p1):
    if gid not in p2 or meta_by_gid.get(gid) is None:
        continue
    r1, r2, cp = p1[gid], p2[gid], meta_by_gid[gid]
    m = month_of(r1["gameDate"])
    mult, sd, f5sd = cp["league_env_mult"], cp["total_sd"], cp["f5_total_sd"]
    t_fg, t_f5 = cp["T_fg"], cp["T_f5"]

    pt1 = num(r1["projTotal"])
    pt2_exp = pt1 * mult if pt1 is not None else None
    pf1 = num(r1["projF5Total"])
    pf2_exp = pf1 * mult if pf1 is not None else None

    expected = {
        "pAwayMl": temperature_scale(num(r1["pAwayMl"]), t_fg),
        "projAwayScore": (num(r1["projAwayScore"]) * mult
                          if num(r1["projAwayScore"]) is not None else None),
        "projHomeScore": (num(r1["projHomeScore"]) * mult
                          if num(r1["projHomeScore"]) is not None else None),
        "projTotal": pt2_exp,
        "pOver": recenter_over_prob(num(r1["pOver"]), pt1, pt2_exp, sd),
        "pAwayRl": num(r1["pAwayRl"]),
        "pF5AwayMl": temperature_scale(num(r1["pF5AwayMl"]), t_f5),
        "projF5Total": pf2_exp,
        "pF5Over": recenter_over_prob(num(r1["pF5Over"]), pf1, pf2_exp, f5sd),
        "pF5AwayRl": num(r1["pF5AwayRl"]),
    }
    row = {"gameId": gid, "gameDate": r1["gameDate"], "month": m}
    fails = []
    max_diff = 0.0
    for field, exp in expected.items():
        got = num(r2[field])
        if exp is None and got is None:
            row[f"d_{field}"] = ""
            continue
        if (exp is None) != (got is None):
            fails.append(f"{field}:null-mismatch")
            row[f"d_{field}"] = "NULLMISM"
            continue
        d = abs(got - exp)
        row[f"d_{field}"] = f"{d:.2e}"
        max_diff = max(max_diff, d)
        if d > TOL:
            fails.append(f"{field}:{d:.5f}")

    # NRFI: passthrough verifiable; logistic re-derivation needs the feature store
    nmode = (cp.get("nrfi") or {}).get("mode")
    pn1, pn2 = num(r1["pNrfi"]), num(r2["pNrfi"])
    if nmode == "prior_only_passthrough":
        if (pn1 is None) != (pn2 is None):
            fails.append("pNrfi:null-mismatch")
            row["d_pNrfi"] = "NULLMISM"
        elif pn1 is not None:
            d = abs(pn2 - pn1)
            row["d_pNrfi"] = f"{d:.2e}"
            if d > TOL:
                fails.append(f"pNrfi:{d:.5f}")
        else:
            row["d_pNrfi"] = ""
    else:
        nrfi_logistic_n += 1
        row["d_pNrfi"] = "logistic"
        if pn2 is not None and not (0.0 < pn2 < 1.0):
            fails.append("pNrfi:logistic-out-of-range")
        if pn1 is not None and pn2 is not None and abs(pn2 - pn1) <= 1e-5:
            nrfi_logistic_eq_p1 += 1

    row["nrfi_mode"] = nmode or ""
    row["max_abs_diff"] = f"{max_diff:.2e}"
    row["violations"] = ";".join(fails)
    c_rows.append(row)
    if fails:
        c_viol.append(row)

with open(os.path.join(OUT, "fullgame-modeler-p2-transform-check.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(c_rows[0].keys()))
    w.writeheader()
    w.writerows(c_rows)

# ---------------------------------------------------------------- E. refit fitted table
def is_final(gid):
    c = census.get(gid)
    if c and c["schedStatus"]:
        return c["schedStatus"] == "complete"
    g = games.get(gid)
    return bool(g and g["gameStatus"] == "final")


def actual_scores(gid):
    g = games.get(gid)
    if g and g["actualAwayScore"] is not None and g["actualHomeScore"] is not None:
        return num(g["actualAwayScore"]), num(g["actualHomeScore"])
    c = census.get(gid)
    if c and c["schedAway"] not in (None, ""):
        return num(c["schedAway"]), num(c["schedHome"])
    ls = linescores.get(gid)
    if ls and ls["awayFinalRuns"] is not None:
        return num(ls["awayFinalRuns"]), num(ls["homeFinalRuns"])
    return None, None


def actual_f5(gid):
    g = games.get(gid)
    if g and g["actualF5AwayScore"] is not None and g["actualF5HomeScore"] is not None:
        return num(g["actualF5AwayScore"]), num(g["actualF5HomeScore"])
    ls = linescores.get(gid)
    if ls and ls["f5AwayRuns"] is not None and ls["f5HomeRuns"] is not None:
        return num(ls["f5AwayRuns"]), num(ls["f5HomeRuns"])
    return None, None


live_k = {}
for r in live_k_rows:
    if r["gameId"] and r["mlbamId"]:
        live_k[(int(r["gameId"]), int(r["mlbamId"]))] = r

hr_idx = {}
for r in live_hr_rows:
    if r["actualHr"] is None or not r["gameId"]:
        continue
    y = 1 if num(r["actualHr"]) >= 1 else 0
    gid = int(r["gameId"])
    if r["mlbamId"]:
        hr_idx[(gid, int(r["mlbamId"]))] = y
    if r["playerName"]:
        hr_idx[(gid, r["playerName"].strip().lower())] = y


def actual_starter_ks(gid, side, mlbam_id):
    ls = linescores.get(gid)
    if ls is not None:
        sid = ls["awayStarterId"] if side == "away" else ls["homeStarterId"]
        ks = ls["awayStarterKs"] if side == "away" else ls["homeStarterKs"]
        sid = int(sid) if sid is not None else None
        if ks is not None and (mlbam_id is None or sid == mlbam_id):
            return float(ks)
    live = live_k.get((gid, mlbam_id))
    if live and live.get("actualKs") is not None:
        return num(live["actualKs"])
    return None


by_month = defaultdict(list)
for gid, r in p1.items():
    by_month[month_of(r["gameDate"])].append(r)
kprops = [p for p in p1_props if p["propType"] == "K"]
hrprops = [p for p in p1_props if p["propType"] == "HR"]

refit = {}
for m in sorted(by_month):
    if m in SEED_MONTHS:
        refit[m] = {"seed": True, "league_env_mult": 1.0, "T_fg": 1.0, "T_f5": 1.0,
                    "total_sd": SEED_TOTAL_SD, "f5_total_sd": SEED_F5_TOTAL_SD,
                    "k_factor": 1.0, "hr_factor": 1.0,
                    "n_train_games": 0, "n_train_final": None,
                    "n_T_fg": None, "n_T_f5": None, "n_k_train": None,
                    "n_hr_train": None}
        continue
    train = [r for mm in by_month if mm < m for r in by_month[mm]]
    train_ids = {int(r["gameId"]) for r in train}
    proj_sum = act_sum = 0.0
    resid, f5_resid, fg_pairs, f5_pairs = [], [], [], []
    for r in train:
        gid = int(r["gameId"])
        if not is_final(gid):
            continue
        a_away, a_home = actual_scores(gid)
        if a_away is not None and num(r["projTotal"]) is not None:
            proj_sum += num(r["projTotal"])
            act_sum += a_away + a_home
            resid.append(num(r["projTotal"]) - (a_away + a_home))
        f5a, f5h = actual_f5(gid)
        if f5a is not None and num(r["projF5Total"]) is not None:
            f5_resid.append(num(r["projF5Total"]) - (f5a + f5h))
        if a_away is not None and num(r["pAwayMl"]) is not None:
            fg_pairs.append((num(r["pAwayMl"]), 1 if a_away > a_home else 0))
        if f5a is not None and num(r["pF5AwayMl"]) is not None and f5a != f5h:
            f5_pairs.append((num(r["pF5AwayMl"]), 1 if f5a > f5h else 0))
    env_mult = (act_sum / proj_sum) if proj_sum > 0 else 1.0
    t_fg, n_fg = fit_temperature(fg_pairs)
    t_f5, n_f5 = fit_temperature(f5_pairs)
    total_sd = float(np.std(resid, ddof=1)) if len(resid) >= 30 else SEED_TOTAL_SD
    f5_sd = float(np.std(f5_resid, ddof=1)) if len(f5_resid) >= 30 else SEED_F5_TOTAL_SD

    k_proj_sum = k_act_sum = 0.0
    n_k = 0
    for p in kprops:
        gid = int(p["gameId"])
        if gid not in train_ids or num(p["projValue"]) is None:
            continue
        mlbam = int(p["mlbamId"]) if p["mlbamId"] else None
        a = actual_starter_ks(gid, p["side"], mlbam)
        if a is None:
            continue
        k_proj_sum += num(p["projValue"])
        k_act_sum += a
        n_k += 1
    k_factor = (k_act_sum / k_proj_sum) if k_proj_sum > 0 else 1.0

    p_sum = y_sum = 0.0
    n_hr = 0
    for p in hrprops:
        gid = int(p["gameId"])
        if gid not in train_ids or num(p["pOver"]) is None:
            continue
        mlbam = int(p["mlbamId"]) if p["mlbamId"] else None
        y = hr_idx.get((gid, mlbam))
        if y is None and p["playerName"]:
            y = hr_idx.get((gid, p["playerName"].strip().lower()))
        if y is None:
            continue  # pipeline fell back to StatsAPI boxscore here (network)
        p_sum += num(p["pOver"])
        y_sum += y
        n_hr += 1
    hr_factor = (y_sum / n_hr) / (p_sum / n_hr) if n_hr > 0 and p_sum > 0 else 1.0

    refit[m] = {"seed": False, "league_env_mult": env_mult, "T_fg": t_fg, "T_f5": t_f5,
                "total_sd": total_sd, "f5_total_sd": f5_sd,
                "k_factor": k_factor, "hr_factor": hr_factor,
                "n_train_games": len(train), "n_train_final": len(fg_pairs),
                "n_T_fg": n_fg, "n_T_f5": n_f5, "n_k_train": n_k, "n_hr_train": n_hr}

# stored month params (from the uniform per-month meta)
stored_params = {}
for m, metas in metas_by_month.items():
    if len(metas) == 1:
        stored_params[m] = json.loads(next(iter(metas)))

param_rows = []
FULL_TOL_PARAMS = ["league_env_mult", "T_fg", "T_f5", "total_sd", "f5_total_sd", "k_factor"]
COUNT_PARAMS = ["n_train_games", "n_train_final", "n_T_fg", "n_T_f5", "n_k_train"]
for m in sorted(refit):
    st, rf = stored_params.get(m, {}), refit[m]
    for pkey in FULL_TOL_PARAMS + ["hr_factor"] + COUNT_PARAMS + ["n_hr_train"]:
        sv, rv = st.get(pkey), rf.get(pkey)
        diff = (abs(sv - rv) if isinstance(sv, (int, float)) and isinstance(rv, (int, float))
                else None)
        gate = pkey in FULL_TOL_PARAMS or pkey in COUNT_PARAMS
        ok = ("" if not gate or m in SEED_MONTHS and pkey in COUNT_PARAMS
              else ("PASS" if diff is not None and diff <= (TOL if pkey in FULL_TOL_PARAMS else 0.5)
                    else "FAIL"))
        param_rows.append({
            "month": m, "param": pkey,
            "stored": sv if sv is not None else "",
            "refit": (f"{rv:.5f}" if isinstance(rv, float) else rv) if rv is not None else "",
            "abs_diff": f"{diff:.6f}" if diff is not None else "",
            "gate": "yes" if gate else "info-only",
            "verdict": ok,
        })

with open(os.path.join(OUT, "fullgame-modeler-month-params.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(param_rows[0].keys()))
    w.writeheader()
    w.writerows(param_rows)

# ---------------------------------------------------------------- F. distributions
def series_vals(metric):
    """metric in {projTotal, pAwayMl} -> {series: {month: [vals]}}, population-restricted."""
    out = {s: defaultdict(list) for s in ("live", "p1", "p2")}
    nulls = {s: defaultdict(int) for s in ("live", "p1", "p2")}
    for gid in sorted(p1):
        m = month_of(p1[gid]["gameDate"])
        g = games.get(gid)
        if metric == "projTotal":
            lv = (num(g["modelProjTotal"]) if g and g["modelProjTotal"] is not None
                  else (num(g["modelTotal"]) if g else None))
        else:
            lv = (num(g["modelAwayWinPct"]) / 100
                  if g and g["modelAwayWinPct"] is not None else None)
        v1 = num(p1[gid][metric])
        v2 = num(p2[gid][metric]) if gid in p2 else None
        for s, v in (("live", lv), ("p1", v1), ("p2", v2)):
            if v is None:
                nulls[s][m] += 1
            else:
                out[s][m].append(v)
    return out, nulls


dist_rows, pair_rows = [], []
for metric in ("projTotal", "pAwayMl"):
    vals, nulls = series_vals(metric)
    months = sorted({m for s in vals.values() for m in s} | {"ALL"})
    for m in months:
        for s in ("live", "p1", "p2"):
            v = (np.array([x for mm in vals[s] for x in vals[s][mm]]) if m == "ALL"
                 else np.array(vals[s][m]))
            nn = (sum(nulls[s].values()) if m == "ALL" else nulls[s][m])
            if len(v) == 0:
                dist_rows.append({"metric": metric, "month": m, "series": s, "n": 0,
                                  "n_null": nn, **{k: "" for k in
                                  ("mean", "sd", "min", "p10", "p25", "p50", "p75", "p90", "max")}})
                continue
            dist_rows.append({
                "metric": metric, "month": m, "series": s, "n": len(v), "n_null": nn,
                "mean": f"{v.mean():.4f}", "sd": f"{v.std(ddof=1):.4f}" if len(v) > 1 else "",
                "min": f"{v.min():.4f}", "p10": f"{np.percentile(v, 10):.4f}",
                "p25": f"{np.percentile(v, 25):.4f}", "p50": f"{np.percentile(v, 50):.4f}",
                "p75": f"{np.percentile(v, 75):.4f}", "p90": f"{np.percentile(v, 90):.4f}",
                "max": f"{v.max():.4f}",
            })
    # pairwise per game
    for pair in (("live", "p1"), ("p1", "p2"), ("live", "p2")):
        for m in months:
            a, b = [], []
            for gid in sorted(p1):
                mm = month_of(p1[gid]["gameDate"])
                if m != "ALL" and mm != m:
                    continue
                g = games.get(gid)
                get = {
                    "live": ((num(g["modelProjTotal"]) if g and g["modelProjTotal"] is not None
                              else (num(g["modelTotal"]) if g else None))
                             if metric == "projTotal" else
                             (num(g["modelAwayWinPct"]) / 100
                              if g and g["modelAwayWinPct"] is not None else None)),
                    "p1": num(p1[gid][metric]),
                    "p2": num(p2[gid][metric]) if gid in p2 else None,
                }
                if get[pair[0]] is not None and get[pair[1]] is not None:
                    a.append(get[pair[0]])
                    b.append(get[pair[1]])
            if not a:
                continue
            a, b = np.array(a), np.array(b)
            d = b - a
            pair_rows.append({
                "metric": metric, "month": m, "pair": f"{pair[0]}_vs_{pair[1]}",
                "n_both": len(a), "mean_diff(b-a)": f"{d.mean():.4f}",
                "mean_abs_diff": f"{np.abs(d).mean():.4f}",
                "max_abs_diff": f"{np.abs(d).max():.4f}",
                "corr": f"{np.corrcoef(a, b)[0, 1]:.4f}" if len(a) > 2 else "",
            })

with open(os.path.join(OUT, "fullgame-modeler-distributions.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(dist_rows[0].keys()))
    w.writeheader()
    w.writerows(dist_rows)
with open(os.path.join(OUT, "fullgame-modeler-pairwise.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(pair_rows[0].keys()))
    w.writeheader()
    w.writerows(pair_rows)

# ---------------------------------------------------------------- summary JSON
summary = {
    "population": pop,
    "p1_consistency": {
        "n_checked": len(b_rows),
        "n_core_violations": len(b_viol),
        "core_violation_gameIds": [r["gameId"] for r in b_viol],
        "n_supp_violations": sum(1 for r in b_rows if r["supp_violations"]),
        "supp_violation_breakdown": _sv if (_sv := dict(
            (k, sum(1 for r in b_rows if k in r["supp_violations"]))
            for k in ("pF5AwayMl_in01", "pF5Over_in01", "pF5AwayRl_in01", "pNrfi_in01"))) else {},
        "max_additivity_diff": max(float(r["additivity_abs_diff"]) for r in b_rows
                                   if r["additivity_abs_diff"]),
    },
    "p2_transform": {
        "n_checked": len(c_rows),
        "n_violations": len(c_viol),
        "violation_gameIds": [r["gameId"] for r in c_viol][:50],
        "max_abs_diff_over_population": max(float(r["max_abs_diff"]) for r in c_rows),
        "nrfi_logistic_rows": nrfi_logistic_n,
        "nrfi_logistic_rows_equal_p1": nrfi_logistic_eq_p1,
    },
    "calibmeta": {
        "n_issues": len(meta_issues),
        "issues": [list(x) for x in meta_issues[:50]],
        "distinct_meta_per_month": month_meta_uniform,
    },
    "refit_vs_stored": {
        m: {k: {"stored": stored_params.get(m, {}).get(k), "refit": refit[m].get(k)}
            for k in ("league_env_mult", "T_fg", "T_f5", "total_sd", "f5_total_sd",
                      "k_factor", "hr_factor", "n_train_games", "n_train_final",
                      "n_T_fg", "n_T_f5", "n_k_train", "n_hr_train")}
        for m in sorted(refit)
    },
}
with open(os.path.join(OUT, "fullgame-modeler-summary.json"), "w") as f:
    json.dump(summary, f, indent=1)

print(json.dumps({k: v for k, v in summary.items() if k != "refit_vs_stored"}, indent=1))
print("refit_vs_stored:")
for m, d in summary["refit_vs_stored"].items():
    print(m, json.dumps(d))
