#!/usr/bin/env node
// Batch B8: Phase 5 replay infrastructure.
//   1. CREATE new provenance tables (never touching existing tables):
//        mlb_replay_projections       one row per game per model version (walkforward_replay)
//        mlb_replay_prop_projections  K/HR replay props
//        mlb_replay_grades            unified grade ledger, source = live_pregame | walkforward_replay
//        mlb_replay_linescores        per-half inning-1/F5/starter substrate (as-of feature store)
//   2. Populate mlb_replay_linescores from StatsAPI (boxscore + linescore per final game).
// Provenance separation is structural: existing tables keep only live_pregame data; every
// replay artifact lives in these tables. Public surfaces never read mlb_replay_*.
import { connect, execFlag } from './_db.mjs';

const AS_OF = '2026-07-25';
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const DDL = [
  `CREATE TABLE IF NOT EXISTS mlb_replay_projections (
     id INT AUTO_INCREMENT PRIMARY KEY,
     gameId INT NOT NULL, gameDate VARCHAR(10) NOT NULL,
     provenance VARCHAR(24) NOT NULL DEFAULT 'walkforward_replay',
     modelVersion VARCHAR(64) NOT NULL,
     asOfCutoffMs BIGINT NOT NULL,
     pAwayMl DECIMAL(7,5), projAwayScore DECIMAL(6,3), projHomeScore DECIMAL(6,3),
     projTotal DECIMAL(6,3), pOver DECIMAL(7,5), pAwayRl DECIMAL(7,5),
     pF5AwayMl DECIMAL(7,5), projF5Total DECIMAL(6,3), pF5Over DECIMAL(7,5), pF5AwayRl DECIMAL(7,5),
     pNrfi DECIMAL(7,5),
     calibMeta TEXT,
     createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_replay_game (gameId, modelVersion),
     KEY idx_replay_date (gameDate)
   )`,
  `CREATE TABLE IF NOT EXISTS mlb_replay_prop_projections (
     id INT AUTO_INCREMENT PRIMARY KEY,
     gameId INT NOT NULL, gameDate VARCHAR(10) NOT NULL,
     propType VARCHAR(4) NOT NULL,
     mlbamId INT NOT NULL, playerName VARCHAR(128), side VARCHAR(8),
     provenance VARCHAR(24) NOT NULL DEFAULT 'walkforward_replay',
     modelVersion VARCHAR(64) NOT NULL,
     projValue DECIMAL(7,4), pOver DECIMAL(7,5), line DECIMAL(4,1),
     createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_replay_prop (gameId, propType, mlbamId, modelVersion),
     KEY idx_replay_prop_date (gameDate)
   )`,
  `CREATE TABLE IF NOT EXISTS mlb_replay_grades (
     id INT AUTO_INCREMENT PRIMARY KEY,
     gameId INT NOT NULL, gameDate VARCHAR(10) NOT NULL,
     market VARCHAR(16) NOT NULL,
     refId INT NOT NULL DEFAULT 0,
     source VARCHAR(24) NOT NULL,
     modelVersion VARCHAR(64) NOT NULL DEFAULT '',
     pick VARCHAR(8), prob DECIMAL(7,5), projValue DECIMAL(7,4), line VARCHAR(16),
     actual VARCHAR(16), result VARCHAR(8), correct TINYINT,
     brier DECIMAL(8,6), signedError DECIMAL(7,3),
     createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_replay_grade (gameId, market, source, refId, modelVersion),
     KEY idx_grade_market_date (market, gameDate),
     KEY idx_grade_source (source)
   )`,
  `CREATE TABLE IF NOT EXISTS mlb_replay_linescores (
     gamePk INT PRIMARY KEY,
     gameId INT NOT NULL, gameDate VARCHAR(10) NOT NULL,
     awayStarterId INT, homeStarterId INT,
     awayStarterHand VARCHAR(1), homeStarterHand VARCHAR(1),
     inn1AwayRuns TINYINT, inn1HomeRuns TINYINT,
     f5AwayRuns TINYINT, f5HomeRuns TINYINT,
     awayStarterKs TINYINT, homeStarterKs TINYINT,
     awayStarterOuts SMALLINT, homeStarterOuts SMALLINT,
     awayLineup TEXT, homeLineup TEXT,
     awayFinalRuns TINYINT, homeFinalRuns TINYINT,
     createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     KEY idx_ls_date (gameDate)
   )`,
];

for (const ddl of DDL) {
  const name = ddl.match(/EXISTS (\w+)/)[1];
  if (EXECUTE) { await q(ddl); console.log(`table ready: ${name}`); }
  else console.log(`PLAN create-if-missing: ${name}`);
}
if (!EXECUTE) { console.log('(dry-run stops before population)'); await conn.end(); process.exit(0); }

// populate linescore substrate for all finals with a gamePk not yet stored
const targets = await q(
  `SELECT g.id, g.mlbGamePk pk, g.gameDate FROM games g
   LEFT JOIN mlb_replay_linescores r ON r.gamePk = g.mlbGamePk
   WHERE g.sport='MLB' AND g.gameStatus='final' AND g.mlbGamePk IS NOT NULL
     AND g.gameDate>='2026-03-25' AND g.gameDate<=? AND r.gamePk IS NULL`, [AS_OF]);
console.log(`linescore substrate targets: ${targets.length} games`);

const ipToOuts = (ip) => { const [w, f] = String(ip ?? '0').split('.'); return Number(w) * 3 + Number(f || 0); };
let ok = 0, fail = 0;
for (const t of targets) {
  try {
    const [ls, box] = await Promise.all([
      (await fetch(`https://statsapi.mlb.com/api/v1/game/${t.pk}/linescore`)).json(),
      (await fetch(`https://statsapi.mlb.com/api/v1/game/${t.pk}/boxscore`)).json(),
    ]);
    const inn = ls.innings ?? [];
    if (inn.length < 5) { fail++; continue; }
    const side = (k) => {
      const team = box.teams?.[k] ?? {};
      const starterId = team.pitchers?.[0] ?? null;
      const sp = starterId ? team.players?.[`ID${starterId}`] : null;
      const lineup = (team.battingOrder ?? []).slice(0, 9);
      return {
        starterId,
        ks: sp?.stats?.pitching?.strikeOuts ?? null,
        outs: sp?.stats?.pitching?.inningsPitched ? ipToOuts(sp.stats.pitching.inningsPitched) : null,
        lineup: JSON.stringify(lineup),
        final: team.teamStats?.batting?.runs ?? null,
      };
    };
    const a = side('away'), h = side('home');
    await conn.query(
      `INSERT INTO mlb_replay_linescores
         (gamePk, gameId, gameDate, awayStarterId, homeStarterId, inn1AwayRuns, inn1HomeRuns,
          f5AwayRuns, f5HomeRuns, awayStarterKs, homeStarterKs, awayStarterOuts, homeStarterOuts,
          awayLineup, homeLineup, awayFinalRuns, homeFinalRuns)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE gameId=VALUES(gameId)`,
      [t.pk, t.id, t.gameDate, a.starterId, h.starterId,
       inn[0].away?.runs ?? 0, inn[0].home?.runs ?? 0,
       inn.slice(0, 5).reduce((s, i) => s + (i.away?.runs ?? 0), 0),
       inn.slice(0, 5).reduce((s, i) => s + (i.home?.runs ?? 0), 0),
       a.ks, h.ks, a.outs, h.outs, a.lineup, h.lineup, a.final, h.final]);
    ok++;
    if (ok % 200 === 0) console.log(` substrate progress: ${ok}/${targets.length}`);
  } catch (e) { console.log(` FAIL pk=${t.pk}: ${e.message}`); fail++; }
}
// starter hands from mlb_pitcher_stats
await conn.query(
  `UPDATE mlb_replay_linescores r JOIN mlb_pitcher_stats p ON p.mlbamId = r.awayStarterId SET r.awayStarterHand = p.throwsHand WHERE r.awayStarterHand IS NULL`);
await conn.query(
  `UPDATE mlb_replay_linescores r JOIN mlb_pitcher_stats p ON p.mlbamId = r.homeStarterId SET r.homeStarterHand = p.throwsHand WHERE r.homeStarterHand IS NULL`);
const [{ n }] = await q(`SELECT COUNT(*) n FROM mlb_replay_linescores`);
console.log(`substrate complete: ${ok} ok, ${fail} fail; table rows=${n}`);
await conn.end();
