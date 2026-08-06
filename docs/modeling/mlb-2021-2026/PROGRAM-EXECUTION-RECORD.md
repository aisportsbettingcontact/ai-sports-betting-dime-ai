# MLB Model Program — Complete Execution Record

The single index for everything on this branch: what was mandated, what ran, what was
found, what was concluded, and what was deliberately not done. Written so that a reader
who was not present can reconstruct the whole program without reading the source.

Branch `local/audit-mlb-model-2026` · 27 commits · 445 files · ledger 41 events, chain
intact, head `c30a8a090c1d6c61`.

> **Where this content lives.** The work was executed on `local/audit-mlb-model-2026`,
> which also carries 17 application files from the Phase 4 season-repair fixes and is
> ~1,000 commits behind `main`. This documentation set was therefore extracted onto a
> docs-only branch off current `main` so it can be reviewed without a production deploy
> riding along; the commit-by-commit history in §8 lives on the original branch
> (PR #421), and the model-service fixes are tracked separately there. Nothing in the
> documentation was changed by the extraction.

---

## 1. Scope

Three connected bodies of work, executed in sequence:

| Program | Directory | Files | Outcome |
|---|---|---|---|
| A. 2026 season model audit, repair, and replay backtest | `docs/audits/mlb-model-audit-2026/` | 295 | 51 findings; season repaired; 9/9 markets **BACKTEST-ONLY** |
| B. Warehouse forensic audit (21 seasons) | `docs/audits/mlb-warehouse-2026/` | 64 | Integrity sound; 7 defects W-1…W-7 |
| C. Warehouse-constrained modeling + 400k backtest | `docs/modeling/mlb-2021-2026/` | 69 | 7/7 markets **REINFORCE** (joint-nb-v2) |

The seven markets throughout: Full Game Moneyline, Full Game Run Line, Full Game Total,
First Five Moneyline, First Five Run Line, First Five Total, NRFI/YRFI. Program A also
covered K props and HR props (nine gated markets total).

---

## 2. Governing directives, in order

Each superseded or extended the last. All were honoured; none was silently relaxed.

**D1 — Season forensic audit.** Audit, backfill, backtest, and recalibrate the MLB engine
for 2026 season-to-date. Hard rails: Phases 0–2 strictly read-only; all database writes
gated behind an explicit authorization checkpoint; freeze-copy-prove snapshots before any
write; never `DELETE` without a reviewed predicate, never `DROP`/`TRUNCATE`/destructive
`ALTER`; scratch branch only, never push/merge/deploy; **secret hygiene absolute** — never
echo, print, log, or write any secret value into any artifact, reference variables by name
only; evidence classified VERIFIED / INFERRED / UNKNOWN; exhaustiveness demonstrated by
code, not by reading; append-only action log.

**D2 — Checkpoint Alpha authorization.** Writes authorized with amendments: the exemption
regime was revoked (walk-forward replay must fill every gap); a provenance regime imposed
(`live_pregame` immutable and public vs `walkforward_replay` isolated in separate tables —
conflating them classified P0); corrected grades may overwrite defective grades, snapshot
first; CLV from in-repo sources only; publish/suppress/merge decisions reserved to the
owner.

**D3 — Granularity and parallelism.** Backtest game by game, not by aggregate weights;
daily per-slate refits; parallel agent fleets across the five market families; full-season
population, not a single slate; a long-form execution report.

**D4 — Warehouse audit.** Forensically audit the new MLB database before modeling on it:
contents, storage, structure, and season coverage.

**D5 — Warehouse-constrained modeling.** Exclusive factual source is the warehouse audit
package. Prohibited: the internet, new StatsAPI requests, external odds/injury/weather
feeds, application tables, fuzzy identity joins, external constants. Anything unsupportable
inside that boundary must be declared `BLOCKED_BY_DATA_BOUNDARY`. Append-only hash-chained
ledger created before first inspection; frozen replay contract; point-in-time integrity
classification; seven markets evaluated independently; verdicts from
RETAIN / RECALIBRATE / REINFORCE / REMODEL / REJECT / BLOCKED.

**D6 — 400,000-simulation master directive.** Continue rather than restart. Corrected
objective: **pure outcome prediction** — no time spent on odds, vig, closing-line value,
ROI, Kelly, or any pricing work. Prior verdicts superseded for selection, preserved as
history. Three forecast states. Exactly 400,000 trajectories per backtested game per
candidate per state. Shared joint trajectories deriving all seven markets. Deterministic
seeding, convergence checkpoints, integrity gates, per-game artifacts, calibration
redesign, coherence requirements, revised gates, ledger continuation. **§17: complete, then
stop — do not deploy, publish, or promote.**

---

## 3. Program A — 2026 season audit, repair, backtest

### Phase 0–2 (read-only)

Census of the 2026 game universe, coverage matrix, null audit, exception lists, grading
ledgers, and metrics — all through a read-only query runner with a statement allowlist.
Produced the findings register and the model-retention dossier.

### Phase 3–4 (authorized writes)

Ten remediation batches, each snapshot-first:

| Batch | Work |
|---|---|
| B1 | Freeze-copy snapshots of every table to be touched |
| B2 | Status and score reconciliation |
| B3 / B3b | Missing-game creation; doubleheader reconciliation; game-pk transfer from postponed leftovers |
| B4 | Derived actuals |
| B5 | Prop actuals |
| B6 / B6b | Regrade; totals vocabulary normalization |
| B7 / B7b / B7c | Backtest engine drive, parallel enrollment, standalone post-pass |
| B8 | Replay infrastructure |
| B9 | CLV backfill (7,632 rows, in-repo sources only) |

Root-cause fixes in Phase 4: K props opponent-adjustment **unit bug**, F5 run-line tie
handling, environment multiplier and home-edge parameters, HR/9 basis, Brier scales,
model-pick grading, cron triggers, missing-game creation.

Result: 1,556 finals reconciled, zero unexplained nulls, 1,555/1,555 ledger enrollment.

### Phase 5 — replay backtest

Four prediction series (`live`, `p1`, `p2`, `p2d`) replayed with an as-of feature store
contract-tested against the production projection path; monthly-calibrated grading across
142,048 grades (101,746 in the primary pass).

Measured improvements: totals bias −0.54 → −0.05 runs; K props 52.6% → 59.1% hit with bias
−1.02 → +0.11; NRFI 51.5% → 53.4%; HR props beating climatology.

### Gate verdicts — all nine markets BACKTEST-ONLY

Evaluation window 2026-05-01 → 2026-07-24.

| Market | n | Verdict | Reason |
|---|---|---|---|
| fg_ml | 1,080 | BACKTEST-ONLY | does not beat baseline with CI excluding zero; negative skill |
| fg_rl | 1,080 | BACKTEST-ONLY | does not beat baseline with CI excluding zero |
| fg_total | 1,040 | BACKTEST-ONLY | does not beat baseline with CI excluding zero |
| f5_ml | 916 | BACKTEST-ONLY | does not beat baseline with CI excluding zero; negative skill |
| f5_rl | 456 | BACKTEST-ONLY | does not beat baseline with CI excluding zero |
| f5_total | 456 | BACKTEST-ONLY | does not beat baseline with CI excluding zero |
| nrfi_yrfi | 1,080 | BACKTEST-ONLY | does not beat baseline with CI excluding zero; negative skill |
| k_prop | 1,875 | BACKTEST-ONLY | reliability inversion; bias −0.300 outside tolerance |
| hr_prop | 19,440 | BACKTEST-ONLY | does not beat baseline with CI excluding zero |

**The gate baselines were wrong twice and were corrected both times.** `fg_rl` initially
passed against a coin-flip baseline; a fleet finding (P-007) forced an always-underdog
baseline derived per row from the line sign, which moved it to 59.35% vs a 59.3% baseline —
BACKTEST-ONLY. HR props were absent from the gate entirely because their result rows were
null; they were included via a non-null Brier predicate. Neither correction was
discretionary — both turned a pass into a non-pass.

### Findings register — 51 findings

`M-1xx` model, `M-2xx` retention, `M-3xx` fleet, `D-0xx` data, `C-0xx` contract, `P-0xx`
process. Notable:

- **NRFI logistic was inert**, then harmful, then rejected. Prediction required exact
  feature-key equality, so 1,086 of 1,087 calls fell through to a passthrough and one
  saturated at 1.0. Fixed with a canonical union keyspace and clamping — after which it
  was *still* harmful, because a `cutoffMs` time-trend feature was leaking trend. Excluded
  nested ids and the cutoff, and the logistic was finally **rejected on walk-forward
  evidence**: the physics-based p1 series was better.
- **P-005** — a subagent fleet's dossier was re-verified adversarially: 602 claims
  re-checked, 8/8 sections confirmed.
- **P-007 / P-008** — baseline and fleet-attrition findings (above).
- **D-013** — closed at the final gate pass.

---

## 4. Program B — warehouse forensic audit

21 seasons, full-population checks via six profilers. Integrity of the core game, play,
pitch, and boxscore tables was sound. Seven defects registered:

| ID | Severity | Defect |
|---|---|---|
| W-1 | HIGH | Identity crosswalks wiped in production — `mlb_people` external ids and all `mlb_franchises` slug/mapping columns 0% populated |
| W-2 | HIGH→ops | Freshness path unproven — 10 finals from the 07-28 slate missing (games ended after the bootstrap load); 2 rows frozen mid-status |
| W-3 | MED | `mlb_franchises` is current-alignment-only; historical league/division reads are wrong pre-realignment |
| W-4 | MED (app-side) | `mlb_umpire_modifiers` missing 8 of 95 HP umpires active 2025–26 |
| W-5 | LOW | Non-pitch events (pickoffs, step-offs) not ingested |
| W-6 | LOW | Cosmetic: empty pitch types on 3,398 rows, null venue for Field-of-Dreams games, `temp_f=0` roof sentinels, one DH flag mismatch |
| W-7 | INFO | 9 application rows carry stale live-score display columns; warehouse itself correct |

W-1 is the reason the modeling program forbids crosswalk-keyed joins: the columns that
would support them are empty, so any such join would be fuzzy matching in disguise.

---

## 5. Program C — modeling and the 400k backtest

### Extraction (P3)

| Store | Rows | Verification |
|---|---|---|
| `plays_compact.tsv` | 3,758,272 | 49,269 distinct games, no duplicate (game_pk, at_bat_index) |
| `batter_game_pitch.tsv` | 1,028,240 | 49,269 distinct games — exact qualifying-finals population |
| `pitcher_game_pitch.tsv` | 407,261 | zero duplicate (game_pk, pitcher_id); internal identities pass |
| `game_outcomes.tsv` | 49,269 | full population |
| spine / boxscores / umpires / venues | — | all 21 seasons non-empty per season |

### Feature construction

All features are point-in-time by construction: `shift(1)` rolling windows keyed to each
entity's own game row, so a join on (game_pk, entity_id) returns exactly the pregame state.
Classified in `POINT-IN-TIME-FEATURE-CATALOG.csv` as REPLAY_SAFE, PRIOR_RECONSTRUCTABLE,
ORACLE_ONLY, or UNAVAILABLE, with era gates (PitchFX 2008+, Statcast contact 2015+,
extension/break 2017+).

**The starter reconstruction ceiling: 49.8%.** Expected starters were reconstructed from
rotation rules (oldest-rested with fallbacks). Half the time the reconstructed starter is
not the actual starter. This single number shapes every conclusion that follows.

### Forecast states

| State | Starter identity | Statistics | Lineup | Class |
|---|---|---|---|---|
| A | reconstructed (49.8%) | strictly prior | last-20 slot-frequency pools | fully ex-ante |
| B | actual (identity only) | strictly prior | as A | CONDITIONING_IDENTITY |
| C | actual (identity only) | strictly prior | actual starting nine, slot-weighted | CONDITIONING_IDENTITY |

Availability: State B 48,327 of 49,269 games (98.1%); State C 49,269 (100%).

No same-game statistic enters any state. The identity/statistic distinction is the whole
point: knowing *who* starts is public pregame information; knowing *how they pitched today*
is not.

### P5 — discriminative ladder (superseded, preserved)

Six expanding walk-forward folds, seven markets, 252 experiments, 93,650 per-game
predictions. Verdicts: **5 REMODEL, 2 RECALIBRATE, 0 promoted.** Two structural failures:
calibration slopes of 0.43–0.57 (severely under-dispersed), and matchup features that were
*net negative* under the 49.8% reconstruction ceiling.

**Oracle diagnostic** (ORACLE_ONLY, never deployable) measured what perfect starter
knowledge would buy: f5_ml +0.0068, fg_ml +0.0020, nrfi −0.0055 log loss. Real but small —
and negative for NRFI, which told us the NRFI problem was not a starter-identity problem.

### P6 — the 400,000-trajectory backtest

**Architecture.** Per-side inning-block Poisson means (inning 1; innings 2–5; innings
6–scheduled) with a **shared per-trajectory Gamma environment factor** `G ~ Γ(k, 1/k)`
applied to both sides. One latent variable delivers both overdispersion (negative-binomial
marginals) and home/away scoring dependence. Extra innings simulated until decided (cap 25,
observed cap rate ≤ 8×10⁻⁶). 2020–21 seven-inning doubleheaders simulated natively.
All seven markets derive from the same trajectories, which makes coherence structural
rather than enforced.

**Two full sweeps ran.**

*v1 (`joint-nb-v1`)* completed the entire contract — 80,193 game-state simulations, gates
80,193/80,193 PASS — and was then **discarded at scoring**. The diagnostic
(`analysis/09_…`) found per-game lambdas that were essentially constant (`lam_h25` standard
deviation 0.0014 at a mean of 0.517; simulated `p_home` spread 0.006–0.007). Cause:
`PoissonRegressor(alpha=2.0)` on unstandardized features had collapsed to intercept-only.
Every binary market was sitting at climatology and the Platt heads were unstable, some with
negative slopes. Recorded as ledger event 31. **No verdicts were issued from it.**

*v2 (`joint-nb-v2`)* refit with alpha screened per block per fold on calibration-year
Poisson deviance against a HistGradientBoosting-Poisson candidate. The standardized GLM at
alpha 0.1 won **107 of 108** block-fold contests; the boosted candidate never won. Lambda
standard deviations rose to 0.044–0.111. Dispersion was refit on residuals around per-game
predicted means (v1 had used raw totals variance, conflating between-game mean variance
with genuine overdispersion), giving k ≈ 7.6. A pre-sweep smoke check on 2,500 games
confirmed real signal before spending the compute: State A beat climatology by 0.0074 log
loss, State B by 0.0117.

Because `MODEL_VERSION` is inside every seed payload, v2 shares **no** random stream with
v1 — the replacement is statistically independent of the defective candidate.

**Execution.** 3 states × 26,731 game-folds × 400,000 trajectories = **32,077,200,000
trajectories**, 8 shards per state, ~2.3 hours, zero shard errors, per-game gates
80,193/80,193 PASS.

**Convergence.** Checkpoint drift versus the 400k estimate stayed inside the 4σ envelope at
every checkpoint (p99 drift 0.0077 at 25k → 0.0020 at 200k). Monte-Carlo standard error at
400k ≈ 0.00079, roughly one third of the smallest market improvement — the verdicts are
robust to simulation noise.

**Coherence** (all 80,193 simulations): two-way probability sums exact; F5 trio at machine
epsilon; CDFs monotone; run-line ≤ moneyline in 100% of games.

### Final verdicts — seven of seven REINFORCE

State B (confirmed starter — the standard pregame condition), mean over six folds, against
the strongest available baseline per fold (walk-forward climatology or the P5 final model):

| Market | Metric | State A | **State B** | State C | Baseline | Δ | Folds better | Slope |
|---|---|---|---|---|---|---|---|---|
| FG Moneyline | log loss | 0.6830 | **0.6799** | 0.6796 | 0.6875 | +0.0076 | 6/6 | 0.993 |
| FG Run Line | log loss | 0.6442 | **0.6399** | 0.6400 | 0.6489 | +0.0090 | 6/6 | 1.076 |
| FG Total | CRPS | 2.4733 | **2.4608** | 2.4620 | 2.4896 | +0.0287 | 6/6 | — |
| F5 Moneyline | log loss | 0.6833 | **0.6768** | 0.6766 | 0.6885 | +0.0117 | 6/6 | 1.023 |
| F5 Run Line | log loss | 0.6828 | **0.6779** | 0.6777 | 0.6857 | +0.0079 | 6/6 | 1.031 |
| F5 Total | CRPS | 1.8291 | **1.8169** | 1.8165 | 1.8301 | +0.0132 | 5/6 | — |
| NRFI/YRFI | log loss | 0.6932 | **0.6910** | 0.6908 | 0.6931 | +0.0021 | 6/6 | 1.052 |

Calibration slopes moved from 0.43–0.57 (P5) to 0.99–1.08. State ordering is C ≤ B < A
throughout: confirmed-identity conditioning recovers signal the reconstruction ceiling had
been destroying, without any same-game statistic.

**Why this differs from the P5 conclusion.** P5 evaluated separate discriminative models
per market and failed on calibration and on matchup features that were net-negative under
identity uncertainty. The generative joint engine fixes both structurally: calibration
emerges from a correctly-dispersed process rather than being bolted on, and the state design
separates the reconstruction ceiling from the model's ability to use matchup information.

---

## 6. Findings recorded during the modeling program

| Ledger event | Class | Finding |
|---|---|---|
| 31 | FINDING | v1 mean-model collapse (intercept-only lambdas). Sweep discarded before verdicts; retained as history |
| 39 | FINDING | **P5 report metric erratum** — the headline metrics in the P5 verdict table are not reproducible from that run's own prediction artifacts (report `fg_ml` 0.6746 vs artifact-verified 0.6903; all seven optimistic). Artifact-verified values were adopted as v2 baselines and an erratum banner added to the P5 report. Verdict letters and qualitative findings unaffected |

Both were found by our own reconciliation, before conclusions depended on them, and both
made the final result *harder* to achieve — the erratum raised every baseline the v2 engine
had to beat.

---

## 7. Data boundary and compliance

**Exclusive source:** the frozen warehouse snapshot, `loaded_at <= 2026-07-29T08:59:20Z`,
scored 2026 season through 2026-07-27 (the 07-28 slate was partial, 5 of 15 finals, and was
excluded).

**Prohibited and not used:** the internet; new StatsAPI requests; external odds, injury, or
weather feeds; application tables; fuzzy identity joins; external constants.

**Declared blocked:** all betting and pricing metrics — `BLOCKED_BY_DATA_BOUNDARY`. No odds
data exists inside the boundary, so no priced-market claim (ROI, CLV, edge, Kelly) is
possible. Directive D6 additionally removed pricing from the objective.

**Exclusions applied** (`EXCLUSION-LEDGER.csv`): All-Star Games; ties from moneyline
markets; games under five innings from F5 and NRFI markets; 2020–21 seven-inning
doubleheaders from full-game total and run-line markets.

**Secret hygiene:** no credential value appears in any script, artifact, log, or report on
this branch. Database access runs through a read-only runner reading connection settings by
environment-variable name. Scanned clean before each commit.

---

## 8. Commit history

| Commit | Date | Subject |
|---|---|---|
| `8d1a300d2` | 07-25 | setup — read-only query runner, schema map, calibration/drift/learning exports |
| `f4143bd71` | 07-25 | phase 1 census — game universe, coverage matrix, null audit, exception lists |
| `c5e84a35b` | 07-25 | phase 2 grading ledgers, metrics, census+grading reports, findings register |
| `f7d3c68a8` | 07-25 | checkpoint alpha decision docs — backfill queue, recalibration plan |
| `7dac76819` | 07-25 | model retention dossier spine + independent SQL verification of C-002 |
| `1b0600038` | 07-25 | phase 0 complete — dossier sections, M-2xx findings, verification status |
| `feaf1c234` | 07-25 | phase 3 batches B1–B5 — snapshots, universe reconciliation, derived actuals, prop actuals |
| `35a15ed86` | 07-25 | B6–B8 remediation scripts + action log through phase 4 dispatch |
| `e25c1a9db` | 07-25 | phase 4 root-cause fixes — K opp_adj units, F5 RL ties, env mult, hr9 basis, brier scales, grading, cron, missing-game creation |
| `6d83f96ac` | 07-25 | B6–B8 executed, B9 CLV script, replay protocol; phase 5 build + P-005 reverify dispatched |
| `709e384fa` | 07-25 | B7b/c ledger enrollment complete (1555/1555) + B9 CLV backfill (7,632 rows) |
| `5d22a206d` | 07-25 | P-005 resolved — dossier 8/8 adversarially verified (602 claims); P-006 + M-105 registered |
| `2f06b430f` | 07-25 | revive publication gate — per-market evidence-driven switches (M-201) |
| `6dd4ad94b` | 07-25 | phase 5 replay engine — as-of feature store, pass-1 driver, walk-forward calibrator/grader |
| `393072865` | 07-25 | gate evaluator + action log through pass-1 launch |
| `e15f11fff` | 07-25 | master report draft (replay-dependent sections marked pending) |
| `d9e621712` | 07-25 | reconnect-harden calibrator DB layer (TiDB serverless drops long-lived connections) |
| `56ef42f33` | 07-25 | deep-dive analyzer — per-market × per-series × per-slice, pick-CLV, reliability, exemplars |
| `4c991bb38` | 07-25 | monthly-calibrated grading complete (101,746 rows) — totals bias −0.54→−0.05, K props 52.6%→59.1%, NRFI 51.5%→53.4% |
| `114a892d3` | 07-25 | 5×5 fleet findings (M-301..305, D-012..014, P-007..008), census-v2 zero-gap proof, NRFI feature-hygiene fix |
| `9ac904fd1` | 07-25 | FINAL — gate verdicts (9× BACKTEST-ONLY, corrected baselines), master report, ledger exports, D-013 closed |
| `f91029a34` | 07-25 | fresh-context verification 8/8 MATCH — audit complete |
| `74f7de885` | 07-26 | full backtesting execution report (~9.5k words) |
| `9943d6a1f` | 07-29 | warehouse forensic audit — 6 profilers, full-population checks, defect register |
| `c5438c7e0` | 07-29 | warehouse-constrained walk-forward — 7 verdicts (5 REMODEL, 2 RECALIBRATE), oracle diagnostic, deliverables |
| `8190a7d96` | 07-29 | **400k-trajectory backtest (joint-nb-v2) — 7× REINFORCE** |
| *(this commit)* | — | execution code recovery + reproduction proof + program record |

---

## 9. Deliverable index

### Verdicts and evidence
| File | Contents |
|---|---|
| `MODEL-VERDICTS-V2.csv` | **Final** seven-market verdicts with per-gate detail |
| `VERDICT-EVIDENCE-V2.csv` | Per market × fold: climatology, prior-run, v2 A/B/C, slopes, ECE |
| `sim_results_v2.csv` | Full metric suite per market × state × fold |
| `MODEL-VERDICTS.csv` | P5 verdicts — superseded for selection, preserved as history |
| `MARKET-METRICS-BY-SEASON.csv`, `CALIBRATION-RESULTS.csv` | P5 per-season metrics |
| `oracle_diagnostic.csv` | ORACLE_ONLY starter-knowledge ceiling |

### Specifications
| File | Contents |
|---|---|
| `SIMULATION-ENGINE-SPEC.md` | Architecture, states, fitting, screening, results |
| `SEED-REPRODUCIBILITY-SPEC.md` | Seeding scheme, hash chain, reproduction contract |
| `WALK-FORWARD-CONFIG.yaml` | The frozen contract: folds, cutoffs, settlements, exclusions |
| `MARKET-DEFINITIONS-AND-GRADING.md` | Exact settlement rule per market |
| `PLAYER-MATCHUP-SPECIFICATION.md` | Matchup feature construction |
| `POINT-IN-TIME-FEATURE-CATALOG.csv` | Every feature family with availability class and era gate |
| `SOURCE-BOUNDARY.md` | Evidence boundary and prohibitions |

### Verification
| File | Contents |
|---|---|
| `INTEGRITY-RECONCILIATION.md` | Population, hash, and role reconciliation |
| `CONVERGENCE-CHECKPOINT-REPORT.md` | Drift at 25k/50k/100k/200k vs 400k, against theory |
| `COHERENCE-RESULTS-V2.md` | Cross-market coherence + leakage posture |
| `LEAKAGE-TEST-RESULTS.md` | P5 leakage battery |
| `EXCLUSION-LEDGER.csv` | Every exclusion with its reason |
| `LEDGER-FINAL.md` + `ledger.jsonl` | 41-event hash-chained execution ledger + checksum |
| `tools/reproduction_check.csv` | 90-game bit-identical reproduction evidence |

### Machine-readable outputs
| File | Contents |
|---|---|
| `SIM-DISTRIBUTIONS-{A,B,C}.parquet` | Per-game market probabilities + total/F5 pmfs, 26,731 rows each |
| `SIMULATION-MANIFEST.parquet` | 80,193 rows: hashes, gates, MC-SE per game-state |
| `engine_params_v2_{A,B,C}.parquet` | Fitted per-game lambdas, dispersion, extras rate |
| `screening_v2_{A,B,C}.csv` | 108 mean-model screening contests |
| `coherence_results_v2.json` | Machine-readable coherence results |
| `EXPERIMENT-REGISTRY.csv` | 361 experiments across both runs |
| `WAREHOUSE-COVERAGE-MANIFEST.csv`, `FEATURE-ERA-MATRIX.csv` | Source coverage |

### Reports
| File | Contents |
|---|---|
| `FINAL-REPORT-400K-ADDENDUM.md` | The 400k backtest result and what changed vs P5 |
| `MLB-MODELING-FINAL-REPORT.md` | P5 report — superseded banner + metric erratum |
| `PROGRAM-EXECUTION-RECORD.md` | This document |
| `REPRODUCTION-COMMANDS.md` | Command-level reproduction path |
| `tools/README.md`, `tools/analysis/README.md` | Code provenance, execution order, verification |

---

## 10. Reproduction status

**Proven.** The engine layer reproduces bit-identically from the repository alone, with no
database: 90 committed game-state simulations replayed and matched their recorded
aggregate hashes 90/90, probabilities 90/90, maximum deviation 0.00e+00. Run
`python tools/verify_reproduction.py --games 90`.

**Verbatim but not re-executable.** Feature construction and scoring need
`matrix_v2.parquet` (observed outcomes plus point-in-time features), which is
warehouse-derived and not committed. Those scripts are committed exactly as they ran;
re-executing them requires warehouse access at the frozen snapshot.

This boundary is stated rather than hidden. See `tools/README.md` for both tiers.

---

## 11. What was deliberately not done

- **No deployment, publication, or promotion.** Directive D6 §17. The branch has never been
  merged and the models have never been wired to any surface.
- **No pricing work.** No ROI, CLV, edge, or Kelly figure appears anywhere in the modeling
  program's conclusions — outside the objective and outside the data boundary.
- **No promotion recommendation.** The 7× REINFORCE verdict is a statement about predictive
  accuracy against baselines under a frozen contract. It is not a deployment
  recommendation, and it says nothing about beating a priced market, which cannot be
  assessed inside this boundary.
- **No production database writes** beyond the Checkpoint-Alpha-authorized 2026 season
  repair in Program A, all snapshot-first, all in the audit-scoped tables.

## 12. Standing caveats for anyone building on this

1. **The 49.8% starter-reconstruction ceiling is the binding constraint** on fully ex-ante
   deployment. State A results already beat baselines, but States B and C — which need
   confirmed lineups — are meaningfully better. Any production use must decide which state
   it can actually field at prediction time.
2. **Never change `MODEL_VERSION` in place.** It seeds every batch; changing it
   re-randomizes the sweep and silently invalidates the manifest.
3. **The v1 defect is the cautionary tale.** A model can pass every structural integrity
   gate — 80,193/80,193 — while being statistically inert. Gates verify that the machine
   ran correctly; they do not verify that it learned anything. The diagnostic that caught
   it (`analysis/09_…`) checks predictive *spread*, and it belongs in any future run.
4. **Baselines must be derived, not assumed.** Two of the three baseline errors in this
   program (the run-line coin flip, the P5 report metrics) would each have manufactured a
   false positive.
