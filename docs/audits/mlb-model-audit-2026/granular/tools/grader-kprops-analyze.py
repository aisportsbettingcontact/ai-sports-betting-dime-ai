#!/usr/bin/env python3
"""GRADER/kprops analysis: re-derive every live K-prop grade from raw actuals and diff vs
stored (post-B6 must be zero-mismatch or enumerated); verify actualKs against the
mlb_replay_linescores starter-K substrate for every side-matched prop; reconcile the
mlb_replay_grades k_prop ledger (live rows field-by-field, replay rows internal
consistency); reconcile the EX-SCRATCH-K (56) and EX-POSTPONED-PROP exemptions.

Inputs: TSVs produced by grader-kprops-extract.mjs + census/exemptions.csv.
Outputs: CSVs + summary JSON in granular/kprops/. Offline, stdlib only.
"""
import csv, json, math, os, sys, unicodedata
from collections import Counter, defaultdict

WORK = sys.argv[1] if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else None
EXEMPTIONS = sys.argv[3] if len(sys.argv) > 3 else None
if not (WORK and OUT and EXEMPTIONS):
    sys.exit("usage: grader-kprops-analyze.py <workDir> <outDir> <exemptions.csv>")
os.makedirs(OUT, exist_ok=True)

SCOPE_LO, SCOPE_HI = "2026-03-25", "2026-07-24"
B6_LO, B6_HI = "2026-03-01", "2026-07-25"  # window the B6 regrade used

def read_tsv(name):
    with open(os.path.join(WORK, name), newline="") as f:
        rdr = csv.DictReader(f, delimiter="\t")
        return [{k: (None if v == "\\N" else v) for k, v in row.items()} for row in rdr]

def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None

def js_tofixed2(x):
    """Approximate JS (+x.toFixed(2)) for diff purposes; compare with tolerance anyway."""
    return float(f"{x:.2f}")

def norm_name(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().replace(".", " ").replace("-", " ").split())

props = read_tsv("props.tsv")
finals = read_tsv("finals.tsv")
linescores = read_tsv("linescores.tsv")
ledger = read_tsv("ledger_kprop.tsv")

ls_by_pk = {int(r["gamePk"]): r for r in linescores if r["gamePk"]}
ls_by_gameid = {int(r["gameId"]): r for r in linescores if r["gameId"]}

# ---------- exemptions ----------
scratch_ex = []   # (gamePk, normName) rows, code EX-SCRATCH-K
postponed_ex_gameids = set()
with open(EXEMPTIONS, newline="") as f:
    for row in csv.DictReader(f):
        if row["code"] == "EX-SCRATCH-K":
            scratch_ex.append({"gamePk": int(row["gamePk"]), "player": row["player"],
                               "norm": norm_name(row["player"]), "gameDate": row["gameDate"],
                               "matched_prop_ids": []})
        elif row["code"] == "EX-POSTPONED-PROP":
            # "K props x2 on games 2250432" -> games.id the props hang on
            for tok in row["player"].split():
                if tok.isdigit() and len(tok) >= 7:
                    postponed_ex_gameids.add(int(tok))
scratch_by_key = defaultdict(list)
for e in scratch_ex:
    scratch_by_key[(e["gamePk"], e["norm"])].append(e)

# ---------- pass 1: classify + re-derive every prop row ----------
full_rows = []
mismatches = []
substrate_rows = []
substrate_mismatches = []
cls_count = Counter()
grade_diff_count = Counter()

derived_by_id = {}

for p in props:
    pid = int(p["id"])
    game_status = p["gameStatus"]
    game_date = p["gameDate"]
    pk = int(p["mlbGamePk"]) if p["mlbGamePk"] else None
    kproj, line, aks = num(p["kProj"]), num(p["bookLine"]), num(p["actualKs"])
    p_over, p_under = num(p["pOver"]), num(p["pUnder"])
    stored_res, stored_corr, stored_err = p["backtestResult"], p["modelCorrect"], num(p["modelError"])

    # population class
    if game_status is None:
        cls = "no_game_row"
    elif p["sport"] != "MLB":
        cls = "non_mlb_game"
    elif game_status != "final":
        cls = "game_not_final"
    elif not (SCOPE_LO <= game_date <= SCOPE_HI):
        cls = "final_out_of_scope"
    else:
        cls = "final_in_scope"
    in_b6_universe = (game_status == "final" and p["sport"] == "MLB"
                      and B6_LO <= (game_date or "") <= B6_HI
                      and aks is not None and line is not None and kproj is not None)

    d_res = d_corr = d_err = None
    if in_b6_universe:
        d_err = js_tofixed2(kproj - aks)
        if aks == line:
            d_res, d_corr = "PUSH", None
        else:
            side = "OVER" if aks > line else "UNDER"
            d_res = side
            if p_over is not None and p_under is not None:
                pick = "OVER" if p_over > p_under else "UNDER"
            else:
                pick = "OVER" if kproj > line else "UNDER"
            d_corr = 1 if pick == side else 0
        derived_by_id[pid] = (d_res, d_corr, d_err)

    # grade diff
    diff_fields = []
    if in_b6_universe:
        if stored_res != d_res:
            diff_fields.append("backtestResult")
        sc = None if stored_corr is None else int(stored_corr)
        if sc != d_corr:
            diff_fields.append("modelCorrect")
        if stored_err is None or abs(stored_err - d_err) > 0.005001:
            diff_fields.append("modelError")
        grade_status = "MATCH" if not diff_fields else "MISMATCH"
    else:
        # not gradeable: any stored grade is an orphan grade
        if stored_res is not None or stored_corr is not None or stored_err is not None:
            grade_status = "ORPHAN_STORED_GRADE"
            diff_fields.append("grade_present_but_not_gradeable")
        else:
            grade_status = "NOT_GRADEABLE"

    # ungraded reason for in-scope finals lacking grades
    reason = ""
    if cls == "final_in_scope" and not in_b6_universe:
        if aks is None:
            key_pk = pk
            ex_hits = scratch_by_key.get((key_pk, norm_name(p["pitcherName"])), [])
            if ex_hits:
                reason = "EX-SCRATCH-K"
                for e in ex_hits:
                    e["matched_prop_ids"].append(pid)
            else:
                reason = "actualKs_null_unexempted"
        elif line is None:
            reason = "bookLine_null"
        elif kproj is None:
            reason = "kProj_null"
    if cls == "game_not_final" and int(p["gameId"]) in postponed_ex_gameids:
        reason = "EX-POSTPONED-PROP"

    cls_count[cls] += 1
    grade_diff_count[grade_status] += 1

    # substrate check (every prop on a game with a linescore row)
    sub_status, star_ks, star_id = "", None, None
    ls = ls_by_pk.get(pk) if pk else None
    if ls is None and p["gameId"]:
        ls = ls_by_gameid.get(int(p["gameId"]))
    if ls is not None:
        star_id = ls["awayStarterId"] if p["side"] == "away" else ls["homeStarterId"]
        star_ks = ls["awayStarterKs"] if p["side"] == "away" else ls["homeStarterKs"]
        star_id = int(star_id) if star_id else None
        star_ks = int(star_ks) if star_ks is not None else None
        mlbam = int(p["mlbamId"]) if p["mlbamId"] else None
        if mlbam is None:
            sub_status = "no_mlbam_id"
        elif star_id is None:
            sub_status = "no_substrate_starter"
        elif mlbam == star_id:
            if aks is None:
                sub_status = "SIDE_MATCH_actualKs_null"
            elif star_ks is None:
                sub_status = "SIDE_MATCH_substrate_ks_null"
            elif int(aks) == star_ks:
                sub_status = "SIDE_MATCH_KS_EQUAL"
            else:
                sub_status = "SIDE_MATCH_KS_DIFFER"
        else:
            sub_status = "SIDE_MISMATCH(scratch)"
    else:
        sub_status = "no_linescore"
    substrate_rows.append(sub_status)

    row_out = {
        "propId": pid, "gameId": p["gameId"], "gameDate": game_date, "gamePk": pk or "",
        "side": p["side"], "pitcher": p["pitcherName"], "mlbamId": p["mlbamId"] or "",
        "class": cls, "ungraded_reason": reason,
        "kProj": p["kProj"] or "", "bookLine": p["bookLine"] or "",
        "pOver": p["pOver"] or "", "pUnder": p["pUnder"] or "",
        "actualKs": "" if aks is None else int(aks),
        "stored_backtestResult": stored_res or "", "stored_modelCorrect": "" if stored_corr is None else stored_corr,
        "stored_modelError": p["modelError"] or "",
        "derived_backtestResult": d_res or "", "derived_modelCorrect": "" if d_corr is None else d_corr,
        "derived_modelError": "" if d_err is None else f"{d_err:.2f}",
        "grade_status": grade_status, "diff_fields": "|".join(diff_fields),
        "substrate_status": sub_status,
        "substrate_starterId": star_id or "", "substrate_starterKs": "" if star_ks is None else star_ks,
    }
    full_rows.append(row_out)
    if grade_status in ("MISMATCH", "ORPHAN_STORED_GRADE"):
        mismatches.append(row_out)
    if sub_status in ("SIDE_MATCH_KS_DIFFER", "SIDE_MATCH_substrate_ks_null"):
        substrate_mismatches.append(row_out)
    if sub_status == "SIDE_MATCH_actualKs_null" and cls == "final_in_scope":
        substrate_mismatches.append(row_out)

# scratch exemptions never matched to a prop
ex_recon = []
for e in scratch_ex:
    ex_recon.append({"code": "EX-SCRATCH-K", "gameDate": e["gameDate"], "gamePk": e["gamePk"],
                     "player": e["player"], "matched_prop_ids": "|".join(map(str, e["matched_prop_ids"])),
                     "n_matched": len(e["matched_prop_ids"]),
                     "status": "OK" if len(e["matched_prop_ids"]) >= 1 else "NO_PROP_MATCHED"})
postponed_matched = Counter()
for p in props:
    if int(p["gameId"]) in postponed_ex_gameids:
        postponed_matched[int(p["gameId"])] += 1
for gid in sorted(postponed_ex_gameids):
    ex_recon.append({"code": "EX-POSTPONED-PROP", "gameDate": "2026-04-29", "gamePk": "",
                     "player": f"games.id={gid}", "matched_prop_ids": "",
                     "n_matched": postponed_matched.get(gid, 0),
                     "status": "OK" if postponed_matched.get(gid, 0) == 2 else "UNEXPECTED_COUNT"})

# ---------- pass 2: ledger reconciliation ----------
props_by_id = {int(p["id"]): p for p in props}
live_rows = [r for r in ledger if r["source"] == "live_pregame"]
replay_rows = [r for r in ledger if r["source"] == "walkforward_replay"]
ledger_live_mismatches = []
live_refids = set()
for r in live_rows:
    ref = int(r["refId"])
    live_refids.add(ref)
    p = props_by_id.get(ref)
    issues = []
    if p is None:
        issues.append("refId_not_in_props")
    else:
        kproj, line, aks = num(p["kProj"]), num(p["bookLine"]), num(p["actualKs"])
        p_over, p_under = num(p["pOver"]), num(p["pUnder"])
        l_line, l_actual = num(r["line"]), num(r["actual"])
        l_prob, l_proj, l_serr = num(r["prob"]), num(r["projValue"]), num(r["signedError"])
        l_brier = num(r["brier"])
        if line is None or l_line is None or abs(l_line - line) > 1e-9:
            issues.append(f"line {r['line']} != bookLine {p['bookLine']}")
        if aks is None or l_actual is None or abs(l_actual - aks) > 1e-9:
            issues.append(f"actual {r['actual']} != actualKs {p['actualKs']}")
        if p_over is not None and (l_prob is None or abs(l_prob - p_over) > 5e-6):
            issues.append(f"prob {r['prob']} != pOver {p['pOver']}")
        if kproj is not None and (l_proj is None or abs(l_proj - kproj) > 5e-5):
            issues.append(f"projValue {r['projValue']} != kProj {p['kProj']}")
        if None not in (p_over, p_under):
            exp_pick = "OVER" if p_over > p_under else "UNDER"
            if r["pick"] != exp_pick:
                issues.append(f"pick {r['pick']} != derived {exp_pick}")
        if None not in (aks, line, kproj):
            if aks == line:
                exp_res, exp_corr = "PUSH", None
            else:
                a_side = "OVER" if aks > line else "UNDER"
                exp_res = "WIN" if r["pick"] == a_side else "LOSS"
                exp_corr = 1 if r["pick"] == a_side else 0
            if r["result"] != exp_res:
                issues.append(f"result {r['result']} != derived {exp_res}")
            l_corr = None if r["correct"] is None else int(r["correct"])
            if l_corr != exp_corr:
                issues.append(f"correct {r['correct']} != derived {exp_corr}")
            if l_serr is None or abs(l_serr - (kproj - aks)) > 5e-4:
                issues.append(f"signedError {r['signedError']} != kProj-actualKs {kproj-aks:.3f}")
            if p_over is not None and aks != line:
                y = 1.0 if aks > line else 0.0
                if l_brier is None or abs(l_brier - (p_over - y) ** 2) > 5e-6:
                    issues.append(f"brier {r['brier']} != (pOver-y)^2 {(p_over-y)**2:.6f}")
    if issues:
        ledger_live_mismatches.append({"ledgerId": r["id"], "refId": ref, "gameId": r["gameId"],
                                       "gameDate": r["gameDate"], "issues": "; ".join(issues)})

# graded props (post-B6, in B6 universe) that have no live ledger row
graded_prop_ids = set(derived_by_id.keys())
ledger_missing = sorted(graded_prop_ids - live_refids)
ledger_extra = sorted(live_refids - graded_prop_ids)

# replay internal consistency
replay_anom = []
replay_ver = Counter(r["modelVersion"] for r in replay_rows)
for r in replay_rows:
    l_line, l_actual = num(r["line"]), num(r["actual"])
    l_prob, l_proj, l_serr, l_brier = num(r["prob"]), num(r["projValue"]), num(r["signedError"]), num(r["brier"])
    issues = []
    if None in (l_line, l_actual, l_proj):
        issues.append("null_core_field")
    else:
        if l_actual == l_line:
            exp_res, exp_corr = "PUSH", None
        else:
            a_side = "OVER" if l_actual > l_line else "UNDER"
            exp_res = "WIN" if r["pick"] == a_side else "LOSS"
            exp_corr = 1 if r["pick"] == a_side else 0
        if r["result"] != exp_res:
            issues.append(f"result {r['result']} != derived {exp_res}")
        l_corr = None if r["correct"] is None else int(r["correct"])
        if l_corr != exp_corr:
            issues.append(f"correct {r['correct']} != derived {exp_corr}")
        if l_serr is not None and abs(l_serr - (l_proj - l_actual)) > 5e-4:
            issues.append(f"signedError {r['signedError']} != projValue-actual {l_proj-l_actual:.3f}")
        if l_prob is not None and l_brier is not None and l_actual != l_line:
            y = 1.0 if l_actual > l_line else 0.0
            if abs(l_brier - (l_prob - y) ** 2) > 5e-6:
                issues.append(f"brier {r['brier']} != (prob-y)^2")
    # substrate cross-check: replay ledger actual vs starterKs
    gid = int(r["gameId"]) if r["gameId"] else None
    ls = ls_by_gameid.get(gid)
    if ls is not None and r["pick"] in ("OVER", "UNDER") and l_actual is not None:
        pass  # side not stored on ledger row; skipped (refId -> replay prop table, out of GRADER live scope)
    if issues:
        replay_anom.append({"ledgerId": r["id"], "refId": r["refId"], "modelVersion": r["modelVersion"],
                            "gameId": r["gameId"], "gameDate": r["gameDate"], "issues": "; ".join(issues)})

# ---------- write outputs ----------
def write_csv(name, rows, fields):
    with open(os.path.join(OUT, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"[out] {name}: {len(rows)} rows")

FULL_FIELDS = ["propId","gameId","gameDate","gamePk","side","pitcher","mlbamId","class",
               "ungraded_reason","kProj","bookLine","pOver","pUnder","actualKs",
               "stored_backtestResult","stored_modelCorrect","stored_modelError",
               "derived_backtestResult","derived_modelCorrect","derived_modelError",
               "grade_status","diff_fields","substrate_status","substrate_starterId","substrate_starterKs"]
write_csv("kprops-grader-rederivation-full.csv", full_rows, FULL_FIELDS)
write_csv("kprops-grader-grade-mismatches.csv", mismatches, FULL_FIELDS)
write_csv("kprops-grader-substrate-mismatches.csv", substrate_mismatches, FULL_FIELDS)
write_csv("kprops-grader-exemption-reconciliation.csv", ex_recon,
          ["code","gameDate","gamePk","player","matched_prop_ids","n_matched","status"])
write_csv("kprops-grader-ledger-live-mismatches.csv", ledger_live_mismatches,
          ["ledgerId","refId","gameId","gameDate","issues"])
write_csv("kprops-grader-ledger-replay-anomalies.csv", replay_anom,
          ["ledgerId","refId","modelVersion","gameId","gameDate","issues"])

summary = {
    "population_props_total": len(props),
    "finals_in_scope": len(finals),
    "linescore_substrate_rows": len(linescores),
    "class_counts": dict(cls_count),
    "grade_status_counts": dict(grade_diff_count),
    "graded_universe_n": len(derived_by_id),
    "grade_mismatches": len([m for m in mismatches if m["grade_status"] == "MISMATCH"]),
    "orphan_stored_grades": len([m for m in mismatches if m["grade_status"] == "ORPHAN_STORED_GRADE"]),
    "substrate_status_counts": dict(Counter(substrate_rows)),
    "substrate_mismatches": len(substrate_mismatches),
    "scratch_exemptions_total": len(scratch_ex),
    "scratch_exemptions_unmatched": len([e for e in ex_recon if e["status"] == "NO_PROP_MATCHED"]),
    "postponed_exempt_gameids": sorted(postponed_ex_gameids),
    "ledger_live_rows": len(live_rows),
    "ledger_live_mismatch_rows": len(ledger_live_mismatches),
    "ledger_graded_props_missing_from_ledger": ledger_missing,
    "ledger_live_rows_not_in_graded_universe": ledger_extra,
    "ledger_replay_rows_by_version": dict(replay_ver),
    "ledger_replay_anomaly_rows": len(replay_anom),
    "derived_result_dist": dict(Counter(v[0] for v in derived_by_id.values())),
    "derived_correct_dist": dict(Counter(str(v[1]) for v in derived_by_id.values())),
}
with open(os.path.join(OUT, "kprops-grader-summary.json"), "w") as f:
    json.dump(summary, f, indent=1)
print(json.dumps(summary, indent=1))
