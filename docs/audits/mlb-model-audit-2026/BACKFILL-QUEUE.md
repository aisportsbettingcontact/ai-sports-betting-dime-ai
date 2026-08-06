# Backfill Queue — awaiting CHECKPOINT ALPHA authorization

Nothing in this file has been executed. Every batch, on authorization, follows safety rail 3:
pre-write snapshot table (`<table>_audit_bak_20260725`), dry-run diff preview, transactional
idempotent execution, before/after row counts logged to `remediation-log.md`. No DELETE, no DDL
on production tables, inserts and targeted updates only. Exemption records live in
`census/exemptions.csv` (artifact), never as schema changes.

| # | Target | What | Source | Est. rows | Method |
|---|---|---|---|---|---|
| BF-1 | `games` | Status normalize 37 zombie games (live/upcoming→final, id list from census) + SF@ATL 6/16 postponed→final + FG actual scores for 46 games | `mlb_schedule_history` scores (in-DB join) | 46 updates | targeted UPDATE by id |
| BF-2 | `games` | F5 actuals (48 games), NRFI actuals (~27 games), `actualFgTotal` where null | MLB StatsAPI linescore via existing `mlbOutcomeIngestor` pathway, scoped to date list | ≤48 games | existing ingestion job, scoped |
| BF-3 | `games` | `actualNrfiBinary` for 512 rows where `nrfiActualResult` already holds NRFI/YRFI | in-row derivation | 512 updates | single idempotent UPDATE |
| BF-4 | `mlb_game_backtest` | Enroll 654 missing completed games (May 111, Jun 341, Jul 202) | existing `mlbMultiMarketBacktest` engine over stored projections + actuals; its leakage guard stays active | ~6,540 inserts | engine run, scoped by date |
| BF-5 | `mlb_game_backtest` | Populate `closingOdds`/`clv` for ledger rows of the 884 games with captured closing lines | `mlb_schedule_history.dkClosing*` | ~5–6k updates (exact count at dry-run) | computed no-vig CLV, targeted UPDATE |
| BF-6 | `mlb_hr_props` | `actualHr` for 1,990 completed-game rows (May 1,373 / Jul 586 / Jun 31) | existing `mlbHrPropsBacktestService` pathway (StatsAPI box scores) | 1,990 updates | existing service, scoped |
| BF-7 | `mlb_strikeout_props` | `actualKs` for 539 rows after scratch verification against `mlb_lineups`; non-starters get EX-SCRATCH in exemptions.csv (no DB write) | StatsAPI box scores via `kPropsBacktestService` pathway | ≤539 updates | verify-then-ingest |
| BF-8 | `games` | Create 11 missing completed games (8 DH game-2s) — **no projections** (EX-NO-PROJ-RETRO), `publishedToFeed=0`, `publishedModel=0`; resolve D-003 pair; fix stale TB@BOS 5/9 schedule row after StatsAPI verification | `mlb_schedule_history` + StatsAPI | 11 inserts + 2 updates | targeted INSERT/UPDATE |
| BF-9 | `games` | 3 missing `mlbGamePk`; 2 rows `gameNumber=2` with `doubleHeader='N'` | StatsAPI schedule | 5 updates | targeted UPDATE |
| BF-10 | re-census | Re-run `tools/run-census.mjs` + `tools/grade-season.mjs`; publish zero-defect-null proof or enumerate remaining exemptions | — | — | read-only |

Not backfillable (by design, leakage): projections for past games (D-001/D-004/D-006 projection
holes). These become permanent exemption records plus forward-looking process fixes.

External-source note (rail 6): BF-2/6/7 use the repo's existing StatsAPI ingestion pathways;
no new scrapers. If any pathway proves non-runnable in scoped mode, that comes back as a finding,
not an improvisation.
