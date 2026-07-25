# Phase 2 — Exhaustive Grading & Deviation Report (2026 season through 2026-07-24)

Produced by `tools/grade-season.mjs` (committed, read-only). Ledgers: `grading/ledger-*.csv`
(one row per game per sub-market; 4,683 FG + 3,282 F5 + 1,561 NRFI + 2,784 K-prop + 10,156
HR-prop rows). Full metric suite: `grading/metrics-summary.json`. Every number below is
**VERIFIED** (script output, this session). Grades are **re-derived from raw projections and
actuals** — stored correctness flags were deliberately not trusted (see M-101/M-103 for why
that mattered).

## Grading rules (stated before running)
- **FG ML**: P(away)=`modelAwayWinPct`/100; pick = side with p>0.5; correct = pick won. Actuals
  from `games.actual*`, falling back to `mlb_schedule_history` scores (46 games).
- **FG RL**: model margin (`modelAwayScore−modelHomeScore`) + book `awayRunLine` vs actual
  margin; push on exact cover. No probability is stored for MLB RL at game level.
- **FG TOTAL**: P(over)=`modelOverRate`/100 vs `bookTotal`; signed error =
  (`modelProjTotal`??`modelTotal`) − actual total; push on exact line.
- **F5 ML/RL/TOTAL**: `modelF5AwayWinPct`/100, `modelF5AwayRLCoverPct`/100,
  `modelF5OverRate` (already 0–1; scale inconsistency noted as P-003) vs F5 book columns and
  `actualF5*`; F5 ties are pushes.
- **NRFI**: P(NRFI)=`modelPNrfi` (0–1) vs actual = `actualNrfiBinary` ?? map(`nrfiActualResult`).
- **K prop**: pick = `pOver`>`pUnder` side vs `bookLine`; actual `actualKs`; push on integer==line;
  signed error = `kProj` − `actualKs`.
- **HR prop**: probability grading of `modelPHr` vs `actualHr≥1` (Brier/log loss); bet grading
  only where `verdict` is actionable.

## Headline metrics (completed, graded rows; ± is 95% CI)

| Family / sub-market | Graded n | Hit rate | Brier | Log loss | MAE | Signed bias |
|---|---|---|---|---|---|---|
| FG ML | 1,528 | 55.4% ±2.5 | 0.2471 | — | — | — |
| FG RL (pick) | 1,528 | 58.8% ±2.5 | — | — | 3.56 (margin) | −0.35 ±0.23 * |
| FG TOTAL | 1,467 | 52.2% ±2.6 | 0.2539 | — | 3.52 | **−0.54 ±0.23 *** |
| F5 ML | 1,262 | 54.0% ±2.8 | 0.2488 | — | — | — |
| F5 RL | 817 | **47.7% ±3.4** | 0.2544 | — | — | — |
| F5 TOTAL | 820 | 51.5% ±3.4 | 0.2536 | — | 2.46 | −0.28 ±0.21 * |
| NRFI | 1,496 | 51.3% ±2.5 | **0.2502** | 0.6936 | — | — |
| K props | 2,159 | 52.8% ±2.1 | **0.2974** | 0.8299 | 2.22 | **−0.99 ±0.11 *** |
| HR props (prob-graded) | 8,555 | n/a (prob market) | **0.0987** | 0.3526 | — | see C-003 |

`*` = CI excludes zero. Per-month and per-slice tables: `metrics-summary.json`.

## Confirmed systematic biases (adequate n, CI excludes zero, robust to slicing)

### C-001 (P1) — Full-game totals under-projected by ~0.5 runs
Signed bias −0.54 ±0.23 over 1,467 games; present in April (−0.58), June (−0.59), July (−0.42);
present in every slice tested (home/away favorite, day/night, over/under side, all probability
buckets). Sensitivity: excluding all 286 leakage-quarantined games, bias = −0.575 ±0.283
(n=966) — **survives**. The model's run environment is too low. (May is the exception, ≈0 —
month heterogeneity noted; the direction is stable everywhere else.)

### C-002 (P0) — K-prop projections biased a full strikeout low AND probabilities anti-calibrated
`kProj` bias −0.99 ±0.11 Ks (n=2,159), significant in every month and both sides. Consequence:
87% of graded picks are UNDER (1,876 vs 283). Worse, the published over-probabilities are
anti-informative in the tails (reliability, away side): predicted 0.07 → observed 0.462;
predicted 0.157 → observed 0.524; predicted 0.841 → observed **0.308**. A subscriber betting
overs at the model's stated 7% would have hit 46% of the time. This corrupts published numbers —
P0.

### C-003 (P1) — HR-prop probabilities: negative skill vs base rate, mean too low
Model Brier 0.09867 vs 0.09767 for predicting the constant 10.97% base rate (n=7,529 with
actuals). Mean predicted 0.0939 vs observed 0.1097 (difference ≈4.4σ). The published HR
probabilities currently add no discriminative value over the league base rate and are centered
~1.6pp too low.

### C-004 (P1) — NRFI carries no signal
Hit 51.3% ±2.5 (CI includes coin flip), Brier 0.2502 vs 0.25 for p=0.5-always. Reliability is
non-monotone (predicted 0.61 bucket → observed 0.455). There is no statistical basis for the
NRFI numbers currently published.

### C-005 (P2) — ML probability compression (FG and F5)
Monotone but under-confident: FG ML predicted 0.37→observed 0.42, 0.449→0.464, 0.529→0.58.
Directionally sound (picks beat coin flip) but probabilities are squeezed toward 0.5.
Temperature/Platt scaling candidate, walk-forward validated.

### Watch (not confirmed): F5 RL hit 47.7% ±3.4 — below coin flip but CI reaches 51.1%; FG TOTAL
tails (p<0.3 and p>0.6 buckets) show no signal on small n. Both retest after backfill.

## Stored-grade integrity (re-derivation vs platform's own grades)

### M-101 (P0) — `games` F5/NRFI grading columns grade the wrong thing
All 104 stored `f5MlCorrect` values (March–April era) satisfy the rule "away team won the F5" —
they grade a **fixed away-side bet, not the model's pick** (the model favored home in most).
100 of 103 disagree with correct re-derivation. The 14 stored `nrfiCorrect` rows sit on rows
whose binary actual is null (source vanished). `fgMlCorrect` was never populated. These columns
are dead-and-wrong: any surface reading them would misreport accuracy.

### M-103 (P1) — K-prop stored grades contradict raw data
108 of 1,945 stored `backtestResult` side labels contradict `actualKs` vs `bookLine` recomputed
from the same row; 197 of 1,943 stored `modelCorrect` flags disagree with re-derivation. Stored
`modelError` matches no consistent definition against row data (`kProj−actualKs` fits some rows,
not others). Exact mismatch rows: `grading/consistency-k-mismatches.csv`.

### P-001 (P1) — Projection provenance is destroyed by timestamp clobbering
286 games (2,860 ledger rows, 18.7% of enrolled games incl. all of March) are quarantined
because `modelRunAt` ≥ first pitch — with gaps up to 11 days, i.e. re-runs overwrote the
timestamp. Props: 97% of K-prop and 100% of HR-prop graded rows carry `modelRunAt` hours after
first pitch (avg +8.9h) while `createdAt` proves pregame row creation. INFERRED (stated
reasoning): the projection *values* behave like genuine pregame numbers — post-hoc contamination
would inflate accuracy, and the observed accuracy is poor — but **pregame provenance is
unprovable from the database**. The quarantine posture is correct; the root defect is mutable
projections with no append-only snapshot.

### P-002 (P1) — No projection-level grading existed in production
`mlb_game_backtest` grades bet recommendations (WIN/LOSS/NO_ACTION); the games-table
projection-grading columns are dead (M-101). Until this audit's ledgers, nobody could state the
model's raw accuracy. CLV columns exist but were never populated (D-008).

## Versus market
Closing lines exist for 884 games (from 2026-04-11). CLV was never computed by the platform
(D-008). The audit ledgers carry closing ML/total and no-vig closing probabilities per game
(`ledger-fullgame.csv` columns `closing_line`, `closing_novig_p_away`) — CLV computation for
model picks becomes possible in Phase 3 backfill; a pre-backfill estimate is deferred rather
than reported on the partial 65% capture (selection risk).

## Exemplars
`metrics-summary.json` → per family `worst20` / `best20` (by per-row log loss). Worst FG
exemplars cluster in blowouts the model priced near 50/50; worst K-prop exemplars are early
hooks/injury exits priced at high over-probability.
