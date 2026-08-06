# Phase 1 — Season Census Report (2026 MLB, through 2026-07-25)

All counts in this report are **VERIFIED**: each was produced by `tools/run-census.mjs` or a
logged read-only query in this session (see `action-log.md`). Interpretive statements are marked
INFERRED. Database: TiDB serverless `MW3FicTy7ae3qrm8dx8Lua` (identity verified via
`SELECT DATABASE(), VERSION()`).

## 1. Game universe (source of truth: `mlb_schedule_history`, `game_type='regular_season'`)

| Metric | Count |
|---|---|
| 2026 regular-season games, Opening Day (2026-03-25) through 2026-07-25 | **1,597** |
| Complete | 1,556 |
| Postponed (terminal as of 2026-07-25) | 25 |
| Scheduled (2026-07-25 slate, not yet played) | 16 |
| Linked to a `games` row (date + team abbrev + doubleheader sequence) | 1,579 |
| **Unlinked — no `games` row exists** | **18** |
| Status mismatches (schedule=complete, games≠final) | 39 |
| Reverse orphans (`games` row unclaimed by any schedule row) | 1 |

Season boundaries were derived from the data, not assumed. Spring training (448 complete + 3
cancelled) and the All-Star Game (exhibition, in `games` with no `mlbGamePk`) are out of model
scope. Doubleheaders are disambiguated by start-time sequence within (date, matchup); the season
has 6 doubleheader pairs correctly represented in `games` plus the failures below.

### D-001 (P1) — 11 completed games have no `games` row at all
Of the 18 unlinked schedule games: 6 are postponed, 1 is a stale `scheduled` row
(TB@BOS 2026-05-09, anGameId 287980 — never resolved), and **11 are complete games the platform
never created**, of which **8 are doubleheader game 2s** (MIL@KC 4/4, BOS@BAL 4/26, COL@NYM 4/26,
STL@CIN 5/23, DET@BAL 5/24, SF@ATL 6/17, CHC@NYM 6/24, MIL@STL 7/7, MIL@PIT 7/11 — see
`census/game-universe.csv`, `linkStatus=UNLINKED`) plus TOR@CWS 4/3, NYM@COL 5/7.
INFERRED: doubleheader game-2 creation systematically fails in the games pipeline.
These games have no projection for any market — the model was silently absent from ~11 slates'
worth of games. Projections cannot be honestly backfilled (leakage); the repair is forward-looking
process plus explicit exemption records.

### D-002 (P1) — May 5–7 pipeline outage: 37 zombie games
37 games on 2026-05-05..07 are stuck `live`/`upcoming` in `games` despite schedule `complete`
(list: `census/game-universe.csv`, `statusMismatch=1`). 12 of them also lack projections
(see D-004). Their actual scores, F5 splits, and NRFI outcomes were never ingested — this window
accounts for 39 of 46 missing FG actuals. One further mismatch: SF@ATL 6/16 is `postponed` in
`games` but complete in schedule (makeup-day confusion); plus the All-Star Game row.

### D-003 (P2) — Reverse orphan
`games` 2250374 (BOS@BAL 4/25, final, gamePk 824851) is unclaimed by the schedule after its
postponement/reschedule to the 4/26 doubleheader; the schedule's 4/26 game 2 is one of the
unlinked games in D-001. Same physical game, two half-records.

## 2. Coverage matrix (1,545 completed AND linked games; `census/coverage-matrix.csv`)

| Market surface | Games covered | Missing | Notes |
|---|---|---|---|
| FG projection (ML/RL/Total) | 1,528 | 17 | missing list in §3 |
| F5 projection | 1,528 | 17 | same games |
| NRFI projection | 1,528 | 17 | same games |
| Team-HR game columns | 641 | 904 | launched 2026-06-01: pre-June = EX-PRELAUNCH (880); post-launch missing = 24 (June, defect) |
| K props (≥1 prop) | 1,437 | 108 | Mar 17, Apr 48, May 38, Jun 0, Jul 5 |
| HR props (≥1 prop) | 893 | 652 | **June outage: 368 of 392 June games have zero HR props**; May 146, Jul 117 |
| FG actuals in `games` | 1,499 | 46 | all 46 recoverable from `mlb_schedule_history` scores |
| F5 actuals | 1,497 | 48 | outage window + stragglers; recoverable via MLB StatsAPI linescore (existing `mlbOutcomeIngestor` pathway) |
| NRFI actual (binary) | 991 | 537 | **512 of the 537 have `nrfiActualResult` string set but `actualNrfiBinary` null** (D-005, trivially derivable); ~27 truly missing |
| Backtest ledger (≥1 row) | 891 | 654 | May 111, Jun 341, Jul 202 — ledger enrollment collapsed in June (D-007) |

### D-004 (P1) — 17 completed games with no projections
Opening Day NYY@SF 3/25, PIT@TEX + SD@COL 4/21, ATL@COL 5/2, NYM@COL 5/4, and 12 games in the
May 5–7 outage window (full list in §1 evidence file). Not backfillable without leakage —
exemption EX-NO-PROJ-RETRO plus process finding.

### D-005 (P2, trivial fix) — 512 games: NRFI string result present, binary null
`nrfiActualResult IN ('NRFI','YRFI')` with `actualNrfiBinary IS NULL`. Backfill is a pure
derivation (`NRFI`→1, `YRFI`→0).

### D-006 (P1) — HR props June outage + April projection hole
June: 368 of 392 completed games have zero HR prop rows. April: 7,084 prop rows exist but 5,529
lack `modelPHr` (the model column was populated for only 1,555). May: 1,818 missing projections,
1,373 missing actuals. July: 586 missing actuals. Missing actuals are backfillable via the
existing `mlbHrPropsBacktestService` pathway; missing projections are EX-NO-PROJ-RETRO.

### D-007 (P1) — Backtest ledger enrollment collapse (June onward)
`mlb_game_backtest` covers 891 of 1,545 completed games. June enrolls only 51 games (341
missing), July 71 (202 missing). The games-table projections continued uninterrupted — INFERRED:
the backtest/outcome scheduler stopped enrolling slates, not the model.

### D-008 (P1) — CLV and closing-odds columns never populated
`mlb_game_backtest.clv` and `closingOdds` are NULL on all 12,720 rows, even though
`mlb_schedule_history` has carried DraftKings closing lines since 2026-04-11 (884 of 1,597 games,
`closingLineLockedAt` set on all 884). CLV — the platform's primary honest health metric — is
absent for the entire season. Additionally, closing capture covers only ~65% of games since launch
(Apr 161/398, May 274/426, Jun 264/402, Jul 185/295) — the residual gap needs a root cause.

### D-009 (P2) — K props: 539 prop rows on completed games lack `actualKs`
Mar 0 / Apr 142 / May 162 / Jun 157 / Jul 78 (with projection present). INFERRED: mostly
scratched/replaced starters (legitimate exemption EX-SCRATCH), but each row needs verification
against `mlb_lineups` confirmations before an exemption code is assigned; unverified rows remain
defects.

### D-010 (P2) — March quarantine wall
All 76 March games' backtest rows (all 10 game markets) are `QUARANTINED`. Reasons on the season:
`bookOdds=null` (1,256 rows), `modelProb=null` (1,182), `actual score missing` (186), and
leakage guards (`modelRunAt >= gameStartUtcMs`). INFERRED: March pre-dates odds capture at model
run time. The leakage-guard quarantines are the machinery working as designed — but they also
prove some model runs happened post-first-pitch (P-series process finding).

## 3. Null audit
`census/null-audit.csv` — 345 columns carry nulls across the 18 MLB-related tables. Columns
that are NHL/NCAAM-specific on the shared `games` table (goalie, puck line, bracket) are
EX-FOREIGN for MLB rows. The MLB-material defect nulls are enumerated in D-004..D-009 above.
The games grading columns (`fgMlCorrect` etc.) are ~100% null but are **dead columns, not
defects** — see Phase 2 finding M-101 (the live grading path is `mlb_game_backtest`); their
partial March/April population is itself misleading (M-102).

## 4. Currency check (as of 2026-07-25 13:30 UTC)

| Check | Value | Verdict |
|---|---|---|
| Last completed slate | 2026-07-24 | — |
| Today's slate (15 games) projected | 15/15 | **CURRENT** |
| Last K-prop grading date | 2026-07-24 | CURRENT |
| Last HR-prop grading date | 2026-07-24 | CURRENT |
| Last backtest-ledger settle | 2026-07-23 | 1 day behind (within its partial coverage) |
| games-table FG grading columns | never populated | dead path |

## 5. Exemption codes used
- **EX-PRELAUNCH** — market not yet live on that date (team-HR before 2026-06-01)
- **EX-NO-PROJ-RETRO** — projection absent for a past game; retro-generation would be leakage
- **EX-SCRATCH** — prop on a player who did not play (pending row-level verification, D-009)
- **EX-FOREIGN** — column belongs to another sport on a shared table
- **EX-FUTURE / EX-POSTPONED** — game not yet played / terminally postponed
