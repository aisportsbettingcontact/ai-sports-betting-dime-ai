# Fullgame — MODELER: re-derivation and verification of the replay projections

Granular 5x5 backtest, market group **fullgame**, role **MODELER**. Population: all **1,555**
pk-final 2026 regular-season games (2026-03-25..2026-07-24). Every number below comes from an
executed script over the **entire** population — no sampling except the StatsAPI boxscore
ground-truthing that reproduces the pipeline's own hr-factor labels.

## Provenance of this run

- DB snapshot: single read-only extraction 2026-07-25T20:43:47Z → 20:44:03Z UTC
  (`granular/tools/fullgame-modeler-extract.sh` → scratch `fullgame-modeler-snapshot/`, via
  `tools/db-query.mjs`).
- Replay series present at snapshot: `wf-19288f01-p1` (1,555 game rows), `wf-19288f01-p2`
  (1,555 game rows); no `-p2d` game rows existed yet. Prop rows: p1 K 3,110 / HR 27,990;
  p2 K 2,874 / HR 25,861 — p2 **prop** counts grew during the session (2,756→2,874 K between
  my first count and the snapshot), i.e. the replay pipeline was actively writing prop rows;
  the 1,555/1,555 **game** rows were stable across both reads. `mlb_replay_grades` was **empty**
  at snapshot time (grading not yet run) — per protocol, not a defect.
- Verification: `granular/tools/fullgame-modeler-verify.py` (line-faithful port of
  `tools/replay/calibrate_and_grade.py` transform + estimators; same EPS/clamps/scipy calls).
- HR-factor closure: `granular/tools/fullgame-modeler-hrfactor-refit.py` (1,218 StatsAPI
  boxscores fetched, cached locally; reproduces the pipeline's label fallback exactly).

## 1. Population identity — PASS (exact)

p1 gameId set == p2 gameId set, 1,555 distinct, no duplicates, `pop_minus_p1 = []`.
Census reconciliation: the census CSV's `schedStatus=complete AND mlbGamePk` view yields only
1,542 of them. The other 13 are real pk finals whose pk linkage lives in
`mlb_replay_linescores` (verified: all 13 carry a linescore `gamePk`):

- 11 postponement make-ups where the **complete** schedule row is UNLINKED (empty `gamesId`)
  and the games-table id stayed attached to the original **postponed** row
  (2250092, 2250103, 2250376, 2250506, 2250508, 2250710, 2250726, 2251041, 2251100, 2251321 —
  plus 2250374, which has **no** census row at all);
- 2 doubleheader game-2 rows with an empty `mlbGamePk` cell (3270003, 3270004).

Census-CSV linkage gap only — flagged so other agents don't under-select the population from
the CSV alone. 1,556 census-complete rows − 1 All-Star exhibition = 1,555. ✓

## 2. p1 internal consistency — PASS, 0 violations / 1,555

Per `fullgame-modeler-p1-consistency.csv` (one row per game):

| Check | Result |
|---|---|
| `pAwayMl` ∈ (0,1) | 1,555/1,555 pass, 0 null |
| `pOver` ∈ (0,1) | 1,555/1,555 pass, 0 null |
| `pAwayRl` ∈ (0,1) | 1,555/1,555 pass, 0 null |
| &#124;projAwayScore+projHomeScore−projTotal&#124; ≤ 0.02 | 1,555/1,555 pass; 1,148 rows diff 0.00, 407 rows diff exactly 0.01 (DECIMAL(6,3) rounding), max 0.01 |
| supplementary: `pF5AwayMl`/`pF5Over`/`pF5AwayRl`/`pNrfi` ∈ (0,1) | 0 violations |

## 3. p2 = documented transform of p1 — PASS on all named transforms; 1 NRFI violator

Per-row re-derivation under each row's own `calibMeta` (tolerance 1e-3 per field), 1,555 rows,
`fullgame-modeler-p2-transform-check.csv`:

- **Temperature** (`pAwayMl`, `pF5AwayMl` = sigmoid(logit(p1)/T)), **env-mult**
  (`projAwayScore/projHomeScore/projTotal/projF5Total` × league_env_mult), **recenter**
  (`pOver`, `pF5Over` = Φ(Φ⁻¹(p1) + Δproj/sd)), **RL passthrough** (`pAwayRl`, `pF5AwayRl`):
  **0 violations**; max abs diff over the whole population and all 10 fields = **4.9e-4**
  (DECIMAL storage rounding). Null patterns match p1 exactly. Seed months (Mar/Apr) are exact
  passthrough as documented.
- **NRFI layer (defect)**: months with `nrfi.mode="logistic"` (May 419 + Jun 394 + Jul 274 =
  1,087 rows): **1,086 rows have p2 pNrfi identical to p1** — the logistic `predict()` silently
  returns None on per-game feature-key mismatch and falls back to passthrough, while calibMeta
  still records `mode:"logistic"` (metadata misrepresents the applied transform). The **single**
  row where the logistic actually fired, game **2250612** (2026-05-14), produced
  **pNrfi = 1.00000** — a saturated, out-of-(0,1) probability (sigmoid clamped at z=+30, stored
  at the DECIMAL(7,5) cap). This is the only transform-check violation in the population.
  Root-cause pointer for the NRFI agent: `calibrate_and_grade.py::nrfi_feature_vector` applies
  its id-key exclusion only at the top level, so nested `*.starter_mlbam_id` (≈6e5 raw ids) and
  top-level `cutoffMs` (epoch ms) enter the standardized design matrix as "features".

## 4. calibMeta vs the fitted table — PASS (all params reproduced exactly)

calibMeta integrity: **0 issues** — byte-identical meta across all rows of each month;
`meta.month` == gameDate month; `p1_version` correct; `asOfCutoffMs(p2) == p1`; seed months
carry exactly the documented seed constants (mult 1.0, T 1.0, sd 4.5/2.9, factors 1.0,
NRFI prior-only); `fitted_on_months` strictly earlier than the target month everywhere.

No `calibration/before-after.md` exists in the worktree, so the fitted table was
**independently re-derived** from the p1 snapshot + DB actuals with the protocol's exact
estimators (`fullgame-modeler-month-params.csv`, all gated rows PASS):

| month | param | stored | refit | abs diff |
|---|---|---|---|---|
| 2026-05 | league_env_mult | 1.04564 | 1.04564 | 1e-6 |
| 2026-05 | T_fg / T_f5 | 2.0013 / 1.4814 | same | ≤2e-5 |
| 2026-05 | total_sd / f5_total_sd | 4.4623 / 3.0471 | same | ≤4e-6 |
| 2026-05 | k_factor | 0.84278 | 0.84278 | 1e-6 |
| 2026-06 | league_env_mult | 1.01551 | 1.01551 | 4e-6 |
| 2026-06 | T_fg / T_f5 | 1.5599 / 1.572 | same | ≤5e-5 |
| 2026-06 | total_sd / f5_total_sd | 4.3619 / 3.0969 | same | ≤5e-5 |
| 2026-06 | k_factor | 0.85849 | 0.85849 | 1e-6 |
| 2026-07 | league_env_mult | 1.02613 | 1.02613 | 2e-6 |
| 2026-07 | T_fg / T_f5 | 1.4781 / 1.6597 | same | ≤5e-5 |
| 2026-07 | total_sd / f5_total_sd | 4.3925 / 3.18 | same | ≤4e-6 |
| 2026-07 | k_factor | 0.87373 | 0.87373 | 0 |

Training-set sizes reproduce exactly (n_train_games 468/887/1,281; n_T_fg 465/881/1,273;
n_T_f5 389/747/1,074; n_k_train 936/1,774/2,562). **hr_factor** is not reproducible DB-only
(the pipeline backfills HR labels from StatsAPI boxscores); with the boxscore fallback
reproduced (`fullgame-modeler-hrfactor-refit.csv`), it closes **exactly**:
0.97088 (n 8,424) / 0.96081 (n 15,966) / 1.00182 (n 23,058), abs diff 0.00000, 0 unlabelable
rows. Every scalar in every month's calibMeta is therefore independently confirmed.

Modeling note (not a defect): fitted T_fg ≈ 2.00 → 1.56 → 1.48 (>1 shrinks toward 0.5) says
the raw replay engine is **over**-confident on ML — the opposite direction of the live model's
compression (C-005); the walk-forward layer is measuring and correcting the fixed engine, not
the live one.

## 5. live vs p1 vs p2 distributions by month

`fullgame-modeler-distributions.csv` (n/mean/sd/percentiles per month × series) and
`fullgame-modeler-pairwise.csv` (paired diffs + correlation). Headlines:

- **projTotal**: p1 runs hotter than live in every month (paired mean p1−live = +0.31 overall,
  +0.41 in April); p2 adds the env-mult on top (May +0.40, Jun +0.14, Jul +0.23; ALL +0.18),
  putting p2 ≈ +0.49 above live — directionally consistent with correcting C-001's −0.54
  under-projection of totals.
- **Early-season divergence**: live↔p1 correlation on projTotal is 0.59 (Mar) / 0.52 (Apr),
  rising to 0.83/0.90/0.94 (May/Jun/Jul); on pAwayMl it is 0.75 / **0.31** (Apr) / 0.60 / 0.84 /
  0.82. Largest single-game projTotal gap: 5.84 runs (April; the live April series contains a
  16.00 projTotal outlier). The March–April live series (all quarantined under P-001) is
  measurably a different model output than the fixed replay engine.
- **pAwayMl**: p2's temperature shrink narrows sd from 0.061-0.068 (p1) to 0.032-0.046 (p2);
  within-month p1↔p2 correlation 0.9999 (monotone transform), pooled 0.934 (month-varying T).
- Live nulls inside the population: 18 games without any live projTotal and 19 without live
  `modelAwayWinPct` (Mar–May) — replay covers all of them.

## Verdict

The replay projection substrate for fullgame markets is **sound**: p1 is internally consistent
on all 1,555 games, p2 is exactly the documented temperature + env-mult + recenter + passthrough
transform of p1 (worst deviation 4.9e-4), and every calibMeta parameter in every month
re-derives to 5 decimal places under the protocol's estimators, including the walk-forward
strictly-earlier training windows. The two defects found are confined to the **NRFI column of
the p2 rows** (inert logistic layer mislabeled in calibMeta + one saturated pNrfi=1.0) and to
**census-CSV linkage** (13 pk finals invisible to a CSV-only population query).

## Files

- `granular/tools/fullgame-modeler-extract.sh` — snapshot extraction (read-only)
- `granular/tools/fullgame-modeler-verify.py` — checks 1-5 (this report's engine)
- `granular/tools/fullgame-modeler-hrfactor-refit.py` — hr_factor closure via boxscores
- `fullgame-modeler-p1-consistency.csv` — 1,555 rows, per-game p1 checks
- `fullgame-modeler-p2-transform-check.csv` — 1,555 rows, per-field p2 re-derivation diffs
- `fullgame-modeler-month-params.csv` — stored vs refit params, all months
- `fullgame-modeler-hrfactor-refit.csv` — boxscore-completed hr_factor per month
- `fullgame-modeler-distributions.csv`, `fullgame-modeler-pairwise.csv` — section 5
- `fullgame-modeler-summary.json` — machine-readable roll-up
