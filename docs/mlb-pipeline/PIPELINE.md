# MLB Modeling Pipeline — Verified Breakdown

**Audit date:** 2026-07-11 · **Method:** 14 parallel forensic audit agents (one per stage/file), every
claim verified against code with `file:line` evidence, top findings independently re-verified by the
orchestrator. Companion doc: [`AUDIT-FINDINGS.md`](./AUDIT-FINDINGS.md) (ranked defect register).

This replaces the earlier draft breakdown, which contained invented filenames, wrong cadences, and
several fictional mechanisms. Corrections are marked inline.

---

## Stage 0 — Scheduling reality (read this first)

There is no single "runMlbCycle every 10 min". Actual triggers:

| Job | Entry point | Trigger | Cadence |
|---|---|---|---|
| MLB cycle (scores → splits → AN odds → K-props → lineups watcher → model today+tomorrow → backtest) | `runMlbCycleOnce()` `server/vsinAutoRefresh.ts:1668` | in-process `setInterval` (`:2096-2101`) **or** GH Actions `cron-mlb-cycle.yml` → `POST /api/cron/mlb-cycle` | **5 min** (`MLB_INTERVAL_MS`, `:1361`) |
| VSiN/AN odds refresh (NBA/NHL/**MLB again**) | `runVsinRefresh()` `:1273` | in-process `setInterval` (`:2076`) or GH Actions `cron-vsin-odds.yml` → `/api/cron/vsin-odds` | **5 min** in-process / 15 min workflow |
| Model sync heartbeat (today+tomorrow) | `startMlbModelSyncScheduler()` `server/mlbModelRunner.ts:2799` | in-process `setInterval` + 2-min watchdog | **5 min** |
| Pitcher stats / bullpen / rolling-5 / batting splits | `startVsinAutoRefresh()` `vsinAutoRefresh.ts:2115-2174` | in-process only: run-on-boot + `setInterval` | 24 h |
| Park factors / umpire modifiers | same block `:2176-2207` | in-process only: run-on-boot + `setInterval` | 7 d |
| Rotowire / FanGraphs lineup **sheet** syncs (Google Sheets only, not the model path) | `cron-roto-lineups.yml`, `cron-fg-lineups.yml` | GH Actions | 10 min |
| Closing-line capture · schedule-history refresh · nightly trends · outcome ingestion + drift recal · roster sync | `mlbScheduleHistoryScheduler.ts`, `mlbNightlyTrendsRefresh.ts`, `mlbOutcomeAndDriftScheduler`, `mlbPlayerSync.ts` | in-process **only** (no cron route, no workflow) | 5 min window / 4 h / nightly / nightly+monthly / 24 h |

Key facts:

- The in-process schedulers are all skipped when `DISABLE_BACKGROUND_JOBS=1`
  (`server/_core/index.ts:781-787`) — which the Railway runbook mandates for web replicas.
  **The six daily/weekly seeders have no cron route and no GH workflow**, so post-Manus they run
  on zero hosts unless one jobs-enabled replica stays alive (CRITICAL-2 in findings).
- MLB AN odds + VSiN splits are refreshed by **two independent 5-minute loops**
  (`runVsinRefresh` and `runMlbCycleOnce`) that race on the same rows.
- The "every 10 min" figures in the old breakdown came from stale comments in the code itself
  (`vsinAutoRefresh.ts:1667, 2211`, `cronRoutes.ts:45`); the constants say 5 min.
- Cron endpoints are auth-gated (`server/cron/cronAuth.ts`) with a per-route single-flight
  `CronJobRunner` lock (`cronRoutes.ts`) — but the lock is per-job, not cross-job, and the
  in-process `setInterval`s have no overlap guard at all.

---

## Stage 1 — Data ingestion

### 1a. ActionNetwork odds — `refreshAnApiOdds()` in `server/vsinAutoRefresh.ts:812-1267`
*(The draft's `server/anOddsRefresh.ts` does not exist. `server/actionNetwork.ts` is a read-only
BetTracker slate cache and is NOT in this write path; `server/anLiveLineFilter.ts` doesn't exist —
only its orphaned test.)*

- Fetch layer: `fetchActionNetworkOdds()` (`server/actionNetworkScraper.ts:276`) hits the AN **v2
  scoreboard** API (`bookIds=15,30,68,69,71,75,79`) — not a DK-specific API. 3 retries with
  backoff, but **no fetch timeout**. Today + tomorrow fetched in parallel.
- Book selection: DK NJ (book 68) primary with an *atomic* all-9-fields fallback to Opening line
  (book 30) when any DK market is incomplete (`vsinAutoRefresh.ts:941-982`).
- Written columns (via **`updateAnOdds()`**, `db.ts:1338-1544` — not `updateBookOdds`):
  `awayBookSpread, homeBookSpread, bookTotal, awaySpreadOdds, homeSpreadOdds, overOdds, underOdds,
  awayML, homeML` (not `awayBookML`), MLB dual-write `awayRunLine/homeRunLine/awayRunLineOdds/
  homeRunLineOdds` (not `awayRlOdds`), `oddsSource`, `open*` reference columns. Every update also
  snapshots to `odds_history`.
- Side effect: `bookTotal` is mirrored into `modelTotal` on every line move (`db.ts:1403-1413`) —
  "model total" is a book echo between model runs, by design.
- Matching: AN `url_slug` → `getMlbTeamByAnSlug()` → abbrev, matched to `games` rows for the date
  with a swapped-order fallback. **No doubleheader disambiguation** (G2 overwrites G1's row).
- Live/final games are odds-frozen — but only if the Step-1 score refresh already marked them live.
- A LAYER2 guard force-corrects RL to ±1.5 when the RL sign contradicts the ML sign; a db-level
  LAYER3 guard can clear `modelRunAt` and trigger an immediate targeted model re-run.

### 1b. VSiN betting splits — `server/vsinBettingSplitsScraper.ts` (365 lines) + `refreshMlb()` (`vsinAutoRefresh.ts:593-795`)

- Confirmed: scrapes `data.vsin.com/betting-splits/?source=DK&view=today|tomorrow` in parallel;
  `table.sp-table`, 11-`<td>` away rows; extracts the six split percentages; slug resolution via
  `VSIN_MLB_HREF_ALIASES`; home/away swap handled by flipping `100 − x`; RL 0/0 guard preserves
  DB values; writes via `updateBookOdds()`.
- Corrections: cadence is **two 5-min loops** (not 5 + 10); the 0/0 guard covers **run line only**
  — total/ML are written unconditionally, and a swapped 0/0 ML is flipped to 100/100; the cell
  count check is `< 11` (a 12th column would silently shift every field); a parse failure writes
  `null`, which `updateBookOdds` treats as "explicitly clear" — wiping good splits.
- No test imports the real scraper; `splitsAndEdge.test.ts` re-implements the parsing inline.

### 1c–1f. Daily seeders (all: MLB Stats API, not Baseball Reference/FanGraphs scrapers)

| Stage | Real file | Table | Actually seeded | Draft fiction |
|---|---|---|---|---|
| Pitcher stats | `server/seedPitcherStats.ts` (295) | `mlb_pitcher_stats` | ERA, K/9, BB/9, HR/9, WHIP, IP, GS (filter: GS≥1 & IP≥10) | FIP/xFIP **not written by any living seeder** (`seedPitcherSabermetrics.ts` is referenced by `reseed2026.mjs:76` but missing from the repo); SIERA/GB%/FB% columns don't exist |
| Bullpen | `server/seedBullpenStats.ts` (249) | `mlb_bullpen_stats` | ERA, WHIP, K/9, BB/9, HR/9, K/BB, FIP per team (relievers = GS=0 & IP≥1) | save% / blown-save% never existed |
| Rolling-5 | `server/seedPitcherRolling5.ts` (375) | `mlb_pitcher_rolling5` | Last-5-starts aggregates (uniform sum) → era5/k9_5/bb9_5/hr9_5/whip5/fip5 | "exponential decay" is fiction; blend is fixed `0.70·season + 0.30·rolling5`, only when ≥3 starts (`mlbModelRunner.ts:696-726`); rolling-5 is a *secondary* adjustment, season stats are primary |
| Batting splits | `server/seedTeamBattingSplits.ts` (331) | `mlb_team_batting_splits` | avg/obp/slg/ops, wOBA (derived), k9/bb9/hr9 (count/AB·27 proxies), vs L and vs R | wRC+/ISO/K%/BB%/BABIP never seeded |

### 1g. Park factors — `server/seedParkFactors.ts` (298) → `mlb_park_factors`

- **Runs factor only**: 3-year (2024/2025/2026) weighted 50/30/20, from statsapi schedule+linescore.
- `hrFactor` is a separate frozen one-time backfill (`backfillHrFactor.mjs`, hardcoded 2024
  FanGraphs values) never refreshed by the seeder; a hits factor exists only in the static Python
  dict. Consumption keys on **home-team abbrev**, not the game's venue (Tokyo/neutral-site games
  get the wrong park).

### 1h. Umpire modifiers — `server/seedUmpireModifiers.ts` (309) → `mlb_umpire_modifiers`

- K-rate and BB-rate ratios vs league (`kModifier`, `bbModifier`) for umps with ≥20 HP games,
  crawled from 3 seasons of boxscores. **No run-suppression modifier exists**, and the modifiers
  multiply the starters' `k_pct`/`bb_pct` inputs (`MLBAIModel.py:2522-2538`) — they are not a total
  multiplier. In practice they are **almost never applied** (CRITICAL-4): the model stamps
  `modelRunAt` before HP assignments are published and nothing re-runs when they appear.

### 1i. Lineups watcher — `server/mlbLineupsWatcher.ts` (619)

- Every 5 min inside the MLB cycle. Scrapes **Rotowire** (both expected *and* confirmed lineups),
  upserts `mlb_lineups`, hashes pitchers+batting orders, and writes SP names (expected or
  confirmed) to `games.awayStartingPitcher/homeStartingPitcher`.
- **The draft's core claim is wrong in practice:** on a detected change it calls
  `runMlbModelForDate(dateStr)` with **no `forceRerun`/`targetGameIds`**
  (`mlbLineupsWatcher.ts:583`), so games already modeled that UTC day are skipped — SP changes
  update bookkeeping but usually do not re-model (CRITICAL-5).
- `rotowireLineupSheetSync.ts` / `fangraphsLineupSync.ts` (+ heartbeats) are a separate
  Google-Sheets pipeline, not in the model path — and both write the same sheet tabs, flip-flopping
  sources every 10 min.

---

## Stage 2 — Game seeding: **there is no seeder**

`server/mlbGameSeeder.ts` does not exist and never did. Reality:

1. The full 2,430-game 2026 season was bulk-inserted **once** (2026-03-24) by an off-repo
   Manus-era one-off from the MLB Stats API (evidence: `todo.md:1935`, `db.ts:399-400`).
2. `scripts/seedHistoricalMlb.py` backfilled 2024/2025 finals for backtesting (manual, one-off —
   and it silently dropped game 2 of every historical doubleheader).
3. The owner CSV upload (`files.upload` → `insertGames()`, `routers.ts:201-248`) is the only
   on-demand insert path.

Row shape corrections: column is `startTimeEst` (no `gameTime`); status enum is
`upcoming|live|final|postponed|suspended` with default **`upcoming`** (no `SCHEDULED` value);
plus `mlbGamePk`, `doubleHeader`, `gameNumber`. `publishedToFeed`/`publishedModel` do default
to `false` — the one fully-confirmed claim. Source is the MLB Stats API — ESPN is used for
NBA/NCAAM/WC2026, not MLB.

**No runtime path inserts new MLB games** — rescheduled/makeup games never appear, while
`mlbPostponedTracker.ts:304-307` tells the owner they will be "auto-inserted … No manual action
required" (CRITICAL-7).

---

## Stage 3 — Model execution — `server/mlbModelRunner.ts` (2,825) → `server/MLBAIModel.py` (3,019)

Entry `runMlbModelForDate(dateStr, { targetGameIds?, forceRerun? })` (`:1532`). All math lives in
the Python engine (one process per slate, fixed `seed=42` → fully deterministic).

**Eligibility:** requires `bookTotal + awayML + homeML + awayRunLine` + both starters (Rotowire
COALESCE fallback). Skip-if-modeled compares the **UTC** date of `modelRunAt` to the (PT) game
date (`:1594-1601`) — timezone-broken, see CRITICAL-6: tomorrow's slate re-models every 5-min
cycle all day, today's re-models every cycle after ~5pm PT.

**Step 1 — inputs (corrected):** season pitcher stats are primary (ERA/K9/BB9/HR9/WHIP/xERA/FIP/
xFIP/WAR/hand), blended 70/30 with rolling-5 when ≥3 starts; hand-specific batting splits
(wOBA/avg/obp/slg + k9/bb9/hr9 proxies — no wRC+; ISO is derived as `slg−avg` in Python);
bullpen FIP (ERA/WHIP fetched but unused by the engine); 3-yr park factor (home-team keyed);
umpire K/BB modifiers; Rotowire weather; confirmed-lineup Statcast. **VSiN split percentages are
never model inputs** — display-only. The book total is a *pricing line*, not a distribution
anchor — the simulated mean is fully book-independent.

**Step 2 — expected runs (corrected):** no "SP quality score" blend. Bottom-up per-inning
construction: pitcher per-PA rates (k9/38, bb9/38, blended HR%) → Log5 vs lineup rates with TTO
penalty → per-inning runs `(RE₀₀ + Σ p·linear_weight) × park × weather`, bullpen multiplier for
innings past *projected* starter IP (not fixed 7–9), HFA (home ×1+hfa·0.15, away ×1−hfa·0.08),
global calibration ×0.9762.

**Step 3 — Monte Carlo (corrected):** 400,000 sims confirmed — but **not per-inning Poisson**.
Game-level team scores are drawn from an NB-Gamma mixture (Gamma(4,¼) rate multiplier clipped
[0.3,3.0]; NB variance `max(1.5μ, μ+0.5)` — the elaborate VarianceModel output is discarded,
HIGH-3). Ties get ghost-runner extra innings. F5/I1/I1-9 markets use independent NB-Gamma draws
with empirical inning shares. The sampler is a scalar Python loop: ~52s/game, ~13min for a
15-game slate vs a 5-minute cycle (HIGH-2).

**Step 4 — pricing (corrected):** win prob gets a flat `FG_ML_HOME_EDGE = +0.03` home bump plus a
total-environment adjustment **before** `remove_vig` → `prob_to_ml`. Published probabilities are
not raw simulation outputs.

**Step 5 — spreads/edges (corrected):** `awayModelSpread/homeModelSpread` are the **book's ±1.5
run-line labels** (sign-enforced); the engine's true margin-based spread is logged but never
written. Edges (`spreadEdge/spreadDiff/totalEdge/totalDiff`) are model **no-vig** implied minus
book **vig-inclusive** implied, in pp — an intentional ~2-2.5pp conservative handicap.

**Step 6 — write:** one atomic UPDATE per game with all claimed fields plus ~40 more (F5/NRFI/HR/
inning JSON, `modelProjTotal` = the model's real total, `modelWeatherAdj`), **and it force-sets
`publishedToFeed=true, publishedModel=true` and `awayPitcherConfirmed/homePitcherConfirmed=true`
on every write** — even for expected pitchers. `modelTotal` is written as the live **book** total.

---

## Stage 4 — Publishing: the two-gate model is not enforced

- `bulkApproveModels` (owner-only) sets **both** `publishedModel` and `publishedToFeed` for games
  with model data; `publishAllStagingGames` publishes only staging rows (`fileId=0`) with odds;
  `setPublished`/`setModelPublished`/`updateProjections` exist as claimed (all `ownerProcedure`).
- **But the public feed ignores the flags for MLB.** `games.list` (a `publicProcedure` — there is
  no `getFeedGames`) → `listGames` shows all non-postponed games in the window regardless of
  `publishedToFeed` (`db.ts:431-435`), and nulls model fields only for legacy **NCAAM** rows
  (`db.ts:443-461`). Since the model runner auto-publishes on every write, the owner approval
  workflow is vestigial for MLB, and retraction does nothing publicly (CRITICAL-3).
- `bulkApproveModels` also always reports 0 rows approved — it reads `rowsAffected` where mysql2
  provides `affectedRows` (`db.ts:976`), so the success toast lies and cache invalidation never
  fires (HIGH).

---

## Stage 5 — Feed delivery

- The real public surface is **`/feed` → `client/src/pages/ModelProjections.tsx` (1,795) rendering
  `client/src/components/GameCard.tsx` (3,575)** — login-gated in the UI (`RequireAuth`) but backed
  by the anonymous-accessible `games.list`. No subscriber-entitlement check exists anywhere on the
  path.
- `client/src/features/mobileOwnerTabs/screens/MobileFeed.tsx` (the draft's file) is an
  **owner-only** mobile screen at `/m/feed` — and its MLB edge cards are dead code (reads
  nonexistent `game.modelSpread`/`game.spread` columns).
- Cards show book vs model ML / RL / total with VSiN tickets+handle bars, as claimed — except the
  displayed "model" RL and total *lines* deliberately mirror the book's (only the juice is the
  model's), and the edge threshold is **1.5pp** (0.5pp ML) with ≥5pp being a *color tier*
  ("STRONG"), not bold.
- The Dime rehost (`dime-ai/DIME-FEED-MIGRATION-DRAFT.md`) is still draft-only; `/feed` serves the
  legacy page.
- Neither feed surface carries the responsible-gaming language (21+ / 1-800-GAMBLER) that the repo
  convention requires and every other surface has.

---

## Corrected pipeline summary

```
MLB Stats API ──(one-shot pre-season bulk seed, 2,430 games — NO daily seeder)──▶ games
      │
      ├─ every 5 min ×2 loops: refreshAnApiOdds (AN v2 API, DK→Open fallback) ──▶ games book lines + odds_history
      ├─ every 5 min ×2 loops: refreshMlb (VSiN DK splits scraper) ────────────▶ games split %s
      ├─ every 5 min: mlbLineupsWatcher (Rotowire) ─▶ mlb_lineups + games SP names
      │        └─ model trigger effectively broken (no forceRerun)
      ├─ every 24 h (in-process only, DISABLE_BACKGROUND_JOBS kills it):
      │        seedPitcherStats · seedBullpenStats · seedPitcherRolling5 · seedTeamBattingSplits
      └─ every 7 d (same caveat): seedParkFactors · seedUmpireModifiers
      ▼
runMlbModelForDate (two 5-min schedulers, today+tomorrow; UTC skip-guard broken → re-run storms)
      └─ MLBAIModel.py: Log5 per-inning run build → 400k NB-Gamma game-level sims (seed=42)
         → +3pp home bump → no-vig pricing → book-anchored total/RL labels → pp edges
      └─ writes model fields + AUTO-SETS publishedToFeed=publishedModel=true
      ▼
Owner publishing gates exist but are NOT enforced on the public feed for MLB
      ▼
/feed → ModelProjections.tsx + GameCard.tsx (games.list, public procedure; login-gated UI only)
```
