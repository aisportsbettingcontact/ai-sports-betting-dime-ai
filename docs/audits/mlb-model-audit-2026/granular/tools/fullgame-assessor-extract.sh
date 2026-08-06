#!/usr/bin/env bash
# fullgame-assessor-extract.sh — dump the FULL population needed for the fullgame
# residual-structure assessment (ASSESSOR role, 5x5 granular backtest).
# Read-only: everything goes through tools/db-query.mjs (statement allowlist +
# SESSION transaction_read_only=1).
#
# Usage: bash fullgame-assessor-extract.sh <output-dir>
set -euo pipefail

AUDIT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"   # .../docs/audits/mlb-model-audit-2026
DBQ="$AUDIT_DIR/tools/db-query.mjs"
OUT="${1:?usage: fullgame-assessor-extract.sh <output-dir>}"
mkdir -p "$OUT"

# A) Main per-game join: every final 2026 regular-season game in scope, with
#    live projections, actuals, book lines, starter hands (StatsAPI substrate),
#    and replay p1/p2 projections.
node "$DBQ" --json --quiet --out "$OUT/games-main.json" --sql "
SELECT g.id, g.gameDate, g.mlbGamePk, g.awayTeam, g.homeTeam, g.venue, g.startTimeEst,
       g.doubleHeader, g.gameNumber,
       g.bookTotal, g.awayML, g.homeML, g.awayRunLine,
       g.modelProjTotal, g.modelTotal, g.modelOverRate, g.modelAwayWinPct,
       g.modelAwayScore, g.modelHomeScore, g.modelRunAt,
       g.actualAwayScore, g.actualHomeScore,
       g.awayStartingPitcher, g.homeStartingPitcher,
       l.awayStarterHand, l.homeStarterHand, l.awayFinalRuns, l.homeFinalRuns,
       p1.projTotal AS p1ProjTotal, p1.pAwayMl AS p1PAwayMl,
       p2.projTotal AS p2ProjTotal, p2.pAwayMl AS p2PAwayMl
FROM games g
LEFT JOIN mlb_replay_linescores l  ON l.gamePk = g.mlbGamePk
LEFT JOIN mlb_replay_projections p1 ON p1.gameId = g.id AND p1.modelVersion = 'wf-19288f01-p1'
LEFT JOIN mlb_replay_projections p2 ON p2.gameId = g.id AND p2.modelVersion = 'wf-19288f01-p2'
WHERE g.sport = 'MLB' AND g.gameStatus = 'final'
  AND g.gameDate BETWEEN '2026-03-25' AND '2026-07-24'"

# B) Schedule history (start time UTC for quarantine flag + DK line fallbacks).
node "$DBQ" --json --quiet --out "$OUT/sched.json" --sql "
SELECT anGameId, gameDate, startTimeUtc, awayAbbr, homeAbbr, awayScore, homeScore,
       dkAwayML, dkHomeML, dkTotal, dkClosingAwayML, dkClosingHomeML, dkClosingTotal
FROM mlb_schedule_history
WHERE gameDate BETWEEN '2026-03-25' AND '2026-07-24'"

# C) p2 calibration metadata (one row per month is enough; grab all distinct).
node "$DBQ" --json --quiet --out "$OUT/calib-meta.json" --sql "
SELECT SUBSTRING(gameDate,1,7) AS month, calibMeta, COUNT(*) AS n
FROM mlb_replay_projections
WHERE modelVersion = 'wf-19288f01-p2'
GROUP BY SUBSTRING(gameDate,1,7), calibMeta"

# D) Replay-grades ledger state at run time (pipeline is being written concurrently;
#    incompleteness there is context, not a defect).
node "$DBQ" --json --quiet --out "$OUT/replay-grades-state.json" --sql "
SELECT modelVersion, market, COUNT(*) AS n
FROM mlb_replay_grades GROUP BY modelVersion, market"

echo "extraction complete -> $OUT"
