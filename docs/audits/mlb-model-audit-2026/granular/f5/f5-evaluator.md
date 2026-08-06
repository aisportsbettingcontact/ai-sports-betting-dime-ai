# F5 — EVALUATOR: full-population per-game evaluation ledger + metric suite

Granular season backtest, market group **f5**, role **EVALUATOR**. Session 2026-07-25.

**Population**: all 1,555 final 2026 regular-season MLB games 2026-03-25..2026-07-24 with
`mlbGamePk` (1,556 finals total; the 2026-07-14 All-Star exhibition is exempt). Every number
below comes from an executed script; nothing is sampled except the StatsAPI ground-truth
(step 4), which sits on top of full-population DB computation.

## Scripts (granular/tools/) and outputs (granular/f5/)

| Step | Script | Outputs |
|---|---|---|
| 1 extract | `f5-evaluator-01-extract.py` | `f5-evaluator-raw.json` (run context + all rows) |
| 2 ledger+metrics | `f5-evaluator-02-ledger.py` | `f5-evaluator-ledger.csv` (13,995 rows = 1,555 games x 3 series x 3 markets), `f5-evaluator-monthly-metrics.csv`, `f5-evaluator-reliability.csv`, `f5-evaluator-push-analysis.csv`, `f5-evaluator-pick-lean.csv`, `f5-evaluator-crosscheck.csv`, `f5-evaluator-total-line.csv`, `f5-evaluator-summary.json` |
| 3 subgroups | `f5-evaluator-03-subgroups.py` | `f5-evaluator-rl-subgroups.csv`, `f5-evaluator-clobbered-corrections.csv`, `f5-evaluator-line-sanity.csv` |
| 4 ground truth | `f5-evaluator-04-statsapi.py` | `f5-evaluator-statsapi-check.csv` |

Run with the scratchpad venv python. Grading conventions deliberately mirror
`tools/replay/calibrate_and_grade.py` / GRADING-REPORT.md so re-derivation is comparable to
`mlb_replay_grades`; evaluator-specific additions live in separate columns (see script
docstrings).

**Series evaluated**: `live` (games.modelF5* columns), `wf-19288f01-p1` (raw fixed replay),
`wf-19288f01-p2` (walk-forward calibrated replay). **`-p2d` never appeared in
`mlb_replay_projections` during this run.** `mlb_replay_grades` state at run time (ledger
being written by the running pipeline; recorded, not a defect): f5_ml 1,527/1,545/1,545,
f5_rl 837/838/838, f5_total 838/839/839 (live/p1/p2); 101,746 total ledger rows at check.

## Headline metric suite (cohort = all, decided rows, pushes excluded; Wilson 95% CI)

From `f5-evaluator-monthly-metrics.csv` (month=ALL):

| Series | ML hit (n) | ML Brier | RL hit (n) | RL Brier | TOTAL hit (n) | TOTAL Brier | TOTAL bias (exp-based) |
|---|---|---|---|---|---|---|---|
| live | 53.7% [51.0, 56.4] (1,298) | 0.2494 | **47.7% [44.4, 51.1]** (842) | 0.2545 | 51.3% [47.9, 54.6] (843) | 0.2535 | **-0.229 [-0.441, -0.017]** |
| wf-p1 | 54.0% [51.3, 56.7] (1,313) | 0.2477 | 50.5% [47.2, 53.9] (843) | 0.2575 | 50.2% [46.9, 53.6] (844) | 0.2526 | **-0.237 [-0.448, -0.027]** |
| wf-p2 | 54.0% [51.3, 56.7] (1,313) | 0.2468 | 50.5% [47.2, 53.9] (843) | 0.2575 | 50.8% [47.5, 54.2] (844) | 0.2520 | -0.141 [-0.352, +0.070] |

- ML: live graded 1,536 (19 games lack live F5 projections) = 1,298 decided + 238 ties;
  replay graded all 1,555 = 1,313 + 242 ties. Hit rates are indistinguishable across series;
  p2's Brier gain over p1 is 0.0009.
- RL and TOTAL are graded only where a book line exists: 843-844 games (54% of population).
  **Book F5 line coverage collapses in June: 24/394 games (6.1%)** vs 315/392 April, 280/419
  May, 157/274 July (`f5-evaluator-02-ledger.py` coverage count) — June F5 RL/TOTAL cells are
  near-empty for every series.
- TOTAL bias uses the expectation-based projection (live `modelF5AwayScore+modelF5HomeScore`;
  replay `projF5Total`) on graded rows; live and p1 under-project F5 totals by ~0.23 runs
  (CI excludes 0, consistent with FG C-001); p2's env multiplier (1.016-1.046) halves it to
  non-significance. MAE(exp) ~2.4-2.5 runs everywhere.
- Common-clean cohort (games graded in all 3 series and not provenance-quarantined; ML
  n=1,013, RL/TOTAL n=552): live ML 52.2%, replay 53.4%; RL live 49.5%, replay 50.5%; TOTAL
  live 52.4%, p1 51.3%, p2 52.2%. No series separates from coin flip on RL/TOTAL.
- Live provenance quarantine (P-001, `modelRunAt` >= first pitch): 346/1,555 games
  (75 Mar, 207 Apr, 20 May, 34 Jun, 10 Jul). Metrics above are reported with and without
  (cohort column); quarantined-in live ML runs ~1.5pp HOT vs clean — direction consistent
  with possible post-hoc contamination, magnitude small.

Per-month rows for every cell are in `f5-evaluator-monthly-metrics.csv` (months 2026-03..07
plus MAR+APR and ALL, cohorts `all` and `common-clean`).

## F5 tie (push) frequency: observed vs sim implied, by month

`f5-evaluator-push-analysis.csv`. Observed = share of the full population whose F5 score is
tied; sim implied = mean live `modelF5PushPct` (blend) / `modelF5PushRaw` (raw sim). Replay
series store no push probability (only `pF5AwayMl`), so the sim-implied column is live-only.

| Month | n | Observed tie rate [95% CI] | Sim push (blend) | Sim push (raw) |
|---|---|---|---|---|
| 2026-03 | 76 | 18.4% [11.3, 28.6] | 15.8% | 16.2% |
| 2026-04 | 392 | 16.1% [12.8, 20.0] | 15.7% | 16.1% |
| 2026-05 | 419 | 13.8% [10.9, 17.5] | 16.0% | 16.6% |
| 2026-06 | 394 | 16.8% [13.4, 20.8] | 15.9% | 16.5% |
| 2026-07 | 274 | 15.0% [11.2, 19.7] | 15.9% | 16.4% |
| ALL | 1,555 | **15.56% [13.9, 17.5]** | **15.87%** | 16.40% |

The push model is the one well-calibrated F5 component: season-level sim 15.9% vs observed
15.6%, every month inside its CI (the sim is nearly constant by construction — 60/40 blend
toward the 0.1507 prior). Blend identity `pushPct = 0.6*raw + 0.4*0.1507` holds exactly:
0 violations in 1,536 games with both columns.

## Pick lean by series (`f5-evaluator-pick-lean.csv`)

| Series | ML away/home | ML away (push-aware alt rule) | RL away/home | TOTAL over/under |
|---|---|---|---|---|
| live | **4.4% / 95.6%** | 48.3% | 45.1% / 54.9% | 19.1% / **80.9%** |
| wf-p1 | **5.7% / 94.3%** | 48.8% | **94.0% / 6.0%** | 19.1% / 80.9% |
| wf-p2 | **5.7% / 94.3%** | 71.2% (Jul 87.2%) | **94.0% / 6.0%** | 26.3% / 73.7% |

Three structural leans, none of them views about baseball:

1. **ML "p>0.5" on an absolute (push-inclusive) probability** — away+home probabilities sum
   to ~0.85, so `p_away > 0.5` almost never fires: 95.6%/94.3% HOME picks. This is the
   unified ledger's pick semantics (mirrored here for comparability), not a model lean. A
   push-aware threshold `(1 - p_push)/2` restores ~50/50 picks and **scores better for p1:
   55.2% vs 54.0%** (live 53.4% vs 53.7%; p2 54.2%) — `alt_hit_rate` column.
2. **Replay RL picks away 94.0% by construction** — `pF5AwayRl` is P(away +0.5 covers,
   ties cover) ~ 0.58 mean, so `p>0.5` almost always picks away regardless of the stored
   book line's side. Live (tie-excluded two-way) sits near 50/50.
3. **TOTAL leans 74-81% UNDER** while observed over-rate at the book line is 50.1% — the
   engine's expected F5 total sits below its own synthetic line and below book lines.

## RL line-subgroup evaluation (`f5-evaluator-rl-subgroups.csv`)

Stored book `f5AwayRunLine` over the 843 finals with a line: **+0.5 x501, -0.5 x269,
|line|>=1.5 x73** (magnitudes 1.5/2.5/3.5/4.5/5.5; 712 finals have none). The model
probability prices a fixed away +0.5 (replay, ties-cover after M-205) or a tie-excluded
conditional (live) — grading it against mixed lines produces structurally different errors
per subgroup:

| Subgroup | Series | n | Hit [95% CI] | avg P(away) | obs away rate | gap |
|---|---|---|---|---|---|---|
| line +0.5 | live | 501 | 51.5% [47.1, 55.9] | 0.481 | 0.519 | -3.8pp (tie mass excluded) |
| line +0.5 | replay | 501 | 51.7% [47.3, 56.0] | 0.568 | 0.519 | +4.9pp |
| line -0.5 | live | 268 | **42.9% [37.1, 48.9]** | 0.531 | 0.429 | **+10.2pp** |
| line -0.5 | replay | 269 | 44.6% [38.8, 50.6] | 0.605 | 0.431 | **+17.4pp** (tie mass counted as cover) |
| junk lines | live | 73 | 39.7% | 0.473 | 0.671 | -19.8pp |
| junk lines | replay | 73 | 64.4% | 0.559 | 0.671 | -11.2pp |

On -0.5 lines the graded event is "away wins outright", yet replay's probability includes
the ~15pp tie mass on the away side — a built-in +17pp overstatement; live's below-coin-flip
47.7% headline is driven by this subgroup (42.9%, CI excludes 50%). **No F5 RL number in any
series measures model skill against the line the model actually priced.** Reliability
confirms it: replay RL top deciles 0.60-0.66 predicted -> 0.45-0.51 observed
(`f5-evaluator-reliability.csv`).

## Reliability (equal-count deciles, `f5-evaluator-reliability.csv`)

- **ML live/p1**: monotone but under-confident on the absolute scale (p1 top decile 0.510 ->
  0.599 observed; bottom 0.336 -> 0.389). **p2** (T_f5 = 1.48 May / 1.57 Jun / 1.66 Jul from
  `calibMeta`) flattens the low tail (0.358 -> 0.344) and keeps monotonicity — best ML Brier
  (0.2468) — but note the transform re-centers an absolute-scale probability toward 0.5, which
  is what pushes the push-aware pick lean to 71% away (scale mixing; the correct recentering
  target is (1-p_push)/2 ~ 0.425).
- **RL**: anti-calibrated at the top in every series (live 0.591 -> 0.471; replay 0.662 ->
  0.506). See subgroup table for the mechanism.
- **TOTAL**: no usable signal; deciles oscillate around 0.5 with gaps up to +-0.18 in both
  directions in all series.

## Data-integrity findings

### E-1 (P1) — Doubleheader F5-actual clobbering in `games`, externally confirmed
Full-population conflict scan (`f5-evaluator-03-subgroups.py`) of `games.actualF5*` vs the
pk-keyed `mlb_replay_linescores`: 3 conflicts, all game-2s of doubleheaders, each storing its
**partner game's** F5 score:

| gameId | Date/matchup | gamePk | games.actualF5 | truth (linescore = StatsAPI) |
|---|---|---|---|---|
| 2250733 | 05-23 STL@CIN | 824516 | 3-1 | **1-5** |
| 2250738 | 05-24 DET@BAL | 824839 | 4-1 | **2-0** |
| 2251290 | 07-07 MIL@STL | 823035 | 2-3 | **3-0** |

StatsAPI linescore fetch (`f5-evaluator-04-statsapi.py`) confirms the pk-keyed values in all
3; a 60-game seeded random sample (12/month) matches `games.actualF5*` 60/60 — the defect is
DH-specific (AWAY@HOME-keyed score refresh), not general. In each game `actualF5Total`
(pk-derived, nightly ingestor) holds the CORRECT total while away/home scores are wrong —
the same row disagrees with itself. Impact: 21 graded ledger rows across the 3 series carry
a wrong actual side; **9 flip WIN<->LOSS/PUSH when corrected**
(`f5-evaluator-clobbered-corrections.csv`); `mlb_replay_grades` inherits all of them
(it grades from the same columns).

### E-2 (P1) — Book F5 line capture corruption (`f5-evaluator-line-sanity.csv`)
118 of 1,555 games flagged: 73 finals with |f5AwayRunLine| >= 1.5 (F5 spreads are +-0.5,
occasionally 1.5 — 47 of the 73 exactly mirror the FG run line magnitude, copy evidence);
55 games where f5Away/f5Home run lines are not mirror images (e.g. 5.5/0.5,
-5.5/-0.5); 48 games where f5Total/bookTotal is outside [0.40, 0.70] (incl. f5Total 10.5 on
a 9.0 FG total — impossible for five innings). These corrupt rows were graded as-is by every
ledger incl. `mlb_replay_grades`. Plus the June coverage collapse (24/394 games with F5
lines) — the capture pipeline was effectively down for a month.

### E-3 (P2) — f5_total graded at a line the probability was never computed at (F-4 inherited)
`pF5Over`/`modelF5OverRate` are computed at the synthetic line (FG bookTotal x 0.555 snapped);
grading uses the book `f5Total`. The two agree in only **409/844 (48.5%)** of graded games
(`f5-evaluator-total-line.csv`). Every f5_total hit/Brier in every series therefore mixes two
lines ~half the time.

### E-4 (context, not a defect) — 10 games absent from `mlb_replay_grades` at run time
Cross-check of my 9,705 graded rows vs the 9,646-row grades snapshot: **zero value
mismatches** on all 9,646 matched rows (pick/result/correct exact, Brier tol 1e-4, prob tol
1e-3) — the unified ledger's arithmetic is faithful to its inputs. The 59 unmatched rows are
10 games with no `mlb_replay_grades` rows in ANY market at snapshot time (7 of 10 are
doubleheader games, incl. the 3 clobbering partners): gameIds 2250092, 2250103, 2250376,
2250506, 2250508, 2250710, 2250726, 2251041, 2251100, 2251321
(`f5-evaluator-crosscheck.csv`). Ledger is being written by the running pipeline; recorded
as run context per protocol, but the DH concentration suggests the same keying hazard as E-1.

## Bottom line

Across 1,555 games and three series, F5 ML is the only market with a real (if small) pick
edge (~54%, CI floor ~51%), and even that is measured under a pick rule that fires HOME 95%
of the time; the push-aware rule scores 55.2% on the raw replay. F5 RL and F5 TOTAL metrics
are not currently measurements of model skill: RL grades a fixed-side probability against
mixed and partly corrupted book lines (structural +17pp overstatement on -0.5 lines for
replay), and TOTAL grades a synthetic-line probability at the book line half the time. The
push prior is well calibrated (15.9% vs 15.6% observed). Fixing E-1 (3 games), E-2 (line
hygiene + June capture), and the RL/ML probability-vs-line semantics is prerequisite to any
claim about F5 market skill.
