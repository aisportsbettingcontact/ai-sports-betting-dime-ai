# Grading, Backtest, Drift & Calibration Machinery — Phase 0 Dossier

Evidence classes: **VERIFIED** = code read at the cited location this session. **INFERRED** = reasoned from verified facts (reasoning stated). **UNKNOWN** = could not be established from code; listed as census questions.

---

## Overview

There is no single grading system. The repo contains **five distinct grading/calibration stacks**, of which only some are live:

1. **Live multi-market game grader** — `server/mlbMultiMarketBacktest.ts` (VERIFIED, whole file read). Grades 14 game-level markets + HR props per game, writes `mlb_game_backtest`, runs 2σ per-market drift detection, and is invoked from the 5-minute MLB cycle on FINAL transition (`server/vsinAutoRefresh.ts:1952-1994`).
2. **Live prop graders** — `server/kPropsBacktestService.ts` (writes `mlb_strikeout_props.actualKs/backtestResult/modelError/modelCorrect/backtestRunAt`, VERIFIED whole file) and `server/mlbHrPropsBacktestService.ts` (writes `mlb_hr_props.actualHr/backtestResult/modelCorrect/backtestRunAt`, VERIFIED whole file). Both invoked every MLB cycle (`server/vsinAutoRefresh.ts:1934`, `:1937-1944`).
3. **Nightly outcome ingestion + f5_share drift + auto-recalibration** — `server/mlbOutcomeIngestor.ts` + `server/mlbDriftDetector.ts`, orchestrated by `server/mlbOutcomeAndDriftScheduler.ts` (all VERIFIED, whole files read). Writes `games.actualFgTotal/actualF5Total/actualNrfiBinary/brier*` and `mlb_drift_state`, `mlb_model_learning_log`, `mlb_calibration_constants` (seed only). Its production liveness is **UNKNOWN** — see Scheduling.
4. **"Audit-grade" grading family — DEAD CODE in production**: `server/mlbBacktestAuditCore.ts` (pure grading functions with VOID/QUARANTINE/leakage/CLV), `server/mlbWalkForwardValidator.ts`, `server/mlbCalibrationAudit.ts`, `server/mlbSegmentationEngine.ts`, `server/mlbPublicationGate.ts`. VERIFIED: the only importers of these modules are `server/mlbBacktestAudit.test.ts:43-89` and each other (`mlbPublicationGate.ts:35-37`, `mlbWalkForwardValidator.ts:33`, `mlbCalibrationAudit.ts:38`, `mlbSegmentationEngine.ts:37`). Grep found no scheduler, cron route, or tRPC procedure that calls `gradeMarket`, `runWalkForwardAllMarkets`, the calibration audit, the segmentation engine, or the publication gate. The sophisticated leakage guard, VOID semantics, and CLV math therefore **never execute against live data**.
5. **User bet-tracker grading** (adjacent, out of scope): `server/scoreGrader.ts` + `server/betAutoGradeScheduler.ts` grade `tracked_bets` for the BetTracker feature — a third independent implementation of ML/RL/Total/F5/NRFI grading rules (VERIFIED headers, `scoreGrader.ts:1-51`, `betAutoGradeScheduler.ts:1-45`).

Two headline structural facts:

- **The `games` table's own grading columns (`fgMlResult`, `fgRlResult`, `fgTotalResult`, `fgMlCorrect`, `fgRlCorrect`, `fgTotalCorrect`, `f5MlResult/f5RlResult/f5TotalResult/f5*Correct`, `nrfiBacktestResult`, `nrfiCorrect`, `fgBacktestRunAt/f5BacktestRunAt/nrfiBacktestRunAt`) have NO writer in the current codebase.** VERIFIED: repo-wide grep finds them only in `drizzle/schema.ts`, read-only usages in `server/routers.ts:121-138` (field-strip list) and `server/routers/mlbSchedule.ts:719-1080` (SELECTs for admin pages), plus this audit's own tool `docs/audits/mlb-model-audit-2026/tools/grade-season.mjs`. Whatever populated them is deleted history (candidates in `git log --diff-filter=D`: `run_full_backtest_march25_april5.ts`, `generate_backtest_report.ts`, etc. — UNKNOWN which).
- **`mlb_calibration_constants` is a write-only table.** VERIFIED: the only code touching it is the seed in `server/mlbDriftDetector.ts:210-244` (INSERT-if-missing) and one-off scripts `scripts/recompute_calibration.mjs` / `scripts/recalibrate_and_model_may23.mjs` (writers). No SELECT anywhere in `server/` or `client/` consumes its values at runtime. Every "calibration constant" the live model actually uses is a hard-coded literal in `server/MLBAIModel.py`, `server/mlbKPropsModelService.ts`, or `server/mlbHrPropsModelService.ts` (see constants map below).

---

## Data inputs & ingestion

| Input | Source | Written by | Written to |
|---|---|---|---|
| Live/final FG + F5 scores, NRFI result | MLB Stats API | `server/mlbScoreRefresh.ts:669-679` (VERIFIED) — part of `refreshMlbScoresNow()` called in cycle Step 1 (`vsinAutoRefresh.ts:1709`) | `games.actualAwayScore/actualHomeScore/actualF5AwayScore/actualF5HomeScore/nrfiActualResult` |
| Innings-level linescore (authoritative nightly) | `statsapi.mlb.com/api/v1/schedule?sportId=1&date=...&hydrate=linescore` (`mlbOutcomeIngestor.ts:263-265`, VERIFIED) | `ingestMlbOutcomes()` (`mlbOutcomeIngestor.ts:368`) | `games.actualFgTotal/actualF5Total/actualNrfiBinary`, 5 `brier*` columns, `outcomeIngestedAt` (`mlbOutcomeIngestor.ts:609-622`) |
| Pitcher K totals | `statsapi.mlb.com/api/v1/game/{gamePk}/boxscore` (`kPropsBacktestService.ts:92`) — starting pitcher = `pitchers[0]` (`:114`) | `runKPropsBacktest()` | `mlb_strikeout_props` |
| Batter HR counts | same boxscore endpoint (`mlbHrPropsBacktestService.ts:62`) | `fetchAndStoreActualHrResults()` | `mlb_hr_props` |
| Model probabilities being graded | `games.model*` columns written by the model runner (e.g. `modelPNrfi` written 0–1 at `server/mlbModelRunner.ts:2507`), `mlb_hr_props.modelPHr`, `mlb_strikeout_props.kProj` | — | — |
| Book odds being graded against | `games.homeML/awayML`, `homeRunLineOdds/awayRunLineOdds`, `bookTotal/overOdds/underOdds`, `f5*` odds, `nrfiOverOdds/yrfiUnderOdds` (FanDuel NJ per `drizzle/schema.ts:470-474`), `mlb_hr_props.consensusOverOdds/fdUnderOdds`, `mlb_strikeout_props.bookLine` | AN/VSiN/FanDuel scrapers (other dossiers) | — |

Matching keys: `games.mlbGamePk` primary, team-abbreviation fallback with normalization map (`mlbOutcomeIngestor.ts:508-534`, `:838-857`). K-prop pitcher matching is fuzzy name match with diacritic stripping (`kPropsBacktestService.ts:170-214`) plus a **starter-substitution fallback** that grades the projected pitcher against whichever pitcher actually started (`kPropsBacktestService.ts:349-367`, VERIFIED — see Finding F9).

---

## Model mechanics (grading rules + all parameters)

### Grading rules per market — LIVE path (`mlbMultiMarketBacktest.ts`)

All markets emit `NO_ACTION` when the confidence gate fails, `MISSING_DATA` when actuals are absent, and `correct = 1/0` only for WIN/LOSS (`correct = null` for PUSH/NO_ACTION/MISSING_DATA). There is **no VOID path in the live grader** — postponed/suspended handling exists only in the dead audit core and in `mlbPostponedTracker` upstream.

| Market | Model prob source | Right/wrong rule | Push rule | Confidence gate | Citation |
|---|---|---|---|---|---|
| fg_ml_home | `modelHomeWinPct`/100 | home won = actualHome > actualAway | tie ⇒ PUSH (guarded; "impossible in MLB") | edge ≥ **0.06** (`FG_ML_HOME_EDGE_THRESHOLD`) | `mlbMultiMarketBacktest.ts:237-253`, threshold `:59` |
| fg_ml_away | `modelAwayWinPct`/100 | away won | tie ⇒ PUSH | edge ≥ **0.05** (`MIN_EDGE_THRESHOLD`) | `:257-273`, threshold `:49` |
| fg_rl_home (−1.5) | stored `modelHomePLCoverPct`/100, else **sigmoid fallback** σ((modelMargin−1.5)·0.4) | margin > 1.5 | margin == 1.5 (impossible w/ integers) | edge ≥ 0.05 | `:305-350` |
| fg_rl_away (+1.5) | 1 − home RL prob | margin < 1.5 | same | edge ≥ **0.18** (`FG_RL_AWAY_EDGE_THRESHOLD`) | `:352-371`, threshold `:67` |
| fg_over / fg_under | `mlToProb(modelOverOdds / modelUnderOdds)` | actualTotal vs `bookTotal` | actualTotal == line ⇒ PUSH | raw prob ≥ **0.65** (`CONFIDENCE_THRESHOLD`) | `:379-450`, threshold `:48` |
| f5_ml_home/away | `modelF5HomeWinPct`/`modelF5AwayWinPct` /100 | F5 leader after 5 | F5 tie ⇒ PUSH | edge ≥ 0.05 (both sides) | `:493-532` |
| f5_rl_home (−0.5) | `modelF5HomeRLCoverPct`/100 | f5Margin > 0 | impossible | edge ≥ 0.05 | `:534-565` |
| f5_rl_away (+0.5) | `modelF5AwayRLCoverPct`/100 | f5Margin ≤ 0 (tie counts as away cover) | impossible | edge ≥ 0.05 | `:536`, `:567-584` |
| f5_over / f5_under | `mlToProb(modelF5OverOdds/modelF5UnderOdds)` | f5Total vs `f5Total` line | f5Total == line ⇒ PUSH | raw prob ≥ **0.60** (`F5_CONFIDENCE_THRESHOLD`) | `:586-638`, threshold `:81` |
| nrfi | `mlToProb(modelNrfiOdds)`, fallback `modelPNrfi` raw (treated as 0–1) | `nrfiActualResult === "NRFI"` | none | raw prob ≥ **0.55** (`NRFI_CONFIDENCE_THRESHOLD`) | `:648-686`, threshold `:78` |
| yrfi | `mlToProb(modelYrfiOdds)`, fallback 1−pNrfi | `nrfiActualResult === "YRFI"` | none | raw prob ≥ 0.55 | `:688-704` |
| hr_prop (per batter) | `mlb_hr_props.modelPHr` | actualHr ≥ 1 | none | raw prob ≥ **0.65** (`CONFIDENCE_THRESHOLD`) — effectively never passes, see F10 | `:715-784` |
| k_prop | delegated to `kPropsBacktestService` | see below | — | — | `:1023-1034` |

Note (`mlbMultiMarketBacktest.ts:306`): `modelHomePLCoverPct/modelAwayPLCoverPct` are documented "NULL for all current games" — they sit in the **NHL-only** strip list (`server/routers.ts:99`) — so FG RL grading always uses the sigmoid fallback. VERIFIED both citations.

### K-props rule (`kPropsBacktestService.ts`)

- Outcome: `actualKs > bookLine ⇒ OVER`, `< ⇒ UNDER`, `== ⇒ PUSH` (`:218-225`).
- Model pick: `kProj >= bookLine ⇒ OVER else UNDER` (`:227-232`) — projection-vs-line, **not** the EV verdict column.
- `modelCorrect = (pick == outcome)` and `null` on PUSH (`:389-394`); `modelError = actualKs − kProj` (`:388`).
- Special statuses written to `backtestResult`: `NO_LINE` (`:340`), `NAME_MATCH_FAILED` (retryable, `:375`), plus OVER/UNDER/PUSH.

### HR-props rule (`mlbHrPropsBacktestService.ts:196-222`)

- `verdict === "OVER"` ⇒ WIN if actualHr ≥ 1 else LOSS; `modelCorrect = hitHr ? 1 : 0`.
- `verdict === "PASS"` (or unknown) ⇒ `backtestResult = NO_ACTION`, `modelCorrect = hitHr ? 0 : 1` ("right to pass").

### Dead audit-core rules (documented for contrast — `mlbBacktestAuditCore.ts`)

Grades: `WIN|LOSS|PUSH|VOID|QUARANTINED|UNGRADED` (`:43`). Preflight (`:603-655`): prob out of [0,1] ⇒ QUARANTINED; postponed/suspended ⇒ VOID; leakage (`modelRunAt >= gameStartUtcMs`) ⇒ QUARANTINED (`:409-439`); missing playerId on props ⇒ QUARANTINED. K-prop/HR-prop `didNotAppear` ⇒ VOID (`:980-982`, `:1023-1025`). EDT is hardcoded UTC−4 for game-start parsing (`:393-397`). `calcProfitLoss`: WIN pays odds, LOSS −1, PUSH/VOID 0 (`:277-285`). `calcCLV = modelProb − noVig(closingOdds, closingOddsOpposite)` (`:330-338`). None of this runs in production (see Overview §4).

### Drift detection — two independent live mechanisms

1. **Per-market accuracy z-score** (`mlbMultiMarketBacktest.ts:816-861`): rolling 7-day vs 30-day accuracy from `mlb_game_backtest` (rows with `correct` non-null, keyed on `backtestRunAt`); fires when both windows have ≥ **20** samples (`MIN_SAMPLE_FOR_DRIFT`, `:69`) and `|acc7 − acc30| / SE30 > 2.0` (`DRIFT_SIGMA_THRESHOLD`, `:68`). On drift: writes a row to `mlb_model_learning_log` (`triggerReason='drift_detected'`, `:843-861`) — **log-only; never triggers recalibration** (comment at `:28` claims "Recalibration trigger" but the code only logs).
2. **f5_share drift** (`mlbDriftDetector.ts:379-521`): rolling mean of `actualF5Total/actualFgTotal` over last **50** games (`WINDOW_SIZE`, `:65`; ordered by `outcomeIngestedAt` desc, `:318`), min **20** games (`MIN_SAMPLE`, `:68`), vs baseline **0.5618** (`BASELINE_F5_SHARE`, `:59`); drift when |delta| > **0.02** (`DRIFT_THRESHOLD`, `:62`); recal cooldown **24 h** (`RECAL_COOLDOWN_HOURS`, `:71`, checked against latest `mlb_model_learning_log` row with reason DRIFT_DETECTED/SCHEDULED/MANUAL, `:354-366`). Every check upserts `mlb_drift_state` (market='F5_SHARE', `:139-201`).

### Recalibration pipeline (`mlbDriftDetector.ts:570-825`)

`triggerRecalibration(reason)` → spawns `python3 server/scripts/runMlbBacktest2.py` (candidate path resolution `:98-104`; script VERIFIED at `server/scripts/runMlbBacktest2.py`, DB-driven via `DATABASE_URL`, writes JSON to `$MLB_CALIBRATION_PATH` defaulting to `os.tmpdir()/mlb_calibration_constants.json`, `:126-127`) → reads JSON `overall` keys → **regex-patches `EMPIRICAL_PRIORS` inside `server/MLBAIModel.py` in place** (`migrateCalibrationConstants`, `:729-825`; patches f5_share, nrfi_rate, fg_mean, i1_share, fg_home_win_rate+fg_away_win_rate, f5_push_rate, fg_rl_away_cover+fg_rl_home_cover; backup to `MLBAIModel.py.bak`, `:749-751`) → logs completion to `mlb_model_learning_log` (`:628-651`). It does **not** write `mlb_calibration_constants`.

### Calibration constants — DB vs code consumer map

Production DB values from `docs/audits/mlb-model-audit-2026/census/calibration-constants.tsv` (VERIFIED read; 54 rows). Consumer status:

| paramName (DB currentValue) | Live consumer? | Code value actually used | Match? |
|---|---|---|---|
| `f5_share` 0.5595 (baseline 0.5618) | **No DB read.** Model prior hardcoded | `MLBAIModel.py:389` `"f5_share": 0.5595`; drift baseline `mlbDriftDetector.ts:59` = 0.5618 | value matches code prior; drift detector uses the 3-yr baseline (0.5618), not the live prior |
| `nrfi_rate` 0.51056338 | No DB read | `MLBAIModel.py:387` `"nrfi_rate": 0.5093` (validation gate `:1182-1184`, ±0.12) | **MISMATCH** (DB 0.5106 vs code 0.5093) |
| `fg_ml_home_edge` 0.01781473 | No DB read | `MLBAIModel.py:1617` `FG_ML_HOME_EDGE = 0.03` (comment cites the DB param, `:1616`) | **MISMATCH** (0.0178 vs 0.03) |
| `k_calibration_factor` 0.776 (prev 0.739) | No DB read | `mlbKPropsModelService.ts:88-89` `K_CALIBRATION_FACTOR_OVER = 0.870`, `_UNDER = 0.810` (applied to lambda at `:467-468`) | **MISMATCH** (DB single 0.776 vs code split 0.870/0.810) |
| `hr_base_rate` 0.1009 | No DB read | HR model uses `HR_CALIBRATION_FACTOR = 0.5317` (`mlbHrPropsModelService.ts:97`) — the DB row records the empirical rate, not a code constant | informational only |
| `f5_under_bias` −0.109 (EMPIRICAL, n=108) | **No consumer anywhere** (grep: only seeded at `mlbDriftDetector.ts:219`) | — | orphan |
| 12× `bias_correction_*` | **No consumer** in server/ or client/ (grep) — written by `scripts/recompute_calibration.mjs:127-135` and applied once to May-23 projections by `scripts/recalibrate_and_model_may23.mjs` | — | orphans (historical record only) |
| 13× `brier_*`, 12× `ece_*`, 12× `log_loss_*` (updateSource `backtest_2026_recalibration_v2`) | No consumer — metric snapshots from `scripts/recompute_calibration.mjs` | — | orphans |

INFERRED conclusion: the entire `mlb_calibration_constants` table is an audit trail, not a control plane. **Every published probability derives from hard-coded literals**, several of which have drifted from the DB's "current" values.

### Other live grading-adjacent constants

| Name | Value | Location |
|---|---|---|
| `RL_SIGMOID_K` | 0.4 (Brier 0.2366, n=554 grid search) | `mlbMultiMarketBacktest.ts:310` |
| `CALIBRATION_VERSION` tag | `"2026-04-14-3yr-v2"` | `:83` |
| Cycle cadence | 5 min (`MLB_INTERVAL_MS`) | `vsinAutoRefresh.ts:1361` |
| Nightly pipeline | 00:30 PST; monthly recal 1st 03:00 PST; 60 s tick | `mlbOutcomeAndDriftScheduler.ts:207-244`, `:270-274` |
| `OPTIMAL_EDGE_THRESHOLDS` (report filter, per market) | fg_ml_home .06, fg_ml_away .08, fg_rl_home .10, fg_rl_away .06, fg_over .08, fg_under .06, f5_ml_home .12, f5_ml_away .12, f5_rl_home .06, f5_rl_away .08, f5_over .08, f5_under .06, nrfi .05, yrfi .05, k_prop .04, hr_prop .06 | `mlbFullBacktestEngine.ts:76-93` |
| Report ROI payout | 0.909 (−110); hr_prop breakeven 0.476 (+110) | `:201`, `:72` |
| Report "above target" | accuracy ≥ 0.70 at ≥ minSample | `:315-317` |
| Walk-forward defaults (dead) | train 90 d / val 30 d / test 30 d / refit 14 d / min 20 per fold; fold PASS = acc ≥ 0.70 ∧ roi > 0; overall PASS = ≥ 70 % folds pass | `mlbWalkForwardValidator.ts:52-58`, `:337-340`, `:420-423` |
| Calibration-audit gates (dead) | 10 buckets, min 10/bucket, ECE < 0.05, |bias| < 0.03, Brier < 0.25 | `mlbCalibrationAudit.ts:90-94` |
| Segmentation min sample (dead) | 15 | `mlbSegmentationEngine.ts:83` |
| Brier push handling | push ⇒ Brier null; ML tie ⇒ null; F5 tie ⇒ null for F5-ML Brier | `mlbOutcomeIngestor.ts:200-248` |
| Recompute-calibration script | season 2026-03-25→05-22, min 30/market, 10 ECE bins, uses `leakageSafe=1 OR NULL` rows | `scripts/recompute_calibration.mjs:20-25` |
| May-23 recal script | `RECAL_VERSION='v2026-recal-1.0'`, min 30, apply bias only if |bias| > 0.005 | `scripts/recalibrate_and_model_may23.mjs:30-33` |

### CLV

`clv` is defined as `modelProb − closingNoVigProb` (`mlbBacktestAuditCore.ts:330-338`) but **no live code computes it**: the live writer never touches the column (`mlbMultiMarketBacktest.ts:885-935` writes neither `clv` nor `closingOdds`), and the only script that writes those columns writes literal `null` for every row (`scripts/run_full_season_backtest.mjs:454-457`, `:528-531`, `:610-614`). INFERRED: `mlb_game_backtest.clv`, `closingOdds`, `closingOddsOpposite` are entirely NULL in production (needs census confirmation).

### leakageSafe / voidReason / quarantineReason / auditVersion semantics

Written **only** by `scripts/run_full_season_backtest.mjs` (one-off, `auditVersion='v2026-full-audit-1.0'`, season 2026-03-25→2026-05-22, `:43`):
- `leakageSafe` = 1 if `modelRunAt < gameStartUtcMs`, 0 if leaked, NULL if `modelRunAt` NULL (`:26`, `:432`).
- `result='VOID'` + `voidReason='gameStatus=postponed|suspended'` (`:459`).
- `result='QUARANTINED'` + `quarantineReason` for leaked rows / missing modelProb / missing bookOdds / unknown market — note it also stamps `quarantineReason='actual score missing'` on `MISSING_DATA` rows (`:587`).
- Script edge threshold 0.0 — records **all** bets and lets the analyst filter (`:30-33`); `confidencePassed = edge > 0` (`:578`), a different definition from the live writer's gate.
The live writer leaves `leakageSafe` at its schema default **1** (`drizzle/schema.ts` mlbGameBacktest `leakageSafe ... .default(1)`) and never sets `modelRunAt`/`gameStartUtcMs` — so post-May-22 rows claim leakage-safety that was never checked (see F8).

### Walk-forward validation — what it actually does

`runWalkForwardForMarket` (dead code) slices **already-graded** `mlb_game_backtest` rows into time-ordered train/val/test windows and reports accuracy/ROI/Brier/log-loss/Wilson CI per fold (`mlbWalkForwardValidator.ts:293-459`). No model is refit anywhere — "training window" stats are descriptive only. Leakage check = count of rows with `result='QUARANTINED'` in the test window (`:333-335`).

---

## Projection → DB write path

### `mlb_game_backtest` (live writer: `writeBacktestResults`, `mlbMultiMarketBacktest.ts:867-945`)

- **Keying**: INSERT first; on any insert error, UPDATE by `(gameId, market, modelSide.slice(0,8))` (`:929-935`). Schema has `uniqueIndex uq_backtest_game_market ON (gameId, market)` (`drizzle/schema.ts` mlbGameBacktest table config; census TSV shows `gameId` MUL consistent with a composite unique). One row per (game, market).
- **Columns written**: gameId, gameDate, market, `modelSide` truncated to **8 chars** (`:889`), modelProb (0–1, `.toFixed(4)` but column is `decimal(5,2)` ⇒ stored at 2 dp — schema comment "(0-100)" at `drizzle/schema.ts:1530` is wrong for the live writer), bookLine, bookOdds, bookNoVigProb, edge, ev, confidencePassed, result, correct, actualAway/HomeScore, away/homePitcher, backtestRunAt. Never: modelRunAt, gameStartUtcMs, leakageSafe, clv, closing*, profitLoss, voidReason, quarantineReason, auditVersion.
- **HR-prop collision** (INFERRED from the unique index + write logic): every batter in a game shares `(gameId, 'hr_prop')`; the first batter INSERTs, every later batter's INSERT violates the unique index and falls to the UPDATE keyed on the truncated player name, which matches 0 rows ⇒ silently dropped (counted as "written", `:936`). Only ~1 HR-prop row per game can exist. Census check needed.
- Historical bulk rows: `scripts/run_full_season_backtest.mjs` upsert `ON DUPLICATE KEY UPDATE` over 33 columns (`:626-646`), `modelSide = market` string (not side).

### `games` (two writers)

- `mlbScoreRefresh.ts:669-679`: actual FG/F5 scores + `nrfiActualResult` on every 5-min cycle.
- `mlbOutcomeIngestor.ts:609-622`: `actualFgTotal/actualF5Total/actualNrfiBinary` + `brierFgTotal/brierF5Total/brierNrfi/brierFgMl/brierF5Ml` + `outcomeIngestedAt`, keyed `games.id`, idempotent via `outcomeIngestedAt IS NULL` unless force (`:488`).

### `mlb_strikeout_props`

`kPropsBacktestService.ts:400-411`: `actualKs, backtestResult, modelError (3 dp), modelCorrect, backtestRunAt` keyed by row `id`; re-scans rows with `backtestResult IS NULL | 'PENDING' | 'NAME_MATCH_FAILED'` for the date (`:260-269`).

### `mlb_hr_props`

`mlbHrPropsBacktestService.ts:225-233`: `actualHr, backtestResult, modelCorrect, backtestRunAt` keyed by row `id`; scans `actualHr IS NULL` for final games (`:122-147`).

### `mlb_drift_state` / `mlb_model_learning_log` / `mlb_calibration_constants`

- `mlb_drift_state`: single row per market ('F5_SHARE' only in live code), upserted every drift check (`mlbDriftDetector.ts:139-201`) with rollingValue/baseline/delta/direction/driftDetected/sampleSize/lastCheckedAt/lastRecalibrationAt/consecutiveDriftCount.
- `mlb_model_learning_log`: rows from (a) per-market drift flags (`mlbMultiMarketBacktest.ts:843-861`), (b) f5_share drift events (`mlbDriftDetector.ts:525-557`), (c) recalibration completions (`:628-651`).
- `mlb_calibration_constants`: seeded once (`mlbDriftDetector.ts:210-244` — note `seedCalibrationConstants` has **no caller** either; VERIFIED grep) and mutated by the two one-off scripts above. DB updateSource values (`AUTO_RECAL_v2026-recal-1.0`, `backtest_2026_recalibration_v2`, `LIVE_2026_N561`, `EMPIRICAL`, `LIVE_2026_N693_BIAS_CORRECTED`) map to those scripts; `LIVE_*`/`EMPIRICAL` sources have no surviving writer in the repo (UNKNOWN which deleted script wrote them).

---

## Exposure (API + UI)

tRPC (all in `server/routers.ts` unless noted):

| Procedure | Auth | Backs |
|---|---|---|
| `mlbBacktest.runForGame` / `runForDate` | owner | `runMultiMarketBacktest(ForDate)` (`routers.ts:1440-1458`) |
| `mlbBacktest.getRollingAccuracy` | protected | `getMultiMarketRollingAccuracy` (`:1463-1468`) — **broken, see F1** |
| `mlbBacktest.getDriftLog` | protected | last 200 `mlb_model_learning_log` rows (`:1473-1489`) |
| `mlbBacktest.runHistoricalBacktest` | owner | `runHistoricalBacktestRange` (`:1503-1511`) |
| `mlbBacktest.getFullReport` / `getDailyTimeSeries` / `getEdgeBuckets` / `getKPropsReport` / `getHrPropsReport` | protected | `mlbFullBacktestEngine.ts` reports (`:1516-1567`) |
| `strikeoutProps.getCalibrationMetrics` / `getDailyBacktest` / `getRichDailyBacktest` / `getLast7DaysBacktest` | owner | `kPropsBacktestService` reads (`:1184-1224`) |
| `mlbSchedule.triggerOutcomeIngestion` | owner | `ingestMlbOutcomes` (`routers/mlbSchedule.ts:381-400`) |
| `mlbSchedule.checkDrift` | owner | `checkF5ShareDrift` (`:409-427`) |
| `mlbSchedule.getBrierTrend` | owner | rolling Brier chart over `games.brier*` (`:443-562`) |
| `mlbSchedule.triggerRecalibration` | owner | `triggerRecalibration` (`:572-590`) |

UI: `/admin/backtest` → `client/src/pages/MlbBacktest.tsx` (full report, time series, edge buckets, K/HR reports — `MlbBacktest.tsx:111-127`); `/admin/model-results` → `TheModelResults.tsx` (rolling accuracy panel `:740`, drift banner via `mlbSchedule.checkDrift` `:1036`, `:1317-1323`); routes at `client/src/App.tsx:315-351`. All admin-only; no public surface exposes grading directly (public feed strips grading columns, `routers.ts:104-148`).

---

## Scheduling & triggers

- **MLB cycle (`runMlbCycleOnce`)** — the only live trigger for `mlb_game_backtest` and the prop backtests. In-process: fired at startup and every 5 min (`vsinAutoRefresh.ts:2096-2101`, `MLB_INTERVAL_MS = 5*60*1000` at `:1361`), started from `startVsinAutoRefresh()` at boot (`server/_core/index.ts:846`). Inside a cycle: K-props backtest every cycle (`:1934`), HR actuals every cycle (`:1937-1944`), multi-market backtest **only when ≥ 1 game transitioned to FINAL this cycle** (`newlyFinalGamePks`, `:1952-1994`; `runMultiMarketBacktest(g.id, false)` at `:1970`).
- **HTTP cron replacement**: `POST /api/cron/mlb-cycle` (CRON_SECRET auth, run-locked) → `runMlbCycleOnce()` (`server/cron/cronRoutes.ts:49-51`, `:83`), fired by `.github/workflows/cron-mlb-cycle.yml` every 5 min (`cron: "*/5 * * * *"`, `:36`) — but the workflow header orders it **disabled in the Actions UI until the Manus host is retired** (`cron-mlb-cycle.yml:4-11`). Whether it is currently enabled: UNKNOWN.
- **Kill switch**: all in-process schedulers (including `startBetAutoGradeScheduler` and `startMlbOutcomeAndDriftScheduler`, `server/_core/index.ts:869-873`) are inside the `isBackgroundJobsDisabled()` guard (`:840-926`; env `DISABLE_BACKGROUND_JOBS` = "1"/"true", `:132-135`). `server/cron/cronRoutes.ts:46-48` states the flag **is set on Railway** ("with DISABLE_BACKGROUND_JOBS set on Railway that interval never runs, so this endpoint is the only trigger"), and `references/railway-deploy.md:98-107` mandates it for web-only replicas while requiring exactly one job-running process. Actual production env value: UNKNOWN (census question).
- **Nightly outcome/drift pipeline**: `startMlbOutcomeAndDriftScheduler()` 60-second tick; nightly at 00:30 PST ingests **yesterday** then runs `checkF5ShareDrift(true)` (`mlbOutcomeAndDriftScheduler.ts:97-165`, `:230-244`); monthly recal 1st @ 03:00 PST (`:213-228`). **Critical**: there is **no `/api/cron/*` endpoint or GitHub workflow** covering outcome ingestion, drift, or recalibration (VERIFIED: `cronRoutes.ts` registers only vsin-odds, scores, mlb-cycle, mlb-asg, status, `:80-119`). If `DISABLE_BACKGROUND_JOBS=1` in production, nightly Brier/outcome/drift/monthly-recal **never run** (F3). Note `ingestMlbOutcomes` also runs its own internal drift check with `triggerRecal` defaulting true (`mlbOutcomeIngestor.ts:700`, default at `mlbDriftDetector.ts:379`), so the scheduler's Step 2 is a duplicate check (24 h cooldown prevents double recal).
- **Manual**: owner tRPC procedures listed above.

---

## Patch history relevant to this section

| Script | What it changed | In live path now? |
|---|---|---|
| `server/patchRlSigmoid.py` | Patched `mlbMultiMarketBacktest.ts` to add the FG-RL sigmoid fallback (k=0.4) when `modelHomePLCoverPct` is NULL (`patchRlSigmoid.py:1-12`) | **Yes** — the fallback is in the live file (`mlbMultiMarketBacktest.ts:305-325`). VERIFIED |
| `server/auditFgRlHomeSigmoid.mjs` | Diagnostic grid-search that produced k=0.4 (fg_rl_home was 26.7 % ACC; `auditFgRlHomeSigmoid.mjs:1-20`) | Produced the constant above |
| `server/recalibrateHrProps.mjs` | Recomputed `HR_CALIBRATION_FACTOR` and edited `mlbHrPropsModelService.ts` (`recalibrateHrProps.mjs:1-21`) | **Yes** — live value 0.5317 + `MIN_ABSOLUTE_P_HR` 0.18 (`mlbHrPropsModelService.ts:77`, `:97`) |
| `scripts/run_full_season_backtest.mjs` | Bulk-graded 2026-03-25→05-22 into `mlb_game_backtest` with leakage/void/quarantine/auditVersion (`v2026-full-audit-1.0`) | Historical rows only; live writer uses different logic/columns |
| `scripts/recompute_calibration.mjs` | Wrote `bias_correction_*`, `brier_*`, `ece_*`, `log_loss_*` constants (updateSource `backtest_2026_recalibration_v2`) | Rows exist in DB; **no consumer** |
| `scripts/recalibrate_and_model_may23.mjs` | Wrote `AUTO_RECAL_v2026-recal-1.0` constants and applied bias corrections directly to May-23 game projections | One-day effect; corrections not in ongoing model |
| `server/runFullHistoricalBacktest.mjs`, `forceRerunJune17/18/19.ts`, `forceRerunMay11.mjs`, `backfillHrFactor.mjs`, etc. | One-off reruns/backfills (headers VERIFIED for runFullHistoricalBacktest) | Historical data effects only |

---

## Open questions (UNKNOWN — census items for next phase)

1. **Is `DISABLE_BACKGROUND_JOBS` set on the production Railway service?** Determines whether the nightly outcome ingestion, drift detection, monthly recalibration, and bet auto-grading run at all. Code comments assert it is set (`cronRoutes.ts:46-48`); the runbook allows one job-running replica (`references/railway-deploy.md:98-107`). Check: Railway variables; `games.outcomeIngestedAt` recency; `mlb_drift_state.lastCheckedAt`; `mlb_model_learning_log.runAt` recency.
2. **Is `.github/workflows/cron-mlb-cycle.yml` enabled in the Actions UI?** (Header says keep disabled until Manus retired; CLAUDE.md says Manus "is being retired".) If neither the in-process interval nor the workflow fires, nothing grades games at all.
3. **Has `triggerRecalibration` ever succeeded in production?** INFERRED unlikely: `runMlbBacktest2.py` imports `mysql.connector` (`server/scripts/runMlbBacktest2.py:124`) but the Docker image installs only `python3-numpy/pandas/scipy/requests` (`Dockerfile:14-19`; no pip) ⇒ ModuleNotFoundError. Check `mlb_model_learning_log` for `triggerReason IN ('SCHEDULED','DRIFT_DETECTED')` completion rows.
4. **Does the running container's `MLBAIModel.py` differ from git?** In-place patching (`mlbDriftDetector.ts:814`) is ephemeral on Railway and reverted by every deploy; if recal ever succeeded, live priors silently diverge from the repo until the next deploy.
5. **`mlb_game_backtest` data hygiene**: any rows with `market` uppercase? `clv`/`closingOdds` non-NULL anywhere? actual duplicate `(gameId, market)` rows predating the unique index? how many `hr_prop` rows per game (F7)? distribution of `modelSide` truncations?
6. **Scale of stored probabilities**: `modelProb` rows written by older/deleted scripts — 0–1 or 0–100? (Walk-forward Brier at `mlbWalkForwardValidator.ts:273-276` would be garbage on 0–100 rows.)
7. **Who wrote `games.fgMlResult...nrfiCorrect` and when did that writer die?** Are `/admin/model-results` panels reading these columns showing stale (pre-deletion) data?
8. **`games.brierNrfi` values in DB** — confirm the /100 bug (F5) empirically: values should cluster ≈ 0 or ≈ 0.98.
9. **Are the 8 Manus-era `/api/scheduled/*` workflows really disabled** (double-write risk called out in `references/railway-deploy.md:108-112`)?

---

## Finding candidates

| ID | Sev | Title | Evidence |
|---|---|---|---|
| F1 | P1 | `getMultiMarketRollingAccuracy` queries market keys in UPPERCASE constant names — rolling accuracy API always returns 0 samples for every market | `mlbMultiMarketBacktest.ts:1144` uses `Object.keys(MARKETS)` (yields `"FG_ML_HOME"`, …) where DB stores values `"fg_ml_home"` (`:86-103`); consumed by `routers.ts:1466-1467` and rendered at `TheModelResults.tsx:740-751`. VERIFIED |
| F2 | P1 | `mlb_calibration_constants` is a write-only audit table; live model constants are hard-coded and have drifted from DB "current" values (fg_ml_home_edge 0.03 vs 0.0178; nrfi_rate 0.5093 vs 0.5106; k_calibration_factor 0.870/0.810 vs 0.776) | Grep: no runtime SELECT (only seed `mlbDriftDetector.ts:210-244` — itself uncalled — and one-off scripts); `MLBAIModel.py:1617`, `:387`; `mlbKPropsModelService.ts:88-89`; census TSV rows 40, 42, 55. VERIFIED code / VERIFIED TSV |
| F3 | P1 | Nightly outcome ingestion, Brier writes, drift detection and monthly recalibration have no production trigger if `DISABLE_BACKGROUND_JOBS=1` (which repo comments say is set on Railway) — no cron endpoint/workflow covers them | Guard `server/_core/index.ts:840-873`; cron scope `cronRoutes.ts:80-119`; flag asserted set at `cronRoutes.ts:46-48`; runbook `references/railway-deploy.md:98-107`. VERIFIED code, env value UNKNOWN |
| F4 | P1 | Auto-recalibration cannot work end-to-end in production: `runMlbBacktest2.py` needs `mysql.connector` which the Docker image never installs, and a "successful" recal only patches `MLBAIModel.py` on the ephemeral container filesystem (reverted at next deploy, never committed) | `server/scripts/runMlbBacktest2.py:124`; `Dockerfile:14-19` (no pip); `mlbDriftDetector.ts:729-825`. INFERRED from verified facts |
| F5 | P1 | `games.brierNrfi` is computed with a /100 rescale of `modelPNrfi`, which is stored 0–1 — NRFI Brier scores (owner Brier-trend chart) are systematically wrong | writer 0–1: `mlbModelRunner.ts:2507`; ingestor divides by 100: `mlbOutcomeIngestor.ts:156-167` + `:224-227`; consumed by `mlbSchedule.getBrierTrend` (`routers/mlbSchedule.ts:443-562`). VERIFIED code path; DB values UNKNOWN |
| F6 | P2 | Live grader writes no leakage metadata: `leakageSafe` defaults to 1 and `modelRunAt`/`gameStartUtcMs` are never populated, so every post-May-22 row claims pre-game safety unverified — and `recompute_calibration.mjs` trusts exactly that filter | schema default (`drizzle/schema.ts` mlbGameBacktest `leakageSafe .default(1)`); write set `mlbMultiMarketBacktest.ts:885-904`; filter `scripts/recompute_calibration.mjs:14-15`. VERIFIED |
| F7 | P2 | Unique index `(gameId, market)` collides with per-player `hr_prop` rows: after the first batter, inserts fail and the fallback UPDATE (keyed on 8-char-truncated player name) matches 0 rows — HR-prop results silently dropped from `mlb_game_backtest` | index in `drizzle/schema.ts` (uq_backtest_game_market); write path `mlbMultiMarketBacktest.ts:885-941`; truncation `:889`, `:933`. VERIFIED schema+code, DB row counts UNKNOWN |
| F8 | P2 | CLV is advertised (column, math, spec) but never computed: every writer writes NULL closing odds/CLV; the only implementation (`calcCLV`) lives in dead code | `mlbBacktestAuditCore.ts:330-338` (unused in prod); `run_full_season_backtest.mjs:454-457`; live writer omits columns (`mlbMultiMarketBacktest.ts:885-904`). VERIFIED |
| F9 | P2 | K-prop grading substitutes the actual starter when the projected pitcher is scratched instead of voiding — contradicts sportsbook rules and the (dead) audit core's `PITCHER_DID_NOT_APPEAR ⇒ VOID`, contaminating K-prop accuracy/MAE | `kPropsBacktestService.ts:349-367` vs `mlbBacktestAuditCore.ts:980-982`. VERIFIED |
| F10 | P2 | HR props in the multi-market grader use the 0.65 raw-probability gate while calibrated `modelPHr` maxes ≈ 0.22 — every HR prop is NO_ACTION in `mlb_game_backtest`; separately, its no-vig mixes consensus over odds with FanDuel under odds | `mlbMultiMarketBacktest.ts:711-713`, `:767`; factor scale `mlbHrPropsModelService.ts:73-77`, `:97`; mixed books `mlbMultiMarketBacktest.ts:732-736`. VERIFIED |
| F11 | P2 | The entire audit-grade stack (leakage guard, VOID/QUARANTINE, walk-forward, calibration audit, segmentation, publication gate) is dead code — tests pass against machinery production never runs | importers: `mlbBacktestAudit.test.ts:43-89` only (plus intra-family imports). VERIFIED |
| F12 | P2 | `games` grading columns (`fgMlResult`…`nrfiCorrect`) have no writer in the codebase yet are read by admin Model Results pages — panels are frozen at whatever the deleted writer last wrote | grep results; readers `routers/mlbSchedule.ts:719-1080`, strip list `routers.ts:121-138`. VERIFIED absence of writer |
| F13 | P3 | Per-market drift detection only logs to `mlb_model_learning_log` — header comment claims it triggers recalibration but no recal call exists in that path | `mlbMultiMarketBacktest.ts:24-28` vs `:843-861`. VERIFIED |
| F14 | P3 | `mlbFeedbackLoop.test.ts` tests local re-implementations (its own `computeBrierScore`, drift logic), never importing production modules — green tests prove nothing about the live loop | `mlbFeedbackLoop.test.ts:11-26`. VERIFIED |
| F15 | P3 | `modelProb` stored at `decimal(5,2)` truncates 4-dp probabilities to 2 dp; downstream ECE/Brier/edge-bucket analyses run on coarsened values; schema comment also mislabels scale as 0–100 | `drizzle/schema.ts` (mlbGameBacktest modelProb + comment); writer `mlbMultiMarketBacktest.ts:890`. VERIFIED |
| F16 | P3 | Drift baseline is the 3-yr 0.5618 while the model's live prior is 0.5595 — a rolling share sitting exactly on the model's own prior still shows 0.0023 of "drift" toward the 0.02 alarm | `mlbDriftDetector.ts:59` vs `MLBAIModel.py:389`. VERIFIED |

---

*Prepared for the 2026 MLB model forensic audit, phase 0. All citations refer to repo state at commit c9b5b903 (clean working tree).*
