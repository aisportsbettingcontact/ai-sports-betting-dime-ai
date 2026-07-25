# MASTER REPORT — Dime AI MLB Model: Season Audit, Backfill & Recalibration (2026 season through 2026-07-24)

> STATUS: sections marked `[PENDING: pass-1/2 replay]` finalize when the walk-forward replay
> completes; every other number below is final and evidence-cited. Branch:
> `local/audit-mlb-model-2026`. Nothing merged, pushed, or deployed.

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
actually published live. `[PENDING: pass-1/2 replay]` — final per-market before/after and the
publication-gate verdict table below.

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

## 5. Replay & recalibration results `[PENDING: pass-1/2 replay]`

Fitted walk-forward calibration values per month, per-market before/after
(live vs fixed-raw vs fixed-calibrated): see calibration/before-after.md when complete.

## 6. Publication gate `[PENDING: pass-1/2 replay]`

Per-market verdict table (walk-forward evidence, May–July only; criteria: beats stated baseline
with CI excluding zero, sane reliability with non-negative Brier skill, bias inside band):
GATE-TABLE.json. `publish_*` rows are written to `mlb_calibration_constants` as
recommendations — they have zero production effect until the gate code merges, and any row can
be flipped before or after.

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

## 10. Verification `[PENDING: fresh-context verifier after replay]`
Exit-criteria table with proving artifacts lands here after the final census re-run.
