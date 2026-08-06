#!/usr/bin/env python
"""f5-evaluator-02-ledger.py — F5 EVALUATOR granular audit, step 2: full-population
per-game evaluation ledger + metric suite. Pure file computation (no DB access);
input = f5-evaluator-raw.json produced by f5-evaluator-01-extract.py.

Grading conventions mirror tools/replay/calibrate_and_grade.py / GRADING-REPORT.md exactly
so the re-derivation is comparable to mlb_replay_grades:
  f5_ml   : prob = P(away wins F5) [live modelF5AwayWinPct/100; replay pF5AwayMl —
            both ABSOLUTE push-inclusive]; pick = AWAY iff p > 0.5; tie => PUSH
            (excluded from hit/Brier); graded when proj+actual present (no line needed).
  f5_rl   : line = book games.f5AwayRunLine; prob = P(away covers) [live
            modelF5AwayRLCoverPct/100 = tie-EXCLUDED conditional; replay pF5AwayRl =
            true cover prob (M-205 fix)]; pick = AWAY iff p > 0.5;
            cover = f5a + line - f5h.
  f5_total: line = book games.f5Total; prob = P(over) [live modelF5OverRate already 0-1
            (P-003); replay pF5Over]; pick = OVER iff p > 0.5; actual =
            actualF5Total ?? f5a+f5h; push on exact line.

Evaluator additions (documented, kept in separate columns):
  proj_exp        : expectation-based F5 total projection (live modelF5AwayScore+HomeScore;
                    replay projF5Total) for a scale-consistent signed error, because live
                    modelF5Total is a SNAPPED SYNTHETIC LINE, not an expectation (F-4).
  pick_alt / correct_alt (f5_ml): push-aware pick with threshold (1-p_push)/2, p_push =
                    that game's live modelF5PushPct (fallback prior 0.1507) — sensitivity
                    for the absolute-probability home-lean built into 'p > 0.5'.
  quarantined     : live series only; modelRunAt >= startTimeUtc (P-001 provenance).
  brier_abs (f5_ml): Brier of the absolute prob against y=1[away wins F5] with ties
                    counted as non-events (all rows, no push exclusion) — the proper
                    scoring view of an absolute three-way probability.

Outputs (granular/f5/):
  f5-evaluator-ledger.csv            game x market x series (13,995 rows = 1,555 x 3 x 3)
  f5-evaluator-monthly-metrics.csv   metric suite per series x market x month x cohort
  f5-evaluator-reliability.csv       equal-count decile reliability per series x market
  f5-evaluator-push-analysis.csv     observed F5 tie rate vs sim implied push, by month
  f5-evaluator-pick-lean.csv         pick side lean per series x market x month
  f5-evaluator-crosscheck.csv        mismatches vs mlb_replay_grades snapshot
  f5-evaluator-total-line.csv        synthetic-vs-book F5 total line analysis
  f5-evaluator-summary.json          headline aggregates for the report
"""
from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
F5DIR = os.path.normpath(os.path.join(HERE, "..", "f5"))
RAW = os.path.join(F5DIR, "f5-evaluator-raw.json")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"
SERIES = ["live", P1, P2]
MARKETS = ["f5_ml", "f5_rl", "f5_total"]
PUSH_PRIOR = 0.1507
EPS = 1e-15


def num(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def month_of(d):
    return d[:7]


def nearest_half(x):
    return round(x * 2) / 2


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n
    den = 1 + z * z / n
    ctr = p + z * z / (2 * n)
    rad = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((ctr - rad) / den, (ctr + rad) / den)


def mean_ci(xs, z=1.96):
    n = len(xs)
    if n == 0:
        return (None, None, None)
    m = sum(xs) / n
    if n < 2:
        return (m, None, None)
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))
    half = z * sd / math.sqrt(n)
    return (m, m - half, m + half)


def parse_start_ms(iso):
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00")
        return datetime.fromisoformat(s).astimezone(timezone.utc).timestamp() * 1000
    except ValueError:
        return None


def main() -> None:
    with open(RAW) as f:
        raw = json.load(f)
    games = raw["games"]
    ctx = raw["context"]
    ls_by_gid = {r["gameId"]: r for r in raw["linescores"]}
    start_by_gid = {int(k): parse_start_ms(v) for k, v in raw["startTimeUtc"].items()}
    replay = defaultdict(dict)  # gameId -> version -> row
    for r in raw["replay"]:
        replay[r["gameId"]][r["modelVersion"]] = r
    grades_idx = {}
    for r in raw["grades"]:
        grades_idx[(r["gameId"], r["market"], r["modelVersion"])] = r

    ledger = []
    fallback_actual_n = 0
    actual_total_inconsistent = []

    for g in games:
        gid = g["id"]
        gdate = g["gameDate"][:10]
        mon = month_of(gdate)
        f5a, f5h = num(g["actualF5AwayScore"]), num(g["actualF5HomeScore"])
        actual_src = "games"
        if f5a is None or f5h is None:
            ls = ls_by_gid.get(gid)
            if ls and ls.get("f5AwayRuns") is not None and ls.get("f5HomeRuns") is not None:
                f5a, f5h = float(ls["f5AwayRuns"]), float(ls["f5HomeRuns"])
                actual_src = "linescore"
                fallback_actual_n += 1
            else:
                actual_src = "missing"
        at5_col = num(g["actualF5Total"])
        at5 = at5_col if at5_col is not None else (f5a + f5h if f5a is not None else None)
        if at5_col is not None and f5a is not None and at5_col != f5a + f5h:
            actual_total_inconsistent.append(gid)

        line_rl = num(g["f5AwayRunLine"])
        line_tot = num(g["f5Total"])
        book_total_fg = num(g["bookTotal"])
        synth_line = nearest_half(book_total_fg * 0.555) if book_total_fg is not None else None
        live_push = num(g["modelF5PushPct"])
        start_ms = start_by_gid.get(gid)
        mra = num(g["modelRunAt"])
        quarantined = 1 if (mra is not None and start_ms is not None and mra >= start_ms) else 0

        for series in SERIES:
            if series == "live":
                p_ml = num(g["modelF5AwayWinPct"])
                p_ml = p_ml / 100 if p_ml is not None else None
                p_rl = num(g["modelF5AwayRLCoverPct"])
                p_rl = p_rl / 100 if p_rl is not None else None
                p_ov = num(g["modelF5OverRate"])  # already 0-1 (P-003)
                proj_line = num(g["modelF5Total"])  # synthetic snapped line
                pa, ph = num(g["modelF5AwayScore"]), num(g["modelF5HomeScore"])
                proj_exp = pa + ph if pa is not None and ph is not None else None
                q = quarantined
            else:
                r = replay[gid].get(series)
                p_ml = num(r["pF5AwayMl"]) if r else None
                p_rl = num(r["pF5AwayRl"]) if r else None
                p_ov = num(r["pF5Over"]) if r else None
                proj_line = None
                proj_exp = num(r["projF5Total"]) if r else None
                q = 0

            base = dict(gameId=gid, gamePk=g["mlbGamePk"], gameDate=gdate, month=mon,
                        away=g["awayTeam"], home=g["homeTeam"], series=series,
                        actual_f5_away=f5a, actual_f5_home=f5h, actual_src=actual_src,
                        quarantined=q)

            # ---- f5_ml ----
            row = dict(base, market="f5_ml", prob=p_ml, proj_value=None, proj_exp=None,
                       line=g["f5AwayML"], actual_value=None, actual_side=None, pick=None,
                       result=None, correct=None, brier=None, logloss=None,
                       signed_error=None, signed_error_exp=None, is_push=None,
                       has_proj=int(p_ml is not None), has_line=int(g["f5AwayML"] is not None),
                       has_actual=int(f5a is not None), graded=0, brier_abs=None,
                       pick_alt=None, correct_alt=None, line_source_match=None)
            if p_ml is not None and f5a is not None:
                side = "AWAY" if f5a > f5h else ("HOME" if f5a < f5h else "PUSH")
                pick = "AWAY" if p_ml > 0.5 else "HOME"
                thr = (1 - (live_push if live_push is not None else PUSH_PRIOR)) / 2
                pick_alt = "AWAY" if p_ml > thr else "HOME"
                row.update(actual_side=side, pick=pick, pick_alt=pick_alt, graded=1,
                           is_push=int(side == "PUSH"),
                           actual_value="TIE" if side == "PUSH" else side,
                           brier_abs=(p_ml - (1 if side == "AWAY" else 0)) ** 2)
                if side == "PUSH":
                    row.update(result="PUSH")
                else:
                    y = 1 if side == "AWAY" else 0
                    p_ev = p_ml if y == 1 else 1 - p_ml
                    row.update(result="WIN" if pick == side else "LOSS",
                               correct=int(pick == side),
                               correct_alt=int(pick_alt == side),
                               brier=(p_ml - y) ** 2,
                               logloss=-math.log(max(p_ev, EPS)))
            ledger.append(row)

            # ---- f5_rl ----
            row = dict(base, market="f5_rl", prob=p_rl, proj_value=None, proj_exp=None,
                       line=line_rl, actual_value=None, actual_side=None, pick=None,
                       result=None, correct=None, brier=None, logloss=None,
                       signed_error=None, signed_error_exp=None, is_push=None,
                       has_proj=int(p_rl is not None), has_line=int(line_rl is not None),
                       has_actual=int(f5a is not None), graded=0, brier_abs=None,
                       pick_alt=None, correct_alt=None, line_source_match=None)
            if p_rl is not None and line_rl is not None and f5a is not None:
                cover = f5a + line_rl - f5h
                side = "AWAY" if cover > 0 else ("HOME" if cover < 0 else "PUSH")
                pick = "AWAY" if p_rl > 0.5 else "HOME"
                row.update(actual_side=side, pick=pick, graded=1,
                           is_push=int(side == "PUSH"), actual_value=side)
                if side == "PUSH":
                    row.update(result="PUSH")
                else:
                    y = 1 if side == "AWAY" else 0
                    p_ev = p_rl if y == 1 else 1 - p_rl
                    row.update(result="WIN" if pick == side else "LOSS",
                               correct=int(pick == side),
                               brier=(p_rl - y) ** 2,
                               logloss=-math.log(max(p_ev, EPS)))
            ledger.append(row)

            # ---- f5_total ----
            pv = proj_line if series == "live" else proj_exp
            row = dict(base, market="f5_total", prob=p_ov, proj_value=pv, proj_exp=proj_exp,
                       line=line_tot, actual_value=at5, actual_side=None, pick=None,
                       result=None, correct=None, brier=None, logloss=None,
                       signed_error=None, signed_error_exp=None, is_push=None,
                       has_proj=int(p_ov is not None), has_line=int(line_tot is not None),
                       has_actual=int(at5 is not None), graded=0, brier_abs=None,
                       pick_alt=None, correct_alt=None,
                       line_source_match=(int(line_tot == synth_line)
                                          if line_tot is not None and synth_line is not None
                                          else None))
            if p_ov is not None and line_tot is not None and at5 is not None:
                side = "OVER" if at5 > line_tot else ("UNDER" if at5 < line_tot else "PUSH")
                pick = "OVER" if p_ov > 0.5 else "UNDER"
                row.update(actual_side=side, pick=pick, graded=1,
                           is_push=int(side == "PUSH"),
                           signed_error=(pv - at5) if pv is not None else None,
                           signed_error_exp=(proj_exp - at5) if proj_exp is not None else None)
                if side == "PUSH":
                    row.update(result="PUSH")
                else:
                    y = 1 if side == "OVER" else 0
                    p_ev = p_ov if y == 1 else 1 - p_ov
                    row.update(result="WIN" if pick == side else "LOSS",
                               correct=int(pick == side),
                               brier=(p_ov - y) ** 2,
                               logloss=-math.log(max(p_ev, EPS)))
            ledger.append(row)

    # ---------------- write ledger ----------------
    cols = ["gameId", "gamePk", "gameDate", "month", "away", "home", "series", "market",
            "prob", "proj_value", "proj_exp", "line", "actual_f5_away", "actual_f5_home",
            "actual_value", "actual_side", "pick", "pick_alt", "result", "correct",
            "correct_alt", "brier", "brier_abs", "logloss", "signed_error",
            "signed_error_exp", "is_push", "graded", "has_proj", "has_line", "has_actual",
            "actual_src", "quarantined", "line_source_match"]
    with open(os.path.join(F5DIR, "f5-evaluator-ledger.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in ledger:
            w.writerow({k: r.get(k) for k in cols})

    # ---------------- common-clean cohort ----------------
    graded_ids = defaultdict(set)  # market -> set of gameIds graded in every series
    for mk in MARKETS:
        per_series = []
        for s in SERIES:
            ids = {r["gameId"] for r in ledger
                   if r["market"] == mk and r["series"] == s and r["graded"]}
            per_series.append(ids)
        common = set.intersection(*per_series)
        quar = {r["gameId"] for r in ledger if r["quarantined"]}
        graded_ids[mk] = common - quar

    def in_cohort(r, cohort):
        if cohort == "all":
            return True
        return r["gameId"] in graded_ids[r["market"]]

    # ---------------- monthly metric suite ----------------
    months = sorted({r["month"] for r in ledger})
    month_keys = months + ["MAR+APR", "ALL"]

    def month_match(r, mk):
        if mk == "ALL":
            return True
        if mk == "MAR+APR":
            return r["month"] in ("2026-03", "2026-04")
        return r["month"] == mk

    metrics_rows = []
    for cohort in ["all", "common-clean"]:
        for s in SERIES:
            for mk in MARKETS:
                rows_sm = [r for r in ledger if r["series"] == s and r["market"] == mk
                           and in_cohort(r, cohort)]
                for mkey in month_keys:
                    rs = [r for r in rows_sm if month_match(r, mkey)]
                    graded = [r for r in rs if r["graded"]]
                    dec = [r for r in graded if r["result"] in ("WIN", "LOSS")]
                    pushes = [r for r in graded if r["result"] == "PUSH"]
                    hits = sum(r["correct"] for r in dec)
                    lo, hi = wilson(hits, len(dec))
                    briers = [r["brier"] for r in dec if r["brier"] is not None]
                    lls = [r["logloss"] for r in dec if r["logloss"] is not None]
                    probs = [r["prob"] for r in dec]
                    if mk == "f5_ml":
                        obs = sum(1 for r in dec if r["actual_side"] == "AWAY")
                        alt_dec = [r for r in dec if r["correct_alt"] is not None]
                        alt_hits = sum(r["correct_alt"] for r in alt_dec)
                        b_abs = [r["brier_abs"] for r in graded if r["brier_abs"] is not None]
                    elif mk == "f5_rl":
                        obs = sum(1 for r in dec if r["actual_side"] == "AWAY")
                        alt_dec, alt_hits, b_abs = [], None, []
                    else:
                        obs = sum(1 for r in dec if r["actual_side"] == "OVER")
                        alt_dec, alt_hits, b_abs = [], None, []
                    se = [r["signed_error"] for r in graded if r["signed_error"] is not None]
                    se_exp = [r["signed_error_exp"] for r in graded
                              if r["signed_error_exp"] is not None]
                    bias, blo, bhi = mean_ci(se) if se else (None, None, None)
                    ebias, eblo, ebhi = mean_ci(se_exp) if se_exp else (None, None, None)
                    metrics_rows.append({
                        "cohort": cohort, "series": s, "market": mk, "month": mkey,
                        "n_pop": len(rs), "n_graded": len(graded), "n_decided": len(dec),
                        "n_push": len(pushes), "hits": hits,
                        "hit_rate": round(hits / len(dec), 4) if dec else None,
                        "hit_ci_lo": round(lo, 4) if lo is not None else None,
                        "hit_ci_hi": round(hi, 4) if hi is not None else None,
                        "brier": round(sum(briers) / len(briers), 4) if briers else None,
                        "logloss": round(sum(lls) / len(lls), 4) if lls else None,
                        "avg_prob": round(sum(probs) / len(probs), 4) if probs else None,
                        "obs_rate": round(obs / len(dec), 4) if dec else None,
                        "brier_abs": round(sum(b_abs) / len(b_abs), 4) if b_abs else None,
                        "alt_hit_rate": (round(alt_hits / len(alt_dec), 4)
                                         if alt_dec else None),
                        "mae": (round(sum(abs(x) for x in se) / len(se), 3) if se else None),
                        "bias": round(bias, 3) if bias is not None else None,
                        "bias_ci_lo": round(blo, 3) if blo is not None else None,
                        "bias_ci_hi": round(bhi, 3) if bhi is not None else None,
                        "mae_exp": (round(sum(abs(x) for x in se_exp) / len(se_exp), 3)
                                    if se_exp else None),
                        "bias_exp": round(ebias, 3) if ebias is not None else None,
                        "bias_exp_ci_lo": round(eblo, 3) if eblo is not None else None,
                        "bias_exp_ci_hi": round(ebhi, 3) if ebhi is not None else None,
                    })
    mcols = list(metrics_rows[0].keys())
    with open(os.path.join(F5DIR, "f5-evaluator-monthly-metrics.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=mcols)
        w.writeheader()
        w.writerows(metrics_rows)

    # ---------------- reliability (equal-count deciles, decided rows, cohort=all) ------
    rel_rows = []
    for s in SERIES:
        for mk in MARKETS:
            dec = sorted((r for r in ledger if r["series"] == s and r["market"] == mk
                          and r["result"] in ("WIN", "LOSS")), key=lambda r: r["prob"])
            n = len(dec)
            if n < 50:
                continue
            nbins = 10
            for b in range(nbins):
                lo_i, hi_i = b * n // nbins, (b + 1) * n // nbins
                chunk = dec[lo_i:hi_i]
                if not chunk:
                    continue
                if mk == "f5_total":
                    y = sum(1 for r in chunk if r["actual_side"] == "OVER")
                else:
                    y = sum(1 for r in chunk if r["actual_side"] == "AWAY")
                mp = sum(r["prob"] for r in chunk) / len(chunk)
                rel_rows.append({"series": s, "market": mk, "decile": b + 1,
                                 "n": len(chunk),
                                 "p_lo": round(chunk[0]["prob"], 4),
                                 "p_hi": round(chunk[-1]["prob"], 4),
                                 "mean_p": round(mp, 4),
                                 "obs_rate": round(y / len(chunk), 4),
                                 "gap": round(y / len(chunk) - mp, 4)})
    with open(os.path.join(F5DIR, "f5-evaluator-reliability.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rel_rows[0].keys()))
        w.writeheader()
        w.writerows(rel_rows)

    # ---------------- push analysis by month ----------------
    push_rows = []
    blend_viol = 0
    blend_checked = 0
    for mkey in month_keys:
        gs = [g for g in games if month_match({"month": month_of(g["gameDate"][:10])}, mkey)]
        with_act = []
        for g in gs:
            f5a, f5h = num(g["actualF5AwayScore"]), num(g["actualF5HomeScore"])
            if f5a is None:
                ls = ls_by_gid.get(g["id"])
                if ls and ls.get("f5AwayRuns") is not None:
                    f5a, f5h = float(ls["f5AwayRuns"]), float(ls["f5HomeRuns"])
            if f5a is not None:
                with_act.append((g, f5a, f5h))
        ties = sum(1 for _, a, h in with_act if a == h)
        pp = [num(g["modelF5PushPct"]) for g, _, _ in with_act]
        pr = [num(g["modelF5PushRaw"]) for g, _, _ in with_act]
        pp = [x for x in pp if x is not None]
        pr = [x for x in pr if x is not None]
        if mkey == "ALL":
            for g in games:
                a, b = num(g["modelF5PushPct"]), num(g["modelF5PushRaw"])
                if a is not None and b is not None:
                    blend_checked += 1
                    if abs(a - (0.6 * b + 0.4 * PUSH_PRIOR)) > 0.005:
                        blend_viol += 1
        lo, hi = wilson(ties, len(with_act))
        push_rows.append({
            "month": mkey, "n_games_actuals": len(with_act), "n_ties": ties,
            "obs_tie_rate": round(ties / len(with_act), 4) if with_act else None,
            "tie_ci_lo": round(lo, 4) if lo is not None else None,
            "tie_ci_hi": round(hi, 4) if hi is not None else None,
            "n_live_push": len(pp),
            "sim_push_adj_mean": round(sum(pp) / len(pp), 4) if pp else None,
            "sim_push_raw_mean": round(sum(pr) / len(pr), 4) if pr else None,
            "prior": PUSH_PRIOR})
    with open(os.path.join(F5DIR, "f5-evaluator-push-analysis.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(push_rows[0].keys()))
        w.writeheader()
        w.writerows(push_rows)

    # ---------------- pick lean ----------------
    lean_rows = []
    for s in SERIES:
        for mk in MARKETS:
            for mkey in month_keys:
                rs = [r for r in ledger if r["series"] == s and r["market"] == mk
                      and r["graded"] and month_match(r, mkey)]
                if not rs:
                    continue
                if mk == "f5_total":
                    a = sum(1 for r in rs if r["pick"] == "OVER")
                    lab_a, lab_b = "pct_over", "pct_under"
                else:
                    a = sum(1 for r in rs if r["pick"] == "AWAY")
                    lab_a, lab_b = "pct_away", "pct_home"
                row = {"series": s, "market": mk, "month": mkey, "n": len(rs),
                       "side_a": lab_a, "pct_a": round(a / len(rs), 4),
                       "side_b": lab_b, "pct_b": round(1 - a / len(rs), 4),
                       "pct_away_alt": None}
                if mk == "f5_ml":
                    alt = sum(1 for r in rs if r["pick_alt"] == "AWAY")
                    row["pct_away_alt"] = round(alt / len(rs), 4)
                lean_rows.append(row)
    with open(os.path.join(F5DIR, "f5-evaluator-pick-lean.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(lean_rows[0].keys()))
        w.writeheader()
        w.writerows(lean_rows)

    # ---------------- cross-check vs mlb_replay_grades snapshot ----------------
    xrows = []
    matched = 0
    ledger_idx = {}
    for r in ledger:
        v = "live" if r["series"] == "live" else r["series"]
        ledger_idx[(r["gameId"], r["market"], v)] = r
    only_in_grades, only_in_ledger = 0, 0
    for key, gr in grades_idx.items():
        lr = ledger_idx.get(key)
        if lr is None or not lr["graded"]:
            only_in_grades += 1
            xrows.append({"gameId": key[0], "market": key[1], "series": key[2],
                          "field": "_presence", "ledger": "ungraded/missing",
                          "grades": gr["result"], "note": "row in mlb_replay_grades only"})
            continue
        matched += 1
        diffs = []
        if (gr["pick"] or None) != lr["pick"]:
            diffs.append(("pick", lr["pick"], gr["pick"]))
        if (gr["result"] or None) != lr["result"]:
            diffs.append(("result", lr["result"], gr["result"]))
        gc = gr["correct"]
        if (None if gc is None else int(gc)) != lr["correct"]:
            diffs.append(("correct", lr["correct"], gr["correct"]))
        gb, lb = num(gr["brier"]), lr["brier"]
        if (gb is None) != (lb is None) or (gb is not None and abs(gb - lb) > 1e-4):
            diffs.append(("brier", lb, gb))
        gp, lp = num(gr["prob"]), lr["prob"]
        if gp is not None and lp is not None and abs(gp - lp) > 1e-3:
            diffs.append(("prob", lp, gp))
        for fld, lv, gv in diffs:
            xrows.append({"gameId": key[0], "market": key[1], "series": key[2],
                          "field": fld, "ledger": lv, "grades": gv, "note": ""})
    for key, lr in ledger_idx.items():
        if lr["graded"] and key not in grades_idx:
            only_in_ledger += 1
            xrows.append({"gameId": key[0], "market": key[1], "series": key[2],
                          "field": "_presence", "ledger": lr["result"],
                          "grades": "absent",
                          "note": "graded by evaluator, absent from mlb_replay_grades"})
    with open(os.path.join(F5DIR, "f5-evaluator-crosscheck.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["gameId", "market", "series", "field",
                                          "ledger", "grades", "note"])
        w.writeheader()
        w.writerows(xrows)

    # ---------------- total line analysis ----------------
    tl_rows = []
    for g in games:
        bt, ft, mt = num(g["bookTotal"]), num(g["f5Total"]), num(g["modelF5Total"])
        synth = nearest_half(bt * 0.555) if bt is not None else None
        if ft is None:
            continue
        tl_rows.append({"gameId": g["id"], "gameDate": g["gameDate"][:10],
                        "month": month_of(g["gameDate"][:10]),
                        "bookTotal": bt, "f5Total_book": ft,
                        "modelF5Total_synth": mt, "synth_reconstructed": synth,
                        "diff_synth_book": (round(mt - ft, 2)
                                            if mt is not None else None)})
    with open(os.path.join(F5DIR, "f5-evaluator-total-line.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(tl_rows[0].keys()))
        w.writeheader()
        w.writerows(tl_rows)

    # ---------------- summary ----------------
    def agg(series, market, cohort="all", month="ALL"):
        for r in metrics_rows:
            if (r["series"], r["market"], r["cohort"], r["month"]) == \
                    (series, market, cohort, month):
                return r
        return None

    rl_line_dist = defaultdict(int)
    for g in games:
        rl_line_dist[str(num(g["f5AwayRunLine"]))] += 1
    tot_match = [r for r in tl_rows if r["modelF5Total_synth"] is not None]
    n_line_eq = sum(1 for r in tot_match if r["diff_synth_book"] == 0)

    summary = {
        "run_context": ctx,
        "population_n": len(games),
        "ledger_rows": len(ledger),
        "fallback_actuals_used": fallback_actual_n,
        "actual_total_inconsistent_gameIds": actual_total_inconsistent,
        "push_blend_checked": blend_checked, "push_blend_violations": blend_viol,
        "crosscheck": {"matched": matched, "mismatch_rows": len(xrows),
                       "only_in_grades": only_in_grades,
                       "only_in_ledger": only_in_ledger},
        "f5AwayRunLine_distribution": dict(rl_line_dist),
        "f5_total_book_lines": len(tl_rows),
        "f5_total_synth_eq_book": n_line_eq,
        "headline": {f"{s}|{mk}": agg(s, mk) for s in SERIES for mk in MARKETS},
    }
    with open(os.path.join(F5DIR, "f5-evaluator-summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps({k: v for k, v in summary.items() if k != "headline"}, indent=2))
    for k, v in summary["headline"].items():
        if v:
            print(k, "hit", v["hit_rate"], "n", v["n_decided"], "brier", v["brier"],
                  "bias_exp", v["bias_exp"])


if __name__ == "__main__":
    main()
