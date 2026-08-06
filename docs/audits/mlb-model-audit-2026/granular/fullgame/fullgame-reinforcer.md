# Fullgame — REINFORCER synthesis: is the current calibration structurally sufficient?

Agent: fullgame/REINFORCER (5x5 granular season backtest). Date run: 2026-07-25.

**Population**: all 1,555 final 2026 regular-season games with replay projections
(2026-03-25..2026-07-24; the All-Star exhibition is exempt). Both replay passes were complete
at run time: `wf-19288f01-p1` = 1,555 rows, `wf-19288f01-p2` = 1,555 rows; no `-p2d` series
existed. `mlb_replay_grades` held **0 rows** when this run started and 101,746 when it ended
(the grading pipeline was writing concurrently); nothing here depends on that table — all
grading below is computed directly from `games` actuals.

**Scripts** (all in `docs/audits/mlb-model-audit-2026/granular/tools/`, run with the audit
venv python; every number in this report is printed by one of them):

| # | Invocation | Output |
|---|---|---|
| 1 | `python fullgame-reinforcer-extract.py` | `fullgame-reinforcer-master.csv` (1,555 rows; joins games ⋈ p1 ⋈ p2 ⋈ park factors; parses p2 calibMeta; day/night from ET start + park offset) |
| 2 | `python fullgame-reinforcer-env-structure.py` | `fullgame-reinforcer-env-slices.csv`, `fullgame-reinforcer-env-parks.csv`, `fullgame-reinforcer-env-regression.txt` |
| 3 | `python fullgame-reinforcer-temp-homeedge.py` | `fullgame-reinforcer-temp-trajectory.csv/.svg`, `fullgame-reinforcer-homeedge.csv` |
| 4 | `python fullgame-reinforcer-walkforward.py` | `fullgame-reinforcer-walkforward.csv`, `fullgame-reinforcer-walkforward-monthly.csv` |

Extraction sanity (script 1 output): 0 missing actuals / homeWin / dayNight; 13 of 1,555 games
needed the schedule-DK fallback for the O/U line (null `games.bookTotal`); stored p2 columns
reproduce exactly from p1 + calibMeta (max |Δ projTotal| = 0.0005, max |Δ pAwayMl| = 0.000005).

Residual convention throughout: `resid = actualTotal − projTotal` (positive = model too low).

---

## 1. Is a single monthly `league_env_mult` sufficient? (script 2)

**Season aggregates (n=1,555)**: p1 bias +0.233 runs/game, MAE 3.501; p2 bias +0.049, MAE
3.528. The global multiplier removed the season-level bias but made MAE marginally *worse*,
because the expanding-window monthly refit lags a genuinely non-stationary environment:

| month | n | p1 ratio act/proj | env_mult used (fit on months < m) | p2 bias (runs) |
|---|---|---|---|---|
| 2026-03 | 76 | 1.0158 | 1.0 (seed) | +0.134 |
| 2026-04 | 392 | 1.0492 | 1.0 (seed) | +0.427 |
| 2026-05 | 419 | 0.9802 | 1.04564 | **−0.575** |
| 2026-06 | 394 | 1.0514 | 1.01551 | +0.319 |
| 2026-07 | 274 | 1.0316 | 1.02613 | +0.049 |

May is the failure mode: a multiplier fitted on a hot March–April (1.046) was applied to a
cold May (true ratio 0.980) — the calibration *overcorrected* by ~0.58 runs/game. Half-month
slices (`env-slices.csv`, family `halfMonth`) show the same swing inside months
(May-H1 −0.87, May-H2 −0.30; Jun-H1 +0.57, Jun-H2 +0.08).

**Structure of residuals** (OLS with HC1 robust t, `env-regression.txt`; May–Jul p2 residuals,
n=1,087): `parkFactor−1` +1.16 (t +0.56), `day` −0.02 (t −0.07), `roof` −0.28 (t −0.90),
`line−8.5` −0.02 (t −0.12); only month dummies are significant (Jun +0.90, t +2.96).
**F-test of 30 park dummies over month dummies: F(29,1055)=1.196, p=0.219** — no park
structure. Day/night Welch t = −0.23. Per-park table (`env-parks.csv`): only PIT reaches
|t|>2 (+2.04), exactly what chance predicts across 30 parks; COL (−1.57) and ATH (+1.45) are
suggestive but not significant.

**Answer: the single *global* multiplier is spatially sufficient — the insufficiency is
temporal (refit lag), and walk-forward tests (section 4) show even that is barely
exploitable.**

## 2. Remaining totals bias per slice after p2 (script 2 → `env-slices.csv`)

May–Jul (post-seed) p2 bias by slice: day −0.136 / night −0.071 (t −0.23); roof −0.073 /
open +0.087 season-wide; line ≤7.5 −0.281, 8–8.5 −0.008, 9–9.5 −0.238, **≥10 +0.333**
(n=119, t +0.65 — high-total slates stay under-projected but not significantly);
doubleheader S/Y slices are tiny (n=28 combined). No slice t exceeds ±2 except the
month/half-month time slices — the residual bias after p2 is time-structure, not
game-attribute structure.

## 3. ML temperature stability (script 3 → trajectory CSV + SVG)

Rolling 200-game windows, step 25 (55 windows), T fitted by NLL on p1 `pAwayMl`:

- **T range 0.547–5.000 (optimizer bound hit in 3 windows), mean 1.87, sd 1.07** — wildly
  unstable. Expanding fits replicate the pipeline (my re-fits 1.977/1.533/1.479 for
  May/Jun/Jul vs calibMeta 1.9767/1.5326/1.4781); full-season T = 1.4628.
- **The instability is mostly home-edge identification, not overconfidence drift**:
  corr(T, window home-win rate) = **−0.657**. Re-fitting T on de-edged probabilities
  (p_home − 0.03, exact de-adjustment of the additive edge) gives range 0.40–3.10, sd 0.635,
  corr −0.132, and no bound hits.
- Month-only T on de-edged probs: Mar 0.74, **Apr 1.99**, May 0.86, Jun 0.89, Jul 0.80.
  Outside April the raw model is *slightly underconfident* (T<1). April 2026 is a genuine
  low-discrimination month, and the expanding window never forgets it — the July T (1.48)
  is still ~60% April contamination while the contemporaneous optimum was ~0.8.

## 4. The +home-edge parameter (script 3 → `homeedge.csv`)

p1 was generated with the live constant `FG_ML_HOME_EDGE = +0.03`;
`mlb_calibration_constants` holds the AUTO_RECAL fitted value **0.01781473** (n=421,
2026-05-23). Season facts (n=1,555): actual home-win rate **0.5215**; raw de-edged sim mean
p_home **0.5325**; as-built p1 mean p_home 0.5625; stored p2 mean p_home 0.5457.
**The raw simulation already over-rates home teams by +0.011; every positive edge constant
makes it worse.**

| edge on raw sim p_home | NLL | Brier | calib-in-large |
|---|---|---|---|
| fitted e* = **−0.0109** (95% profile CI **[−0.0355, +0.0137]**) | 0.683881 | 0.245396 | +0.0000 |
| 0 (no edge) | 0.684122 | 0.245516 | +0.0109 |
| 0.0178 (DB constant) — **outside the CI** | 0.685565 | 0.246223 | +0.0288 |
| 0.03 (as built) — **far outside the CI** | 0.687310 | 0.247073 | +0.0409 |
| joint fit T=0.9456, e=−0.0121 | 0.683857 | 0.245382 | — |

The joint fit is the punchline: **with the edge removed, the optimal temperature is 0.95 ≈ 1
— the entire T≈1.5 calibration layer is mostly a symmetric patch over an asymmetric +3pp home
shim.** Per-month implied edge on raw sim: Mar +0.034, Apr −0.007, May −0.004, Jun −0.018,
Jul −0.030 — monotonically decaying; the live n=554 early-season backtest that justified
+0.03 (and the May-23 DB fit of +0.0178) captured a transient that reversed sign.

## 5. Walk-forward evidence: which structure wins? (script 4)

All variants fitted strictly on earlier games; evaluated May-01..Jul-24 (n=1,087 games; O/U
Brier on 1,047 after excluding 40 pushes; pOver recomputed with the pipeline's own recenter
formula). Paired bootstrap 95% CIs vs the stored-p2 baseline. Stored-p2-exact row differs
from my re-derived baseline by MAE +0.0021 (the pipeline's fits excluded ~8 games not yet
final at its run time — replication-level).

**Totals** (baseline stored p2: bias −0.093, MAE 3.513, Brier 0.2467):

| variant | ΔMAE [95% CI] | ΔBrier [95% CI] | verdict |
|---|---|---|---|
| monthly + park-shrunk mult (n0=20/40/60) | +0.039/+0.023/+0.016, all CIs > 0 | +0.0036/+0.0021/+0.0015, all CIs > 0 | **significantly worse — reject park-adjusted env** |
| monthly + day/night | −0.0001 [−0.0007,+0.0005] | +0.00001 | no effect |
| daily expanding global (p2d-style) | −0.0094 [−0.0184,+0.0001] | −0.00004 | bias −0.093→−0.039; MAE gain borderline, never harmful |
| daily trailing-300 | +0.0036 [−0.0211,+0.0273] | +0.0014 | chasing within-month drift doesn't pay |
| trailing-300 + park | +0.0079 | +0.0018 | worse |
| oracle same-month mult (leaky bound) | −0.0217 [−0.0452,+0.0016] | −0.0007 | **max achievable from ANY env timing ≈ 0.02 MAE** |

**Moneyline** (baseline stored p2: Brier 0.245934, logloss 0.684946, calib +0.0216):

| variant | ΔBrier [95% CI] | logloss | verdict |
|---|---|---|---|
| raw p1 (edge 0.03, no T) | +0.000028 [−0.0020,+0.0019] | 0.684952 | **the deployed monthly-T layer ≈ no-op vs raw** |
| **de-edged, no T (M6)** | **−0.001809 [−0.0033,−0.0003]** | 0.681260 | **best variant; significant** |
| de-edged + DB 0.0178 | −0.000935 [−0.0025,+0.0006] | 0.683006 | half-measure, not significant |
| monthly T on de-edged | −0.001161 [−0.0021,−0.0002] | 0.682605 | T adds nothing beyond de-edging |
| monthly joint (T,e) | −0.000942 [−0.0018,−0.0001] | 0.683045 | significant but below M6 |
| trailing-200 T (as-built) | +0.001210 [−0.0006,+0.0030] | 0.687465 | **rolling T hurts — reject** |
| trailing-400 T de-edged | −0.000996 [−0.0026,+0.0007] | 0.682959 | not better than plain de-edge |

Per-month breakdown in `fullgame-reinforcer-walkforward-monthly.csv`: de-edged-no-T beats
stored p2 in all three eval months (May 0.24366 vs 0.24547, Jun 0.24464 vs 0.24617,
Jul 0.24410 vs 0.24631).

---

## Verdict: structurally sufficient?

**Totals — yes.** One global env multiplier is the right structure; park, day/night and roof
adjustments are either zero or significantly harmful; even a leak-free daily refit only
halves the (small) bias, and the leaky oracle bounds all possible timing gains at ~0.02 MAE
(~0.6%). The residual month swings are weather/noise the calibration layer cannot and should
not chase; further totals gains must come from the engine's dead inputs (wind computed but
unused; bullpen fatigue hardcoded neutral — phase0 fullgame findings 4-5), not calibration.

**Moneyline — no, but the fix is subtraction, not structure.** The +0.03 home edge is
mis-signed for 2026 (fitted season optimum −0.011, CI excludes both live constants), the
temperature layer is mostly re-absorbing that shim (joint T = 0.95), and the deployed monthly
T bought ≈ 0 Brier vs raw. No *structured* (park/slice) ML calibration is justified.

## Recommendations (walk-forward-justified, in priority order)

1. **Set `FG_ML_HOME_EDGE` to 0.0** (not the DB 0.0178 — that is also outside the fitted CI).
   Expected walk-forward gain: **Brier −0.0018 [−0.0033,−0.0003], logloss −0.0037/game**, and
   calibration-in-the-large from +0.022 to +0.016 (May–Jul). This also removes the documented
   downstream RL-clamp/home-cover bias inheritance (phase0 fullgame finding 2). If an edge
   parameter is kept at all, it must be refit on a rolling ≤ half-season window with a sign
   prior of 0 — the per-month trend (+0.034 → −0.030) shows a fixed constant is the wrong
   object.
2. **Keep the single global env multiplier; refit it daily-expanding instead of monthly**
   (p2d-style). Never worse in any eval month, halves residual bias (−0.093 → −0.039),
   ΔMAE −0.009 [−0.018, +0.000]. Zero new parameters.
3. **Reject park-adjusted and day/night-adjusted env multipliers** — park-shrunk variants are
   significantly *worse* at every shrinkage tested (park residual F-test p=0.219: there is no
   signal to fit).
4. **Keep temperature only as an expanding-window guardrail fitted on de-edged
   probabilities** (expect T ≈ 0.9–1.0; today's 1.48 is April contamination + edge
   absorption). **Reject rolling-200 T** (range 0.55–5.0, sd 1.07, corr −0.66 with window
   home-win rate; walk-forward Brier +0.0012).
5. For further FG totals improvement, invest in the engine, not the wrapper: wire the unused
   wind adjustment and real bullpen fatigue inputs, and revisit April-style early-season
   priors (April is the only month with genuine T≫1 discrimination loss).

## Defects for the ledger

- **[P1] `FG_ML_HOME_EDGE=+0.03` mis-signed for 2026**: season-fitted optimum −0.0109
  (95% CI [−0.0355, +0.0137] excludes +0.03 AND the DB constant +0.0178); raw sim already
  over-rates home by +1.1pp. Removing it is worth −0.0018 Brier walk-forward.
- **[P2] p2 ML calibration layer ≈ no-op**: stored monthly-T p2 improves Brier vs raw p1 by
  only 0.00003 on eval months while leaving +0.022 calibration-in-the-large.
- **[P2] Monthly expanding env-mult overcorrected May by −0.58 runs/game** (lag on a
  non-stationary environment); season p2 MAE (3.528) is actually worse than p1 (3.501).
- **[P3] Expanding-window T carries April contamination all season** (July expanding T 1.48
  vs contemporaneous optimum ≈ 0.8 on de-edged probs).

*Limitations*: day/night derived from ET start + static park UTC offsets; roof classification
static best-effort; 13/1,555 games used schedule-DK fallback lines; stored-p2 replication
delta ≤ 0.0021 MAE from ~8 games not final at the pipeline's fit time.
