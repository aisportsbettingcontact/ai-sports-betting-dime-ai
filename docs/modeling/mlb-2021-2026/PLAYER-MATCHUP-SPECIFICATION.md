# Player-Specific Matchup Specification

Per game (matchups.parquet, ledgered): game_pk, season, date, home/away team_id,
EXPECTED starters (deployable) with rule branch + walk-forward confidence, ACTUAL starters
(oracle-only), expected batter pools (top-12 by slot-frequency over the team's prior 20
games, weights = frequency x slot-decay 1/(1+0.15·(slot−1))).

Expected-starter rules (deterministic, preregistered):
- rotation_oldest_rested: among the team's actual starters in the prior 12 days, the pitcher
  with rest ≥ 4 days whose last start is oldest (next man up).
- fallback_most_recent: most recent prior starter when no rested candidate exists.
- Confidence per (season, branch) = hit rate measured on strictly-prior seasons (n≥100 else 0.5).
Measured overall hit rate is reported in starter_rule_report.csv and carried per-game.

Lineup/batter linkage: all by mlbam_id; batter as-of states attach by strict date-prior
lookup; per-game lineup aggregates are pool-weighted means of batter as-of rates.
Interaction features (iteration 4): starter whiff-induction x lineup whiff rate, starter
out-of-zone share x lineup chase rate, starter hard-hit allowed x lineup hard-hit rate,
platoon hand indicators. ORACLE series uses actual starters (hso_/aso_ features) and is
never merged into deployable results.
