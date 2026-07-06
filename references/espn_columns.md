# ESPN Table Columns (for v20 engine reference)

## wc2026_espn_team_stats
id, espn_match_id, matchRound, homeTeamAbbrev, awayTeamAbbrev, possession, shotsOnGoal, shotsOnGoalAway, shotAttempts, shotAttemptsAway, fouls, foulsAway, yellowCards, yellowCardsAway, redCards, redCardsAway, cornerKicks, cornerKicksAway, saves, savesAway, possessionAway, createdAt, updatedAt

## wc2026_espn_expected_goals
id, espn_match_id, matchRound, homeTeamAbbrev, awayTeamAbbrev, homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay, homeXGSetPlay, awayXGSetPlay, homeXGOT, awayXGOT, homeXA, awayXA, perPlayerJson, createdAt, updatedAt

## wc2026_espn_shot_map
id, espn_match_id, matchRound, shotId, sequence, playerId, playerName, playerShortName, playerJersey, teamAbbrev, isAway, period, clock, iconType, isOwnGoal, fieldStartX, fieldStartY, fieldEndX, fieldEndY, goalPositionY, goalPositionZ, xG, xGOT, distance, shotType, situation, goalZone, description, shortDescription, createdAt

## wc2026_espn_player_stats
id, espn_match_id, matchRound, athleteId, name, nameShort, jersey, teamAbbrev, teamName, isHome, positionGroup, isGoalkeeper, tch, g, a, xG, xA, sog, shot, bcc, dint, duelw, ga, sv, soga, xGC, xGOTC, gp, bcs, clr, cc, ks, appearances, foulsCommitted, foulsSuffered, ownGoals, redCards, subIns, yellowCards, offsides, shotsFaced, createdAt, updatedAt

## Key Facts
- Team abbrevs in ESPN tables: POR, ESP (uppercase)
- POR xG rows: 4 (from group stage + R32)
- ESP xG rows: 4 (from group stage + R32)
- Jul 5 results updated: BRA 1-2 NOR, MEX 2-3 ENG
- POR vs ESP match: wc26-r16-093, ESPN 760506, status SCHEDULED
- USA vs BEL match: wc26-r16-094, ESPN 760507, status SCHEDULED

## v19 Engine Key Functions (for column mapping)
- xgAll uses: homeTeamAbbrev, awayTeamAbbrev, homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
- tsAll uses: espn_match_id, possession, possessionAway, shotsOnGoal, shotsOnGoalAway, shotAttempts, shotAttemptsAway
- smAll uses: teamAbbrev, xG (as shotXG), xGOT (as shotXGOT), espn_match_id
- psAll uses: teamAbbrev, xG (as pXG), espn_match_id

## TIER_MULTIPLIER
- POR: 1.06, ESP: 1.10

## ESPN_TEAM_IDS
- POR: 482, ESP: 164
