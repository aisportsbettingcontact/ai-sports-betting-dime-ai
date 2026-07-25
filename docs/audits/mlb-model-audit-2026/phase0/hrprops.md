# Phase 0 Dossier — HR Props (player HR props + team/game HR markets)

Audit date: 2026-07-25. All claims carry file:line citations and a classification:
**VERIFIED** (code read at that location this session), **INFERRED** (reasoned from verified facts, reasoning stated), or **UNKNOWN**.

---

## Overview

There are **two entirely separate HR products** with different models, different park-factor
sources, and different write targets:

1. **Player HR props** — one row per (game, player) in `mlb_hr_props`. Odds are scraped from
   Action Network's *Consensus* pseudo-book (book_id=15), a TypeScript closed-form Poisson model
   (`server/mlbHrPropsModelService.ts`) computes P(player hits ≥1 HR), edge vs the AN no-vig
   probability, and an OVER/PASS verdict. Grading against MLB Stats API box scores populates
   `actualHr`/`backtestResult`. (VERIFIED — mlbHrPropsScraper.ts:1-15, mlbHrPropsModelService.ts:1-40,
   mlbHrPropsBacktestService.ts:1-19)

2. **Team/game HR markets** — `games.modelAwayHrPct / modelHomeHrPct / modelBothHrPct /
   modelAwayExpHr / modelHomeExpHr`, produced inside the main Monte Carlo engine
   (`server/MLBAIModel.py:1187-1211`) as two **independent team-level Poisson draws** and written by
   `server/mlbModelRunner.ts:2521-2525`. This path never touches `mlb_hr_props` and uses a
   *different* park HR factor source than the player model. (VERIFIED)

Despite column names and schema comments referencing FanDuel (`fdOverOdds`, "FanDuel NJ as primary
book" — drizzle/schema.ts:1452, 1471-1474), **the live odds source is Action Network Consensus,
not FanDuel**; no code in the repo writes `fdOverOdds`/`fdUnderOdds` (VERIFIED by exhaustive grep —
only readers exist: recalibrateHrProps.mjs:42, runFullHistoricalBacktest.mjs:489,
mlbMultiMarketBacktest.ts:733, client TheModelResults.tsx:768-769, plus the schema/migration
definitions drizzle/schema.ts:1472-1474, drizzle/0051_panoramic_sebastian_shaw.sql:35).

---

## Data inputs & ingestion

### 1. Book odds — Action Network Consensus (player props)

- Endpoint: `https://api.actionnetwork.com/web/v2/scoreboard/mlb/markets?customPickTypes=core_bet_type_33_hr&date=YYYYMMDD`
  with browser-spoofing headers (VERIFIED — ActionNetworkHRPropsAPI.py:64-77, 143-161).
- `CONSENSUS_BOOK_ID = "15"`, `HR_PROP_TYPE = "core_bet_type_33_hr"` (VERIFIED — ActionNetworkHRPropsAPI.py:65-66).
- Per player: over/under sides grouped by `player_id`; `overLine` defaults 0.5 (VERIFIED — :224-233, 342).
- No-vig over probability: `p_over_raw / (p_over_raw + p_under_raw)`, rounded to 6 dp; `None` if
  either side missing (VERIFIED — :123-137). This becomes `anNoVigOverPct`.
- Game matching: AN `event_id` → `AWAY@HOME|YYYY-MM-DD` key against a DB game map, with a
  fallback re-key on the requested date for UTC-shifted West Coast games (VERIFIED — :293-307).
- AN team_id → abbreviation hard-coded for all 30 teams (VERIFIED — :80-111); a player whose
  team_id is missing from that dict gets `playerTeam="?"`, which then fails the away check in the
  TS upsert and is silently classified as `side='home'` (INFERRED from mlbHrPropsScraper.ts:230:
  `rec.playerTeam === rec.awayTeam ? 'away' : 'home'`).
- Rotowire lineups (`mlb_lineups`) are passed in and cross-referenced to compute `battingOrder`
  and `lineupConfirmed` per player (VERIFIED — :235-330), **but these fields are discarded at
  upsert** — the insert writes only gameId, side, playerName, anPlayerId, teamAbbrev, bookLine,
  consensusOverOdds, consensusUnderOdds, anNoVigOverPct (VERIFIED — mlbHrPropsScraper.ts:231-251),
  and `mlb_hr_props` has no battingOrder/lineupConfirmed/position/anEventId columns (VERIFIED —
  census/schema-columns.tsv `mlb_hr_props` rows 1-25).

### 2. Orchestrator (TS → Python subprocess)

`scrapeHrPropsForDate(dateStr)` (VERIFIED — mlbHrPropsScraper.ts:266-375):
- Loads MLB games for the date (:73-99), lineups (:101-128), spawns `python3.11
  ActionNetworkHRPropsAPI.py` with stdin JSON `{dateStr(YYYYMMDD), dbGameMap, lineupMap}` (:148-157),
  parses the last stdout line starting with `[` (:180-198).
- Upsert into `mlb_hr_props` via `onDuplicateKeyUpdate` on unique key `uq_hr_game_player
  (gameId, playerName)` (VERIFIED — mlbHrPropsScraper.ts:231-251; drizzle/schema.ts:1505). The
  duplicate-update only refreshes teamAbbrev + odds + anNoVigOverPct, so model outputs written
  later survive re-scrapes (VERIFIED — :244-251).
- Logging quirk: the `inserted` counter increments for updates too and `updated` is always 0
  (VERIFIED — :252, 217-218).

### 3. Model context inputs (player model)

| Input | Table.column | Seeder | Cadence | Citation |
|---|---|---|---|---|
| Team batting HR rate vs hand | `mlb_team_batting_splits.hr9`, `.woba` (keyed team+hand L/R) | `seedTeamBattingSplits` | 24 h | vsinAutoRefresh.ts:2160-2174 (VERIFIED); seedTeamBattingSplits.ts:1-30 |
| hr9 definition | `hr9 = HR / AB * 27` (per 27 **AB**, not per 9 innings / not per PA) | — | — | seedTeamBattingSplits.ts:13, 100 (VERIFIED) |
| Opposing SP HR/9 | `mlb_pitcher_stats.hr9` keyed lowercase fullName | `seedPitcherStats` | 24 h | vsinAutoRefresh.ts:2116-2129 (VERIFIED); mlbHrPropsModelService.ts:284-289 |
| Park HR factor | `mlb_park_factors.hrFactor` (fallback `parkFactor3yr`, then 1.0) | **one-time** `backfillHrFactor.mjs`; weekly `seedParkFactors` does **not** write hrFactor | never refreshed | backfillHrFactor.mjs:1-7, 58-64 (VERIFIED); seedParkFactors.ts:218-237 row object omits hrFactor (VERIFIED); mlbHrPropsModelService.ts:295-308 |
| Player Statcast | `mlb_players.iso/barrelPct/hardHitPct/xSlg` keyed mlbamId | **manual one-off** `populateStatcastISO.mjs` (Baseball Savant custom leaderboard CSVs, min=1 PA) | no scheduler found | populateStatcastISO.mjs:1-20, 209-214 (VERIFIED); grep shows zero references outside the script itself (VERIFIED) |
| Pitcher hand / names | `mlb_lineups.awayPitcherHand/homePitcherHand`, fallback `games.awayStartingPitcher/homeStartingPitcher` | Rotowire lineups pipeline (out of scope) | — | mlbHrPropsModelService.ts:312-316, 343-355 (VERIFIED) |
| mlbamId resolution | MLB Stats API `/api/v1/sports/1/players?season=2026&gameType=R`, 6 h module cache | on demand each model run | 6 h TTL | mlbamIdCache.ts:29, 53-87 (VERIFIED); mlbHrPropsModelService.ts:237-256 |
| Actual HRs (grading) | MLB Stats API `/game/{gamePk}/boxscore` batting.homeRuns | HR backtest service | every MLB cycle | mlbHrPropsBacktestService.ts:61-104 (VERIFIED) |

### 4. Team-market inputs (games columns)

- Lineup-level `hr_pct`: from team batting splits passed into Python — `hr_pct = batting_hr9 /
  38.0` (pa_per_9 = 38.0) when splits exist, else derived `(slg-avg)*0.25`; then scaled by
  `woba_scale = woba/LEAGUE_WOBA` and clipped to [0.01, 0.07] (VERIFIED — MLBAIModel.py:2262-2275, 2284).
- Park: `PARK_FACTORS[retro]["hr"] / 100.0` from the **hard-coded Python dict** (2024 Fangraphs
  values, updated 2025-05-10) — *not* the DB `hrFactor` (VERIFIED — MLBAIModel.py:222-260, 2166-2168, 2783).
- Weather: `weather_hr_adj` is computed (`1 + wind*0.006` out / `1 − wind*0.004` in — VERIFIED
  MLBAIModel.py:2170-2180, 2198) but grep finds no consumer anywhere; it is **dead output**
  (INFERRED — only occurrence is its definition at :2198).

---

## Model mechanics

### A. Player model — `computePlayerPHr` (server/mlbHrPropsModelService.ts:137-175), "v3-p2bc"

Functional form (VERIFIED — :143-174):

```
hr_rate_per_pa = team_hr9 / 27.0                      # NOTE: hr9 = HR/AB*27, so this is HR-per-AB
pitcher_adj    = sqrt(pitcher_hr9 / 1.28)             # sqrt-dampened
park_adj       = hrFactor (DB)                        # fallback parkFactor3yr, then 1.0
base_rate      = hr_rate_per_pa * pitcher_adj * park_adj

statcast_adj   = clamp(0.40*(iso/0.168) + 0.40*(barrelPct/8.3) + 0.20*(hardHitPct/37.5), 0.30, 3.00)
   fallback (no individual Statcast): clamp(team_woba / 0.318, 0.30, 3.00)

lambda = base_rate * statcast_adj * 4.22 * 0.5317
p_hr   = clamp(1 - exp(-lambda), 0.04, 0.45)
```

Verdict logic (VERIFIED — :415-429): `edgeOver = modelPHr − anNoVigOverPct` (4 dp);
`evOver = (edgeOver / (1 − modelPHr)) * 100` (2 dp); verdict `OVER` only if
`edgeOver ≥ 0.060 AND modelPHr ≥ 0.18`, else `PASS`. **UNDER is never emitted** (VERIFIED — no
code path sets it; :418 initializes "PASS", only "OVER" assigned at :426).

Note the evOver formula does not match either the schema's documented formula ("edge * (1/book_p −
1) * 100" — drizzle/schema.ts:1487) or the standard EV-at-odds definition `(p−q)/q`; it divides by
`(1 − modelPHr)` instead (VERIFIED — :422).

#### Parameter table (player model)

| Name | Value | File:line |
|---|---|---|
| LEAGUE_WOBA | 0.318 | mlbHrPropsModelService.ts:61 |
| LEAGUE_HR9 | 1.28 | :62 |
| LEAGUE_ISO | 0.168 | :63 |
| LEAGUE_BARREL | 8.3 (%) | :64 |
| LEAGUE_HARDHIT | 37.5 (%) | :65 |
| PLAYER_PA_PER_GAME | 4.22 | :66 |
| EDGE_THRESHOLD | 0.060 | :70 |
| MIN_ABSOLUTE_P_HR | 0.18 (was 0.25) | :77 |
| MIN_P_HR / MAX_P_HR clamp | 0.04 / 0.45 | :78-79 |
| MIN/MAX_STATCAST_ADJ clamp | 0.30 / 3.00 | :80-81 |
| HR_CALIBRATION_FACTOR | **0.5317** (history: 0.325 → 0.875 → 0.720 → 0.5317) | :97 (current); :20, :84-96 (history in comments) |
| Statcast composite weights | ISO 0.40, barrel 0.40, hard-hit 0.20 | :160 |
| Pitcher adj dampening | sqrt | :148 |
| Missing-context fallbacks | batting {hr9:1.0, woba:0.318}; pitcher {hr9:1.28}; park {hrFactor:1.0} | :385, :388, :394 |
| Odds conversion | p≥0.5 → −(p/(1−p))·100 else ((1−p)/p)·100, rounded | :178-182 |

Batting context is hand-specific (`TEAM:L` / `TEAM:R` vs opposing SP hand from lineups) with a
fallback to the L/R average, then to league defaults (VERIFIED — :267-280, 381-385). Platoon is
therefore **team-level only**; there is no individual batter-vs-hand split (VERIFIED — no such
input exists in the service).

Statcast usage requires `iso != null || barrelPct != null` at the row level to count as a
"hit" (a player with only hardHitPct falls to the team-wOBA fallback) (VERIFIED — :339, :400).

### B. Team/game HR market — MLBAIModel.py Monte Carlo

Mechanics (VERIFIED — MLBAIModel.py:1187-1211):

```
LINEUP_PA_PER_GAME = 36                                   # :1192
team_hr_rate = clip(lineup_hr_pct * park_hr_factor, 0.01, 0.08)   # :2784-2789
lambda_team  = team_hr_rate * 36                          # :1196-1197
hr_counts    = rng.poisson(lambda_team, size=n_sims)      # :1198-1199
p_team_hr_any = mean(hr_counts >= 1)                      # :1200-1201
p_both_hr     = mean((home>=1) & (away>=1))               # :1202
exp_hr        = mean(hr_counts)                           # :1203-1204
```

| Name | Value | File:line |
|---|---|---|
| SIMULATIONS (n_sims) | 400,000 (clamped [250,000, 500,000]) | MLBAIModel.py:68-70, 880-882, 2821 |
| LINEUP_PA_PER_GAME | 36 | :1192 |
| team_hr_rate default | 0.033 HR/PA | :1193-1194 |
| team_hr_rate clip | [0.01, 0.08] | :2785, :2788 |
| lineup hr_pct source | batting_hr9 / 38.0, × woba_scale, clip [0.01, 0.07] | :2262-2266, 2275, 2284 |
| LEAGUE_HR_PCT | 0.0309 | :117 |
| park_hr_factor | PARK_FACTORS[retro]["hr"]/100 (COL 1.22 … OAK/MIA 0.91) | :225-260, 2166-2168 |
| Output scaling | ×100, 2 dp before returning to TS | :2977-2981 |

Properties worth flagging (all VERIFIED from the code above unless noted):
- **No opposing-pitcher input** — the per-PA Log5 machinery (PAOutcomeModel, :589-605) does blend
  pitcher `hr_pct` for run scoring, but the HR-market lambda uses only lineup hr_pct × park.
- **No weather input** — weather_hr_adj is dead (see Data inputs §4).
- Home and away Poissons are independent draws, so `p_both_hr` carries no same-game correlation
  (INFERRED from the two independent `rng.poisson` calls at :1198-1199).
- Since both teams use the *home* park's hr factor, `park_hr_factor` applies to both lambdas
  (VERIFIED — :2783-2789, single `env` value).

Because the player model reads DB `hrFactor` (backfilled once from an *older* snapshot) and the
team model reads the current Python dict, **the two products can price the same park differently**
— e.g. COL: DB 1.19 (backfillHrFactor.mjs:24) vs Python 1.22 (MLBAIModel.py:226); CIN 1.08 vs
1.12; SEA 0.94 vs 0.93; OAK 0.93 vs 0.91 (VERIFIED both sources; whether DB still holds the 2024
snapshot values is UNKNOWN — census query needed).

---

## Projection → DB write path

### Player props (`mlb_hr_props`, keyed `uq_hr_game_player (gameId, playerName)`)

| Writer | Columns written | Key | When |
|---|---|---|---|
| Scraper upsert | gameId, side, playerName, anPlayerId, teamAbbrev, bookLine, consensusOverOdds, consensusUnderOdds, anNoVigOverPct (dup-update: last 4) | (gameId, playerName) | every 5-min MLB cycle after 12:00 UTC (VERIFIED — mlbHrPropsScraper.ts:231-251; vsinAutoRefresh.ts:2026-2044) |
| Model service | mlbamId (resolution, :244); then modelPHr (4 dp), modelOverOdds, edgeOver, evOver, verdict — **modelRunAt NOT set** | row id | same cycle, immediately after scrape (VERIFIED — mlbHrPropsModelService.ts:433-435; vsinAutoRefresh.ts:2046-2059) |
| Backtest service | actualHr, backtestResult (WIN/LOSS/NO_ACTION), modelCorrect, backtestRunAt | row id | every 5-min cycle for Final games (VERIFIED — mlbHrPropsBacktestService.ts:225-233, 191-222) |

`modelCorrect` semantics: OVER → 1 iff HR hit; PASS/unknown verdict → 1 iff no HR (VERIFIED —
mlbHrPropsBacktestService.ts:199-217).

Grading matches by normalized full name (NFD, suffix-strip, alpha-only). Unmatched players are
skipped (propsSkipped), leaving actualHr NULL forever in the live path (VERIFIED — :49-57,
183-189). The backfill script has a looser partial-name fallback the live service lacks
(VERIFIED — backfillHrProps.mjs:199-209) — inconsistent grading behavior between paths.

### Team markets (`games` row, keyed `games.id`)

`runMlbModelForDate` writes `modelAwayHrPct/modelHomeHrPct/modelBothHrPct` (0-100 strings, 2 dp;
Python pre-multiplies by 100) and `modelAwayExpHr/modelHomeExpHr` in the big per-game UPDATE
(VERIFIED — mlbModelRunner.ts:2521-2525, `.where(eq(games.id, r.db_id))` :2560). Games already
modeled (`modelRunAt` not null) are skipped unless forceRerun, so team HR numbers are computed
once when the game first becomes modelable, not continuously refreshed (VERIFIED —
mlbModelRunner.ts:1589-1594).

---

## Exposure (API + UI)

### tRPC

- `hrProps.getByGame` / `hrProps.getByGames` — **publicProcedure**, returns raw `mlb_hr_props`
  rows (all columns incl. verdict/edge) ordered side, playerName (VERIFIED — routers.ts:1404-1432;
  db.ts:2352-2400).
- `mlbBacktest.getHrPropsReport` — protectedProcedure → `getHrPropsBacktestReport(days)`
  (VERIFIED — routers.ts:1562-1566; mlbFullBacktestEngine.ts:650-672). **This report filters
  `modelRunAt >= cutoff` (:670), but the live model service never writes `mlb_hr_props.modelRunAt`**
  (VERIFIED — the update set list at mlbHrPropsModelService.ts:434 lacks it; repo-wide grep finds
  the only writer to be the synthetic backfill backfillHrPropsApr789.mjs:113, whose rows have no
  modelPHr). Combined with the `isNotNull(modelPHr)` filter (:668-669) the report's row set is
  live-rows∩modelRunAt-set — likely empty (INFERRED; confirm with census query).
- Team columns ride along in the `games` list payload for MLB (they appear in the MLB-only strip
  list applied to non-MLB sports — VERIFIED routers.ts:128, 148).

### UI

- `client/src/pages/ModelProjections.tsx` — public feed, MLB "hrprops" tab fetches
  `hrProps.getByGames` (refetch 10 min) and renders `MlbHrPropsCard` per game (VERIFIED —
  :701-717, :1721). Card shows bookLine, consensus odds, modelPHr, modelOverOdds, edge, EV,
  verdict (VERIFIED — MlbHrPropsCard.tsx:22-47, 164).
- `client/src/pages/TheModelResults.tsx` — owner-only results page, "hrprops" market tab:
  games.list for the date → hrProps.getByGames; `HrPropRow` renders MODEL P(HR), BOOK NO-VIG,
  EDGE, and an "FD ODDS" cell bound to `fdOverOdds` — which is never populated, so it always
  renders "—" (VERIFIED — :1071-1081, :768, :834-836).
- `client/src/pages/MlbBacktest.tsx` — calls `mlbBacktest.getHrPropsReport` (VERIFIED — :127).
- **No client code reads modelAwayHrPct/modelHomeHrPct/modelBothHrPct/modelAwayExpHr/modelHomeExpHr**
  (VERIFIED — grep of client/src for `HrPct|ExpHr|BothHr` returns nothing). The team HR market is
  computed, stored, and API-exposed but has **no UI surface** (INFERRED from the grep).

---

## Scheduling & triggers

Entry point: `server/_core/index.ts:846` calls `startVsinAutoRefresh()`; `:877` calls
`startMlbModelSyncScheduler()` (VERIFIED).

| Job | Trigger | Cadence / gate | Citation |
|---|---|---|---|
| MLB cycle (`runMlbCycleOnce`) | `startVsinAutoRefresh` → immediate + `setInterval` | every 5 min, 24/7 (`MLB_INTERVAL_MS = 5*60*1000`) | vsinAutoRefresh.ts:2096-2101, :1361 (VERIFIED) |
| HR props scrape + model EV | MLB cycle "Step 8" | every cycle, **only after 12:00 UTC** (`isAfter7amEst`) | vsinAutoRefresh.ts:2022-2063; gate fn :120-129 (VERIFIED) |
| HR grading (`fetchAndStoreActualHrResults`) | MLB cycle, inside the **K-Props pipeline try block** | every cycle (no time gate); if the K-Props AN fetch/upsert throws before it, the outer catch skips HR grading that cycle | vsinAutoRefresh.ts:1886-1947 (VERIFIED — HR call at :1936-1944 is inside the try opened at :1886) |
| Multi-market backtest (incl. HR_PROP market) | MLB cycle, only when ≥1 game transitions to FINAL | event-driven | vsinAutoRefresh.ts:1952-1994 (VERIFIED) |
| Team HR columns (`runMlbModelForDate`) | `startMlbModelSyncScheduler` (today+tomorrow) + MLBCycle fallback run | every 5 min, idempotent via `modelRunAt IS NULL` guard | mlbModelRunner.ts:2673, 2799, 1589-1594; vsinAutoRefresh.ts:1860-1884 (VERIFIED) |
| Input seeders | pitcher stats 24 h; team batting splits 24 h; park factors 7 d (no hrFactor); Statcast **never** (manual script only) | see citations | vsinAutoRefresh.ts:2116-2129, 2160-2174, 2176-2190; populateStatcastISO.mjs (no scheduler ref, VERIFIED grep) |

Doc drift: `mlbHrPropsBacktestService.ts:7` says "Called by MLBCycle every 10 minutes"; the actual
cycle is 5 minutes (VERIFIED — vsinAutoRefresh.ts:1361).

---

## Patch history relevant to this market

| Script | What it did | In live path now? |
|---|---|---|
| `server/backfillHrFactor.mjs` | One-time population of `mlb_park_factors.hrFactor` from a **snapshot** of PARK_FACTORS (:22-34). Snapshot **differs from current** MLBAIModel.py values (COL 119 vs 122, CIN 108 vs 112, NYA 108 vs 109, SEA 94 vs 93, OAK 93 vs 91 …) (VERIFIED both files). | Its output **is** the live player-model park input (mlbHrPropsModelService.ts:295-308); nothing refreshes it (seedParkFactors.ts:218-237 omits hrFactor). Whether DB values still match the stale snapshot: UNKNOWN (census). |
| `server/recalibrateHrProps.mjs` | Self-modifying recalibration: loads graded rows, computes MLE factor `current × (actual_rate/avg_model)`, Brier grid-search 0.30-1.20 step 0.02 (:116-138), threshold scan 0.08-0.20 (:152-174), then **rewrites** `HR_CALIBRATION_FACTOR` in mlbHrPropsModelService.ts (:198-222) and `hr_base_rate` in mlbDriftDetector.ts (:224-236). | The applied result is live: factor 0.5317 with "n=2438" comment (mlbHrPropsModelService.ts:97-98) and drift hr_base_rate 0.10090238 / sampleSize 2438 (mlbDriftDetector.ts:218) — both match the script's templates, so an execution on an n=2,438 sample dated 2026-05-11 was applied (INFERRED from the template match at recalibrateHrProps.mjs:206, 229 + comments at mlbHrPropsModelService.ts:68-77). The header's claimed n=10,039 rerun (:4-8) apparently **never landed** — the live comment still says n=2438 and the replace regex (:205) would have matched (INFERRED). Known defects: hard-coded `currentFactor = 0.720` (:107) is now wrong (live 0.5317) so any rerun mis-scales; ROI assumes −110 pricing for +250..+900 props (:165); `r.anNoVig` filter bug — column is `anNoVigOverPct`, so the filter is vacuous (:147) (all VERIFIED). |
| `server/backfillHrProps.mjs` | Backfill for 27 dates 2026-04-11 → 05-10: re-scrape AN (mostly empty for historical dates), upsert, and grade completed games with a partial-name fallback (:199-209). Header claims a "Step 5 model" run (:12) that the code does not contain (VERIFIED — main() :230-312 has no model call). | Historical data only; grading logic overlaps but is not identical to the live service. |
| `server/backfillHrPropsApr789.mjs` | Synthetic rows for Apr 7-9 2026 from box scores: bookLine 0.5, no odds, no verdict, actualHr populated, **modelRunAt set to backfill time** (:108-124). | Historical rows only. These are the only rows with modelRunAt set (VERIFIED grep), which interacts badly with getHrPropsBacktestReport's filter (see Exposure). |
| `server/auditHrPropsGap.mjs`, `checkHrPropsCoverage.mjs`, `findMissingHrDates.mjs` | Read-only gap/coverage audits (VERIFIED — headers) | No. |
| `scripts/runApr11.mjs` | One-off full pipeline for 2026-04-11 incl. HR scrape + model (VERIFIED — :67-75) | No. |
| `server/patchRlSigmoid.py` | Patched FG run-line evaluation in mlbMultiMarketBacktest.ts — **not HR-related** (VERIFIED — header :1-7) | N/A. |
| `server/runFullHistoricalBacktest.mjs` | Ad-hoc season report; HR section computes Brier/accuracy from all graded rows and ROI at −110 (:59-64, 486-517 VERIFIED) | Analysis only. |

---

## Open questions (UNKNOWN)

1. **DB `hrFactor` current values** — do they still equal the stale backfill snapshot (COL 1.19 etc.),
   or were they ever re-run after MLBAIModel.py's dict was updated? (census: `SELECT teamAbbrev,
   hrFactor FROM mlb_park_factors`).
2. **Statcast freshness** — `mlb_players.statcastFetchedAt` max value; when was populateStatcastISO.mjs
   last executed? No scheduler exists in code.
3. **getHrPropsReport emptiness** — count of rows with `modelPHr IS NOT NULL AND modelRunAt IS NOT
   NULL`; if 0, the MlbBacktest HR panel has been silently empty since launch.
4. **Was the n=10,039 recalibration ever run?** Live comments say n=2438; confirm from
   `mlb_hr_props` graded-row counts over time and any deploy logs.
5. **Execution history of the one-off scripts** (backfillHrFactor, backfills, runApr11) — nothing in
   the repo invokes them; only shell history/deploy logs can confirm when they ran.
6. **Does anything downstream consume `games.modelBothHrPct` etc.** (Dime feed rebuild, exports)?
   No client reads them today.
7. **verdict='UNDER' rows in DB** — model never writes UNDER, but the backfill grader handles it
   (backfillHrProps.mjs:214); do any UNDER rows exist from an older model version?
8. **AN_TEAM_ID_TO_ABBR drift** — team_id constants are hard-coded (ActionNetworkHRPropsAPI.py:80-111);
   have any AN ids changed (players silently side='home')?

---

## Finding candidates

| Sev | Title | Evidence |
|---|---|---|
| P1 | HR backtest report filters on `modelRunAt`, which the live pipeline never writes — report is empty or synthetic-only | mlbFullBacktestEngine.ts:668-670 (filter); mlbHrPropsModelService.ts:433-435 (set list lacks modelRunAt); backfillHrPropsApr789.mjs:113 (only writer, rows lack modelPHr); routers.ts:1562-1566; MlbBacktest.tsx:127 |
| P1 | Multi-market backtest can never grade an HR prop: CONFIDENCE_THRESHOLD 0.65 vs modelPHr hard clamp ≤0.45 (post-P6 max ≈0.22) → every row NO_ACTION/MISSING_DATA | mlbMultiMarketBacktest.ts:48, 767-769; mlbHrPropsModelService.ts:79 (MAX_P_HR 0.45), :73-77 (max ~0.22 note) |
| P1 | Two competing park-HR-factor sources: player model reads a one-time DB backfill of an **older** PARK_FACTORS snapshot; team model reads the updated Python dict; no refresh path exists | backfillHrFactor.mjs:22-34 vs MLBAIModel.py:225-260 (differing values); seedParkFactors.ts:218-237 (omits hrFactor); mlbHrPropsModelService.ts:295-308 |
| P2 | Statcast power inputs (iso/barrel/hard-hit) populated only by a manual one-off script — no scheduler → silent staleness of the player model's main individual signal | populateStatcastISO.mjs:1-20; repo-wide grep shows zero scheduler/caller references |
| P2 | recalibrateHrProps.mjs hard-codes `currentFactor = 0.720` while live factor is 0.5317 — re-running the committed recalibration tool would compute a wrong factor | recalibrateHrProps.mjs:107; mlbHrPropsModelService.ts:97 |
| P2 | `evOver` formula `edge/(1−modelPHr)·100` matches neither the schema's documented formula nor standard EV at book odds | mlbHrPropsModelService.ts:422; drizzle/schema.ts:1487 |
| P2 | hr9 is per-27-**AB** (`HR/AB*27`) but consumed as a per-PA rate and multiplied by 4.22 PA/game → structural ~10-13% lambda inflation silently absorbed into the calibration factor | seedTeamBattingSplits.ts:13, 100; mlbHrPropsModelService.ts:147, 170 |
| P2 | Multi-market HR evaluation mixes odds columns: over from `consensusOverOdds`, under from never-written `fdUnderOdds` → no-vig/edge/ev always null in mlb_game_backtest HR rows | mlbMultiMarketBacktest.ts:732-736; grep: no fdUnderOdds writer |
| P2 | HR grading is nested inside the K-Props try block — an AN K-props failure skips HR actualHr updates for that cycle | vsinAutoRefresh.ts:1886 (try opens), :1936-1944 (HR call), :1945-1947 (catch) |
| P2 | Recalibration threshold/ROI analysis prices HR props at −110 (`wins*(100/110)`) though they pay +250..+900 → threshold choice (0.18) optimized on a wrong objective | recalibrateHrProps.mjs:165-166; runFullHistoricalBacktest.mjs:59-64 |
| P3 | Owner UI "FD ODDS" cell bound to dead `fdOverOdds` column — always renders "—" | TheModelResults.tsx:768, 834-836; schema.ts:1472 |
| P3 | recalibrate `verdictRows` filter references non-selected column `anNoVig` (`undefined !== null` always true) — log line misleading | recalibrateHrProps.mjs:147-148 (vs SELECT at :42-44) |
| P3 | Team HR market ignores opposing pitcher and weather; `weather_hr_adj` computed but never consumed; both-HR assumes independence between teams | MLBAIModel.py:1187-1204 (lambda inputs), 2170-2180/2198 (weather dead), 1198-1202 (independent Poissons) |
| P3 | lineupConfirmed/battingOrder computed by the Python scraper but dropped at upsert (no columns) — model prices players who may not start; no bench filter | ActionNetworkHRPropsAPI.py:316-335; mlbHrPropsScraper.ts:231-251; census/schema-columns.tsv mlb_hr_props rows |
| P3 | Live grading has exact-normalized-name matching only (skips unmatched → actualHr NULL forever); backfill script has a partial-match fallback — inconsistent grading | mlbHrPropsBacktestService.ts:183-189; backfillHrProps.mjs:199-209 |
| P3 | Doc/comment drift: schema says modelPHr "from MLBAIModel.py" (actual writer is TS service); backtest header says 10-min cycle (actual 5); scraper `inserted` counts updates | drizzle/schema.ts:1481; mlbHrPropsBacktestService.ts:7 vs vsinAutoRefresh.ts:1361; mlbHrPropsScraper.ts:252 |
| P3 | Unmapped AN team_id → playerTeam "?" silently classified side='home' | ActionNetworkHRPropsAPI.py:310-311; mlbHrPropsScraper.ts:230 |
