# NRFI — EVALUATOR (granular 5x5 backtest)

Full-population per-game evaluation ledger + metric suite for the NRFI/YRFI market.
All numbers below come from executed scripts in `granular/tools/`:

- `nrfi-evaluator-01-extract.py` — DB extraction (run 2026-07-25T21:07:04Z)
- `nrfi-evaluator-02-ledger.py` — ledger + metric suite (full population)
- `nrfi-evaluator-03-statsapi.py` — external StatsAPI ground-truth sample (n=40)

Outputs: `nrfi-evaluator-ledger.csv` (4,665 rows = 1,555 games x 3 series),
`nrfi-evaluator-monthly-metrics.csv`, `nrfi-evaluator-reliability.csv`,
`nrfi-evaluator-sides.csv`, `nrfi-evaluator-crosscheck.csv`,
`nrfi-evaluator-statsapi-sample.csv`, `nrfi-evaluator-summary.json`.

## Population & run context

- Scope: all final 2026 regular-season MLB games 2026-03-25..2026-07-24 with `mlbGamePk`:
  **1,555 games** (1,556 finals; the one exemption is the 2026-07-14 AL@NL All-Star
  exhibition, `games.id` 4110001, no `mlbGamePk` — per audit scope).
- Series evaluated: **live** (`games.modelPNrfi`), **p1** (`wf-19288f01-p1`),
  **p2** (`wf-19288f01-p2`). No `-p2d` rows existed in `mlb_replay_projections` at
  extraction time (recorded; versions present: p1, p2, each 1,555 with `pNrfi`).
- `mlb_replay_grades` snapshot at run time (ledger being written by a running pipeline;
  incompleteness there is not a defect): `nrfi_yrfi` live_pregame 1,527;
  wf-19288f01-p1 1,545; wf-19288f01-p2 1,545.
- Live coverage: 1,536/1,555 games have `modelPNrfi` (19 never projected). Live p is
  quantized to 2dp, observed range 0.30–0.63, with a **mass point at exactly 0.50
  (119 games, 7.7%)**.
- Provenance (P-001 quarantine, live series only): 1,176 clean (`modelRunAt` < first
  pitch), 346 leakage-flagged (`modelRunAt` >= first pitch), 33 with `modelRunAt` NULL
  (14 of those have a probability but no timestamp — unknown provenance, excluded from
  the clean subset; the other 19 are the no-projection games).

## Grading rules (stated before running)

- P(NRFI): `modelPNrfi` (live) / `pNrfi` (replay). Pick = NRFI if p>0.5, YRFI if p<0.5,
  NONE if p==0.5 (excluded from hit rate, included in Brier/log loss).
  `hit_rate_half_as_yrfi` replicates the running pipeline's 0.5→YRFI convention.
- Actual: `mlb_replay_linescores` inn1 runs (NRFI iff inn1Away==0 and inn1Home==0),
  available for all 1,555; `actualNrfiBinary` and `nrfiActualResult` cross-checked
  against it. Base rate NRFI = **48.94%** (761 NRFI / 794 YRFI).
- Brier = (p−actual)²; log loss clipped at 1e−12; AUC rank-based with tie correction.

## Headline metrics (month=ALL rows of `nrfi-evaluator-monthly-metrics.csv`)

| Series | n scored | Picks | Hit rate (95% CI) | z vs coin | Brier | Brier skill vs base | Log loss | AUC | ECE (deciles) |
|---|---|---|---|---|---|---|---|---|---|
| live (all) | 1,536 | 1,417 | 50.9% (48.3–53.5) | +0.66 | 0.25016 | −0.0010 | 0.69340 | 0.522 | 0.046 |
| **live (clean, no P-001)** | 1,176 | 1,085 | **49.2% (46.3–52.2)** | −0.52 | 0.25169 | −0.0071 | 0.69651 | **0.504** | 0.069 |
| p1 (replay raw) | 1,555 | 1,553 | 53.3% (50.8–55.7) | +2.56 | 0.24888 | +0.0040 | 0.69091 | 0.547 | 0.040 |
| p2 (replay calibrated) | 1,555 | 1,553 | 53.3% (50.8–55.8) | +2.61 | 0.24871 | +0.0047 | 0.69045 | 0.548 | 0.042 |

Reference points: constant base-rate Brier 0.24989, constant-0.5 Brier 0.25, base-rate
log loss 0.69292. Live Brier minus 0.25: z=+0.12 (all) / +1.14 (clean) — indistinguishable
from, or worse than, always saying 50/50.

**C-004 confirmed on the full population with independent actuals**: the live NRFI feed
carries no signal. On the provenance-clean subset it is *below* coin flip (49.2%), AUC
0.504, negative Brier skill. The apparent whole-population 50.9% is carried by the
quarantined games (their April hit rate is 56.0% all-live vs 52.0% clean-live).

## Monthly (from `nrfi-evaluator-monthly-metrics.csv`)

| Month | live hit | live_clean hit | p1 hit | p2 hit | base NRFI |
|---|---|---|---|---|---|
| 2026-03 | 50.0% (n=72) | — (n=0 clean) | 53.9% | 53.9% | 58.7% |
| 2026-04 | 56.0% (n=364) | 52.0% (n=173) | 55.0% | 55.0% | 49.7% |
| 2026-05 | 49.3% (n=371) | 50.0% (n=344) | 49.9% | 50.1% | 47.7% |
| 2026-06 | 49.0% (n=365) | 47.7% (n=333) | 56.1% | 56.1% | 47.2% |
| 2026-07 | 48.6% (n=245) | 48.1% (n=235) | 51.6% | 51.6% | 50.0% |

The rebuilt walk-forward model (p1/p2) is positive overall (z≈2.6) but month-unstable:
April +, June ++, May/July flat. Not robust enough to publish as-is.

## Reliability (equal-count deciles, `nrfi-evaluator-reliability.csv`)

- **live**: non-monotone. Decile 6 (mean p 0.482) → observed 0.627 (gap +0.145);
  top decile (mean p 0.562) → observed **0.461** (gap −0.101). On the clean subset the
  top decile inverts harder: predicted 0.560 → observed **0.407** (gap −0.153). The
  higher the live model's NRFI confidence, the *worse* the outcome — anti-signal in the
  NRFI tail, consistent with the season-audit finding.
- **p1/p2**: monotone-ish through the middle but overconfident in the NRFI tail:
  decile 9 (0.568→0.490, gap −0.078), decile 10 (0.599→0.513, gap −0.086). ECE ≈0.040.
  The p2 monthly calibration barely moves anything: paired Brier delta p2−p1 =
  −0.00017 (z=−1.0, n=1,555) — not a significant improvement.

## Both-sides reporting (`nrfi-evaluator-sides.csv`)

| Series | NRFI picks | NRFI hit (CI) | YRFI picks | YRFI hit (CI) |
|---|---|---|---|---|
| live | 412 | 50.7% (45.9–55.5) | 1,005 | 50.9% (47.9–54.0) |
| live_clean | 319 | 48.6% (43.2–54.1) | 766 | 49.5% (45.9–53.0) |
| p1 | 1,037 | 51.7% (48.6–54.7) | 516 | **56.4% (52.1–60.6)** |
| p2 | 1,038 | 51.7% (48.7–54.8) | 515 | **56.5% (52.2–60.7)** |

- The live model leans YRFI (71% of its picks; mean p 0.477); the rebuilt model leans
  NRFI (67% of picks; mean p 0.516). Neither side of the live model beats a coin.
- The rebuilt model's edge is concentrated on its **YRFI picks** (56.4–56.5%, CI excludes
  50%); its NRFI picks (51.7%) are inside noise — consistent with the NRFI-tail
  overconfidence above.
- Flat-stake ROI at stored book odds (live only; NRFI/YRFI odds stored on 843/844 of
  1,555 games respectively, giving 782 priced picks): **−3.3%** overall (−25.97u/782), **−9.6%** on the clean subset
  (−48.85u/511). Sides, clean: NRFI picks −14.3% (n=140), YRFI picks −7.8% (n=371).
  A subscriber betting the published NRFI feed at book prices lost money.

## Cross-checks & defects (`nrfi-evaluator-crosscheck.csv`, `nrfi-evaluator-statsapi-sample.csv`)

1. **D-NRFI-EV1 (P2, data integrity)** — `games.nrfiActualResult` is wrong on 2 games:
   2250738 (2026-05-24 DET@BAL) and 2251290 (2026-07-07 MIL@STL) say "YRFI" while
   `actualNrfiBinary`=1 and linescores say inn1 = 0+0. **StatsAPI confirms both first
   innings were scoreless** — the string column is the defective one. Any surface reading
   `nrfiActualResult` instead of `actualNrfiBinary` misgrades these games.
2. **D-NRFI-EV2 (P2, replay calibration)** — p2 emitted `pNrfi = 1.00000` (certainty) for
   game 2250612 (2026-05-14 MIA@MIN); p1 for the same game was 0.4867. `calibMeta` shows
   the May NRFI recalibration is a logistic with `n_train: 66` over a wide
   per-starter feature vector and no output clamp. Largest p1→p2 shift in the season is
   this game (0.513); only 1 of 1,555 p2 values exceeds 0.75. Degenerate but real:
   unclamped, under-trained refit can claim certainty.
3. **Clean**: `actualNrfiBinary` matches linescore-derived inn1 for **all 1,555 games**
   (0 mismatches). External sample: 40/40 StatsAPI linescores match
   `mlb_replay_linescores` inn1 exactly (0 fetch failures).
4. **Clean**: stored `games.nrfiCorrect`/`brierNrfi` are now populated for all 1,536
   projected games and agree with re-derivation everywhere (0 mismatches under the
   pipeline's 0.5→YRFI convention). Note this is a change since GRADING-REPORT M-101
   (which found 14 dead rows) — the backfill has since repopulated them correctly
   (run-context observation, not a defect).
5. **Clean**: the `mlb_replay_grades` `nrfi_yrfi` rows present at snapshot time (1,527
   live + 1,545 + 1,545) all match source probabilities and re-derived correctness
   (0 prob mismatches, 0 correct mismatches).

## Verdict

- Live NRFI market: **no signal, C-004 confirmed and sharpened** — clean-provenance
  subset is below coin flip with inverted high-confidence tail and −9.6% realized ROI at
  book odds. There is no statistical basis for publishing the current live NRFI numbers.
- Replay rebuilt model: weak positive discrimination (53.3%, AUC 0.547), edge
  concentrated in YRFI picks (56.5%), but month-unstable, NRFI-tail overconfident, and
  the monthly recalibration layer adds nothing measurable (and once emitted p=1.0).
  Treat as a research candidate, not a publishable feed.
