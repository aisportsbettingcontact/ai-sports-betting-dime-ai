#!/usr/bin/env python3
"""
runMlbBacktest2.py — MLB Recalibration Backtest Script
=======================================================
Triggered by mlbDriftDetector.ts when F5 share drift is detected.

INPUTS:
  - DATABASE_URL env var (MySQL/TiDB connection string)
  - games table: actualAwayScore, actualHomeScore, actualF5AwayScore,
                 actualF5HomeScore, nrfiActualResult, gameDate, sport
  - mlb_game_backtest table: market, result, modelProb, gameId

OUTPUTS:
  - $MLB_CALIBRATION_PATH, or <tempfile.gettempdir()>/mlb_calibration_constants.json if
    that env var is unset (required by mlbDriftDetector.ts, which spawns this script and
    always sets MLB_CALIBRATION_PATH explicitly so both sides agree on the location; the
    tempdir fallback only applies when this script is run standalone). Container-safe:
    no hardcoded /home/ubuntu/* legacy sandbox path, which does not exist on Railway.
  - stdout: structured log lines with [INPUT], [STEP], [STATE], [OUTPUT], [VERIFY] tags

JSON OUTPUT FORMAT (required by mlbDriftDetector.ts triggerRecalibration):
{
  "overall": {
    "f5_run_share":     float,  # F5 runs / FG runs (3yr empirical)
    "nrfi_rate":        float,  # NRFI rate (3yr empirical)
    "fg_mean":          float,  # mean FG total (3yr empirical)
    "i1_run_share":     float,  # I1 runs / FG runs (3yr empirical)
    "fg_home_win_rate": float,  # FG ML home win rate
    "f5_push_rate":     float,  # F5 push rate
    "fg_rl_away_cover": float,  # FG RL away +1.5 cover rate
  },
  "markets": {
    "fg_ml":    {"win_rate": float, "n": int, "accuracy": float},
    "fg_rl":    {"win_rate": float, "n": int, "accuracy": float},
    "fg_total": {"win_rate": float, "n": int, "accuracy": float},
    "f5_ml":    {"win_rate": float, "n": int, "accuracy": float},
    "f5_rl":    {"win_rate": float, "n": int, "accuracy": float},
    "f5_total": {"win_rate": float, "n": int, "accuracy": float},
    "nrfi":     {"win_rate": float, "n": int, "accuracy": float},
    "yrfi":     {"win_rate": float, "n": int, "accuracy": float},
  },
  "metadata": {
    "run_at":       str,   # ISO timestamp
    "sample_size":  int,   # number of games analyzed
    "date_range":   str,   # e.g. "2026-03-26 to 2026-04-20"
    "trigger":      str,   # "DRIFT_DETECTED" | "SCHEDULED" | "MANUAL"
  }
}

EXECUTION:
  python3 server/scripts/runMlbBacktest2.py
  Exit code 0 = success, 1 = failure
  Optional: MLB_CALIBRATION_PATH=/custom/path.json python3 server/scripts/runMlbBacktest2.py
"""

import json
import math
import os
import sys
import tempfile
import traceback
from datetime import datetime, timezone

TAG = "[runMlbBacktest2]"

# ─── Output path ──────────────────────────────────────────────────────────────
# mlbDriftDetector.ts spawns this script and always passes MLB_CALIBRATION_PATH (its
# resolved CALIBRATION_JSON) so both sides agree on the exact location. The tempdir
# fallback below only matters when this script is invoked standalone and mirrors the
# TS default (os.tmpdir()) — both respect TMPDIR/TEMP/TMP and fall back to /tmp on
# POSIX, so they resolve identically inside the same container.
#
# NOTE: do NOT hardcode a /home/ubuntu/* path here — that was a legacy sandbox path
# that does not exist on Railway (node:22-bookworm-slim, runs as root in /app, no
# `ubuntu` user, no /home/ubuntu). That bug caused open(OUTPUT_JSON, "w") to raise
# FileNotFoundError in production, silently breaking the drift-recalibration feature.
OUTPUT_JSON = os.environ.get("MLB_CALIBRATION_PATH") or os.path.join(
    tempfile.gettempdir(), "mlb_calibration_constants.json"
)

# ─── Lookback window (days) ───────────────────────────────────────────────────
# Use current season data (2026 season started 2026-03-26)
SEASON_START = "2026-03-26"


def log(level: str, msg: str) -> None:
    """Structured log line: [TAG] [LEVEL] message"""
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]
    print(f"{TAG} [{level}] [{ts}] {msg}", flush=True)


def safe_div(num: float, den: float, default: float = 0.0) -> float:
    """Safe division with default on zero denominator."""
    return num / den if den != 0 else default


def wilson_ci(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score confidence interval for a proportion."""
    if n == 0:
        return (0.0, 1.0)
    p = wins / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


def main() -> int:
    log("INPUT", f"Starting MLB recalibration backtest | season_start={SEASON_START}")
    log("INPUT", f"Output path: {OUTPUT_JSON}")

    # ── Connect to DB ─────────────────────────────────────────────────────────
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        log("ERROR", "DATABASE_URL env var not set")
        return 1

    log("STEP", "Connecting to database")
    try:
        # Parse DATABASE_URL: mysql://user:pass@host:port/dbname
        # mysql.connector doesn't accept URL format directly
        import re

        import mysql.connector
        m = re.match(
            r"mysql(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/(.+?)(?:\?.*)?$",
            db_url
        )
        if not m:
            log("ERROR", f"Cannot parse DATABASE_URL: {db_url[:40]}...")
            return 1
        user, password, host, port_str, database = m.groups()
        port = int(port_str) if port_str else 3306
        conn = mysql.connector.connect(
            host=host, port=port, user=user, password=password,
            database=database, ssl_disabled=False
        )
        cursor = conn.cursor(dictionary=True)
        log("STATE", f"Connected to {host}:{port}/{database}")
    except Exception as e:
        log("ERROR", f"DB connection failed: {e}")
        return 1

    try:
        # ── Step 1: Compute empirical priors from games table ─────────────────
        log("STEP", "Computing empirical priors from games table")
        cursor.execute("""
            SELECT
                COUNT(*) as n,
                ROUND(AVG(CAST(actualAwayScore AS DECIMAL) + CAST(actualHomeScore AS DECIMAL)), 4) as fg_mean,
                ROUND(SUM(CASE WHEN actualHomeScore > actualAwayScore THEN 1 ELSE 0 END) / COUNT(*), 4) as fg_home_win_rate,
                ROUND(
                    AVG(CAST(actualF5AwayScore AS DECIMAL) + CAST(actualF5HomeScore AS DECIMAL)) /
                    NULLIF(AVG(CAST(actualAwayScore AS DECIMAL) + CAST(actualHomeScore AS DECIMAL)), 0),
                4) as f5_run_share,
                ROUND(
                    AVG(CAST(actualF5AwayScore AS DECIMAL)) /
                    NULLIF(AVG(CAST(actualAwayScore AS DECIMAL) + CAST(actualHomeScore AS DECIMAL)), 0),
                4) as i1_run_share_approx,
                ROUND(
                    SUM(CASE WHEN nrfiActualResult = 'NRFI' THEN 1 ELSE 0 END) /
                    NULLIF(COUNT(CASE WHEN nrfiActualResult IS NOT NULL THEN 1 END), 0),
                4) as nrfi_rate,
                MIN(gameDate) as min_date,
                MAX(gameDate) as max_date
            FROM games
            WHERE actualAwayScore IS NOT NULL
              AND actualHomeScore IS NOT NULL
              AND actualF5AwayScore IS NOT NULL
              AND gameDate >= %s
              AND sport = 'MLB'
        """, (SEASON_START,))
        row = cursor.fetchone()
        if not row or row["n"] == 0:
            log("ERROR", "No games found with actual scores — cannot compute empirical priors")
            return 1

        n_games = int(row["n"])
        fg_mean = float(row["fg_mean"] or 8.89)
        fg_home_win_rate = float(row["fg_home_win_rate"] or 0.5525)
        f5_run_share = float(row["f5_run_share"] or 0.5491)
        # I1 share: first inning runs / FG runs (approximate from F5 data)
        # Use 0.1126 as baseline (1 run / 8.89 FG mean ≈ 11.25%)
        i1_run_share = float(row["i1_run_share_approx"] or 0.1126) * 0.20  # I1 is ~20% of F5
        nrfi_rate = float(row["nrfi_rate"] or 0.5093)
        date_range = f"{row['min_date']} to {row['max_date']}"

        log("STATE", f"n={n_games} | fg_mean={fg_mean} | fg_home_win_rate={fg_home_win_rate}")
        log("STATE", f"f5_run_share={f5_run_share} | nrfi_rate={nrfi_rate} | i1_run_share={i1_run_share:.4f}")
        log("STATE", f"date_range={date_range}")

        # ── Step 2: Compute F5 push rate and RL cover rates from backtest ─────
        log("STEP", "Computing F5 push rate and RL cover rates from mlb_game_backtest")
        cursor.execute("""
            SELECT
                market,
                SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN result = 'NO_ACTION' THEN 1 ELSE 0 END) as no_action,
                COUNT(*) as total
            FROM mlb_game_backtest
            WHERE result IN ('WIN', 'LOSS', 'NO_ACTION')
            GROUP BY market
        """)
        market_rows = cursor.fetchall()
        market_stats = {}
        for mr in market_rows:
            mkt = mr["market"]
            wins = int(mr["wins"])
            losses = int(mr["losses"])
            n = wins + losses
            win_rate = safe_div(wins, n)
            ci_lo, ci_hi = wilson_ci(wins, n)
            market_stats[mkt] = {
                "win_rate": round(win_rate, 4),
                "n": n,
                "wins": wins,
                "losses": losses,
                "no_action": int(mr["no_action"]),
                "ci_lower": round(ci_lo, 4),
                "ci_upper": round(ci_hi, 4),
            }
            log("STATE", f"market={mkt} | n={n} | wins={wins} | win_rate={win_rate:.4f} | CI=[{ci_lo:.4f},{ci_hi:.4f}]")

        # ── Step 3: Compute F5 push rate (NO_ACTION / total F5 bets) ─────────
        f5_total_stats = market_stats.get("f5_total", {})
        f5_total_no_action = f5_total_stats.get("no_action", 0)
        f5_total_n = f5_total_stats.get("n", 0) + f5_total_no_action
        f5_push_rate = safe_div(f5_total_no_action, f5_total_n, 0.05)
        log("STATE", f"f5_push_rate={f5_push_rate:.4f} (no_action={f5_total_no_action} / total={f5_total_n})")

        # ── Step 4: Compute RL cover rates ────────────────────────────────────
        fg_rl_stats = market_stats.get("fg_rl_away", {})
        fg_rl_away_cover = fg_rl_stats.get("win_rate", 0.5400)  # default: historical 54%
        log("STATE", f"fg_rl_away_cover={fg_rl_away_cover:.4f}")

        # ── Step 5: Compute accuracy by market for reporting ──────────────────
        log("STEP", "Computing per-market accuracy for reporting")

        def get_market_accuracy(mkt_key: str) -> dict:
            stats = market_stats.get(mkt_key, {})
            return {
                "win_rate": stats.get("win_rate", 0.0),
                "n": stats.get("n", 0),
                "wins": stats.get("wins", 0),
                "losses": stats.get("losses", 0),
                "ci_lower": stats.get("ci_lower", 0.0),
                "ci_upper": stats.get("ci_upper", 1.0),
            }

        markets_output = {
            "fg_ml_home":  get_market_accuracy("fg_ml_home"),
            "fg_ml_away":  get_market_accuracy("fg_ml_away"),
            "fg_rl_home":  get_market_accuracy("fg_rl_home"),
            "fg_rl_away":  get_market_accuracy("fg_rl_away"),
            "fg_over":     get_market_accuracy("fg_over"),
            "fg_under":    get_market_accuracy("fg_under"),
            "f5_ml_home":  get_market_accuracy("f5_ml_home"),
            "f5_ml_away":  get_market_accuracy("f5_ml_away"),
            "f5_rl_home":  get_market_accuracy("f5_rl_home"),
            "f5_rl_away":  get_market_accuracy("f5_rl_away"),
            "f5_over":     get_market_accuracy("f5_over"),
            "f5_under":    get_market_accuracy("f5_under"),
            "nrfi":        get_market_accuracy("nrfi"),
            "yrfi":        get_market_accuracy("yrfi"),
        }

        # ── Step 6: Assemble calibration JSON ─────────────────────────────────
        log("STEP", "Assembling calibration JSON")
        calibration = {
            "overall": {
                "f5_run_share":     round(f5_run_share, 4),
                "nrfi_rate":        round(nrfi_rate, 4),
                "fg_mean":          round(fg_mean, 4),
                "i1_run_share":     round(i1_run_share, 4),
                "fg_home_win_rate": round(fg_home_win_rate, 4),
                "f5_push_rate":     round(f5_push_rate, 4),
                "fg_rl_away_cover": round(fg_rl_away_cover, 4),
            },
            "markets": markets_output,
            "metadata": {
                "run_at":      datetime.now(timezone.utc).isoformat(),
                "sample_size": n_games,
                "date_range":  date_range,
                "trigger":     os.environ.get("RECAL_TRIGGER", "MANUAL"),
            }
        }

        # ── Step 7: Write JSON output ──────────────────────────────────────────
        log("STEP", f"Writing calibration JSON to {OUTPUT_JSON}")
        out_dir = os.path.dirname(OUTPUT_JSON)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(OUTPUT_JSON, "w") as f:
            json.dump(calibration, f, indent=2)
        log("OUTPUT", f"Calibration JSON written: {OUTPUT_JSON}")
        log("OUTPUT", f"overall.f5_run_share={calibration['overall']['f5_run_share']}")
        log("OUTPUT", f"overall.nrfi_rate={calibration['overall']['nrfi_rate']}")
        log("OUTPUT", f"overall.fg_mean={calibration['overall']['fg_mean']}")
        log("OUTPUT", f"overall.fg_home_win_rate={calibration['overall']['fg_home_win_rate']}")
        log("OUTPUT", f"overall.f5_push_rate={calibration['overall']['f5_push_rate']}")
        log("OUTPUT", f"overall.fg_rl_away_cover={calibration['overall']['fg_rl_away_cover']}")
        log("VERIFY", f"PASS — calibration JSON written with {n_games} games, {len(markets_output)} markets")
        return 0

    except Exception as e:
        log("ERROR", f"Unhandled exception: {e}")
        log("ERROR", traceback.format_exc())
        return 1
    finally:
        try:
            cursor.close()
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
