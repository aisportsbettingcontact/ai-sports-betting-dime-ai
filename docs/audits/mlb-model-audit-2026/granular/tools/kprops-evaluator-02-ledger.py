#!/usr/bin/env python
"""kprops-evaluator-02-ledger.py — K-props EVALUATOR granular audit, step 2: ledger + metrics.

Consumes granular/kprops/kprops-evaluator-raw.json (full-population extraction) and
census/exemptions.csv. Every grade below is RE-DERIVED from raw projections and actuals —
stored correctness flags are never trusted (M-103); they are cross-checked instead.

Grading rules (GRADING-REPORT.md, K prop):
  pick   = side of max(pOver, pUnder) for the live series (ties -> UNDER, counted);
           replay series store pOver only -> pick = OVER iff pOver > 0.5; if pOver is null,
           pick = OVER iff proj > line (same fallback chain as tools/replay/calibrate_and_grade.py
           grade_k_prop).
  actual = starter Ks for the LISTED pitcher. Substrate: mlb_replay_linescores starter Ks when
           the starter id matches the prop's mlbamId (or the prop has no mlbamId and the
           normalized starter name matches); else the stored mlb_strikeout_props.actualKs
           (flagged actualSource=stored).
  scratch/void: listed pitcher did not start (linescore starter id/name differs) -> the book
           voids the bet -> status VOID_SCRATCH, excluded from graded metrics, reconciled
           against census/exemptions.csv EX-SCRATCH-K.
  push   = actualKs == line (integer lines); correct NULL, brier NULL; signedError still real.
  signedError = proj - actualKs;  brier = (pOver - y)^2, y = 1 iff actual side is OVER.

Outputs (granular/kprops/):
  kprops-evaluator-ledger.csv            one row per prop x series (full population)
  kprops-evaluator-monthly-metrics.csv   series x month (+ALL) metric suite
  kprops-evaluator-linebucket-metrics.csv
  kprops-evaluator-hand-metrics.csv
  kprops-evaluator-underlean.csv         UNDER-lean fraction by series x month (+ live verdicts)
  kprops-evaluator-reliability.csv       pOver buckets vs observed over rate
  kprops-evaluator-scratch-accounting.csv  per-void rows + exemptions.csv reconciliation
  kprops-evaluator-crosscheck.csv        stored grades + mlb_replay_grades vs re-derivation
  kprops-evaluator-summary.json
"""
from __future__ import annotations

import csv
import json
import math
import os
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "kprops")
RAW_JSON = os.path.join(OUT_DIR, "kprops-evaluator-raw.json")
EXEMPT_CSV = os.path.join(AUDIT, "census", "exemptions.csv")


def norm_name(name: str) -> str:
    s = unicodedata.normalize("NFD", (name or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    for suf in (" jr.", " jr", " sr.", " sr", " iii", " ii", " iv"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    return "".join(c for c in s if c.isalpha())


def f(v):
    """Safe float from varchar/NULL."""
    if v is None:
        return None
    s = str(v).strip()
    if s in ("", "null", "None", "NULL", "\\N"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def brier(p, y):
    return (p - y) ** 2 if (p is not None and y is not None) else None


def logloss(p, y):
    if p is None or y is None:
        return None
    p = min(max(p, 1e-6), 1 - 1e-6)
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def line_bucket(line):
    if line is None:
        return "none"
    if line <= 3.5:
        return "<=3.5"
    if line <= 4.5:
        return "4.0-4.5"
    if line <= 5.5:
        return "5.0-5.5"
    if line <= 6.5:
        return "6.0-6.5"
    return ">=7.0"


def main():
    with open(RAW_JSON) as fh:
        raw = json.load(fh)
    ctx = raw["context"]
    games = {g["id"]: g for g in raw["games"]}
    pop_ids = {g["id"] for g in raw["games"]
               if g["gameStatus"] == "final" and g["mlbGamePk"] is not None}
    ls_by_gid = {r["gameId"]: r for r in raw["linescores"]}
    hand_by_mlbam = {int(k): v for k, v in raw["handByMlbam"].items()}
    hand_by_name = raw["handByName"]
    name_by_mlbam = {int(k): v for k, v in raw["nameByMlbam"].items()}

    live_by_key_id = {}      # (gameId, mlbamId) -> live row
    live_by_key_side = {}    # (gameId, side) -> live row
    for r in raw["live"]:
        if r["mlbamId"] is not None:
            live_by_key_id[(r["gameId"], r["mlbamId"])] = r
        live_by_key_side[(r["gameId"], r["side"])] = r

    # starter index: mlbamId -> [(gameDate, gameId, side)] for void-cause classification
    starts_by_pid = defaultdict(list)
    for gid, v in ls_by_gid.items():
        if v["awayStarterId"]:
            starts_by_pid[v["awayStarterId"]].append((v["gameDate"][:10], gid, "away"))
        if v["homeStarterId"]:
            starts_by_pid[v["homeStarterId"]].append((v["gameDate"][:10], gid, "home"))
    for k in starts_by_pid:
        starts_by_pid[k].sort()

    def classify_void(mlbam, game_id, side, game_date):
        """NEXTDAY_CONTAMINATION (K-1): listed pitcher = same-team starter on D+1;
        WRONG_GAME_SAME_DATE: listed pitcher started another game the same date;
        TRUE_SCRATCH: no start that date, next start >=2 days away or none."""
        if mlbam is None:
            return "UNKNOWN"
        starts = starts_by_pid.get(mlbam, [])
        g = games.get(game_id) or {}
        myteam = g.get("awayTeam") if side == "away" else g.get("homeTeam")
        import datetime as _dt
        d = _dt.date.fromisoformat(game_date)
        for sd, sgid, sside in starts:
            if sd == game_date and sgid != game_id:
                return "WRONG_GAME_SAME_DATE"
        for sd, sgid, sside in starts:
            if _dt.date.fromisoformat(sd) == d + _dt.timedelta(days=1):
                sg = games.get(sgid) or {}
                steam = sg.get("awayTeam") if sside == "away" else sg.get("homeTeam")
                if steam == myteam:
                    return "NEXTDAY_CONTAMINATION"
                return "OTHER_D+1_DIFF_TEAM"
        return "TRUE_SCRATCH"

    # ---------------- exemptions
    ex_scratch = {}   # (gamePk, normName) -> row
    ex_postponed = []
    with open(EXEMPT_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["code"] == "EX-SCRATCH-K":
                ex_scratch[(int(row["gamePk"]), norm_name(row["player"]))] = row
            elif row["code"] == "EX-POSTPONED-PROP":
                ex_postponed.append(row)

    # ---------------- per-row evaluation
    ledger = []
    accounting = []           # non-population props (accounting only)
    detected_void = {}        # (gamePk, normName) -> ledger row ref
    tie_picks = 0
    actual_disagree = []      # stored vs linescore actualKs disagreement (non-scratch)

    def resolve_hand(row, mlbam):
        h = (row.get("pitcherHand") or "").strip().upper()[:1]
        if h in ("L", "R"):
            return h
        if mlbam is not None and mlbam in hand_by_mlbam:
            return hand_by_mlbam[mlbam]
        nm = norm_name(row.get("pitcherName") or row.get("playerName") or "")
        return hand_by_name.get(nm, "U")

    def eval_row(series, ref_id, game_id, side, mlbam, pname, proj, line, line_src,
                 p_over, p_under, pick_mode, live_row):
        g = games.get(game_id)
        game_pk = g["mlbGamePk"] if g else None
        game_date = (g["gameDate"] if g else "")[:10]
        month = game_date[5:7]
        ls = ls_by_gid.get(game_id)

        # scratch detection (listed pitcher did not start)
        scratch = False
        scratch_basis = ""
        starter_id = starter_ks = None
        if ls is not None:
            starter_id = ls["awayStarterId"] if side == "away" else ls["homeStarterId"]
            starter_ks = ls["awayStarterKs"] if side == "away" else ls["homeStarterKs"]
            if starter_id is not None:
                if mlbam is not None:
                    if starter_id != mlbam:
                        scratch, scratch_basis = True, "mlbamId"
                else:
                    sn = norm_name(name_by_mlbam.get(starter_id, ""))
                    pn = norm_name(pname)
                    if sn and pn and sn != pn:
                        scratch, scratch_basis = True, "name"

        stored_aks = live_row.get("actualKs") if live_row else None
        aks = None
        actual_src = ""
        if not scratch:
            if starter_ks is not None:
                aks, actual_src = float(starter_ks), "linescore"
                if stored_aks is not None and float(stored_aks) != float(starter_ks):
                    actual_disagree.append((series, ref_id, game_id, side, pname,
                                            stored_aks, starter_ks))
            elif stored_aks is not None:
                aks, actual_src = float(stored_aks), "stored"

        # pick
        nonlocal tie_picks
        pick = None
        if pick_mode == "live":
            if p_over is not None and p_under is not None:
                if p_over == p_under:
                    tie_picks += 1
                pick = "OVER" if p_over > p_under else "UNDER"
            elif p_over is not None:
                pick = "OVER" if p_over > 0.5 else "UNDER"
            elif line is not None and proj is not None:
                pick = "OVER" if proj > line else "UNDER"
        else:  # replay
            if p_over is not None:
                pick = "OVER" if p_over > 0.5 else "UNDER"
            elif line is not None and proj is not None:
                pick = "OVER" if proj > line else "UNDER"

        # status
        if game_id not in pop_ids:
            status = "OUT_OF_POPULATION"
        elif scratch:
            status = "VOID_SCRATCH"
        elif proj is None:
            status = "NO_MODEL"
        elif line is None:
            status = "NO_LINE"
        elif aks is None:
            status = "NO_ACTUAL"
        elif aks == line:
            status = "PUSH"
        else:
            status = "GRADED"

        actual_side = None
        correct = None
        br = ll = None
        if status in ("GRADED", "PUSH") and aks is not None and line is not None:
            actual_side = "OVER" if aks > line else ("UNDER" if aks < line else "PUSH")
        if status == "GRADED" and pick is not None:
            y = 1 if actual_side == "OVER" else 0
            correct = 1 if pick == actual_side else 0
            br = brier(p_over, y)
            ll = logloss(p_over, y)
        se = (proj - aks) if (proj is not None and aks is not None and not scratch) else None

        ex_code = ""
        void_cause = ""
        if scratch:
            void_cause = classify_void(mlbam, game_id, side, game_date)
            if game_pk is not None:
                key = (game_pk, norm_name(pname))
                detected_void[key] = (series, ref_id, game_id, game_date, side, pname)
                if key in ex_scratch:
                    ex_code = "EX-SCRATCH-K"

        is_live = pick_mode == "live"
        row = {
            "series": series, "propRefId": ref_id, "gameId": game_id, "gamePk": game_pk,
            "gameDate": game_date, "month": month,
            "doubleHeader": (g or {}).get("doubleHeader"), "gameNumber": (g or {}).get("gameNumber"),
            "side": side, "mlbamId": mlbam, "pitcherName": pname,
            "hand": resolve_hand({"pitcherHand": (live_row or {}).get("pitcherHand") if is_live else None,
                                  "pitcherName": pname}, mlbam),
            "proj": proj, "line": line, "lineSource": line_src,
            "integerLine": (1 if (line is not None and float(line).is_integer()) else 0),
            "pOver": p_over, "pUnder": p_under, "pick": pick,
            "actualKs": aks, "actualSource": actual_src,
            "actualKsStored": stored_aks,
            "actualKsLinescore": starter_ks if not scratch else starter_ks,
            "starterId": starter_id,
            "actualSide": actual_side, "status": status, "correct": correct,
            "signedError": None if se is None else round(se, 3),
            "brier": None if br is None else round(br, 6),
            "logloss": None if ll is None else round(ll, 6),
            "scratchBasis": scratch_basis, "voidExemptionCode": ex_code,
            "voidCause": void_cause,
            "storedBacktestResult": (live_row or {}).get("backtestResult") if is_live else None,
            "storedModelCorrect": (live_row or {}).get("modelCorrect") if is_live else None,
            "verdict": (live_row or {}).get("verdict") if is_live else None,
            "anNoVigOverPct": f((live_row or {}).get("anNoVigOverPct")) if is_live else None,
        }
        if status == "OUT_OF_POPULATION":
            accounting.append(row)
        else:
            ledger.append(row)
        return row

    # live series
    for r in raw["live"]:
        eval_row("live", r["id"], r["gameId"], r["side"], r["mlbamId"], r["pitcherName"],
                 f(r["kProj"]), f(r["bookLine"]), "book",
                 f(r["pOver"]), f(r["pUnder"]), "live", r)

    # replay series (line fallback to the live book line, as the replay grader does)
    replay_out_of_pop = 0
    for r in raw["replay"]:
        line = f(r["line"])
        line_src = "replay_asof"
        if line is None:
            lr = live_by_key_id.get((r["gameId"], r["mlbamId"]))
            if lr is not None:
                line = f(lr["bookLine"])
                line_src = "live_fallback" if line is not None else ""
            else:
                line_src = ""
        live_row = live_by_key_id.get((r["gameId"], r["mlbamId"])) \
            or live_by_key_side.get((r["gameId"], r["side"]))
        if r["gameId"] not in pop_ids:
            replay_out_of_pop += 1
        eval_row(r["modelVersion"], r["id"], r["gameId"], r["side"], r["mlbamId"],
                 r["playerName"], f(r["projValue"]), line, line_src,
                 f(r["pOver"]), None, "replay", live_row)

    # ---------------- ledger CSV
    cols = ["series", "propRefId", "gameId", "gamePk", "gameDate", "month", "doubleHeader",
            "gameNumber", "side", "mlbamId", "pitcherName", "hand", "proj", "line",
            "lineSource", "integerLine", "pOver", "pUnder", "pick", "actualKs",
            "actualSource", "actualKsStored", "actualKsLinescore", "starterId", "actualSide",
            "status", "correct", "signedError", "brier", "logloss", "scratchBasis",
            "voidExemptionCode", "voidCause", "storedBacktestResult", "storedModelCorrect",
            "verdict", "anNoVigOverPct"]
    ledger.sort(key=lambda r: (r["series"], r["gameDate"], r["gameId"], r["side"]))
    with open(os.path.join(OUT_DIR, "kprops-evaluator-ledger.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in ledger:
            w.writerow({k: r.get(k) for k in cols})

    # ---------------- metric suite
    def metrics(rows):
        graded = [r for r in rows if r["status"] == "GRADED" and r["correct"] is not None]
        err = [r for r in rows if r["signedError"] is not None]
        n = len(graded)
        hits = sum(r["correct"] for r in graded)
        hr = hits / n if n else None
        ci = 1.96 * math.sqrt(hr * (1 - hr) / n) if n and hr is not None else None
        briers = [r["brier"] for r in graded if r["brier"] is not None]
        lls = [r["logloss"] for r in graded if r["logloss"] is not None]
        unders = [r for r in graded if r["pick"] == "UNDER"]
        overs = [r for r in graded if r["pick"] == "OVER"]
        out = {
            "n_rows": len(rows),
            "n_graded": n,
            "n_push": sum(1 for r in rows if r["status"] == "PUSH"),
            "n_void": sum(1 for r in rows if r["status"] == "VOID_SCRATCH"),
            "n_no_model": sum(1 for r in rows if r["status"] == "NO_MODEL"),
            "n_no_line": sum(1 for r in rows if r["status"] == "NO_LINE"),
            "n_no_actual": sum(1 for r in rows if r["status"] == "NO_ACTUAL"),
            "hit_rate": round(hr, 4) if hr is not None else None,
            "ci95": round(ci, 4) if ci is not None else None,
            "brier": round(sum(briers) / len(briers), 4) if briers else None,
            "log_loss": round(sum(lls) / len(lls), 4) if lls else None,
            "mae": round(sum(abs(r["signedError"]) for r in err) / len(err), 3) if err else None,
            "bias": round(sum(r["signedError"] for r in err) / len(err), 3) if err else None,
            "bias_ci95": round(1.96 * (pstdev([r["signedError"] for r in err])
                               / math.sqrt(len(err))), 3) if len(err) > 1 else None,
            "n_err": len(err),
            "under_pick_frac": round(len(unders) / n, 4) if n else None,
            "n_under": len(unders), "n_over": len(overs),
            "hit_under": round(sum(r["correct"] for r in unders) / len(unders), 4) if unders else None,
            "hit_over": round(sum(r["correct"] for r in overs) / len(overs), 4) if overs else None,
        }
        return out

    def pstdev(xs):
        m = sum(xs) / len(xs)
        return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))

    series_list = sorted({r["series"] for r in ledger},
                         key=lambda s: (s != "live", s))
    by_series = defaultdict(list)
    for r in ledger:
        by_series[r["series"]].append(r)

    monthly_rows = []
    for s in series_list:
        rows = by_series[s]
        months = sorted({r["month"] for r in rows})
        for m in ["ALL"] + months:
            sub = rows if m == "ALL" else [r for r in rows if r["month"] == m]
            monthly_rows.append({"series": s, "month": m, **metrics(sub)})
    mcols = list(monthly_rows[0].keys())
    with open(os.path.join(OUT_DIR, "kprops-evaluator-monthly-metrics.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=mcols)
        w.writeheader()
        w.writerows(monthly_rows)

    lb_rows = []
    for s in series_list:
        rows = [r for r in by_series[s]]
        for b in ["<=3.5", "4.0-4.5", "5.0-5.5", "6.0-6.5", ">=7.0"]:
            sub = [r for r in rows if line_bucket(r["line"]) == b]
            if not sub:
                continue
            mm = metrics(sub)
            mm["n_integer_line"] = sum(1 for r in sub if r["integerLine"] == 1)
            lb_rows.append({"series": s, "line_bucket": b, **mm})
    with open(os.path.join(OUT_DIR, "kprops-evaluator-linebucket-metrics.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(lb_rows[0].keys()))
        w.writeheader()
        w.writerows(lb_rows)

    hand_rows = []
    for s in series_list:
        for h in ["L", "R", "U"]:
            sub = [r for r in by_series[s] if r["hand"] == h]
            if not sub:
                continue
            hand_rows.append({"series": s, "hand": h, **metrics(sub)})
    with open(os.path.join(OUT_DIR, "kprops-evaluator-hand-metrics.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(hand_rows[0].keys()))
        w.writeheader()
        w.writerows(hand_rows)

    # ---------------- UNDER-lean (the 87% forcing question)
    ul_rows = []
    for s in series_list:
        rows = by_series[s]
        months = sorted({r["month"] for r in rows})
        for m in ["ALL"] + months:
            sub = rows if m == "ALL" else [r for r in rows if r["month"] == m]
            graded = [r for r in sub if r["status"] == "GRADED"]
            n = len(graded)
            n_under = sum(1 for r in graded if r["pick"] == "UNDER")
            rec = {
                "series": s, "month": m, "n_graded": n,
                "n_pick_under": n_under,
                "n_pick_over": sum(1 for r in graded if r["pick"] == "OVER"),
                "under_pick_frac": round(n_under / n, 4) if n else None,
            }
            if s == "live":
                verd = defaultdict(int)
                for r in sub:
                    v = (r["verdict"] or "").upper() or "NULL"
                    verd[v] += 1
                np_ = verd.get("OVER", 0) + verd.get("UNDER", 0)
                rec.update({
                    "n_verdict_over": verd.get("OVER", 0),
                    "n_verdict_under": verd.get("UNDER", 0),
                    "n_verdict_pass": verd.get("PASS", 0),
                    "n_verdict_other": sum(v for k, v in verd.items()
                                           if k not in ("OVER", "UNDER", "PASS")),
                    "verdict_under_share_nonpass": round(verd.get("UNDER", 0) / np_, 4) if np_ else None,
                })
            else:
                rec.update({"n_verdict_over": None, "n_verdict_under": None,
                            "n_verdict_pass": None, "n_verdict_other": None,
                            "verdict_under_share_nonpass": None})
            ul_rows.append(rec)
    with open(os.path.join(OUT_DIR, "kprops-evaluator-underlean.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(ul_rows[0].keys()))
        w.writeheader()
        w.writerows(ul_rows)

    # ---------------- reliability of pOver
    rel_rows = []
    for s in series_list:
        graded = [r for r in by_series[s]
                  if r["status"] == "GRADED" and r["pOver"] is not None
                  and r["actualSide"] in ("OVER", "UNDER")]
        for lo in [x / 10 for x in range(10)]:
            hi = lo + 0.1
            sub = [r for r in graded if lo <= r["pOver"] < hi] if lo < 0.9 else \
                  [r for r in graded if lo <= r["pOver"] <= 1.0]
            if not sub:
                continue
            obs = sum(1 for r in sub if r["actualSide"] == "OVER") / len(sub)
            rel_rows.append({
                "series": s, "p_over_bucket": f"[{lo:.1f},{hi:.1f})",
                "n": len(sub),
                "mean_p_over": round(sum(r["pOver"] for r in sub) / len(sub), 4),
                "observed_over_rate": round(obs, 4),
            })
    with open(os.path.join(OUT_DIR, "kprops-evaluator-reliability.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rel_rows[0].keys()))
        w.writeheader()
        w.writerows(rel_rows)

    # ---------------- scratch / void accounting + exemptions reconciliation
    acc_rows = []
    live_void = [r for r in ledger if r["series"] == "live" and r["status"] == "VOID_SCRATCH"]
    for r in live_void:
        key = (r["gamePk"], norm_name(r["pitcherName"]))
        acc_rows.append({
            "kind": "DETECTED_VOID", "series": r["series"], "propRefId": r["propRefId"],
            "gameDate": r["gameDate"], "gamePk": r["gamePk"], "gameId": r["gameId"],
            "side": r["side"], "player": r["pitcherName"], "scratchBasis": r["scratchBasis"],
            "starterId": r["starterId"], "voidCause": r["voidCause"],
            "inExemptions": 1 if key in ex_scratch else 0,
            "storedBacktestResult": r["storedBacktestResult"],
            "note": "listed pitcher did not start (re-derived)",
        })
    det_keys = {(r["gamePk"], norm_name(r["pitcherName"])) for r in live_void}
    for key, row in sorted(ex_scratch.items()):
        if key not in det_keys:
            acc_rows.append({
                "kind": "EXEMPTION_NOT_DETECTED", "series": "live", "propRefId": None,
                "gameDate": row["gameDate"], "gamePk": row["gamePk"], "gameId": None,
                "side": None, "player": row["player"], "scratchBasis": None, "starterId": None,
                "voidCause": None, "inExemptions": 1, "storedBacktestResult": None,
                "note": row["reason"],
            })
    # postponed-slate props (OUT_OF_POPULATION accounting)
    for r in accounting:
        acc_rows.append({
            "kind": "OUT_OF_POPULATION", "series": r["series"], "propRefId": r["propRefId"],
            "gameDate": r["gameDate"], "gamePk": r["gamePk"], "gameId": r["gameId"],
            "side": r["side"], "player": r["pitcherName"], "scratchBasis": None,
            "starterId": None, "voidCause": None, "inExemptions": None,
            "storedBacktestResult": r["storedBacktestResult"],
            "note": f'host game status={games.get(r["gameId"], {}).get("gameStatus")}',
        })
    acc_cols = ["kind", "series", "propRefId", "gameDate", "gamePk", "gameId", "side",
                "player", "scratchBasis", "starterId", "voidCause", "inExemptions",
                "storedBacktestResult", "note"]
    with open(os.path.join(OUT_DIR, "kprops-evaluator-scratch-accounting.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=acc_cols)
        w.writeheader()
        w.writerows(acc_rows)

    # ---------------- cross-checks
    xc_rows = []
    # (a) stored live grades vs re-derived
    live_rows = by_series.get("live", [])
    sr_mismatch = mc_mismatch = 0
    n_sr = n_mc = 0
    for r in live_rows:
        if r["status"] not in ("GRADED", "PUSH"):
            continue
        stored = (r["storedBacktestResult"] or "").upper()
        if stored in ("OVER", "UNDER", "PUSH") and r["actualSide"] is not None:
            n_sr += 1
            if stored != r["actualSide"]:
                sr_mismatch += 1
                xc_rows.append({"check": "stored_backtestResult_vs_rederived_actualSide",
                                "series": "live", "propRefId": r["propRefId"],
                                "gameId": r["gameId"], "gameDate": r["gameDate"],
                                "side": r["side"], "player": r["pitcherName"],
                                "stored": stored, "rederived": r["actualSide"],
                                "detail": f'line={r["line"]} aks={r["actualKs"]} src={r["actualSource"]}'})
        if r["storedModelCorrect"] is not None and r["status"] == "GRADED":
            n_mc += 1
            # stored modelCorrect grades kProj>=line vs actual side (K-8 semantics)
            model_side = "OVER" if (r["proj"] is not None and r["line"] is not None
                                    and r["proj"] >= r["line"]) else "UNDER"
            rederived_mc = 1 if model_side == r["actualSide"] else 0
            if int(r["storedModelCorrect"]) != rederived_mc:
                mc_mismatch += 1
    # (b) my grades vs mlb_replay_grades snapshot
    grades_by_key = {}
    for g in raw["grades"]:
        src = "live" if g["source"] == "live_pregame" else g["modelVersion"]
        grades_by_key[(src, g["refId"])] = g
    gr_checked = gr_result_mismatch = gr_correct_mismatch = 0
    for r in ledger:
        g = grades_by_key.get((r["series"], r["propRefId"]))
        if g is None:
            continue
        gr_checked += 1
        my_result = {"GRADED": ("WIN" if r["correct"] == 1 else "LOSS"),
                     "PUSH": "PUSH"}.get(r["status"])
        if r["status"] == "GRADED" and r["pick"] is None:
            my_result = None
        if (g["result"] or None) != my_result and (g["result"] or my_result):
            gr_result_mismatch += 1
            if len([x for x in xc_rows if x["check"] == "replay_grades_result"]) < 200:
                xc_rows.append({"check": "replay_grades_result", "series": r["series"],
                                "propRefId": r["propRefId"], "gameId": r["gameId"],
                                "gameDate": r["gameDate"], "side": r["side"],
                                "player": r["pitcherName"], "stored": g["result"],
                                "rederived": my_result,
                                "detail": f'status={r["status"]} line={r["line"]} aks={r["actualKs"]} '
                                          f'g.line={g["line"]} g.actual={g["actual"]}'})
        gc = g["correct"]
        if gc is not None and r["correct"] is not None and int(gc) != int(r["correct"]):
            gr_correct_mismatch += 1
    xc_cols = ["check", "series", "propRefId", "gameId", "gameDate", "side", "player",
               "stored", "rederived", "detail"]
    with open(os.path.join(OUT_DIR, "kprops-evaluator-crosscheck.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=xc_cols)
        w.writeheader()
        w.writerows(xc_rows)

    # ---------------- summary
    summary = {
        "run_context": ctx,
        "population_games": len(pop_ids),
        "ledger_rows": len(ledger),
        "series": {s: metrics(by_series[s]) for s in series_list},
        "under_lean": {s: next(r["under_pick_frac"] for r in ul_rows
                               if r["series"] == s and r["month"] == "ALL")
                       for s in series_list},
        "tie_picks_counted_as_under": tie_picks,
        "void_accounting": {
            "detected_void_live": len(live_void),
            "void_by_cause": dict(sorted(
                ((c, sum(1 for r in live_void if r["voidCause"] == c))
                 for c in {r["voidCause"] for r in live_void}), key=lambda x: -x[1])),
            "void_by_cause_by_month": {
                m: dict(sorted(((c, sum(1 for r in live_void
                                        if r["voidCause"] == c and r["month"] == m))
                                for c in {r["voidCause"] for r in live_void
                                          if r["month"] == m}), key=lambda x: -x[1]))
                for m in sorted({r["month"] for r in live_void})},
            "detected_in_exemptions": sum(1 for r in acc_rows
                                          if r["kind"] == "DETECTED_VOID" and r["inExemptions"] == 1),
            "detected_not_in_exemptions": sum(1 for r in acc_rows
                                              if r["kind"] == "DETECTED_VOID" and r["inExemptions"] == 0),
            "exemptions_not_detected": sum(1 for r in acc_rows
                                           if r["kind"] == "EXEMPTION_NOT_DETECTED"),
            "exemptions_total_scratch_k": len(ex_scratch),
            "out_of_population_props": len(accounting),
            "ex_postponed_prop_rows": len(ex_postponed),
        },
        "actual_source_counts": {
            s: {src: sum(1 for r in by_series[s] if r["actualSource"] == src)
                for src in ("linescore", "stored", "")}
            for s in series_list
        },
        "stored_vs_rederived": {
            "n_side_compared": n_sr, "side_label_mismatches": sr_mismatch,
            "n_modelCorrect_compared": n_mc, "modelCorrect_mismatches_vs_K8_rule": mc_mismatch,
            "stored_vs_linescore_actualKs_disagreements": len(actual_disagree),
        },
        "replay_grades_crosscheck": {
            "rows_matched": gr_checked,
            "result_mismatches": gr_result_mismatch,
            "correct_mismatches": gr_correct_mismatch,
            "snapshot_counts": ctx["replay_grade_snapshot_k_prop"],
        },
    }
    with open(os.path.join(OUT_DIR, "kprops-evaluator-summary.json"), "w") as fh:
        json.dump(summary, fh, indent=1)
    print(json.dumps(summary, indent=1, default=str))


if __name__ == "__main__":
    main()
