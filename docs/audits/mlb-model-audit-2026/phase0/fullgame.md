# Phase 0 Dossier — Full Game Markets (Moneyline / Run Line / Total)

Audit date: 2026-07-25. Evidence classes: **VERIFIED** (code read this session, cited file:line), **INFERRED** (reasoned from verified facts, reasoning stated), **UNKNOWN** (could not confirm from code alone — becomes a census question).

All paths relative to repo root `/Users/danielwalker/src/ai-sports-betting-dime-ai`.

---

## Overview

The full-game MLB markets (moneyline, ±1.5 run line, over/under total) are produced by a two-layer pipeline:

1. **`server/MLBAIModel.py`** (3,019 lines) — a self-contained Monte Carlo engine ("MAX SPEC"). Entry point `project_game()` (MLBAIModel.py:2413) builds per-team run-scoring states from team/pitcher/bullpen/park/weather/umpire features, samples 400,000 games from an NB-Gamma mixture distribution with extra-innings ghost-runner resolution, and derives no-vig markets in `MarketDerivation.derive()` (MLBAIModel.py:1563). **VERIFIED**.
2. **`server/mlbModelRunner.ts`** (2,825 lines) — the TypeScript orchestrator. `runMlbModelForDate()` (mlbModelRunner.ts:1532) selects the day's games from the `games` table, assembles inputs from ~8 DB tables plus the MLB Stats API, spawns `/usr/bin/python3 -c "...from MLBAIModel import project_game..."` (mlbModelRunner.ts:1238-1241), and writes ~60 `model*` columns back to `games` keyed by `games.id`. **VERIFIED**.

The same run also produces F5, NRFI, HR-prop, and inning-by-inning outputs (written on the same DB write), but those are separate market sections; this dossier covers only the full-game ML/RL/total mechanics plus what the shared write path does to them.

The model output is **book-anchored, not line-originating**: the published total is always the book's O/U line (mlbModelRunner.ts:2443-2462), the run line is always the book's ±1.5 (mlbModelRunner.ts:1710-1751), and the model contributes probabilities/odds at those lines. Python's own "optimal line" selection exists (`_select_optimal_total`, MLBAIModel.py:526) but is only a last-resort fallback for `modelTotal` (mlbModelRunner.ts:2460-2461). **VERIFIED**.

Publication is **unconditional**: every successful model write sets `publishedModel=true` and `publishedToFeed=true` (mlbModelRunner.ts:2548-2549). The file named `server/mlbPublicationGate.ts` is a backtest-report scoring module and is **not in the live write path** (see "Patch history / gate" below). **VERIFIED**.

---

## Data inputs & ingestion

### Game + book lines (the `games` row)

`runMlbModelForDate` selects games by `(games.gameDate = dateStr AND games.sport = 'MLB')` with a left join to `mlb_lineups` (mlbModelRunner.ts:1543-1581). **VERIFIED**. Inputs read:

| Input | Column(s) | Notes | Evidence |
|---|---|---|---|
| Moneyline | `games.awayML`, `games.homeML` | parsed with fallback defaults `+100`/`-120` if null (defaults unreachable in practice — see gate) | mlbModelRunner.ts:1754-1755 VERIFIED |
| Total | `games.bookTotal`, `games.overOdds`, `games.underOdds` | odds default `-110/-110` when null | mlbModelRunner.ts:1756-1758 VERIFIED |
| Run line | `games.awayRunLine` (varchar, authoritative), `games.awayRunLineOdds`, `games.homeRunLineOdds` (defaults `+130`/`-150` when null) | `rl_home_spread = -parseFloat(awayRunLine)`; ML-derived direction only as fallback | mlbModelRunner.ts:1710-1762 VERIFIED |
| Starters | `COALESCE(games.awayStartingPitcher, mlb_lineups.awayPitcherName)` (VSiN/MLB API first, Rotowire fallback) | mlbModelRunner.ts:1561-1562 VERIFIED |
| Weather | `mlb_lineups.weatherTemp/weatherWind/weatherDome/weatherPrecip` (Rotowire scraper) | mlbModelRunner.ts:1567-1570 VERIFIED |
| Lineups | `mlb_lineups.awayLineup/homeLineup` JSON + `*LineupConfirmed` flags | mlbModelRunner.ts:1572-1575 VERIFIED |

**Modelability gate** (mlbModelRunner.ts:1602-1618): requires `bookTotal && awayML && homeML && awayRunLine` ("RL GATE" — confirmed DK run line mandatory, no ML-derived fallback allowed to start a run) and both starting pitchers. Games already modeled are skipped unless `modelRunAt`'s calendar date differs from `gameDate` (stale-model re-run, mlbModelRunner.ts:1594-1601). **VERIFIED**.

Book lines are written to `games` by the VSiN/DK scraper `server/vsinAutoRefresh.ts`, which dual-writes `awayRunLine` + `awayBookSpread` and swap-corrects a scraped RL that contradicts ML direction (vsinAutoRefresh.ts:1005-1061). **VERIFIED** (write site read); the upstream scrape mechanics of vsinAutoRefresh were not fully traced this session — UNKNOWN detail for the odds-ingestion section.

### Precision-signal tables (batched per slate)

| Signal | Source | Fallback | Evidence |
|---|---|---|---|
| Park factor (3-yr) | `mlb_park_factors.parkFactor3yr` per home team | 1.0 neutral; also overrides Python's static `PARK_FACTORS` table when ≠ 1.0 | mlbModelRunner.ts:320-353, MLBAIModel.py:2496-2507 VERIFIED |
| Bullpen | `mlb_bullpen_stats` (ERA/FIP/K9/BB9/HR9/WHIP/K-BB/relieverCount/totalIp) | `DEFAULT_BULLPEN` {era 4.20, fip 4.10, k9 9.0, bb9 3.2, hr9 1.2, whip 1.28, relieverCount 7} | mlbModelRunner.ts:310-406 VERIFIED |
| Umpire | Live HTTP `statsapi.mlb.com/api/v1/schedule?gamePks=...&hydrate=officials` → HP umpire id → `mlb_umpire_modifiers.kModifier/bbModifier` | kMod=1.0 bbMod=1.0 | mlbModelRunner.ts:413-505 VERIFIED |
| Pitchers | `mlb_pitcher_stats` (era,k9,bb9,hr9,whip,ip,GS,xera,fip,xfip,fipMinus,eraMinus,throwsHand,nrfiRate,nrfiStarts) blended 70/30 with `mlb_pitcher_rolling5` (min 3 starts in window) | 5-tier fallback: DB exact → DB name-only → hardcoded `PITCHER_REGISTRY` (frozen 2025 stats, mlbModelRunner.ts:82-207, exact + name-prefix match) → IP-weighted team SP average → league default {era 4.25, k9 8.8, bb9 3.1, whip 1.28} | mlbModelRunner.ts:589-875, blend weights at 696-698 VERIFIED |
| Team batting | `mlb_team_batting_splits` per hand (avg/obp/slg/ops/woba/hr9/bb9/k9 vs L and vs R) + live `rpg`/`ipPerGame` | hardcoded `TEAM_STATS_2025` (frozen 2025 season, mlbModelRunner.ts:41-73) | mlbModelRunner.ts:643-690, 890-918, 1788-1818 VERIFIED |
| Player Statcast | `mlb_players.iso/barrelPct/hardHitPct` for confirmed-lineup mlbamIds | league avgs (barrel 8.3%, ISO .150, hardHit 37.5%) | mlbModelRunner.ts:1645-1685, 1081, 1179-1181 VERIFIED |

Hand-specific batting split selection: away lineup gets its split vs the **home** pitcher's hand, and vice versa (mlbModelRunner.ts:1768-1818). Confirmed lineups produce (a) a PA-weighted Statcast aggregate (positional weights `[0.130, 0.125, 0.122, 0.118, 0.115, 0.110, 0.105, 0.100, 0.075]`, mlbModelRunner.ts:1081) requiring ≥7 lineup slots and ≥5 players with Statcast data (mlbModelRunner.ts:1097-1137), and (b) a per-player 9-slot order array (mlbModelRunner.ts:1173-1234). **VERIFIED**.

Weather parsing: temp parsed from strings with sanity bounds [20,120] else 72.0 (mlbModelRunner.ts:1011-1018); wind parsed to `{speed, dir ∈ out|in|calm|cross|unknown}` (mlbModelRunner.ts:1033-1055); dome ⇒ weather dict = null (mlbModelRunner.ts:1067). **VERIFIED**.

### Python-side feature conversion

- `team_stats_to_batter_features` (MLBAIModel.py:2244-2295): uses hand-split k9/bb9/hr9 per PA (÷38) when present, else derives from avg/obp/slg; HR rate scaled by wOBA/0.3200; hit-type split 63/20/2% of AVG for 1B/2B/3B. **VERIFIED**.
- `pitcher_stats_to_features` (MLBAIModel.py:2298-2397): per-PA rates = x/9 ÷ 38; HR% = 50/50 blend of FIP-inverted HR/9 and ERA-scaled league HR% (MLBAIModel.py:2349-2355); real xFIP clamped [2.0,7.0] else ERA-proxy `3.5+(era-4.153)*0.5`. **VERIFIED**.
- Bullpen features (MLBAIModel.py:2683-2709): `bullpen_xfip` = DB FIP; `fatigue_score` **hardcoded 0.3** and `total_bp_outs_5d` **hardcoded 0** with comment "no rest data yet — neutral" — the fatigue/workload model (MLBAIModel.py:630-637) therefore never activates (fatigue_adj = (0.3-0.3)*0.4 = 0; workload_adj = 0). **VERIFIED** (dead adjustment).

---

## Model mechanics

### Pipeline inside `project_game()` (per game)

1. **Environment** (`get_environment_features`, MLBAIModel.py:2162-2202): park run/HR factors from static 2024 Fangraphs table `PARK_FACTORS` (MLBAIModel.py:225-260, e.g. COL r=115 hr=122; SEA r=96 hr=93), park run factor then overridden by DB 3-yr value if ≠1.0 (MLBAIModel.py:2496-2503). Weather: `weather_run = 1 + (temp_f − 72)·0.001`; `weather_hr = 1 + wind·0.006` (out) or `1 − wind·0.004` (in) (MLBAIModel.py:2176-2180). **`weather_hr_adj` is computed but consumed nowhere** — grep shows it only at definition (MLBAIModel.py:2198); wind therefore has zero effect on any published number. **VERIFIED**. HFA weight: `clip(0.35 · (0.80·monthFactor + 0.20) · (1 + 2.5·teamDelta), −0.60, 0.80)` with monthly factors (Mar 1.1888 … Jul 0.9552 … Oct 1.0608, MLBAIModel.py:145-154) and per-team deltas (COL −0.193 … HOU/CHC +0.095, MLBAIModel.py:155-186). **VERIFIED**.
2. **Umpire** (MLBAIModel.py:2522-2542): both SPs' k_pct ×= umpire kMod (cap 0.50), bb_pct ×= bbMod (cap 0.20). **VERIFIED**.
3. **Statcast injection** (MLBAIModel.py:2544-2634): confirmed-lineup aggregate blended 60% Statcast / 40% team-average into barrel/iso/hard_hit with clamps ([0.04,0.16], [0.05,0.28], [0.25,0.55]). **VERIFIED**.
4. **Per-player lineup** (MLBAIModel.py:2642-2680): 9-slot array; each slot = team-average K/BB/HR/hit rates + that player's barrel/iso/hard_hit/bats. Requires ≥7 slots else 9× team-average. Note: per-slot data only affects the **VarianceModel** (barrel/iso/hard_hit weighted averages, MLBAIModel.py:674-698); per-PA outcome rates remain team-level for every slot, so "platoon/lineup adjustment" at the PA level is the team hand-split, not player-level. **VERIFIED** (per-player `bats` is carried but no per-batter platoon logic exists in `PAOutcomeModel`; comment "for platoon splits in P4-B" at MLBAIModel.py:2668 marks it unimplemented). **INFERRED**: P4-B (batter-vs-pitcher-hand per-slot splits) was planned but not built.
5. **Game state μ/σ²** (`GameStateBuilder.build`, MLBAIModel.py:711-741): for innings 1-9, TTO index = (inning−1)//3; lineup-weighted Log5 PA probabilities (`PAOutcomeModel.get_pa_probs`, MLBAIModel.py:589-605, TTO penalties [0, 0.025, 0.055] applied as K −pen·0.5, BB +pen·0.3, HR +pen·0.2); expected runs/inning = `(RE24(0,0)=0.461 + Σ p·runValue) · run_factor` (`RunConversionModel`, MLBAIModel.py:611-617, 2024 linear weights at 433-442); scaled by bullpen quality per inning (starter innings 1.0; pen `1+(xfip−4)·0.05`, late `×(1+fatigue·0.15)`, MLBAIModel.py:653-668); run_factor = park_run × weather_run (MLBAIModel.py:722); total × `LEAGUE_CALIBRATION_MULT = 0.9762` (MLBAIModel.py:134, applied at 2770/2777). Starter IP projection: `clip(0.5·5.2 + 0.5·ip_per_game + (4.0−xfip)·0.3 + fatigue_adj + workload_adj, 1.0, 9.0)` (MLBAIModel.py:624-644). Variance: `clip(2.9² · powerAdj · kAdj · parkHrAdj, 3.0, 20.0)` (MLBAIModel.py:685-689). **VERIFIED**.
6. **Monte Carlo** (`MonteCarloEngine.simulate`, MLBAIModel.py:887-1557):
   - HFA applied to μ: `home_mu = μ_home·(1 + hfa·0.15)`, `away_mu = μ_away·(1 − hfa·0.08)` (MLBAIModel.py:909-911). With typical hfa≈0.35 that is ≈ +5.3% home / −2.8% away. **VERIFIED**.
   - 9-inning runs sampled per team from **NB-Gamma mixture**: rate multiplier ~ Gamma(shape=4.0, scale=0.25), clipped [0.3, 3.0]; per-sample NB fitted to adjusted μ with variance `max(1.5μ, μ+0.5)` (MLBAIModel.py:781-812). Note the *state* variance from VarianceModel is used only in the initial (discarded) `fit_nb` call — the per-sample NB always uses `1.5·adj_mu` overdispersion (MLBAIModel.py:798-810). **VERIFIED** (state variance effectively unused in FG sampling; it *is* used in extra-innings and F5/I1 sampling scale-downs).
   - Ties after 9 → extra innings, ghost-runner bonus +0.50 runs/inning on per-inning μ (=μ/9), variance ×0.7, max 6 extra innings then coin flip (MLBAIModel.py:819-873, 941-955). **VERIFIED**.
   - Win/margin/total arrays: `home_win = home_runs > away_runs` (no ties possible), `margins`, `totals` (MLBAIModel.py:1413-1419).
   - RL cover: if `rl_spread < 0` (home −1.5): `p_home_rl = P(margin > 1.5)`; else (home +1.5): `p_home_rl = P(margin ≥ −1.5)`; `p_away_cover = 1 − p_home_rl` (MLBAIModel.py:1421-1425, 1486-1487). **VERIFIED**.
   - Distribution QA: percentiles, per-key-number over/push mass for KEY_TOTAL_NUMBERS 6.5…12.0 (MLBAIModel.py:81-94, 1436-1442), tail-stability ≥ 0.0005, bucket sparsity check (≥500 samples/bucket over totals 4-20) (MLBAIModel.py:1444-1477). Log-only; never blocks. **VERIFIED**.
7. **Market derivation** (`MarketDerivation.derive`, MLBAIModel.py:1563-2029) — see next subsections.
8. **Edge detection + validation** (MLBAIModel.py:2035-2156): Python `EdgeDetector` computes Option-B edges vs book lines with edge window [0.005, 0.20]; CONFIDENCE_THRESHOLD 0.65 gates only the per-edge `confidence_ok`/`play` flags, not edge emission (MLBAIModel.py:2076-2091) — but its output (`r.edges`) is **never consumed by the runner** (grep of mlbModelRunner.ts finds no `edges` reference); TS re-implements edge detection independently (below). **VERIFIED** (dead output). `ValidationLayer` warnings (ML/runs consistency, RL consistency, total-key mismatch >2.5, no-arb, tail) are returned in `warnings` and logged; they do not block the DB write. **VERIFIED**.

### Totals origination (Step 4)

- Line: `total_key = ou_line or optimal_line` (MLBAIModel.py:1583) — runner always supplies `ou_line` = bookTotal, so **total_key = book line at run start**. **VERIFIED/INFERRED** (gate guarantees bookTotal present).
- `p_over = P(totals > line) + ½·P(totals = line)`, `p_under` symmetric (push mass split), then `remove_vig` normalization and `prob_to_ml` conversion (MLBAIModel.py:1586-1595). **VERIFIED**.
- `_select_optimal_total` (fallback only): picks the KEY_TOTAL_NUMBER minimizing |p_over_adj − 0.5| (MLBAIModel.py:526-558).

### Moneyline origination (Step 5)

- Start from simulated `p_home_win`.
- **`FG_ML_HOME_EDGE = +0.03`**: unconditional +3 percentage points added to home win probability before pricing, `p_away = 1 − p_home` (MLBAIModel.py:1609-1627). Justification comment: live-2026 n=554 backtest found away over-valuation. **VERIFIED**.
- Total-environment adjustment: if total_key ≥ 9.0, dog gets `+(total_key − 9)·0.005`; if ≤ 7.0, favorite gets `+(7 − total_key)·0.005` (MLBAIModel.py:1629-1651). **VERIFIED**.
- Re-normalize via `remove_vig` (p/(p+q)), then American odds: `prob_to_ml(p) = −100p/(1−p)` if p ≥ 0.5 else `+100(1−p)/p`, p clipped [0.001, 0.999] (MLBAIModel.py:561-567, 1653-1656). **VERIFIED**.
- Published `modelAwayWinPct/modelHomeWinPct` = these adjusted, vig-free percentages ×100 (MLBAIModel.py:2906-2907; mlbModelRunner.ts:2473-2474). So the stored win pcts **include** the +3pp home shift and variance boosts — they are not raw simulation frequencies. **VERIFIED**.

### Run line origination (Steps 6-7 + final clamp)

- `remove_vig(p_home_cover, p_away_cover)` — a no-op in practice since the two already sum to 1 (MLBAIModel.py:1666-1672; sum-to-1 by construction at 1487). **VERIFIED/INFERRED**.
- **Step 6 clamp**: favorite's P(cover −1.5) capped at `0.98 × P(win)` if it exceeds P(win) (MLBAIModel.py:1678-1696).
- **Step 7 conditional structure**: `p_home_win_by2 = P(margin > 1.5)`; if it exceeds p_home it is rescaled to equal p_home and **overwrites p_hrl** (MLBAIModel.py:1712-1727).
- **Final RL invariant gate** (added after Step 7 could undo Step 6): if fav cover ≥ fav win, clamp to `0.97 × P(win)` and reprice both sides (MLBAIModel.py:1748-1799). Note the invariant is checked against the **home-edge-adjusted** p_home/p_away, not the raw simulation win rate. **VERIFIED**.
- Cross-market flags (Step 8, log-only): total ≥ 10 & ML gap > 0.42; total ≤ 6.5 & gap < 0.03; total ≥ 9 & blowout P(|margin|>4) < 0.15; win_by2/win ratio outside [0.35, 0.80] (MLBAIModel.py:1801-1839). **VERIFIED**.
- Inverse symmetry / no-arb checks (Steps 9-10): probabilistic sums within 1e-6/1e-4, monotonic key-number ladder; log-only (MLBAIModel.py:1841-1890). **VERIFIED**.
- Model spread (display only): `model_spread = −Φ⁻¹(p_home) · sqrt(home_std² + away_std²)` rounded 2dp (MLBAIModel.py:1892-1894) — returned as `model_spread`, logged by the runner but **not written to DB** (`awayModelSpread`/`homeModelSpread` hold the book ±1.5 labels instead, mlbModelRunner.ts:2424-2425). **VERIFIED**.

### Parameters table (full game)

| Parameter | Value | Location (VERIFIED) |
|---|---|---|
| SIMULATIONS | 400,000 | MLBAIModel.py:68 |
| MIN_SIMULATIONS / SIM_MAX | 250,000 / 500,000 (engine clips) | MLBAIModel.py:69-70, 880-883 |
| RNG seed | fixed 42 (runner never passes seed → deterministic given identical inputs) | MLBAIModel.py:2423; mlbModelRunner.ts:1248-1283 (no seed arg) |
| Run distribution | NB-Gamma mixture, gamma_shape=4.0, rate-multiplier clip [0.3, 3.0], per-sample var = max(1.5μ, μ+0.5) | MLBAIModel.py:787-811 |
| Extra innings | ghost-runner +0.50 μ/inning, var ×0.7, MAX_EXTRA=6, coin flip after | MLBAIModel.py:833-871 |
| LEAGUE_CALIBRATION_MULT | 0.9762 (targets 2025 RPG 8.895) | MLBAIModel.py:134, applied 2770/2777 |
| League PA rates (2025) | K .2222, BB .0841, HR .0309, 1B .1428, 2B .0423, 3B .0034; wOBA .3200; ERA 4.153; RPG 8.895 | MLBAIModel.py:114-129 |
| TTO_PENALTY | [0.0, 0.025, 0.055]; K −0.5·pen, BB +0.3·pen, HR +0.2·pen | MLBAIModel.py:140, 591-600 |
| Lineup weights | top-5 weight clip(0.65 + (K%−.2222)·1.5, 0.50, 0.80), bottom = remainder | MLBAIModel.py:77-78, 506-518 |
| RE24 base (0 out, empty) | 0.461 (2024 Fangraphs matrix) | MLBAIModel.py:406-431, 616 |
| Run values | K/OUT −0.261, BB .301, 1B .456, 2B .753, 3B 1.031, HR 1.353 | MLBAIModel.py:433-442 |
| Starter IP | mean 5.2, min 1.0, max 9.0; xfip_adj (4.0−xfip)·0.3; fatigue/workload adjusters dead (inputs hardcoded 0.3/0) | MLBAIModel.py:136-138, 624-644; 2698-2702 |
| Bullpen quality | 1+(xfip−4)·0.05; late innings ×(1+fatigue·0.15) | MLBAIModel.py:653-668 |
| Variance model | base 2.9²; power 1+(barrel−.08)·3+(iso−.15)·2; K adj 1−(K%−.2222)·2; park 1+(hrF−1)·0.5; clip [3, 20] | MLBAIModel.py:685-689 |
| HFA | base 0.35, month scale 0.80, team scale 2.5, clip [−0.60, 0.80]; μ effect: home +hfa·0.15, away −hfa·0.08 | MLBAIModel.py:142-186, 2184-2192, 909-911 |
| Park factors (static fallback) | PARK_FACTORS 2024 Fangraphs (COL 115/122 … OAK 94/91) | MLBAIModel.py:225-260 |
| Weather run adj | 1 + (temp−72)·0.001 (temp only; wind computed but unused) | MLBAIModel.py:2176-2180; 2198 unused |
| Umpire caps | k_pct ≤ 0.50, bb_pct ≤ 0.20 after modifier | MLBAIModel.py:2528-2531 |
| Statcast blend | 60% confirmed lineup / 40% team avg | MLBAIModel.py:2560, 2600 |
| FG_ML_HOME_EDGE | +0.03 to p_home before pricing | MLBAIModel.py:1617-1621 |
| Total-environment ML adj | ±0.005 per run beyond 9.0 (dog) / below 7.0 (fav) | MLBAIModel.py:1630-1651 |
| RL clamps | Step 6: 0.98×P(win); Final: 0.97×P(win); Step 7 equality rescale | MLBAIModel.py:1685-1687, 1765, 1780, 1722-1724 |
| Key totals ladder | 6.5–12.0 in 0.5 steps | MLBAIModel.py:81-94 |
| Push handling (total) | half of push mass to each side | MLBAIModel.py:1589-1590 |
| prob↔ML conversion | prob_to_ml / ml_to_prob / remove_vig | MLBAIModel.py:561-578 |
| TS edge rule (Option B) | edge = modelImplied(no-vig) − bookImplied(raw, vig-incl.); write only if > 0 (RL) / one-sided > 0 (total) | mlbModelRunner.ts:2162-2261 (RL), 2263-2351 (total) |
| Pitcher blend | 70% season / 30% rolling-5 (≥3 starts) | mlbModelRunner.ts:696-698 |
| Scheduler cadence | 5-min interval, 15-min watchdog, 2-min watchdog poll | mlbModelRunner.ts:2673-2674, 2807, 2813-2824 |

---

## Projection → DB write path

Single `db.update(games).set({...}).where(eq(games.id, r.db_id))` per game (mlbModelRunner.ts:2413-2560). Full-game column map:

| games column | Value written | Evidence |
|---|---|---|
| `awayModelSpread` / `homeModelSpread` | book RL labels (e.g. `+1.5`/`-1.5`), sign-enforced to match book (`safeAwayRunLine`) — **not** the Python model_spread | mlbModelRunner.ts:2424-2425, 2094-2121 |
| `modelAwaySpreadOdds` / `modelHomeSpreadOdds` | model fair RL odds `fmtMl(r.away_rl_odds / r.home_rl_odds)` | mlbModelRunner.ts:2428-2429 |
| `modelAwayPLCoverPct` / `modelHomePLCoverPct` | RL cover % (0-100, no-vig, post-clamp) — added 2026-06-07; previously never written | mlbModelRunner.ts:2475-2481 |
| `spreadDiff` / `spreadEdge` | Option-B RL probability edge (pp, 1 decimal) / `"ABBR ±1.5 [EDGE]"` label; `spreadEdge` null when no edge | mlbModelRunner.ts:2213-2253, 2436-2437 |
| `modelTotal` | **live re-read** `games.bookTotal` (priority: live → snapshot → engine ou_line → Python total_line last resort) | mlbModelRunner.ts:2453-2462 |
| `modelOverOdds` / `modelUnderOdds` | no-vig model odds at run-start book line | mlbModelRunner.ts:2463-2464 |
| `modelOverRate` / `modelUnderRate` | no-vig model P(over)/P(under) ×100 at run-start book line | mlbModelRunner.ts:2465-2466 |
| `totalDiff` / `totalEdge` | Option-B one-sided total edge (pp) / `"OVER|UNDER {bookTotal} [EDGE]"` | mlbModelRunner.ts:2291-2345, 2441-2442 |
| `modelAwayML` / `modelHomeML` | `fmtMl(r.away_ml / r.home_ml)` (no-vig, home-edge-adjusted) | mlbModelRunner.ts:2468-2469 |
| `modelAwayScore` / `modelHomeScore` | expected runs (2dp) from simulation means | mlbModelRunner.ts:2471-2472 |
| `modelAwayWinPct` / `modelHomeWinPct` | adjusted win % (2dp) | mlbModelRunner.ts:2473-2474 |
| `modelProjTotal` | Python `proj_total` (raw expected total, pre-book-anchor) | mlbModelRunner.ts:2553 |
| `modelWeatherAdj` | `weather_run_adj` (4dp) | mlbModelRunner.ts:2551 |
| `modelSpreadClamped` / `modelTotalClamped` | **always `false`** — Python clamp events (`_rl_final_clamped`, engine_flags) are not propagated | mlbModelRunner.ts:2541-2542 |
| `modelRunAt` | `BigInt(Date.now())` (ms epoch) | mlbModelRunner.ts:2543 |
| `awayStartingPitcher`/`homeStartingPitcher` + `awayPitcherConfirmed`/`homePitcherConfirmed` | pitcher names used; confirmed flags set `true` unconditionally (even Rotowire-projected starters) | mlbModelRunner.ts:2544-2547 |
| `publishedToFeed` / `publishedModel` | `true` / `true` unconditionally | mlbModelRunner.ts:2548-2549 |
| `modelCoverDirection` | **never written by this pipeline** (schema drizzle/schema.ts:291; only referenced in NCAAM null-out lists db.ts:450,491) | VERIFIED absence |

Also written on the same statement: F5 (`modelF5*`), NRFI (`modelPNrfi`, `modelNrfiOdds`, `modelYrfiOdds`, `nrfiCombinedSignal`, `nrfiFilterPass`), HR props (`modelAwayHrPct` etc.), inning JSON arrays (`modelInning*`) — other sections (mlbModelRunner.ts:2482-2558).

**Guard rails before the write** (all VERIFIED):
- Live re-reads of `bookTotal` and RL direction/odds right before writing (mlbModelRunner.ts:1961-2063) — RL direction ground truth is `awayRunLine` (FIX 2, 2016-2044).
- **RL sign guard**: if Python's away_run_line sign ≠ book sign, or the cover-vs-win invariant is violated by >2pp on the book favorite, the game is **invalidated**: all ~25 model columns nulled atomically, `modelRunAt=null` (mlbModelRunner.ts:2104-2160, 2360-2411), then an immediate targeted re-run with `forceRerun` fires via `setImmediate` (mlbModelRunner.ts:2599-2623).
- **Post-write validation gate** `validateMlbModelResults` (mlbModelRunner.ts:1362-1517): modelTotal==bookTotal (±0.01), RL exactly ±1.5, sign alignment, odds/flags populated, F5 push range/shrinkage-direction checks. Report-only — failures are logged/returned, nothing is rolled back. **VERIFIED**.

---

## Exposure (API + UI)

- **Public feed**: tRPC `games.list` (publicProcedure) → `listGames` in server/db.ts does `select()` (all columns) from `games`; the `publishedModel` gate nulls model fields **only for NCAAM** — MLB model columns are always exposed as-is (db.ts:437-462; routers.ts:306-357, which strips null fields and sets 30s cache/ETag). **VERIFIED**.
- **Owner/admin**: `mlbModel.forceRerun` (owner mutation → `runMlbModelForDate(forceRerun:true)`, routers.ts:995-1008), `mlbModel.getStatus`, `mlbModel.audit` (runs `validateMlbModelResults` on demand, routers.ts:1013-1076), `adminModelStatus.mlb` (routers.ts:1262-1338), manual override mutation `games.updateProjections` (owner can hand-write `modelAwayML`, `modelTotal`, `spreadEdge` etc., routers.ts:447-471) and `bulkApproveModels`/`setModelPublished` (routers.ts:488-507). **VERIFIED** — the owner override path is a second writer of the same columns.
- **Frontend**: desktop `client/src/components/GameCard.tsx` gates all model cells on `hasModelData = modelRunAt != null && …` (GameCard.tsx:777-779) and renders modelAwayML/modelHomeML, model spread odds, model total + over/under rates, ML edge highlighting with its own `EDGE_THRESHOLD_ML` (GameCard.tsx:870-987). Mobile `MobileGameCard.tsx` mirrors the gate (`hasModelData = game.modelRunAt != null`, MobileGameCard.tsx:314). Dime shell feed `client/src/pages/DimeModelFeed.tsx` (`hasModel = g.modelRunAt != null`, DimeModelFeed.tsx:639-640, model ML at 680). Additional consumers: `MlbCheatSheetCard.tsx`, `ModelResults.tsx`, `TheModelResults.tsx`, `AdminModelStatus.tsx`, `PublishProjections.tsx` (grep VERIFIED file list; internals not read — UNKNOWN detail). |

---

## Scheduling & triggers

| Trigger | Cadence / condition | Evidence |
|---|---|---|
| `startMlbModelSyncScheduler()` | Registered at server boot in `server/_core/index.ts:877`, **inside the `isBackgroundJobsDisabled()` guard** (`DISABLE_BACKGROUND_JOBS=1\|true` skips ALL in-process schedulers, _core/index.ts:132-135, 840-926). When the guard passes: runs `runMlbModelSyncCycle()` immediately, then every **5 min** (`MLB_MODEL_SYNC_INTERVAL_MS = 300 000`), 24/7. Each cycle runs `runMlbModelForDate(todayET)` then `(tomorrowET)` with 3-attempt exponential-backoff DB retry. Watchdog every 2 min; if no completed cycle in 15 min and not running, self-heals by starting a new cycle. **CAVEAT (material)**: `server/cron/cronRoutes.ts:5-8` states the in-process schedulers are "gated off on Railway via DISABLE_BACKGROUND_JOBS to cut credit burn", and MLB model sync is deliberately NOT wired to HTTP cron (see Cron routes row) — so whether this scheduler (or any in-process trigger) actually fires in the production Railway deployment depends on an env var not observable from code. **UNKNOWN** → census question 10. | mlbModelRunner.ts:2673-2824; _core/index.ts:132-135, 840-926, 877 VERIFIED (registration + guard); production env value UNKNOWN |
| Lineup watcher | `server/mlbLineupsWatcher.ts` — on lineup/pitcher change, writes pitchers to `games` then calls `runMlbModelForDate(dateStr)` | mlbLineupsWatcher.ts:546-601 VERIFIED |
| MLBCycle fallback | `server/vsinAutoRefresh.ts` `runMlbCycleOnce()` Step 6: `runMlbModelForDate(today)` + `(tomorrow)` after odds scrape/lineup watcher. Cadence now traced: fires at startup + every **5 min** (`MLB_INTERVAL_MS = 5*60*1000`, vsinAutoRefresh.ts:1361; scheduled at 2095-2101 inside `startVsinAutoRefresh()`, registered at _core/index.ts:846 behind the same background-jobs guard). Also drivable one-shot via `POST /api/cron/mlb-cycle` → `runMlbCycleOnce` (cronRoutes.ts:20, 34) | vsinAutoRefresh.ts:1859-1884, 1361, 2095-2101 VERIFIED |
| Line-move re-run | vsinAutoRefresh.ts:1122-1147 — when `_anOddsResult.layer3Fired` (LAYER3 ML-direction-flip guard fired during odds ingest), fire-and-forget `runMlbModelForDate(gameDate, { targetGameIds: [id], forceRerun: true })` to collapse the stale-RL window to ~15-30s | vsinAutoRefresh.ts:1122-1147 VERIFIED |
| Owner manual | tRPC `mlbModel.forceRerun` | routers.ts:995-1008 VERIFIED |
| Cron routes | **Deliberately NOT wired**: `server/cron/cronRoutes.ts:23` comments that MLB model sync is excluded from HTTP cron because it spawns Python | VERIFIED |
| Idempotency | `modelRunAt` set-on-write + same-calendar-date skip check makes all triggers safe to overlap; `_cycleRunning` flag prevents overlapping 5-min cycles | mlbModelRunner.ts:1594-1601, 2732-2736 VERIFIED |

Deploy context: Railway runs the Express server; the Python engine runs in-process-spawned `/usr/bin/python3` (Debian bookworm apt python3.11) with cleaned env (mlbModelRunner.ts:37, 1298-1321). **VERIFIED** (comments; actual Railway runtime not observable from code — the "python3.11" claim is INFERRED from comments).

---

## Patch history relevant to this market

One-off scripts in `server/` (all read this session where cited):

- **`server/auditFgRlHomeSigmoid.mjs`** (audit, read-only vs code): diagnosed FG RL Home grading at 26.7% accuracy; root-caused a sigmoid `pHomeRl = σ(0.8·(modelMargin−1.5))` used by the **backtest grader** as systematically biased, and — critically — states the bias root cause as *"The +0.03 fg_ml_home_edge correction in MLBAIModel.py inflates modelHomeScore, which increases modelMargin"* (auditFgRlHomeSigmoid.mjs:227-231). Grid-searched k ∈ {0.3…2.0}; optimal k=0.4 (Brier 0.2366 vs 0.2475 at k=0.8, per patch header). **VERIFIED**. (Nuance: modelHomeScore is a raw simulation mean and is *not* directly inflated by FG_ML_HOME_EDGE, which applies only to probabilities — the audit script's root-cause claim is itself questionable. INFERRED from MLBAIModel.py:1609-1656 vs 2900-2901.)
- **`server/patchRlSigmoid.py`**: a string-replacement script that edited **`server/mlbMultiMarketBacktest.ts`** (not the live model) to add the k=0.4 sigmoid *fallback* for RL cover probability when `modelHomePLCoverPct` is NULL. **Its change IS in the live backtest file today**: `RL_SIGMOID_K = 0.4` and the stored-vs-sigmoid-fallback logic exist at mlbMultiMarketBacktest.ts:306-325, with `FG_RL_AWAY_EDGE_THRESHOLD = 0.18` (raised from 0.05; rationale comment at 61-67, and the phrase "systematic home-edge correction bias" verbatim at 357) at mlbMultiMarketBacktest.ts:68. **VERIFIED**. Neither script ever modified MLBAIModel.py or mlbModelRunner.ts.
- The NULL-cover-pct condition the patch worked around was itself fixed on 2026-06-07 when the runner began writing `modelAwayPLCoverPct/modelHomePLCoverPct` (comment "[FIX] Added 2026-06-07", mlbModelRunner.ts:2478-2481). So for post-2026-06-07 games the grader uses stored cover pcts; the sigmoid remains as fallback for older rows. **VERIFIED/INFERRED**.
- **RL inversion incident trail** (shapes today's guards): TB@TOR 2026-05-11 sign inversion (comment at mlbModelRunner.ts:2016-2020; scripts `auditTbTorRL.mjs`, `forceRerunMay11.mjs`, `checkMay11Games.mjs` exist — not read, UNKNOWN contents); LAYER 1 ML-direction override removed 2026-05-30 after PHI@LAD false flip (mlbModelRunner.ts:1702-1709); atomic null-all-fields invalidation added 2026-06-10 after mobile rendered stale inverted odds (mlbModelRunner.ts:2353-2359); ML-edge stale-render fix 2026-06-24 in GameCard (GameCard.tsx:982-985). **VERIFIED** (comments).
- Other one-off rerun scripts touching this market's rows: `forceRerunJune17/18/19.ts`, `runJune13Mlb.ts`, `rerunSFATLG2*.ts`, `june14_*` audits (existence VERIFIED via directory listing; contents not read — UNKNOWN; they call `runMlbModelForDate` per grep).
- **`server/mlbPublicationGate.ts`** (422 lines, fully read): backtest publication scoring — thresholds MIN_SAMPLE 30, accuracy floor 0.70 (target 0.85), ROI > 0, ECE < 0.05, leakage = 0, quarantine < 5% (mlbPublicationGate.ts:108-116). Imported **only** by `mlbBacktestAudit.test.ts` (grep VERIFIED). It does **not** gate the live `publishedModel` flag, which is set unconditionally true (mlbModelRunner.ts:2549).

---

## Open questions (UNKNOWN)

1. ~~**Who calls `runMlbCycle` in vsinAutoRefresh.ts and on what cadence?**~~ **RESOLVED by verifier**: `runMlbCycleOnce()` fires at startup + every 5 min inside `startVsinAutoRefresh()` (vsinAutoRefresh.ts:1361, 2095-2101; registered _core/index.ts:846 behind the background-jobs guard), plus one-shot via `POST /api/cron/mlb-cycle` (cronRoutes.ts). So when background jobs are enabled, the model has TWO independent 5-min triggers (model-sync scheduler + MLBCycle Step 6) plus the lineup watcher and L3 rerun.
2. **Does the multi-market backtest run on a schedule?** **PARTIALLY RESOLVED by verifier**: `runMultiMarketBacktest(gameId)` runs automatically inside the MLB cycle for each game that transitions to FINAL that cycle (vsinAutoRefresh.ts:1950-1970). Still open: does anything automated ever consume `mlbPublicationGate` output outside tests? Current evidence says no consumer besides `mlbBacktestAudit.test.ts`.
3. **DB ground truth for always-false `modelSpreadClamped`/`modelTotalClamped` and always-null `modelCoverDirection`** — schema-columns.tsv confirms the columns exist (rows 46-48: tinyint default 0, varchar(8)); a data census should confirm no row ever has clamped=1 or a cover direction for MLB.
4. **Are `mlb_park_factors.parkFactor3yr`, `mlb_bullpen_stats`, `mlb_umpire_modifiers`, `mlb_team_batting_splits` populated and fresh?** Every one has a silent neutral fallback; the model runs identically (and logs only) when they're empty. Ingestion jobs for these tables were not traced this session.
5. **`PITCHER_REGISTRY`/`TEAM_STATS_2025` staleness in practice**: how often does the live path fall through to the frozen 2025 hardcoded stats (fallback tiers 3-5)? Needs log/data census.
6. **Owner manual override usage**: has `games.updateProjections` ever been used on MLB rows (it writes the same modelAwayML/modelTotal columns with no modelRunAt update)? Data census question.
7. **Effect of the fixed seed (42)**: every game on every date uses the same RNG seed; with 400k sims the Monte Carlo error is small, but confirm no downstream process assumes run-to-run variation.
8. ~~**vsinAutoRefresh L3 single-game rerun — trigger condition unread.**~~ **RESOLVED by verifier**: trigger is `_anOddsResult.layer3Fired` — the LAYER3 ML-direction-flip guard during Action Network odds ingest (vsinAutoRefresh.ts:1122-1147).
9. ~~**`server/dime` / DimeModelFeed backend route**~~ **RESOLVED by verifier**: `DimeModelFeed.tsx` reads the same public `trpc.games.list` procedure (DimeModelFeed.tsx:912) — no separate Dime endpoint for the feed.
10. **Is `DISABLE_BACKGROUND_JOBS` set in the production Railway environment?** (Added by verifier.) cronRoutes.ts:5-8 says in-process schedulers are "gated off on Railway" via this flag "to cut credit burn", yet MLB model sync is deliberately NOT wired to HTTP cron (cronRoutes.ts:23-29, citing a historical `spawn /usr/bin/python3 ENOENT` — since fixed by the Dockerfile, which apt-installs python3+numpy/scipy, Dockerfile:4-19). If the flag is set in prod, none of the in-process schedulers fire; the model could then still run via (a) owner `forceRerun`, or (b) the cron-driven `POST /api/cron/mlb-cycle` → `runMlbCycleOnce()`, whose Step 6 calls `runMlbModelForDate` in-process (so the "model sync not wired to cron" comment does not actually prevent cron-driven model runs). Which path actually produces production model runs is the single most important census question for the trigger story.

---

## Finding candidates

| # | Severity | Title | Evidence |
|---|---|---|---|
| 1 | **P1** | `publishedModel=true` written unconditionally; the "publication gate" (70% accuracy/ROI/ECE) is dead code never invoked in the live path | mlbModelRunner.ts:2549 (unconditional); mlbPublicationGate.ts:108-116; grep: only mlbBacktestAudit.test.ts imports it |
| 2 | **P1** | +3pp `FG_ML_HOME_EDGE` is a post-hoc probability shim applied after simulation and before pricing; published win% / ML / RL clamps all inherit it; the repo's own audit blames it for downstream RL-home bias, and the backtest team compensated by raising the away-RL edge threshold to 18% instead of fixing the source | MLBAIModel.py:1609-1627; auditFgRlHomeSigmoid.mjs:227-231; mlbMultiMarketBacktest.ts:68 |
| 3 | **P2** | `modelTotal` can be written from a **live re-read** book total while `modelOverRate/modelOverOdds` were computed at the run-start line — if the book moves mid-run the published probabilities refer to a different line than the one displayed | mlbModelRunner.ts:1756 (snapshot into sim) vs 2453-2462 (live write) and drift warn at 1978-1984 |
| 4 | **P2** | Wind has zero effect on any market: `weather_hr_adj` is computed then never consumed; only temperature (±0.001/°F) reaches run scoring | MLBAIModel.py:2176-2198 (definition), grep shows no consumer |
| 5 | **P2** | Bullpen fatigue/workload model is dead: `fatigue_score` hardcoded 0.3 and `total_bp_outs_5d` hardcoded 0 at feature-build, so `fatigue_adj=0`, `workload_adj=0`, and late-inning quality degradation is constant | MLBAIModel.py:2698-2702 vs 630-637, 658-660 |
| 6 | **P2** | `modelSpreadClamped`/`modelTotalClamped` always written `false` even when Python's RL-FINAL-CLAMP fires; `modelCoverDirection` never written — three schema columns are dead/misleading for MLB | mlbModelRunner.ts:2541-2542; MLBAIModel.py:1760-1790 (`_rl_final_clamped` not exported); modelCoverDirection grep (schema.ts:291, db.ts:450 only) |
| 7 | **P2** | VarianceModel variance is effectively ignored for full-game sampling: `NBGammaMixtureDistribution.sample` discards the fitted (μ,σ²) NB and resamples each draw with fixed 1.5×μ overdispersion, so barrel/ISO/park-driven variance mostly doesn't reach the margin/total distributions | MLBAIModel.py:798-811 (`_r_base,_p_base` unused; `adj_var = max(adj_mu*1.5, adj_mu+0.5)`) |
| 8 | **P2** | Python `EdgeDetector` (confidence 0.65, EV formula) runs every game but its output is never persisted or used — TS re-implements a different edge rule (Option B: no-vig model prob vs vig-inclusive book prob), so two competing edge definitions coexist | MLBAIModel.py:2035-2124, 2861; grep `edges` absent from mlbModelRunner.ts write path; mlbModelRunner.ts:2162-2351 |
| 9 | **P3** | `awayPitcherConfirmed/homePitcherConfirmed` set `true` on every model write even when the starter came from the Rotowire *projected* lineup COALESCE | mlbModelRunner.ts:1561-1562, 2546-2547 |
| 10 | **P3** | Home advantage triple-stacks: HFA μ-boost (+~5.3% home runs / −2.8% away), then +3pp FG_ML_HOME_EDGE, then favorite/dog total-variance boost — no single documented net home effect; empirical prior `fg_home_win_rate=0.5525` is stored but never used as a check at runtime | MLBAIModel.py:909-911, 1617-1651, 372-375 |
| 11 | **P3** | Owner mutation `games.updateProjections` writes the same model columns with no audit trail or modelRunAt bump, silently indistinguishable from engine output | routers.ts:447-471 |
| 12 | **P3** | Deterministic seed 42 for all games/dates: identical inputs always reproduce identical odds (good for audit, but any per-run Monte-Carlo variance assumption elsewhere is false) | MLBAIModel.py:2423; mlbModelRunner.ts:1248-1283 |
| 13 | **P3** | Two competing NRFI filter implementations live simultaneously: TS computes arithmetic-mean signal at threshold 0.56 and writes it to DB (`nrfiCombinedSignal`), while Python computes geometric-mean at 0.52/0.54 — the DB column holds the deprecated formula (spillover from NRFI section; recorded here because both live on this write path) | mlbModelRunner.ts:1872-1877, 2555-2558; MLBAIModel.py:361-366, 1160-1172 |

---

*End of Full Game dossier.*

---

## Verification

Adversarial verification pass, 2026-07-25, by a second agent. Every load-bearing claim was re-checked against the code this session: both engine files were read end-to-end (`MLBAIModel.py` all 3,019 lines; `mlbModelRunner.ts` all cited regions across lines 1-2825), and every cited line in the supporting files was opened (`vsinAutoRefresh.ts`, `db.ts`, `routers.ts`, `_core/index.ts`, `cronRoutes.ts`, `mlbLineupsWatcher.ts`, `mlbPublicationGate.ts`, `auditFgRlHomeSigmoid.mjs`, `patchRlSigmoid.py`, `mlbMultiMarketBacktest.ts`, `drizzle/schema.ts`, `GameCard.tsx`, `MobileGameCard.tsx`, `DimeModelFeed.tsx`, `Dockerfile`, `census/schema-columns.tsv`). Independent greps re-ran the dossier's negative claims (`weather_hr_adj` single occurrence at MLBAIModel.py:2198; zero occurrences of `edges` anywhere in mlbModelRunner.ts; `modelCoverDirection` only at schema.ts:291 / db.ts:450,491 / drizzle migrations; `mlbPublicationGate` imported only by `mlbBacktestAudit.test.ts`; `fg_home_win_rate` defined at MLBAIModel.py:374 and never read at runtime).

### Tally

- **Claims checked: 74** (every parameter value in the Parameters table, every file:line citation, every column in the write map, every trigger row, every patch-history claim, all 13 finding candidates).
- **Confirmed: 69.** Highlights re-verified at the exact cited locations: SIMULATIONS=400,000 (py:68); seed default 42 (py:2423) with no seed arg in the spawn call (ts:1248-1283); `FG_ML_HOME_EDGE = 0.03` (py:1617-1621); NB-Gamma per-sample `adj_var = max(1.5·μ, μ+0.5)` with the initial `fit_nb` result discarded (py:798-810); ghost-runner +0.50 / var×0.7 / MAX_EXTRA=6 / coin flip (py:833-871); RL clamps 0.98 (py:1685-1687), Step-7 rescale (py:1722-1724), final 0.97 (py:1765, 1780); `LEAGUE_CALIBRATION_MULT = 0.9762` (py:134, applied 2770/2777); bullpen `fatigue_score` hardcoded 0.3 / `total_bp_outs_5d` hardcoded 0 (py:2698, 2702) making the fatigue/workload adjusters provably zero (py:630-637); the full ~65-column write map (ts:2413-2560) including `modelSpreadClamped`/`modelTotalClamped` literal `false` (ts:2541-2542) and unconditional `publishedToFeed`/`publishedModel`/`*PitcherConfirmed` = true (ts:2544-2549); atomic invalidation null-out (ts:2360-2411) + `setImmediate` targeted re-run (ts:2599-2623); Option-B RL edge (ts:2162-2261) and total edge (ts:2263-2351); GameCard/MobileGameCard/DimeModelFeed `modelRunAt` gates (GameCard.tsx:779, MobileGameCard.tsx:314, DimeModelFeed.tsx:640); publication-gate thresholds (mlbPublicationGate.ts:108-116); sigmoid grid k∈{0.3…2.0} (auditFgRlHomeSigmoid.mjs:150) and the root-cause text (auditFgRlHomeSigmoid.mjs:228-230); `patchRlSigmoid.py` FILEPATH = mlbMultiMarketBacktest.ts (patchRlSigmoid.py:11) — it never touched the live model. No fabricated citations, no values copied from comments contradicting code, and no claimed write path that fails to write the claimed column were found.
- **Corrected: 5** (fixed inline above):
  1. **Scheduling caveat (material)** — the dossier asserted the 5-min scheduler runs "24/7" with only a parenthetical guard mention. Corrected: `startMlbModelSyncScheduler()` sits inside the `isBackgroundJobsDisabled()` guard (_core/index.ts:132-135, 840-926), cronRoutes.ts:5-8 states these schedulers are gated OFF on Railway, and MLB model sync is deliberately not wired to HTTP cron — whether any automated trigger fires in production is UNKNOWN from code (new census question 10).
  2. **`FG_RL_AWAY_EDGE_THRESHOLD` citation** — constant is at mlbMultiMarketBacktest.ts:68 (not 67); the quoted phrase "systematic home-edge correction bias" appears verbatim at line 357, not at the constant definition. Fixed in both the patch-history bullet and finding 2.
  3. **P4-B comment line** — the "for platoon splits in P4-B" comment is at MLBAIModel.py:2668 (dossier said 2669, which is the `bats` assignment); also fixed a mojibake ("未implemented" → "unimplemented").
  4. **MLBCycle cadence row** — was UNKNOWN; resolved to startup + every 5 min (`MLB_INTERVAL_MS`, vsinAutoRefresh.ts:1361, 2095-2101) plus cron one-shot. Open question 1 marked resolved.
  5. **L3 line-move rerun row** — was "UNKNOWN detail"; resolved: trigger is `layer3Fired` (ML-direction flip) at vsinAutoRefresh.ts:1122-1147. Open question 8 marked resolved; open questions 2 and 9 also partially/fully resolved (backtest runs per newly-FINAL game at vsinAutoRefresh.ts:1950-1970; DimeModelFeed uses `trpc.games.list` at DimeModelFeed.tsx:912).
- **Unbacked → rewritten as UNKNOWN: 0.** No claim had to be downgraded; the dossier's own VERIFIED/INFERRED/UNKNOWN labeling was honest. Two cosmetic wording fixes were also applied without counting as corrections: "4-tier" → "5-tier" pitcher fallback (the list itself already had 5 tiers), and a clarification that EdgeDetector's CONFIDENCE_THRESHOLD 0.65 gates only the `confidence_ok`/`play` flags, not edge emission (MLBAIModel.py:2076-2091).

### Verifier notes (non-corrections)

- The dossier's skeptical aside on finding 2 is itself correct: `modelHomeScore` is written from `proj_home_runs` = raw simulation mean (py:2900-2901 ← market `exp_home_runs` ← sim, py:1482-1484), which `FG_ML_HOME_EDGE` (probability-space only, py:1620) cannot inflate — the audit script's stated root cause at auditFgRlHomeSigmoid.mjs:228-230 is mechanistically wrong even though its bias measurement may be real.
- Minor citation drifts of ≤2 lines were accepted without correction where the cited range still contains the claim (e.g. `get_pa_probs` body at py:590-605 vs cited 589-605; db.ts gate at 443-461 vs cited 437-462; `setModelPublished`/`bulkApproveModels` at routers.ts:488-509 vs cited 488-507; L3 call at vsinAutoRefresh.ts:1137-1139 vs cited 1136-1138).
- schema-columns.tsv rows 46-48 (file lines) do show `modelSpreadClamped` tinyint(1) default 0, `modelTotalClamped` tinyint(1) default 0, `modelCoverDirection` varchar(8) — consistent with finding 6.
- The Dockerfile (lines 4-19) apt-installs Debian `python3` + numpy/pandas/scipy specifically to fix the historical `spawn /usr/bin/python3 ENOENT` failure referenced in cronRoutes.ts — supporting the dossier's INFERRED "python3.11 on Debian bookworm" deploy claim.
