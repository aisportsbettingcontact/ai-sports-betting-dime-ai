# Granular Backtest — FULLGAME / EVALUATOR

Role: full-population per-game evaluation ledger + metric suite for the full-game markets
(ML / RL / TOTAL) across all projection series. Run 2026-07-25 (see `ranAt` in
`fullgame-evaluator-summary.json`).

Every number in this report was produced by a named, committed script run against the full
population. No sampling was used for any DB-derived number; sampling was used only for the
external StatsAPI ground-truth check (§7).

## 1. Scripts and artifacts

| Artifact | Producer (invocation) |
|---|---|
| `fullgame-evaluator-ledger.csv` (14,004 rows) | `node granular/tools/fullgame-evaluator.mjs` |
| `fullgame-evaluator-metrics.csv` (72 rows) | same run |
| `fullgame-evaluator-reliability.csv` (90 rows) | same run |
| `fullgame-evaluator-clv.csv` (13,882 rows) | same run |
| `fullgame-evaluator-rl-odds-integrity.csv` (1,555 rows) | same run |
| `fullgame-evaluator-summary.json` | same run |
| `fullgame-evaluator-statsapi-sample.csv` (60 games) | `node granular/tools/fullgame-evaluator-statsapi-check.mjs` (seed 20260725) |

## 2. Population accounting (exhaustive by construction)

- **1,556 finals** in `games` (sport='MLB', gameStatus='final', 2026-03-25..2026-07-24);
  **1,555 with `mlbGamePk`**. The one exception is the All-Star exhibition (games.id 4110001,
  AL@NL 2026-07-14) — it **carries live model projections** (modelAwayWinPct 50.98) and is
  ledgered with `allstar=1`, excluded from all metrics (defect D5 below).
- Ledger = 1,556 games × 3 sub-markets × 3 series = **14,004 rows**. Games without a
  projection emit stub rows (`note='no-projection'`), so coverage is auditable in-file.
- Series at run time: `live`, `p1` = `wf-19288f01-p1` (1,555 games), `p2` = `wf-19288f01-p2`
  (1,555). **No `-p2d` rows existed at run time** (checked; 0 rows).
- Live-series projection coverage: 1,537/1,556 games; the **19 uncovered game ids** are listed
  in `fullgame-evaluator-summary.json → population.live_missing_projection_ids`.
- Live leakage-quarantine (modelRunAt ≥ first pitch per `mlb_schedule_history.startTimeUtc`):
  **347 games** flagged; all live metrics are also reported `ex-quarantine`.
- `mlb_replay_grades` state: **0 rows when this run started**; the running grading pipeline
  populated it mid-session (final observed state recorded in the summary JSON). Per protocol
  this is recorded, not treated as a defect; this evaluator grades from raw actuals and does
  not depend on that table.

## 3. Headline metric suite (ALL months; ± is 95% CI; full monthly grid in metrics CSV)

| Series | Sub | Graded | Hit rate | Brier | Log loss | MAE | RMSE | Bias (proj−actual) |
|---|---|---|---|---|---|---|---|---|
| live | ML | 1,536 | 55.2% ±2.5 | 0.2472 | 0.6876 | — | — | — |
| live | RL | 1,534 | 58.9% ±2.5 | 0.2444¹ | 0.6820¹ | 3.56 | 4.59 | −0.35 ±0.23 * |
| live | TOTAL | 1,475 | 52.0% ±2.6 | 0.2541 | 0.7021 | 3.51 | 4.51 | **−0.54 ±0.22 *** |
| live ex-quar. | ML | 1,190 | 55.2% ±2.8 | 0.2480 | 0.6890 | — | — | — |
| live ex-quar. | RL | 1,189 | 59.0% ±2.8 | 0.2466¹ | 0.6866¹ | 3.63 | 4.66 | −0.41 ±0.26 * |
| live ex-quar. | TOTAL | 1,144 | 51.0% ±2.9 | 0.2554 | 0.7047 | 3.49 | 4.48 | −0.46 ±0.25 * |
| p1 | ML | 1,555 | 55.4% ±2.5 | 0.2471 | 0.6873 | — | — | — |
| p1 | RL | 1,555 | 58.7% ±2.5 | 0.2412 | 0.6756 | 3.56 | 4.61 | −0.38 ±0.23 * |
| p1 | TOTAL | 1,493 | 54.4% ±2.5 | 0.2490 | 0.6916 | 3.50 | 4.45 | −0.23 ±0.22 * |
| p2 | ML | 1,555 | 55.4% ±2.5 | 0.2471 | 0.6873 | — | — | — |
| p2 | RL | 1,555 | 58.7% ±2.5 | 0.2412 | 0.6756 | 3.56 | 4.61 | −0.38 ±0.23 * |
| p2 | TOTAL | 1,493 | **54.8% ±2.5** | 0.2491 | 0.6918 | 3.53 | 4.45 | **−0.05 ±0.22 (n.s.)** |

`*` CI excludes zero. ¹ Live RL Brier/log-loss cover only the 590 rows with a stored
`modelAwayPLCoverPct` (column first written 2026-06-07); replay series have full probability
coverage. Reproduction check: live numbers match the Phase-2 GRADING-REPORT within window
differences (55.2 vs 55.4 / 58.9 vs 58.8 / 52.0 vs 52.2).

Key deltas:
- **p2 cures the total-runs bias (C-001)**: live −0.54 ±0.22 → p2 −0.05 ±0.22 (n.s.), and the
  TOTAL hit rate rises 52.0% → 54.8% (p1 already 54.4%: most of the gain is the fixed model,
  the monthly env-mult calibration adds the bias removal).
- **p2's ML temperature step is a de-facto no-op**: identical picks to p1, Brier 0.24707 →
  0.24705. ML compression (C-005) persists in the calibrated replay (reliability §5).
- ML hit ≈ 55.4% in all three series — the simulation core, not the calibration layer,
  determines ML accuracy.

## 4. Baseline decompositions (skill vs structure)

Computed inline on the ledger (decomposition snippets in this report's producing session;
reproducible from the ledger columns alone).

**RL is structurally, not skillfully, at 58.9%.** Excluding the ASG:
- The +1.5 dog side covered **59.0%** of all graded games (base rate).
- The live model picks the dog side in **95%** of games (1,457/1,535); those picks hit 59.4%
  (≈ base rate). Its 78 favorite (−1.5) picks hit **48.7%** — coin flip at best.
- p2 replay: dog picks 1,460/1,555, hit 59.3%; favorite picks 49.5% (n=95).
- At the era's average dog-side juice (≈ −165/−180), breakeven is ≈62-64%: the published RL
  numbers describe "always take +1.5" and lose at the price.

**ML barely beats the always-favorite baseline.** "Always pick the book ML favorite" hits
**54.9%** on the same graded games vs the model's 55.2% (live) / 55.4% (p1&p2) — +0.3-0.5pp,
inside noise. Nuance for the exposure agent: the model's underdog picks hit 50.5% (live n=471,
replay n=536) — at plus-money prices that subset is nominally ROI-positive, but provenance
(quarantine) and price-capture caveats below apply.

## 5. Reliability (10-bin tables in `fullgame-evaluator-reliability.csv`)

- **ML (live and p2 alike)**: monotone but compressed. p2: bin 0.4-0.5 avg-p 0.455 → observed
  0.464; bin 0.5-0.6 avg-p 0.522 → observed **0.611** (gap +0.089). Live: 0.529 → 0.574.
  1,152/1,555 p2 probabilities sit in the 0.4-0.5 bin (mass squeezed toward 0.5, away side).
  C-005 confirmed and NOT cured by the p2 monthly temperature.
- **TOTAL (live)**: over-side under-called below 0.5 (0.45 → 0.50 observed) — consistent with
  the −0.54 run bias; tails carry no signal (0.63 → 0.52 observed, n=54).
- **TOTAL (p2)**: center bins well calibrated (0.455 → 0.459; 0.538 → 0.561); tails remain
  uninformative on small n.
- **RL (replay)**: pAwayRl tracks the dog-side base rate; discrimination beyond the structural
  +1.5 effect is minimal (see §4).

## 6. Pick-CLV vs `mlb_game_backtest.clv`

Definitions: price-CLV = noVig(closing, pick side) − noVig(line-at-projection, pick side);
closing = locked `dkClosing*` (else pre-start `odds_history` proxy). `stored` = the B9-backfilled
`mlb_game_backtest.clv` (same definition, but the projection-side no-vig prob was captured at
**enrollment time**). Locked-closing subset (post-2026-04-11), per pick:

| Series | Sub | n (my CLV) | mean CLV (games-cols) | n (stored) | mean stored CLV ±CI |
|---|---|---|---|---|---|
| live | ML | 875 | +0.0002 | 874 | −0.0003 ±0.0004 |
| live | RL | 831 | **+0.068 (artifact — see D1)** | 874 | −0.0046 ±0.0042 |
| live | TOTAL | 794 | +0.0002 | 498 | +0.0002 ±0.0005 |
| p1/p2 | ML | 876 | −0.0002 | 875 | −0.0004 ±0.0004 |
| p1/p2 | RL | 832 | +0.062 (same artifact) | 875 | −0.0026 ±0.0042 |
| p1/p2 | TOTAL | 795 | +0.0001 | 498 | −0.0002 ±0.0005 |

Conclusions:
- **No FG market shows positive closing-line value.** Enrollment-based CLV is ≈0 (ML/TOTAL) to
  slightly negative (RL). Only 17-26% of picks beat the close at all.
- My games-column CLV and the stored CLV agree to <0.001 mean-abs for ML/TOTAL (cross-validating
  B9), and for RL from June (mean-abs delta 0.00009 Jun, 0.0013 Jul). The RL divergence before
  June is a data defect in `games` (D1), not in the stored CLV — use `stored` for RL.
- Caveat: ML/TOTAL CLV from `games` columns is *structurally* near zero because those columns
  are overwritten until first pitch (median CLV exactly 0; the row's "line at projection" has
  converged to the close). True run-time CLV needs the odds snapshot at `modelRunAt`, which
  timestamp clobbering destroyed (P-001). The enrollment-time stored values are the best
  available measurement, and they say: no CLV edge.

## 7. External ground truth (sampling permitted for this only)

`fullgame-evaluator-statsapi-check.mjs`: 60 deterministically-sampled games (seed 20260725),
scores fetched from `statsapi.mlb.com`. **59/59 gradable ML actuals and 59/59 TOTAL side
results match the ledger** (1 game ungradable: 2252833, a no-projection stub). Three initial
mismatches were an API-shape issue (suspended/resumed games return two schedule entries; the
resumption entry carries the score) — fixed in the sampler, after which agreement is 100%.
Separately, the 3 games where my grades disagree with the Phase-2 ledger (D2) were each
verified against StatsAPI: the current DB (and hence this ledger) is correct in all 3.

## 8. Consistency vs the Phase-2 audit ledger

Row-level comparison against `grading/ledger-fullgame.csv` on shared graded rows:
**4,516/4,521 agree (99.89%)**. The 5 disagreements (games 2250733, 2250738, 2251290) are all
rows the Phase-2 run graded against pre-remediation (since-corrected) stored scores; StatsAPI
confirms the current scores. One of them (2251290 RL vs ML/TOTAL) is internally inconsistent
within the Phase-2 ledger itself — same cause (partially-stale actuals at its run time).

## 9. Defects found (evaluator scope)

- **D1 (P1) — `games` RL odds columns are corrupted for the pre-June era.** Two distinct
  signatures, quantified in `fullgame-evaluator-rl-odds-integrity.csv`:
  (a) **Mirrored, vig-free pairs** (`awayRunLineOdds = −homeRunLineOdds`, e.g. +130/−130 —
  no book quotes such a pair): all 75 March finals + 209 April finals, last on 2026-04-30
  (284 games; ML and total odds are never mirrored).
  (b) **Side-swap vs enrollment capture**: current away/home RL odds are exactly transposed
  relative to `mlb_game_backtest` fg_rl bookOdds/bookOddsOpposite for 64/75 Mar, 339/391 Apr,
  250/405 May comparable games — 653 in total; June and July agree 664/664 (away-side check;
  `bookOddsOpposite` stopped being written from June, itself a minor ledger gap D6).
  DK convention and closing-line comparison show the *enrollment capture* is the correct
  assignment. Consequence: any RL price, EV, ROI, or CLV computed from current `games`
  RL-odds columns before June 2026 is invalid (it produced a spurious +6.8pp "CLV" here).
- **D2 (P2) — Phase-2 grading ledger contains 5 stale-actual rows** (§8): 3 games re-graded
  by remediation after that ledger was cut; the committed CSV was never refreshed.
- **D3 (P1, publishing risk) — RL market has no demonstrated skill** (§4): 95% dog-side picks
  at the dog-side base rate, favorite picks below coin flip, negative stored CLV, and juice
  makes the published RL numbers a losing rule. This sharpens the Phase-2 "RL 58.8%" headline,
  which is structurally inflated.
- **D4 (P2) — ML edge over naive baseline is ≤0.5pp** and CLV ≈ 0: the published ML win
  probabilities add almost nothing over "pick the book favorite" at the pick level; the value,
  if any, is in the probability surface, which remains compressed (C-005) even in p2.
- **D5 (P3) — the All-Star exhibition carries live published projections** (games.id 4110001,
  modelAwayWinPct 50.98): the model ran and published on a game outside its own market design;
  it also sits (correctly) outside the replay/backtest universes, so live-vs-replay
  populations silently differ by one game unless flagged.
- **D6 (P3) — `mlb_game_backtest.bookOddsOpposite` unpopulated from June 2026** (0/394 Jun,
  0/272 Jul vs 391/394 Apr): enrollment odds capture degraded to one side, which is what forced
  the away-side-only integrity check above and thins future CLV audits.
- Recorded, not defects: `mlb_replay_grades` was mid-backfill during this run (0 rows at
  start); no `-p2d` series existed; 2 postponed-game rows exist in `mlb_game_backtest`
  fg markets (2250429, 2250432 — census exemption codes cover them).

## 10. Recommendations

1. Treat pre-June-2026 `games` RL odds columns as untrusted; re-source that era's RL prices
   from `mlb_game_backtest` enrollment capture or `odds_history` before any ROI/EV work (D1).
2. Do not publish FG RL as a modeled market until it demonstrates skill beyond the +1.5
   structural base rate at actual juice (D3); the fix must come from margin-distribution
   modeling, not calibration (p2 didn't move it).
3. Adopt the p2 environment-multiplier for totals in the live path (bias −0.54 → −0.05,
   hit +2.8pp) — it is the one unambiguous calibration win in this market family.
4. Replace the p2 ML temperature with a method that actually decompresses (per-bucket Platt or
   isotonic, walk-forward) — the fitted temperature changed Brier by 2e-5 and left the
   0.5-0.6 bin 8.9pp under-confident.
5. Restore two-sided odds capture at enrollment (D6) and snapshot odds at `modelRunAt` so CLV
   is measurable without proxies going forward.
6. Regenerate the committed Phase-2 CSVs after remediation passes (D2) or mark them
   superseded by this ledger.
