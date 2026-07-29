# Coherence Results — joint-nb-v2 (§11)

All seven market outputs per game derive from the same 400,000 joint trajectories,
so coherence holds by construction; it was nevertheless verified empirically across
all 80,193 game-state simulations.

| Requirement | Test | A | B | C |
|---|---|---|---|---|
| Two-way sums | max abs(p_home + p_away − 1) | 0.0 | 0.0 | 0.0 |
| F5 trio | max abs(p_f5_home + p_f5_away + p_f5_tie − 1) | 2.2e-16 | 2.2e-16 | 2.2e-16 |
| CDF monotonicity | total/F5-total pmfs cumulative | pass | pass | pass |
| RL ≤ ML | share of games with p(home −1.5 cover) ≤ p(home ML) | 100% | 100% | 100% |

- Two-way sums are exact because home_win + away_win counts partition all 400,000
  trajectories (extra innings + deterministic cap tiebreak leave no residual ties).
- F5 trio deviation is at float64 machine epsilon (counts partition exactly; the
  epsilon appears only in the divided probabilities).
- RL ≤ ML holds in every one of the 80,193 simulations: covering −1.5 (margin ≥ 2) is
  a strict subset of winning (margin ≥ 1) trajectory-by-trajectory.
- Same-trajectory derivation also guarantees joint consistency between totals and
  margins (both computed from identical (H, A) pairs), and between F5 and FG
  (F5 score is a prefix sum of the same trajectory).

Machine-readable source: `coherence_results_v2.json`.

## Leakage posture (unchanged from P5, re-verified for the states)

- All player/team statistics enter through shift(1) as-of stores; a player's own game
  row carries strictly-prior state. States B/C read identity from the current game
  (CONDITIONING_IDENTITY per the governing directive) and statistics exclusively from
  those prior-only stores — verified by the exact-join construction in
  `build_states.py` (join key = the starter's/batters' own (game_pk, mlbam_id) rows in
  the shift(1) stores).
- The P5 leakage test battery (LEAKAGE-TEST-RESULTS.md) covers the shared feature
  pipeline; no new feature families were introduced in v2 (same columns, corrected
  estimator only).
