# Pitcher Strikeout Props (K-Props) — Phase-0 Dossier

> ⚠️ **ERRATUM (2026-08-07) — the 12 `[FIXED in Phase 4]` annotation(s) in this file are superseded.**
> The Phase 4 code fixes were deliberately NOT merged (see `2af950d67`, which resolved the
> #421 conflicts to `main` and recorded why). Every annotation in this dossier was verified
> one at a time against `main`; **none** describes code that is actually on `main`.
> Read [`../PHASE4-ANNOTATION-ERRATA.md`](../PHASE4-ANNOTATION-ERRATA.md) for the per-annotation
> verdicts, the surviving live defects, and the outstanding re-implementation recommendation.

Audit date: 2026-07-25. Evidence classes: **VERIFIED** (code read this session, cited file:line),
**INFERRED** (reasoned from verified facts, reasoning stated), **UNKNOWN** (could not be established
from code — becomes a census question).

---

## Overview

There are **two competing K-props model implementations** in this repo:

1. **LIVE path — TypeScript Poisson model** (`modelKPropsForDate` in
   `server/mlbKPropsModelService.ts`). A closed-form Poisson K-rate model: blended pitcher K/9 ×
   xFIP adjustment × opponent-K-by-hand adjustment × platoon-composition adjustment × expected IP,
   with direction-split empirical calibration factors, evaluated against the Action Network
   consensus no-vig probability. Runs every 5 minutes inside the MLB cycle
   (`server/vsinAutoRefresh.ts:1911-1915`). **VERIFIED**.

2. **LEGACY/MANUAL path — Python "Variant D" simulation model** (`server/StrikeoutModel.py`,
   spawned by `server/strikeoutModelRunner.ts`). A per-batter Log5 + Statcast signal blend feeding
   a **Negative Binomial** distribution (r=22.20) with 100,000 Monte Carlo draws, per-inning TTO
   degradation, and an OLS post-calibration layer. Its **only caller is the owner-only tRPC
   mutation `strikeoutProps.runModel`** (`server/routers.ts:1229-1252`); no scheduler invokes it.
   It requires local Retrosheet plays CSV / Statcast JSON / crosswalk CSV file paths as inputs
   (`server/strikeoutModelRunner.ts:43-45`). **VERIFIED** that no cron/scheduler calls it;
   whether it has ever been run in production is **UNKNOWN**.

Both write the same table, `mlb_strikeout_props`, keyed by unique `(gameId, side)`
(`drizzle/schema.ts:1099-1102`, constraint added in `drizzle/0043_rich_drax.sql:1`). The Python
path is the **only writer** of the rich columns `kLine`, `kPer9`, `kMedian`, `kP5`, `kP95`,
`signalBreakdown`, `matchupRows`, `distribution`, `inningBreakdown`
(`server/strikeoutModelRunner.ts:198-219`); the live TS path writes only
`kProj/pOver/pUnder/modelOverOdds/modelUnderOdds/edgeOver/edgeUnder/verdict/bestEdge/bestSide/bestMlStr/modelRunAt`
(`server/mlbKPropsModelService.ts:515-531`). So on the live path, distribution/percentile columns
stay NULL unless a historical Python run populated them (**INFERRED** from the two write sets).

Book lines come from Action Network's internal markets API (consensus across 12 book IDs), fetched
every cycle and upserted by `upsertKPropsFromAN` (`server/kPropsDbHelpers.ts:107-299`). Backtest
grading (actual Ks from the MLB Stats API box score) runs in the same cycle
(`server/kPropsBacktestService.ts:240-449`).

The **umpire K modifier is NOT used by either K-props model.** `mlb_umpire_modifiers.kModifier` is
consumed only by the game-level model (`server/mlbModelRunner.ts:413-521`, applied at
`mlbModelRunner.ts:1825-1826` into the game feature payload). `grep -i umpire` over
`StrikeoutModel.py` returns nothing (**VERIFIED**), and `mlbKPropsModelService.ts` (read in full)
contains no umpire reference (**VERIFIED**).

---

## Data inputs & ingestion

### 1. Book lines — Action Network consensus (source + timing)

- Endpoint: `GET https://api.actionnetwork.com/web/v2/scoreboard/mlb/markets?bookIds=15,30,1071,1076,1072,1073,1074,1075,1239,1241,1243,2672&customPickTypes=core_bet_type_37_strikeouts&date=YYYYMMDD`
  (`server/anKPropsService.ts:25-27,138`). Book 15 is the AN Consensus aggregator
  (`server/ActionNetworkKPropsAPI.py:7` — dead script, see Patch history). **VERIFIED**.
- Aggregation (`server/anKPropsService.ts:183-266`): alt-market entries skipped (L187);
  **line = modal value** across all books (L231, `modalValue` L111-124); **overOdds/underOdds =
  arithmetic mean** of each side's American odds across books (L232-233, rounded L254-255);
  **`noVigOverPct` = pOver/(pOver+pUnder)** computed from the *averaged* odds (L235-240,
  `americanToProb` L106-109). Only players with `primary_position` SP or P are kept (L223-228).
  `is_live` entries are *included* in the aggregation (only tracked as a flag, L202) — live lines
  can pollute the consensus. **VERIFIED**.
- Upsert (`server/kPropsDbHelpers.ts:107-299`): matches each AN prop to a DB game for `gameDate`
  where `games.sport='MLB'` (L119-126) purely by **team abbreviation** (pitcher's team is away or
  home, L182-193); side derived from that match. Existing `(gameId, side)` row → UPDATE of
  `pitcherName, bookLine, bookOverOdds, bookUnderOdds, anNoVigOverPct, anPlayerId` only, model
  fields preserved (L223-235); else INSERT with model fields NULL (L249-260). **No game-status
  freeze** — unlike `refreshAnApiOdds` which skips live/final games
  (`server/vsinAutoRefresh.ts:1655-1656` comment; skip implemented at `vsinAutoRefresh.ts:910`),
  K-prop book lines keep being overwritten after first
  pitch. **VERIFIED** (still true post-Phase 4 — no status check added to the upsert).
- Timing: every MLB cycle (5 min, see Scheduling). The fetch date is
  `formatANDate(new Date())` (`server/vsinAutoRefresh.ts:1891`), which formats using the **server's
  local timezone** (`server/anKPropsService.ts:306-311`), while the rest of the pipeline keys on
  `datePst()` (America/Los_Angeles, `server/vsinAutoRefresh.ts:132-142`). On a UTC host these
  disagree from 00:00 UTC (≈5pm PT) to PT midnight — see Finding K-1. **INFERRED** (assumes
  container TZ=UTC; TZ env on Railway is UNKNOWN).
- Legacy: `updateKPropsFromAN` (`server/kPropsDbHelpers.ts:309-445`) is update-only,
  name-matched, kept "for backward compatibility" (L13-15) — not called by the live cycle
  (`vsinAutoRefresh.ts:1900` uses `upsertKPropsFromAN`). **VERIFIED** dead on the live path.

### 2. Pitcher season stats — `mlb_pitcher_stats`

- Read by the model: `k9`, `xfip`, `fip`, `throwsHand`, `ipMean3yr`, `ip`, `gamesStarted`
  (`server/mlbKPropsModelService.ts:298-333`), joined to props rows **by normalized full name**
  (`normalizeMlbamName` — lowercase, NFD-strip diacritics, strip Jr/Sr/II/III/IV suffixes, strip
  non-alpha; `server/mlbamIdCache.ts:39-47`). No ID-based join. **VERIFIED**.
- Seeded by `seedPitcherStats` every 24 h (`server/vsinAutoRefresh.ts:2116-2130`); `k9` comes from
  MLB Stats API `strikeoutsPer9Inn` (`server/seedPitcherStats.ts:161`) — true K/9 scale. **VERIFIED**.
- `ipMean3yr` (priority-1 IP source) has **no writer anywhere in the repo** — only the column
  definition (`drizzle/schema.ts:1165`), the migration (`drizzle/0067_violet_human_robot.sql`), the
  model read, and read-only audit scripts (`server/auditJunisVsEovaldi.mjs:22`,
  `server/calibrateJunisGsBlend.mjs:189`). Whether it is populated in prod is **UNKNOWN** (census
  question). **VERIFIED** absence of writer.

### 3. Rolling-5 form — `mlb_pitcher_rolling5`

- Read: `k9_5`, `ip5` (`server/mlbKPropsModelService.ts:336-350`), same name-keyed join.
- Seeded by `seedPitcherRolling5` every 24 h (`server/vsinAutoRefresh.ts:2146-2159`):
  `k9_5 = K5/IP5*9` over the last 5 starts (`server/seedPitcherRolling5.ts:137`); **`ip5` is the
  SUM of IP across the last 5 starts** (`seedPitcherRolling5.ts:111-122`), i.e. ~25-30, not a
  per-start value. See Finding K-3. **VERIFIED**.

### 4. Opponent K rate by handedness — `mlb_team_batting_splits`

- Read: `k9` keyed `teamAbbrev:hand` for hand = pitcher's `throwsHand` (default `'R'` when
  unknown, `server/mlbKPropsModelService.ts:352-373,410,432-434`). **VERIFIED**.
- Seeded by `seedTeamBattingSplits` every 24 h (`server/vsinAutoRefresh.ts:2161-2175`) from MLB
  Stats API team `statSplits` sitCodes `vl`/`vr`; **`k9 = K/AB × 27`**
  (`server/seedTeamBattingSplits.ts:100-102,118`) — a per-27-at-bats rate, *not* per-9-innings.
  See Finding K-2. **VERIFIED**. [FIXED in Phase 4 — the model no longer divides this by the
  true-K/9 constant 8.2; the divisor is now the measured per-hand league mean of the same
  K/AB×27 basis, `getLeagueMeanTeamK9ByHand()` in `kPropsDbHelpers.ts` (M-204). The seeder's
  basis itself is unchanged.]

### 5. Lineups (platoon composition) — `mlb_lineups`

- `awayLineup`/`homeLineup` JSON + confirmation flags left-joined per game
  (`server/mlbKPropsModelService.ts:279-286`). Player `bats` (R/L/S) parsed for the platoon
  adjustment (`mlbKPropsModelService.ts:201-209`). Lineups are scraped from Rotowire each cycle
  (`server/vsinAutoRefresh.ts:1763-1814`; bats captured at
  `server/rotowireLineupScraper.ts:364-371`). Platoon adj only applies when the opposing lineup is
  **confirmed** and has ≥7 players (`mlbKPropsModelService.ts:186-199`). **VERIFIED**.

### 6. Umpires — `mlb_umpire_modifiers` (NOT in the K-props path)

- Seeded weekly by `seedUmpireModifiers` (`server/vsinAutoRefresh.ts:2195-2209`):
  seasons 2024-2026 regular-season finals (`server/seedUmpireModifiers.ts:30`), per-game totals
  from boxscore team pitching stats, games with BF<10 skipped (L155), umpires with <20 HP games
  excluded (L215), `kModifier = umpKRate/leagueKRate` where rates are K/BF (L220-223), sanity
  warn outside [0.70, 1.30] (L226-228). Consumed **only** by the game model
  (`server/mlbModelRunner.ts:413-521`, applied L1825-1826) — never by either K-props model
  (**VERIFIED**, see Overview). The audit scope listed `mlb_umpire_modifiers.kModifier` under
  K-props; that linkage does not exist in code.

### 7. Backtest actuals — MLB Stats API

- `https://statsapi.mlb.com/api/v1/game/{gamePk}/boxscore`; starter = `pitchers[0]` per side
  (`server/kPropsBacktestService.ts:92,109-134`); finality via the schedule endpoint
  (`kPropsBacktestService.ts:142-162`). **VERIFIED**.

---

## Model mechanics

### A. LIVE TypeScript Poisson model (`server/mlbKPropsModelService.ts`)

Pipeline per pitcher-row (all **VERIFIED** at the cited lines):

1. **Skip rules**: no `bookLine` → skip (L387-392); no `anNoVigOverPct` → skip (L395-400).
2. **Pitcher K/9**: `0.70·seasonK9 + 0.30·rolling5K9` when both present; single source if one;
   fallback `LEAGUE_K9 = 8.5` (L413-422).
3. **xFIP adj**: `clamp(4.10 / xfip, 0.70, 1.40)`, 1.0 if xfip missing (L425-428).
4. **Opponent adj**: `clamp(oppK9(vs hand) / 8.2, 0.70, 1.40)`; league default 8.2 when team
   split missing (L431-434). [FIXED in Phase 4 — divisor and missing-split default are now the
   per-hand league mean of `mlb_team_batting_splits.k9` computed once per cycle
   (`getLeagueMeanTeamK9ByHand`, fallback 6.78); `LEAGUE_OPP_K9 = 8.2` was removed (M-204).]
5. **Expected IP** (P2-A 4-tier): `ipMean3yr` → season `ip/gamesStarted` → `rolling5.ip5` →
   5.1; result clamped [3.0, 7.0] (L441-447).
6. **Platoon adj** (P4-B): from confirmed opposing lineup bats composition; switch hitters count
   0.5/0.5 (L201-209); ≥60% same/opposite-hand triggers the boost/penalty (L218-236); clamp
   [0.88, 1.15] (L236).
7. **Lambda**: `lambdaRaw = pitcherK9 · xfipAdj · oppAdj · platoonAdj · ipExpected/9` (L466);
   `lambdaOver = lambdaRaw·0.870`, `lambdaUnder = lambdaRaw·0.810` (L467-468); displayed
   `kProj = lambdaUnder` rounded to 2dp (L470, 512).
8. **Probabilities off the distribution vs the book line**:
   `pOver = clamp(1 − PoissonCDF(floor(bookLine), lambdaOver), 0.03, 0.85)` and
   `pUnder = clamp(1 − [1 − PoissonCDF(floor(bookLine), lambdaUnder)], 0.03, 0.85)` (L473-474;
   `poissonPOver` L140-143 uses `floor(bookLine)` — for a half line 4.5 this is P(X≥5); for an
   **integer** line 6.0 the push outcome X=6 lands inside pUnder — Finding K-6). [FIXED in
   Phase 4 — new `poissonPUnder` computes `CDF(line−1)` on integer lines so the push mass is
   excluded from both sides.]
9. **Model odds**: probability → American (L148-152, 477-478).
10. **Edges**: `edgeOver = pOver − anNoVigOverPct`; `edgeUnder = pUnder − (1 − anNoVigOverPct)`
    (L481-482) — i.e. model prob minus AN consensus no-vig prob, both 4dp.
11. **Verdict rules** (L487-509): `OVER` iff `edgeOver ≥ 0.150` **and** `bookLine ≤ 5.5`;
    else `UNDER` iff `edgeUnder ≥ 0.040`; else `PASS`. An OVER that fails the line gate is logged
    "OVER FILTERED" and falls through to PASS (not to UNDER) even if `edgeUnder` also qualifies
    — L500-503 `else if` chain (edgeOver≥0.15 with high line short-circuits the UNDER branch).
    `bestEdge/bestSide/bestMlStr` set only for non-PASS (L488-508).

**Parameter table (TS live model):**

| Parameter | Value | Location |
|---|---|---|
| `LEAGUE_K9` (fallback pitcher K/9) | 8.5 | mlbKPropsModelService.ts:63 |
| `LEAGUE_XFIP` | 4.10 | :64 |
| `LEAGUE_OPP_K9` (opp baseline) | 8.2 [FIXED in Phase 4 — constant removed; replaced by per-hand DB league mean, same K/AB×27 basis as the splits table] | :65 |
| `EDGE_THRESHOLD` (declared, **unused**) | 0.040 | :66 (no reader — verdict uses :71-72) |
| `EDGE_THRESHOLD_OVER` | 0.150 | :71 |
| `EDGE_THRESHOLD_UNDER` | 0.040 | :72 |
| `MAX_OVER_LINE` (OVER gate) | 5.5 | :73 |
| `MIN_P_OVER` / `MAX_P_OVER` (prob clamps) | 0.03 / 0.85 | :74-75 |
| `MIN/MAX_XFIP_ADJ` | 0.70 / 1.40 | :76-77 |
| `MIN/MAX_OPP_ADJ` | 0.70 / 1.40 | :78-79 |
| `MIN_IP` / `MAX_IP` | 3.0 / 7.0 | :80-81 |
| `K_CALIBRATION_FACTOR_OVER` | 0.870 (was 0.800) [FIXED in Phase 4 — renamed `*_OVER_DEFAULT`, now a fallback; live value read per cycle from `mlb_calibration_constants.k_calibration_factor_over` (M-207)] | :88 |
| `K_CALIBRATION_FACTOR_UNDER` | 0.810 (was 0.739) [FIXED in Phase 4 — renamed `*_UNDER_DEFAULT`, fallback for DB row `k_calibration_factor_under`] | :89 |
| `K_CALIBRATION_FACTOR` (alias, display) | = UNDER = 0.810 [FIXED in Phase 4 — alias removed] | :91 |
| `EMPIRICAL_IP_PER_START` | 5.1 | :92 |
| Season/rolling blend | 0.70 / 0.30 | :415 |
| `PLATOON_LHP_VS_RHH_BOOST` | 1.08 | :97 |
| `PLATOON_LHP_VS_LHH_PENALTY` | 0.94 | :98 |
| `PLATOON_RHP_VS_LHH_BOOST` | 1.05 | :99 |
| `PLATOON_RHP_VS_RHH_PENALTY` | 0.97 | :100 |
| `PLATOON_NEUTRAL_THRESHOLD` | 0.60 | :101 |
| `MIN/MAX_PLATOON_ADJ` | 0.88 / 1.15 | :102-103 |
| Default pitcher hand when unknown | "R" | :410 |
| Lineup minimum for platoon adj | 7 players, confirmed | :186-199 |

Note the header docstring (L22-24, "ip_expected = bookLine / pitcher_k9 * 9") describes the **old
v1 IP formula** and contradicts the implemented P2-A fallback chain — stale documentation
(**VERIFIED** mismatch).

**Calibration provenance (comments at L67-91, VERIFIED as comments; the underlying backtests are
not reproducible from the repo):** 288-game 2026 backtest → OVER win rate 33.3% at lines ≥6.5
(hence 0.150 threshold + 5.5 gate), UNDER 60.7% at all edge buckets ≥0.05; "P5 recalibration"
n=693, bias −0.521 K/start → factors +0.070/+0.071. Separately, the **DB** constants table has
`k_calibration_factor = 0.776` (previous 0.739, source `LIVE_2026_N693_BIAS_CORRECTED`,
2026-05-11 — `docs/audits/mlb-model-audit-2026/census/calibration-constants.tsv`), which **no live
code reads** (only seeded at default 1.0 by `server/mlbDriftDetector.ts:217`; grep found no other
reader/writer). Code (0.870/0.810) and DB (0.776) disagree — Finding K-5. [FIXED in Phase 4
(partial) — `modelKPropsForDate` now reads `k_calibration_factor_over`/`k_calibration_factor_under`
from `mlb_calibration_constants` each cycle via `getKCalibrationFactors`, with 0.870/0.810 as
fallbacks (M-207); the legacy `k_calibration_factor = 0.776` row is a *different* paramName and
remains read by nothing.]

### B. LEGACY Python "Variant D" model (`server/StrikeoutModel.py`)

How the distribution is modeled: **not a per-batter simulation and not inning-by-inning
simulation** — it computes a scalar expected-K from per-batter Log5 rates + Statcast signal
z-scores with a per-inning TTO-degraded accumulation, then fits a **Negative Binomial** around
that mean and Monte-Carlos 100,000 draws for percentiles/probabilities.

1. **Inputs**: Retrosheet plays CSV (per-player split tables built in `_compute_splits`,
   L266-336: pitcher platoon/home-away/by-inning; batter platoon/home-away/by-lineup-spot),
   Statcast season JSON (per-player rate + plate-discipline features, L338-349), RS↔SC ID
   crosswalk (L351-356). If Statcast PA=0, Retrosheet rates are the fallback (L470-504); if both
   empty, league constants.
2. **Per-batter Log5 matchup** (L647-687): pitcher K% vs batter hand and batter K% vs pitcher
   hand, each Bayesian-shrunk toward platoon league rates with PA thresholds; batter rate further
   multiplied by home/away and lineup-spot split ratios, clamped [0.03, 0.65] (L667); Log5
   (L197-202) vs platoon league rate; weighted by empirical lineup-spot PA weights (L599-605).
3. **Signal blend** (L690-774): `base = 0.40·Log5_weighted + 0.60·pitcher_season_K%` (L755-757);
   `combined_k = clip(base + 0.040·(−2.834·whiff_z + 3.342·zone_z + 0.500·arsenal_z), 0.04, 0.60)`
   (L763-774). Whiff signal = 0.70 pitcher + 0.30 lineup z (L703); zone signal =
   0.35 f-strike + 0.35 oz-contact + 0.15 iz-contact + 0.10 lineup-oz + 0.05 lineup-iz (L728-734);
   arsenal = 0.60 velo_z + 0.40 pitch-mix_z (L753).
4. **Expected K, inning-by-inning accumulation** (L782-818): for each full inning,
   `EK += combined_k · TTO_K_MULT[min(2, inning//3)] · 4.05 PA`; partial inning pro-rated
   (L814-818). Per-inning *display* rates additionally scale by the pitcher's inning split
   (clamped [0.90, 1.10], L802) — display only, not in the EK total (L804-809).
5. **Expected IP**: constant. The CLI default `--projected-ip = STARTER_IP_MEAN = 5.2804`
   (L1279), and **`strikeoutModelRunner.ts` never passes `--projected-ip`**
   (args list `strikeoutModelRunner.ts:103-115`) — so on the only wired path every pitcher is
   projected at exactly 5.2804 IP. No pitch-count modeling anywhere. **VERIFIED**.
6. **OLS calibration**: `EK_cal = clip(1.0305·EK + 0.3314, 0.1, 20.0)` (L823).
7. **Distribution**: NegBin with `r = 22.20`, `p = clip(r/(r+EK_cal), 0.01, 0.99)` (L828-829);
   analytic PMF for 0-9 plus 10+ bucket (L831-843); **100,000** `rng.negative_binomial` draws with
   `np.random.default_rng(42)` (L594-595, 846, 1345) → p5/p95/median (L847-849).
8. **Model line & probs**: `k_line = round(EK_cal·2)/2` (nearest 0.5, L852);
   `p_over = mean(samps > k_line)`, `p_under = mean(samps ≤ k_line)` (L853-854); ±0.5 alt lines
   (L857-860). When a market line differing from the model line is supplied, pOver/pUnder are
   recomputed against the raw samples at the market line (L1426-1432).
9. **Edge & verdict (Python vocabulary)**: edges vs the book's **raw implied probability
   (vig included)** `_be(ml)` (L1455-1467) — not no-vig; best side by larger edge; verdict
   `EDGE` if best_edge ≥ 0.03, `FADE` if ≤ −0.03, else `NEUTRAL`; `PASS` when no market
   (L1449-1480). Different vocabulary from the TS model's OVER/UNDER/PASS — Finding K-7.
10. **Lineups**: runner passes none, so the script auto-detects a "lineup" as the 9 most frequent
    batters per team in the plays file (L1310-1328) — not the day's actual lineup. **VERIFIED**.

**Parameter table (Python Variant D):**

| Parameter | Value | Location |
|---|---|---|
| `LEAGUE_K_PCT` | 0.224 | StrikeoutModel.py:71 |
| League whiff / z-swing-miss / oz-swing-miss | 24.5 / 16.5 / 36.0 (%) | :80-82 |
| League f-strike / iz-contact / oz-contact | 61.0 / 83.5 / 63.0 (%) | :83-85 |
| SDs: whiff / f-strike / iz / oz / FF speed | 5.8 / 5.2 / 5.5 / 8.4 / 2.8 | :88-92 |
| Signal weights (Log5/whiff/zone/arsenal) | 0.40 / 0.25 / 0.20 / 0.15 (declared) | :95-98 |
| Actual additive blend weights | −2.834 whiff, +3.342 zone, +0.500 arsenal, ×0.040 | :763-770 |
| `VELO_K_ADJ_PER_MPH` / baseline | 0.0035 / 93.0 mph | :100-101 |
| `PITCH_K_WEIGHTS` fastball/breaking/offspeed | 0.30 / 0.45 / 0.25 | :102 |
| `TTO_K_MULT` | [1.0, 0.891, 0.832] | :103-107 |
| `NEGBIN_R` | 22.20 | :108 |
| `STARTER_IP_MEAN` / `STARTER_IP_STD` | 5.2804 / 1.2431 | :109-110 |
| `PA_PER_INNING` | 4.05 | :111-113 |
| OLS `CAL_ALPHA` / `CAL_BETA` | 1.0305 / 0.3314 | :116-117 |
| `PLATOON_K_RATES` (LL/LR/RL/RR) | 0.240 / 0.226 / 0.218 / 0.225 | :120-125 |
| `LEAGUE_K_BY_INNING` (1-9) | 0.2241 … 0.2210 | :128-138 |
| `K_LINEUP_SPOT_WEIGHTS` (1-9) | 1.0873 … 0.8802 | :141-151 |
| Shrinkage min-PA platoon/HA/inning/lineup | 50 / 30 / 15 / 10 | :154-157 |
| combined_k clip | [0.04, 0.60] | :771-773 |
| batter adj clip | [0.03, 0.65] | :667 |
| inning display scale clip | [0.90, 1.10] | :802 |
| EK clip after OLS | [0.1, 20.0] | :823 |
| MC sims / seed | 100,000 / default_rng(42) | :586, 593-594, 1345 *(cites corrected by verifier: n_sims default at :586, in-method seed at :593-594)* |
| Python verdict thresholds | EDGE ≥ +0.03 / FADE ≤ −0.03 | :1476-1480 |
| Runner timeout / interpreter | 120 s / `python3` | strikeoutModelRunner.ts:30-32 |

Header back-test claims (n=4,750 2025 starts: MAE 1.714, RMSE 2.142, bias 0.000, PropAcc 79.3%)
are comments only (`StrikeoutModel.py:32-37`) — not reproducible from the repo (**UNKNOWN**
provenance).

---

## Projection → DB write path

Table: **`mlb_strikeout_props`** (`drizzle/schema.ts:1021-1102`), unique key
`uq_game_side (gameId, side)` (schema.ts:1101; migration `drizzle/0043_rich_drax.sql:1`). All
numeric projection fields are stored as **varchar** strings (schema.ts:1036-1072). Writers:

| Writer | Columns | Key / trigger |
|---|---|---|
| `upsertKPropsFromAN` (kPropsDbHelpers.ts:223-260) | insert: gameId, side, pitcherName, bookLine, bookOverOdds, bookUnderOdds, anNoVigOverPct, anPlayerId; update: same minus keys | (gameId, side) via team match; every 5-min cycle (vsinAutoRefresh.ts:1899-1904) |
| `modelKPropsForDate` (mlbKPropsModelService.ts:515-531) | kProj, pOver, pUnder, modelOverOdds, modelUnderOdds, edgeOver, edgeUnder, verdict, bestEdge, bestSide, bestMlStr, modelRunAt | `where id` per row; every 5-min cycle, unconditionally re-scores today (vsinAutoRefresh.ts:1908-1915) |
| `resolveKPropsMlbamIdsForDate` (mlbKPropsModelService.ts:567-631) | mlbamId | after each model run (vsinAutoRefresh.ts:1916-1924) |
| `backfillAllKPropsMlbamIds` (mlbKPropsModelService.ts:636-695) | mlbamId | once at server startup (server/_core/index.ts:896-903) and owner tRPC `mlbBacktest.backfillKPropsMlbamIds` (routers.ts:1494-1497) |
| `runKPropsBacktest` (kPropsBacktestService.ts:400-411, 337-343, 373-376) | actualKs, backtestResult (OVER/UNDER/PUSH/NO_LINE/NAME_MATCH_FAILED), modelError (= actualKs − kProj), modelCorrect, backtestRunAt | pending rows for date; every cycle (vsinAutoRefresh.ts:1934). The `runMultiMarketBacktest` K-props delegation (mlbMultiMarketBacktest.ts:1025-1029) is **skipped on the live path** — the FINAL-transition call passes `runKProps=false` (vsinAutoRefresh.ts:1970; param default `true` at mlbMultiMarketBacktest.ts:955-957); it fires only via owner tRPC `runForGame` with `includeKProps:true` (routers.ts:1440-1448, default false) or `runMultiMarketBacktestForDate` (mlbMultiMarketBacktest.ts:1123) |
| `upsertStrikeoutProp` (db.ts:2146-2196, Python path) | ALL model columns incl. kLine/kPer9/kMedian/kP5/kP95/signalBreakdown/matchupRows/distribution/inningBreakdown | `INSERT … ON DUPLICATE KEY UPDATE` on uq_game_side; only via owner tRPC runModel (routers.ts:1229-1252 → strikeoutModelRunner.ts:188-224) |

Backtest semantics (**VERIFIED**): result = actual vs bookLine (kPropsBacktestService.ts:218-225);
model prediction = `kProj ≥ bookLine ? OVER : UNDER` (L227-232) — note this grades the *projection
mean*, not the published verdict/edge logic; `modelCorrect` null on PUSH (L389-394). If the
projected pitcher's name fails matching, a side-indexed starter fallback substitutes the actual
starter (scratched-pitcher handling, L347-379).

---

## Exposure (API + UI)

tRPC (`server/routers.ts:1147-1253`):

- `strikeoutProps.getByGame` / `getByGames` — **public**, raw row passthrough
  (routers.ts:1154-1178 → db.ts:2199-2250).
- `strikeoutProps.getCalibrationMetrics`, `getDailyBacktest`, `getRichDailyBacktest`,
  `getLast7DaysBacktest` — **owner-only** (routers.ts:1184-1224 → kPropsBacktestService.ts).
- `strikeoutProps.runModel` — **owner-only**, spawns StrikeoutModel.py (routers.ts:1229-1252).
- `mlbBacktest.getKPropsReport` — protected (routers.ts:1553-1557 →
  `mlbFullBacktestEngine.getKPropsBacktestReport`, mlbFullBacktestEngine.ts:527+). This report
  counts `backtestResult === "WIN"/"LOSS"` (mlbFullBacktestEngine.ts:585-598), values the K-props
  backtest **never writes** (it writes OVER/UNDER/PUSH; WIN/LOSS is the HR-props vocabulary,
  mlbHrPropsBacktestService.ts:200) → win/loss and edge-tier tallies are structurally zero —
  Finding K-4. **VERIFIED**.

Frontend:

- **`MlbPropsCard.tsx`** renders per-pitcher K proj, book line, over/under probs, edge badge
  (client/src/components/MlbPropsCard.tsx:1-56, 265-445). Its highlight logic requires
  `verdict === "EDGE"` (L284-286) — the Python vocabulary — so the mint "play" highlight never
  fires on live TS-model data (verdict OVER/UNDER/PASS); the bottom `▶ bestSide` badge still
  renders because it only checks `verdict !== "PASS"` (L431). Finding K-7. **VERIFIED**.
- Live routes: `/m/props` mobile owner tab (client/src/features/mobileOwnerTabs/MobileOwnerLayout.tsx:25,
  App.tsx:437-441; query at MobileProps.tsx:344) and `/admin/model-results` (TheModelResults at
  App.tsx:315-320; K backtest queries TheModelResults.tsx:1054-1066); `MlbBacktest.tsx` uses
  getKPropsReport. **VERIFIED**.
- **Dead pages**: `ModelProjections.tsx` (K-props "props" tab, query at :677) and
  `ModelResults.tsx` are imported nowhere (grep over client/src returned no importer; App.tsx
  routes `/projections` → redirect to the Dime feed, App.tsx:244). The canonical authed feed
  `DimeModelFeed.tsx` (routes `/feed/model/...`, App.tsx:276-277) contains **zero** K-props
  references — K-props are currently invisible on the main user feed. **VERIFIED**.

---

## Scheduling & triggers

- **In-process scheduler**: `startVsinAutoRefresh()` is called at server startup unless
  `DISABLE_BACKGROUND_JOBS` is set (server/_core/index.ts:833-846, truthiness parse at :131-134).
  It fires `runMlbCycleOnce()` immediately and then every `MLB_INTERVAL_MS = 5 min`, 24/7, no
  time gate (vsinAutoRefresh.ts:1361, 2096-2101). **VERIFIED**.
- **K-props steps inside each cycle** (vsinAutoRefresh.ts:1885-1934): fetch AN K-props (today
  only) → `upsertKPropsFromAN` (today PT date) → `modelKPropsForDate(today)` unconditionally →
  `resolveKPropsMlbamIdsForDate(today)` → `runKPropsBacktest(today)`. Tomorrow is **not**
  seeded/modeled for K-props (unlike game odds/model which do today+tomorrow,
  vsinAutoRefresh.ts:1734-1737, 1873-1878). **VERIFIED**.
- **HTTP cron**: `POST /api/cron/mlb-cycle` (CRON_SECRET auth) runs the same `runMlbCycleOnce`
  under a run-lock (server/cron/cronRoutes.ts:49-52, 83). GitHub Actions workflow
  `.github/workflows/cron-mlb-cycle.yml` fires it `*/5 * * * *` (yml:36) but its header warns it
  must stay **disabled in the Actions UI until the Manus host is retired** (yml:4-11). Whether the
  workflow is currently enabled, and whether Railway has `DISABLE_BACKGROUND_JOBS` set (i.e.
  which host(s) actually execute the cycle), is **UNKNOWN** — census question.
- Per-final-game: `runMultiMarketBacktest` (fired on FINAL transitions,
  vsinAutoRefresh.ts:1952-1970) does **NOT** re-run `runKPropsBacktest` — the live call passes
  `runKProps=false` (vsinAutoRefresh.ts:1970), so the K-props delegation at
  mlbMultiMarketBacktest.ts:1025-1029 is skipped, consistent with the write-path table above.
  K-props grading on FINAL relies solely on the per-cycle `runKPropsBacktest(today)` at
  vsinAutoRefresh.ts:1934. **VERIFIED** *(corrected by verifier — the original text claimed the
  opposite and contradicted both the code and this dossier's own write-path table)*.
- Seeder cadence: pitcher stats / rolling-5 / batting splits every 24 h; umpires and park factors
  every 7 d; all fire on startup (vsinAutoRefresh.ts:2103-2210). **VERIFIED**.
- The LineupWatcher (vsinAutoRefresh.ts:1819-1857) triggers `runMlbModelForDate`
  (mlbLineupsWatcher.ts:582-583) — the **game** model, not K-props. K-props re-modeling does not
  react to lineup changes except that the platoon adjustment reads whatever lineup is stored at
  each 5-minute tick. **VERIFIED**.

## Patch history relevant to this market

Reconstructed from `git log --follow server/mlbKPropsModelService.ts` (**VERIFIED** commit
messages; content verified via `-S` searches):

1. **e336b59f** — introduced single `K_CALIBRATION_FACTOR = 0.739` ("K-props bias calibration"),
  K-props name-match fix + retroactive grading, drift-state + calibration-constants tables seeded.
2. **46d1dbed** — introduced direction-split verdict thresholds `EDGE_THRESHOLD_OVER = 0.150`,
  `EDGE_THRESHOLD_UNDER = 0.040`, `MAX_OVER_LINE = 5.5` (commit message is about "TiDB Outage
  Resilience" — checkpoint messages routinely under-describe the diff).
3. **f25c16c0** — "P2-A" 4-tier IP fallback and "P4-B" platoon composition adjustment.
4. **30275454** — "P5" recalibration `0.800→0.870` / `0.739→0.810` plus the multi-market backtest
  engine (`mlbFullBacktestEngine.ts`) and its 6 tRPC procedures.
5. **fcc00912** — shared `mlbamIdCache` (dedup of MLB Stats API name-map calls).

One-off scripts (all invoke the live functions for a fixed date; none change model logic —
**VERIFIED** by reading headers):

- `scripts/runKPropsJune3.mjs`, `runKPropsFullJune3.mjs`, `runKPropsJune4.mjs`,
  `runKPropsJune6.mjs` — manual AN-scrape + `modelKPropsForDate` reruns for specific June 2026
  dates (note `runKPropsFullJune3.mjs:9` passes `'2026-06-03'` where `upsertKPropsForDate` expects
  `YYYYMMDD` — the June-4/6 scripts fixed this by passing `AN_DATE_STR = '20260604'` etc.).
- `scripts/runApr11.mjs` — full multi-market pipeline rerun for 2026-04-11 incl. step 4 "K-props
  model (AN Consensus)".
- `server/forceRerunJune18.ts` / `forceRerunJune19.ts` — full-slate force re-models (game model +
  K-props among validation gates).
- `scripts/recalibrate_and_model_may23.mjs` — game-market calibration constants (bias corrections
  in `calibration-constants.tsv`); does **not** touch the hardcoded K factors.
- Whatever wrote `k_calibration_factor = 0.776` (source string `LIVE_2026_N693_BIAS_CORRECTED`,
  2026-05-11) is **not in the repo** (repo-wide grep found no match) — likely a deleted or
  Manus-host one-off. **UNKNOWN**.

Dead code (**VERIFIED** — no callers found):

- `server/ActionNetworkKPropsAPI.py` (Python AN consensus scraper, book 15) and
  `server/ActionNetworkPropsScraper.py` — superseded by `anKPropsService.ts`; referenced only by
  `todo.md:2018`.
- `updateKPropsFromAN` legacy path (kPropsDbHelpers.ts:309-445).
- `EDGE_THRESHOLD` constant (mlbKPropsModelService.ts:66).
- Client pages `ModelProjections.tsx`, `ModelResults.tsx` (unrouted).
- `server/strikeoutProps.test.ts` covers schema/table shape and helper existence only — no model
  math tests (strikeoutProps.test.ts:1-40).

---

## Open questions (UNKNOWN)

1. **Which host runs the 5-minute MLB cycle today?** Is `DISABLE_BACKGROUND_JOBS` set on Railway,
   and is `.github/workflows/cron-mlb-cycle.yml` enabled in the Actions UI? The yml header
   (cron-mlb-cycle.yml:4-11) warns of duplicate-writer risk if both run.
2. **Server process timezone** (Railway TZ env). Determines whether Finding K-1 (evening AN date
   rollover) actually fires.
3. **Is `mlb_pitcher_stats.ipMean3yr` populated in prod?** No writer exists in the repo; if NULL
   everywhere the "priority 1 (most reliable)" IP tier never fires and every pitcher uses season
   IP/GS or worse.
4. **Was StrikeoutModel.py ever run in production?** Check for rows with non-NULL
   `distribution`/`signalBreakdown`/`kLine` and their `modelRunAt` values; also whether the
   Retrosheet/statcast/crosswalk input files even exist on the deployed host.
5. **Who wrote `k_calibration_factor = 0.776`** (`LIVE_2026_N693_BIAS_CORRECTED`), and was the
   intent that the live model *read* calibration from the DB (it doesn't)?
6. **Do stored `mlb_lineups` lineup JSONs carry `bats` for every player** (platoon adj silently
   returns 1.0 on parse/shape misses — the log line is the only trace)?
7. **How often does the name-keyed pitcher-stats join miss** (AN name vs MLB API name), silently
   defaulting to `LEAGUE_K9 = 8.5`, xfipAdj=1.0, hand='R'? Needs a data census of
   `[KPropsModel] k9=FALLBACK` occurrences or a join audit.
8. **Are `anNoVigOverPct` values being updated mid-game** (no freeze) and how often do verdicts
   flip after first pitch? (Row-level history is lost — table stores only latest values.)
9. Provenance of the 288-game and n=693 backtests cited in the calibration comments
   (mlbKPropsModelService.ts:67-89) — no reproducible artifact in the repo.

---

## Finding candidates

| ID | Sev | Title | Evidence |
|---|---|---|---|
| K-1 | P1 | AN K-props fetch uses server-local date while pipeline keys PT date — evening slate can ingest tomorrow's lines onto today's live games (no game-status freeze in the K-props upsert) | anKPropsService.ts:306-311 (`formatANDate` local getters) vs vsinAutoRefresh.ts:132-142 (`datePst` America/Los_Angeles), call sites vsinAutoRefresh.ts:1891+1901; kPropsDbHelpers.ts:182-235 (team-only match, updates live rows). INFERRED — requires TZ=UTC host (open question 2) |
| K-2 | P2 | Opponent-K unit mismatch: `mlb_team_batting_splits.k9` is K/AB×27 (~6.5-7 league) but divided by `LEAGUE_OPP_K9 = 8.2` (true K/9 scale) → oppAdj systematically ~0.80-0.85, silently absorbed into the empirically-fitted calibration factors; any fix to either side silently mis-calibrates the model. [FIXED in Phase 4 — divisor replaced by per-hand same-basis league mean (`getLeagueMeanTeamK9ByHand`), oppAdj now centers on 1.0 (M-204); the phase-4 code itself warns the 0.870/0.810 calibration defaults were fitted under the old bug and must be re-fitted before ship] | seedTeamBattingSplits.ts:100-102,118 vs mlbKPropsModelService.ts:65,432-434 (pre-fix). VERIFIED formulas; average-magnitude estimate INFERRED |
| K-3 | P2 | IP fallback tier 3 uses `rolling5.ip5`, which is the **sum** of the last 5 starts' IP (~25-30), as a per-start IP — always clamps to MAX_IP=7.0, inflating lambda for pitchers lacking season stats | seedPitcherRolling5.ts:111-122 (sum) vs mlbKPropsModelService.ts:441-447 (used as per-start, clamp :81). VERIFIED |
| K-4 | P2 | Owner K-props backtest report counts `backtestResult === "WIN"/"LOSS"`, values never written for K-props (writer emits OVER/UNDER/PUSH) — win rates and edge-tier stats structurally zero | mlbFullBacktestEngine.ts:585-598 vs kPropsBacktestService.ts:218-225,406; exposed at routers.ts:1553-1557, consumed by MlbBacktest.tsx. VERIFIED |
| K-5 | P2 | Dual, divergent calibration sources: code hardcodes 0.870/0.810 while DB `k_calibration_factor` = 0.776 (updated 2026-05-11 by an out-of-repo process) is read by nothing — no single source of truth for the market's central calibration. [FIXED in Phase 4 (partial) — model now reads new DB rows `k_calibration_factor_over`/`_under` per cycle with the hardcoded values demoted to fallbacks (M-207); the orphaned legacy `k_calibration_factor` = 0.776 row is still read by nothing] | mlbKPropsModelService.ts:88-91 (pre-fix); census/calibration-constants.tsv (`k_calibration_factor` row); only repo toucher mlbDriftDetector.ts:217 (seeds 1.0). VERIFIED code; DB writer UNKNOWN |
| K-6 | P3 | Integer book lines: `poissonPOver` thresholds at `floor(bookLine)`, so for whole-number lines the push outcome (X = line) is counted inside pUnder — overstates UNDER probability/edge exactly where AN modal lines land on integers. [FIXED in Phase 4 — `pUnder` now uses new `poissonPUnder` (`CDF(line−1)` on integer lines), excluding the push mass from both sides] | mlbKPropsModelService.ts:140-143,473-474,481-482 (pre-fix). VERIFIED |
| K-7 | P3 | Verdict vocabulary split: Python writes EDGE/FADE/NEUTRAL, TS writes OVER/UNDER/PASS; UI highlight requires `verdict === "EDGE"` so it never activates on live data | StrikeoutModel.py:1476-1480 vs mlbKPropsModelService.ts:487-509; MlbPropsCard.tsx:284-286,431. VERIFIED |
| K-8 | P3 | Backtest "model accuracy" grades `kProj ≥ bookLine` (the UNDER-calibrated mean), not the published verdict/edge rules — reported accuracy does not measure the betting signal users see | kPropsBacktestService.ts:227-232,387-394 vs verdict rules mlbKPropsModelService.ts:487-509 (kProj = lambdaUnder :470,512). VERIFIED |
| K-9 | P3 | No pre-game line freeze for K-props: book line, odds, and no-vig prob keep updating during live games (AN live lines included in consensus), and the model unconditionally re-scores every 5 min — pre-game published edges are overwritten | kPropsDbHelpers.ts:223-235 (no status check), anKPropsService.ts:199-202 (is_live aggregated), vsinAutoRefresh.ts:1908-1915. VERIFIED |
| K-10 | P3 | Umpire K modifier exists (`mlb_umpire_modifiers.kModifier`, weekly-seeded) but is never applied to any K-props model — intended-vs-implemented gap given it was scoped to this market | seedUmpireModifiers.ts:222; consumed only in mlbModelRunner.ts:413-521,1825-1826; absent from mlbKPropsModelService.ts (full read) and StrikeoutModel.py (grep). VERIFIED |
| K-11 | P3 | Python model path (only writer of distribution/percentile columns) is effectively dead: owner-only tRPC, needs local Retrosheet/Statcast files, fixed IP=5.2804 for all pitchers (runner never passes --projected-ip), lineups auto-guessed from the plays file; if ever run, the 5-min TS cycle overwrites its kProj/verdict within minutes, leaving mixed-provenance rows | strikeoutModelRunner.ts:103-115; StrikeoutModel.py:1279,1310-1328; routers.ts:1229-1252; overwrite at mlbKPropsModelService.ts:515-531. VERIFIED wiring; prod usage UNKNOWN |
| K-12 | P3 | K-props are invisible on the canonical user feed: DimeModelFeed renders no K-props; the pages that do (ModelProjections/ModelResults) are unrouted dead code; remaining surfaces are owner-only (`/m/props`, `/admin/model-results`) despite the public getByGame(s) API | DimeModelFeed.tsx (zero matches), App.tsx:244,276-277,315-320,437-441; MobileOwnerLayout.tsx:25; routers.ts:1154-1178. VERIFIED |
| K-13 | P3 | Stale/contradictory documentation of the live formula: file header still documents v1 `ip_expected = bookLine/pitcher_k9*9` and a single 0.040 edge threshold; `EDGE_THRESHOLD` constant is dead; kPropsBacktestService header says "every 10 minutes" (cycle is 5). [Partially FIXED in Phase 4 — header steps 3 and 6 were rewritten for the opp-adj and push fixes, but the step-4 v1 IP formula (now :23), the single-threshold step-7 text, the dead `EDGE_THRESHOLD` constant (now :72), and the "10 minutes" backtest header all remain stale at HEAD] | mlbKPropsModelService.ts:22-36,66 vs :441-447,71-73 (pre-fix); kPropsBacktestService.ts:18 vs vsinAutoRefresh.ts:1361. VERIFIED |
| K-14 | P3 | All stats joins are by normalized full name (AN name ↔ MLB API name), with silent league-average fallback (K9=8.5, xfipAdj=1.0, hand='R') on any miss — mismatch rate unknown and unmonitored beyond a log line | mlbKPropsModelService.ts:404-410,432-434; mlbamIdCache.ts:39-47. VERIFIED mechanism; miss rate UNKNOWN |

---

*Prepared for the Phase-0 census. Line numbers refer to the working tree at commit c9b5b903
(verifier note: server/client/drizzle files are byte-identical from c9b5b903 through 1ccf0fa5, so
all cites also hold at the immediate pre-fix commit; the Phase-4 fix commit 6bce4e36 shifted line
numbers in `mlbKPropsModelService.ts` (~+6 in the constants block, verdict chain now ~:530-546)
and appended ~100 lines of model-cycle helpers to `kPropsDbHelpers.ts` — pre-fix cites do not map
1:1 onto HEAD for those two files).*

---

## Verification (re-run)

Adversarial re-verification, 2026-07-25. Baselines pinned by SHA: **pre-fix = c9b5b903** (the
dossier's stated reference; `git diff c9b5b903 1ccf0fa5 -- server/ client/ drizzle/ .github/
scripts/` is empty, so every cite was checked against `git show c9b5b903:<file>`), **post-fix =
6bce4e36** ("phase 4 root-cause fixes"). Method: every load-bearing parameter value, file:line
cite, write path, and schedule/trigger was re-read from source; git history claims re-run via
`git show <sha>`; no DB queries executed.

**Tally: 96 claims checked — 93 confirmed, 3 corrected, 0 unbacked.**

### Corrected

1. **Scheduling § "Per-final-game" bullet (material).** Original text claimed the
   FINAL-transition `runMultiMarketBacktest` "re-runs `runKPropsBacktest` for that date". The
   live call is `runMultiMarketBacktest(g.id, false)` (vsinAutoRefresh.ts:1970), and the K-props
   delegation is gated `if (runKProps && game.gameDate)` (mlbMultiMarketBacktest.ts:1025) — so it
   is **skipped** on the live path, exactly as the dossier's own write-path table (correctly)
   stated. The bullet contradicted the table; fixed inline.
2. **Python parameter table, MC sims/seed cites.** `n_sims: int = 100_000` is at
   StrikeoutModel.py:586 (not :587); the in-method `default_rng(42)` fallback is at :593-594
   (not :594-595). Values were correct; cites tightened inline. (Explicit `n_sims=100_000` call
   sites at :1354/:1368 additionally confirm the 100k claim.)
3. **Odds-freeze contrast cite.** `vsinAutoRefresh.ts:1655-1656` is the doc comment; the actual
   live/final skip in `refreshAnApiOdds` is at `vsinAutoRefresh.ts:910`
   (`gameStatus === "live" || "final"`). Behavior claim was correct; implementation line added
   so the claim no longer rests on a comment.

### Confirmed (highlights of what was independently re-derived, not merely re-read)

- **Both parameter tables are exact.** All 24 TS-model constants (mlbKPropsModelService.ts:63-103
  pre-fix) and all Python Variant-D constants (StrikeoutModel.py:71-157) match value-for-value and
  line-for-line, including the oddball ones (NEGBIN_R=22.20 :108, STARTER_IP_MEAN=5.2804 :109,
  CAL_ALPHA/BETA 1.0305/0.3314 :116-117, additive blend −2.834/+3.342/+0.500 ×0.040 :763-770).
- **Two-implementation split and write-set partition**: TS path writes exactly the 12 columns at
  :515-531; the Python-path-only rich columns (kLine/kPer9/kMedian/kP5/kP95/signalBreakdown/
  matchupRows/distribution/inningBreakdown) have a single writer, `upsertStrikeoutProp`
  (db.ts:2146, `VALUES(kLine)` at :2162), reached only via owner tRPC `runModel`
  (routers.ts:1229-1252). No scheduler invokes the Python path; `--projected-ip` is never passed
  (grep over strikeoutModelRunner.ts: zero hits) so IP is fixed at 5.2804 as claimed.
- **Verdict chain semantics** (OVER-filtered falls to PASS, not UNDER — `else if` at pre-fix
  :516-540 region, cited :487-509 ✓) and **backtest grading** (`kProj >= bookLine` at :227-232,
  OVER/UNDER/PUSH at :218-225, modelCorrect null on PUSH :389-394, side-indexed scratched-starter
  fallback :347-379) re-read verbatim.
- **K-4 vocabulary mismatch is real and remains at HEAD**: `getKPropsBacktestReport` counts
  `"WIN"/"LOSS"` (mlbFullBacktestEngine.ts:583-598), values only the HR-props writer emits
  (mlbHrPropsBacktestService.ts:200); kPropsBacktestService and mlbFullBacktestEngine are
  byte-identical c9b5b903→HEAD, so Phase 4's "model-pick grading" fixes (mlbOutcomeIngestor/
  mlbScoreRefresh) did **not** touch K-props grading. Findings K-1, K-3, K-4, K-7, K-8, K-9,
  K-10, K-11, K-12, K-14 are all unaffected by Phase 4 and stand as written.
- **Patch history**: all five commits re-shown. e336b59f adds `K_CALIBRATION_FACTOR = 0.739`;
  46d1dbed adds EDGE_THRESHOLD_OVER/UNDER + MAX_OVER_LINE under the "TiDB Outage Resilience"
  message (under-description confirmed); f25c16c0 adds P2-A/P4-B; 30275454 adds 0.870/0.810 +
  mlbFullBacktestEngine + 6 tRPC procedures; fcc00912 adds mlbamIdCache. TSV row 42 confirms
  `k_calibration_factor 0.776 / prev 0.739 / n=693 / LIVE_2026_N693_BIAS_CORRECTED / 2026-05-11`,
  and repo-wide grep at c9b5b903 confirms mlbDriftDetector.ts:217 is its only toucher.
- **Exposure/dead-code claims**: ModelProjections.tsx / ModelResults.tsx have zero importers;
  DimeModelFeed.tsx has zero K-props references; MlbPropsCard highlight requires
  `verdict === "EDGE"` (:285-286) while the badge checks `!== "PASS"` (:431); routes at
  App.tsx:244/276-277/315-320/437-441 and MobileOwnerLayout.tsx:25 all as cited (MobileProps
  lives at `features/mobileOwnerTabs/screens/MobileProps.tsx`, query at :344).
- **Cron/schedule claims**: immediate fire + 5-min `setInterval` (:2096-2101, MLB_INTERVAL_MS
  :1361), K-props steps today-only (:1885-1934), seeder cadences 24h/24h/24h/7d (:2116-2207),
  cronRoutes.ts:49/83, workflow cron `*/5` at yml:36 with the do-not-enable header at yml:4-11.
  One nuance worth the census's attention: the pre-fix cronRoutes.ts:45-48 comment asserts
  DISABLE_BACKGROUND_JOBS *is* set on Railway ("that interval never runs, so this endpoint is
  the only trigger") — evidence toward open question 1, though a comment is not proof.

### Phase-4 fix annotations applied

Phase 4 (6bce4e36) changed, of the files this dossier cites, only `mlbKPropsModelService.ts` and
`kPropsDbHelpers.ts` (plus cronRoutes/mlbModelRunner/grading files outside the K-props claims).
Inline `[FIXED in Phase 4 — …]` annotations were added for: K-2 (M-204 opp-adj same-basis
divisor), K-5 (M-207 DB-read calibration factors, partial — legacy 0.776 row still orphaned),
K-6 (poissonPUnder push exclusion), K-13 (partial header rewrite), plus the corresponding
mechanics steps 4/8, the parameter-table rows (LEAGUE_OPP_K9 removed; calibration constants
renamed `*_DEFAULT` and demoted to fallbacks), and the calibration-provenance paragraph. The
K-2 annotation carries forward the phase-4 code's own warning that the 0.870/0.810 defaults were
fitted under the unit bug and require walk-forward re-fitting before the fixed model ships.

*Verifier: adversarial re-run against SHAs c9b5b903 (pre-fix) / 6bce4e36 (post-fix); working tree
HEAD during verification was b0578e60 (docs-only on top of 6bce4e36).*
