import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import 'dotenv/config';

const espnIds = ['760487','760488','760489','760490','760491','760492','760493'];
const ph = espnIds.map(()=>'?').join(',');

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const [xg] = await c.execute(
  `SELECT matchId,homeTeamAbbrev,awayTeamAbbrev,
          homeXG,awayXG,homeXGOT,awayXGOT,
          homeXGOpenPlay,awayXGOpenPlay,homeXGSetPlay,awayXGSetPlay,
          homeXA,awayXA
   FROM wc2026_espn_expected_goals WHERE matchId IN (${ph})`, espnIds);

const [ts] = await c.execute(
  `SELECT matchId,
          homePossession,awayPossession,
          homeShotsOnGoal,awayShotsOnGoal,
          homeShotAttempts,awayShotAttempts,
          homeCorners,awayCorners,
          homeSaves,awaySaves,
          homeFouls,awayFouls,
          homeYellowCards,awayYellowCards,
          homeRedCards,awayRedCards
   FROM wc2026_espn_team_stats WHERE matchId IN (${ph})`, espnIds);

const [sm] = await c.execute(
  `SELECT matchId, teamAbbrev,
          SUM(xg) as shotXG, SUM(xgot) as shotXGOT,
          COUNT(*) as shots,
          SUM(CASE WHEN isGoal=1 THEN 1 ELSE 0 END) as goals,
          AVG(distanceYards) as avgDist
   FROM wc2026_espn_shot_map WHERE matchId IN (${ph})
   GROUP BY matchId, teamAbbrev`, espnIds);

const [ps] = await c.execute(
  `SELECT matchId, teamAbbrev,
          SUM(xg) as pXG, SUM(xgot) as pXGOT, SUM(xa) as pXA,
          SUM(touches) as touches, SUM(duelWins) as duelWins,
          SUM(saves) as saves, SUM(xgc) as xgc
   FROM wc2026_espn_player_stats WHERE matchId IN (${ph})
   GROUP BY matchId, teamAbbrev`, espnIds);

const [mt] = await c.execute(
  `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
          homeScore, awayScore, homeFormation, awayFormation,
          matchKickoffEt, matchGameDate, attendance
   FROM wc2026_espn_matches WHERE matchId IN (${ph})`, espnIds);

await c.end();

const out = { xg, ts, sm, ps, mt };
writeFileSync('/home/ubuntu/wc2026_all_espn_raw.json', JSON.stringify(out, null, 2));
console.log(`[DONE] xg=${xg.length} ts=${ts.length} sm=${sm.length} ps=${ps.length} mt=${mt.length}`);
