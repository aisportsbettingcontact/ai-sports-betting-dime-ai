#!/bin/bash
# fullgame MODELER — one-shot read-only snapshot of everything needed to
# (a) verify p1 internal consistency, (b) re-derive the p2 transform row by row,
# (c) re-fit the walk-forward monthly calibration params, (d) build live/p1/p2
# distribution comparisons. All queries go through the audit's read-only runner.
# Usage: bash fullgame-modeler-extract.sh <snapshot_dir>
set -euo pipefail
SNAP="$1"
mkdir -p "$SNAP"
WT="$(cd "$(dirname "$0")/../../../../.." && pwd)"   # worktree root
Q="node $WT/docs/audits/mlb-model-audit-2026/tools/db-query.mjs --quiet"

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$SNAP/snapshot-started-utc.txt"

# replay game projections, both passes (monthly p2; -p2d excluded by design)
$Q --out "$SNAP/replay-games.tsv" --sql "
  SELECT id, gameId, gameDate, provenance, modelVersion, asOfCutoffMs,
         pAwayMl, projAwayScore, projHomeScore, projTotal, pOver, pAwayRl,
         pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, pNrfi, calibMeta, createdAt
  FROM mlb_replay_projections
  WHERE modelVersion IN ('wf-19288f01-p1','wf-19288f01-p2')
  ORDER BY modelVersion, gameDate, gameId"

# live projections + actuals substrate
$Q --out "$SNAP/games.tsv" --sql "
  SELECT id, gameDate, gameStatus, modelAwayWinPct, modelAwayScore, modelHomeScore,
         modelOverRate, modelProjTotal, modelTotal,
         modelF5AwayWinPct, modelF5AwayRLCoverPct, modelF5OverRate, modelF5Total, modelPNrfi,
         actualAwayScore, actualHomeScore, actualFgTotal,
         actualF5AwayScore, actualF5HomeScore, actualF5Total
  FROM games WHERE sport='MLB' AND gameDate >= '2026-03-01'
  ORDER BY gameDate, id"

# linescore substrate (actuals fallbacks + starter Ks for the k_factor refit)
$Q --out "$SNAP/linescores.tsv" --sql "
  SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId,
         inn1AwayRuns, inn1HomeRuns, f5AwayRuns, f5HomeRuns,
         awayStarterKs, homeStarterKs, awayFinalRuns, homeFinalRuns
  FROM mlb_replay_linescores"

# p1 prop projections (k_factor / hr_factor refit inputs)
$Q --out "$SNAP/replay-props-p1.tsv" --sql "
  SELECT id, gameId, gameDate, propType, mlbamId, playerName, side,
         projValue, pOver, line
  FROM mlb_replay_prop_projections WHERE modelVersion='wf-19288f01-p1'
  ORDER BY gameDate, gameId, id"

# live K props (actualKs fallback used by the pipeline's k-factor fit)
$Q --out "$SNAP/live-kprops.tsv" --sql "
  SELECT p.id, p.gameId, g.gameDate, p.side, p.mlbamId, p.kProj, p.bookLine,
         p.pOver, p.pUnder, p.actualKs
  FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId
  WHERE g.sport='MLB' AND g.gameDate >= '2026-03-01' ORDER BY g.gameDate, p.id"

# live HR props (actualHr index used by the pipeline's hr-factor fit)
$Q --out "$SNAP/live-hrprops.tsv" --sql "
  SELECT p.id, p.gameId, g.gameDate, p.mlbamId, p.playerName, p.actualHr
  FROM mlb_hr_props p JOIN games g ON g.id=p.gameId
  WHERE g.sport='MLB' AND g.gameDate >= '2026-03-01' ORDER BY g.gameDate, p.id"

# concurrent-pipeline state at snapshot time (for the report's provenance note)
$Q --out "$SNAP/state-replay-versions.tsv" --sql "
  SELECT modelVersion, COUNT(*) n, MIN(gameDate) mn, MAX(gameDate) mx
  FROM mlb_replay_projections GROUP BY modelVersion;
  SELECT modelVersion, propType, COUNT(*) n
  FROM mlb_replay_prop_projections GROUP BY modelVersion, propType;
  SELECT source, modelVersion, COUNT(*) n
  FROM mlb_replay_grades GROUP BY source, modelVersion"

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$SNAP/snapshot-finished-utc.txt"
wc -l "$SNAP"/*.tsv
