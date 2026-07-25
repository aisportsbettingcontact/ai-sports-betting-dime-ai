# Phase 0 — API & Frontend Exposure of MLB Numbers

Evidence classes: **VERIFIED** = code read at cited location this session. **INFERRED** = reasoned from verified facts (reasoning stated). **UNKNOWN** = could not be established from code alone.

## Overview

The subscriber-visible surface for MLB model numbers is a single page: **DimeModelFeed** (`/feed/model/mlb-MM-DD-YYYY`, auth-gated in the client, mounted standalone and inside DimeAppShell). It renders three markets per game — Run Line, Total, Moneyline — with book price vs. model fair price per side, a per-side "sig" mint highlight at ≥1.5pp edge, a per-game verdict strip (Pick / Edge / Grade), and a win% annotation on the model favorite. All data rides on the **public, unauthenticated** tRPC procedure `games.list` (VERIFIED `server/routers.ts:311` — `publicProcedure`, comment "feed is now fully public").

Three consequential structural facts (all VERIFIED below):

1. **The owner publication workflow is bypassed for MLB.** `publishedToFeed`/`publishedModel` are set to `true` automatically by every model write (`server/mlbModelRunner.ts:2548-2549`), and the public read path never checks either flag for MLB anyway (`server/db.ts:431-435` shows games regardless of `publishedToFeed`; `server/db.ts:444-461` gates model fields only for `sport === 'NCAAM'`).
2. **`server/mlbPublicationGate.ts` (70% accuracy floor, ROI>0, ECE<0.05, zero leakage) is dead code** — its only importer is the test file `server/mlbBacktestAudit.test.ts:78-82`. No production path calls `runMarketGate`/`buildPublicationGateReport` (VERIFIED via repo-wide grep; the two `.mjs` audit scripts only mention it in comments, `server/mlb_publish_audit.mjs:96-133`).
3. **The post-write validation gate is log-only.** `validateMlbModelResults` runs after DB writes and its failures are printed but nothing is unpublished or reverted (`server/mlbModelRunner.ts:2625-2642`).

The richer per-market components (F5/NRFI card, K-props card, HR-props card, Cheat Sheet) live on `client/src/pages/ModelProjections.tsx`, which is **not routed anywhere** (VERIFIED: no import of `pages/ModelProjections` in `client/src/App.tsx` or elsewhere; only comment references in `WcFeedInline.tsx`/`GameCard.tsx`). K-props are live only on the **owner-only** mobile surface `/m/props` (`client/src/App.tsx:438-444` → `MobileOwnerLayout.tsx:25`). F5, NRFI, and HR-prop model numbers are therefore **written to the DB and publicly queryable via tRPC, but not rendered on any routed subscriber page today** (INFERRED from routing evidence above).

## Data inputs & ingestion (exposure-relevant book/display data)

| Input | Writer | Evidence | Class |
|---|---|---|---|
| Book RL/total/ML odds + splits (VSiN + Action Network DK NJ) | `runMlbCycleOnce` inside `vsinAutoRefresh.ts`; `updateAnOdds` write at `server/vsinAutoRefresh.ts:1090-1121`; `updateBookOdds` in `server/db.ts:861-934` | VERIFIED | |
| `modelTotal` mirrored to `bookTotal` on every odds refresh | `server/db.ts:901-907` ("modelTotal must always mirror bookTotal") | VERIFIED | |
| F5 + NRFI/YRFI book odds (FanDuel NJ, AN book) | `scrapeAndStoreF5Nrfi` → `server/mlbF5NrfiScraper.ts:210-230` (spawns `/usr/bin/python3.11 ActionNetworkF5NrfiAPI.py`, `mlbF5NrfiScraper.ts:26,33`); called from MLBCycle Step 7 only after 7:00 AM EST (`server/vsinAutoRefresh.ts:1995-2020`) | VERIFIED | |
| NRFI odds column mapping | `nrfiOverOdds` = NRFI (AN "under 0.5"), `yrfiUnderOdds` = YRFI (AN "over 0.5") — deliberately inverted naming, `server/mlbF5NrfiScraper.ts:224-228` | VERIFIED | |
| K-prop book lines (AN) | MLBCycle → `fetchANKProps` + `upsertKPropsFromAN` (`server/vsinAutoRefresh.ts:1900-1918`) | VERIFIED | |
| HR-prop consensus odds | MLBCycle Step 8, gated after 7:00 AM EST (`server/vsinAutoRefresh.ts:2022-2030`) | VERIFIED | |
| Layer-3 ML-flip immediate model re-run | `server/vsinAutoRefresh.ts:1123-1150` and duplicate in `server/routers.ts:817-829` (`ingestAnHtml`) | VERIFIED | |

## Model mechanics (parameters actually governing what subscribers see)

This section covers the exposure-layer parameters. (Simulation internals belong to the per-market dossiers.)

| Name | Value | Meaning | Evidence | Class |
|---|---|---|---|---|
| `SIMULATIONS` | 400,000 | Monte Carlo sims per game (matches "400,000 simulations" landing-page copy at `client/src/pages/dime/landing/landing-content.ts:118,224,285`) | `server/MLBAIModel.py:68` | VERIFIED |
| Server RL edge rule | model implied − book implied > **0** ("Option B", raw vs raw, no vig removal); best of away/home side | `server/mlbModelRunner.ts:2208-2253` | VERIFIED |
| Server total edge rule | side edge pp > 0 and the other side ≤ 0; `totalDiff` rounded to 1 dp; label `"OVER {bookTotal} [EDGE]"` | `server/mlbModelRunner.ts:2293-2341` | VERIFIED |
| `spreadDiff` encoding | `String(Math.round(bestEdge*1000)/10)` pp, may be negative (no-edge case still written) | `server/mlbModelRunner.ts:2231,2248` | VERIFIED |
| Client edge threshold (feed) | `EDGE_THRESHOLD_PP = 1.5` pp (model implied − book implied, raw) | `client/src/lib/edgeUtils.ts:144,79-84` | VERIFIED |
| Client BET/WATCH tiers | BET ≥ 2.5pp, WATCH ≥ 1.5pp, else NO_EDGE | `client/src/lib/gameInsight.ts:39-40,53-61` | VERIFIED |
| Feed letter grades | A ≥6pp, A− ≥4.5, B+ ≥3.5, B ≥2.5, C+ ≥1.5, "—" <1.5 | `client/src/pages/DimeModelFeed.tsx:102-109` | VERIFIED |
| 6-tier verdict (legacy pages) | ELITE ≥8, STRONG ≥5, PLAYABLE ≥2.5, SMALL ≥0.5, NEUTRAL ≥−1, FADE | `client/src/lib/edgeUtils.ts:99-107` | VERIFIED |
| GameCard ML mint threshold | `EDGE_THRESHOLD_ML = 0.5` pp | `client/src/components/GameCard.tsx:981` (mobile twin `:1965`) | VERIFIED |
| F5/NRFI card edge threshold | \|edge\| ≥ 3% (`isEdge: Math.abs(edge) >= 0.03`); EV per $100 = edge × payout | `client/src/components/MlbF5NrfiCard.tsx:149,146-147` (dead page) | VERIFIED |
| K-prop verdict thresholds (live writer) | `EDGE_THRESHOLD_OVER = 0.150`, `EDGE_THRESHOLD_UNDER = 0.040`, `MAX_OVER_LINE = 5.5` → verdict "OVER"/"UNDER"/"PASS" | `server/mlbKPropsModelService.ts:66-73,484-505` | VERIFIED |
| K-prop verdict thresholds (legacy Python runner) | verdict "EDGE" if best_edge ≥ 0.03, "FADE" ≤ −0.03, else "NEUTRAL" | `server/StrikeoutModel.py:1465-1479` (invoked only via owner tRPC `strikeoutProps.runModel`, `server/routers.ts:1229-1252`) | VERIFIED |
| HR-prop verdict | `EDGE_THRESHOLD = 0.060` AND `MIN_ABSOLUTE_P_HR = 0.18` → "OVER" else "PASS" | `server/mlbHrPropsModelService.ts:70,77,416-434` | VERIFIED |
| Model odds formatting | `fmtMl` rounds to integer American odds with sign | `server/mlbModelRunner.ts:301-304` | VERIFIED |
| F5 push validation range | blended ∈ [0.05, 0.35] (prior 0.1507, K=10), raw ∈ [0.05, 0.40] | `server/mlbModelRunner.ts:1453-1489` | VERIFIED |
| ROI display formula | `(modelImplied / bookNoVigProb − 1) × 100` (book vig removed, model's not) | `client/src/lib/edgeUtils.ts:194-208` | VERIFIED |

**Column scale inconsistencies (VERIFIED, exposure-relevant):**
- `modelPNrfi` stored 0–1 (`String(r.p_nrfi.toFixed(4))`, `mlbModelRunner.ts:2507`; Python `p_nrfi` = no-vig probability 0–1, `MLBAIModel.py:1951-1954,2014`) in a `decimal(5,2)` column (`census/schema-columns.tsv` games:140). `MlbCheatSheetCard` correctly multiplies by 100 (`MlbCheatSheetCard.tsx:794-797`), but `MlbF5NrfiCard` treats it as 0–100: NRFI renders ~"0.6%", YRFI ~"99.4%", and edge/EV computed on the wrong scale (`MlbF5NrfiCard.tsx:264-272,304`). Both components are on the unrouted page — latent, not live.
- `modelF5OverRate`/`modelF5UnderRate` stored 0–1 (`toFixed(4)`, `mlbModelRunner.ts:2490-2491`) but sibling `modelF5AwayWinPct` stored 0–100 (`×100`, `:2492-2493`) and full-game `modelOverRate` stored 0–100 (`r.over_pct.toFixed(2)`, `:2465-2466`; `r.over_pct/100` at `:2284` proves scale). `MlbF5NrfiCard` feeds `modelF5OverRate` into a percent-expecting `computeEdgeEV` (`MlbF5NrfiCard.tsx:353-354`) — scale bug on the same dead page. `decimal(5,2)` truncates the 4-dp write to 2 dp (INFERRED from column type).

## Projection → DB write path

All full-game/F5/NRFI/team-HR numbers land in **`games`** in one `db.update(games).set({...}).where(eq(games.id, r.db_id))` per game (VERIFIED `server/mlbModelRunner.ts:2414-2560`), keyed by `games.id` (`r.db_id`). Highlights:

- Run line: `awayModelSpread`/`homeModelSpread` sign-enforced to match book; `modelAwaySpreadOdds`/`modelHomeSpreadOdds` = model fair RL odds (`:2424-2429`). Book columns `awayRunLine(Odds)` are scraper-owned and never written here (`:2426-2427`).
- Edges: `spreadDiff`/`spreadEdge`, `totalDiff`/`totalEdge` (`:2436-2442`).
- Total: `modelTotal` **forced to the live bookTotal** (4-level fallback, `:2453-2462`); raw projection preserved in `modelProjTotal` (`:2553`); `modelOverOdds/UnderOdds/OverRate/UnderRate` (`:2463-2466`).
- ML/scores: `modelAwayML/HomeML` (`fmtMl`), `modelAway/HomeScore` (2 dp), `modelAway/HomeWinPct` (0–100, 2 dp) (`:2468-2474`).
- F5 block (`:2483-2503`), NRFI block (`:2507-2509`; `modelPYrfi` column does not exist — YRFI carried only in `modelYrfiOdds`, `:2510`), team-HR block 0–100 scale pre-converted by Python (`:2521-2525`), inning-by-inning JSON arrays (`:2528-2539`).
- Meta: `modelRunAt = BigInt(Date.now())`, pitchers marked confirmed, **`publishedToFeed: true, publishedModel: true`** (`:2543-2549`).
- RL sign-flip invalidation nulls model fields and `modelRunAt` (`:2368-2371`), then a targeted `forceRerun` fires via `setImmediate` (`:2599-2623`).

K-props land in **`mlb_strikeout_props`** keyed `(gameId, side)` via `upsertStrikeoutProp` (`server/db.ts:2146-2193`); live writer is `modelKPropsForDate` (`server/mlbKPropsModelService.ts:259`, fields incl. `kProj` = lambda 2 dp at `:511-518`, `verdict`, `bestEdge` 4 dp at `:525-526`). HR props land in **`mlb_hr_props`** via `server/mlbHrPropsModelService.ts:434` (`modelPHr` 4 dp 0–1, `modelOverOdds`, `edgeOver`, `evOver`, `verdict`).

## Exposure (API + UI)

### tRPC procedures returning MLB model numbers

| Procedure | Auth | Returns | Evidence |
|---|---|---|---|
| `games.list` | **public** | Full `games` rows (all model fields) filtered by `stripSportNullFields` (strips MLB fields only from non-MLB games, `routers.ts:104-148`); 30s Cache-Control + ETag/304 (`routers.ts:338-355`) | `server/routers.ts:311-357` VERIFIED |
| `games.getAvailableDates` / `getCurrentDate` | public | 7-day window dates; 11:00 UTC cutoff (`FEED_CUTOFF_UTC_HOUR = 11`) | `routers.ts:370-430` VERIFIED |
| `games.mlbLineups`, `games.mlbEnvSignals` | public | lineups; park/bullpen/umpire rows | `routers.ts:913-945` VERIFIED |
| `strikeoutProps.getByGame(s)` | **public** | full K-prop rows (kProj, distributions, edges, verdict) | `routers.ts:1154-1178` VERIFIED |
| `hrProps.getByGame(s)` | **public** | full HR-prop rows | `routers.ts:1410-1431` VERIFIED |
| `mlbBacktest.getRollingAccuracy/getFullReport/…` | `protectedProcedure` (Manus OAuth) | accuracy/ROI aggregates | `routers.ts:1463-1567` VERIFIED |
| `mlbModel.forceRerun/getStatus/audit`, `strikeoutProps.getCalibrationMetrics/…`, `adminModelStatus.mlb`, `mlbBacktest.runFor*` | `ownerProcedure` (app_session + owner role, `server/routers/appUsers.ts:105-160`) | admin ops | VERIFIED |

DB read path for the feed: `listGames` applies MLB 7-day rolling window from the 11:00 UTC-gated start (`server/db.ts:399-423`), excludes `gameStatus='postponed'` (`:428`), **does not require odds for MLB** (`:431-435`), sorts by date → startTime → `sortOrder` (`db.ts:334-347,441`), caches with last-known-good fallback (`:466-539`).

### UI surfaces

- **DimeModelFeed** (live, subscribers): `mlbRowToCard` binds Run Line (book `awayRunLineOdds` vs model `modelAwaySpreadOdds` fallback `modelAwayPLOdds`), Total (book `overOdds/underOdds` at `bookTotal` vs `modelOverOdds/modelUnderOdds`), Moneyline (book `awayML/homeML` vs `modelAwayML/modelHomeML`), win% = `Math.round(modelAwayWinPct)` on the model favorite (`client/src/pages/DimeModelFeed.tsx:629-716`). Model prices are **nulled when `modelRunAt == null`** (`:639-641`). Verdict strip picks the max-pp side across the three markets; PASS below 1.5pp (`:604-625`). Rendering goes through `sportAdapters.MLB` → `presentationToProjectionGame` → `ProjectionCard`/`ProjectionSummary`/`EdgeIndicator`, which display side label, best price, model fair price, `+x.x%` edge and Bet/Watch (`client/src/lib/sport/presentation.ts:247-285`, `client/src/components/projections/ProjectionSummary.tsx:15-39`, `EdgeIndicator.tsx:35-66`). Transformations: American odds printed as-is with `+` sign (`fmtAm`, `DimeModelFeed.tsx:93-94`); edge 1 dp; win% rounded to integer; polling 60s with `placeholderData` (`:912-946`).
- **BettingSplits** (`/betting-splits/...`): `GameCard mode="splits"` shows only score + splits panels — no model numbers (`client/src/pages/BettingSplits.tsx:1023`, `GameCard.tsx:3418-3454`). VERIFIED.
- **Mobile owner tabs** (`/m/*`, owner-gated `MobileOwnerTabsShell` `is_owner: true` at line 57): `/m/props` shows kProj (1 dp), book line (fallback `kLine`), book odds, `bestEdge×100` pp (1 dp), lean; mint only when `verdict === "EDGE"` (`client/src/features/mobileOwnerTabs/screens/MobileProps.tsx:376-390`). **Mismatch:** the live writer emits "OVER"/"UNDER"/"PASS", never "EDGE" (`mlbKPropsModelService.ts:487-505`), so the mint signal can only appear on rows from the legacy Python runner. VERIFIED both sides.
- **Admin pages** (client-side auth only via `RequireAuth` — it checks session, **not owner role**, `client/src/components/RequireAuth.tsx:92` + `App.tsx:294-352`): `/admin/model-results` (TheModelResults) shows accuracy claims — rolling per-market accuracy (`mlbBacktest.getRollingAccuracy`), K-prop model/over/under accuracy and daily/7-day correct counts (`client/src/pages/TheModelResults.tsx:738-755,1669-1729`). Server-side gates on the underlying procedures (owner/protected) are the real access control (INFERRED: a non-owner subscriber reaching the page would get errors on owner procedures but could receive `protectedProcedure` data only with a Manus OAuth session).
- **Unrouted (dead) components** carrying full per-market rendering: `ModelProjections.tsx` (tabs incl. F5/NRFI, K Props, HR Props, Cheat Sheets), `MlbF5NrfiCard` (footer claims "Model: 400K Monte Carlo · Edge threshold: ±3%", `MlbF5NrfiCard.tsx:612`), `MlbCheatSheetCard`, `MlbPropsCard`, `MobileGameCard` (no live importer of `pages/ModelProjections`; VERIFIED grep). `pages/ModelResults.tsx` likewise unrouted (only `TheModelResults` is lazy-imported, `App.tsx:31`).
- **Marketing/landing** (`DimeLandingV2`): explicitly "No fabricated win rates, records, testimonials" (`landing-content.ts:8`); demo numbers labeled; repeats the "400,000 simulations" claim which matches `SIMULATIONS = 400_000`. No accuracy/record claims. VERIFIED.
- **Dime chat**: has a groundedness block that refuses unverifiable betting verdicts (`server/dime-chat.route.ts:346`); no direct injection of MLB model columns found (grep). VERIFIED (absence within searched files).

## Scheduling & triggers

| Trigger | What runs | Evidence | Class |
|---|---|---|---|
| In-process `startMlbModelSyncScheduler` — every 5 min + 15-min watchdog with self-healing re-fire, 24/7 | `runMlbModelForDate(today)` + `(tomorrow)` | `server/mlbModelRunner.ts:2673-2825`; registered at `server/_core/index.ts:877` inside the `DISABLE_BACKGROUND_JOBS` guard (`:840-842`) | VERIFIED registration |
| In-process `startVsinAutoRefresh` → `runMlbCycleOnce` every 5 min (`MLB_INTERVAL_MS`, `vsinAutoRefresh.ts:1361`) | lineups watcher → model fallback runs (today+tomorrow, `:1863-1874`) → K-props AN fetch/backtest → F5/NRFI scrape (≥7:00 AM EST) → HR props | `server/vsinAutoRefresh.ts:2068-2101`; registered `server/_core/index.ts:846` | VERIFIED registration |
| GitHub Actions: `cron-vsin-odds.yml` */15, `cron-scores.yml` */10, `cron-mlb-cycle.yml` */5 → POST `/api/cron/{vsin-odds,scores,mlb-cycle}` (CRON_SECRET) | same jobs via `CronJobRunner` run-lock | `.github/workflows/*` headers; `server/cron/cronRoutes.ts:37-103` | VERIFIED files |
| **MLB model sync deliberately NOT wired to cron routes** — `runMlbModelForDate` spawns Python which reportedly fails on Railway (`spawn /usr/bin/python3 ENOENT`) | — | `server/cron/cronRoutes.ts:23-27` comment | VERIFIED comment |
| Manual: owner tRPC `mlbModel.forceRerun`; Layer-3 ML-flip immediate reruns | targeted `runMlbModelForDate` | `routers.ts:995-1008,817-829`; `vsinAutoRefresh.ts:1123-1150` | VERIFIED |

**Which host actually executes the model is not determinable from code**: whether `DISABLE_BACKGROUND_JOBS` is set on Railway, whether `cron-mlb-cycle.yml` is enabled in the Actions UI (its header at `.github/workflows/cron-mlb-cycle.yml:4-11` warns to keep it disabled until the Manus host is retired to avoid duplicate writes), and whether Python is available on the serving host are all runtime/environment facts — UNKNOWN (census questions below).

## Patch history relevant to exposure

One-off scripts in `server/` are historical patches, not live paths (none are imported by the server; several are dated force-reruns):

- `forceRerunJune17/18/19.ts`, `runJune13Mlb.ts`, `rerunSFATLG2(.v2).ts`, `forceRerunMay11.mjs` — dated `runMlbModelForDate(..., forceRerun)` invocations (VERIFIED imports at `forceRerunJune17.ts:8`, `runJune13Mlb.ts:8`). Their effects are DB rows only; the mechanism they used is the same live write path.
- `mlb_publish_audit.mjs` / `mlb_state_audit.mjs` — read-only DB audits of publishedToFeed/window behavior (VERIFIED header `mlb_publish_audit.mjs:1-4`); they reference `mlbPublicationGate` only in comments.
- `[FIX 2026-06-24] MODELRUNAT GATE` — client edge flags forced null when `modelRunAt` null after RL INVALIDATE left stale odds (root cause and gate documented in `server/gameCardEdgeGate.test.ts:1-16`; live gate mirrored in `GameCard.tsx` (`:777-779`) and `DimeModelFeed.tsx:639-641`). Now part of the live path. VERIFIED.
- `[FIX] 2026-06-07` — RL cover pcts began being persisted (`mlbModelRunner.ts:2478-2481` comment). Live.
- P5/P6 recalibrations of HR props (2026-05-11, n=2438) changed `MIN_ABSOLUTE_P_HR` 0.25→0.18, kept edge 0.060 (`mlbHrPropsModelService.ts:67-77` comments). Live values cited above.
- K-prop OVER gating patch: OVER threshold raised 0.040→0.150 + line ≤5.5 gate ("33.3% win rate at 6.5+", `mlbKPropsModelService.ts:69-73`). Live.
- `recalibrateHrProps.mjs`, `patchRlSigmoid.py`, `backfill*/heal_*` scripts — not examined this session for this section; whether their changes are in the live path is covered by the per-market dossiers. UNKNOWN here.

## Open questions (UNKNOWN)

1. Is `DISABLE_BACKGROUND_JOBS` set on the Railway production service? If yes, the only F5/NRFI/K-prop/HR writes come from the GH-Actions `mlb-cycle` endpoint and **nothing runs the full-game model** (cron deliberately excludes it, `cronRoutes.ts:23-27`) unless Python works in the Railway image (CLAUDE.md says the Dockerfile installs Debian Python — runtime state unverified).
2. Is `cron-mlb-cycle.yml` enabled in the Actions UI (its header says leave disabled until Manus is retired)? Concurrent Manus + Actions writers risk duplicate `mlb_strikeout_props` rows (stated at `.github/workflows/cron-mlb-cycle.yml:4-11`).
3. Which environment currently satisfies `spawn /usr/bin/python3` (model runner) and `/usr/bin/python3.11` (F5/NRFI scraper, `mlbF5NrfiScraper.ts:26`) — the two different interpreter paths suggest at least one host where one of them fails.
4. Do any current `mlb_strikeout_props` rows still carry the legacy `verdict='EDGE'` vocabulary (DB check), which is the only value that lights the mint signal on `/m/props` and `MlbPropsCard`?
5. Real distribution of `modelPNrfi`/`modelF5OverRate` values in the DB (0–1 vs 0–100) across historical writes — earlier writers may have used the other scale (DB check).
6. Is the intended subscriber roadmap (per `design-system/dime-ai/pages/ai-model-projections.md:20` sub-tabs "Projections · Splits · Lineups · K Props · Cheat Sheets · HR Props") going to re-mount `ModelProjections.tsx` components — i.e., are the latent scale bugs in `MlbF5NrfiCard` on a path back to production?
7. Who/what still runs against the Manus host (the "in-process loop … still calls runMlbCycleOnce()" claim in the workflow header) — is Manus retired as of today?

## Finding candidates

| Severity | Title | Evidence |
|---|---|---|
| P1 | Publication gate (`mlbPublicationGate.ts`: 70% accuracy floor, ROI>0, zero-leakage) is dead code — never invoked on any production path; every model run auto-publishes | only importer is `server/mlbBacktestAudit.test.ts:78-82`; auto-publish at `server/mlbModelRunner.ts:2548-2549` |
| P1 | Owner approval flags are decorative for MLB: `publishedToFeed`/`publishedModel` neither gate the public read (`db.ts:431-461` — NCAAM-only gate) nor stay false (runner sets both true), so `games.setModelPublished`/`bulkApproveModels` cannot retract MLB numbers from the feed | `server/db.ts:444-461`, `server/mlbModelRunner.ts:2548-2549`, `server/routers.ts:488-507` |
| P1 | Post-write validation gate is log-only: hard issues (RL inversion, total mismatch, push-probability anomalies) do not unpublish or block already-written rows | `server/mlbModelRunner.ts:2625-2642,1392-1517` |
| P2 | Probability-scale inconsistency across sibling columns (`modelPNrfi`, `modelF5OverRate` 0–1 vs `modelOverRate`, `modelF5AwayWinPct` 0–100) with a concrete consumer bug: `MlbF5NrfiCard` renders NRFI ~"0.6%"/YRFI ~"99.4%" and computes edge/EV on the wrong scale (currently latent — page unrouted) | `server/mlbModelRunner.ts:2465,2490-2493,2507`; `MLBAIModel.py:2008,2014`; `client/src/components/MlbF5NrfiCard.tsx:264-272,353-354`; correct twin at `MlbCheatSheetCard.tsx:794-797` |
| P2 | Server writes an `[EDGE]` label for ANY positive edge (>0pp) while the client threshold is 1.5pp and GameCard ML mint is 0.5pp — three different edge definitions for the same numbers | `server/mlbModelRunner.ts:2230,2309-2324`; `client/src/lib/edgeUtils.ts:144`; `client/src/components/GameCard.tsx:981` |
| P2 | K-prop verdict vocabulary mismatch: live writer emits "OVER"/"UNDER"/"PASS" but both consumer components signal mint only on `verdict === "EDGE"` (legacy Python vocabulary) — edge highlighting silently dead on the owner props surface | `server/mlbKPropsModelService.ts:487-505`; `client/src/features/mobileOwnerTabs/screens/MobileProps.tsx:389`; `client/src/components/MlbPropsCard.tsx:285`; `server/StrikeoutModel.py:1476-1479` |
| P2 | All MLB model numbers (games, K-props, HR-props, lineups) are exposed via unauthenticated public tRPC procedures while the product gates the UI behind login — paywall exists only client-side | `server/routers.ts:311,1154-1178,1410-1431` (publicProcedure), `client/src/App.tsx:276-277` (RequireAuth) |
| P2 | The scheduled cron routes deliberately exclude the MLB model run (Python spawn fails on Railway per comment), so full-game model freshness depends entirely on in-process schedulers whose enablement (`DISABLE_BACKGROUND_JOBS`) is a runtime unknown | `server/cron/cronRoutes.ts:23-27`; `server/_core/index.ts:840-877` |
| P3 | F5/NRFI/HR model markets are computed, validated, and publicly queryable but rendered on no routed page — dead UI carrying stale claims ("Edge threshold: ±3%", FanDuel branding) that conflict with the live 1.5pp standard | routing greps; `MlbF5NrfiCard.tsx:612`; `ModelProjections.tsx` unimported |
| P3 | `/admin/*` pages are gated only by client-side `RequireAuth` (any authenticated subscriber can mount them); protection rests solely on per-procedure server gates | `client/src/App.tsx:294-352`; `client/src/components/RequireAuth.tsx` (no role check) |
| P3 | Duplicate/competing schedulers for the same MLB writes (in-process 5-min MLBCycle + in-process 5-min MlbModelSync + GH-Actions mlb-cycle + Manus legacy loop) with a documented duplicate-row risk on tables lacking unique constraints | `.github/workflows/cron-mlb-cycle.yml:4-11`; `server/_core/index.ts:846,877`; `server/vsinAutoRefresh.ts:2068-2101` |
