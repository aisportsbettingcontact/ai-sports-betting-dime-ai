# Fullgame GRADER — Grading-Integrity Proof (5x5 granular backtest)

Role: GRADER, market group FULLGAME. Re-derive every full-game grade from raw actuals for the
entire population; zero-mismatch or enumerate. Run date 2026-07-25 (UTC).

Population: **all 1,556 final 2026 regular-season `games` rows, 2026-03-25..2026-07-24**
(1,555 with `mlbGamePk`; the All-Star exhibition AL@NL 7/14 id 4110001 is the pk-less game).
Every number below comes from an executed script:

- `granular/tools/fullgame-grader-audit.mjs` — full-population DB re-derivation + diff
  (invocation: `node docs/audits/mlb-model-audit-2026/granular/tools/fullgame-grader-audit.mjs`)
- `granular/tools/fullgame-grader-statsapi-sample.py` — external StatsAPI ground-truth sample
  (invocation: `venv/bin/python .../fullgame-grader-statsapi-sample.py`)

Canonical rules re-stated before running (production forward path `server/mlbOutcomeIngestor.ts`
+ B6/B6b regrade vocabulary): FG ML pick = away iff `modelAwayWinPct`/100 > 0.5, WIN iff pick won;
FG RL pick from (`modelAwayScore`−`modelHomeScore`)+`awayRunLine` vs actual margin, exact actual
cover = PUSH/null; FG TOTAL `fgTotalResult` = actual side OVER/UNDER/PUSH vs `bookTotal`,
`fgTotalCorrect` = (modelOverRate>50 pick == actual side); `brierFgMl` = (p−outcome)² 6dp
(away-base per B6; home-base also computed and accepted); `brierFgTotal` = (modelOverRate/100 −
wentOver)² 6dp, null on push. All margin/total comparisons in exact integer cents.

## 1. Games-table grades: re-derivation vs stored (n = 1,556)

| Field | Match | Value mismatch | Both null | Stored-null-derivable | Stored-not-derivable |
|---|---|---|---|---|---|
| fgMlResult (+Correct) | **1,537** | **0** | 19 | 0 | 0 |
| fgRlResult (+Correct) | **1,534** | **0** | 19 | 0 | 3 |
| fgTotalResult (+Correct) | **1,537** | **0** | 13 | 6 | 0 |
| brierFgMl | **1,537** | **0** | 19 | 0 | 0 |
| brierFgTotal | **1,476** | **0** | 80 | 0 | 0 |

**Zero value mismatches on all eight audited columns.** Every stored WIN/LOSS/PUSH/OVER/UNDER,
every correct-flag, and every Brier reproduces exactly (Brier tolerance 1.5e-6 = storage
precision). All 1,537 stored `brierFgMl` values match the **away-base** formula
(pAway/100 − awayWin)², i.e. B6's regrade semantics; with stored pcts summing to 100 this is
numerically identical to the forward path's home-base formula (both matched on every row where
both were computable). brierFgTotal both-null = 61 total pushes + 19 ungraded games = 80 ✓.

Non-mismatch residue, fully enumerated in `fullgame-grader-games-mismatches.csv` (12 rows):

1. **fgRl stored-not-derivable ×3** (games 2250033 CWS@MIL 3/28, 2250109 LAD@WSH 4/4,
   2252625 CWS@ARI 4/21): the model margin lands **exactly on the run line** (e.g. 4.25−5.75 =
   −1.50 vs +1.5). B6's documented tie-break (modelCover>0 → AWAY else HOME) grades these as a
   HOME pick — and all 3 stored WIN/LOSS values are correct under that rule (re-verified by
   hand) — but the production forward path (`gradeRunLinePick`) returns null/null ("no pick") on
   the same input. Semantics divergence on a boundary case, 3/1,537 games (0.2%): if the live
   ingestor ever force-re-runs these games, the grades flip to null.
2. **fgTotal stored-null-derivable ×6** (2250006, 2250331, 2250332, 2250374, 2250468, 2250494):
   games with **no model probabilities** (never modeled). B6 graded totals only when
   `modelOverRate` exists; the schema-documented domain (result = actual market side) is
   derivable from actuals+bookTotal alone (one of these, NYY@SF 3/25, is an actual PUSH at 7).
   Cosmetic coverage gap; `fgTotalCorrect` correctly stays null either way.

The 19 ungraded games (all fg columns null): all have `modelAwayWinPct` null (model never ran) —
12 with no book lines at all (the 5/6-5/7 outage cluster + TOR@CWS 4/3), 7 with book lines only.
None is gradeable for ML/RL under the stated rules. Enumerated in section 1 output of
`fullgame-grader-games-rederivation.csv` (filter `stored_fgMlResult` empty).

Note: the **All-Star exhibition is graded** in the games table (WIN/WIN/UNDER + briers, all
internally correct vs its 4-0 actual) although the audit universe exempts it (EX-ALLSTAR) and it
has no ledger rows. Consumers aggregating `games.fg*` over finals will include it.

## 2. Raw-actuals integrity (grades are only as good as actuals)

Three-source cross-check over all 1,556 (script section "actuals"):

- `games.actualAwayScore/actualHomeScore` vs **mlb_replay_linescores** (StatsAPI substrate):
  **1,555/1,555 agree, 0 disagree** (1 missing = All-Star, which has no pk row).
- vs **mlb_schedule_history** (census `game-universe.csv` linkage): 1,540 agree, 5 disagree,
  11 unmatched. Of the 5 disagreements (`fullgame-grader-actuals-crosscheck-issues.csv`):
  - **4 are census-linkage errors, not data errors**: doubleheader G2 rows (STL@CIN 5/23 G2,
    CHC@NYM 6/24 G2, MIL@STL 7/7 G2, MIL@PIT 7/11 G2) are mapped in `census/game-universe.csv`
    to the **G1 twin's anGameId** (the census was built pre-B3 when those games rows held the
    twin's score). Direct schedule queries show both twins present with correct scores.
  - **1 is a real residual schedule defect**: BOS@BAL — `mlb_schedule_history` holds **17-1 on
    both** the 4/25 row (anGameId 287485, B3-corrected) **and the 4/26 row (anGameId 287441)**;
    the true 4/26 result is 5-3 (StatsAPI pk 824852, verified live). Grading is unaffected
    (games.actual* = 5-3 is correct); schedule-based consumers would mis-read 4/26.
- `games.awayScore/homeScore` (live scoreboard columns) disagree with actuals on 9 games
  (8 frozen mid-game on the 2026-05-05 outage slate + SF@ATL 6/16, a B2 postponed→final fix).
  These columns are not grading inputs; hygiene only.
- `games.actualFgTotal` = actualAway+actualHome on **all** rows (0 disagreements).

**External ground truth**: 36-game StatsAPI sample (30 seeded-random + the 5 disputed + the 3rd
corrected game) — **36/36 exact matches**, 0 mismatches
(`fullgame-grader-statsapi-sample.csv`).

## 3. mlb_game_backtest fg_* ledger: re-derivation (n = 9,330 rows)

All fg_* rows joined to the population: 9,330 rows = 1,555 games × 6 markets, **zero duplicate
(gameId, market) pairs** (unique key `uq_backtest_game_market` holds). The only population game
without ledger rows is the All-Star exhibition (exempt) —
`fullgame-grader-backtest-uncovered-games.csv`.

Stored result counts (reconciled; WIN+LOSS+PUSH = "actioned" = 2,288):

| market | WIN | LOSS | PUSH | NO_ACTION | MISSING_DATA | QUARANTINED | VOID |
|---|---|---|---|---|---|---|---|
| fg_ml_home | 319 | 319 | 0 | 543 | 32 | 338 | 4 |
| fg_ml_away | 232 | 248 | 0 | 701 | 32 | 338 | 4 |
| fg_rl_home | 61 | 127 | 0 | 1,023 | 2 | 338 | 4 |
| fg_rl_away | 47 | 23 | 0 | 1,141 | 2 | 338 | 4 |
| fg_over | 201 | 211 | 17 | 753 | 31 | 338 | 4 |
| fg_under | 235 | 228 | 20 | 699 | 31 | 338 | 4 |
| total | 1,095 | 1,156 | 37 | 4,860 | 130 | 2,028 | 24 |

**Result integrity: all 2,288 actioned rows re-derive to the identical WIN/LOSS/PUSH from
games actuals (0 mismatches), and every correct-flag matches (WIN→1, LOSS→0, PUSH→null).**
No unknown result values; every QUARANTINED row carries a modelRunAt≥gameStartUtc reason
(338 games × 6 rows, the P-001 provenance quarantine); every VOID row carries a voidReason.
Backtest-row-embedded actual scores agree with games actuals on every row where both exist
(**0 stale-actual rows** — the B3 score corrections propagated).

The ledger holds three writer regimes (aggregate consumers must know this):
`v2026-full-audit-1.0` 4,602 rows / `audit-backfill-20260725` 3,930 / legacy live 798.

Explained non-defect classes (all rows in `fullgame-grader-backtest-mismatches.csv`, 857 rows):

- **857 "actioned-with-confidencePassed=0" rows** — all from the `v2026-full-audit-1.0` writer
  (`scripts/run_full_season_backtest.mjs`, season window 3/25-5/22), whose documented semantics
  differ from the live engine: it grades every row WIN/LOSS/PUSH regardless of confidence and
  stores `confidencePassed = edge>0`. Re-checked against that writer's own rule: **0 violations**
  (2 rows show conf=1 with stored edge 0.0000 — true edge positive below 4dp storage precision,
  btIds 365694/636750; verified from modelProb−bookNoVigProb). The live/backfill regimes have
  **0** actioned-conf0 rows. Consequence: "actioned" filtering on the fg ledger must use
  `confidencePassed=1`, not `result != 'NO_ACTION'`, or April/May accuracy mixes in below-
  threshold picks.
- Edge recompute: 0 rows outside |edge − (modelProb − bookNoVigProb)| ≤ 0.0051 tolerance
  (modelProb is stored at 2dp).
- Threshold-consistency vs **current** code thresholds (informational): 1,534 rows action/no-action
  differently than today's thresholds would (fg_ml_home 333, fg_ml_away 378, fg_over 421,
  fg_under 402) — expected: thresholds were raised over time (home ML 0.05→0.06, away RL
  0.05→0.18, totals conf 0.55→0.65) and the v2026 writer used edge>0. Not regraded history.

**Genuine ledger defect found — 154 stale rows on 36 now-final games**
(`fullgame-grader-backtest-stale-rows.csv`): 130 MISSING_DATA rows (32 games, mostly the
4/19-5/6 outage cluster + 2251100 6/24, 2251321 7/11) and 24 VOID rows ("gameStatus=postponed",
4 games: 2250506, 2250508, 2250551, 2250710) whose games are final with actuals today.
**Root cause (mechanism verified)**: remediation B7b re-drove these games through
`runMultiMarketBacktest`, whose INSERT hits the unique key `(gameId, market)` and falls back to
an UPDATE keyed on `(gameId, market, modelSide)` — but the audit writer stored
`modelSide = market` ("fg_ml_home") while the live engine uses "home"/"away"/"over"/"home -1."
etc., so the UPDATE matched 0 rows and the stale rows silently survived. 118/130 MISSING_DATA
rows carry `quarantineReason='actual score missing'` — exactly B7b's target class (c).

## 4. The 3 score-corrected games (D-011) — verified everywhere

`fullgame-grader-corrected-games.csv`:

| Game | games.actual | linescores | StatsAPI | games grades (stored/derived) | ledger rows |
|---|---|---|---|---|---|
| STL@CIN 5/23 G2 (2250733) | 6-7 ✓ | 6-7 ✓ | 6-7 ✓ | ML LOSS/LOSS, RL WIN/WIN, TOT OVER/OVER, briers match | 6 rows, all NO_ACTION, 0 stale |
| DET@BAL 5/24 G1 (2250738) | 3-5 ✓ | 3-5 ✓ | 3-5 ✓ | ML LOSS/LOSS, RL LOSS/LOSS, TOT PUSH/PUSH (brier null ✓) | 6 rows (fg_ml_away LOSS correct), 0 stale |
| MIL@STL 7/7 G2 (2251290) | 10-2 ✓ | 10-2 ✓ | 10-2 ✓ | ML WIN/WIN, RL LOSS/LOSS, TOT OVER/OVER, briers match | 6 rows, all NO_ACTION, 0 stale |

All three grade correctly against the **corrected** scores in the games table and the ledger;
none echoes the twin game's score anywhere in the grading path. (The census `game-universe.csv`
linkage for two of them still points at the twin's schedule row — section 2 — an audit-artifact
issue, not a DB one.) `mlb_replay_grades` contained **0 rows** at run time (running pipeline;
recorded, not judged), so no replay-side grade exists yet to check for these games.

## 5. Verdict

- **games table: zero-mismatch proven** on fgMlResult/fgMlCorrect/fgRlResult/fgRlCorrect/
  fgTotalResult/fgTotalCorrect/brierFgMl/brierFgTotal across all 1,556 finals; the 12-row
  residue is fully enumerated and consists of 3 boundary-semantics rows (stored values correct
  under the regrade's documented tie-break) and 6 unmodeled-game coverage gaps + ungraded-null
  bookkeeping. Grade timestamps: all 1,537 graded rows share one `fgBacktestRunAt`
  (1784992359459 = B6 regrade stamp); the 19 nulls are the ungraded games.
- **fg ledger: zero grading mismatches** on 2,288 actioned rows and all correct-flags; the
  854+2+1 conf-flag oddities are the v2026 writer's documented (different) semantics, verified
  violation-free against its own rule.
- **Defects to carry forward**: (1) 154 stale MISSING_DATA/VOID fg rows on 36 final games —
  B7b's update-key mismatch (fix: key remediation updates on (gameId, market) or normalize
  modelSide); (2) mlb_schedule_history BOS@BAL 4/26 row holds 17-1, truth 5-3; (3)
  census game-universe.csv maps 4 DH G2 games to the G1 twin's schedule row; (4) ledger
  result-semantics heterogeneity across writer regimes (document `confidencePassed=1` as the
  actioned filter); (5) minor: RL model-margin-on-line tie-break diverges between B6 regrade
  (HOME) and live ingestor (null) — 3 games affected; (6) minor: All-Star exhibition carries
  games-table grades despite EX-ALLSTAR.

## Files

| File | Rows | Content |
|---|---|---|
| fullgame-grader-games-rederivation.csv | 1,556 | full population, stored vs derived, all fields |
| fullgame-grader-games-mismatches.csv | 12 | every non-match row, classed |
| fullgame-grader-actuals-crosscheck-issues.csv | 14 | 3-source actuals disagreements |
| fullgame-grader-backtest-rederivation.csv | 9,330 | every fg_* ledger row, re-derived |
| fullgame-grader-backtest-mismatches.csv | 857 | WARN class rows (explained regime-2 semantics) |
| fullgame-grader-backtest-stale-rows.csv | 154 | genuine defect: stale MISSING_DATA/VOID rows |
| fullgame-grader-backtest-uncovered-games.csv | 1 | All-Star (exempt) |
| fullgame-grader-corrected-games.csv | 3 | D-011 games, verified everywhere |
| fullgame-grader-statsapi-sample.csv | 36 | external ground truth, 36/36 match |
| fullgame-grader-summary.json | — | machine-readable aggregates |
