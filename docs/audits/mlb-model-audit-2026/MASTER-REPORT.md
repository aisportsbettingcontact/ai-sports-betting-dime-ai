# MASTER REPORT — Dime AI MLB Model: Season Audit, Backfill & Recalibration (2026 season through 2026-07-24)

> STATUS: FINAL (2026-07-25 ~22:30 UTC). Every number is evidence-cited to a committed artifact
> or logged query. Branch: `local/audit-mlb-model-2026` (audit worktree). Nothing merged,
> pushed, or deployed.

## Executive verdict

The 2026 MLB season data is now complete, current, and honestly graded: all 1,556 completed
games exist with final scores, first-five-inning and first-inning actuals, and every stored
grade has been re-derived from raw values with corrected logic — the platform's previous stored
grades were unusable (its F5 "model correct" flags graded an always-bet-the-away-team strategy,
its NRFI/F5 Brier scores divided 0–1 probabilities by 100, and three games carried the wrong
final score). Closing-line value now exists for 82% of full-game ledger rows; it had never been
computed. Of the five market families, only full-game moneyline (and to a lesser degree the
run line pick channel) showed genuine skill as-published; strikeout props were structurally
broken (a units bug shrank every projection to ~72% of the book line — root-caused to the line,
fixed in code), full-game totals ran half a run cold against a hotter 2026 run environment
(environment multiplier now wired, fitted walk-forward), HR props underperformed the league
base rate, and NRFI was a coin flip (rebuilt as a walk-forward logistic model; its publication
now depends on the evidence gate). A full-season fixed-model walk-forward replay fills every
projection gap under a provenance regime that keeps replay strictly separated from what was
actually published live. The repaired model's walk-forward backtest is strong against actuals —
totals bias eliminated, strikeout props from broken to 59% with zero bias, every market now
honestly measurable — and the evidence gate then says the quiet part out loud: none of the nine
markets yet beats its market/naive baseline with statistical confidence, so every market is
gated BACKTEST-ONLY pending more sample and the registered next-round improvements. Publish
graded results and transparent projections; do not sell edges the data does not yet support.

## 1. What the season actually was (census, final)

Universe: 1,597 scheduled regular-season games; 1,556 complete through 2026-07-24; 25
postponed; 16 on the as-of slate. After remediation the `games` table matches the schedule
exactly: 1,556 finals, zero stuck statuses, zero finals missing any derived actual (evidence:
remediation-log.md B2–B4; re-census in census/census-v2-summary.json `[refreshed at close]`).
Notable structural repairs: 11 games existed under stale pre-postponement dates (MLB preserves
gamePk across reschedules — 8 doubleheader game 2s among them), three finals stored their twin
game's score (D-011), the BOS@BAL 4/25 game was duplicated onto 4/26 in the schedule table,
and the 4/30 doubleheader game 2s were double-listed with their identities split across two
rows each. Every repair was StatsAPI-verified before writing, snapshot-backed, and logged.

## 2. What the model actually did (live_pregame accuracy, season to date)

From 22,466 re-derived ledger rows (GRADING-REPORT.md, ledgers in grading/):

| Market | Graded n | Hit | Brier | Signed bias | Verdict on live season |
|---|---|---|---|---|---|
| FG moneyline | 1,528 | 55.4% ±2.5 | 0.2471 | — | real directional skill, probabilities compressed |
| FG run line (pick) | 1,528 | 58.8% ±2.5 | — | −0.35 runs margin | skill, contaminated by +3pp home shim |
| FG total | 1,467 | 52.2% ±2.6 | 0.2539 | **−0.54 ±0.23 runs** | environment miss (2026 actual 9.13 r/g vs model 8.61) |
| F5 moneyline | 1,262 | 54.0% ±2.8 | 0.2488 | — | modest skill |
| F5 run line | 817 | 47.7% ±3.4 | — | — | tie-exclusion bug understated away covers |
| F5 total | 820 | 51.5% ±3.4 | 0.2536 | −0.28 ±0.21 | mild under-lean |
| NRFI/YRFI | 1,496 | 51.3% ±2.5 | 0.2502 | — | indistinguishable from coin flip |
| K props | 2,159 | 52.8% ±2.1 | 0.2974 | **−0.99 ±0.11 K** | structurally broken (M-204); tail probs anti-calibrated |
| HR props | 8,555 prob-graded | — | 0.0987 | mean p 0.094 vs 0.110 actual | negative skill vs base rate |

## 3. Root causes found and fixed (all committed, walk-forward validation `[PENDING]`)

1. **K props (P0)**: opponent adjustment divided a K-per-27-at-bats stat (league mean ≈6.8) by
   a true-K/9 constant 8.2, and expected innings were anchored to the book line — making every
   projection ≈0.72× the line. Fixed: same-basis measured divisor + as-of innings
   (`mlbKPropsModelService.ts`, replay driver). Calibration factors re-fit walk-forward.
2. **FG totals (P1)**: 2025-frozen run environment vs 2026 scoring surge. Fixed: league
   environment multiplier at the simulation's single choke point, fitted monthly walk-forward
   (`MLBAIModel.py` + runner constant injection).
3. **F5 run line (P1)**: away +0.5 cover probability excluded ties (~15% of outcome mass).
   Fixed with a partition assertion.
4. **+3pp home moneyline shim (P1)**: promoted to a measured, calibration-table-driven
   parameter (DB currently holds the measured 0.0178 vs the hardcoded 0.03).
5. **HR props (P1)**: per-27-AB rate consumed as per-PA (~11% lambda inflation), stale one-off
   Statcast inputs, two competing park-factor sources — basis fixed, park source unified,
   factor re-fit walk-forward.
6. **Grading engine (P0/P1)**: Brier ÷100 scale bug fixed; model-pick grading now written by
   the nightly ingestor (the away-side-bet semantics are gone); the full season regraded.
7. **NRFI (P1)**: rebuilt as a walk-forward logistic on starter as-of NRFI rates (2025-seeded
   priors with Bayesian shrinkage), team first-inning scoring, park, and hands. Ships only if
   it clears the gate.
8. **Pipeline (P1)**: missing-game/doubleheader creation added to the StatsAPI score refresh;
   three authenticated cron endpoints added so ingestion, closing capture, and backtest
   enrollment survive `DISABLE_BACKGROUND_JOBS=1` deployments (no external workflow calls them
   yet — see Decisions); publication gate revived with per-market `publish_*` switches
   (fail-open until verdicts land).

## 4. Provenance regime (enforced structurally)

`live_pregame` = the untouched projections the platform actually wrote; they were never
modified — only their *grades* and *actuals* were corrected (snapshot-first: five
`*_audit_bak_20260725` tables). `walkforward_replay` = Phase 5 output in new `mlb_replay_*`
tables that no public surface reads; REPLAY-PROTOCOL.md pins the as-of rules (features strictly
pre-first-pitch, expanding-window monthly calibration, outcomes never feeding their own
projection). The public accuracy story remains §2; replay powers backtests and calibration
only. Residual honesty caveat: `modelRunAt` clobbering means pregame provenance for live rows is
unprovable for 286 games (all quarantined in the ledger) and timestamps on props are
overwritten by post-game refreshes (P-001); the projection *values* behave like genuine pregame
numbers, and the forward fix (immutable first-projection timestamp) is queued as a schema
change for deploy-time `db-push`.

## 5. Replay & recalibration results (final)

Four series exist for every completed game and market: `live` (as published), `p1` (fixed model,
raw), `p2` (monthly walk-forward calibration), `p2d` (per-slate daily walk-forward calibration —
the headline backtest). 142,048 unified grade rows; full tables in calibration/before-after.md,
DEEP-DIVE.md, and grading/replay-ledger-*.csv (per-game). Headlines, season through 7/24:

| Market | live | p2d (daily-calibrated fixed model) |
|---|---|---|
| FG total | 52.2% hit, bias −0.54 runs | **55.0% hit, bias −0.026 (statistically zero)** |
| K props | 52.6% hit, bias −1.02 K, 87% forced UNDER | **59.2% hit, bias −0.024, balanced sides, MAE 2.09** |
| FG ML | 55.2% hit, Brier 0.2472 | 55.0% hit, Brier 0.2483 (probabilities re-tempered; engine raw is overconfident, T≈1.5) |
| F5 RL | 47.7% hit (tie bug) | 50.4% (partition fixed) |
| NRFI | 51.5%, Brier 0.2500 | 53.3%, Brier 0.2487 from the fixed simulation itself — the rebuilt logistic was REJECTED by its own walk-forward evidence (Brier 0.2582/0.2599 in both variants, worse than passthrough) |
| HR props | Brier 0.0991 (lost to climatology) | Brier 0.0969 (beats climatology on level; top-decile still overconfident) |

Fitted values (per-slate trajectories in grading/replay-applied-params.csv): env mult
+1.5–4.6%, T_fg 2.0→1.48, K factor 0.84→0.87 on the corrected unit basis, HR factor 0.96–1.00.
The daily refit demonstrably beats monthly where it matters (K bias +0.113→−0.024; May totals
overshoot halved). Remaining known structure (registered, RECOMMENDED ONLY): F5 lacks HFA and
its own env mult (M-302/303); home-edge shim mis-signed for 2026 (M-304); K/HR probability
tails overconfident — isotonic/negative-binomial layer candidate (M-305).

## 6. Publication gate — final verdicts (GATE-TABLE.json; May–July walk-forward evidence only)

**All nine markets: BACKTEST-ONLY.** The repaired model grades well against actuals but does not
yet beat its honest baseline with a CI excluding zero in the three post-seed months: FG/F5 ML
lose to the book's no-vig probabilities (the market is sharper); FG total's Brier skill is
positive (+0.0035) but the CI reaches zero; FG RL's 59.35% hit equals the always-take-the-dog
base rate (59.3%) exactly; K props hit 62.2% in-window but carry a −0.30 bias drift and one
tail-reliability inversion; NRFI and HR props sit at their climatologies. Two gate corrections
were forced by the audit's own fleet (finding P-007): RL's baseline is always-dog, not a coin
flip — the naive-looking 59% RL "edge" is structural. `publish_*` rows are written (all 0) as
recommendations; they have zero production effect until the gate code merges, and the owner can
flip any row. The defensible subscriber-facing framing today is transparent graded RESULTS and
projections labeled as such — not claimed edges.

## 7. CLV (Phase 6, final for what in-repo data allows)

CLV = noVig(closing, side) − bookNoVig(at projection). Computed for 7,632 of 9,342 full-game
ledger rows: 4,504 against locked DraftKings closing lines (capture began 2026-04-11), 3,128
against last pre-start odds snapshots (labeled proxy; mean age 60 min, 72% within 30 min).
1,710 rows remain null with reasons (line moved / no source) in census/clv-coverage.csv.
**Coverage gaps with no in-repo source**: F5 lines, NRFI odds, and prop lines have no closing
archive anywhere in the schema — nothing to backfill from.

**Forward-capture + sourcing proposal (needs your authorization):**
- Forward: extend the odds snapshot pipeline to persist F5/NRFI/prop lines per cycle (the
  scrapers already fetch them; they are simply not archived), and harden closing capture
  (book fallback + status-independent final pre-start snapshot — cluster D landed the
  robustness pieces; the F5/NRFI/prop archival needs a small schema addition at next db-push).
- Historical: third-party odds archives (e.g. an odds-history data vendor) could fill
  March–April closings and prop closings; that is an external dependency and a purchase
  decision — explicitly out of scope without your sign-off.

## 8. Findings register: 43 findings; statuses final in FINDINGS.md
2×P0 + 1 more P0-class root cause (M-204), 22×P1, remainder P2/P3. Every FIX EXECUTED status
carries its batch evidence in remediation-log.md; RECOMMENDED ONLY items are listed in §9.

## 9. Decisions I need from you
1. **Closing-line sourcing** (§7): authorize forward capture schema addition at next db-push;
   decide on historical vendor sourcing.
2. **Publish/suppress calls** from the gate table `[PENDING]` — especially NRFI (rebuilt) and
   K props (fixed but factor re-fit is young).
3. **Merge & deploy**: the branch holds the fixes, gate, cron endpoints, and audit artifacts;
   schema changes (immutable projection timestamp, F5/NRFI/prop line archival) need the manual
   db-push workflow at deploy; the new cron endpoints need a scheduler (Railway cron or GH
   Actions) pointed at them.
4. **Replica/env check**: production Railway variable listing was permission-blocked this run;
   confirm exactly one replica runs with background jobs enabled (M-208).

## 10. Verification & exit criteria

| # | Criterion | Proof |
|---|---|---|
| 1 | Every completed game exists with final outcomes + derived actuals; zero stuck statuses | census-v2: schedComplete = gamesFinals, zombies 0; finals missing actuals = 0 in the audited window (the only in-window exception is the All-Star exhibition, EX-ALLSTAR) |
| 2 | Ten-market projection coverage 100% (live ∪ replay); zero unexplained nulls | census-v2 projectionCoverage: all nine market columns gap 0 over all finals; exemptions enumerated in census/exemptions.csv |
| 3 | Every projection graded from raw values with corrected logic; ledgers reconcile | 142,048 unified grade rows across four series; independent grader agents re-derived ALL games-table grades with zero mismatches; two independently built ledgers agree 99.89% (disagreements were the corrected-score games) |
| 4 | Root-cause + pipeline fixes landed, walk-forward validated, no regressions | Phase 4 commits (tsc clean, 280+ tests across clusters); before/after per market in §5; independent modeler agents re-derived every calibration scalar exactly; NHL/NCAAM shared-code paths untouched by diff-scope |
| 5 | Publication gate live and enforced; verdicts for all markets | Gate module + tRPC + client wiring committed; GATE-TABLE.json (9 verdicts); publish_* rows written |
| 6 | CLV wherever closing lines exist; coverage map + sourcing proposal | 7,632 fg rows with CLV (4,504 DK closing, 3,128 labeled proxy); clv-coverage.csv; §7 proposal |
| 7 | Provenance integrity: no live_pregame projection modified; snapshots + logged counts for every write batch | remediation-log.md (B1–B9, all snapshot-backed); replay confined to mlb_replay_* tables; provenance column separates series |

Verification notes stated plainly: the 10-agent test fleet and parts of the 25-agent granular
fleet were cut short by session limits (P-008) — fullgame/F5 groups verified fully (hundreds of
claims, zero unbacked), K/HR granular reports are thinner and covered by the deep-dive instead;
the production Railway env check remains permission-blocked (M-208 stays INFERRED); pregame
provenance for 286 live games remains unprovable (quarantined, P-001).
