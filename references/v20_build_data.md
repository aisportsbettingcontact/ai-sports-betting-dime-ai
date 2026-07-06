# v20 Engine Build Data (July 6, 2026)

## BetExplorer Odds for POR vs ESP (scraped 2026-07-06 18:33 UTC, event_id=tbTsReVa)
- 1X2: Home(POR) +290, Draw +250, Away(ESP) -105
- Spread (pk/0): Home(POR) +175, Away(ESP) -233
- Spread (+1.5 POR / -1.5 ESP): Home(POR) -333, Away(ESP) +245
- O/U 2.5: Over -125, Under +100
- O/U 3.5: Over +175, Under -227
- BTTS: Yes -149, No +110
- DC: HomeWD(1X) -125, AwayWD(X2) -400, NoDraw(12) -345

## Match Orientation (from DB)
- wc26-r16-093: home_team_id=por, away_team_id=esp, ESPN 760506, SCHEDULED
- Venue: Inglewood (SoFi Stadium), Kickoff: 2026-07-06 19:00 UTC

## BACKTEST_MATCHES for v20 (18 total = 16 R32 + 2 Jul5 R16)
Same 16 R32 as v19 PLUS:
- { fid:'wc26-r16-091', home:'BRA', away:'NOR', homeScore:1, awayScore:2 }
- { fid:'wc26-r16-092', home:'MEX', away:'ENG', homeScore:2, awayScore:3 }

## Jul 5 Book Odds (from v19 engine - reuse for backtest)
- wc26-r16-091: bookHomeMl:-133, bookDraw:270, bookAwayMl:375, bookSpread:-1.5, bookTotal:2.5, bookOver:-137, bookUnder:110, bookBttsY:-149, bookBttsN:110
- wc26-r16-092: bookHomeMl:200, bookDraw:220, bookAwayMl:145, bookSpread:-0.5, bookTotal:2.5, bookOver:138, bookUnder:-175, bookBttsY:100, bookBttsN:-133

## PROJECTION_MATCHES for v20
- { fid:'wc26-r16-093', home:'POR', away:'ESP', espnId:'760506' }

## JUL6_BOOK for v20
```
'wc26-r16-093': {
  bookHomeMl: 290, bookDraw: 250, bookAwayMl: -105,
  bookSpread: 0, bookTotal: 2.5,
  bookOver: -125, bookUnder: 100,
  bookBttsY: -149, bookBttsN: 110,
  bookHomeAdv: ???, bookAwayAdv: ???,  // Need to derive from DC or use pk spread
  bookHomeWD: -125, bookAwayWD: -400, bookNoDraw: -345,
  bookHomeSpreadOdds: 175, bookAwaySpreadOdds: -233,
}
```

## To Advance Odds (not directly scraped - derive from pk spread)
- POR to advance: pk +175 → implies ~36% → ML approx +175
- ESP to advance: pk -233 → implies ~70% → ML approx -233
- Use pk spread odds as "to advance" proxy since it's a knockout match

## ENGINE CHANGES from v19 → v20
1. Header: v20.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL6
2. BACKTEST_MATCHES: Add 2 Jul5 R16 results (18 total)
3. BACKTEST_BOOK: Add Jul5 book odds for 091/092
4. PROJECTION_MATCHES: Change to POR vs ESP only
5. JUL6_BOOK: Fresh bet365 odds from BetExplorer
6. ESPN_TEAM_IDS: Already has POR:482, ESP:164
7. TIER_MULTIPLIER: Already has POR:1.06, ESP:1.10
8. Phase 6 banner: "MODEL JULY 6 R16 MATCH"

## DB Write Targets
- wc2026MatchOdds: UPDATE match_id='wc26-r16-093' with all 36+ columns
- wc2026_model_projections: UPSERT match_id='wc26-r16-093'
- wc2026_model_runs: INSERT new run entry
- wc2026_model_grades: INSERT backtest grades

## Key Architecture (from v19 - DO NOT CHANGE)
- 25 VARIATIONS (V1-V25) with params: xGW, xGOTW, smW, psW, xAW, spW, possW, convW, rho, pace
- Dixon-Coles model with rho correlation
- buildJointMatrix: 10x10 (0-9 goals each side)
- deriveAllMarkets: pH, pD, pA, pOver, pUnder, pBTTS, pHomeSpread, pAwaySpread, pAdvH, pAdvA, etc.
- Grading: composite = 45*(dir) + 30*(total) + 15*(spread) + 10*(btts)
- Recalibration: avg top-3 variation params
- Reinforcement: max(recal, bestVariation) by composite score
- probToML: converts probability to American odds
- deriveAllMarkets uses spreadLine from book odds

## wc2026_espn_match_stats columns used by engine
- espn_match_id, homeTeamAbbrev, awayTeamAbbrev, homeShots, awayShots, homeShotsOnGoal, awayShotsOnGoal
