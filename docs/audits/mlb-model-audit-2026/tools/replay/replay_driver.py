#!/usr/bin/env python3
"""
replay_driver.py — Phase 5 walk-forward replay, PASS 1 (raw fixed model).

Binding spec: docs/audits/mlb-model-audit-2026/REPLAY-PROTOCOL.md.

Per game:
  1. Imports server/MLBAIModel.py (the Phase 4 fixed revision) with
     DIME_FG_ML_HOME_EDGE / DIME_LEAGUE_ENV_MULT set from CLI args BEFORE
     import (both are read at module import time). Pass-1 defaults: 0.03 / 1.0.
  2. Calls project_game(**store.project_game_kwargs(game_id)) — seed 42,
     400k sims, the live engine's own configuration.
  3. Maps outputs → mlb_replay_projections:
       pAwayMl       = away_win_pct/100        (no-vig FG ML, post home-edge)
       projAwayScore = proj_away_runs            projHomeScore = proj_home_runs
       projTotal     = proj_total
       pOver         = over_pct/100            (no-vig P(over) at book ou_line
                                                when present, else model total_key)
       pAwayRl       = away_rl_cover_pct/100
       pF5AwayMl     = p_f5_away_win           (three-way no-vig)
       projF5Total   = exp_f5_total
       pF5Over       = p_f5_over                 pF5AwayRl = p_f5_away_rl
       pNrfi         = inning_p_neither_score[0] — the SIMULATION'S OWN inning-1
                       P(neither scores). Pass 1 deliberately does NOT use the
                       market-derived no-vig p_nrfi (prior-blended) nor the
                       rebuilt Phase 4 NRFI logistic (that is the NRFI
                       component / pass 2).
  4. K props (propType='K', one row per side with a starter) — the FIXED
     mlbKPropsModelService formula, calibration factor 1.0:
       lambda = pitcher_k9_blend * xfip_adj * opp_adj_samebasis * ip_expected/9
       opp_adj_samebasis = clamp(opp_k9_samebasis / league_mean_k9_hand, .70, 1.40)
       xfip_adj clamped .70–1.40; ip_expected clamped 3.0–7.0 (as-of IP mean,
       NOT the live line-anchored heuristic — documented protocol divergence).
       pOver = P(K > line), pUnder = P(K < line), Poisson, push mass excluded
       on integer lines; probabilities clamped .03–.85. projValue = raw lambda.
     DOCUMENTED DIVERGENCES from the live fixed service (per REPLAY-PROTOCOL):
       - no platoon composition adjustment (kprop_inputs carries no batter hands)
       - umpire_k_mod is provided by the store but NOT multiplied in — the fixed
         live K-props formula has no umpire term and the protocol's K section
         does not add one. It is recorded in calibMeta for auditability.
  5. HR props (propType='HR', one row per actual lineup batter, 9 per side) —
     the FIXED mlbHrPropsModelService per-AB formula, calibration factor 1.0:
       lambda = batter_hr_rate_asof * sqrt(pitcher_hr9_asof / 1.28)
                * park_hr_factor * 3.7347 (= 4.22 PA/G × 0.885 AB/PA)
       pOver  = clamp(1 - exp(-lambda), .04, .45)   [P(≥1 HR)]
       projValue = raw lambda; line = book_line where present else 0.5.
  6. Writes with modelVersion 'wf-<sha>-p1', provenance 'walkforward_replay',
     asOfCutoffMs = mlb_schedule_history.startTimeUtc (via store.game_meta),
     ON DUPLICATE KEY UPDATE.

Feature store: `from asof_features import AsOfFeatureStore` (the shared
leakage-audited interface). --stub swaps in asof_stub.StubAsOfFeatureStore
(league-average placeholders; smoke tests only — use a sentinel --sha and
delete the rows afterwards, e.g. via --cleanup).

CLI:
  --games 2251450,2251455 | --all-missing | --all     game selection
  --sha b0578e60                                      short git sha (passed in;
                                                      this tool never runs git)
  --limit N            cap game count
  --home-edge 0.03     → DIME_FG_ML_HOME_EDGE   (pass-1 default 0.03)
  --env-mult 1.0       → DIME_LEAGUE_ENV_MULT   (pass-1 default 1.0)
  --stub               use the smoke-test stub store
  --cache-dir PATH     StatsAPI JSON cache directory
  --cleanup            (stub only) delete this modelVersion's rows for the
                       processed games after the verification SELECT
DB writes: mlb_replay_projections + mlb_replay_prop_projections ONLY.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
sys.path.insert(0, HERE)

from replay_db import connect  # noqa: E402

# ── FIXED K-props formula constants (server/mlbKPropsModelService.ts) ─────────
K_MIN_XFIP_ADJ, K_MAX_XFIP_ADJ = 0.70, 1.40
K_MIN_OPP_ADJ, K_MAX_OPP_ADJ = 0.70, 1.40
K_MIN_IP, K_MAX_IP = 3.0, 7.0
K_MIN_P, K_MAX_P = 0.03, 0.85
K_CALIBRATION_FACTOR_PASS1 = 1.0   # protocol: pass-1 seed = raw fixed formula

# ── FIXED HR-props formula constants (server/mlbHrPropsModelService.ts) ──────
HR_LEAGUE_HR9 = 1.28               # the service's league HR/9 constant
HR_PLAYER_PA_PER_GAME = 4.22
HR_AB_PER_PA = 0.885
HR_PLAYER_AB_PER_GAME = HR_PLAYER_PA_PER_GAME * HR_AB_PER_PA  # ≈3.7347
HR_MIN_P, HR_MAX_P = 0.04, 0.45
HR_CALIBRATION_FACTOR_PASS1 = 1.0  # protocol: pass-1 seed = raw fixed formula


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ── Poisson (exact replication of the fixed TS helpers) ──────────────────────
def _poisson_pmf(k: int, lam: float) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    logp = -lam + k * math.log(lam)
    for i in range(1, k + 1):
        logp -= math.log(i)
    return math.exp(logp)


def _poisson_cdf(k: int, lam: float) -> float:
    if k < 0:
        return 0.0
    return min(sum(_poisson_pmf(i, lam) for i in range(k + 1)), 1.0)


def poisson_p_over(book_line: float, lam: float) -> float:
    """P(K > line). Integer lines: push mass (K == line) excluded."""
    return 1.0 - _poisson_cdf(math.floor(book_line), lam)


def poisson_p_under(book_line: float, lam: float) -> float:
    """P(K < line). Integer lines: push mass (K == line) excluded."""
    thr = int(book_line) - 1 if float(book_line).is_integer() else math.floor(book_line)
    return _poisson_cdf(thr, lam)


# ── DB upserts (allowed tables only) ─────────────────────────────────────────
PROJ_SQL = """
INSERT INTO mlb_replay_projections
  (gameId, gameDate, provenance, modelVersion, asOfCutoffMs,
   pAwayMl, projAwayScore, projHomeScore, projTotal, pOver, pAwayRl,
   pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, pNrfi, calibMeta)
VALUES (%(gameId)s, %(gameDate)s, 'walkforward_replay', %(modelVersion)s, %(asOfCutoffMs)s,
        %(pAwayMl)s, %(projAwayScore)s, %(projHomeScore)s, %(projTotal)s, %(pOver)s, %(pAwayRl)s,
        %(pF5AwayMl)s, %(projF5Total)s, %(pF5Over)s, %(pF5AwayRl)s, %(pNrfi)s, %(calibMeta)s)
ON DUPLICATE KEY UPDATE
  gameDate=VALUES(gameDate), provenance=VALUES(provenance), asOfCutoffMs=VALUES(asOfCutoffMs),
  pAwayMl=VALUES(pAwayMl), projAwayScore=VALUES(projAwayScore), projHomeScore=VALUES(projHomeScore),
  projTotal=VALUES(projTotal), pOver=VALUES(pOver), pAwayRl=VALUES(pAwayRl),
  pF5AwayMl=VALUES(pF5AwayMl), projF5Total=VALUES(projF5Total), pF5Over=VALUES(pF5Over),
  pF5AwayRl=VALUES(pF5AwayRl), pNrfi=VALUES(pNrfi), calibMeta=VALUES(calibMeta)
"""

PROP_SQL = """
INSERT INTO mlb_replay_prop_projections
  (gameId, gameDate, propType, mlbamId, playerName, side, provenance, modelVersion,
   projValue, pOver, line)
VALUES (%(gameId)s, %(gameDate)s, %(propType)s, %(mlbamId)s, %(playerName)s, %(side)s,
        'walkforward_replay', %(modelVersion)s, %(projValue)s, %(pOver)s, %(line)s)
ON DUPLICATE KEY UPDATE
  gameDate=VALUES(gameDate), playerName=VALUES(playerName), side=VALUES(side),
  provenance=VALUES(provenance), projValue=VALUES(projValue), pOver=VALUES(pOver),
  line=VALUES(line)
"""


def run_game(mlb_mod, store, conn, game_id: int, model_version: str, args) -> dict | None:
    meta = store.game_meta(game_id)
    if meta is None:
        print(f"[SKIP] game {game_id}: no substrate/schedule row (linescore backfill may still be running)")
        return None
    cutoff_ms = meta["startUtcMs"]
    label = f"{meta['away']}@{meta['home']} {meta['gameDate']}"

    # ── 1-2: raw fixed simulation ────────────────────────────────────────────
    kwargs = store.project_game_kwargs(game_id)
    kwargs["seed"] = 42
    kwargs.setdefault("verbose", False)
    result = mlb_mod.project_game(**kwargs)
    if not result.get("ok"):
        print(f"[FAIL] game {game_id} {label}: project_game error={result.get('error')}")
        return None

    calib_meta = {
        "pass": 1,
        "fg_ml_home_edge": args.home_edge,
        "league_env_mult": args.env_mult,
        "k_calibration_factor": K_CALIBRATION_FACTOR_PASS1,
        "hr_calibration_factor": HR_CALIBRATION_FACTOR_PASS1,
        "seed": 42,
        "sims": mlb_mod.SIMULATIONS,
        "nrfi_source": "sim_inning1_p_neither_score",
        "store": "STUB(asof_stub)" if getattr(store, "is_stub", False) else "asof_features",
    }

    # ── 3: map → mlb_replay_projections ──────────────────────────────────────
    proj_row = {
        "gameId": game_id,
        "gameDate": meta["gameDate"],
        "modelVersion": model_version,
        "asOfCutoffMs": cutoff_ms,
        "pAwayMl": round(result["away_win_pct"] / 100.0, 5),
        "projAwayScore": result["proj_away_runs"],
        "projHomeScore": result["proj_home_runs"],
        "projTotal": result["proj_total"],
        "pOver": round(result["over_pct"] / 100.0, 5),
        "pAwayRl": round(result["away_rl_cover_pct"] / 100.0, 5),
        "pF5AwayMl": result["p_f5_away_win"],
        "projF5Total": result["exp_f5_total"],
        "pF5Over": result["p_f5_over"],
        "pF5AwayRl": result["p_f5_away_rl"],
        "pNrfi": result["inning_p_neither_score"][0],
        "calibMeta": json.dumps(calib_meta),
    }

    prop_rows = []

    # ── 4: K props (fixed formula, factor 1.0) ───────────────────────────────
    for side, sp_key in (("away", "awayStarterId"), ("home", "homeStarterId")):
        if not meta.get(sp_key):
            continue
        ki = store.kprop_inputs(game_id, side)
        if not ki:
            continue
        xfip_adj = clamp(float(ki["xfip_adj"]), K_MIN_XFIP_ADJ, K_MAX_XFIP_ADJ)
        opp_adj = clamp(
            float(ki["opp_k9_samebasis"]) / float(ki["league_mean_k9_hand"]),
            K_MIN_OPP_ADJ, K_MAX_OPP_ADJ,
        )
        ip_exp = clamp(float(ki["ip_expected_asof"]), K_MIN_IP, K_MAX_IP)
        lam = (
            float(ki["pitcher_k9_blend"]) * xfip_adj * opp_adj * (ip_exp / 9.0)
            * K_CALIBRATION_FACTOR_PASS1
        )
        line = ki.get("book_line")
        p_over = p_under = None
        if line is not None:
            p_over = clamp(poisson_p_over(float(line), lam), K_MIN_P, K_MAX_P)
            p_under = clamp(poisson_p_under(float(line), lam), K_MIN_P, K_MAX_P)
        prop_rows.append({
            "gameId": game_id, "gameDate": meta["gameDate"], "propType": "K",
            "mlbamId": ki["mlbamId"], "playerName": ki["name"], "side": side,
            "modelVersion": model_version,
            "projValue": round(lam, 4),
            "pOver": round(p_over, 5) if p_over is not None else None,
            "line": line,
        })
        print(
            f"  [K ] {side:4s} {ki['name']} lam={lam:.3f} "
            f"(k9={ki['pitcher_k9_blend']:.2f} xfipAdj={xfip_adj:.3f} oppAdj={opp_adj:.3f} "
            f"ip={ip_exp:.2f} umpKmod={ki.get('umpire_k_mod', 1.0):.3f}[not applied]) "
            f"line={line} pOver={p_over if p_over is None else f'{p_over:.4f}'} "
            f"pUnder={p_under if p_under is None else f'{p_under:.4f}'}"
        )

    # ── 5: HR props (fixed per-AB formula, factor 1.0) ───────────────────────
    for hi in store.hrprop_inputs(game_id):
        pitcher_adj = math.sqrt(float(hi["pitcher_hr9_asof"]) / HR_LEAGUE_HR9)
        lam = (
            float(hi["batter_hr_rate_asof"]) * pitcher_adj * float(hi["park_hr_factor"])
            * HR_PLAYER_AB_PER_GAME * HR_CALIBRATION_FACTOR_PASS1
        )
        p_hr = clamp(1.0 - math.exp(-lam), HR_MIN_P, HR_MAX_P)
        line = hi.get("book_line")
        prop_rows.append({
            "gameId": game_id, "gameDate": meta["gameDate"], "propType": "HR",
            "mlbamId": hi["mlbamId"], "playerName": hi["name"], "side": hi["side"],
            "modelVersion": model_version,
            "projValue": round(lam, 4),
            "pOver": round(p_hr, 5),
            "line": line if line is not None else 0.5,
        })

    # ── 6: write ─────────────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute(PROJ_SQL, proj_row)
        for pr in prop_rows:
            cur.execute(PROP_SQL, pr)
    conn.commit()

    cutoff_iso = datetime.fromtimestamp(cutoff_ms / 1000, tz=timezone.utc).isoformat()
    n_hr = sum(1 for r in prop_rows if r["propType"] == "HR")
    n_k = sum(1 for r in prop_rows if r["propType"] == "K")
    print(
        f"[OK ] game {game_id} {label} cutoff={cutoff_iso} "
        f"pAwayMl={proj_row['pAwayMl']:.4f} projTotal={proj_row['projTotal']:.2f} "
        f"pOver={proj_row['pOver']:.4f} pNrfi={proj_row['pNrfi']:.4f} "
        f"F5(ml={proj_row['pF5AwayMl']:.4f} tot={proj_row['projF5Total']:.2f}) "
        f"props: K={n_k} HR={n_hr} ({result['elapsed_sec']}s)"
    )
    return proj_row


def select_games(conn, args, model_version: str) -> list[int]:
    if args.games:
        return [int(g) for g in args.games.split(",") if g.strip()]
    missing = (
        """ AND NOT EXISTS (SELECT 1 FROM mlb_replay_projections p
                            WHERE p.gameId = g.id AND p.modelVersion = %s)"""
        if args.all_missing else ""
    )
    sql = f"""
        SELECT g.id FROM games g
        JOIN mlb_replay_linescores r ON r.gamePk = g.mlbGamePk
        WHERE g.sport='MLB' AND g.gameStatus='final' AND g.mlbGamePk IS NOT NULL{missing}
        ORDER BY g.gameDate, g.id"""
    params: tuple = (model_version,) if args.all_missing else ()
    if args.limit:
        sql += " LIMIT %s"
        params = params + (args.limit,)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [row["id"] for row in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 5 walk-forward replay driver (pass 1)")
    sel = ap.add_mutually_exclusive_group(required=True)
    sel.add_argument("--games", help="comma-separated game ids")
    sel.add_argument("--all-missing", action="store_true",
                     help="all finals with substrate lacking a row for this modelVersion")
    sel.add_argument("--all", action="store_true", help="all finals with substrate")
    ap.add_argument("--sha", required=True,
                    help="short git sha of the fixed code (caller runs git, not this tool)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--home-edge", type=float, default=0.03,
                    help="DIME_FG_ML_HOME_EDGE (pass-1 default 0.03)")
    ap.add_argument("--env-mult", type=float, default=1.0,
                    help="DIME_LEAGUE_ENV_MULT (pass-1 default 1.0)")
    ap.add_argument("--stub", action="store_true",
                    help="use asof_stub.StubAsOfFeatureStore (smoke tests ONLY)")
    ap.add_argument("--cache-dir",
                    default=os.environ.get(
                        "STATSAPI_CACHE_DIR",
                        os.path.join(os.path.expanduser("~"), ".cache", "dime-statsapi-cache")),
                    help="StatsAPI JSON cache dir (default $STATSAPI_CACHE_DIR)")
    ap.add_argument("--cleanup", action="store_true",
                    help="(stub only) delete this run's rows after verification SELECT")
    args = ap.parse_args()

    # Env overrides MUST be set before MLBAIModel import (read at module import).
    os.environ["DIME_FG_ML_HOME_EDGE"] = str(args.home_edge)
    os.environ["DIME_LEAGUE_ENV_MULT"] = str(args.env_mult)
    sys.path.insert(0, os.path.join(REPO, "server"))
    import MLBAIModel as mlb_mod  # noqa: E402

    model_version = f"wf-{args.sha}-p1"
    print(f"[INIT] modelVersion={model_version} home_edge={args.home_edge} "
          f"env_mult={args.env_mult} sims={mlb_mod.SIMULATIONS} store={'STUB' if args.stub else 'asof_features'}")
    if args.cleanup and not args.stub:
        ap.error("--cleanup is only allowed with --stub (protects real replay rows)")

    if args.stub:
        from asof_stub import StubAsOfFeatureStore as Store
    else:
        from asof_features import AsOfFeatureStore as Store
    store = Store(args.cache_dir)
    conn = connect()

    game_ids = select_games(conn, args, model_version)
    print(f"[INIT] {len(game_ids)} game(s): {game_ids[:20]}{'...' if len(game_ids) > 20 else ''}")

    done, failed = [], []
    for gid in game_ids:
        try:
            row = run_game(mlb_mod, store, conn, gid, model_version, args)
            (done if row else failed).append(gid)
        except Exception as e:  # tolerate per-game failures in bulk runs
            conn.rollback()
            failed.append(gid)
            print(f"[FAIL] game {gid}: {type(e).__name__}: {e}")

    # ── verification SELECT for the games just written ───────────────────────
    if done:
        ph = ",".join(["%s"] * len(done))
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT gameId, gameDate, modelVersion, asOfCutoffMs, pAwayMl, projAwayScore,
                           projHomeScore, projTotal, pOver, pAwayRl, pF5AwayMl, projF5Total,
                           pF5Over, pF5AwayRl, pNrfi
                    FROM mlb_replay_projections
                    WHERE modelVersion = %s AND gameId IN ({ph}) ORDER BY gameId""",
                (model_version, *done))
            print("\n[VERIFY] mlb_replay_projections rows:")
            for r in cur.fetchall():
                print("  " + json.dumps(r, default=str))
            cur.execute(
                f"""SELECT propType, COUNT(*) n, MIN(projValue) mn, MAX(projValue) mx
                    FROM mlb_replay_prop_projections
                    WHERE modelVersion = %s AND gameId IN ({ph}) GROUP BY propType""",
                (model_version, *done))
            print("[VERIFY] mlb_replay_prop_projections summary:")
            for r in cur.fetchall():
                print("  " + json.dumps(r, default=str))
            cur.execute(
                f"""SELECT gameId, propType, side, mlbamId, playerName, projValue, pOver, line
                    FROM mlb_replay_prop_projections
                    WHERE modelVersion = %s AND gameId IN ({ph})
                    ORDER BY gameId, propType, side, mlbamId LIMIT 12""",
                (model_version, *done))
            print("[VERIFY] sample prop rows:")
            for r in cur.fetchall():
                print("  " + json.dumps(r, default=str))

    if args.cleanup and done:
        ph = ",".join(["%s"] * len(done))
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM mlb_replay_projections WHERE modelVersion=%s AND gameId IN ({ph})",
                        (model_version, *done))
            n1 = cur.rowcount
            cur.execute(f"DELETE FROM mlb_replay_prop_projections WHERE modelVersion=%s AND gameId IN ({ph})",
                        (model_version, *done))
            n2 = cur.rowcount
        conn.commit()
        print(f"[CLEANUP] deleted {n1} projection row(s), {n2} prop row(s) for {model_version}")

    print(f"\n[DONE] ok={len(done)} failed/skipped={len(failed)} modelVersion={model_version}")
    return 0 if done and not failed else (0 if done else 1)


if __name__ == "__main__":
    sys.exit(main())
