#!/usr/bin/env python3
"""NRFI MODELER step 1 — full-population extraction for the p2 reproducibility audit.

Extracts, for ALL mlb_replay_projections rows of the p1/p2 series (the full 1,555-game
population):
  - p1 + p2 stored pNrfi and per-row calibMeta.nrfi block (p2)
  - the exact NRFI feature vector the pass-2 logistic saw, recomputed through the very
    code the pipeline ran: asof_features.AsOfFeatureStore.nrfi_features +
    calibrate_and_grade.nrfi_feature_vector (imported, not reimplemented)
  - actual-NRFI outcomes + finality via the DataAccess rules (games -> census -> linescores)

Outputs (JSON, consumed by nrfi-modeler-02-verify.py):
  granular/nrfi/nrfi-modeler-extract.json

Read-only: AsOfFeatureStore opens its own pymysql connection; this script executes only
SELECTs through it.  Invocation:
  DATABASE_URL=... venv/bin/python nrfi-modeler-01-extract.py
"""
import json
import os
import sys
import time

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIT_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", ".."))
REPLAY_DIR = os.path.join(AUDIT_DIR, "tools", "replay")
OUT_DIR = os.path.join(AUDIT_DIR, "granular", "nrfi")
CENSUS_CSV = os.path.join(AUDIT_DIR, "census", "game-universe.csv")
os.makedirs(OUT_DIR, exist_ok=True)
sys.path.insert(0, REPLAY_DIR)

import asof_features  # noqa: E402  (pipeline module, imported as-is)
from calibrate_and_grade import nrfi_feature_vector  # noqa: E402 (pipeline function)

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"

CACHE_DIR = os.environ.get(
    "STATSAPI_CACHE_DIR",
    os.path.join(os.environ.get("TMPDIR", "/tmp"), "statsapi-cache"))


def main():
    store = asof_features.AsOfFeatureStore(CACHE_DIR)

    p1_rows = store._q(
        "SELECT gameId, gameDate, pNrfi, asOfCutoffMs FROM mlb_replay_projections "
        "WHERE modelVersion=%s ORDER BY gameDate, gameId", (P1,))
    p2_rows = store._q(
        "SELECT gameId, gameDate, pNrfi, calibMeta FROM mlb_replay_projections "
        "WHERE modelVersion=%s ORDER BY gameDate, gameId", (P2,))
    print(f"[extract] p1 rows={len(p1_rows)} p2 rows={len(p2_rows)}", flush=True)

    # DataAccess actual-NRFI substrate (games -> linescores fallback) + census finality
    games = {r["id"]: r for r in store._q(
        "SELECT id, gameDate, gameStatus, actualNrfiBinary, nrfiActualResult "
        "FROM games WHERE sport='MLB' AND gameDate >= '2026-03-01'")}
    ls = {r["gameId"]: r for r in store._q(
        "SELECT gameId, inn1AwayRuns, inn1HomeRuns FROM mlb_replay_linescores")}
    census = {}
    with open(CENSUS_CSV) as f:
        lines = f.read().strip().split("\n")
    cols = lines[0].split(",")
    for line in lines[1:]:
        row = dict(zip(cols, line.split(",")))
        if row.get("gamesId"):
            census[int(row["gamesId"])] = row

    def is_final(gid):
        link = census.get(gid)
        if link and link.get("schedStatus"):
            return link["schedStatus"] == "complete"
        g = games.get(gid)
        return bool(g and g["gameStatus"] == "final")

    def actual_nrfi(gid):
        g = games.get(gid)
        if g:
            if g["actualNrfiBinary"] is not None:
                return int(g["actualNrfiBinary"])
            if g["nrfiActualResult"] in ("NRFI", "YRFI"):
                return 1 if g["nrfiActualResult"] == "NRFI" else 0
        l = ls.get(gid)
        if l and l["inn1AwayRuns"] is not None and l["inn1HomeRuns"] is not None:
            return 1 if (l["inn1AwayRuns"] + l["inn1HomeRuns"]) == 0 else 0
        return None

    out = {"p1_version": P1, "p2_version": P2, "games": []}
    t0 = time.time()
    for i, r in enumerate(p1_rows):
        gid = r["gameId"]
        feats = keys = vec = None
        err = None
        try:
            feats = store.nrfi_features(gid)
            keys, vec = nrfi_feature_vector(feats)
        except Exception as e:  # noqa: BLE001 — mirror pipeline tolerance, record it
            err = f"{e.__class__.__name__}: {e}"
        out["games"].append({
            "gameId": gid,
            "gameDate": str(r["gameDate"]),
            "p1_pNrfi": None if r["pNrfi"] is None else float(r["pNrfi"]),
            "asOfCutoffMs": int(r["asOfCutoffMs"]),
            "is_final": is_final(gid),
            "actual_nrfi": actual_nrfi(gid),
            "keys": keys, "vec": vec,
            "feats": {k: v for k, v in (feats or {}).items()},
            "feature_error": err,
        })
        if (i + 1) % 100 == 0:
            print(f"[extract] {i+1}/{len(p1_rows)} features "
                  f"({time.time()-t0:.0f}s)", flush=True)

    p2 = {}
    for r in p2_rows:
        meta = json.loads(r["calibMeta"]) if r["calibMeta"] else {}
        p2[r["gameId"]] = {
            "pNrfi": None if r["pNrfi"] is None else float(r["pNrfi"]),
            "gameDate": str(r["gameDate"]),
            "nrfi_meta": meta.get("nrfi"),
        }
    out["p2"] = p2

    dest = os.path.join(OUT_DIR, "nrfi-modeler-extract.json")
    with open(dest, "w") as f:
        json.dump(out, f)
    n_err = sum(1 for g in out["games"] if g["feature_error"])
    print(f"[extract] wrote {dest} games={len(out['games'])} "
          f"feature_errors={n_err} elapsed={time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
