#!/bin/bash
set -e
for y in 2025 2026; do
  echo "=== season $y (full) ==="
  railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season "$y" || exit 1
done
echo "=== boxscore batting sweep (all seasons) ==="
railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --all --table mlb_boxscore_batting || exit 1
echo "=== boxscore pitching sweep (all seasons) ==="
railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --all --table mlb_boxscore_pitching || exit 1
echo "ALL LOAD WORK COMPLETE"
