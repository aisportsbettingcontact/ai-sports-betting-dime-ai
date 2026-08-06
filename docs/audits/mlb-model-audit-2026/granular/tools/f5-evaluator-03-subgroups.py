#!/usr/bin/env python
"""f5-evaluator-03-subgroups.py — F5 EVALUATOR granular audit, step 3.

Pure file computation on f5-evaluator-raw.json + f5-evaluator-ledger.csv. Quantifies:

A. f5_rl line-subgroup metrics per series (line = +0.5 / -0.5 / |line|>=1.5), because the
   stored probabilities price a FIXED away +0.5 (replay, M-205 true cover) or a tie-excluded
   conditional (live) while grading uses whatever book line was captured:
     line +0.5 : replay prob matches the graded event exactly; live prob excludes ties.
     line -0.5 : event is 'away wins outright'; replay prob overstates by the tie mass,
                 live prob overstates by conditioning.
     |line|>=1.5: capture corruption (F5 spreads mirror the FG RL or junk) — the stored
                 prob refers to a different line entirely.
B. Corrected grading for the doubleheader F5-actual clobbering (games.actualF5Away/Home
   overwritten by the partner game's scores; pk-keyed mlb_replay_linescores used as truth,
   externally verified in step 4): which graded rows flip.
C. Book F5 line sanity: f5Total/bookTotal ratio outliers, f5AwayRunLine == FG awayRunLine
   copy evidence, non-mirrored f5 home/away run lines.

Outputs (granular/f5/):
  f5-evaluator-rl-subgroups.csv
  f5-evaluator-clobbered-corrections.csv
  f5-evaluator-line-sanity.csv
  appends summary block to f5-evaluator-summary.json (key 'step3')
"""
from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
F5DIR = os.path.normpath(os.path.join(HERE, "..", "f5"))

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"
SERIES = ["live", P1, P2]


def num(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n
    den = 1 + z * z / n
    ctr = p + z * z / (2 * n)
    rad = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((ctr - rad) / den, (ctr + rad) / den)


def main() -> None:
    with open(os.path.join(F5DIR, "f5-evaluator-raw.json")) as f:
        raw = json.load(f)
    games = {g["id"]: g for g in raw["games"]}
    ls_by_gid = {r["gameId"]: r for r in raw["linescores"]}
    ledger = list(csv.DictReader(open(os.path.join(F5DIR, "f5-evaluator-ledger.csv"))))

    # ---------- A. RL line subgroups ----------
    def group_of(line):
        if line == 0.5:
            return "+0.5"
        if line == -0.5:
            return "-0.5"
        return "|line|>=1.5"

    sub_rows = []
    for s in SERIES:
        by_grp = defaultdict(list)
        for r in ledger:
            if r["series"] != s or r["market"] != "f5_rl" or r["result"] not in ("WIN", "LOSS"):
                continue
            by_grp[group_of(num(r["line"]))].append(r)
        for grp in ("+0.5", "-0.5", "|line|>=1.5"):
            rs = by_grp[grp]
            if not rs:
                continue
            hits = sum(int(r["correct"]) for r in rs)
            briers = [num(r["brier"]) for r in rs]
            probs = [num(r["prob"]) for r in rs]
            obs = sum(1 for r in rs if r["actual_side"] == "AWAY")
            lo, hi = wilson(hits, len(rs))
            sub_rows.append({
                "series": s, "line_group": grp, "n": len(rs), "hits": hits,
                "hit_rate": round(hits / len(rs), 4),
                "hit_ci_lo": round(lo, 4), "hit_ci_hi": round(hi, 4),
                "brier": round(sum(briers) / len(briers), 4),
                "avg_p_away": round(sum(probs) / len(probs), 4),
                "obs_away_rate": round(obs / len(rs), 4),
                "gap_p_minus_obs": round(sum(probs) / len(probs) - obs / len(rs), 4)})
    with open(os.path.join(F5DIR, "f5-evaluator-rl-subgroups.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sub_rows[0].keys()))
        w.writeheader()
        w.writerows(sub_rows)

    # ---------- B. clobbered doubleheader corrections ----------
    # conflict = games actualF5 pair != pk-keyed linescore pair (both present)
    conflicts = []
    for gid, g in games.items():
        ga, gh = num(g["actualF5AwayScore"]), num(g["actualF5HomeScore"])
        ls = ls_by_gid.get(gid)
        if ga is None or ls is None:
            continue
        la, lh = num(ls.get("f5AwayRuns")), num(ls.get("f5HomeRuns"))
        if la is None:
            continue
        if ga != la or gh != lh:
            conflicts.append((gid, ga, gh, la, lh))

    corr_rows = []
    for gid, ga, gh, la, lh in conflicts:
        g = games[gid]
        for r in ledger:
            if int(r["gameId"]) != gid or not int(r["graded"]):
                continue
            mk, s = r["market"], r["series"]
            p = num(r["prob"])
            if mk == "f5_ml":
                t_side = "AWAY" if la > lh else ("HOME" if la < lh else "PUSH")
            elif mk == "f5_rl":
                cov = la + num(r["line"]) - lh
                t_side = "AWAY" if cov > 0 else ("HOME" if cov < 0 else "PUSH")
            else:
                t5 = la + lh
                line = num(r["line"])
                t_side = "OVER" if t5 > line else ("UNDER" if t5 < line else "PUSH")
            stored_side = r["actual_side"]
            if t_side == stored_side:
                flip = ""
            else:
                flip = "FLIP"
            t_result = ("PUSH" if t_side == "PUSH"
                        else ("WIN" if r["pick"] == t_side else "LOSS"))
            corr_rows.append({
                "gameId": gid, "gameDate": r["gameDate"], "series": s, "market": mk,
                "games_f5": f"{ga:g}-{gh:g}", "linescore_f5": f"{la:g}-{lh:g}",
                "pick": r["pick"], "stored_actual_side": stored_side,
                "stored_result": r["result"], "true_actual_side": t_side,
                "true_result": t_result, "flip": flip})
    with open(os.path.join(F5DIR, "f5-evaluator-clobbered-corrections.csv"), "w",
              newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(corr_rows[0].keys()) if corr_rows else
                           ["gameId"])
        w.writeheader()
        w.writerows(corr_rows)

    # ---------- C. line sanity ----------
    sanity_rows = []
    n_book = n_ratio_bad = n_mirror_bad = n_copy_fg = 0
    for gid, g in games.items():
        ft, bt = num(g["f5Total"]), num(g["bookTotal"])
        frl_a, frl_h = num(g["f5AwayRunLine"]), num(g["f5HomeRunLine"])
        fg_a = num(g["awayRunLine"]) if "awayRunLine" in g else None
        issues = []
        if ft is not None:
            n_book += 1
            if bt is not None and (ft / bt > 0.70 or ft / bt < 0.40):
                issues.append(f"f5Total/bookTotal={ft / bt:.2f}")
                n_ratio_bad += 1
        if frl_a is not None and frl_h is not None and frl_a != -frl_h:
            issues.append(f"rl_not_mirrored({frl_a:g}/{frl_h:g})")
            n_mirror_bad += 1
        if frl_a is not None and abs(frl_a) >= 1.5 and fg_a is not None \
                and abs(frl_a) == abs(fg_a):
            n_copy_fg += 1
            issues.append("abs(f5RL)==abs(fgRL)")
        if issues:
            sanity_rows.append({"gameId": gid, "gameDate": g["gameDate"][:10],
                                "away": g["awayTeam"], "home": g["homeTeam"],
                                "f5Total": ft, "bookTotal": bt,
                                "f5AwayRunLine": frl_a, "f5HomeRunLine": frl_h,
                                "issues": ";".join(issues)})
    with open(os.path.join(F5DIR, "f5-evaluator-line-sanity.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["gameId", "gameDate", "away", "home", "f5Total",
                                          "bookTotal", "f5AwayRunLine", "f5HomeRunLine",
                                          "issues"])
        w.writeheader()
        w.writerows(sanity_rows)

    flips = sum(1 for r in corr_rows if r["flip"] == "FLIP")
    summ_path = os.path.join(F5DIR, "f5-evaluator-summary.json")
    with open(summ_path) as f:
        summary = json.load(f)
    summary["step3"] = {
        "rl_subgroups": sub_rows,
        "clobbered_games": [{"gameId": c[0], "games_f5": f"{c[1]:g}-{c[2]:g}",
                             "linescore_f5": f"{c[3]:g}-{c[4]:g}"} for c in conflicts],
        "clobbered_graded_rows": len(corr_rows),
        "clobbered_flips": flips,
        "line_sanity": {"n_f5Total_book": n_book, "ratio_outliers": n_ratio_bad,
                        "rl_not_mirrored": n_mirror_bad,
                        "abs_f5RL_eq_abs_fgRL_when_ge_1.5": n_copy_fg,
                        "flagged_rows": len(sanity_rows)},
    }
    with open(summ_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary["step3"], indent=2)[:4000])


if __name__ == "__main__":
    main()
