# July 6 Pipeline State Reference

## Historical engine architecture
- The v19 July 5 engine used for this snapshot is retained in Git history; maintained production engines are copied explicitly by the build.
- Model: Dixon-Coles with correlation parameter (rho)
- Monte Carlo: 500X simulations per variation
- Variations: 25 parameter sets (V1-V25) with weights: xGW, xGOTW, smW, psW, xAW, spW, possW, convW, rho, pace
- Grading: composite = 45*(dir) + 30*(total) + 15*(spread) + 10*(btts) + correct score overlay
- Pipeline: DATA → 500X BACKTEST → CORRECT SCORE GRADE → RECALIBRATION → 25 VARIATIONS → REINFORCEMENT → MODEL → AUDIT → DB
- Recalibration: Average top-3 variation params
- Reinforcement: Lock best composite (recal vs best variation)
- DB tables written: wc2026_model_projections, wc2026MatchOdds, wc2026_model_runs, wc2026_model_grades, wc2026_holdout_validation

## Database Schema (wc2026_matches)
- Columns: match_id, match_date, kickoff_utc, stage, group_letter, matchday, home_team_id, away_team_id, venue_id, home_score, away_score, status, is_host_home, espn_match_id, attendance, display_order, advancing_team_id, fifa_match_id, match_minute
- Team IDs are lowercase abbreviations (bra, nor, mex, eng, por, esp, usa, bel)
- Status values: FT, SCHEDULED

## ESPN Tables
- wc2026_espn_expected_goals: 88 rows (covers 88 matches)
- wc2026_espn_team_stats: 88 rows (covers 88 matches)
- wc2026_espn_player_stats: 2742 rows (covers 87 matches)
- wc2026_espn_shot_map: 2195 rows (covers 87 matches)
- wc2026_espn_match_stats: 88 rows (covers 88 matches)

## Current State
- 88 FT matches (all group stage + R32)
- R16 matches 089-096 all SCHEDULED (none have results yet)
- Jul 5 matches: wc26-r16-091 (BRA vs NOR, ESPN 760504), wc26-r16-092 (MEX vs ENG, ESPN 760505)
- Jul 6 matches: wc26-r16-093 (POR vs ESP, ESPN 760506), wc26-r16-094 (USA vs BEL, ESPN 760507)

## BACKTEST_MATCHES from v19 engine (16 R32 matches with actual scores)
- wc26-r32-073: RSA 0-1 CAN
- wc26-r32-074: BRA 2-1 JPN
- wc26-r32-075: GER 1-1 PAR
- wc26-r32-076: NED 1-1 MAR
- wc26-r32-077: CIV 1-2 NOR
- wc26-r32-078: FRA 3-0 SWE
- wc26-r32-079: MEX 2-0 ECU
- wc26-r32-080: ENG 2-1 COD
- wc26-r32-081: BEL 3-2 SEN
- wc26-r32-082: USA 2-0 BIH
- wc26-r32-083: ESP 3-0 AUT
- wc26-r32-084: POR 2-1 CRO
- wc26-r32-085: SUI 2-0 ALG
- wc26-r32-086: AUS 1-1 EGY
- wc26-r32-087: ARG 3-2 CPV
- wc26-r32-088: COL 1-0 GHA

## ESPN_TEAM_IDS mapping
- BRA:205, NOR:464, MEX:203, ENG:448, PAR:210, FRA:478, CAN:206, MAR:2869
- AUS:220, EGY:2836, ARG:202, CPV:2851, COL:207, GHA:2849, RSA:2862, JPN:7850
- GER:481, NED:487, CIV:2848, SWE:497, ECU:2166, COD:2850, BEL:459, SEN:654
- USA:660, BIH:452, ESP:164, AUT:474, POR:482, CRO:477, SUI:2847, ALG:2833

## TIER_MULTIPLIER (v19)
- FRA:1.15, ARG:1.12, BRA:1.10, ESP:1.10, ENG:1.08
- POR:1.06, GER:1.05, NED:1.05, BEL:1.04, COL:1.04, USA:1.03
- MEX:1.02, MAR:1.03, CRO:1.02, SUI:1.01, NOR:1.01

## Key Functions
- poissonPMF(k, lambda): Poisson probability mass
- dcAdjust(x, y, lambda, mu, rho): Dixon-Coles low-score correction
- buildJointMatrix(lambdaH, lambdaA, rho): 10x10 joint probability matrix
- deriveAllMarkets(joint, lambdaH, lambdaA, spreadLine): All market probabilities + ML prices
- correctScoreGrade(joint, actualHome, actualAway): Grade correct score (prob, rank, topScore)
- computeLambda(teamCode, gsRows, psAll, smAll, variation): Compute team lambda from ESPN data
- gradeBacktest500X(results): Grade all backtest matches (composite score)
- buildGSRows(teamCode, xgAll, tsAll, msAll): Build game-stat rows for a team

## BetExplorer Scraping
- Previous scraper revision is retained in Git history; the maintained implementation is `server/wc2026/betexplorer_scraper.py`.
- Source: BetExplorer AJAX API for bet365 odds
- The v19 engine had hardcoded book odds in BACKTEST_BOOK and JUL5_BOOK objects

## Next Steps for July 6 Engine (v20)
1. Need Jul 5 R16 actual results (BRA vs NOR, MEX vs ENG) - scrape from ESPN
2. Need Jul 5 ESPN data ingested (xG, team stats, player stats, shot map)
3. Need BetExplorer odds for Jul 6 matches (POR vs ESP, USA vs BEL)
4. Build the next July 6 engine with:
   - BACKTEST_MATCHES: 16 R32 + Jul 5 R16 results (18 total)
   - PROJECTION_MATCHES: [{fid:'wc26-r16-093', home:'POR', away:'ESP'}, {fid:'wc26-r16-094', home:'USA', away:'BEL'}]
   - Updated BACKTEST_BOOK with Jul 5 book odds
   - New JUL6_BOOK with scraped BetExplorer odds

## Anthropic API Issue
- Model: claude-fable-5 (used in Dime route, NOT in the modeling engine)
- API key has billing issue ("credit balance too low") despite $69.85 showing in dashboard
- This does NOT affect the WC2026 modeling engine (which is pure math, no LLM calls)
