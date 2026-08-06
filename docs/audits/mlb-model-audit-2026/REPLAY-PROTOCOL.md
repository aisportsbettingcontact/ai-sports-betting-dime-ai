# Walk-Forward Replay Protocol (Phase 5)

Purpose: generate `walkforward_replay` projections for every completed 2026 game × market where
no `live_pregame` projection exists, plus a complete fixed-model series for structurally
defective markets (K props at minimum). Storage: `mlb_replay_projections`,
`mlb_replay_prop_projections`, graded into `mlb_replay_grades` (source column separates
provenance; public surfaces never read replay tables).

## As-of rules (leakage checklist)
- **Cutoff**: each game's first pitch (`mlb_schedule_history.startTimeUtc`). Every feature uses
  data strictly before the cutoff.
- **Starters & lineups**: the actual starters/lineups (StatsAPI boxscore, stored in
  `mlb_replay_linescores`) — pregame-legitimate per the authorization (announced by first pitch).
- **Pitcher features**: 2026 per-start logs rebuilt as-of from `mlb_replay_linescores`
  (starter Ks, outs, runs-relevant) plus StatsAPI game logs for ERA/BB/HR components; blended
  with 2025-season StatsAPI stats as priors using the live model's own blend weights (70/30
  season/rolling-5), exactly as the live model seeds early-season pitchers from its frozen 2025
  registry.
- **Team features**: run environment as-of from cumulative `mlb_schedule_history` scores; K-rate
  allowed as-of from starter-K substrate; hand-split adjustment uses the static ratio between
  the current `mlb_team_batting_splits` L/R rows applied to the as-of overall rate (documented
  approximation — the DB stores no historical split snapshots).
- **Park factors**: `mlb_park_factors.parkFactor3yr`/`hrFactor` (2024-2025-weighted, as-of safe).
- **Umpires**: `mlb_umpire_modifiers` (seeded from 2024-2025) via `mlb_lineups.umpire` where a
  pregame lineup sheet was captured; neutral (1.0) otherwise.
- **Bullpen**: league-neutral (None) for ALL replay games uniformly — the live path's bullpen
  fatigue inputs are dead code (hardcoded neutral, finding fullgame-P2), and no as-of bullpen
  snapshot exists. Documented protocol difference from live runs that passed current-season
  bullpen aggregates.
- **Weather**: `mlb_lineups.weather*` where a pregame sheet exists; None otherwise.
- **Lines**: `line_at_projection` = the games row's stored book columns (captured pregame by the
  live system) where present; else the last `odds_history` snapshot before cutoff; else the
  `mlb_schedule_history` DK pre-game columns. Closing = `dkClosing*` where locked, else the
  last pre-start `odds_history` snapshot labeled `proxy_closing_snapshot` (measured: mean 60
  minutes before first pitch, 72% within 30 minutes).
- **Outcomes never feed their own projection**; the calibration layer for month *m* is fitted
  only on months < *m* (see below).

## Model
- Simulation core: `server/MLBAIModel.py::project_game` at the Phase 4 fixed revision (F5 RL tie
  fix, parameterized home edge, league environment multiplier), seed 42, 400k sims — the live
  engine's own configuration.
- K props: the FIXED `mlbKPropsModelService` formula replicated in the replay driver
  (unit-consistent opp_adj vs measured same-basis league mean; Poisson with correct push
  handling; expected IP from as-of pitcher IP means rather than the line-anchored heuristic —
  divergence documented in driver).
- HR props: the FIXED `mlbHrPropsModelService` formula (per-AB hr9 basis, park hrFactor from
  `mlb_park_factors`), batter pool = actual starting lineup (9 per side).
- NRFI: rebuilt model (Phase 4 item 6) — logistic on [starter as-of NRFI rate with Bayesian
  shrinkage to 2025 prior (`mlb_pitcher_stats.nrfi*`, seeded pre-season), team as-of
  first-inning scoring rate, park factor, starter hand]; trained walk-forward.

## Walk-forward calibration (expanding window, monthly refit)
For month *m* in [Mar+Apr (jointly seeded by priors), May, Jun, Jul]:
- `league_env_mult(m)` = (actual runs/game over months < m) / (raw replay projected runs/game
  over months < m); March-April uses 1.0 (2025 environment assumption, exactly what the live
  model believed).
- ML temperature `T(m)` fitted on months < m by minimizing log loss of
  sigmoid(logit(p)/T) for FG and F5 ML separately; T=1 for the seed months.
- K calibration factors, HR calibration factor: refit on months < m residuals; seed = the
  Phase 4 fixed-formula raw output (factor 1.0).
- NRFI logistic refit monthly on all games < m; March-April predictions use the prior-only
  model (2025-seeded pitcher rates, league first-inning rate).
Fitted values per month recorded in `mlb_replay_projections.calibMeta` (JSON) and in
`calibration/before-after.md`.

## Versioning
`modelVersion` = `wf-<git-sha-of-fixed-code>-p<pass>`; pass 1 = raw fixed model, pass 2 =
calibrated (the published replay series). Grading writes both passes to `mlb_replay_grades`
so the calibration layer's contribution is measurable.
