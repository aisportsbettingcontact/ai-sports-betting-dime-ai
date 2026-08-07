#!/bin/bash
set -e
echo "=== reload boxscores all seasons (rebuilt tables) ==="
railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --all --table mlb_boxscore_batting || exit 1
railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --all --table mlb_boxscore_pitching || exit 1
echo "=== finish remaining seasons 2025 2026 (full) ==="
for y in 2025 2026; do
  echo "=== season $y ==="
  railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season "$y" || exit 1
done
echo "=== re-verify 2024 sanity via idempotent season pass ==="
railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season 2024 || exit 1
echo "ALL LOAD WORK COMPLETE"
