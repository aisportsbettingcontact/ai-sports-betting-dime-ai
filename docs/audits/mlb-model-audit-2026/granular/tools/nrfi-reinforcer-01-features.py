#!/usr/bin/env python
"""nrfi-reinforcer-01-features.py — NRFI REINFORCER step 1: full-population feature matrix.

Uses the replay pipeline's OWN AsOfFeatureStore.nrfi_features (tools/replay/asof_features.py)
plus a verbatim copy of calibrate_and_grade.nrfi_feature_vector, so the feature space is
byte-identical to what the stored wf-19288f01-p2 NRFI logistic consumed. READ-ONLY DB access.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk.

Outputs (granular/nrfi/):
  nrfi-reinforcer-features.csv    one row per game: ids/date/label/3 prob series/hands +
                                  the canonical union feature keyspace (blank = key absent,
                                  which the pipeline fit fills with 0.0)
  nrfi-reinforcer-runcontext.json population counts, replay-table snapshot at run time
  nrfi-reinforcer-calibmeta.json  stored p2 calibMeta NRFI sections (one per month)
"""
from __future__ import annotations

import csv
import datetime
import json
import os
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
REPLAY_DIR = os.path.join(AUDIT, "tools", "replay")
sys.path.insert(0, REPLAY_DIR)

import asof_features  # noqa: E402  (pipeline's own feature store)
from replay_db import connect  # noqa: E402

OUT_DIR = os.path.join(AUDIT, "granular", "nrfi")
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.dirname(AUDIT)))), "statsapi-cache")
# AUDIT = <worktree>/docs/audits/mlb-model-audit-2026 -> up 4 = <worktree>; cache sits next
# to the worktree in the scratchpad. Resolve defensively:
_SCRATCH = os.path.normpath(os.path.join(AUDIT, "..", "..", "..", ".."))
CACHE_DIR = os.path.join(_SCRATCH, "statsapi-cache")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"


def nrfi_feature_vector(feats):
    """VERBATIM copy of tools/replay/calibrate_and_grade.py::nrfi_feature_vector
    (lines 600-620) — the exact mapping the stored p2 logistic used."""
    out = {}
    for k, v in feats.items():
        lk = k.lower()
        if lk.endswith("id") or lk in ("gameid", "gamepk"):
            continue
        if isinstance(v, bool):
            out[k] = 1.0 if v else 0.0
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = float(v)
        elif isinstance(v, str) and v.upper() in ("L", "R", "S"):
            out[k] = 1.0 if v.upper() == "L" else 0.0
        elif isinstance(v, dict):
            for k2, v2 in v.items():
                if isinstance(v2, (int, float)) and not isinstance(v2, bool):
                    out[f"{k}.{k2}"] = float(v2)
    return out


def fnum(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    return float(v) if isinstance(v, (int, float)) else v


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if not os.path.isdir(CACHE_DIR):
        print(f"[warn] cache dir {CACHE_DIR} missing; creating", file=sys.stderr)
    store = asof_features.AsOfFeatureStore(CACHE_DIR)

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameNumber,
                       modelPNrfi, actualNrfiBinary, nrfiActualResult
                FROM games
                WHERE sport='MLB' AND gameStatus='final'
                  AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
                  AND mlbGamePk IS NOT NULL""")
            games = cur.fetchall()
            cur.execute(
                "SELECT gameId, modelVersion, pNrfi FROM mlb_replay_projections "
                "WHERE modelVersion IN (%s,%s)", (P1, P2))
            replay = cur.fetchall()
            cur.execute(
                "SELECT gameId, inn1AwayRuns, inn1HomeRuns, awayStarterHand, homeStarterHand "
                "FROM mlb_replay_linescores")
            ls = {r["gameId"]: r for r in cur.fetchall()}
            # run-context snapshots (mlb_replay_grades is being written by a live pipeline)
            cur.execute(
                "SELECT source, modelVersion, COUNT(*) n FROM mlb_replay_grades "
                "WHERE market='nrfi_yrfi' GROUP BY source, modelVersion")
            grades_snapshot = [dict(r) for r in cur.fetchall()]
            cur.execute(
                "SELECT modelVersion, COUNT(*) n, SUM(pNrfi IS NOT NULL) n_pnrfi "
                "FROM mlb_replay_projections GROUP BY modelVersion")
            proj_versions = [dict(r) for r in cur.fetchall()]
            # stored p2 calibMeta per month (distinct)
            cur.execute("""
                SELECT SUBSTRING(gameDate,1,7) m, MAX(gameId) gid
                FROM mlb_replay_projections WHERE modelVersion=%s GROUP BY m""", (P2,))
            month_rep = cur.fetchall()
            calib_by_month = {}
            for row in month_rep:
                cur.execute("SELECT calibMeta FROM mlb_replay_projections "
                            "WHERE modelVersion=%s AND gameId=%s", (P2, row["gid"]))
                r2 = cur.fetchone()
                meta = None
                if r2 and r2["calibMeta"]:
                    try:
                        full = json.loads(r2["calibMeta"])
                        meta = {k: v for k, v in full.items()
                                if k in ("month", "seed", "n_train_games", "fitted_on_months",
                                         "nrfi")}
                    except (ValueError, TypeError):
                        meta = {"raw_unparseable": True}
                calib_by_month[row["m"]] = meta
    finally:
        conn.close()

    p_by_ver = {P1: {}, P2: {}}
    for r in replay:
        p_by_ver[r["modelVersion"]][r["gameId"]] = fnum(r["pNrfi"])

    rows, failures = [], []
    union_keys = set()
    for g in sorted(games, key=lambda r: (str(r["gameDate"]), r["id"])):
        gid = g["id"]
        # label: linescore substrate primary (evaluator verified 1,555/1,555 agreement)
        lsr = ls.get(gid)
        y = None
        if lsr and lsr["inn1AwayRuns"] is not None and lsr["inn1HomeRuns"] is not None:
            y = 1 if (lsr["inn1AwayRuns"] + lsr["inn1HomeRuns"]) == 0 else 0
        elif g["actualNrfiBinary"] is not None:
            y = int(g["actualNrfiBinary"])
        elif g["nrfiActualResult"] in ("NRFI", "YRFI"):
            y = 1 if g["nrfiActualResult"] == "NRFI" else 0
        try:
            fv = nrfi_feature_vector(store.nrfi_features(gid))
        except Exception as e:  # noqa: BLE001 — record, don't die
            failures.append({"gameId": gid, "error": f"{e.__class__.__name__}: {e}"})
            fv = None
        row = {
            "game_id": gid,
            "game_pk": g["mlbGamePk"],
            "date": str(g["gameDate"])[:10],
            "month": str(g["gameDate"])[:7],
            "away": g["awayTeam"], "home": g["homeTeam"],
            "y_nrfi": y,
            "p_live": fnum(g["modelPNrfi"]),
            "p_p1": p_by_ver[P1].get(gid),
            "p_p2": p_by_ver[P2].get(gid),
            "away_hand": (lsr["awayStarterHand"] if lsr and lsr["awayStarterHand"] else "R"),
            "home_hand": (lsr["homeStarterHand"] if lsr and lsr["homeStarterHand"] else "R"),
            "_fv": fv,
        }
        if fv:
            union_keys.update(fv.keys())
        rows.append(row)

    feat_cols = sorted(union_keys)
    out_csv = os.path.join(OUT_DIR, "nrfi-reinforcer-features.csv")
    base_cols = ["game_id", "game_pk", "date", "month", "away", "home", "y_nrfi",
                 "p_live", "p_p1", "p_p2", "away_hand", "home_hand", "feat_ok"]
    with open(out_csv, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(base_cols + [f"feat.{k}" for k in feat_cols])
        for r in rows:
            fv = r.pop("_fv")
            vals = [r[c] for c in base_cols[:-1]] + [1 if fv is not None else 0]
            for k in feat_cols:
                v = fv.get(k) if fv else None
                vals.append("" if v is None else repr(v))
            w.writerow(vals)

    ctx = {
        "run_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "population_n": len(rows),
        "n_label_missing": sum(1 for r in rows if r["y_nrfi"] is None),
        "n_feature_failures": len(failures),
        "feature_failures": failures[:20],
        "n_feature_keys_union": len(feat_cols),
        "feature_keys_union": feat_cols,
        "n_p_live": sum(1 for r in rows if r["p_live"] is not None),
        "n_p_p1": sum(1 for r in rows if r["p_p1"] is not None),
        "n_p_p2": sum(1 for r in rows if r["p_p2"] is not None),
        "base_rate_nrfi": (sum(r["y_nrfi"] for r in rows if r["y_nrfi"] is not None)
                           / max(1, sum(1 for r in rows if r["y_nrfi"] is not None))),
        "mlb_replay_grades_nrfi_snapshot": grades_snapshot,
        "mlb_replay_projections_versions": proj_versions,
        "cache_dir": CACHE_DIR,
    }
    with open(os.path.join(OUT_DIR, "nrfi-reinforcer-runcontext.json"), "w") as fh:
        json.dump(ctx, fh, indent=2, default=str)
    with open(os.path.join(OUT_DIR, "nrfi-reinforcer-calibmeta.json"), "w") as fh:
        json.dump(calib_by_month, fh, indent=2, default=str)
    print(json.dumps({k: v for k, v in ctx.items()
                      if k not in ("feature_keys_union", "feature_failures")},
                     indent=2, default=str))


if __name__ == "__main__":
    main()
