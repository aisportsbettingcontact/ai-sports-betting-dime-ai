#!/usr/bin/env python3
"""kprops-reinforcer-01-extract.py — REINFORCER extraction, kprops market group.

Full-population (no sampling) extraction for the K-props calibration-structure
synthesis. For EVERY final 2026 regular-season game (2026-03-25..2026-07-24)
and EVERY replay K-prop row (wf-19288f01-p1, the complete fixed-model series):

  1. Census of final games (population control total).
  2. p1 + p2 replay rows joined per (gameId, side).
  3. Actual starter Ks and realized starter outs from mlb_replay_linescores
     (the protocol substrate; fallback = live mlb_strikeout_props.actualKs,
     the same rule as tools/replay/calibrate_and_grade.py::actual_starter_ks).
  4. As-of model components recomputed through the replay run's own
     AsOfFeatureStore (tools/replay/asof_features.py) against the replay run's
     warm StatsAPI cache: pitcher_k9_blend, xfip_adj, opp_adj, ip_expected_asof,
     umpire_k_mod, book line. The recomputed lambda is checked against the
     stored p1 projValue row-by-row (fidelity gate).
  5. Live-series context columns (kProj, bookLine, actualKs) per (gameId, side).
  6. Snapshot of the monthly walk-forward k_factors from calibMeta (p2) and of
     the mlb_replay_grades k_prop series counts at run time (ledger is being
     written by a running pipeline; the snapshot documents what existed).

Read-only: SET SESSION TRANSACTION READ ONLY on both connections (the analysis
connection and the AsOfFeatureStore's internal connection).

Outputs (granular/kprops/):
  kprops-reinforcer-population.csv     one row per replay K-prop (gameId, side)
  kprops-reinforcer-kfactors.csv       monthly k_factor from p2 calibMeta
  kprops-reinforcer-grades-snapshot.csv  run-time mlb_replay_grades k_prop counts
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import time

import pymysql
import pymysql.cursors

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "kprops"))
AUDIT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPLAY_TOOLS = os.path.join(AUDIT_ROOT, "tools", "replay")
# audit root = <scratchpad>/audit-worktree/docs/audits/mlb-model-audit-2026;
# the replay run's warm StatsAPI cache lives at <scratchpad>/statsapi-cache
CACHE_DIR = os.environ.get(
    "STATSAPI_CACHE_DIR",
    os.path.abspath(os.path.join(AUDIT_ROOT, "..", "..", "..", "..",
                                 "statsapi-cache")))
if not os.path.isdir(CACHE_DIR) or not os.listdir(CACHE_DIR):
    raise RuntimeError(f"StatsAPI cache dir missing/empty: {CACHE_DIR}")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, REPLAY_TOOLS)

SEASON_START, SEASON_END = "2026-03-25", "2026-07-24"
P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"

_URL_RE = re.compile(r"mysql2?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)")

# driver clamps (tools/replay/replay_driver.py)
K_MIN_XFIP_ADJ, K_MAX_XFIP_ADJ = 0.70, 1.40
K_MIN_OPP_ADJ, K_MAX_OPP_ADJ = 0.70, 1.40
K_MIN_IP, K_MAX_IP = 3.0, 7.0


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def connect() -> pymysql.connections.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    m = _URL_RE.match(url)
    if not m:
        raise RuntimeError("DATABASE_URL did not match mysql:// shape")
    conn = pymysql.connect(
        host=m.group(3), port=int(m.group(4) or 3306), user=m.group(1),
        password=m.group(2), database=m.group(5), ssl={"ssl": {}},
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    )
    _set_read_only(conn)
    return conn


def _set_read_only(conn):
    """Best-effort session read-only (TiDB may reject the noop form; the script
    issues SELECT statements only, either way)."""
    for stmt in ("SET SESSION TRANSACTION READ ONLY",
                 "SET SESSION transaction_read_only = 1"):
        try:
            with conn.cursor() as cur:
                cur.execute(stmt)
            return
        except Exception:
            continue
    print("[warn] session read-only not supported by server; script is SELECT-only",
          flush=True)


def qall(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def write_csv(path, rows, cols):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c) for c in cols])
    print(f"[out] {path}  rows={len(rows)}", flush=True)


def fnum(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main() -> int:
    t0 = time.time()
    conn = connect()

    # 1. population census
    games = qall(conn, """
        SELECT id AS gameId, gameDate, mlbGamePk FROM games
        WHERE sport='MLB' AND gameStatus='final' AND gameDate BETWEEN %s AND %s
        ORDER BY gameDate, id""", (SEASON_START, SEASON_END))
    n_pk = sum(1 for g in games if g["mlbGamePk"] is not None)
    print(f"[census] finals={len(games)} with_gamePk={n_pk}", flush=True)

    # 2. replay rows p1 + p2
    p1 = qall(conn, """
        SELECT gameId, gameDate, side, mlbamId, playerName, projValue, pOver, line
        FROM mlb_replay_prop_projections
        WHERE propType='K' AND modelVersion=%s
        ORDER BY gameDate, gameId, side""", (P1,))
    p2 = qall(conn, """
        SELECT gameId, side, projValue, pOver, line
        FROM mlb_replay_prop_projections
        WHERE propType='K' AND modelVersion=%s""", (P2,))
    p2_by_key = {(r["gameId"], r["side"]): r for r in p2}
    print(f"[replay] p1_rows={len(p1)} p2_rows={len(p2)}", flush=True)

    # 3. linescore substrate actuals
    ls = qall(conn, """
        SELECT gamePk, gameId, awayStarterId, homeStarterId,
               awayStarterKs, homeStarterKs, awayStarterOuts, homeStarterOuts
        FROM mlb_replay_linescores
        WHERE gameDate BETWEEN %s AND %s""", (SEASON_START, SEASON_END))
    ls_by_game = {r["gameId"]: r for r in ls}
    print(f"[substrate] linescore_rows={len(ls)}", flush=True)

    # live props context
    live = qall(conn, """
        SELECT sp.gameId, sp.side, sp.mlbamId, sp.kProj, sp.bookLine, sp.actualKs
        FROM mlb_strikeout_props sp
        JOIN games g ON g.id = sp.gameId
        WHERE g.sport='MLB' AND g.gameStatus='final'
          AND g.gameDate BETWEEN %s AND %s""", (SEASON_START, SEASON_END))
    live_by_key = {(r["gameId"], r["side"]): r for r in live}
    print(f"[live] live_prop_rows={len(live)}", flush=True)

    # 6a. monthly k_factors from p2 calibMeta
    kf_rows = []
    metas = qall(conn, """
        SELECT gameDate, calibMeta FROM mlb_replay_projections
        WHERE modelVersion=%s AND calibMeta IS NOT NULL""", (P2,))
    seen = {}
    for r in metas:
        try:
            meta = json.loads(r["calibMeta"])
        except Exception:
            continue
        key = meta.get("month") or str(r["gameDate"])[:7]
        e = seen.setdefault(key, {"period": key, "k_factor": meta.get("k_factor"),
                                  "seed": meta.get("seed"),
                                  "n_k_train": meta.get("n_k_train"),
                                  "k_method": meta.get("k_method"), "n_rows": 0,
                                  "conflicts": 0})
        e["n_rows"] += 1
        if e["k_factor"] != meta.get("k_factor"):
            e["conflicts"] += 1
    kf_rows = sorted(seen.values(), key=lambda e: e["period"])
    write_csv(os.path.join(OUT, "kprops-reinforcer-kfactors.csv"), kf_rows,
              ["period", "k_factor", "seed", "n_k_train", "k_method", "n_rows",
               "conflicts"])

    # 6b. grades snapshot (running pipeline — record what exists NOW)
    grades = qall(conn, """
        SELECT market, source, modelVersion, COUNT(*) AS n,
               MIN(gameDate) AS minDate, MAX(gameDate) AS maxDate,
               SUM(result='PUSH') AS pushes, SUM(correct=1) AS nCorrect,
               SUM(correct IS NOT NULL) AS nGraded
        FROM mlb_replay_grades WHERE market='k_prop'
        GROUP BY market, source, modelVersion ORDER BY source, modelVersion""")
    for g in grades:
        g["snapshotUtc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    write_csv(os.path.join(OUT, "kprops-reinforcer-grades-snapshot.csv"), grades,
              ["market", "source", "modelVersion", "n", "minDate", "maxDate",
               "pushes", "nCorrect", "nGraded", "snapshotUtc"])

    # 4. as-of components via the replay run's own feature store (warm cache)
    from asof_features import AsOfFeatureStore
    store = AsOfFeatureStore(CACHE_DIR)
    _set_read_only(store._conn)  # best-effort read-only on the store's conn too
    print(f"[store] cache_dir={CACHE_DIR} files={len(os.listdir(CACHE_DIR))}",
          flush=True)

    rows_out = []
    n_lam_mismatch = n_line_mismatch = n_fail = 0
    for i, r in enumerate(p1):
        gid, side = r["gameId"], r["side"]
        out = {
            "gameId": gid, "gameDate": str(r["gameDate"]),
            "month": str(r["gameDate"])[:7], "side": side,
            "mlbamId": r["mlbamId"], "playerName": r["playerName"],
            "projValue_p1": fnum(r["projValue"]), "pOver_p1": fnum(r["pOver"]),
            "line": fnum(r["line"]),
        }
        pr2 = p2_by_key.get((gid, side))
        out["projValue_p2"] = fnum(pr2["projValue"]) if pr2 else None
        out["pOver_p2"] = fnum(pr2["pOver"]) if pr2 else None

        # actuals: substrate first (calibrate_and_grade rule), live fallback
        lsr = ls_by_game.get(gid)
        a_ks = a_outs = None
        starter_match = None
        if lsr is not None:
            sid = lsr["awayStarterId"] if side == "away" else lsr["homeStarterId"]
            ks = lsr["awayStarterKs"] if side == "away" else lsr["homeStarterKs"]
            outs = lsr["awayStarterOuts"] if side == "away" else lsr["homeStarterOuts"]
            starter_match = int(sid == r["mlbamId"]) if r["mlbamId"] else None
            if ks is not None and (r["mlbamId"] is None or sid == r["mlbamId"]):
                a_ks, a_outs = float(ks), (float(outs) if outs is not None else None)
        lv = live_by_key.get((gid, side))
        if a_ks is None and lv is not None and lv["actualKs"] is not None:
            a_ks = fnum(lv["actualKs"])
        out["actualKs"] = a_ks
        out["actualOuts"] = a_outs
        out["starter_match"] = starter_match
        out["live_kProj"] = fnum(lv["kProj"]) if lv else None
        out["live_bookLine"] = fnum(lv["bookLine"]) if lv else None
        out["live_actualKs"] = fnum(lv["actualKs"]) if lv else None

        # as-of components (the driver's own path)
        try:
            ki = store.kprop_inputs(gid, side)
            meta = store.game_meta(gid)
            p = store.pitcher_asof(ki["mlbamId"], meta["startUtcMs"])
            xfip_adj = clamp(float(ki["xfip_adj"]), K_MIN_XFIP_ADJ, K_MAX_XFIP_ADJ)
            opp_adj = clamp(float(ki["opp_k9_samebasis"]) / float(ki["league_mean_k9_hand"]),
                            K_MIN_OPP_ADJ, K_MAX_OPP_ADJ)
            ip_exp = clamp(float(ki["ip_expected_asof"]), K_MIN_IP, K_MAX_IP)
            lam = float(ki["pitcher_k9_blend"]) * xfip_adj * opp_adj * (ip_exp / 9.0)
            out.update({
                "hand": ki["hand"],
                "pitcher_k9_blend": round(float(ki["pitcher_k9_blend"]), 4),
                "xfip_adj": round(xfip_adj, 4),
                "opp_adj": round(opp_adj, 4),
                "ip_expected": round(ip_exp, 4),
                "ip_expected_raw": round(float(ki["ip_expected_asof"]), 4),
                "umpire_k_mod": round(float(ki.get("umpire_k_mod") or 1.0), 4),
                "book_line_re": fnum(ki.get("book_line")),
                "lam_re": round(lam, 4),
                "src": p["source"], "starts_2026": p["starts_2026"],
                "ip_2026": p["ip_2026"],
            })
            pv1 = out["projValue_p1"]
            lam_match = int(pv1 is not None and abs(lam - pv1) <= 0.005)
            line_match = int((out["line"] is None and out["book_line_re"] is None)
                             or (out["line"] is not None and out["book_line_re"] is not None
                                 and abs(out["line"] - out["book_line_re"]) < 1e-9))
            out["lam_match"] = lam_match
            out["line_match"] = line_match
            n_lam_mismatch += 1 - lam_match
            n_line_mismatch += 1 - line_match
        except Exception as e:  # noqa: BLE001 — count and continue
            n_fail += 1
            out["lam_match"] = out["line_match"] = None
            print(f"[fail] game {gid} {side}: {type(e).__name__}: {e}", flush=True)

        rows_out.append(out)
        if (i + 1) % 200 == 0:
            print(f"[progress] {i + 1}/{len(p1)} rows "
                  f"({time.time() - t0:.0f}s, lam_mismatch={n_lam_mismatch}, "
                  f"line_mismatch={n_line_mismatch}, fail={n_fail})", flush=True)

    cols = ["gameId", "gameDate", "month", "side", "mlbamId", "playerName",
            "projValue_p1", "pOver_p1", "line", "projValue_p2", "pOver_p2",
            "actualKs", "actualOuts", "starter_match",
            "live_kProj", "live_bookLine", "live_actualKs",
            "hand", "pitcher_k9_blend", "xfip_adj", "opp_adj", "ip_expected",
            "ip_expected_raw", "umpire_k_mod", "book_line_re", "lam_re",
            "src", "starts_2026", "ip_2026", "lam_match", "line_match"]
    write_csv(os.path.join(OUT, "kprops-reinforcer-population.csv"), rows_out, cols)
    print(f"[fidelity] lam_mismatch={n_lam_mismatch} line_mismatch={n_line_mismatch} "
          f"component_fail={n_fail} of {len(p1)}", flush=True)
    print(f"[done] {time.time() - t0:.0f}s", flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
