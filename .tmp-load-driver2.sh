#!/bin/bash
set -e
for y in $(seq 2021 2026); do
  echo "=== season $y ==="
  railway run --service ai-sports-betting-dime-ai -- npx tsx scripts/mlb-etl/load.mts --season "$y" || exit 1
  railway run --service ai-sports-betting-dime-ai -- npx tsx .tmp-health.mts || true
done
echo "ALL SEASONS LOADED"
