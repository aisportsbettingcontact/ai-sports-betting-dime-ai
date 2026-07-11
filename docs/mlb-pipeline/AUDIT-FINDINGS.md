# MLB Pipeline Audit — Ranked Findings Register

**Date:** 2026-07-11 · **Method:** 14 parallel forensic audit agents, one per pipeline stage/file;
every CRITICAL and most HIGH findings independently re-verified by the orchestrator against the
code. Companion: [`PIPELINE.md`](./PIPELINE.md) (the corrected breakdown).

Severity: **CRITICAL** = wrong numbers published / data destroyed / core mechanism dead.
**HIGH** = concrete failure with plausible trigger. **MEDIUM** = latent or bounded. **LOW** = hygiene.

Fix status column: ✅ fixed on this branch · 📋 documented only (needs product decision or larger work).

---

## CRITICAL

| # | Finding | Evidence | Status |
|---|---|---|---|
| C1 | **Lineup/SP change does not re-run the model.** Watcher calls `runMlbModelForDate(dateStr)` with no `forceRerun`/`targetGameIds`; same-UTC-day games are skipped. SP B replaces SP A at 1pm → published projection still reflects SP A. | `mlbLineupsWatcher.ts:583`, `mlbModelRunner.ts:1594-1601` | ✅ |
| C2 | **UTC/PT skip-guard bug → perpetual re-run storm.** `modelRunAt` compared as UTC date vs PT `dateStr`; both schedulers model today **and** tomorrow → tomorrow's slate re-models every 5-min cycle all day; today's slate re-models every cycle after ~5pm PT. At ~52s/game engine cost the pipeline degenerates into back-to-back full-slate runs. | `mlbModelRunner.ts:1594-1601`, `vsinAutoRefresh.ts:1865-1874`, `mlbModelRunner.ts:2768-2792` | ✅ |
| C3 | **Publishing gates not enforced for MLB (public data exposure).** `games.list` is a `publicProcedure`; `listGames` ignores `publishedToFeed` (comment says so) and nulls model fields only for NCAAM. Model runner auto-sets both flags true on every write. Owner retraction (`setModelPublished(false)`) does nothing publicly; unapproved projections are anonymously readable. | `db.ts:431-435, 443-461`, `routers.ts:307-309`, `mlbModelRunner.ts:2548-2549` | 📋 product decision: either enforce the gates in `listGames` (extend `MODEL_FIELDS` null-out to all sports + `publishedToFeed` filter) or delete the vestigial approval UI. Enforcing changes public behavior; not safe to flip unilaterally. |
| C4 | **Umpire modifiers are ~never applied.** Games are modeled the evening before (first cycle after UTC midnight), hours before HP umpire assignments publish; `fetchUmpireModifiers` silently falls back to 1.0/1.0 and nothing re-runs when assignments appear. The entire 3-season/7k-boxscore seeding pipeline feeds a signal that only fires on manual force-reruns. | `mlbModelRunner.ts:1594-1601, 458-466`, `seedUmpireModifiers.ts` | 📋 needs a game-day-morning re-model trigger (e.g. watcher re-check when ump assignments first appear). C1/C2 fixes are prerequisites; trigger design is a product/compute tradeoff. |
| C5 | **AN odds null-wipe.** `refreshAnApiOdds` always passes all 9 primary fields; `updateAnOdds` treats `null` as "explicitly clear"; the fetcher deliberately includes games whose DK **and** Open markets are absent. A transient AN glitch wipes previously-good book lines within 5 minutes. | `vsinAutoRefresh.ts:1090-1105`, `db.ts:1399-1417`, `actionNetworkScraper.ts:415-419` | ✅ |
| C6 | **No runtime insertion path for new MLB games — and the code says otherwise.** Season was one-shot pre-seeded; rescheduled/makeup games (new gamePk) are never inserted; `refreshMlbScores` logs them NO_MATCH and skips. Meanwhile `mlbPostponedTracker` notifies the owner rescheduled games "will be auto-inserted by the schedule sync … No manual action required" — the referenced sync writes only `mlb_schedule_history`. | `mlbPostponedTracker.ts:304-307`, `mlbScheduleHistoryService.ts:495`, `mlbScoreRefresh.ts:588-595` | ✅ (notification corrected; auto-insert 📋 — needs a designed upsert path carrying gamePk/DH/gameNumber) |
| C7 | **Most MLB background jobs have no trigger in the target architecture.** The GH-Actions layer covers only vsin-odds/scores/mlb-cycle/lineup-sheets. The six daily/weekly seeders — **plus closing-line capture, schedule-history refresh, nightly trends, outcome ingestion + drift recalibration, and roster sync** — run only via in-process schedulers gated by `DISABLE_BACKGROUND_JOBS` (which the Railway runbook sets on web replicas). Post-Manus-cutover the model keeps pricing every 5 min on frozen inputs, no closing lines lock, no outcomes ingest — zero errors logged. | `vsinAutoRefresh.ts:2115-2207`, `_core/index.ts:781-867`, `cron/cronRoutes.ts:17-27` | ✅ for the six seeders (new `/api/cron/mlb-daily-seeds` + `/api/cron/mlb-weekly-seeds` routes + repo-variable-gated workflows) · 📋 closing-lines/trends/outcomes/rosters need the same treatment or a dedicated Railway worker service |
| C8 | **scipy auto-installer corrupts stdout → whole slate fails.** `MLBAIModel.py` prints "[STARTUP] scipy not found — auto-installing..." to stdout; the runner parses stdout as JSON. On any container missing scipy every model run fails with a parse error, silently, every cycle. | `MLBAIModel.py:40-49`, `mlbModelRunner.ts:1344-1349` | ✅ |

## HIGH

| # | Stage | Finding | Evidence | Status |
|---|---|---|---|---|
| H1 | Rolling-5 | Transient statsapi fetch error pushes a **zeroed row** that upserts over the pitcher's existing good data — 24h silent loss of recency signal. | `seedPitcherRolling5.ts:263-319` | ✅ |
| H2 | Bullpen | Upsert keyed on `teamAbbrev` only (no `season`) — season rollover hijacks prior-season rows or poisons the run with duplicate-key errors forever. | `seedBullpenStats.ts:155-158, 182` | ✅ |
| H3 | Batting splits | `{L:{},R:{}}` empty-object initialization is truthy — a team with one hand row gets `undefined` spread over its base stats for the other hand; model runs on NaN inputs. | `mlbModelRunner.ts:669, 1791-1818` | ✅ |
| H4 | Batting splits | `parseFloat(x) \|\| null` / `Number(x) \|\| null` coerce legitimate zeros to NULL → model substitutes league-average defaults (0 HR vs LHP becomes league-average power). | `seedTeamBattingSplits.ts:210-234` | ✅ |
| H5 | Pitcher stats | `fip/xfip/throwsHand/war` have **no living seeder** — `seedPitcherSabermetrics.ts` is invoked by `reseed2026.mjs:76` but absent from the repo. New pitchers get FIP=null (model substitutes ERA) and default 'R' handedness. | `reseed2026.mjs:76`, `mlbModelRunner.ts:630-631, 765` | 📋 seeder must be (re)written — MLB Stats API `stats=sabermetrics` group |
| H6 | Pitcher stats | Traded pitchers leave stale duplicate rows (team-keyed upsert, no pruning); name-only fallback resolves nondeterministically, possibly to frozen pre-trade stats. | `seedPitcherStats.ts:196-199`, `mlbModelRunner.ts:775-778` | 📋 |
| H7 | Park factors | API outage silently overwrites real factors with neutral 1.0 (errors → `{0,0,0}` → default → unconditional update); seeder runs on every boot, so a deploy during an outage wipes the table. | `seedParkFactors.ts:147-150, 194, 239-241` | ✅ |
| H8 | Park factors | In-progress games counted as completed (only checks both linescore runs present & >0, no status check) — boot-time runs mid-slate deflate factors. | `seedParkFactors.ts:109` | ✅ |
| H9 | AN odds | Doubleheader collision: matcher has no game-number disambiguation — G2's odds overwrite G1's row; G2's row is flagged INCOMPLETE forever. (Same defect exists independently in VSiN splits matching and lineups matching.) | `vsinAutoRefresh.ts:884-890`, `actionNetworkScraper.ts:46-106` | 📋 needs gamePk/start-time keyed matching across all three matchers |
| H10 | AN odds | Two independent 5-min loops + two cron endpoints race on the same MLB rows (per-job locks only): duplicate odds_history snapshots, interleaved writes, doubled LAYER3 re-runs. | `vsinAutoRefresh.ts:1309-1320, 1735-1738`, `cronRoutes.ts:36-48` | ✅ (MLB removed from `runVsinRefresh`'s AN sport list — mlb-cycle owns MLB) |
| H11 | AN odds | LAYER2 ML-direction guard fabricates a ±1.5 RL the book never posted in legitimate near-pick'em states (e.g. away −105 / home −1.5 +160). | `vsinAutoRefresh.ts:1024-1057` | 📋 threshold design needed (\|ML\| ≥ ~130) |
| H12 | VSiN | Cell-count guard is `< 11` not `!== 11` — one added column silently shifts every parsed field into the wrong DB column. | `vsinBettingSplitsScraper.ts:209-214` | ✅ |
| H13 | VSiN | Null parse results are written through and `updateBookOdds` treats null as clear — a markup tweak wipes good splits in 5 min; row-pairing has no gamecode consistency check (one promo row shifts every subsequent pairing). | `vsinBettingSplitsScraper.ts:83-89, 162-164`, `vsinAutoRefresh.ts:753-764` | ✅ (null-skip + gamecode pairing check) |
| H14 | Publishing | `bulkApproveModels` reads `rowsAffected` where mysql2 provides `affectedRows` — count is always 0: misleading "no pending projections" toast, cache invalidation never fires. | `db.ts:976` (cf. correct `:775, :2553`) | ✅ |
| H15 | Publishing | Model re-runs unconditionally re-set both publish flags — retracted games get silently re-published by any forced re-run. | `mlbModelRunner.ts:2548-2549` | 📋 tied to C3 decision |
| H16 | Lineups | `lineupModeledAt` stamped **before** the model runs; failed runs (e.g. Python ENOENT on Railway) are never retried — DB claims modeled state that never happened. | `mlbLineupsWatcher.ts:530-540, 579-604` | 📋 |
| H17 | Lineups | Test file tests a hand-copied fork, not the real module (different hash signature, nonexistent classifier, one test encodes wrong behavior). Same pattern: `anLiveLineFilter.test.ts` tests a copy of `findOutcome`; `splitsAndEdge.test.ts` re-implements VSiN parsing. Regressions in production code are undetectable. | `mlbLineupsWatcher.test.ts:16-62` | 📋 test rewrite |
| H18 | Model | 400k-sim sampler is a scalar Python loop: ~2.15s/call, ~24 calls/game → ~52s/game, ~13 min/15-game slate vs 5-min cycle; no cross-scheduler mutex → concurrent full-slate Python processes. | `MLBAIModel.py:806-812` | ✅ (vectorized sampler) |
| H19 | Model | VarianceModel output is discarded — every draw uses hardcoded `max(1.5μ, μ+0.5)` variance; Statcast/park variance inputs never shape the distribution (Coors slugfest and Petco duel with equal μ get identical spreads). | `MLBAIModel.py:798-811` | 📋 model-behavior change; needs backtest before flipping |
| H20 | Model | Flat +3pp `FG_ML_HOME_EDGE` on top of HFA — published win probabilities are not simulation outputs; possible double-count of home bias. | `MLBAIModel.py:1617-1621, 909-911` | 📋 recalibration question |
| H21 | Feed | MobileFeed (owner) MLB edge cards are dead code — reads nonexistent `game.modelSpread`/`game.spread`; WC cards read the wrong response shape (`[object Object]` titles). | `MobileFeed.tsx:132-138, 205-207` | ✅ |
| H22 | Feed | ETag hashes only `{id, modelRunAt, gameStatus}` with `max-age=30` — odds/splits move without busting the cache; browsers re-serve frozen lines on 304 indefinitely. | `routers.ts:336-350` | ✅ |
| H23 | Feed | Unpublished projections + no entitlement gating: full model payload is free via anonymous `games.list` while checkout sells access. | `routers.ts:307-309`, `RequireAuth.tsx:154` | 📋 same product decision as C3 |
| H24 | Scheduling | In-process 5-min intervals (`runMlbCycleOnce`, `runVsinRefresh`) have **no overlap/reentrancy guard** — the CronJobRunner lock exists only at the HTTP route layer. Slow slates (model step alone can run 8-10+ min) stack concurrent cycles on the live Manus host: concurrent scrapes + duplicate rows in tables with no unique constraints. | `vsinAutoRefresh.ts:2076, 2096-2101`, `cronRoutes.ts:47-50` | ✅ (module-level in-flight guards) |
| H25 | Scheduling | Cron workflows exist only on this branch: **Regime B currently has zero active schedule triggers** — and on merge to the default branch, `on: schedule` workflows begin firing automatically (GitHub has no "ship disabled"), creating a dual-writer window with Manus against tables lacking unique constraints. | `.github/workflows/cron-mlb-cycle.yml` header, commits 7bc8f72/d2ad5d7 | 📋 gate curl steps on a repo variable (`vars.CRON_ENABLED`) so cutover is a variable flip; new seeds workflows added here ship gated |

## MEDIUM (grouped patterns — full detail in agent reports)

- **No fetch timeout anywhere in the ingestion layer** (rolling-5, bullpen, batting splits, pitcher
  stats, park, VSiN, the pipeline's AN fetcher, the umpire-assignment `https.get`). One hung socket
  stalls a whole serialized cycle. ✅ `AbortSignal.timeout(15000)` added to the seeders + scrapers;
  umpire consumer 📋.
- **Non-atomic select-then-insert/update upserts everywhere** despite unique indexes (pitcher,
  bullpen, rolling-5, batting splits, park, umpire) — concurrent runs race into duplicate-key
  errors. 📋 mechanical `onDuplicateKeyUpdate` migration.
- **Hardcoded `season=2026`** in every seeder URL + FIP constant 3.10 (annual hand-edit; silent
  wrong-season fetch on rollover; rolling-5 would zero-fill the table "PASS — 0 errors"). 📋.
- **`lastFetchedAt` written but never read** — staleness is invisible to every consumer; 0-record
  runs count as success; scheduler wrappers warn-and-continue. 📋 needs a freshness/alert design.
- **Reliever filter drops swingmen/openers** (season GS=0) — opener-heavy teams' bullpen ERA built
  from a fraction of real relief innings (`seedBullpenStats.ts:104`). 📋.
- **Per-game error isolation gap** in the model write loop — `r.proj_away_runs.toFixed(2)` outside
  the try block; one malformed engine result aborts the rest of the slate (`mlbModelRunner.ts:2072-2078`). ✅.
- **Unbounded invalidate→re-run loop** on persistent RL sign mismatch — no retry cap
  (`mlbModelRunner.ts:2360-2411, 2599-2623`). 📋.
- **Expected pitchers written back as confirmed** (`awayPitcherConfirmed=true` unconditionally,
  `mlbModelRunner.ts:2544-2547`); scratched-to-TBD pitchers linger in `games`. 📋.
- **Validation gate flags unmodeled games** → chronic false ❌ alarms and alert fatigue
  (`mlbModelRunner.ts:1398-1448`). 📋.
- **`modelTotal` is a book echo** mirrored on every odds write from two different helpers
  (`db.ts:901-907, 1403-1413`) — intentional but duplicated and misleadingly named
  (real projection lives in `modelProjTotal`). 📋.
- **VSiN 0/0 guard covers RL only** — total/ML written even when market closed; swapped 0/0 ML
  becomes 100/100 (`vsinAutoRefresh.ts:722-764`). ✅ (guard extended to total/ML before flip).
- **Date partitioning mixes PT/ET** in VSiN today/tomorrow mapping and postponed-tracker scan
  windows; `datePst` DST arithmetic edge. 📋.
- **`odds_history` unbounded growth** (~8-9k rows/day MLB alone, no change-dedup). 📋.
- **Historical seeder silently dropped G2 of every 2024/25 doubleheader** — backtest/calibration
  data bias (`scripts/seedHistoricalMlb.py:88-132`). 📋 backfill.
- **Park factor keyed by home-team abbrev, not venue** — Tokyo/neutral-site games scaled by the
  wrong park (`mlbModelRunner.ts:1821`). 📋.
- **Umpire seeder re-crawls ~5-7k boxscores on every boot** (no incremental cursor). 📋.
- **Two sheet-sync crons overwrite the same Google Sheet tabs** with different sources every 10 min. 📋.
- **No error state on `/feed`** — hard failures render as "No games found"; MobileFeed requires
  both sources to fail before showing an error. 📋.
- **Fixed-offset "EST" scheduling math** — `mlbScheduleHistoryScheduler`/trends/prop-gates apply
  hard UTC-5 (or 12:00 UTC = "7 AM"), so every in-season window fires an hour late during EDT. 📋.
- **GH-Actions cron is best-effort with no missed-run handling**, endpoints return 200 before work
  completes (green run ≠ successful job), and scheduled workflows auto-disable after 60 days of
  repo inactivity. 📋 workflows should poll `/api/cron/status` and fail on `lastResult.ok=false`.
- **No responsible-gaming footer on either feed surface** (repo convention: 21+ / 1-800-GAMBLER). ✅.
- **304 handling inside the tRPC resolver** (`ctx.res.status(304).end()` mid-batch) can truncate
  batched responses / cache `[]` as data (`routers.ts:347-350`). ✅ (removed; standard ETag flow kept).

## LOW (selected)

Zero-value `|| null` conflation across seeders; `catch (e: any)` + `as any` API casts throughout;
`r5.era5` falsy check drops a legitimate 0.00 rolling ERA (`mlbModelRunner.ts:704` ✅); park-factor
`!= 1.0` sentinel treats a genuine neutral park as missing (`MLBAIModel.py:2498`); frozen March-2026
`PITCHER_REGISTRY` with prefix matching can substitute the wrong pitcher; stale comments pervasively
misdocument cadences/sources/seasons (the origin of most of the old breakdown's errors); case-
sensitivity inconsistency in batting-splits lookup (✅ uppercased); dead code (`isWithinActiveHours`,
unused imports, orphaned tests); color-only edge indication (accessibility); `spreadDiff` no-edge
encodings inconsistent (`-x` vs `'0'`); mixed-timezone date helpers.

---

## Fixes applied on this branch

See `git log` for the per-fix commits. Every fix is surgical, behavior-preserving except where the
behavior was the defect, and `npx tsc --noEmit` passes. Product-decision items (C3/C4/H15/H19/H20/
H23, entitlements, gate enforcement) are deliberately **not** changed — they alter public behavior
or model output and need an owner call.
