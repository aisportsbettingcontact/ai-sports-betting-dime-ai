# Phase 0 — Ingestion & Scheduling: schedule, actuals, odds, lineups

Audit session: 2026-07-25. Evidence classes: **VERIFIED** (code read this session, file:line cited),
**INFERRED** (reasoned from verified facts, reasoning stated), **UNKNOWN** (cannot be established from repo code).
DB column ground truth: `docs/audits/mlb-model-audit-2026/census/schema-columns.tsv` (read this session — referenced as "census TSV").

---

## Overview

The MLB ingestion layer maintains **two parallel game universes**:

1. **`games`** — the operational table the model, feed, and backtests run against. One row per game keyed by
   auto-increment `id`, with unique keys on `mlbGamePk` (census TSV: `games.mlbGamePk int UNI`) and on
   `(gameDate, awayTeam, homeTeam, gameNumber)` (`games_matchup_unique`, drizzle/schema.ts:641). Teams stored as MLB
   abbreviations ("NYY"). Odds, splits, lineups, live scores, actuals, and Brier scores are all UPDATEs onto these rows.
2. **`mlb_schedule_history`** — a display/trends table fed from the Action Network v1 scoreboard API, keyed by
   `anGameId` (unique, drizzle/schema.ts:1808). Teams stored as AN slugs/abbrevs. Holds DK NJ pre-game odds, final
   scores, derived ATS/O/U results, and the `dkClosing*` + `closingLineLockedAt` closing-line columns. It powers the
   Last-5 / Situational / H2H panels — it is **not** read by the model runner (VERIFIED for the files in this section;
   the only consumers found are the query functions in mlbScheduleHistoryService.ts:771–1185 and
   mlbNightlyTrendsRefresh.ts:36).

The two universes are linked only *implicitly by date + team*, never by a foreign key. `games` links to the MLB Stats
API via `mlbGamePk`; `mlb_schedule_history` links to Action Network via `anGameId`. There is no code that joins them
(VERIFIED absence: no query in the read files joins the two tables).

Actual scores reach `games` by **two overlapping paths**: `mlbScoreRefresh.refreshMlbScores()` (every MLB cycle,
writes `actualAwayScore/actualHomeScore/actualF5*/nrfiActualResult` at final) and
`mlbOutcomeIngestor.ingestMlbOutcomes()` (nightly, writes `actualFgTotal/actualF5Total/actualNrfiBinary` + 5 Brier
scores + `outcomeIngestedAt`).

Scheduling is mid-migration between three mechanisms: (a) legacy Manus Heartbeat (being retired), (b) in-process
`setInterval` schedulers gated by `DISABLE_BACKGROUND_JOBS` (server/_core/index.ts:840–926), and (c) GitHub Actions
workflows curling `POST /api/cron/*` and `/api/scheduled/*` (server/cron/cronRoutes.ts). **Several MLB-critical jobs
exist only in mechanism (b)** — schedule-history refresh, closing-line capture, outcome ingestion/drift, nightly
trends — and have no GitHub Actions equivalent (VERIFIED: workflow directory listing, see § Scheduling).

---

## Data inputs & ingestion

### 1. Action Network v1 scoreboard → `mlb_schedule_history`

- **Source**: `https://api.actionnetwork.com/web/v1/scoreboard/mlb?period=game&bookIds=68&date=YYYYMMDD`
  (mlbScheduleHistoryService.ts:65, 238). Browser-spoof headers (:80–85), axios timeout 15,000 ms (:248).
- **Book selection**: DK NJ `book_id=68` requested, but extraction walks a fallback chain `[68, 15, 21, 30]`
  and takes the **first book with `ml_away` populated** (:79, :339–346). Comment claims book 68 disappears
  retroactively for completed games after ~2 days and that "all books carry the same DraftKings line family —
  acceptable fallback" (:76–78) — note book 21 is Pinnacle per the comment at :77 (VERIFIED comment; claim itself
  is dubious, see Finding F2).
- **Home/away assignment**: authoritative via `game.away_team_id`/`home_team_id`, NOT array position
  (:277–314; the positional bug was real — "VERIFIED: Apr 10 PHI@ARI" comment :281).
- **Derivations at ingest** (only when `status === "complete"`):
  `awayRunLineCovered = awayScore + spread_away > homeScore` (:203–210);
  `homeRunLineCovered = !awayRunLineCovered` (:396–397);
  `totalResult = OVER/UNDER/PUSH vs dk.total` (:215–225); `awayWon = awayScore > homeScore` (:400–403).
- **Write path**: `upsertMlbScheduleHistory()` — `INSERT ... ON DUPLICATE KEY UPDATE` on unique `anGameId`,
  batches of 50 (:489). The update-set **overwrites on every refresh**: `gameStatus, awayScore, homeScore, awayWon,
  dkAwayRunLine, dkHomeRunLine, dkAwayRunLineOdds, dkHomeRunLineOdds, awayRunLineCovered, homeRunLineCovered,
  dkAwayML, dkHomeML, dkTotal, dkOverOdds, dkUnderOdds, totalResult, lastRefreshedAt` (:497–516).
  The `dkClosing*` columns are **not** in the update set, so locked closing lines survive refreshes (VERIFIED).
  But the "pre-game" `dk*` columns are last-write-wins from whatever book the fallback chain currently returns
  (see Finding F2).
- **Closing-line capture**: `captureClosingLines()` (:1208–1364). Fetches today's AN v1 slate; filters
  `status === "inprogress" || real_status === "inprogress"` (:1241–1243); for each in-progress game whose DB row has
  `closingLineLockedAt IS NULL`, extracts **strictly book 68 — no fallback chain** (:1292) and writes all 9
  `dkClosing*` columns + `closingLineLockedAt = Date.now()` keyed by `anGameId` (:1321–1336). Idempotent
  (already-locked skip :1282–1288). If DK NJ odds are absent at first pitch, the game is skipped (`noOdds`) and will
  be retried each 5-min tick while still in-progress; once final it can never lock (INFERRED: filter at :1241 excludes
  complete games, and nothing else writes `dkClosing*` — grep found `captureClosingLines` called only from
  mlbScheduleHistoryScheduler.ts:265).
- **DB column note**: census TSV shows `mlb_schedule_history.game_type varchar(20)` — this column does **not** exist
  in drizzle/schema.ts:1805–1895 and is written by no TypeScript code. Only `scripts/mlbBacktestGrader.py:978`
  (`WHERE sh.game_type IN ('regular_season','postseason')`) and `scripts/debug_an_dh.py:53` reference it (VERIFIED
  repo-wide grep). Whoever populates it is UNKNOWN (likely a manual migration/patch — census question).

### 2. Action Network v2 scoreboard → `games` odds (`refreshAnApiOdds`)

- **Source**: `fetchActionNetworkOdds()` in actionNetworkScraper.ts:276, URL
  `https://api.actionnetwork.com/web/v2/scoreboard/{sport}?bookIds=15,30,68,69,71,75,79&date=...&periods=event`
  (:233, :287). `DK_NJ_BOOK_ID = 68` (:239), `OPEN_BOOK_ID = 30` (:249), `FANDUEL_NJ_BOOK_ID = 69` (:244).
  Note: mlbScheduleHistoryService.ts:12 claims "v2 API returns HTTP 400 for all requests (platform-level issue)"
  while this live path uses v2 — the two claims are era-inconsistent; current v2 health is UNKNOWN.
- **Consumer**: `refreshAnApiOdds(dateStr, ["mlb"], source)` in vsinAutoRefresh.ts:812–1267. Match by AN url_slug →
  MLB abbrev → `games` row on that date, both team orderings tried (:884–891).
- **Odds freeze**: rows with `gameStatus ∈ {live, final}` are never overwritten — pre-game line locked in `games`
  (:907–917).
- **Atomic DK-vs-open switch**: use DK NJ for all 9 fields only if all 3 markets complete (spread+odds, total+O/U
  odds, both MLs); otherwise use Opening line for all 9; writes `games.oddsSource = 'dk' | 'open'` (:941–982).
- **LAYER2 ML guard** (MLB only): if scraped run-line sign contradicts the ML favorite, the run line is forced to
  ±1.5 matching ML direction and the RL odds are swapped (:1011–1057).
- **Write path**: `updateAnOdds(gameId, {...})` (db.ts, called at vsinAutoRefresh.ts:1090–1120) writes
  `games.awayBookSpread/homeBookSpread/awaySpreadOdds/homeSpreadOdds/bookTotal/overOdds/underOdds/awayML/homeML/
  oddsSource`, MLB dual-write to `awayRunLine/homeRunLine/awayRunLineOdds/homeRunLineOdds` (:1058–1063), and the
  `open*` reference columns when present (:1111–1119).
- **Side effects inside the odds write** (important for the model section):
  - `updateBookOdds` mirrors `modelTotal = bookTotal` whenever bookTotal changes (db.ts:901–907) — the published
    "model total line" is by construction the book line.
  - `updateAnOdds` contains a LAYER3 ML-direction guard that **clears `modelRunAt` and corrects
    `awayModelSpread/homeModelSpread`** when the model spread contradicts the new ML (db.ts:1490–1543, log text
    :1500–1503), then vsinAutoRefresh fires an immediate targeted model re-run
    (`runMlbModelForDate(date, { targetGameIds:[id], forceRerun:true })`, vsinAutoRefresh.ts:1127–1149). A secondary
    "RL SIGN SYNC" self-heal flips stored model spread signs to match the book sign (db.ts:1509–1539). **Odds
    ingestion can therefore rewrite model output columns.**
- **odds_history snapshot**: after every successful per-game odds update, `insertOddsHistory()` (db.ts:1557–1648)
  inserts one row: `gameId, sport, scrapedAt (epoch ms), source ('auto'|'manual'), awaySpread/awaySpreadOdds/
  homeSpread/homeSpreadOdds/total/overOdds/underOdds/awayML/homeML, lineSource ('dk'|'open'), spreadAwayBetsPct/
  spreadAwayMoneyPct/totalOverBetsPct/totalOverMoneyPct/mlAwayBetsPct/mlAwayMoneyPct` (splits nulled via a 0/0
  "market not open" guard, vsinAutoRefresh.ts:1157–1192). **No unique key** on odds_history (census TSV: only PRI id;
  railway-deploy.md:87–89 confirms) — duplicate snapshots from concurrent writers are silent.
  Note the snapshot stores the **pre-LAYER2** values (`rAwaySpread.value` etc., :1170–1183), so a snapshot's RL sign
  can differ from what was written to `games` when LAYER2 fired (VERIFIED by comparing :1094–1100 with :1175–1178).
- **Cadence** (see § Scheduling): MLB odds refresh runs inside both `runMlbCycleOnce()` (today+tomorrow,
  vsinAutoRefresh.ts:1734–1753) and `runVsinRefresh()` (today+tomorrow, :1309–1324) — two independent triggers
  writing the same rows and snapshotting odds_history.
- **Startup backfill**: `backfillOddsHistoryLineSource()` (db.ts:1692) sets `lineSource` on historical NULL rows from
  `games.oddsSource`, once at startup, behind the background-jobs guard (server/_core/index.ts:889–894).

### 3. VSiN betting splits → `games` splits columns

- `refreshMlb(todayStr)` (vsinAutoRefresh.ts:593–795) scrapes the VSiN MLB betting-splits page
  (`scrapeVsinMlbBettingSplits`, :607), maps VSiN slugs → abbrevs with today/tomorrow map partitioning (:638–687),
  and writes via `updateBookOdds`: `spreadAwayBetsPct, spreadAwayMoneyPct, rlAwayBetsPct, rlAwayMoneyPct,
  totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct` (:753–765). A 0/0 guard skips run-line splits
  when the market hasn't opened (:742–752). Swapped-order games have percentages flipped 100−x (:722–733).
  MLB `inserted` is always 0 — VSiN never creates games rows (:595).

### 4. MLB Stats API live scores → `games` (mlbScoreRefresh.ts)

- **Source**: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=linescore,probablePitcher(note),decisions,broadcasts(all)&language=en` (:57–64, :315–320).
- **Status mapping**: Preview→`upcoming`, Live→`live`, Final→`final`; detailedState containing
  postponed/suspended/cancelled **overrides to `postponed`** (:217–241). Note: suspended is collapsed into
  `postponed` — see Finding F4.
- **Matching**: primary `mlbGamePk` exact; fallback `awayAbbrev@homeAbbrev` map (:561–585). Abbrev normalization
  `AZ→ARI`, `OAK→ATH` (:298–304).
- **Writes** (only when changed): via `updateNcaaStartTime` — `gameStatus, awayScore, homeScore, gameClock` (:651–658).
  On final with scores, a direct update writes `actualAwayScore, actualHomeScore`, plus `actualF5AwayScore,
  actualF5HomeScore` (sum of linescore innings 1–5, final games with ≥5 innings only, :414–426) and
  `nrfiActualResult ('NRFI'|'YRFI'`, inning 1 both zero, :436–445) (:664–686), with a read-back verification
  (:687–730).
- **Pitchers**: probable pitchers written to `awayStartingPitcher/homeStartingPitcher` + `*PitcherConfirmed=true`,
  **blocked** if `mlb_lineups` has a different Rotowire pitcher name (doubleheader-G2 protection, :736–779).
- **Newly-final detection**: gamePks transitioning to final this cycle are returned and trigger the immediate
  K-Props backtest and multi-market backtest in the cycle (:600–607; vsinAutoRefresh.ts:1928–1994).

### 5. MLB Stats API linescore → outcomes + Brier (mlbOutcomeIngestor.ts)

- **Source**: `/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=linescore` (:262–265).
- **Eligibility**: DB games with `gameDate = dateStr AND sport='MLB' AND gameStatus='final'` (:404–411); skip when
  `outcomeIngestedAt` set unless `force` (:488–506); match primary `mlbGamePk`, fallback normalized team abbrevs
  (:509–534, normalization map :838–857); skip when API says not final (Final excluding
  Postponed/Suspended/Cancelled, :288–290).
- **Derived**: `actualFgTotal = away+home final runs`; `actualF5Total = sum innings 1–5`
  (requires ≥5 innings, :303–311); `actualNrfiBinary = 1 if inning-1 both zero else 0` (:313–319).
- **Brier** (formula and push rules — see parameters table): 5 scores written per game (:606–622).
- **Write**: single UPDATE per game on `games.id`: `actualFgTotal, actualF5Total, actualNrfiBinary, brierFgTotal,
  brierF5Total, brierNrfi, brierFgMl, brierF5Ml, outcomeIngestedAt=now` (:609–622) + read-back verify (:626–649).
  Note fields computed as null are passed as `undefined` (:612–619) — a forced re-ingest cannot null-out a previously
  wrong value, it can only overwrite with a new number (INFERRED from drizzle semantics: undefined = column omitted).
- **Post-ingest**: `checkF5ShareDrift()` (mlbDriftDetector — other audit section) + F5-ML coverage audit
  (`modelF5AwayWinPct NOT NULL AND f5AwayML IS NULL` count, :719–737) + `notifyOwner` Brier summary (:739–782).

### 6. Rotowire lineups → `mlb_lineups` (+ Google Sheet mirror)

- **Scraper**: `https://www.rotowire.com/baseball/daily-lineups.php` (+ `?date=tomorrow`)
  (rotowireLineupScraper.ts:141–143); parses pitchers (name/hand/ERA/rotowireId/confirmed), 9-man batting orders,
  weather (icon/temp/wind/precip/dome), umpire.
- **DB upsert**: `upsertLineupsToDB(games, targetDate)` (:647–809). Match to `games` by
  `awayTeam+homeTeam+sport='MLB'` within `[targetDate, targetDate]` exact-date window (7-day window only when
  targetDate omitted) with **`.limit(1)`** (:722–734) — see doubleheader Finding F5. Resolves `mlbamId`s by
  normalized-name lookup against `mlb_players` (:679–708). Writes one `mlb_lineups` row per gameId via
  `upsertMlbLineup` — columns per census TSV (`gameId, scrapedAt, away/homePitcherName|Hand|Era|MlbamId|RotowireId|
  Confirmed, away/homeLineup (JSON text), away/homeLineupConfirmed, weather*, umpire`). No unique constraint on
  `mlb_lineups` (railway-deploy.md:87).
- **Lineup watcher**: `runLineupWatcher()` (mlbLineupsWatcher.ts:296) — SHA-256 fingerprint over
  `awayPitcherName|hand|homePitcherName|hand|awayLineupCanonicalJSON|homeLineupCanonicalJSON` (:127–175; canonical =
  sorted by battingOrder, fields b/pos/n/bats only). Trigger rules (:7–59): CASE A first lineup → model immediately;
  CASE B hash changed and not both-confirmed → re-model; CASE C unchanged → no-op; CASE D both
  `lineupConfirmed` → permanent stop guard. Modelability gate: both pitchers non-null AND `bookTotal+awayML+homeML`
  present (:45–51, :210–239). Bookkeeping columns: `lineupHash, lineupVersion, lineupModeledAt,
  lineupModeledVersion` (:245–285).
- **Google Sheet mirrors** (display only, spreadsheet `1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw`):
  - `syncRotowireLineupTabs()` (rotowireLineupSheetSync.ts) via `POST /api/scheduled/roto-lineups`
    (rotowireLineupHeartbeat.ts:56, CRON_SECRET-gated, in-memory run lock).
  - `syncFangraphsLineupTabs()` (fangraphsLineupSync.ts:1–60 — despite the name, sources the **MLB Stats API**, not
    FanGraphs) via `POST /api/scheduled/fg-lineups` (fangraphsLineupHeartbeat.ts:37). Writes `MM-DD-YYYY LINEUPS`
    tabs with snapshot→clear→write→read-back→rollback safeguards.
  - `scrapeFangraphsLineups()` (fangraphsScraper.ts) also feeds an in-process cache pre-warmed at startup + every
    30 min (server/_core/index.ts:910–925) for the LINEUPS tab UI.

### 7. F5 / NRFI / props odds (same-day markets)

- `scrapeAndStoreF5Nrfi(dateStr)` — FanDuel NJ (`book_id=69`) via Action Network; writes `games.f5*` book odds and
  `nrfiOverOdds/yrfiUnderOdds` (mlbF5NrfiScraper.ts:5–12, :118–226). Gated to after 7:00 AM EST inside the cycle
  (vsinAutoRefresh.ts:2000–2020).
- K-props (AN lines → `mlb_strikeout_props`) and HR props (consensus → `mlb_hr_props`) run in the same cycle
  (vsinAutoRefresh.ts:1885–2063) — details belong to the props audit section.

### 8. Postponements / doubleheaders / suspensions (mlbPostponedTracker.ts)

- **Rescheduled detection** (`detectRescheduledGames`, :161–328): loads `games` rows with
  `gameStatus ∈ {postponed, suspended}` (:181–196); fetches MLB Stats API schedule for tomorrow→+14 days (:211–223);
  matches by team pair; a different `gamePk` on a future date ⇒ RESCHEDULED. **Action taken: log + `notifyOwner`
  only** (:296–317). The claim "the new game(s) will be auto-inserted by the normal mlbScheduleHistoryScheduler"
  (:14–15, :306) refers to `mlb_schedule_history`, **not** `games` — nothing inserts the rescheduled game into
  `games` (see Finding F6). `games.rescheduledFrom` (census TSV) is written by **nothing** in the repo (VERIFIED
  repo-wide grep: only the census TSV mentions it).
- **Suspended resume** (`detectResumedSuspendedGames`, :341–494): for DB rows with `gameStatus='suspended'`, polls
  per-gamePk linescore/boxscore/schedule; when Final, writes `gameStatus='final', awayScore, homeScore,
  gameClock='Final'` (:439–447) + notify. But no automated path ever writes `'suspended'` (see Finding F4).
- **Doubleheaders**: `games` has `doubleHeader varchar(2) default 'N'` and `gameNumber tinyint default 1`
  (drizzle/schema.ts:337–339), and `gameNumber` participates in the matchup unique key (:641). No live ingestion code
  reads or writes `doubleHeader/gameNumber` (VERIFIED grep — only the field-strip list routers.ts:106). All team-pair
  fallback matches (`mlbScoreRefresh.ts:567,584`, `rotowireLineupScraper.ts:722–734`, `mlbPostponedTracker.ts:232`,
  `mlbOutcomeIngestor.ts:520–534`) collapse DH twin bills onto whichever row matches first; only the
  `mlbGamePk`-primary matches are DH-safe.

### 9. Game-universe creation (who inserts `games` rows?)

- `insertGames()` (db.ts:349–356, upsert on the matchup unique key) is called from exactly three places (VERIFIED
  grep): the owner **model-file upload** (`files.upload` tRPC, routers.ts:203–268 → `parseFileBuffer`; fileParser.ts
  detects MLB from filename at :294 and does **not** parse any gamePk — grep for `gamePk` in fileParser.ts is empty),
  NBA/NHL schedule-only inserts (vsinAutoRefresh.ts:389, 556), and the All-Star seed (mlbAllStarGameSync.ts:181).
- **No live code path creates the daily MLB slate or populates `games.mlbGamePk`** — `updateBookOdds` *accepts*
  `mlbGamePk` (db.ts:892, 931) but no caller passes it (VERIFIED grep of all `updateBookOdds` call sites).
  Historical seeding was done by patch scripts (`scripts/seedHistoricalMlb.py` — 2024/2025 finals with gamePk,
  Manus-era `/home/ubuntu` paths). How today's rows with `mlbGamePk`, `venue`, `broadcaster`, `startTimeEst` get
  created is **UNKNOWN** — the strongest hypothesis is the retired Manus-side workflow or an owner sheet/CSV flow not
  present in this repo. This is a census question (see § Open questions Q1).

---

## Model mechanics (parameters table)

This section has no Monte-Carlo model; its "mechanics" are the derivation rules, thresholds, and cadences that
determine every ingested number. All values read from code this session (VERIFIED).

| Parameter | Value | File:line |
|---|---|---|
| AN v1 scoreboard URL (sched-history) | `api.actionnetwork.com/web/v1/scoreboard/mlb?period=game&bookIds=68&date=YYYYMMDD` | server/mlbScheduleHistoryService.ts:65,238 |
| DK NJ book id | 68 | mlbScheduleHistoryService.ts:72; actionNetworkScraper.ts:239 |
| Sched-history odds fallback chain | [68, 15, 21, 30], first with `ml_away` non-null | mlbScheduleHistoryService.ts:79,339–346 |
| Closing-line book | 68 only, **no fallback** | mlbScheduleHistoryService.ts:1292 |
| AN fetch timeout | 15,000 ms | mlbScheduleHistoryService.ts:248,1230 |
| Season floor (2026 panels) | `2026-03-25` | mlbScheduleHistoryService.ts:70; mlbNightlyTrendsRefresh.ts:42 |
| H2H lookback floor | `2023-03-30` | mlbScheduleHistoryService.ts:71 |
| Season boundaries table | 2023: 03-30→11-01; 2024: 03-20→10-30; 2025: 03-18→11-01; 2026: 03-25→null | mlbScheduleHistoryScheduler.ts:40–45 |
| Sched-history upsert batch size | 50 | mlbScheduleHistoryService.ts:489 |
| Per-date API delay (rolling/backfill) | 400 ms default | mlbScheduleHistoryService.ts:583,630 |
| Startup backfill depth | 60 days | mlbScheduleHistoryScheduler.ts:160 |
| Sched-history refresh interval | 4 h, first at 6:00 AM "EST", skip hours 0–5 | mlbScheduleHistoryScheduler.ts:217–243 |
| Closing-line capture cadence | every 5 min, window h≥10 or h<2 ("10AM–2AM EST") | mlbScheduleHistoryScheduler.ts:249–280 |
| Scheduler EST offset | fixed UTC−5, **no DST** ("DST is not applied to avoid drift") | mlbScheduleHistoryScheduler.ts:61,69,77 |
| Away RL cover rule | `awayScore + spread_away > homeScore` | mlbScheduleHistoryService.ts:203–210 |
| Total result rule | combined > total → OVER; < → UNDER; = → PUSH | mlbScheduleHistoryService.ts:215–225 |
| Fav/dog classification | ML < 0 = favorite; null/NaN ML excluded from both pools | mlbScheduleHistoryService.ts:1050–1056 |
| Situational stats game cap | limit 162 | mlbScheduleHistoryService.ts:994 |
| Last-N panel size | 5 | mlbScheduleHistoryService.ts:773,894–897 |
| Brier formula | `(p/100 − o)²`, p∈[0,100] validated to [0,1], 6-dp round | mlbOutcomeIngestor.ts:156–167 |
| Brier push rule (FG/F5 total) | actual == book line ⇒ null (no score) | mlbOutcomeIngestor.ts:200–221 |
| Brier ML tie rule | FG/F5 away==home ⇒ null (F5 ties common) | mlbOutcomeIngestor.ts:229–248 |
| F5 actual rule | sum linescore innings 1–5; requires ≥5 innings | mlbOutcomeIngestor.ts:303–311; mlbScoreRefresh.ts:414–421 |
| NRFI binary rule | inning-1 away==0 AND home==0 ⇒ 1 else 0 | mlbOutcomeIngestor.ts:313–319; mlbScoreRefresh.ts:436–445 |
| Outcome-final definition | abstract "Final" AND detailed ∉ {Postponed, Suspended, Cancelled} | mlbOutcomeIngestor.ts:288–290 |
| Team-abbrev normalization (outcome) | SFG→SF, SDP→SD, KCR→KC, TBR→TB, CHW→CWS, WAS→WSH, AZ→ARI | mlbOutcomeIngestor.ts:838–857 |
| Team-abbrev normalization (scores) | AZ→ARI, OAK→ATH | mlbScoreRefresh.ts:298–304 |
| Nightly outcome pipeline time | 00:30 PST (tick check hour==0 && minute==30), target = yesterday PST | mlbOutcomeAndDriftScheduler.ts:231–244 |
| Monthly recalibration time | 1st of month 03:00 PST exactly | mlbOutcomeAndDriftScheduler.ts:213–228 |
| Outcome scheduler tick | 60,000 ms, `.unref()` | mlbOutcomeAndDriftScheduler.ts:270–274 |
| Drift baseline / threshold (per comments) | BASELINE_F5_SHARE=0.5618, DRIFT_THRESHOLD=0.02, 50-game rolling window, 24 h cooldown, needs 20+ games | mlbOutcomeAndDriftScheduler.ts:12–15; mlbOutcomeIngestor.ts:710 (constants live in mlbDriftDetector.ts — other section) |
| VSiN/all-sports refresh interval | 5 min 24/7 (`INTERVAL_MS`) | vsinAutoRefresh.ts:26 |
| NBA/NHL score interval | 15 s (`SCORE_INTERVAL_MS`) | vsinAutoRefresh.ts:1360 |
| MLB cycle interval | 5 min 24/7 (`MLB_INTERVAL_MS`) | vsinAutoRefresh.ts:1361,2096–2101 |
| Odds range window | today + 6 days (`RANGE_DAYS_AHEAD = 6`) | vsinAutoRefresh.ts:29 |
| F5/NRFI + HR-props same-day gate | after 7:00 AM EST (12:00 UTC) | vsinAutoRefresh.ts:1996–2004,2022–2031 |
| Odds freeze rule (`games`) | skip update when `gameStatus ∈ {live, final}` | vsinAutoRefresh.ts:907–917 |
| DK-vs-open atomic switch | DK only if all 3 markets complete, else Open for all 9 fields; `oddsSource ∈ {dk, open}` | vsinAutoRefresh.ts:941–982 |
| LAYER2 ML guard | RL forced to ±1.5 matching ML sign; RL odds swapped when flipped | vsinAutoRefresh.ts:1024–1057 |
| modelTotal mirror | `modelTotal = bookTotal` on every bookTotal write | server/db.ts:901–907 |
| LAYER3 guard (odds path → model cols) | clears `modelRunAt`, corrects model spreads, triggers `forceRerun` targeted model run | db.ts:1490–1543; vsinAutoRefresh.ts:1122–1149 |
| odds_history read cap | 200 rows, newest first | db.ts:1654–1668 |
| AN v2 book ids (games odds) | 15,30,68,69,71,75,79 (Open=30, DK NJ=68, FD NJ=69) | actionNetworkScraper.ts:233–249 |
| BetTracker slate book ids | "15,30,123" (separate path) | actionNetwork.ts:52,55 |
| F5/NRFI odds book | FanDuel NJ book_id=69 via AN | mlbF5NrfiScraper.ts:5,126 |
| Lineup hash | SHA-256 over pitchers(name,hand)+canonical batting orders (b,pos,n,bats); weather/umpire excluded | mlbLineupsWatcher.ts:127–175,30–43 |
| Watcher stop guard | both `lineupConfirmed` ⇒ never re-model | mlbLineupsWatcher.ts:24–28,53–59 |
| Modelability gate | both pitcher names + bookTotal + awayML + homeML | mlbLineupsWatcher.ts:45–51 |
| Lineup DB match window | exact `targetDate` (7-day window only if omitted), `.limit(1)` | rotowireLineupScraper.ts:664–671,722–734 |
| Rotowire URLs | `rotowire.com/baseball/daily-lineups.php` (+`?date=tomorrow`) | rotowireLineupScraper.ts:141–143 |
| FG lineup cache refresh | startup +3 s, then every 30 min | server/_core/index.ts:910–925 |
| Postponed reschedule scan window | tomorrow → +14 days | mlbPostponedTracker.ts:211–219 |
| Status mapping overrides | detailed contains postponed/suspended/cancelled ⇒ `postponed` | mlbScoreRefresh.ts:217–241 |
| Nightly TRENDS time | 2:59 AM EST (fixed UTC−5), re-ingests yesterday+today, 400 ms delay | mlbNightlyTrendsRefresh.ts:7,482,357 |
| GH cron cadences | mlb-cycle `*/5`; scores `*/10`; vsin-odds `*/15`; fg-lineups `*/10`; roto-lineups `*/10`; mlb-asg `4,19,34,49 * * * *` | .github/workflows/cron-*.yml, mlb-asg.yml (schedule blocks) |
| Cron auth | `CRON_SECRET` Bearer / `x-cron-secret`, fail-closed 503, timing-safe compare | server/cron/cronAuth.ts:15–60 |
| Cron overlap protection | in-memory single-flight `CronJobRunner` per job, per process | server/cron/cronRunner.ts:43–131 |
| Replica law | `numReplicas: 1`; `DISABLE_BACKGROUND_JOBS=1` required on web-only replicas; no unique keys on odds_history/games/mlb_lineups | references/railway-deploy.md:85–111 |

---

## Projection → DB write path

This section produces no projections; its writes feed the projection pipeline. Exact write inventory
(table.column ← writer, key, when):

| Table.columns | Writer | Keyed by | When |
|---|---|---|---|
| `mlb_schedule_history.*` (all non-closing cols listed at service :497–516) | `upsertMlbScheduleHistory` | unique `anGameId` | every sched-history refresh/backfill |
| `mlb_schedule_history.dkClosing{AwayRunLine,HomeRunLine,AwayRunLineOdds,HomeRunLineOdds,Total,OverOdds,UnderOdds,AwayML,HomeML}, closingLineLockedAt, lastRefreshedAt` | `captureClosingLines` | `anGameId` | first 5-min tick after status→inprogress, once |
| `games.gameStatus, awayScore, homeScore, gameClock` | `refreshMlbScores` → `updateNcaaStartTime` | `games.id` (match: mlbGamePk → team-pair) | every MLB cycle / scores cron when changed |
| `games.actualAwayScore, actualHomeScore, actualF5AwayScore, actualF5HomeScore, nrfiActualResult` | `refreshMlbScores` direct update | `games.id` | on final with scores |
| `games.awayStartingPitcher, homeStartingPitcher, awayPitcherConfirmed, homePitcherConfirmed` | `refreshMlbScores` → `updateBookOdds` (Rotowire-override-guarded) | `games.id` | when API probable differs |
| `games.awayBookSpread, homeBookSpread, awaySpreadOdds, homeSpreadOdds, bookTotal(+modelTotal mirror), overOdds, underOdds, awayML, homeML, oddsSource, awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds, open*` | `refreshAnApiOdds` → `updateAnOdds` | `games.id` (AN slug→abbrev→date match) | every mlb-cycle (5 min) + vsin-odds (15 min), frozen at live/final |
| `games.awayModelSpread, homeModelSpread, modelRunAt(cleared)` | LAYER3/RL-SIGN-SYNC inside `updateAnOdds` | `games.id` | when odds contradict stored model direction |
| `games.spreadAwayBetsPct, spreadAwayMoneyPct, rlAwayBetsPct, rlAwayMoneyPct, totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct` | `refreshMlb` (VSiN) → `updateBookOdds` | `games.id` | every mlb-cycle + vsin-odds |
| `odds_history` (full row incl. `lineSource`, splits) | `insertOddsHistory` | none (append-only, no unique key) | after every per-game odds update |
| `odds_history.lineSource` (historical NULLs) | `backfillOddsHistoryLineSource` | rows where NULL | once at startup (guarded) |
| `games.f5AwayRunLine, f5HomeRunLine, f5AwayRunLineOdds, f5HomeRunLineOdds, f5Total, f5OverOdds, f5UnderOdds, f5AwayML, f5HomeML, nrfiOverOdds, yrfiUnderOdds` | `scrapeAndStoreF5Nrfi` | `games.id` | every cycle after 7 AM EST |
| `games.actualFgTotal, actualF5Total, actualNrfiBinary, brierFgTotal, brierF5Total, brierNrfi, brierFgMl, brierF5Ml, outcomeIngestedAt` | `ingestMlbOutcomes` | `games.id` (mlbGamePk → abbrev fallback) | nightly 00:30 PST (scheduler) or owner tRPC |
| `games.gameStatus='final', awayScore, homeScore, gameClock` | `detectResumedSuspendedGames` | `games.id` | cycle Step 0 (requires manually-set 'suspended') |
| `mlb_lineups.*` (all columns) | `upsertLineupsToDB` → `upsertMlbLineup` | `gameId` (team-pair + exact-date match, limit 1) | every mlb-cycle |
| `mlb_lineups.lineupHash, lineupVersion, lineupModeledAt, lineupModeledVersion` | watcher `markLineupModeled` / `updateLineupHashOnly` | `gameId` | on first/changed lineup |
| Google Sheet `MM-DD-YYYY LINEUPS` tabs | roto/fg sheet syncs | tab name | `/api/scheduled/{roto,fg}-lineups` every 10 min (GH cron) |
| `games` row insert (AL vs NL) | `runMlbAllStarGameSync` | insert | `/api/cron/mlb-asg` (workflow expired 2026-07-14 per comment) |

---

## Exposure (API + UI)

**tRPC — mlbSchedule router** (server/routers/mlbSchedule.ts):
- `getLast5ForMatchup` (:63), `getTeamSchedule` (:103), `getSituationalStats` (:137), `getH2HGames` (:169) —
  authenticated app users; read `mlb_schedule_history`.
- Owner-only: `refreshScheduleForDate` (:202), `backfillSchedule` (:240, max 60 days),
  `fullHistoricalBackfill` (:289, default 2023-03-30→today), `triggerNightlyTrendsRefresh` (:346),
  `triggerOutcomeIngestion` (:381), `checkDrift` (:409), `triggerRecalibration` (:572),
  `getBrierTrend` (:443), `getBrierHeatmap` (:602), `getBrierDrilldown` (:991),
  `getF5EdgeLeaderboard` (:697, no-vig edge = model% − de-vigged implied%), `getFgEdgeLeaderboard` (:868).
- **games router** (server/routers.ts): `games.listPostponed` (:569), `games.markGameStatus` (:581 — the only writer
  of `'suspended'`), `games.liveSplits` (:560, public VSiN splits), `oddsHistory.listForGame` (:1134, cap 200).

**HTTP cron/heartbeat endpoints** (CRON_SECRET): `POST /api/cron/vsin-odds | /api/cron/scores |
/api/cron/mlb-cycle | /api/cron/mlb-asg`, `GET /api/cron/status` (cronRoutes.ts:80–118);
`POST /api/scheduled/fg-lineups` (fangraphsLineupHeartbeat.ts:37), `POST /api/scheduled/roto-lineups`
(rotowireLineupHeartbeat.ts:56).

**UI consumers** (VERIFIED grep, client/src): `components/MlbLast5Panel.tsx`, `components/RecentSchedulePanel.tsx`,
`components/SituationalResultsPanel.tsx` (schedule history panels), `components/OddsHistoryPanel.tsx` (odds_history),
`pages/MlbTeamSchedule.tsx`, `pages/ModelResults.tsx` / `pages/TheModelResults.tsx`, `pages/F5EdgeLeaderboard.tsx`,
`pages/PostponedGames.tsx` (admin postponed audit).

---

## Scheduling & triggers (who calls what, when)

### GitHub Actions → HTTP (the intended production path post-Manus)

| Workflow | Cron (UTC) | Endpoint | Work | Writes |
|---|---|---|---|---|
| cron-mlb-cycle.yml | `*/5 * * * *` | POST /api/cron/mlb-cycle | `runMlbCycleOnce()` | games odds/scores/splits, odds_history, mlb_lineups, K/HR props, backtests. **Header warning: "DO NOT ENABLE IN THE ACTIONS UI UNTIL THE MANUS HOST IS RETIRED"** (double-write risk) |
| cron-scores.yml | `*/10 * * * *` | POST /api/cron/scores | `refreshAllScoresNow()` (NBA/NHL/MLB) | games scores/status/actuals |
| cron-vsin-odds.yml | `*/15 * * * *` | POST /api/cron/vsin-odds | `runVsinRefresh()` | games odds/splits (all sports incl. MLB today+tomorrow), odds_history |
| cron-fg-lineups.yml | `*/10 * * * *` | POST /api/scheduled/fg-lineups | Google Sheet lineup tabs (MLB Stats API source) | Sheet only |
| cron-roto-lineups.yml | `*/10 * * * *` | POST /api/scheduled/roto-lineups | Google Sheet lineup tabs (Rotowire source) | Sheet only |
| mlb-asg.yml | `4,19,34,49 * * * *` | POST /api/cron/mlb-asg | All-Star seed/publish (says disable after 2026-07-14) | games row |

All are CRON_SECRET-authed (cronAuth.ts) with per-process `CronJobRunner` single-flight locks
(cronRunner.ts:85–131). **Whether each workflow is currently enabled in the Actions UI is UNKNOWN from the repo.**

### In-process schedulers (behind `DISABLE_BACKGROUND_JOBS`, server/_core/index.ts:840–926)

MLB-relevant registrations (all VERIFIED at cited lines):
- `startVsinAutoRefresh()` (:846) → `runVsinRefresh` every 5 min; NBA/NHL scores every 15 s; **`runMlbCycleOnce`
  immediately + every 5 min** (vsinAutoRefresh.ts:2096–2101); daily seeders (pitcher/bullpen/rolling5/batting-splits
  24 h; park factors/umpires 7 d, :2103–2207).
- `startMlbPlayerSyncScheduler()` (:856) — nightly 08:00 UTC roster sync.
- `startMlbScheduleHistoryScheduler()` (:858) — 60-day startup backfill; today+yesterday every 4 h 6 AM–midnight
  "EST"; **closing-line capture every 5 min 10 AM–2 AM** (mlbScheduleHistoryScheduler.ts:207–281).
- `startMlbNightlyTrendsScheduler()` (:861) — 2:59 AM EST re-ingest + 30-team cross-validation.
- `startMlbOutcomeAndDriftScheduler()` (:873) — nightly 00:30 PST outcome ingest + drift; monthly recal 1st 03:00 PST.
- `startMlbModelSyncScheduler()` (:877) — 5-min model heartbeat (other audit section).
- Startup one-offs inside the guard: odds_history lineSource backfill (:891), K-props MLBAM backfill (:898),
  FanGraphs lineup cache warm + 30-min loop (:910–925).

**Critical asymmetry (VERIFIED by comparing the two lists):** `mlb_schedule_history` refresh, closing-line capture,
outcome ingestion + Brier + drift, nightly TRENDS validation, player sync, and the daily stat seeders have **no
GitHub Actions workflow** — they exist only inside the `DISABLE_BACKGROUND_JOBS` guard. references/railway-deploy.md:98–101
mandates `DISABLE_BACKGROUND_JOBS=1` on web-only replicas and :102–106 says exactly one process may run jobs.
cronRoutes.ts:7–9 says the in-process schedulers are "gated off on Railway via DISABLE_BACKGROUND_JOBS to cut credit
burn". Whether the single Railway replica currently runs with the flag set (jobs dead) or unset (jobs alive) is
**UNKNOWN** — this decides whether closing lines/outcomes/Brier data are being written at all (Finding F1, census Q2).

### Manual triggers

Owner tRPC mutations (mlbSchedule router, § Exposure) can drive every job on demand; `runVsinRefreshManual(sport)`
backs the owner "Refresh Now" button (vsinAutoRefresh.ts:1493).

---

## Patch history relevant to this section

One-off scripts (all VERIFIED read of headers; none are on the live path today — the live path is the
services/schedulers above):

| Script | What it changed | In live path now? |
|---|---|---|
| `scripts/backfill_2026.mjs` | Re-ingested all 2026 `mlb_schedule_history` rows (Mar 26→run date) applying the corrected `away_team_id/home_team_id` home/away assignment | Fix itself is live (mlbScheduleHistoryService.ts:277–314); script was the historical data heal |
| `scripts/seedHistoricalMlb.py` | Inserted 2024+2025 final MLB games into `games` (gamePk, finals, F5, NRFI; fileId=0, all odds NULL) from a Manus-host JSON; also patched 2026 actualF5/NRFI | Data persists; script Manus-era (`/home/ubuntu` input path), not runnable as-is |
| `server/mlbHistoricalBackfill.mjs` | Backfilled `actualAwayScore/actualHomeScore/actualF5*/nrfiActualResult` for 2026-04-06→04-19 + triggered multi-market backtests | Superseded by mlbScoreRefresh final-write + outcome ingestor |
| `server/mlbJune19Phase1/FullPipeline/FixAndRerun.mjs` | June 19 2026 slate audit/repair: cross-referenced hardcoded gamePk list vs DB, verified odds/model/publish state (no INSERTs found in FullPipeline — grep) | No |
| `server/mlb_pipeline_audit.mjs`, `mlb_publish_audit.mjs`, `mlb_state_audit.mjs` | Read-only pipeline/publish/state audits with corrected column names | No (diagnostics) |
| `scripts/audit_dh_full.py`, `scripts/debug_an_dh.py` | Doubleheader audits; debug_an_dh reads `mlb_schedule_history.game_type` | No; evidence `game_type` was populated out-of-band |
| `scripts/mlbBacktestGrader.py` | Grades vs `mlb_schedule_history` filtering `game_type IN ('regular_season','postseason')` | UNKNOWN caller — if run today, depends on the orphaned `game_type` column |
| `.github/workflows/wc-*.yml`, `mlb-asg*.yml` | Date-stamped one-shot event workflows (World Cup, All-Star) — mlb-asg cron says disable after 2026-07-14 | Expired by date; UI state UNKNOWN |

Schema drift evidence: DB columns `games.rescheduledFrom` and `mlb_schedule_history.game_type` exist in the census
TSV but not in drizzle/schema.ts and have no TS writer (VERIFIED repo-wide grep) — both are orphans of out-of-band
migrations/patches.

---

## Open questions (UNKNOWN — for the census phase)

1. **Q1 — Who creates the daily MLB `games` rows and sets `mlbGamePk`?** No live repo code inserts the daily slate
   or writes `mlbGamePk` (evidence § Data inputs #9). Census: check `games` rows for recent dates — `fileId` value,
   `createdAt` clustering, and whether `mlbGamePk`/`venue`/`broadcaster` are populated → identifies the seeder
   (owner file upload vs external/Manus job).
2. **Q2 — Is `DISABLE_BACKGROUND_JOBS` set on the Railway replica?** Decides whether schedule-history refresh,
   closing-line capture, outcome ingestion/Brier/drift, and nightly trends run at all. Census: max
   `games.outcomeIngestedAt`, max `mlb_schedule_history.lastRefreshedAt`, count of non-null `closingLineLockedAt`
   for recent dates.
3. **Q3 — Which cron workflows are enabled in the Actions UI?** cron-mlb-cycle ships with a do-not-enable warning;
   fg/roto-lineups ship enabled-by-default; mlb-asg should be disabled post 2026-07-14. Not determinable from repo.
4. **Q4 — Is the Manus Heartbeat still firing** `/api/scheduled/*` in parallel (double-write window per
   railway-deploy.md:107–111)?
5. **Q5 — What populated `mlb_schedule_history.game_type`** and is it maintained for new rows (grader depends on it)?
6. **Q6 — AN v2 vs v1 health**: v1 used for schedule history because "v2 returns HTTP 400"
   (mlbScheduleHistoryService.ts:12) while the live odds path uses v2 (actionNetworkScraper.ts:287) — which is true
   today?
7. **Q7 — Closing-line coverage rate**: fraction of completed 2026 games with `closingLineLockedAt` non-null (locks
   require the in-process 5-min tick to be alive AND book 68 present at first pitch).
8. **Q8 — games.gameDate timezone convention**: score refresh and cycle use `datePst()`
   (vsinAutoRefresh.ts:1446,1670) while `startTimeEst`/schedule-history use ET. If `games.gameDate` is ET-based,
   PST-dated queries at day boundaries could miss late games (INFERRED risk; needs row-level check).

---

## Finding candidates

| ID | Sev | Title | Evidence |
|---|---|---|---|
| F1 | **P0** | Closing lines, outcome ingestion, Brier scores, drift detection, and schedule-history refresh have **no production trigger** if `DISABLE_BACKGROUND_JOBS=1` is set (as the deploy runbook prescribes for web replicas) — they exist only as in-process schedulers with no GH Actions equivalent | server/_core/index.ts:840–926 (guard + registrations); .github/workflows listing (no workflow for these jobs); references/railway-deploy.md:98–106; cronRoutes.ts:7–9. Ops state UNKNOWN → P0 if flag set, else downgrade |
| F2 | **P1** | `mlb_schedule_history` "DK NJ pre-game" odds are silently rewritten on every refresh from a book fallback chain (68→15→21→30, Pinnacle included) after DK NJ drops off completed games (~2 days); derived ATS/O/U results are re-derived vs the replaced line — historical trends/records are not guaranteed to be DK pre-game lines | mlbScheduleHistoryService.ts:74–79 ("same DraftKings line family" claim), 333–351 (fallback), 497–516 (upsert overwrites dk* + result cols); 60-day startup backfill re-touches 2 months of rows (mlbScheduleHistoryScheduler.ts:160) |
| F3 | **P1** | Closing-line capture is best-effort and lossy: requires the 5-min in-process tick (F1), only fires while status is "inprogress", and requires book 68 strictly (no fallback) — games that go final between ticks or lack DK NJ at first pitch never lock; no backfill path exists for `dkClosing*` | mlbScheduleHistoryService.ts:1241–1243, 1292–1298; sole caller mlbScheduleHistoryScheduler.ts:255–280 |
| F4 | **P2** | Suspended-game resume detection is dead code in the automated path: `mapMlbStatus` collapses Suspended→`postponed`, and `detectResumedSuspendedGames` only scans `gameStatus='suspended'`, which is written solely by the owner-manual `games.markGameStatus` mutation | mlbScoreRefresh.ts:222–230; mlbPostponedTracker.ts:363; routers.ts:581–598 (only 'suspended' writer, VERIFIED grep) |
| F5 | **P2** | Doubleheader ambiguity: all team-pair fallback matches (`.limit(1)` lineup match, `away@home` maps in score refresh/outcome ingestor/postponed tracker) collapse DH twin bills onto one row; `doubleHeader`/`gameNumber` columns are read/written by no live code, so G2 lineups/scores rely entirely on `mlbGamePk` being populated (whose writer is itself unknown — Q1) | rotowireLineupScraper.ts:720–734; mlbScoreRefresh.ts:567,584; mlbOutcomeIngestor.ts:520–534; mlbPostponedTracker.ts:232; routers.ts:106 (only doubleHeader ref); drizzle/schema.ts:337–341,641 |
| F6 | **P2** | Postponement handling is notify-only: rescheduled games are detected but nothing updates the old `games` row or inserts the new game/gamePk into `games` (the "auto-inserted" claim refers to `mlb_schedule_history`); `games.rescheduledFrom` exists in DB but is written by nothing | mlbPostponedTracker.ts:14–15, 296–317; repo-wide grep for `rescheduledFrom` (census TSV only) |
| F7 | **P2** | Acknowledged double-write architecture with no DB-level protection: `odds_history`, `mlb_lineups` (and `games` matchup dupes pre-unique-key) rely on in-memory, per-process locks while three trigger mechanisms (Manus Heartbeat, in-process intervals, GH Actions) coexist mid-migration; MLB odds are also written by two overlapping jobs (mlb-cycle */5 and vsin-odds */15) | references/railway-deploy.md:85–111; cron-mlb-cycle.yml header warning; cronRunner.ts:43–47 (in-memory); vsinAutoRefresh.ts:1309–1324 + 1734–1753 |
| F8 | **P2** | Odds-ingestion path mutates model outputs: LAYER3/RL-SIGN-SYNC inside `updateAnOdds` rewrites `awayModelSpread`/`homeModelSpread` and clears `modelRunAt` based on book ML direction, and `modelTotal` is hard-mirrored to `bookTotal` — "model" columns are partially book-derived, which any calibration audit must account for | db.ts:901–907, 1490–1543; vsinAutoRefresh.ts:1122–1149 |
| F9 | **P3** | Fixed UTC−5 "EST" (no DST) in schedule/nightly schedulers vs true America/New_York in the ingest services: all gating windows (6 AM refresh start, 10 AM–2 AM closing window, 2:59 AM trends) shift one hour during EDT, and the computed "today/yesterday" flips an hour early | mlbScheduleHistoryScheduler.ts:58–80 (comment "DST is not applied"); mlbNightlyTrendsRefresh.ts:60 vs mlbScheduleHistoryService.ts:172–182 |
| F10 | **P3** | odds_history snapshots store pre-LAYER2 run-line values, so a snapshot's RL sign/odds can contradict what was simultaneously written to `games` when the ML-guard fired — CLV analyses reading odds_history inherit the scraper artifact | vsinAutoRefresh.ts:1170–1183 vs 1090–1109 |
| F11 | **P3** | Nightly outcome trigger is minute-exact (`hour===0 && minute===30` on a 60 s tick): a restart or event-loop stall spanning 00:30 PST skips the whole night; recovery only via next night, `skippedAlreadyIngested` idempotency masks the gap for the missed date until the owner manually triggers | mlbOutcomeAndDriftScheduler.ts:231–244, 264–274 |

---

*End of ingestion & scheduling dossier.*
