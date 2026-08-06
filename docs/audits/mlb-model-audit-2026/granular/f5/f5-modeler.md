# F5 — MODELER — Granular Season Backtest (Full Population)

Role: MODELER (re-derive and verify the F5 projections themselves).
Market group: F5 (moneyline / run line ±0.5 / total).
Population: **all 1,555** final 2026 regular-season MLB games with `mlbGamePk`,
2026-03-25..2026-07-24 (the 2026-07-14 AL@NL All-Star exhibition, gameId 4110001, is the
scope-exempt 1,556th final). Every number below comes from a named script executed against the
full population — no sampling.

## Scripts and invocations

All run with `<scratchpad>/venv/bin/python` from `granular/tools/`:

| Script | Purpose | Outputs |
|---|---|---|
| `f5-modeler-01-extract.py` | population extraction + coverage assertions + run-context snapshot | `f5-modeler-population.csv` (1,555 rows) |
| `f5-modeler-02-analyze.py` | ranges, partition/tie audit, p2 transform verification, ratio distribution | `f5-modeler-ranges.csv`, `f5-modeler-partition.csv`, `f5-modeler-partition-calibration.csv`, `f5-modeler-p2-verify.csv`, `f5-modeler-ratio.csv` |
| `f5-modeler-03-ratio-mechanism.py` | engine-exact sampling replication; decomposes the ratio deficit | `f5-modeler-ratio-mechanism.csv` |
| `f5-modeler-04-aggregates.py` | monthly walk-forward params, ML side empirics, actual run share + projection bias, live-missing list | `f5-modeler-monthly.csv` |

## Run context (recorded at execution time, 2026-07-25)

- `mlb_replay_projections`: `wf-19288f01-p1` = 1,555 rows, `wf-19288f01-p2` = 1,555 rows.
  **No `-p2d` series existed during this run.** Both series' gameIds match the 1,555-game
  population exactly (0 missing, 0 extra — asserted in `f5-modeler-01-extract.py`).
- `mlb_replay_grades`: **0 rows** for markets `f5_ml`/`f5_rl`/`f5_total` at run time (the
  grading pipeline was still writing; per protocol this is a timing note, not a defect).
- Zero NULLs in any p1/p2 F5 column (1,555/1,555 each); `calibMeta` present on every row.
- Live `games.modelF5*`: populated for 1,536/1,555; 19 games have replay-only coverage
  (listed at the end; 9 of the 19 are the 2026-05-07 slate).

## 1. Pass-1 projection ranges (`f5-modeler-02-analyze.py`, `f5-modeler-ranges.csv`)

| Series | n | min | p05 | med | p95 | max | mean | out-of-bounds |
|---|---|---|---|---|---|---|---|---|
| p1 `pF5AwayMl` | 1555 | 0.26210 | 0.34151 | 0.41980 | 0.50269 | 0.60970 | 0.42050 | 0 |
| p1 `pF5Over` | 1555 | 0.14930 | 0.33824 | 0.44170 | 0.54220 | 0.68100 | 0.44081 | 0 |
| p1 `pF5AwayRl` | 1555 | 0.41880 | 0.49884 | 0.58090 | 0.66023 | 0.75950 | 0.58074 | 0 |
| p2 `pF5AwayMl` | 1555 | 0.26210 | 0.36885 | 0.44230 | 0.50189 | 0.60970 | 0.43976 | 0 |
| p2 `pF5Over` | 1555 | 0.14930 | 0.34643 | 0.45323 | 0.55958 | 0.69072 | 0.45334 | 0 |
| p2 `pF5AwayRl` | 1555 | 0.41880 | 0.49884 | 0.58090 | 0.66023 | 0.75950 | 0.58074 | 0 |
| p1 `projF5Total` | 1555 | 3.205 | 3.830 | 4.614 | 5.986 | 8.359 | 4.71499 | — |
| live `modelF5AwayRLCoverPct`/100 | 1536 | 0.31700 | 0.41147 | 0.49750 | 0.58852 | 0.67590 | 0.49895 | 0 |
| live `modelF5PushRaw` | 1536 | 0.11060 | 0.13418 | 0.16410 | 0.19330 | 0.22340 | 0.16402 | 0 |

All probabilities strictly inside (0,1); no clamp pile-ups at 0.001/0.999; no degenerate
constants. Note the structural gap between the replay RL series (mean 0.5807, tie-inclusive)
and the live RL series (mean 0.4990, tie-excluded) — quantified in §2.

## 2. F5 RL partition validity under the tie fix (M-205)

Away +0.5 prices the event {F5 margin home−away < +0.5} = away win OR tie. Actuals from
`games.actualF5AwayScore/HomeScore` (present for all 1,555). Per-game detail in
`f5-modeler-partition.csv`; decile calibration in `f5-modeler-partition-calibration.csv`.

**Replay series (p1/p2) carry the fix and are internally consistent:**
- `pF5AwayRl > pF5AwayMl` in **1,555/1,555** games (tie mass included on the away side; 0 violations).
- Implied raw tie mass solved per game from the engine's own equations
  (RL = a + t; ML = a·(1−(0.6t+0.4·0.1507))/(1−t)): solvable in **1,555/1,555** games,
  mean 0.1626 (sd 0.0176, range 0.1017–0.2210) vs **actual F5 tie rate 0.1556** (SE 0.0092) —
  consistent (+0.70pp).
- Since only the away side is stored, home cover = 1 − `pF5AwayRl` by construction; the
  partition sums to 1 identically (verified as the passthrough identity in §3).

**Priced vs realized cover mass (n=1,555):**
- Actual away+0.5 cover rate **0.5537** (SE 0.0126); priced p1 mean **0.5807** (p2 identical —
  documented passthrough). Away cover **overpriced +2.70pp** (~2.1 SE). Decomposition: raw away
  win overpriced +2.0pp (implied a mean 0.4182 vs actual away F5 win 0.3981) + tie overpriced
  +0.7pp. Root cause is the HFA skip (§4/D-1), not the tie fix.
- Brier (away+0.5): p1 = 0.2451, p2 = 0.2451, live = 0.2492 (n=1,536). Constant-baseline
  (always 0.554) = 0.2471 — the live tie-excluded series is worse than the constant baseline;
  the fixed replay series is better.
- Decile calibration (p1): overprice concentrated in d2 (+8.0pp), d10 (+6.4pp), d5/d7 (+4.4pp);
  d3/d4/d6/d9 within ±1.1pp.

**Live `games` rows are ALL pre-fix (D-3):** reconstructing raw home/away masses from stored
`modelF5AwayWinPct/HomeWinPct/PushPct/PushRaw` and comparing `modelF5AwayRLCoverPct` against the
two candidate conventions classifies **1,536/1,536 rows as tie-excluded (pre-M-205)**:
mean |stored − tie-excluded prediction| = 0.00014 (max 0.0012) vs mean |stored − tie-inclusive
prediction| = 0.08227. The production away+0.5 cover probability **understates true cover mass
by mean +8.23pp (range +4.13 to +12.05pp) on every one of 1,536 games**; no backfill has
occurred. Three-way sums (`away+home+push`) and RL side sums are internally consistent on all
1,536 rows (0 violations > 0.005).

## 3. Pass-2 transform verification — every row (`f5-modeler-p2-verify.csv`)

For each of the 1,555 p2 rows, all four F5 fields were recomputed from the stored p1 row plus
the p2 row's own `calibMeta` (`T_f5`, `league_env_mult`, `f5_total_sd`), replicating
`calibrate_and_grade.py::write_pass2` exactly:
`pF5AwayMl₂ = σ(logit(p₁)/T_f5)`; `projF5Total₂ = projF5Total₁ × mult`;
`pF5Over₂ = Φ(Φ⁻¹(pF5Over₁) + (projF5Total₂−projF5Total₁)/f5_total_sd)`; `pF5AwayRl₂ = pF5AwayRl₁`.

| Field | mismatches beyond DB-rounding tolerance | max abs diff | tolerance |
|---|---|---|---|
| `pF5AwayMl` | **0 / 1555** | 0.0000050 | 5.5e-6 (decimal(7,5)) |
| `projF5Total` | **0 / 1555** | 0.0004996 | 5.5e-4 (decimal(6,3)) |
| `pF5Over` | **0 / 1555** | 0.0000050 | 5.5e-6 |
| `pF5AwayRl` | **0 / 1555** | 0.0000000 (exact passthrough) | 5.5e-6 |

The p2 series is exactly what the protocol documents — no drift, no hidden extra transform,
and the RL passthrough is bit-exact. Seed months (2026-03/04, T=1, mult=1) pass through p1
unchanged, as designed.

Walk-forward parameters actually applied (`f5-modeler-monthly.csv`):

| month | n | T_f5 | league_env_mult | f5_total_sd |
|---|---|---|---|---|
| 2026-03 (seed) | 76 | 1.0 | 1.0 | 2.9 |
| 2026-04 (seed) | 392 | 1.0 | 1.0 | 2.9 |
| 2026-05 | 419 | 1.4814 | 1.04564 | 3.0471 |
| 2026-06 | 394 | 1.5720 | 1.01551 | 3.0969 |
| 2026-07 | 274 | 1.6597 | 1.02613 | 3.1800 |

## 4. projF5Total / projTotal ratio (`f5-modeler-ratio.csv`, mechanism in `f5-modeler-ratio-mechanism.csv`)

Population distribution (p1): **mean 0.53556**, sd 0.00549, range [0.51837, 0.55540];
p2 ratio identical per game (max |p2−p1| = 0.000096 — both totals scale by the same mult).
All 1,555 inside the engine's hard bounds 0.5618×[0.90, 1.10], but the center is **−4.67%
below the engine's own F5_RUN_SHARE = 0.5618**, and the entire distribution sits below 0.5554
— i.e. every single game's F5 total is projected at a sub-share fraction of its FG total.

Reality check (full population, `f5-modeler-04-aggregates.py`): actual F5 share of full-game
runs = **0.5597** (share of means; 0.5656 mean per-game share) — the 0.5618 constant is
empirically correct; the projected ratio is what's wrong.

Mechanism (engine sampling replicated exactly — same NB-Gamma mixture, clip, per-draw variance
rule, ghost-runner extras, seed 42, 400k sims; `f5-modeler-03-ratio-mechanism.py`). At
population-typical mus the replication reproduces the observed ratio (0.5379 at mu 4.4, 0.5342
at mu 3.8 — observed population mean 0.53556) and decomposes the −4.25% deficit at the typical
case with **residual −0.00%**:

1. **HFA skip (−1.21%)**: FG sampling mus get HFA (home ×1.0525, away ×0.972 at hfa=0.35;
   `server/MLBAIModel.py:945-947`) but F5 mus are built from the **un-adjusted**
   `home_state["mu"]`/`away_state["mu"]` (`MLBAIModel.py:1259-1261` in the replay-fixed
   revision). See D-1 — this also erases home-field advantage from F5 ML/RL pricing.
2. **Extra-innings inflation of the denominator (−3.04% at typical mus)**: `exp_total`
   includes ghost-runner extras (mu/9 + 0.50 per side per extra inning; 9.7% of sims tied
   after 9 → +0.28 runs ≈ 3.0% of the FG total), while `exp_f5_total` has no analogue.
   (TEAM_F5_RS nets to ~0: table mean 2.4837 vs league const 2.484.)

Consequence for the total market (D-2): p1 `projF5Total` under-projects actual F5 totals by
**−6.68%** (mean 4.715 vs actual 5.053) while p1 `projTotal` is only −2.58% low. The
walk-forward `league_env_mult` is fitted on FG totals, so it corrects both by the same factor:
p2 FG total lands at −0.54% while **p2 F5 total stays −4.73% low** — the F5-specific gap is
structurally uncorrectable by the current calibration layer, and `pF5Over` is priced from a
distribution centered ~4.7% too low.

## Defects found (modeler lane)

- **D-1 (NEW, P1) — F5 simulation omits home-field advantage entirely.**
  `MLBAIModel.py` applies HFA to the FG mus but builds `mu_f5` from the pre-HFA state mus.
  Population evidence: model implied home−away F5 edge **+0.11pp** vs actual **+4.82pp**
  (n=1,555, ~3.8 SE); away+0.5 cover overpriced +2.70pp; away ML overpriced +2.24pp
  (p1 absolute 0.4205 vs actual away F5 win 0.3981). Affects live AND both replay passes
  (temperature can only symmetrize, not re-tilt, the home/away split).
- **D-2 (NEW, P2) — F5 total level bias is structural and uncorrected.** projF5Total −6.68%
  (p1) / −4.73% (p2) vs actuals while FG totals are −2.58% / −0.54%; deficit = HFA skip
  (1.21%) + FG-only extras inflation (~3.0%) with an FG-fitted league_env_mult that cannot
  close an F5-specific gap. F5_RUN_SHARE itself (0.5618) matches reality (0.5597).
- **D-3 (quantification of known M-205 scope) — production DB never backfilled.** All
  1,536 live `modelF5AwayRLCoverPct` rows in the population are the pre-fix tie-excluded
  quantity, understating away+0.5 cover by mean **+8.23pp** (+4.13..+12.05); their Brier
  (0.2492) is worse than a constant-probability baseline (0.2471). The fix exists only in
  the replay series.
- **D-4 (NEW, P3) — T_f5 is fitted on mismatched scales.** The temperature pairs the
  *absolute* three-way p1 `pF5AwayMl` (tie counted as a third outcome) with an outcome sample
  restricted to decided games (calibrate_and_grade.py:708-716). The fitted T (1.48→1.66)
  therefore mostly absorbs the tie-as-loss level offset (p1 mean 0.4205 vs conditional truth
  0.4714), and p2 `pF5AwayMl` (mean 0.4398) becomes a hybrid that is neither the absolute
  away-win probability (actual 0.3981) nor the conditional one (0.4714) — its meaning silently
  changes between passes.

Verified-good (explicitly): p1/p2 coverage is exactly the population; all ranges physical;
replay RL partition + tie handling correct in all 1,555 games; implied tie mass matches the
realized tie rate; the p2 transform is implemented exactly as documented with 0/1,555
mismatches on every field; RL passthrough bit-exact.

## Games with no live modelF5* (replay-only), n=19

2250006 03-25 NYY@SF · 2250092 04-03 TOR@CWS · 2250331 04-21 PIT@TEX · 2250332 04-21 SD@COL ·
2250374 04-25 BOS@BAL · 2250468 05-02 ATL@COL · 2250494 05-04 NYM@COL · 2250513 05-06 MIL@STL ·
2250515 05-06 NYM@COL · 2250519 05-06 BOS@DET · 2250526–2250533 + 2252833 (the 2026-05-07
slate, 9 games).

## Recommendations

1. Apply the HFA multipliers to the F5 mus (or add a calibrated F5-specific HFA) — this is a
   one-line pairing fix in `simulate()` and removes both the ML symmetry error and 1.2pp of the
   away-RL overprice (D-1).
2. Rebase the F5 total on a denominator-consistent share: either scale from the HFA-adjusted
   9-inning mus, or fit a separate F5 env multiplier in the walk-forward layer (F5 residuals
   are already computed for `f5_total_sd`; the mean is discarded) (D-2).
3. Backfill or version-flag the 1,536 pre-fix live `modelF5*RLCoverPct` rows before any
   consumer reads them as cover probabilities (D-3).
4. Fit T_f5 on a scale-consistent pair — either condition p1 (divide by 1−push) before the
   logit, or fit on the three-way outcome directly (D-4).
