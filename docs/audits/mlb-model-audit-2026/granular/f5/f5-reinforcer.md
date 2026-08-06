# F5 — REINFORCER — Is the current calibration structurally sufficient?

Role: REINFORCER (synthesis + concrete walk-forward-justifiable parameter/model improvements).
Market group: F5 (moneyline / run line ±0.5 / total).
Population: **all 1,555** final 2026 regular-season MLB games with `mlbGamePk`,
2026-03-25..2026-07-24 (the 2026-07-14 All-Star exhibition is the scope-exempt 1,556th final).
Every number below comes from a named script run against the full population; sampling was not
used anywhere.

**Verdict up front: the current calibration layer (single `T_f5` + shared FG `league_env_mult`
+ RL passthrough) is structurally INSUFFICIENT for F5 on three of four axes — the F5 run
environment, the ML temperature scale, and the RL probability — and exactly sufficient on the
fourth (the 0.1507 push prior, which is empirically correct and needs no refit).**

## Scripts and invocations

All run 2026-07-25 with `<scratchpad>/venv/bin/python` from the worktree root:

| Script (granular/tools/) | Purpose | Outputs (granular/f5/) |
|---|---|---|
| `f5-reinforcer-01-extract.py` | full-population extraction (games + p1 + p2 + calibMeta + book lines + actuals w/ linescore fallback), coverage assertions, run-context snapshot | `f5-reinforcer-population.csv` (1,555 rows) |
| `f5-reinforcer-02-env-total.py` | Q1: F5-specific vs FG env by month; walk-forward counterfactual p2′ with an F5-specific env mult | `f5-reinforcer-env-by-month.csv`, `f5-reinforcer-total-counterfactual.csv` |
| `f5-reinforcer-03-rl-baseline.py` | Q2: stored RL probability vs constant / Skellam margin-distribution / Platt baselines; reliability deciles; f5_rl grading-mispairing audit | `f5-reinforcer-rl-baselines.csv`, `f5-reinforcer-rl-reliability.csv`, `f5-reinforcer-rl-mispairing.csv` |
| `f5-reinforcer-04-push-ml.py` | Q3: push prior 0.1507 vs observed by month; T_f5 structure alternatives (conditional T / conditional Platt / absolute Platt) | `f5-reinforcer-push-by-month.csv`, `f5-reinforcer-ml-structures.csv` |

## Run context (recorded at execution time, 2026-07-25)

- `mlb_replay_projections`: `wf-19288f01-p1` = 1,555 rows, `wf-19288f01-p2` = 1,555 rows;
  **no `-p2d` series existed during this run**. Coverage vs the population: 0 missing, 0 extra
  (asserted).
- `mlb_replay_grades` F5 rows at run time (pipeline still writing; timing note, not a defect):
  9,646 total — f5_ml live 1,527 / p1 1,545 / p2 1,545; f5_rl live 837 / p1 838 / p2 838;
  f5_total live 838 / p1 839 / p2 839.
- FG and F5 actuals present in `games` for all 1,555 (0 linescore fallbacks used).
- Cross-validation against the published run: my per-month reproduction of p2 `f5_ml`
  (e.g. 2026-07: Brier 0.24511 / logloss 0.68328, n=233) matches
  `calibration/before-after.md` (0.2451 / 0.6832, n=231) to publication precision; small n
  drift (±3/month) is month-bucketing of doubleheader dates, not data disagreement.

## Q1 — Is a shared FG env-mult right for F5? **No — the F5 env is its own, higher, stable number**

`f5-reinforcer-02-env-total.py` → `f5-reinforcer-env-by-month.csv`. In-month ratios
(actual/projected, p1 raw model):

| month | n | FG env (act/proj) | F5 env (act/proj) | F5 − FG | applied mult (shared, FG-fitted) | actual F5 share of FG | p1 projected ratio |
|---|---|---|---|---|---|---|---|
| 2026-03 | 76 | 1.0158 | 1.0259 | +0.0102 | 1.0 (seed) | 0.5389 | 0.5336 |
| 2026-04 | 392 | 1.0492 | 1.0642 | +0.0150 | 1.0 (seed) | 0.5430 | 0.5354 |
| 2026-05 | 419 | 0.9802 | 1.0476 | +0.0674 | 1.04564 | 0.5731 | 0.5362 |
| 2026-06 | 394 | 1.0514 | 1.1029 | +0.0515 | 1.01551 | 0.5629 | 0.5366 |
| 2026-07 | 274 | 1.0316 | 1.0854 | +0.0538 | 1.02613 | 0.5648 | 0.5368 |

The F5-specific environment sits **above the FG environment in all five months** (+1.0pp to
+6.7pp, and +5.1 to +6.7pp in every post-seed month). The gap is stable because its cause is
structural, not environmental: the p1 projected F5/FG ratio is glued to ~0.536 (the HFA-skip +
extras-inflation mechanism quantified by the F5 MODELER as D-1/D-2) while the actual F5 share
runs 0.563–0.573. A shared FG-fitted mult can never close a wedge that lives between the two
markets. (My expanding-window FG ratio reproduces the applied `league_env_mult` to within
0.2% each month — the shared mult is implemented correctly; it is the *structure* that is
wrong.)

**Walk-forward counterfactual** (`f5-reinforcer-total-counterfactual.csv`): p2′ = identical
transform family, identical monthly `f5_total_sd`, with the single change
`league_env_mult_f5(m)` = expanding (actual F5 runs / p1 projected F5 runs over months < m)
instead of the shared FG mult (seed months 1.0, so p2′=p1 there; fitted values 1.0581 May,
1.0531 Jun, 1.0686 Jul):

| May–Jul (post-seed) | p1 | p2 (shared env) | p2′ (F5-specific env) |
|---|---|---|---|
| projF5Total bias vs actual (n=1,087) | −7.18% | −4.42% | **−1.71%** |
| bias in runs (±SE) | −0.367 ±0.100 | −0.226 ±0.100 | **−0.087 ±0.100** |
| graded hit rate at book f5Total (n=461) | 0.5271 | 0.5336 | **0.5531** |
| Brier / logloss (n=461) | 0.2489 / 0.6911 | 0.2478 / 0.6889 | **0.2476 / 0.6885** |

Paired per-game Brier delta (p2′ − p2, post-seed graded n=461): −0.00021 (SE 0.00078) — the
probability-accuracy gain is not yet separable from noise at this n, but the level bias
(the thing the env-mult exists to fix) improves by 2.7pp of total runs and the graded hit rate
by +1.95pp, with zero new information sources and one added parameter fitted exactly the way
the existing one already is (the F5 residuals are already collected for `f5_total_sd`; only
their mean is discarded).

## Q2 — F5 RL accuracy now vs a simple margin-distribution baseline: **the 400k-sim number loses to a 2-parameter Skellam**

Event: away +0.5 covers = {actualF5Away ≥ actualF5Home} — exactly what the M-205-fixed
`pF5AwayRl` prices; p1==p2 passthrough asserted on all 1,555. Baselines are walk-forward-clean
(seed months use only pre-season in-code constants: cover 0.5489 = `EMPIRICAL_F5` away-RL
prior; share 0.5618 = `F5_RUN_SHARE`). `f5-reinforcer-03-rl-baseline.py` →
`f5-reinforcer-rl-baselines.csv`:

| ALL (n=1,555; cover rate 0.5537) | mean p | CITL | Brier | logloss |
|---|---|---|---|---|
| stored model (p1/p2, 400k-sim, no HFA) | 0.5807 | **+0.0270** | 0.24514 | 0.68345 |
| constant (walk-forward cover rate) | 0.5469 | −0.0068 | 0.24720 | 0.68753 |
| **Skellam(mu_h, mu_a), mu = p1 FG side score × share_wf** | 0.5544 | **+0.0007** | **0.24442** | **0.68204** |
| Platt-recalibrated stored model (walk-forward) | 0.5562 | +0.0025 | 0.24499 | 0.68310 |
| live `modelF5AwayRLCoverPct`/100 (tie-excluded, subpop n=1,536) | 0.4989 | −0.0525 | 0.24920 | 0.69155 |

Paired vs the stored model (n=1,555): Skellam −0.00073 (SE 0.00088), Platt −0.00016
(SE 0.00075), constant +0.00205 (SE 0.00149). The Skellam wins every post-seed month's Brier
(May 0.24769 vs 0.24811, Jun 0.24126 vs 0.24143, Jul 0.24031 vs 0.24251) and is wider-ranged
(deciles 0.32–0.80 vs 0.42–0.76 — more discriminative, `f5-reinforcer-rl-reliability.csv`).

Reading: a two-input Poisson-difference CDF on the **HFA-bearing FG projections** matches or
beats the model's own independent 400k-sim F5 resample, and removes essentially all of the
+2.7pp calibration-in-the-large overprice of the away side. The elaborate F5 sampling layer is
currently *value-destroying* relative to the information it already has upstream — the direct
structural symptom of the MODELER's D-1 (F5 mus skip HFA). The live tie-excluded series is
worse than a constant (0.24920 vs 0.24731 on its post-seed subpop) — confirming D-3 severity.

**Grading mispairing found (R-1)** (`f5-reinforcer-rl-mispairing.csv`): the replay grader
(`calibrate_and_grade.py:1090-1099`) and the live ledger pair the stored **+0.5-cover**
probability with **whatever away line the book posted**: of 843 lined population games, only
501 are +0.5; 269 are −0.5 and 73 are |line|>0.5. On the 269 −0.5-line games the stored
probability overstates the booked event (strict away win) by its tie mass — mean +16.3pp —
and grades Brier 0.27687 where the correctly-paired probability (raw away-win mass `a`,
solvable per game from the stored RL+ML pair; solved 269/269) grades 0.24583. This artifact —
not model regression — is why `before-after.md` shows live beating p1 on f5_rl in April/May:
the tie-excluded live number is accidentally closer to the strict-win event on −0.5 lines.
All 838-row f5_rl series in `mlb_replay_grades` inherit this contamination.

## Q3 — Push prior 0.1507 vs observed: **keep it; nothing to fix**

`f5-reinforcer-04-push-ml.py` → `f5-reinforcer-push-by-month.csv`. Observed F5 tie rate by
month: 0.1842 (Mar, n=76), 0.1607 (Apr), 0.1384 (May), 0.1675 (Jun), 0.1496 (Jul);
season 0.1556 ±0.0092. The 0.1507 prior is within 1σ of every single month (|z| ≤ 0.89) and
0.5σ of the season. Tie-event Brier on all 1,555 (raw implied sim tie mass solved from the
stored RL+ML equations, 1,555/1,555 solvable; validated vs live `modelF5PushRaw`, mean |Δ|
0.0094): raw 0.13113 · production blend 0.6·raw+0.4·0.1507 = 0.13115 · constant 0.1507 =
0.13143 · walk-forward-refit blend 0.13122. All within 0.0004 of each other; the refit
actually drifts to a degenerate prior (w→0.96, prior→0.02 bound) chasing noise with no gain.
**Recommendation: freeze the 0.1507 prior and the 0.6/0.4 blend as-is** — and note this makes
the latent auto-recalibration bug that would overwrite it with 0.05 (phase-0 F-6) strictly
harmful.

## T_f5 structure — the temperature is fitted on the wrong scale, and a 2-parameter Platt beats it

Confirms and quantifies MODELER D-4. Current scheme fits T on the *absolute* three-way
`pF5AwayMl` against decided-game outcomes; the fitted T (1.48→1.57→1.66) is mostly absorbing
the tie-as-loss level offset, not sharpening: refit on the *conditional* scale the temperature
collapses to 1.06–1.18. Walk-forward alternatives evaluated as predictors of
P(away wins | decided) on decided games (`f5-reinforcer-ml-structures.csv`):

| May–Jul decided (n=922; obs away rate 0.4794) | mean p | CITL | hit | Brier | logloss | paired Δlogloss vs p2 (SE) |
|---|---|---|---|---|---|---|
| current p2 (T on absolute) | 0.4495 | −0.0299 | 0.5380 | 0.24699 | 0.68707 | — |
| altA: condition first, then T | 0.5005 | +0.0211 | 0.5499 | 0.24554 | 0.68419 | −0.00288 (0.00359) |
| altB: Platt(a,b) on conditional | 0.4626 | −0.0168 | 0.5542 | 0.24539 | 0.68383 | −0.00324 (0.00144) |
| **altC: Platt(a,b) on absolute logit** | 0.4635 | −0.0159 | **0.5694** | **0.24502** | **0.68308** | **−0.00398 (0.00156)** |

The 2-parameter Platt on the absolute logit — same input the current layer already uses, one
added intercept — is significantly better walk-forward (2.5 SE), lifts decided-game hit rate
+3.1pp, and cuts the −3.0pp calibration-in-the-large error in half (the intercept absorbs both
the tie-mass level offset and part of the missing home tilt that a pure temperature
mathematically cannot express). Its output also has a single clean meaning
(≈ P(away | decided)) instead of p2's documented hybrid.

## Synthesis — recommended parameter structure (all walk-forward-measured on this population)

1. **Engine first (root cause, from MODELER D-1/D-2, reinforced here):** apply the HFA
   multipliers to the F5 mus and make the F5 share denominator-consistent. My RL test is the
   sharpest evidence this dominates: the model's own FG projections, which include HFA, price
   the F5 RL better through a plain Skellam than the F5 simulation layer does.
2. **Calibration layer, if/until the engine fix ships (three one-line-scale changes):**
   - add `league_env_mult_f5(m)` fitted exactly like the FG mult but on F5 residuals
     (already collected for `f5_total_sd`): post-seed total bias −4.42% → −1.71%, graded hit
     +1.95pp (n=461), Brier/logloss no worse;
   - replace `T_f5` with monthly **Platt (a,b) on the ML logit**: paired Δlogloss −0.00398
     ±0.00156, hit +3.1pp on 922 decided; define the output scale explicitly (conditional);
   - replace the **RL passthrough** with either the Skellam-derived cover from the (env-
     multiplied) FG side scores or at minimum monthly Platt on the stored RL logit: fixes the
     +2.7pp away-side overprice (CITL +0.0270 → +0.0007 Skellam / +0.0025 Platt) at equal or
     better Brier.
   - **do not** touch the push prior/blend (0.1507 verified; refit demonstrably chases noise).
3. **Grading repair (R-1):** f5_rl grading must compute the probability of the *booked* line's
   event (the raw masses are solvable from stored fields for ±0.5; store `a`/`t` explicitly
   going forward) — 342/843 currently-graded rows are mispaired, and the f5_rl rows in
   `mlb_replay_grades`/`before-after.md` should be annotated or regraded before anyone reads
   them as model-quality evidence.

## Defects / findings (REINFORCER lane)

- **R-1 (NEW, P2) — f5_rl grading mispairs probability and line.** Replay grader
  (`calibrate_and_grade.py:1090-1099`; live ledger analogously) grades the fixed
  +0.5-cover probability against book away lines of −0.5 (269/843) and |line|>0.5 (73/843).
  On the −0.5 subset: stored-p Brier 0.27687 vs 0.24583 correctly paired; mean overstatement
  +16.3pp. Explains the spurious live>p1 f5_rl result in `before-after.md` (Apr/May).
- **R-2 (structural, P2) — a single shared env-mult cannot calibrate F5 totals.** F5 env
  exceeds FG env by +5.1..+6.7pp in every post-seed month (cause: fixed projected ratio
  ~0.536 vs actual share 0.563–0.573); shared-mult p2 leaves −4.42% post-seed bias that an
  identically-fitted F5-specific mult cuts to −1.71% with +1.95pp graded hit.
- **R-3 (quantified confirmation of MODELER D-4, P3) — T_f5 on mismatched scales wastes its
  one parameter.** T 1.48–1.66 collapses to 1.06–1.18 once the level offset is removed;
  a same-input Platt beats the current scheme by −0.00398 logloss (2.5 SE) and +3.1pp hit.
- **R-4 (structural symptom, P2) — the independent F5 400k-sim resample adds no probability
  value over a 2-parameter Skellam on the HFA-bearing FG projections** (paired ΔBrier
  −0.00073 in Skellam's favor; CITL +2.70pp vs +0.07pp; Skellam wins all three post-seed
  months) — i.e. the F5 sampling layer currently destroys upstream information (D-1 pathway).
- **Verified-good (explicitly):** push prior 0.1507 (obs 0.1556 ±0.0092, every month within
  1σ; blend weights optimal to 4 decimal places of Brier); RL p1→p2 passthrough (asserted
  identical on 1,555/1,555); shared-mult implementation (my expanding FG ratio reproduces
  applied `league_env_mult` within 0.2%/month); p2 f5_ml month metrics reproduce
  `before-after.md` to publication precision.
