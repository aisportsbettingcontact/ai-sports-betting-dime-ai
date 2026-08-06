# F5 — ASSESSOR — Residual Structure Hunt (Full Population)

Role: ASSESSOR (where does the model still miss and why).
Market group: F5 (moneyline / run line ±0.5 / total).
Population: **all 1,555** final 2026 regular-season MLB games with `mlbGamePk`,
2026-03-25..2026-07-24 (the 2026-07-14 All-Star exhibition, gameId 4110001, is the scope-exempt
1,556th final). Every number below comes from a named script run against the full population;
StatsAPI was used only to ground-truth the 3 divergent rows found by full-population comparison.

## Scripts and invocations

All run 2026-07-25 with `<scratchpad>/venv/bin/python` from `granular/tools/`:

| Script | Purpose | Outputs |
|---|---|---|
| `f5-assessor-01-extract.py` | population extraction (games + p1/p2 replay + linescore starter substrate + park factors + DK fallback totals) + as-of starter/team IP depth + derived raw tie/cover masses | `f5-assessor-population.csv` (1,555 rows) |
| `f5-assessor-02-slices.py` | F5 total bias by starter IP depth / team bullpen depth / park / month; ML Brier by favorite strength & side; RL+tie by total-line bucket | `f5-assessor-total-bias-slices.csv` (80 slices), `f5-assessor-ml-brier-favstrength.csv`, `f5-assessor-rl-tie-totalline.csv` |
| `f5-assessor-03-worst50.py` | combined-loss worst-50 autopsies + tag lifts | `f5-assessor-worst50.csv` |
| `f5-assessor-04-followups.py` | distribution compression, team/park correlations, `TEAM_F5_RS` staleness | `f5-assessor-team-rs-staleness.csv` |
| `f5-assessor-05-slope-splithalf.py` | artifact-free tests: per-game OLS slope; split-half team correlations | stdout (quoted below) |
| `f5-assessor-06-actuals-check.py` | full-population per-side F5 actuals integrity + StatsAPI ground truth + grade-source reconciliation | stdout (quoted below) |

Run context (recorded at execution): `mlb_replay_projections` = `wf-19288f01-p1` 1,555 +
`-p2` 1,555 rows, both exactly covering the population; **no `-p2d` series existed**.
`mlb_replay_grades` F5 rows at run time (pipeline still writing; timing note, not a defect):
f5_ml p1/p2 1,545 each + live 1,527; f5_rl p1/p2 838 + live 837; f5_total p1/p2 839 + live 838.
`mlb_replay_linescores`: 1,555/1,555. Live `games.modelF5*`: 1,536/1,555 (19 replay-only games,
listed in the f5-modeler report).

Actuals convention: per-side F5 actuals are taken from the `mlb_replay_linescores` substrate,
which is StatsAPI-exact on all rows checked — `games.actualF5AwayScore/HomeScore` is **wrong on
3 rows** (§6). Series: **live** = `games.modelF5*` (pre-M-205, tie-excluded RL), **p1** = raw
fixed replay, **p2** = walk-forward calibrated replay. `p2@live` = p2 restricted to the 1,536
live-covered games so live-vs-p2 deltas are exact.

## 1. Headline: the F5 total residual is a LEVEL error, not a slice structure

Overall F5 total bias (proj − actual; `f5-assessor-02-slices.py` ALL row, n=1,555 / live 1,536):

| series | proj mean | actual mean | bias (runs) | bias % | SE |
|---|---|---|---|---|---|
| p1 | 4.715 | 5.051 | **−0.336** | −6.65% | 0.082 |
| p2 | 4.814 | 5.051 | **−0.237** | −4.69% | 0.082 |
| live | — | — | **−0.385** | −7.6% | 0.083 |
| p2@live | — | — | −0.239 | — | — |

Two artifact-free tests (`f5-assessor-05-slope-splithalf.py`) show the residual carries almost
no cross-sectional structure:

- **Per-game OLS** `actual = a + b·proj`: slope b = 0.968 (SE 0.121) for p1, 0.925 (0.118) for
  p2, 0.864 (0.133) for live — none distinguishable from 1. The projection cross-section is
  correctly scaled; the miss is the intercept (level).
- **Split-half team test** (team scoring level from even-indexed games, team bias from
  odd-indexed games): corr = **−0.082** (n=30). The raw same-sample correlations —
  corr(team actual mean, team bias) = −0.737, corr(park actual mean, park bias) = −0.630,
  corr(TEAM_F5_RS staleness gap, team bias) = −0.700 (`f5-assessor-04-followups.py`) — are
  therefore ~entirely regression-to-mean artifacts (the same game noise sits in both variables).
  The staleness-gap correlation also collapses split-half (−0.072).

Consequence: the fix for the F5 total is a **single global F5 level correction** (an
F5-specific env multiplier); no team-, park-, or depth-conditional terms are justified by the
2026 residuals. This confirms and sharpens modeler finding D-2 (the FG-fitted
`league_env_mult` structurally cannot close the F5-specific ~4.7% gap).

## 2. F5 total bias slices (`f5-assessor-total-bias-slices.csv`)

**Starter IP depth** (matchup mean of the two starters' as-of 2026 IP/start from the linescore
substrate; "no-prior" = either starter had no prior 2026 start):

| bucket | n | p1 bias | p2 bias (SE) | live bias | p2@live |
|---|---|---|---|---|---|
| <4.5 IP | 162 | −0.421 | −0.316 (0.278) | −0.521 | −0.333 |
| 4.5–5.0 | 231 | −0.094 | +0.013 (0.183) | −0.246 | +0.052 |
| 5.0–5.5 | 513 | −0.460 | −0.353 (0.152) | −0.519 | −0.357 |
| ≥5.5 | 410 | −0.343 | −0.244 (0.153) | −0.323 | −0.245 |
| no-prior | 239 | −0.235 | −0.166 (0.197) | −0.244 | −0.195 |

Non-monotonic; no bucket differs from the global level bias by 2 SE. **No starter-depth
residual** — the phase-0 concern that F5 mu inherits bullpen contamination proportional to
starter shortness does not materialize as a measurable total bias gradient.

**Team bullpen depth** (matchup mean of the two teams' as-of starter IP/game, quintiles): Q1
(shortest) −0.083, Q2 −0.657, Q3 −0.210, Q4 −0.223, Q5 (deepest) +0.014 (p2). Q1-vs-Q5 z =
−0.38 — no gradient. The Q2 spike is team identity, not depth: that bucket is dominated by
NYM/TOR/HOU/CWS/TB games (`f5-assessor-04-followups.py`), and per-team extremes (HOU −1.113,
CWS −1.046, MIN −0.993 … STL +0.402, TOR +0.337 — `team()` rows of the slices CSV) do **not**
survive the split-half test (§1); they are the global level bias plus sampling noise.

**Park**: pf terciles (p2 bias): low −0.096 (SE 0.126), mid −0.269 (0.141), high −0.347
(0.156); low-vs-high z ≈ 1.25. corr(parkFactor3yr, per-park p2 bias) over 30 parks = −0.212
(park factor is an external anchor, so this one is artifact-free — but weak). Directionally the
model under-projects hitter parks more, driven by the multiplicative level gap scaling with
venue run environment; not independently significant.

**Month** (p2's walk-forward env mult only reaches the FG total, so the F5 gap persists):

| month | n | p1 bias | p2 bias (SE) | live bias |
|---|---|---|---|---|
| 2026-03 | 76 | −0.117 | −0.117 (0.360) | +0.078 |
| 2026-04 | 392 | −0.298 | −0.298 (0.152) | −0.194 |
| 2026-05 | 419 | −0.222 | **−0.007** (0.154) | −0.313 |
| 2026-06 | 394 | −0.491 | **−0.417** (0.169) | −0.629 |
| 2026-07 | 274 | −0.402 | −0.277 (0.207) | −0.535 |

May's mult (1.0456) happened to fully close the F5 gap; June's smaller mult (1.0155) left
−0.42 runs in the highest-scoring month. An F5-fitted multiplier would have taken the June
residual instead of the FG one.

Secondary live-only check (`f5-assessor-02-slices.py` stdout): at its **own synthetic line**
(`modelF5Total`), live mean `pOver` = 0.4366 vs realized over rate 0.4887 (n=1,455 decided,
81 line-pushes) — the live F5 total is shaded ~5.2pp toward the under at the very line it
prices, the market-facing expression of the level bias. (Also: `modelF5Total` equals
`round(bookTotal×0.555×2)/2` on only 1,250/1,536 rows — the games row's `bookTotal` moved
after model run time on the rest; expected given no re-run, phase-0 F-4.)

## 3. F5 ML Brier by favorite strength (`f5-assessor-ml-brier-favstrength.csv`)

Decided games only (1,313 of 1,555; realized F5 tie rate 0.1556). Conditional two-way
probabilities: live from stored three-way, p1 from solved three-way (t_raw solvable on
1,555/1,555), p2 as stored (hybrid scale — modeler D-4).

| fav strength (series' own) | live n / brier / fav-win vs priced | p1 n / brier / fav-win vs priced |
|---|---|---|
| .500–.525 | 503 / 0.2500 / **.5010 vs .5123** | 460 / 0.2502 / .4848 vs .5123 |
| .525–.550 | 360 / 0.2481 / .5444 vs .5369 | 335 / 0.2451 / .5881 vs .5369 |
| .550–.600 | 343 / 0.2491 / .5452 vs .5684 | 403 / 0.2445 / .5732 vs .5702 |
| .600–.650 | 81 / 0.2337 / .6173 vs .6186 | 103 / 0.2330 / .6311 vs .6173 |
| ≥.650 | 11 / 0.2291 / .6364 vs .6635 | 12 / 0.2777 / .5000 vs .6680 (n tiny) |
| ALL | 1298 / 0.2481 | 1313 / 0.2461 (p2: 0.2469) |

- **Tossup band is 39% of decided games and carries zero skill** (live fav-win 50.1% at priced
  51.2%). Discrimination only emerges at ≥0.55, and ≥0.60 favorites occur in just 7% of games.
- **The HFA residual is the one exploitable ML structure** (downstream confirmation of modeler
  D-1): mean P(home|decided) = 0.5008 (live) / 0.5007 (p1) vs actual home rate 0.5308/0.5286 —
  home underpriced **+3.0pp** (live). By favorite side: home favorites win .5620 vs priced
  .5414 (+2.1pp); away favorites win only **.5024 vs priced .5424 (−4.0pp)** — every live away-
  favorite F5 ML price was too high. p1 same direction (+3.1pp home / −2.5pp away).
- **p2's temperature overshoots the sign**: treating p2 `pF5AwayMl` two-way gives mean
  P(home) = 0.5601 vs actual 0.5286 (**−3.16pp**, home now overpriced) — the D-4 hybrid scale
  turns a +2.8pp home underpricing into a −3.2pp overpricing, and 1,234 of 1,313 games become
  nominal "home favorites" whose .525–.550 bucket wins only .4925. p2's F5 ML must be
  rescaled before any consumer uses it as a win probability.

## 4. RL cover error vs tie frequency by total-line bucket (`f5-assessor-rl-tie-totalline.csv`)

Line = `games.bookTotal` (13 games fall back to DK schedule totals). Away+0.5 covers = away
win or tie. `live stored` = pre-M-205 tie-excluded column; `live fixed` = tie-inclusive cover
reconstructed from the stored three-way masses.

| line bucket | n | tie actual (SE) | tie p1 t_raw | tie live pushAdj | cover actual | p1 priced (err) | live stored (err) | live fixed (err) |
|---|---|---|---|---|---|---|---|---|
| ≤7.0 | 132 | .1894 (.034) | .1794 | .1685 | .6136 | .5846 (−.029) | .4934 (−.114) | .5849 (−.023) |
| 7.5 | 268 | .1604 (.022) | .1743 | .1647 | .5336 | .5876 (**+.054**) | .4958 (−.038) | .5835 (+.050) |
| 8.0 | 293 | .1638 (.022) | .1678 | .1615 | .5222 | .5820 (**+.060**) | .4950 (−.027) | .5802 (+.058) |
| 8.5 | 343 | .1633 (.020) | .1628 | .1589 | .5394 | .5786 (+.039) | .4967 (−.039) | .5794 (+.044) |
| 9.0 | 238 | .1513 (.023) | .1567 | .1549 | .5504 | .5743 (+.024) | .4983 (−.053) | .5775 (+.027) |
| 9.5 | 138 | **.1014** (.026) | **.1493** | .1515 | .5797 | .5848 (+.005) | .5120 (−.063) | .5864 (+.012) |
| ≥10.0 | 143 | .1399 (.029) | .1365 | .1452 | .6154 | .5737 (−.042) | .5122 (−.098) | .5815 (−.028) |
| ALL | 1555 | .1556 (.009) | .1626 | .1587 | .5537 | .5807 (+.027) | .4989 (−.052) | .5812 (+.030) |

Per-game regression of tie against the total line (`f5-assessor-02-slices.py` stdout):
**actual slope −1.41pp per run of line; p1 t_raw −1.05; live t_raw −0.94; live blended
pushAdj −0.56**. The engine's raw simulation already under-responds (~
−1.0 vs −1.4), and the 60/40 blend toward the constant 0.1507 prior then strips another ~40% —
the published push probability moves only 0.4× as much as reality across the line spectrum. At
9.5-total lines the model prices ties **+4.8pp too high** (p1 .1493 vs actual .1014, ~1.9 SE);
at ≤7.0 lines it prices them 1.0pp too low. This propagates into both the three-way ML split
and the RL cover mass at line extremes.

Away-cover overpricing is concentrated at mid lines (+5.4pp at 7.5, +6.0pp at 8.0, ~2 SE
each) where n is largest — the aggregate +2.7pp (modeler) is not uniform. The apparent
underpricing at the extremes (−2.9pp / −4.2pp, U-shaped actual cover) is within ~1.5 SE — not
established. RL Brier by bucket: live stored is worse than p1 in 6 of 7 buckets (ALL .2492 vs
.2452); the reconstructed tie-inclusive live series (.2472) recovers about half the gap —
consistent with the modeler's finding that the production column is the broken pre-M-205
quantity (D-3).

## 5. Worst-50 autopsies (`f5-assessor-worst50.csv`)

Score = z(|p2 total error|) + z(p1 three-way ML Brier) + z(p1 RL Brier), over all 1,555 games.
Driver: total 34/50, ML 10/50, RL 6/50. Tag lifts vs population base rate:

| tag | worst-50 | population | lift |
|---|---|---|---|
| F5_BLOWUP (actual F5 total ≥ 10) | 76% | 9.5% | **8.0×** |
| MISS_OVER4+ (actual ≥ proj + 4) | 78% | 12.3% | 6.4× |
| FAV58_LOST | 14% | 5.7% | 2.4× |
| EARLY_KO (a starter out < 9 outs) | 34% | 15.5% | 2.2× |
| HIGH_LINE (book total ≥ 10) | 20% | 9.2% | 2.2× |
| HIGH_PARK (pf ≥ 1.08) | 28% | 13.4% | 2.1× |
| TIE | 28% | 15.6% | 1.8× |
| NO_PRIOR_START / F5_DEAD | 16% / 14% | 15.4% / 12.3% | 1.0× / 1.1× |

40/50 worst games are actual > projected; worst-50 mean actual F5 total = 11.26 vs population
5.05. The catastrophic residual is one-sided: **right-tail scoring explosions** (early starter
knockouts, hitter parks, high-line slates — COL appears in 8 of 50, SEA/NYM 6, HOU/KC/PIT/CWS 5),
which the point projection (p2 range 3.2–8.5, p95 = 6.17) structurally cannot chase: actual F5
totals reach ≥8 in 20.7% of games and ≥12 in 4.0%. Worst single game: 2026-05-02 CIN@PIT
(actual F5 4-15 vs proj 5.02; CIN starter lasted 4 outs). Months spread evenly (10–14 per
month from April on) — the tail misses are not a phase; they are the distribution.

## 6. Data integrity: per-side F5 actuals wrong on 3 rows (`f5-assessor-06-actuals-check.py`)

Full-population comparison found `games.actualF5AwayScore/HomeScore` diverging from the
linescore substrate on 3/1,555 rows; **MLB StatsAPI confirms the games rows are wrong in all
three** (and internally inconsistent with the same row's correct `actualF5Total`):

| game | matchup | games row | truth (StatsAPI) | actualF5Total |
|---|---|---|---|---|
| 2250733 | 05-23 STL@CIN | 3-1 (away win) | **1-5** (home win) | 6.0 ✓ |
| 2250738 | 05-24 DET@BAL | 4-1 | **2-0** (same winner) | 2.0 ✓ |
| 2251290 | 07-07 MIL@STL | 2-3 (home win) | **3-0** (away win) | 3.0 ✓ |

The F5 winner is inverted on 2 of 3. Downstream: `f5MlResult` is truth-consistent on all three
(the M-101 grader evidently used a correct outcome source), but **`brierF5Ml` matches the
corrupted per-side columns** on the two decisive rows (0.260406 = (p−1)² for an away "win"
that never happened on 2250733; 0.241769 = p² on 2251290) — two writers in the same pipeline
grade the same market from different outcome sources. Scale is tiny (0.19% of rows) but the
columns are consumed by other analyses (the f5-modeler partition audit read them; its
aggregates move <0.1pp). Root-cause shape: `mlbScoreRefresh` wrote a stale/mid-game linescore
sum; no `away+home == actualF5Total` consistency guard exists.

## 7. Live vs p2 per slice — summary

Same-subset (n=1,536) deltas from the tables above: total level bias live −0.385 vs p2@live
−0.239 (p2 better in every month except March and every depth/park tercile slice); ML Brier
live 0.2481 vs p2 0.2469 (p2 marginally better, but its probability scale is unusable raw —
§3); RL Brier live stored 0.2492 vs p1/p2 0.2452 (fix + level). Nowhere does live beat the
replay series on a slice; the live deficit is mostly (a) pre-M-205 RL tie exclusion, (b) no
env-mult (2025 environment assumption), both already understood — no additional live-only
residual structure was found.

## Defects found (assessor lane)

- **A-1 (NEW, P2) — `games.actualF5AwayScore/HomeScore` corrupt on 3 rows, and the pipeline
  grades one market from two different outcome sources.** StatsAPI-verified inversions of the
  F5 winner on 2250733 and 2251290 (§6); `brierF5Ml` inherits the corruption while
  `f5MlResult` on the same rows does not. No internal-consistency guard
  (`away+home == actualF5Total`) exists.
- **A-2 (NEW, P2) — the F5 total residual is a pure level error; the calibration layer fixes
  the wrong series.** −0.237 runs (p2) / −0.385 (live) with OLS slope ≈ 1 and zero split-half
  team/park/depth structure (§1–2). May's FG-fitted mult accidentally closed it (−0.01); June
  kept −0.42. A single F5-fitted multiplier is sufficient AND necessary; no conditional terms.
- **A-3 (NEW, P2) — tie mass is ~60% too flat across total lines.** Actual tie-vs-line slope
  −1.41pp/run vs blended model −0.56pp/run (raw sim −0.94/−1.05; the 60/40 constant-prior
  blend does the rest). Ties overpriced +4.8pp at 9.5 lines, underpriced ~1pp at ≤7.0 —
  distorts three-way ML and RL cover at line extremes (§4).
- **A-4 (downstream confirmation of D-1, P1 upstream) — the missing F5 HFA is the only
  exploitable ML structure and it is favorite-side-shaped.** Live away favorites won .5024 at
  priced .5424 (−4.0pp); home favorites .5620 at .5414 (+2.1pp) (§3). Also **quantified D-4
  consequence**: p2's temperature flips the sign of the home edge (+2.8pp underpriced →
  −3.2pp overpriced), so p2 F5 ML is not a usable win probability without rescaling.
- **A-5 (NEW, P3) — 39% of decided F5 games sit in a .500–.525 band with zero realized
  skill** (fav win rate .5010 live). Any F5 ML bet policy must gate on strength ≥.55 at
  minimum; below that the model is noise.
- **A-6 (observational) — worst-50 misses are one-sided right-tail blowups** (8× lift for
  actual F5 ≥ 10; 40/50 under-projections; EARLY_KO 2.2×) — the cost center of the level bias
  and the compressed projection range, not a separate defect.

Verified-good (explicitly): as-of starter-depth and bullpen-depth slices show **no**
residual gradient (the phase-0 bullpen-contamination concern is not measurable in totals);
park gradient directionally negative but < 2 SE; p1 t_raw solvable and physically sensible on
1,555/1,555 games; live three-way masses internally consistent; the 3-row actuals defect does
not materially move any aggregate in this report (<0.1pp).

## Recommendations

1. Add the F5-specific walk-forward level multiplier (fit on F5 residuals already computed for
   `f5_total_sd`) — one global factor; explicitly do NOT add team/park terms (A-2, §1).
2. Make the tie prior line-dependent (e.g., regress 2026 tie rate on total line: ~0.155 −
   0.014·(line−8.5)) or cut the 0.4 constant-blend weight; re-derive three-way ML and RL from
   the corrected mass (A-3).
3. Apply HFA to the F5 mus (modeler D-1); acceptance test: away-favorite priced-vs-won gap
   within ±1.5pp on a season replay (A-4).
4. Guard `mlbScoreRefresh`: reject/retry when `actualF5Away+actualF5Home != actualF5Total`
   once both exist; repair the 3 rows; unify the outcome source for `brierF5Ml` and
   `f5MlResult` (A-1).
5. Rescale p2's F5 ML to a declared probability space (condition on decided, or fit T on the
   conditional pair — modeler D-4) before any consumer reads it (A-4).
6. Bet-policy gates while upstream fixes land: no F5 ML below .55 conditional strength (A-5);
   no F5 RL pricing from the live tie-excluded column (modeler D-3); treat F5 total prices as
   shaded ~5pp to the under at the model's own line (§2).
