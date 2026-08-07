# Model Retention Dossier — Dime AI MLB Engine (as of 2026-07-25, branch local/audit-mlb-model-2026)

Purpose: from this document (plus the section files it indexes), an engineer who has never seen
this codebase must be able to re-derive every MLB number Dime publishes. Every claim in the
section files carries file:line evidence and a VERIFIED/INFERRED/UNKNOWN classification. Each
section was written by a tracer agent; adversarial verification status varies per section (see
table below — 6 verifier agents failed on session usage limits, finding P-005; supervisor
spot-verified the load-bearing claims of the affected sections, marked SV in FINDINGS.md).

| Section | Verification |
|---|---|
| fullgame | agent-verified (74 claims: 69 confirmed, 5 corrected inline, 0 unbacked) |
| hrprops | agent-verified (121 claims: 115 confirmed, 6 corrected inline, 0 unbacked) |
| f5 | agent-verified re-run (113 claims: 109 confirmed, 4 corrected, 0 unbacked) |
| nrfi | agent-verified re-run (82: 78/4/0) |
| kprops | agent-verified re-run (96: 93/3/0) |
| ingestion | agent-verified re-run (112: 106/6/0) |
| gradecal | agent-verified re-run (120: 114/6/0) |
| exposure | agent-verified re-run (79: 76/3/0) |

All eight sections are now adversarially verified; sections also carry `[FIXED in Phase 4]` annotations distinguishing pre-fix findings from the repaired code. ⚠️ **ERRATUM (2026-08-07): those annotations do not distinguish anything — the repaired code was never merged.** All 55 were verified against `main` one at a time; none describes code on `main`. Two further corrections to this sentence: only six of the eight sections carry any such annotation, and `phase0/exposure.md:157` explicitly states that *no* claim there earned one, directly contradicting this line. See [`PHASE4-ANNOTATION-ERRATA.md`](PHASE4-ANNOTATION-ERRATA.md). |

## Section index (phase0/)
| Section | File | Scope |
|---|---|---|
| Full Game ML/RL/Total | `phase0/fullgame.md` | Monte Carlo core (`server/MLBAIModel.py`), orchestration + write path (`server/mlbModelRunner.ts`) |
| First 5 Innings | `phase0/f5.md` | F5 simulation, push handling, F5 odds capture |
| NRFI/YRFI | `phase0/nrfi.md` | first-inning model, combined signal, filter gate |
| Strikeout props | `phase0/kprops.md` | `server/StrikeoutModel.py`, K distribution, umpire/handedness adjustments |
| HR props | `phase0/hrprops.md` | `server/mlbHrPropsModelService.ts`, statcast inputs, recalibration history |
| Ingestion & scheduling | `phase0/ingestion.md` | schedule/actuals/odds/lineups jobs, cron map, closing-line capture |
| Grading/backtest/drift | `phase0/gradecal.md` | both grading paths, quarantine rules, drift → learning loop |
| API & frontend exposure | `phase0/exposure.md` | publication gates, what subscribers see |

## Market taxonomy (discovered from schema + code, not assumed)
Game-level (in `games`, one row per game): FG moneyline, FG run line, FG total; F5 moneyline,
F5 run line, F5 total; NRFI/YRFI; team-HR trio (`modelAwayHrPct`/`modelHomeHrPct`/
`modelBothHrPct` + expected HR counts — launched 2026-06-01). Player-level: pitcher strikeout
props (`mlb_strikeout_props`, over/under vs book line), batter HR props (`mlb_hr_props`,
yes/no vs 0.5). Bet-grading ledger: `mlb_game_backtest`, one row per game × market-side
(10 game-market sides + `hr_prop` slate rows). No other MLB market surfaces exist in schema or
routers as of this audit.

## Schema map
`census/schema-columns.tsv` — all 610 column definitions for the 17 `mlb_*` tables plus
`games`, `odds_history`, `tracked_bets` (VERIFIED from information_schema). Key linkage:
- `mlb_schedule_history.anGameId` (Action Network id) = schedule source of truth; joins to
  `games` only by (gameDate, awayAbbr/awayTeam, homeAbbr/homeTeam, doubleheader sequence).
- `games.mlbGamePk` (MLB StatsAPI id, unique) = actuals-ingestion key.
- Props tables key on `games.id` (`gameId`) + `mlbamId` for players.
- Probability scale inconsistency (P-003): `modelAwayWinPct`, `modelOverRate`,
  `modelF5AwayWinPct`, `modelF5AwayRLCoverPct` are 0–100; `modelPNrfi`, `modelF5OverRate`,
  `modelPHr`, `pOver`/`pUnder` are 0–1.

## Config inventory (live values)
`census/calibration-constants.tsv` — all 54 `mlb_calibration_constants` rows (paramName,
currentValue, baseline, CI bounds, updateSource, lastUpdated) as of 2026-07-25. Drift state:
`census/drift-state.tsv` (a single market row — coverage gap vs the 10+ modeled markets).
Learning history: `census/learning-log.tsv` (144 recalibration events with before/after
accuracy/MAE). The gradecal section maps each constant to its consuming code path and flags
orphans.

## Provenance caveat (P-001)
`modelRunAt` on `games` and props rows is overwritten by re-runs (values up to 11 days after
first pitch; props average +8.9h). `createdAt` proves pregame row creation, but per-column
pregame provenance is unprovable from the database. Treat every "projection" in this dossier as
"projection as currently stored"; the leakage-quarantine in `mlb_game_backtest` is the only
enforcement point.
