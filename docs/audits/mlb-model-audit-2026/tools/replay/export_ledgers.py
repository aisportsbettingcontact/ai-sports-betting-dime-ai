#!/usr/bin/env python3
"""Export per-game CSV ledgers from the replay grading tables (read-only vs the DB).

Outputs (under docs/audits/mlb-model-audit-2026/grading/):
  replay-ledger-<market>.csv   one row per game/prop per source per modelVersion,
                               straight from mlb_replay_grades: gameId, gameDate, refId,
                               source, modelVersion, pick, prob, projValue, line, actual,
                               result, correct, brier, signedError. refId is included so
                               prop rows (k_prop / hr_prop) stay uniquely identified.
  replay-applied-params.csv    per-game applied calibration params: gameId, gameDate,
                               modelVersion + the calibMeta JSON fields flattened
                               (nested dicts dotted, lists JSON-encoded), from the
                               per-slate pass-2 rows (modelVersion suffix -p2d) in
                               mlb_replay_projections.

Reuses the SafeConn/qall helpers from calibrate_and_grade (same DATABASE_URL contract).
"""

import argparse
import csv
import json
import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, THIS_DIR)

from calibrate_and_grade import AUDIT_DIR, MARKETS, connect_db, qall  # noqa: E402

GRADING_DIR = os.path.join(AUDIT_DIR, "grading")

LEDGER_COLS = ["gameId", "gameDate", "refId", "source", "modelVersion", "pick", "prob",
               "projValue", "line", "actual", "result", "correct", "brier",
               "signedError"]


def flatten_meta(meta, prefix=""):
    """Flatten a calibMeta dict: nested dicts get dotted keys, lists are JSON-encoded."""
    out = {}
    for k in meta:
        v = meta[k]
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten_meta(v, key + "."))
        elif isinstance(v, list):
            out[key] = json.dumps(v)
        else:
            out[key] = v
    return out


def export_grade_ledgers(conn):
    rows = qall(conn, """
        SELECT gameId, gameDate, market, refId, source, modelVersion, pick, prob,
               projValue, line, actual, result, correct, brier, signedError
        FROM mlb_replay_grades
        ORDER BY gameDate, gameId, refId, source, modelVersion""")
    by_market = {}
    for r in rows:
        by_market.setdefault(r["market"], []).append(r)
    os.makedirs(GRADING_DIR, exist_ok=True)
    written = []
    for market in MARKETS + sorted(set(by_market) - set(MARKETS)):
        mrows = by_market.get(market, [])
        if not mrows:
            continue
        path = os.path.join(GRADING_DIR, f"replay-ledger-{market}.csv")
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(LEDGER_COLS)
            for r in mrows:
                w.writerow([
                    r["gameId"], str(r["gameDate"]), r["refId"], r["source"],
                    r["modelVersion"], r["pick"], r["prob"], r["projValue"], r["line"],
                    r["actual"], r["result"], r["correct"], r["brier"],
                    r["signedError"],
                ])
        written.append(path)
        print(f"[ledger] {market}: {len(mrows)} rows -> {path}")
    return written


def export_applied_params(conn, version_like):
    rows = qall(conn, """
        SELECT gameId, gameDate, modelVersion, calibMeta
        FROM mlb_replay_projections
        WHERE modelVersion LIKE %s AND calibMeta IS NOT NULL
        ORDER BY gameDate, gameId""", (version_like,))
    flat_rows, cols, seen = [], [], set()
    for r in rows:
        try:
            meta = json.loads(r["calibMeta"])
        except (TypeError, json.JSONDecodeError):
            meta = {"calibMeta_parse_error": True}
        fr = {"gameId": r["gameId"], "gameDate": str(r["gameDate"]),
              "modelVersion": r["modelVersion"]}
        fr.update(flatten_meta(meta))
        flat_rows.append(fr)
        for k in fr:
            if k not in seen:
                seen.add(k)
                cols.append(k)
    os.makedirs(GRADING_DIR, exist_ok=True)
    path = os.path.join(GRADING_DIR, "replay-applied-params.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, restval="")
        w.writeheader()
        for fr in flat_rows:
            w.writerow(fr)
    print(f"[params] {len(flat_rows)} rows ({len(cols)} cols) -> {path}")
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--params-version-like", default="%-p2d",
                    help="mlb_replay_projections modelVersion LIKE pattern for "
                         "replay-applied-params.csv (default: %%-p2d, the per-slate "
                         "pass-2 namespace)")
    ap.add_argument("--skip-ledgers", action="store_true",
                    help="only write replay-applied-params.csv")
    ap.add_argument("--skip-params", action="store_true",
                    help="only write the per-market grade ledgers")
    args = ap.parse_args()

    conn = connect_db()
    if not args.skip_ledgers:
        export_grade_ledgers(conn)
    if not args.skip_params:
        export_applied_params(conn, args.params_version_like)
    conn.close()


if __name__ == "__main__":
    main()
