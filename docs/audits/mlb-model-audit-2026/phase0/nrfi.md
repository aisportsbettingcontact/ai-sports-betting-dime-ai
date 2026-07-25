# NRFI / YRFI — Phase 0 Dossier

Evidence classes: **VERIFIED** = code read at cited location this session. **INFERRED** = reasoned from verified facts (reasoning stated). **UNKNOWN** = could not be established from code; becomes a census question.

---

## Overview

NRFI ("No Run First Inning") / YRFI is priced by the same Python Monte Carlo engine that produces all MLB game markets. P(NRFI) is **not** a standalone pitcher-rate model: it is a first-inning Monte Carlo simulation whose first-inning run mean (`mu_1st`) is a weighted blend of three signals — simulation "physics" (50%), the two starters' 3-year empirical NRFI rates converted to run-rates via a Poisson inverse (35%), and 3-year team NRFI tendencies (15%) (VERIFIED, `server/MLBAIModel.py:960-1150`). The dedicated pitcher-rate signal exists *separately* as `nrfiCombinedSignal`/`nrfiFilterPass` — a pure pitcher-rate filter persisted to the `games` table; it does **not** alter the price, it is a display badge / backtest filter (VERIFIED, `server/mlbModelRunner.ts:1864-1901, 2554-2558`; consumed at `client/src/components/MlbCheatSheetCard.tsx:817-819, 858-866`).

Two *competing* implementations of the combined signal exist: TypeScript computes an **arithmetic mean with threshold 0.56** and that is what is persisted; Python computes a **geometric mean with threshold 0.52** (the "P1-C/P3-C" recalibration) and that value is discarded (VERIFIED, details in Model mechanics and Patch history below).

Book NRFI/YRFI odds come from a separate scraper chain (Action Network → FanDuel NJ book_id 69) written to `games.nrfiOverOdds` / `games.yrfiUnderOdds`; they are display/backtest inputs only and are never fed into the model (VERIFIED, `server/mlbF5NrfiScraper.ts`, `server/ActionNetworkF5NrfiAPI.py`; the engine's `book_lines` payload contains no NRFI odds, `server/mlbModelRunner.ts:1854` with `book_lines` built from ML/RL/total only).

Per-inning distributions (`modelInning*` columns) come from a *third*, physics-only per-inning simulation inside the same engine run — it does **not** include the NRFI Bayesian priors, so the persisted I1 "P(neither scores)" differs from `modelPNrfi` for the same game (VERIFIED, `server/MLBAIModel.py:1324-1396` vs `960-1150`).

---

## Data inputs & ingestion

### 1. Pitcher 3-year NRFI rates (model prior)

- Stored on `mlb_pitcher_stats`: `nrfiStarts` (int), `nrfiCount` (int), `nrfiRate` (double), plus provenance columns `nrfiSampleSeasons` varchar(32), `nrfiCalibVersion` varchar(32), `nrfiSeededAt` bigint (VERIFIED, `docs/audits/mlb-model-audit-2026/census/schema-columns.tsv:395-403`; drizzle definitions with comments "seeded from 3yr backtest", `drizzle/schema.ts:1151-1170` region, `nrfiRate` at `drizzle/schema.ts:1159`).
- Loaded by the model runner in its batch pitcher fetch (VERIFIED, `server/mlbModelRunner.ts:617-621`) and carried through two side-channel maps keyed `"name|TEAM"`: `__nrfiRateByKey`, `__nrfiStartsByKey` (VERIFIED, `server/mlbModelRunner.ts:857-866`). Name matching uses NFD accent-stripping normalization (VERIFIED, `server/mlbModelRunner.ts:742-743`).
- **Seeding/refresh: no writer of `nrfiStarts`/`nrfiCount`/`nrfiRate` exists anywhere in the repo** (VERIFIED absence: repo-wide grep found only readers — `server/mlbModelRunner.ts`, `scripts/backfillNrfiSignals.ts`, one-off audit `.mjs` scripts). The runner comment says "seeded 2026-04-14 from 5,109-game backtest" (VERIFIED, `server/mlbModelRunner.ts:617`). The seeding tool itself is not in the repo → UNKNOWN (see Open questions).
- The daily pitcher-stat refresher `seedPitcherStats.ts` **preserves** NRFI columns on update (its `.set` omits them) but **inserts new rows without them** — new pitchers and traded pitchers (new `(mlbamId, teamAbbrev)` row) get `nrfiRate = NULL` (VERIFIED, `server/seedPitcherStats.ts:204-243`). A null-rate lookup for the team-keyed row falls through `??` to the name-only entry, which is "first occurrence wins" and may be either row (VERIFIED, `server/mlbModelRunner.ts:774-776, 861-862`).

### 2. Team 3-year NRFI rates (model prior)

- Hard-coded constants in the Python engine: `TEAM_NRFI_RATES` for all 30 teams (e.g. PIT 0.5765 … COL 0.4559) and `TEAM_NRFI_LEAGUE_MEAN = 0.5150` (VERIFIED, `server/MLBAIModel.py:272-304`). The runner always passes `away_team_nrfi/home_team_nrfi = null`, so `project_game` auto-resolves from these constants (VERIFIED, `server/mlbModelRunner.ts:1896-1898`; `server/MLBAIModel.py:2478-2481`).

### 3. Game-level physics inputs

- The first-inning physics mean is `team_state.mu × INNING1_RUN_SHARE`; `home_state`/`away_state` are built by the engine's game-state builder from team stats, pitcher stats, park, bullpen, umpire, weather, lineups (VERIFIED that `mu_1st_physics` uses `home_state["mu"]` at `server/MLBAIModel.py:975-976`; state built at `server/MLBAIModel.py:2765-2772`; the full upstream feature chain is out of scope for this section — see the totals dossier). Note: the first-inning physics mu uses the **pre-HFA** `home_state["mu"]`, while the full-game simulation applies HFA (`home_mu = mu × (1 + hfa×0.15)`, `away × (1 − hfa×0.08)`) (VERIFIED, `server/MLBAIModel.py:909-911` vs `975-976`).

### 4. NRFI/YRFI book odds (display/backtest only)

- `server/ActionNetworkF5NrfiAPI.py` GETs `https://api.actionnetwork.com/web/v2/scoreboard/mlb` with `periods=event,firstfiveinnings,firstinning` and reads only the FanDuel NJ book (`FD_NJ_BOOK_ID = "69"`) from the response (VERIFIED, `server/ActionNetworkF5NrfiAPI.py:43-46, 171-232`). The `firstinning` total market (line typically 0.5) yields `overOdds` = YRFI, `underOdds` = NRFI (VERIFIED, `server/ActionNetworkF5NrfiAPI.py:29-32, 250-254`).
- `server/mlbF5NrfiScraper.ts` spawns that script with `/usr/bin/python3.11`, matches records to DB games by `AWAY@HOME` key (doubleheaders resolved by array-shift order), and writes: `nrfiOverOdds ← rec.nrfi.underOdds` (the NRFI price) and `yrfiUnderOdds ← rec.nrfi.overOdds` (the YRFI price) (VERIFIED, `server/mlbF5NrfiScraper.ts:25, 157-230`, odds swap with explanatory comments at `224-228`). Column naming is inverted relative to plain reading ("nrfiOverOdds" holds the *under-0.5* price); the schema comment documents this: "NRFI over (no run) odds from FanDuel NJ" (VERIFIED, `drizzle/schema.ts:470-472`). All current consumers (cheat-sheet UI, multi-market backtest) interpret it correctly as the NRFI price (VERIFIED, `client/src/components/MlbCheatSheetCard.tsx:1049-1060`; `server/mlbMultiMarketBacktest.ts:653`).

### 5. Actual-result ingestion (grading inputs)

- `server/mlbScoreRefresh.ts` derives `nrfiResult = (inn1Away === 0 && inn1Home === 0) ? "NRFI" : "YRFI"` from the MLB Stats API linescore and writes `games.nrfiActualResult` when the game is final (VERIFIED, `server/mlbScoreRefresh.ts:434-443, 660-679`).
- `server/mlbOutcomeIngestor.ts` independently derives `nrfiBinary` (1 = scoreless I1) from a linescore-hydrated schedule call and writes `games.actualNrfiBinary` + `games.brierNrfi` (VERIFIED, `server/mlbOutcomeIngestor.ts:313-319, 585-601`).

---

## Model mechanics

Flow for one game (all VERIFIED in `server/MLBAIModel.py` unless noted):

1. `project_game(...)` receives `away_pitcher_nrfi/home_pitcher_nrfi` = each starter's **own** 3yr rate + starts from the runner (`server/mlbModelRunner.ts:1892-1895` → spawned driver `server/mlbModelRunner.ts:1267-1272`).
2. Team rates/F5 RS auto-resolved from constants when null (`MLBAIModel.py:2478-2485`).
3. `project_game` **crosses** the pitcher args before calling `simulate()` so that inside the simulator `home_pitcher_nrfi` = the pitcher *facing* the home lineup (= away SP), with starts crossed to match (VERIFIED, `MLBAIModel.py:2829-2844`). Inside `simulate()` the comments at `1003-1004, 1034-1036, 1089-1091` confirm this convention. The wiring is **correct** end-to-end.
4. **Shrinkage**: `_apply_nrfi_shrinkage(raw, starts)` — if `starts < 20`, `rate_adj = w·raw + (1−w)·0.8899` with `w = starts/(starts+10)`; if `starts ≥ 20` or `starts is None`, raw rate is used unchanged (VERIFIED, `MLBAIModel.py:987-1000`). Note `starts=None` bypasses shrinkage entirely (`996`).
5. **Blend to first-inning mu** (per team):
   - both priors present: `mu_1st = physics×0.50 + (−ln(pitcher_rate_adj))×0.35 + (−ln(team_rate))×0.15` (`1037-1045`, away mirror `1092-1099`)
   - pitcher only: `physics×0.65 + pitcher×0.35` (`1057-1060`, away `1111-1113`)
   - team only: `physics×0.50 + team×0.50` (`1070-1073`, away `1123-1125`)
   - neither: physics only (`1080-1082`, away `1132-1133`)
   - `_nrfi_to_mu` clamps the rate to [0.01, 0.99] before `−ln` (`1027-1032`).
6. **Simulation**: `home_1st/away_1st = NBGammaMixture.sample(mu_1st, var_1st, n_sims)`; `p_nrfi = mean(home_1st==0 & away_1st==0)`; `p_yrfi = 1 − p_nrfi` (`1140-1151`). Since the runner passes team priors as null and TEAM_NRFI_RATES always resolves, in practice the 0.50/0.35/0.15 branch is taken whenever the pitcher rate is non-null, else 0.50/0.50 physics/team (INFERRED from steps 2 and 5: team rate can never be missing when going through `project_game`).
7. **Sampler internals**: the NB-Gamma mixture draws a Gamma(shape=4.0, mean=1.0) multiplier per sim, clipped to [0.3, 3.0], then samples NB with per-draw variance `max(adj_mu×1.5, adj_mu+0.5)`. **The `variance` argument is computed into `_r_base,_p_base` and never used** — so the carefully computed `var_1st = max(team_variance×0.1166, mu+0.01)` (`1140-1145`) and the per-inning `var = max(var×w, mu+0.005)` (`1369-1370`) have **no effect** on any sampled distribution (VERIFIED, `MLBAIModel.py:782-812`, dead assignment at `798`). The Python loop at `806-811` runs once per simulation (400k iterations per `sample()` call, ~24 calls per game).
8. **Filter signals (Python side, discarded)**: `nrfi_combined_signal = sqrt(away_rate × home_rate)` (geometric mean, raw un-shrunk rates), `nrfi_combined_pass = signal ≥ 0.52`, `nrfi_both_pass = both ≥ 0.54` (`1155-1172`). Returned through the result dict (`1512-1517`, `2970-2975`) but the runner's `MlbModelResult` interface has no such fields and the DB write ignores them (VERIFIED, `server/mlbModelRunner.ts:264-283` interface, write at `2554-2558` uses the TS-side input values instead).
9. **Filter signals (TS side, persisted)**: `combined = (awayNrfi + homeNrfi)/2` (arithmetic, raw un-shrunk), `filterPass = combined ≥ 0.56`, `bothPass = both ≥ 0.56` (log-only) (VERIFIED, `server/mlbModelRunner.ts:1872-1877`). These are what land in `games.nrfiCombinedSignal` / `games.nrfiFilterPass`.
10. **Pricing**: `remove_vig(p_nrfi, p_yrfi)` (a no-op — the two already sum to 1; INFERRED from `remove_vig` normalizing by the sum, `MLBAIModel.py:574-578`), then `nrfi_odds = prob_to_ml(p_nrfi_nv)`, `yrfi_odds = prob_to_ml(p_yrfi_nv)` with probability clamp [0.001, 0.999] (VERIFIED, `MLBAIModel.py:1950-1961, 561-567`). Output dict: `p_nrfi`/`p_yrfi` rounded to 4 dp, odds as signed numbers (`2013-2018`, surfaced at `2964-2969`).
11. **Validation gate (log-only)**: `|p_nrfi − 0.5093| < 0.12` check via `logger.verify` (`1181-1185`); does not block the write. Post-write validation `validateMlbModelResults` checks totals/RL/F5-push but has **no NRFI checks** (VERIFIED, `server/mlbModelRunner.ts:1362-1530`, no `nrfi` occurrences).
12. **Per-inning distributions**: an independent loop samples each inning i with `mu = state.mu × INNING_WEIGHTS[i]` (no NRFI priors, no HFA) and records exp/std/P(scores)/P(both)/P(neither) per inning (`1324-1396`). I1's `P(neither)` is therefore a *different* NRFI estimate than `p_nrfi`; a consistency `logger.verify` requires the two first-inning expected totals to agree within 0.15 runs (`1398-1406`).

### Parameter table

| Parameter | Value | Location (VERIFIED) |
|---|---|---|
| `SIMULATIONS` (default n_sims) | 400,000 | `server/MLBAIModel.py:68` |
| `MIN_SIMULATIONS` / `SIM_MAX` clamp | 250,000 / 500,000 | `server/MLBAIModel.py:69-70, 881-883` |
| `project_game` default seed | 42 (deterministic RNG) | `server/MLBAIModel.py:2423, 884` |
| `INNING1_RUN_SHARE` | 0.1166 | `server/MLBAIModel.py:103` |
| `LEAGUE_NRFI_PRIOR` | 0.8899 = exp(−0.1166) | `server/MLBAIModel.py:105` |
| `NRFI_SHRINKAGE_K` | 10 | `server/MLBAIModel.py:107` |
| `NRFI_MIN_STARTS_FULL` (shrinkage cutoff) | 20 starts | `server/MLBAIModel.py:109` |
| `NRFI_PHYSICS_WEIGHT` / `NRFI_PITCHER_WEIGHT` / `NRFI_TEAM_WEIGHT` | 0.50 / 0.35 / 0.15 | `server/MLBAIModel.py:350-352` |
| Fallback blend, pitcher-only | physics 0.65 / pitcher 0.35 | `server/MLBAIModel.py:1060, 1113` |
| Fallback blend, team-only | physics 0.50 / team 0.50 | `server/MLBAIModel.py:1073, 1125` |
| `_nrfi_to_mu` rate clamp | [0.01, 0.99] | `server/MLBAIModel.py:1032` |
| `NRFI_COMBINED_THRESHOLD` (Python, geometric) | 0.52 | `server/MLBAIModel.py:361-363` |
| `NRFI_BOTH_THRESHOLD` (Python) | 0.54 | `server/MLBAIModel.py:364-366` |
| `NRFI_THRESHOLD` (TS, arithmetic — the persisted one) | 0.56 | `server/mlbModelRunner.ts:1872` |
| `TEAM_NRFI_RATES` (30 teams) | 0.4559 (COL/NYY) … 0.5765 (PIT) | `server/MLBAIModel.py:272-303` |
| `TEAM_NRFI_LEAGUE_MEAN` | 0.5150 | `server/MLBAIModel.py:304` |
| `EMPIRICAL_PRIORS["nrfi_rate"]` (verify gate only) | 0.5093 | `server/MLBAIModel.py:387` |
| NRFI verify-gate tolerance | ±0.12 (log-only) | `server/MLBAIModel.py:1181-1185` |
| First-inning variance input (dead — see §7) | max(team_var×0.1166, mu+0.01) | `server/MLBAIModel.py:1140-1145` |
| NB-Gamma `gamma_shape` | 4.0 | `server/MLBAIModel.py:787` |
| NB-Gamma multiplier clip | [0.3, 3.0] | `server/MLBAIModel.py:802` |
| NB per-draw variance | max(adj_mu×1.5, adj_mu+0.5) | `server/MLBAIModel.py:809` |
| `prob_to_ml` probability clamp | [0.001, 0.999] | `server/MLBAIModel.py:562` |
| `INNING_WEIGHTS` raw I1..I9 | 0.116647, 0.102130, 0.114120, 0.113854, 0.115029, 0.114764, 0.108511, 0.109019, 0.079211 (normalized to sum 1) | `server/MLBAIModel.py:1338-1350` |
| Per-inning variance floor (dead) | mu + 0.005 | `server/MLBAIModel.py:1369-1370` |
| Pitcher season/rolling-5 blend (feeds physics mu) | 0.70 / 0.30, min 3 rolling starts | `server/mlbModelRunner.ts:696-698` |
| HFA applied to full-game mu but not I1 physics | home ×(1+hfa×0.15), away ×(1−hfa×0.08) | `server/MLBAIModel.py:909-911` vs `975-976` |
| Backtest NRFI breakeven / min-edge | 0.524 / 0.05 | `server/mlbFullBacktestEngine.ts:69-70, 89` |
| Multi-market backtest NRFI confidence threshold | 0.55 | `server/mlbMultiMarketBacktest.ts:78` |
| Drift-detector NRFI baseline | 0.4882 (n=5103) | `server/mlbDriftDetector.ts:216` |
| Legacy backfill script threshold | 0.56 arithmetic | `scripts/backfillNrfiSignals.ts:12` |

---

## Projection → DB write path

All writes are `UPDATE games SET ... WHERE games.id = r.db_id` (keyed by the games-table primary key carried through the engine as `db_id`), executed per game inside `runMlbModelForDate` Step 5 (VERIFIED, `server/mlbModelRunner.ts:2504-2560`):

| Column | Source | Notes |
|---|---|---|
| `games.modelPNrfi` | `String(r.p_nrfi.toFixed(4))` — **0–1 scale** no-vig P(NRFI) | column is `decimal(5,2)` → MySQL keeps 2 decimals (0.47, not 0.4725). Schema comment claims "(0-100)" — wrong vs writer. VERIFIED `server/mlbModelRunner.ts:2507`; `census/schema-columns.tsv:141`; `drizzle/schema.ts:475-476` |
| `games.modelNrfiOdds` / `games.modelYrfiOdds` | `fmtMl(r.nrfi_odds)` / `fmtMl(r.yrfi_odds)` (fair-value American, varchar) | VERIFIED `server/mlbModelRunner.ts:2508-2509` |
| (no `modelPYrfi`) | — | column does not exist; YRFI prob encoded via odds / derived as 1−p in UI. VERIFIED comment `server/mlbModelRunner.ts:2506, 2510` |
| `games.modelInningHomeExp/AwayExp/TotalExp` | JSON arrays `[I1..I9]` from `r.inning_*_exp`, only if length 9 | VERIFIED `server/mlbModelRunner.ts:2528-2533` |
| `games.modelInningPHomeScores/PAwayScores/PNeitherScores` | JSON arrays from `r.inning_p_*` | `inning_p_both_score` and per-inning std are computed but never persisted. VERIFIED `server/mlbModelRunner.ts:2534-2539` |
| `games.nrfiCombinedSignal` | `engineInputById.get(r.db_id)?.nrfi_combined_signal` — the **TS arithmetic mean** | Python geometric value discarded. VERIFIED `server/mlbModelRunner.ts:2555` |
| `games.nrfiFilterPass` | TS `filterPass` (≥0.56) as tinyint 1/0 | VERIFIED `server/mlbModelRunner.ts:2556-2558` |
| `games.modelRunAt`, `publishedToFeed=true`, `publishedModel=true` | write metadata | VERIFIED `server/mlbModelRunner.ts:2543, 2548-2549` |

Modelable gate: game needs `bookTotal`, `awayML`, `homeML`, `awayRunLine`, and both starting pitchers; already-modeled games skipped unless `forceRerun` or `modelRunAt` date ≠ game date (VERIFIED, `server/mlbModelRunner.ts:1586-1618`).

Book-odds write path (separate cadence): `games.nrfiOverOdds` (NRFI price) and `games.yrfiUnderOdds` (YRFI price) keyed by `games.id` after AWAY@HOME matching (VERIFIED, `server/mlbF5NrfiScraper.ts:210-230`).

Grading/metrics writes:
- `games.nrfiActualResult` ("NRFI"/"YRFI") — mlbScoreRefresh on game-final (VERIFIED, `server/mlbScoreRefresh.ts:660-679`).
- `games.actualNrfiBinary`, `games.brierNrfi`, `games.outcomeIngestedAt` — nightly outcome ingestor (VERIFIED, `server/mlbOutcomeIngestor.ts:585-601` region; brier at `223-227`).
- `games.nrfiBacktestResult`, `games.nrfiCorrect`, `games.nrfiBacktestRunAt` — **no writer found anywhere in the repo** (VERIFIED absence via repo-wide grep; only readers `server/routers/mlbSchedule.ts:1029, 1080` and the audit census tool). Apparently dead columns from a retired grading pass → census question.

---

## Exposure (API + UI)

- **tRPC games feed**: NRFI fields are part of the MLB games list payload; `server/routers.ts` keeps them in the MLB field set (`'nrfiOverOdds','yrfiUnderOdds','modelPNrfi','modelNrfiOdds','modelYrfiOdds','nrfiActualResult','nrfiBacktestResult','nrfiCorrect','nrfiCombinedSignal','nrfiFilterPass'` and the `modelInning*` JSON columns) and strips them for NHL (VERIFIED, `server/routers.ts:123-136`).
- **Cheat Sheets UI (live)**: `client/src/components/MlbCheatSheetCard.tsx`, rendered via `CheatSheetView` on the feed's `f5nrfi` tab (labeled "CHEAT SHEETS") in `client/src/pages/ModelProjections.tsx:1678-1701` (VERIFIED). It:
  - multiplies `modelPNrfi` ×100 with an explicit comment that DB stores raw decimal (VERIFIED, `MlbCheatSheetCard.tsx:27-28, 794-797`), derives YRFI = 100 − NRFI%,
  - shows book NRFI/YRFI odds from `nrfiOverOdds`/`yrfiUnderOdds` with edge/EV (edge flag at |edge| ≥ 3%) (VERIFIED, `MlbCheatSheetCard.tsx:670-673, 1049-1060`),
  - shows a center "P(NRFI)" box that uses `modelInningPNeitherScores[0]` — the physics-only per-inning value, i.e. a *different* number from `modelPNrfi` shown two rows below (VERIFIED, `MlbCheatSheetCard.tsx:776, 802, 613-629`),
  - shows an "NRFI x%" badge when `nrfiFilterPass === 1` using the persisted arithmetic signal (VERIFIED, `MlbCheatSheetCard.tsx:817-819, 858-866`).
- **Dead component**: `client/src/components/MlbF5NrfiCard.tsx` is imported by ModelProjections (`ModelProjections.tsx:23`) but never rendered (VERIFIED: only occurrence is the import; the f5nrfi tab renders CheatSheetView). It treats `modelPNrfi` as a 0–100 percent (`MlbF5NrfiCard.tsx:263-272` with `computeEdgeEV` dividing by 100 at `132-150`), which with 0–1 stored values would show NRFI ≈ 0.5% and YRFI ≈ 99.5% with a huge false YRFI edge — latent bug, currently unreachable (INFERRED unreachable from absence of JSX usage).
- **Results/analytics**: `server/routers/mlbSchedule.ts` exposes `brierNrfi` per-game + rolling averages + null counts (VERIFIED, `mlbSchedule.ts:432-560, 596-650`) rendered on `ModelResults.tsx`/`TheModelResults.tsx` (nrfi market cells, `nrfiCorrect` per game) (VERIFIED, `ModelResults.tsx:439, 1109`; `TheModelResults.tsx:626-712`).
- **Backtests**: `server/mlbMultiMarketBacktest.ts` evaluates NRFI/YRFI vs `nrfiActualResult` using `modelPNrfi` (treated as 0–1) or model odds, no-vig book prob from `nrfiOverOdds`/`yrfiUnderOdds`, confidence 0.55 (VERIFIED, `mlbMultiMarketBacktest.ts:644-701`); `server/mlbFullBacktestEngine.ts` grades `nrfi`/`yrfi` markets from `nrfiResult` with breakeven 0.524 (VERIFIED, `mlbFullBacktestEngine.ts:69-70, 924-963, 1078-1079`).
- **Bet tracking**: `tracked_bets.timeframe` enum includes NRFI/YRFI (VERIFIED, `census/schema-columns.tsv:600`); scoreGrader grades them off inning-1 totals (VERIFIED, `server/scoreGrader.ts:216-250`); betTracker maps timeframes (VERIFIED, `server/routers/betTracker.ts:45-49, 135-145`).

---

## Scheduling & triggers

All schedulers start in `server/_core/index.ts` behind the `DISABLE_BACKGROUND_JOBS` guard (VERIFIED, `_core/index.ts:840-877`):

| Trigger | Cadence | What runs | Citation |
|---|---|---|---|
| `startMlbModelSyncScheduler()` | every 5 min, 24/7, immediate on boot; 15-min watchdog with self-healing re-trigger | `runMlbModelForDate(today)` + `(tomorrow)` → NRFI model fields written for any game with pitchers+lines and `modelRunAt` null | `server/mlbModelRunner.ts:2673, 2799-2825`; started `_core/index.ts:877` |
| `startVsinAutoRefresh()` → `runMlbCycleOnce()` | every 5 min (`MLB_INTERVAL_MS`), immediate on boot | Step 1 score refresh (`refreshMlbScoresNow` → writes `nrfiActualResult` on final); Step 5 lineups watcher (targeted `runMlbModelForDate(..., {targetGameIds, forceRerun:true})` on lineup change, `server/mlbLineupsWatcher.ts:582-583`); Step 6 fallback full model run for today+tomorrow; Step 7 F5/NRFI odds scrape — gated to after 7:00 AM EST (12:00 UTC), today only | `server/vsinAutoRefresh.ts:1361, 1704-1710, 1819, 1859-1875, 1996-2020, 2068, 2096-2101`; started `_core/index.ts:846` |
| `startMlbOutcomeAndDriftScheduler()` | 60s tick; nightly pipeline at 12:30 AM PST (ingests yesterday); monthly recalibration 1st @ 3:00 AM PST | Nightly: `ingestMlbOutcomes` (writes `actualNrfiBinary`, `brierNrfi`) then f5-share drift check. Monthly: `triggerRecalibration("SCHEDULED")` → runs `server/scripts/runMlbBacktest2.py` → writes calibration JSON → **regex-patches `EMPIRICAL_PRIORS` in MLBAIModel.py in place** (including `nrfi_rate`, `i1_share`) with a `.bak` backup | `server/mlbOutcomeAndDriftScheduler.ts:207-244, 265-277`; `server/mlbDriftDetector.ts:570-664, 729-824 (nrfi_rate patch at 785-786)`; started `_core/index.ts:873` |
| Invalidated-game re-run | immediate (setImmediate) after RL invariant violation | targeted `runMlbModelForDate` with `forceRerun` — rewrites NRFI fields too | `server/mlbModelRunner.ts:2599-2623` |
| Manual/admin | tRPC procedures | `routers.ts:822-823` (single-game re-run), `routers.ts:1005` (`forceRerun` full date) | VERIFIED `server/routers.ts:822-823, 1005` |

Note on the monthly recalibration: it edits the deployed `MLBAIModel.py` file at runtime. On Railway the container filesystem is ephemeral, so patched constants persist only until the next deploy (INFERRED from deploy law in CLAUDE.md — Railway rebuilds from Docker image on push; the patch is not committed to git). The patched constants (`nrfi_rate`, `i1_share`) only affect the log-only verify gate and *not* NRFI pricing weights (VERIFIED: `EMPIRICAL_PRIORS["nrfi_rate"]` is used only at `MLBAIModel.py:1182`; `i1_share` in EMPIRICAL_PRIORS is separate from the load-bearing `INNING1_RUN_SHARE` module constant at line 103, which `patchConstant` does not target — its regex targets quoted dict keys only, `mlbDriftDetector.ts:762-779`).

---

## Patch history relevant to this market

| Patch | What changed | In live path now? |
|---|---|---|
| **P1-C "NRFI product formula fix"** (commit `f25c16c0`, session 2026-05-10) | Python `nrfi_combined_signal` changed arithmetic → geometric mean; threshold 0.56 → 0.53 | Python side: yes (VERIFIED `MLBAIModel.py:1160-1167, 354-357`). **TS side never migrated** — the todo item "mlbModelRunner.ts: update TS-side combined signal to product formula" is still unchecked (VERIFIED, `todo.md:3124-3128`), and TS (arithmetic, 0.56) is what is persisted (VERIFIED, `mlbModelRunner.ts:1872-1874, 2555`) |
| **P3-C "NRFI threshold re-evaluation"** (2026-05-10) | Python combined threshold 0.53 → 0.52, both-threshold 0.56 → 0.54, justified by 7.2% model underestimation (model avg pNRFI 0.4725 vs empirical 0.5093, n=597) | Python constants yes (VERIFIED `MLBAIModel.py:358-366`; `todo.md:3189`) but the values gate a signal that is never persisted (see above) |
| **v2 calibration 2026-04-14** ("3yr backtest integration") | `INNING1_RUN_SHARE` 0.1093 → 0.1166; team NRFI/F5 tables; inning weights exact values; pitcher `nrfiRate` columns seeded in DB from a 5,109-game backtest | Constants yes (VERIFIED `MLBAIModel.py:100-110, 262-352, 1324-1350`). DB seeding tool absent from repo (UNKNOWN) |
| **`scripts/backfillNrfiSignals.ts`** (one-time) | Backfilled `nrfiCombinedSignal`/`nrfiFilterPass` for pre-deployment 2026 games using arithmetic mean, threshold 0.56 | Historical backfill only. Currently **broken/stale**: references `mlbPitcherStats.pitcherName`/`teamAbbr`, columns that do not exist on that table (`fullName`/`teamAbbrev` are real — VERIFIED `scripts/backfillNrfiSignals.ts:23-31` vs `census/schema-columns.tsv:372-373`); would not compile today (INFERRED) |
| **Commit `edb58f20` (2026-05-23)** "scale bug fix for modelF5OverRate/modelPNrfi" | Scale handling fixed inside one-off backtest scripts (`scripts/run_full_season_backtest.mjs` etc.), not in the live writer | Historical scripts only (VERIFIED via `git show edb58f20 --stat`) |
| **MlbF5NrfiCard → MlbCheatSheetCard migration** ("Rename F5/NRFI tab to CHEAT SHEETS", `todo.md:2580`) | New card handles the 0–1 scale correctly; old card left in tree with wrong scale handling | Old card dead but still imported (VERIFIED, `ModelProjections.tsx:23`) |
| **Junis/Eovaldi calibration scripts** (`server/calibrateJunis*.mjs`, `fixJunisInputs.mjs`, `seedJunis2026.mjs`) | One-off `UPDATE mlb_pitcher_stats` rows for specific pitchers (general stats; read nrfiRate for audit) | One-off; not part of live path (VERIFIED file list; not read line-by-line) |

---

## Open questions (UNKNOWN)

1. **Who seeded `mlb_pitcher_stats.nrfiRate/nrfiStarts/nrfiCount` and is anything refreshing them?** No writer exists in the repo. If frozen at 2026-04-14, every pitcher's "3yr rolling" NRFI prior excludes the entire 2026 season to date, and 2026 debut pitchers have NULL rates permanently (falling to the 50/50 physics/team blend). Census: `SELECT nrfiCalibVersion, MIN(nrfiSeededAt), MAX(nrfiSeededAt), COUNT(*), SUM(nrfiRate IS NULL) FROM mlb_pitcher_stats`.
2. **Are `games.nrfiBacktestResult` / `nrfiCorrect` / `nrfiBacktestRunAt` populated at all?** No writer in code; ModelResults UI reads `nrfiCorrect`. Census: non-null counts + last `nrfiBacktestRunAt`.
3. **Actual stored scale/precision of `modelPNrfi`.** Expect 0–1 values truncated to 2 decimals by `decimal(5,2)`. Census: `SELECT MIN(modelPNrfi), MAX(modelPNrfi), COUNT(DISTINCT modelPNrfi)` — also confirms whether any legacy rows used a 0–100 scale (which would rescue some brierNrfi rows, see finding 1).
4. **brierNrfi distribution.** If finding 1 is right, `brierNrfi` should be bimodal at ≈0.99 (NRFI outcomes) and ≈0.00002 (YRFI outcomes), average ≈0.5. Census: histogram of `brierNrfi`.
5. **Does the monthly recalibration ever actually execute and survive?** File-patching a container file is lost on redeploy; also `runMlbBacktest2.py` must exist at the built path. Census: `mlb_model_learning_log` rows with `triggerReason='SCHEDULED'`, and diff live `MLBAIModel.py` constants vs repo.
6. **Doubleheader NRFI odds matching correctness** — scraper matches G1/G2 by array order ("AN returns them in time order; we process them in order too", `mlbF5NrfiScraper.ts:193-195`) with no `gameNumber` verification. Census: spot-check doubleheader rows.
7. **Whether `p_nrfi` inputs ever hit the pitcher-missing fallback in practice** (traded pitchers / rookies with NULL nrfiRate). Census: rate of NULL `nrfiCombinedSignal` among modeled 2026 games.
8. **`EMPIRICAL_PRIORS` patched values drift** — is the live container's `MLBAIModel.py` currently identical to the repo copy? (The audit read the repo copy only.)

---

## Finding candidates

| # | Sev | Title | Evidence |
|---|---|---|---|
| 1 | **P1** | `brierNrfi` is computed on the wrong scale — NRFI Brier scores are garbage | Writer stores P(NRFI) 0–1 (`server/mlbModelRunner.ts:2507`, Python `MLBAIModel.py:2014` rounds a 0–1 no-vig prob); `brierScore` documents "modelProbPct in [0,100]" and divides by 100 (`server/mlbOutcomeIngestor.ts:150-166`), so p≈0.0047 is used for every game; schema comments assert the 0–100 convention (`drizzle/schema.ts:475, 610-616`). Surfaces on admin Brier dashboards (`server/routers/mlbSchedule.ts:432-560`). VERIFIED (both ends read); magnitude INFERRED |
| 2 | **P1** | Persisted `nrfiCombinedSignal`/`nrfiFilterPass` use the superseded arithmetic-mean formula (0.56); the recalibrated geometric formula (0.52) computed in Python is discarded | TS: `mlbModelRunner.ts:1872-1877`, write `2554-2558`; Python: `MLBAIModel.py:1160-1172, 361-366`; unfinished migration: `todo.md:3124-3128` ("mlbModelRunner.ts: update TS-side combined signal to product formula" unchecked). VERIFIED |
| 3 | **P2** | The `variance` argument to the NB-Gamma sampler is dead — all NRFI/per-inning variance engineering (`var_1st`, per-inning floors) has zero effect on sampled distributions | `_r_base,_p_base` assigned and never used; per-draw variance hardcoded `max(adj_mu*1.5, adj_mu+0.5)` (`server/MLBAIModel.py:798-811`); dead inputs at `1140-1145, 1369-1370`. VERIFIED |
| 4 | **P2** | `modelPNrfi` precision destroyed by `decimal(5,2)` — 0–1 probabilities stored with 1%-granularity (0.47), degrading backtest edge math and any Brier fix | Writer `toFixed(4)` (`mlbModelRunner.ts:2507`) vs column type (`census/schema-columns.tsv:141`); multi-market backtest consumes it as probability (`mlbMultiMarketBacktest.ts:652-660`). VERIFIED write path; DB truncation INFERRED from MySQL decimal semantics |
| 5 | **P2** | Pitcher NRFI priors appear frozen at the 2026-04-14 seed — no in-repo writer updates `nrfiRate`/`nrfiStarts`; new/traded pitcher rows are inserted with NULL rates | Absence VERIFIED (repo-wide grep); `seedPitcherStats.ts:204-243` update omits / insert lacks nrfi columns; "3yr rolling" claim at `drizzle/schema.ts` nrfi block and `mlbModelRunner.ts:617`. Frozen-state is INFERRED pending census Q1 |
| 6 | **P3** | UI shows two inconsistent NRFI probabilities on the same card: center "P(NRFI)" box = physics-only `inning_p_neither[0]`, NRFI row = prior-blended `modelPNrfi` | `MlbCheatSheetCard.tsx:776, 802, 613-629` vs `794-797, 1049-1054`; divergent computations `MLBAIModel.py:1324-1396` (no priors/HFA) vs `960-1150`. VERIFIED |
| 7 | **P3** | Dead component `MlbF5NrfiCard.tsx` still imported, contains a latent 100× NRFI scale bug (would flag ~+45% YRFI edge on every game if ever re-rendered) | `MlbF5NrfiCard.tsx:263-272, 132-150`; only usage is the import `ModelProjections.tsx:23`. VERIFIED code, unreachability INFERRED |
| 8 | **P3** | Monthly auto-recalibration self-patches `MLBAIModel.py` on an ephemeral filesystem; changes silently revert on each deploy, and the patched `nrfi_rate` only affects a log-only gate | `mlbDriftDetector.ts:729-824`, gate-only use `MLBAIModel.py:1182`; Railway rebuild INFERRED from deploy runbook |
| 9 | **P3** | `nrfiBacktestResult`/`nrfiCorrect`/`nrfiBacktestRunAt` have no writers but are exposed in API and rendered in results UI (permanently null cells) | absence VERIFIED via grep; readers `routers/mlbSchedule.ts:1029, 1080`, `ModelResults.tsx:1109` |
| 10 | **P3** | Comment drift: runner claims shrinkage kicks in "< 5 starts" but Python shrinks below 20 starts; `project_game` output comment still describes combined signal as "(awayNrfi+homeNrfi)/2" post-P1-C | `mlbModelRunner.ts:859-860, 1891` vs `MLBAIModel.py:109, 996`; stale comment `MLBAIModel.py:2971-2973` |
| 11 | **P3** | First-inning physics mu excludes HFA while the full-game sim includes it — I1 home/away split is systematically flatter than the game-level model implies (P(NRFI) total roughly unaffected) | `MLBAIModel.py:909-911` vs `975-976`. VERIFIED; impact INFERRED |
