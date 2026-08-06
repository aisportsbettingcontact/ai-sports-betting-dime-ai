#!/usr/bin/env python
"""nrfi-evaluator-02-ledger.py — NRFI EVALUATOR granular audit, step 2: ledger + metric suite.

Input: granular/nrfi/nrfi-evaluator-raw.json (from nrfi-evaluator-01-extract.py).

Grading rules (stated before running, consistent with GRADING-REPORT.md):
  - P(NRFI) = games.modelPNrfi (live, 0-1, 2dp) or mlb_replay_projections.pNrfi (wf series).
  - Pick: NRFI if p>0.5, YRFI if p<0.5, NONE if p==0.5 exactly (primary treatment; the
    running pipeline's 0.5->YRFI convention is also computed for reconciliation).
  - Actual: mlb_replay_linescores inn1 (NRFI iff inn1Away==0 and inn1Home==0) is the grading
    substrate (StatsAPI-derived, available for all 1,555); games.actualNrfiBinary and
    nrfiActualResult are cross-checked against it and disagreements reported as defects.
  - brier = (p - actual)^2 with actual 1=NRFI; logloss with p clipped to [1e-12, 1-1e-12].
  - Live-series leakage flag (P-001): modelRunAt >= startTimeUtc of the game (or start unknown).

Outputs (granular/nrfi/):
  nrfi-evaluator-ledger.csv            game x series evaluation ledger (full population)
  nrfi-evaluator-monthly-metrics.csv   metric suite per series x month (+ALL)
  nrfi-evaluator-reliability.csv       equal-count decile reliability per series
  nrfi-evaluator-sides.csv             both-sides (NRFI pick vs YRFI pick) per series x month
  nrfi-evaluator-crosscheck.csv        actual-source + stored-grade + pipeline-grade mismatches
  nrfi-evaluator-summary.json          headline numbers + run context
"""
from __future__ import annotations

import csv
import datetime
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "nrfi")
RAW = os.path.join(OUT_DIR, "nrfi-evaluator-raw.json")

EPS = 1e-12


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def logloss_one(p, y):
    p = min(max(p, EPS), 1 - EPS)
    return -(math.log(p) if y == 1 else math.log(1 - p))


def auc(pairs):
    """pairs: list of (p, y). Rank-based AUC with tie handling."""
    pos = [p for p, y in pairs if y == 1]
    neg = [p for p, y in pairs if y == 0]
    if not pos or not neg:
        return None
    ranked = sorted(pairs, key=lambda t: t[0])
    # average ranks for ties
    ranks = {}
    i = 0
    while i < len(ranked):
        j = i
        while j < len(ranked) and ranked[j][0] == ranked[i][0]:
            j += 1
        avg_rank = (i + 1 + j) / 2.0
        ranks.setdefault(ranked[i][0], avg_rank)
        i = j
    rank_sum_pos = sum(ranks[p] for p in pos)
    n1, n0 = len(pos), len(neg)
    return (rank_sum_pos - n1 * (n1 + 1) / 2.0) / (n1 * n0)


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def std(xs):
    if len(xs) < 2:
        return None
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def american_profit(odds_str):
    """Profit per 1-unit stake on a win at American odds; None if unparsable."""
    if odds_str is None:
        return None
    s = str(odds_str).strip().replace("−", "-")
    if not s or s.upper() in ("N/A", "TBD"):
        return None
    try:
        v = int(float(s.replace("+", "")))
    except ValueError:
        return None
    if v == 0:
        return None
    return 100.0 / abs(v) if v < 0 else v / 100.0


def parse_start_ms(iso):
    if not iso:
        return None
    try:
        s = str(iso).replace("Z", "+00:00")
        return int(datetime.datetime.fromisoformat(s).timestamp() * 1000)
    except ValueError:
        return None


def metric_block(rows):
    """rows: ledger dicts with p (float), actual (0/1). Returns metric dict."""
    scored = [r for r in rows if r["p"] is not None and r["actual"] is not None]
    out = {
        "n_pop": len(rows),
        "n_scored": len(scored),
        "n_missing_p": sum(1 for r in rows if r["p"] is None),
    }
    if not scored:
        return out
    ps = [r["p"] for r in scored]
    ys = [r["actual"] for r in scored]
    base = mean(ys)
    out["mean_p"] = round(mean(ps), 5)
    out["base_rate_nrfi"] = round(base, 5)
    picks = [r for r in scored if r["p"] != 0.5]
    hits = sum(1 for r in picks if (r["p"] > 0.5) == (r["actual"] == 1))
    out["n_picks"] = len(picks)
    out["n_none_p_half"] = len(scored) - len(picks)
    out["hits"] = hits
    if picks:
        hr = hits / len(picks)
        lo, hi = wilson(hits, len(picks))
        out["hit_rate"] = round(hr, 5)
        out["hit_ci_lo"] = round(lo, 5)
        out["hit_ci_hi"] = round(hi, 5)
        # two-sided normal test vs 0.5
        se = math.sqrt(0.25 / len(picks))
        out["hit_z_vs_coin"] = round((hr - 0.5) / se, 3)
    # pipeline convention: p==0.5 graded as YRFI pick
    alt_hits = sum(1 for r in scored if ((r["p"] > 0.5) == (r["actual"] == 1)))
    out["hit_rate_half_as_yrfi"] = round(alt_hits / len(scored), 5)
    briers = [(r["p"] - r["actual"]) ** 2 for r in scored]
    out["brier"] = round(mean(briers), 6)
    sd = std(briers)
    if sd:
        out["brier_minus_quarter_z"] = round((mean(briers) - 0.25) / (sd / math.sqrt(len(briers))), 3)
    out["brier_const_base"] = round(base * (1 - base) if 0 <= base <= 1 else None, 6)
    if out["brier_const_base"]:
        out["brier_skill_vs_base"] = round(1 - out["brier"] / out["brier_const_base"], 5)
    out["logloss"] = round(mean([logloss_one(r["p"], r["actual"]) for r in scored]), 6)
    ll_base = mean([logloss_one(base, y) for y in ys])
    out["logloss_const_base"] = round(ll_base, 6)
    a = auc([(r["p"], r["actual"]) for r in scored])
    out["auc"] = round(a, 5) if a is not None else None
    return out


def decile_reliability(rows, series, n_buckets=10):
    scored = sorted(
        (r for r in rows if r["p"] is not None and r["actual"] is not None),
        key=lambda r: (r["p"], r["game_id"]),
    )
    n = len(scored)
    out = []
    for b in range(n_buckets):
        lo = b * n // n_buckets
        hi = (b + 1) * n // n_buckets
        chunk = scored[lo:hi]
        if not chunk:
            continue
        mp = mean([r["p"] for r in chunk])
        ob = mean([r["actual"] for r in chunk])
        out.append({
            "series": series,
            "decile": b + 1,
            "n": len(chunk),
            "p_min": round(chunk[0]["p"], 4),
            "p_max": round(chunk[-1]["p"], 4),
            "mean_p": round(mp, 5),
            "obs_nrfi_rate": round(ob, 5),
            "gap_obs_minus_pred": round(ob - mp, 5),
        })
    return out


def ece(rel_rows):
    tot = sum(r["n"] for r in rel_rows)
    if not tot:
        return None
    return round(sum(r["n"] * abs(r["gap_obs_minus_pred"]) for r in rel_rows) / tot, 5)


def main():
    with open(RAW) as fh:
        raw = json.load(fh)
    ctx = raw["context"]
    games = raw["games"]
    replay = raw["replay"]
    linescores = {ls["gameId"]: ls for ls in raw["linescores"]}
    start_by_id = {int(k): v for k, v in raw["startTimeUtcByGamesId"].items()}
    grades = raw["grades"]

    versions = ctx["replay_versions_present"]
    series_short = {}
    for v in versions:
        short = v.split("-")[-1]  # p1 / p2 / p2d
        series_short[v] = short
    replay_by = {}  # (gameId, short) -> row
    for r in replay:
        replay_by[(r["gameId"], series_short[r["modelVersion"]])] = r

    grade_by = {}  # (gameId, series) -> grade row
    for g in grades:
        if g["source"] == "live_pregame":
            key = (g["gameId"], "live")
        else:
            key = (g["gameId"], series_short.get(g["modelVersion"], g["modelVersion"]))
        grade_by[key] = g

    all_series = ["live"] + [series_short[v] for v in versions]

    ledger = []
    crosschecks = []
    for g in sorted(games, key=lambda x: (x["gameDate"], x["id"])):
        gid = g["id"]
        ls = linescores.get(gid)
        inn1a = ls["inn1AwayRuns"] if ls else None
        inn1h = ls["inn1HomeRuns"] if ls else None
        ls_actual = None
        if inn1a is not None and inn1h is not None:
            ls_actual = 1 if (inn1a == 0 and inn1h == 0) else 0
        bin_actual = g["actualNrfiBinary"]
        str_actual = {"NRFI": 1, "YRFI": 0}.get(g["nrfiActualResult"])
        actual = ls_actual if ls_actual is not None else (bin_actual if bin_actual is not None else str_actual)
        actual_source = ("linescore" if ls_actual is not None
                         else "binary" if bin_actual is not None
                         else "string" if str_actual is not None else "none")
        bin_agree = None if (ls_actual is None or bin_actual is None) else int(ls_actual == bin_actual)
        str_agree = None if (str_actual is None or bin_actual is None) else int(str_actual == bin_actual)
        if bin_agree == 0:
            crosschecks.append({
                "type": "BIN_VS_LINESCORE", "game_id": gid, "date": g["gameDate"],
                "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                "detail": f'actualNrfiBinary={bin_actual} but inn1={inn1a}+{inn1h} -> linescore_actual={ls_actual}',
            })
        if str_agree == 0:
            crosschecks.append({
                "type": "STR_VS_BIN", "game_id": gid, "date": g["gameDate"],
                "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                "detail": f'nrfiActualResult={g["nrfiActualResult"]} vs actualNrfiBinary={bin_actual} '
                          f'(linescore inn1={inn1a}+{inn1h})',
            })

        start_ms = parse_start_ms(start_by_id.get(gid))
        run_at = g["modelRunAt"]
        leak = None
        if run_at is not None:
            leak = 1 if (start_ms is None or run_at >= start_ms) else 0

        for series in all_series:
            if series == "live":
                p = g["modelPNrfi"]
            else:
                rr = replay_by.get((gid, series))
                p = rr["pNrfi"] if rr else None
            pick = None
            correct = None
            brier = None
            ll = None
            if p is not None:
                pick = "NRFI" if p > 0.5 else ("YRFI" if p < 0.5 else "NONE")
            if p is not None and actual is not None:
                if pick != "NONE":
                    correct = int((p > 0.5) == (actual == 1))
                brier = round((p - actual) ** 2, 6)
                ll = round(logloss_one(p, actual), 6)

            gr = grade_by.get((gid, series))
            grade_prob = gr["prob"] if gr else None
            grade_correct = gr["correct"] if gr else None
            if gr and p is not None and grade_prob is not None and abs(grade_prob - p) > 1e-6:
                crosschecks.append({
                    "type": "GRADE_PROB_MISMATCH", "game_id": gid, "date": g["gameDate"],
                    "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                    "detail": f'series={series} ledger prob={grade_prob} vs source p={p}',
                })
            if gr and p is not None and actual is not None and grade_correct is not None:
                # pipeline convention: 0.5 -> YRFI
                pipe_correct = int((p > 0.5) == (actual == 1))
                if pipe_correct != grade_correct:
                    crosschecks.append({
                        "type": "GRADE_CORRECT_MISMATCH", "game_id": gid, "date": g["gameDate"],
                        "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                        "detail": f'series={series} ledger correct={grade_correct} vs re-derived '
                                  f'{pipe_correct} (p={p}, actual={actual})',
                    })

            row = {
                "game_id": gid,
                "mlb_game_pk": g["mlbGamePk"],
                "date": g["gameDate"],
                "month": g["gameDate"][:7],
                "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                "dh_game_no": g["gameNumber"],
                "series": series,
                "p": p,
                "pick": pick,
                "actual": actual,
                "actual_label": None if actual is None else ("NRFI" if actual == 1 else "YRFI"),
                "actual_source": actual_source,
                "inn1_away": inn1a,
                "inn1_home": inn1h,
                "bin_vs_linescore_agree": bin_agree,
                "str_vs_bin_agree": str_agree,
                "correct": correct,
                "brier": brier,
                "logloss": ll,
                "leakage_flag": leak if series == "live" else None,
                "book_nrfi_odds": g["nrfiOverOdds"] if series == "live" else None,
                "book_yrfi_odds": g["yrfiUnderOdds"] if series == "live" else None,
                "stored_correct": g["nrfiCorrect"] if series == "live" else None,
                "stored_brier": g["brierNrfi"] if series == "live" else None,
                "pipeline_grade_prob": grade_prob,
                "pipeline_grade_correct": grade_correct,
            }
            ledger.append(row)

        # stored-grade integrity (live only)
        if g["nrfiCorrect"] is not None and g["modelPNrfi"] is not None and actual is not None:
            rederived = int((g["modelPNrfi"] > 0.5) == (actual == 1))
            if rederived != g["nrfiCorrect"]:
                crosschecks.append({
                    "type": "STORED_CORRECT_MISMATCH", "game_id": gid, "date": g["gameDate"],
                    "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                    "detail": f'games.nrfiCorrect={g["nrfiCorrect"]} vs re-derived {rederived} '
                              f'(p={g["modelPNrfi"]}, actual={actual}, 0.5->YRFI convention)',
                })
        if g["brierNrfi"] is not None and g["modelPNrfi"] is not None and actual is not None:
            reb = (g["modelPNrfi"] - actual) ** 2
            if abs(reb - g["brierNrfi"]) > 1e-4:
                crosschecks.append({
                    "type": "STORED_BRIER_MISMATCH", "game_id": gid, "date": g["gameDate"],
                    "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
                    "detail": f'games.brierNrfi={g["brierNrfi"]} vs re-derived {round(reb, 6)} '
                              f'(p={g["modelPNrfi"]}, actual={actual})',
                })

    # ---- write ledger
    ledger_path = os.path.join(OUT_DIR, "nrfi-evaluator-ledger.csv")
    with open(ledger_path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(ledger[0].keys()))
        w.writeheader()
        for r in ledger:
            w.writerow({k: ("" if v is None else v) for k, v in r.items()})

    # ---- metric suite per series x month
    def rows_for(series, month=None, clean_only=False):
        rs = [r for r in ledger if r["series"] == series]
        if month:
            rs = [r for r in rs if r["month"] == month]
        if clean_only:
            rs = [r for r in rs if r["leakage_flag"] == 0]
        return rs

    months = sorted({r["month"] for r in ledger})
    metric_rows = []
    series_variants = [(s, False) for s in all_series] + [("live", True)]
    for series, clean in series_variants:
        label = "live_clean" if clean else series
        for month in ["ALL"] + months:
            rs = rows_for(series, None if month == "ALL" else month, clean_only=clean)
            mb = metric_block(rs)
            mb = {"series": label, "month": month, **mb}
            metric_rows.append(mb)
    metric_cols = ["series", "month", "n_pop", "n_scored", "n_missing_p", "mean_p",
                   "base_rate_nrfi", "n_picks", "n_none_p_half", "hits", "hit_rate",
                   "hit_ci_lo", "hit_ci_hi", "hit_z_vs_coin", "hit_rate_half_as_yrfi",
                   "brier", "brier_minus_quarter_z", "brier_const_base",
                   "brier_skill_vs_base", "logloss", "logloss_const_base", "auc"]
    with open(os.path.join(OUT_DIR, "nrfi-evaluator-monthly-metrics.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=metric_cols)
        w.writeheader()
        for r in metric_rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k, "")) for k in metric_cols})

    # ---- reliability deciles
    rel_rows = []
    ece_by_series = {}
    for series, clean in series_variants:
        label = "live_clean" if clean else series
        rs = rows_for(series, clean_only=clean)
        rr = decile_reliability(rs, label)
        rel_rows.extend(rr)
        ece_by_series[label] = ece(rr)
    with open(os.path.join(OUT_DIR, "nrfi-evaluator-reliability.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rel_rows[0].keys()))
        w.writeheader()
        for r in rel_rows:
            w.writerow(r)

    # ---- both-sides
    side_rows = []
    for series, clean in series_variants:
        label = "live_clean" if clean else series
        for month in ["ALL"] + months:
            rs = rows_for(series, None if month == "ALL" else month, clean_only=clean)
            for side in ["NRFI", "YRFI", "NONE"]:
                srs = [r for r in rs if r["pick"] == side and r["actual"] is not None]
                if not srs:
                    continue
                if side == "NONE":
                    wins = sum(1 for r in srs if r["actual"] == 0)  # informational: YRFI outcome
                    hr_ = None
                    lo = hi = None
                else:
                    wins = sum(1 for r in srs if r["correct"] == 1)
                    hr_ = wins / len(srs)
                    lo, hi = wilson(wins, len(srs))
                # ROI at book odds (live series only; odds coverage partial)
                n_odds = 0
                profit = 0.0
                if series == "live":
                    for r in srs:
                        odds = r["book_nrfi_odds"] if side == "NRFI" else (
                            r["book_yrfi_odds"] if side == "YRFI" else None)
                        pay = american_profit(odds)
                        if pay is None:
                            continue
                        n_odds += 1
                        won = (r["actual"] == 1) if side == "NRFI" else (r["actual"] == 0)
                        profit += pay if won else -1.0
                side_rows.append({
                    "series": label, "month": month, "pick_side": side,
                    "n": len(srs), "wins": wins,
                    "hit_rate": round(hr_, 5) if hr_ is not None else None,
                    "ci_lo": round(lo, 5) if lo is not None else None,
                    "ci_hi": round(hi, 5) if hi is not None else None,
                    "mean_p": round(mean([r["p"] for r in srs]), 5),
                    "obs_nrfi_rate": round(mean([r["actual"] for r in srs]), 5),
                    "n_with_book_odds": n_odds if series == "live" else None,
                    "flat_stake_profit_units": round(profit, 2) if n_odds else None,
                    "roi_at_book_odds": round(profit / n_odds, 5) if n_odds else None,
                })
    with open(os.path.join(OUT_DIR, "nrfi-evaluator-sides.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(side_rows[0].keys()))
        w.writeheader()
        for r in side_rows:
            w.writerow({k: ("" if v is None else v) for k, v in r.items()})

    # ---- crosschecks
    cc_path = os.path.join(OUT_DIR, "nrfi-evaluator-crosscheck.csv")
    with open(cc_path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["type", "game_id", "date", "teams", "detail"])
        w.writeheader()
        for r in crosschecks:
            w.writerow(r)

    cc_counts = {}
    for c in crosschecks:
        cc_counts[c["type"]] = cc_counts.get(c["type"], 0) + 1

    headline = {m["series"]: m for m in metric_rows if m["month"] == "ALL"}
    summary = {
        "run_context": ctx,
        "computed_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "series_evaluated": [lbl for _, lbl in
                             [((s, c), "live_clean" if c else s) for s, c in series_variants]],
        "n_ledger_rows": len(ledger),
        "headline_all_months": headline,
        "ece_by_series": ece_by_series,
        "crosscheck_counts": cc_counts,
        "notes": [
            "Grading substrate: mlb_replay_linescores inn1 runs (StatsAPI-derived); "
            "games.actualNrfiBinary agrees everywhere except rows in crosscheck CSV.",
            "live_clean = live series minus P-001 leakage-flagged games "
            "(modelRunAt >= startTimeUtc or start unknown).",
            "p==0.50 rows are NONE picks (excluded from hit_rate; included in Brier/logloss); "
            "hit_rate_half_as_yrfi replicates the running pipeline's 0.5->YRFI convention.",
            "mlb_replay_grades snapshot counts recorded in run_context; that ledger is being "
            "written by a running pipeline and incompleteness there is not a defect.",
        ],
    }
    with open(os.path.join(OUT_DIR, "nrfi-evaluator-summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2)

    print(json.dumps({
        "ledger_rows": len(ledger),
        "series": {s: sum(1 for r in ledger if r["series"] == s) for s in all_series},
        "crosscheck_counts": cc_counts,
        "headline": {k: {kk: v.get(kk) for kk in
                         ("n_scored", "n_picks", "hit_rate", "hit_ci_lo", "hit_ci_hi",
                          "brier", "logloss", "auc", "brier_skill_vs_base")}
                     for k, v in headline.items()},
        "ece_by_series": ece_by_series,
    }, indent=2))


if __name__ == "__main__":
    main()
