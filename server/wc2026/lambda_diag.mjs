// Lambda diagnostic — trace exact values for all 6 Jul 1 teams
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TEAMS = ['ENG','COD','BEL','SEN','USA','BIH'];

// Pull all xG data
const [xgRows] = await conn.execute(`
  SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev,
         homeXG, awayXG, homeXGOT, awayXGOT,
         homeXGOpenPlay, awayXGOpenPlay, homeXGSetPlay, awayXGSetPlay,
         homeXA, awayXA
  FROM wc2026_espn_expected_goals
  WHERE homeTeamAbbrev IN (${TEAMS.map(()=>'?').join(',')})
     OR awayTeamAbbrev IN (${TEAMS.map(()=>'?').join(',')})
`, [...TEAMS, ...TEAMS]);

const [tsRows] = await conn.execute(`
  SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev,
         possession, possessionAway, shotAttempts, shotAttemptsAway
  FROM wc2026_espn_team_stats
  WHERE homeTeamAbbrev IN (${TEAMS.map(()=>'?').join(',')})
     OR awayTeamAbbrev IN (${TEAMS.map(()=>'?').join(',')})
`, [...TEAMS, ...TEAMS]);

const [psRows] = await conn.execute(`
  SELECT espn_match_id, teamAbbrev,
         SUM(xG) as playerXG, SUM(xA) as playerXA
  FROM wc2026_espn_player_stats
  WHERE teamAbbrev IN (${TEAMS.map(()=>'?').join(',')})
  GROUP BY espn_match_id, teamAbbrev
`, TEAMS);

const [smRows] = await conn.execute(`
  SELECT espn_match_id, teamAbbrev, SUM(xG) as shotXG
  FROM wc2026_espn_shot_map
  WHERE teamAbbrev IN (${TEAMS.map(()=>'?').join(',')})
  GROUP BY espn_match_id, teamAbbrev
`, TEAMS);

await conn.end();

// Build per-team averages
const stats = {};
const init = (t) => { if (!stats[t]) stats[t] = { xGSum:0, xGOTSum:0, xASum:0, setXGSum:0, possSum:0, shotMapXGSum:0, playerXGSum:0, n:0 }; };

for (const r of xgRows) {
  if (!r.homeXG) continue; // skip upcoming matches
  init(r.homeTeamAbbrev); init(r.awayTeamAbbrev);
  stats[r.homeTeamAbbrev].xGSum     += parseFloat(r.homeXG||0);
  stats[r.homeTeamAbbrev].xGOTSum   += parseFloat(r.homeXGOT||0);
  stats[r.homeTeamAbbrev].xASum     += parseFloat(r.homeXA||0);
  stats[r.homeTeamAbbrev].setXGSum  += parseFloat(r.homeXGSetPlay||0);
  stats[r.homeTeamAbbrev].n++;
  stats[r.awayTeamAbbrev].xGSum     += parseFloat(r.awayXG||0);
  stats[r.awayTeamAbbrev].xGOTSum   += parseFloat(r.awayXGOT||0);
  stats[r.awayTeamAbbrev].xASum     += parseFloat(r.awayXA||0);
  stats[r.awayTeamAbbrev].setXGSum  += parseFloat(r.awayXGSetPlay||0);
  stats[r.awayTeamAbbrev].n++;
}
for (const r of tsRows) {
  init(r.homeTeamAbbrev); init(r.awayTeamAbbrev);
  stats[r.homeTeamAbbrev].possSum += parseFloat(r.possession||50)/100;
  stats[r.awayTeamAbbrev].possSum += parseFloat(r.possessionAway||50)/100;
}
for (const r of psRows) {
  init(r.teamAbbrev);
  stats[r.teamAbbrev].playerXGSum += parseFloat(r.playerXG||0);
}
for (const r of smRows) {
  init(r.teamAbbrev);
  stats[r.teamAbbrev].shotMapXGSum += parseFloat(r.shotXG||0);
}

// V2 winning config
const V2 = { xGW:0.45, xGOTW:0.15, smW:0.12, psW:0.08, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, pace:0.035 };

console.log('\n=== LAMBDA DIAGNOSTIC — V2 CONFIG ===\n');
console.log(`${'Team'.padEnd(5)} ${'n'.padEnd(3)} ${'xG'.padEnd(7)} ${'xGOT'.padEnd(7)} ${'xA'.padEnd(7)} ${'setXG'.padEnd(7)} ${'poss%'.padEnd(7)} ${'smXG'.padEnd(7)} ${'psXG'.padEnd(7)} ${'λ (raw)'.padEnd(10)} ${'λ (final)'}`);
console.log('-'.repeat(100));

for (const team of TEAMS) {
  const s = stats[team];
  if (!s || s.n === 0) { console.log(`${team.padEnd(5)} NO DATA`); continue; }
  const n = s.n;
  const xGBase   = s.xGSum / n;
  const xGOT     = s.xGOTSum / n;
  const xGOTAdj  = xGOT * 0.85;
  const xA       = s.xASum / n;
  const setXG    = s.setXGSum / n;
  const poss     = s.possSum / n;
  const shotMapXG = s.shotMapXGSum / n || xGBase;
  const playerXG  = s.playerXGSum / n || xGBase;
  const possAdj  = (poss - 0.5) * 0.3;

  const lambdaRaw =
    V2.xGW   * xGBase +
    V2.xGOTW * xGOTAdj +
    V2.smW   * shotMapXG +
    V2.psW   * playerXG +
    V2.xAW   * xA +
    V2.spW   * setXG +
    V2.possW * (xGBase * (1 + possAdj)) +
    V2.convW * xGBase;

  const lambdaFinal = Math.max(0.20, lambdaRaw * (1 - V2.pace));

  console.log(
    `${team.padEnd(5)} ${String(n).padEnd(3)} ${xGBase.toFixed(3).padEnd(7)} ${xGOT.toFixed(3).padEnd(7)} ${xA.toFixed(3).padEnd(7)} ${setXG.toFixed(3).padEnd(7)} ${(poss*100).toFixed(1).padEnd(7)} ${shotMapXG.toFixed(3).padEnd(7)} ${playerXG.toFixed(3).padEnd(7)} ${lambdaRaw.toFixed(4).padEnd(10)} ${lambdaFinal.toFixed(4)}`
  );
}

console.log('\n=== MATCH LAMBDA PAIRS ===\n');
const pairs = [
  { fid:'wc26-r32-080', home:'ENG', away:'COD', spread:-1.5 },
  { fid:'wc26-r32-081', home:'BEL', away:'SEN', spread:-1.5 },
  { fid:'wc26-r32-082', home:'USA', away:'BIH', spread:-1.5 },
];

for (const p of pairs) {
  const lH = Math.max(0.20, (() => {
    const s = stats[p.home]; if (!s||!s.n) return 0.80;
    const n=s.n, xGBase=s.xGSum/n, xGOTAdj=(s.xGOTSum/n)*0.85, xA=s.xASum/n, setXG=s.setXGSum/n;
    const poss=s.possSum/n, possAdj=(poss-0.5)*0.3;
    const smXG=s.shotMapXGSum/n||xGBase, psXG=s.playerXGSum/n||xGBase;
    return (V2.xGW*xGBase+V2.xGOTW*xGOTAdj+V2.smW*smXG+V2.psW*psXG+V2.xAW*xA+V2.spW*setXG+V2.possW*(xGBase*(1+possAdj))+V2.convW*xGBase)*(1-V2.pace);
  })());
  const lA = Math.max(0.20, (() => {
    const s = stats[p.away]; if (!s||!s.n) return 0.80;
    const n=s.n, xGBase=s.xGSum/n, xGOTAdj=(s.xGOTSum/n)*0.85, xA=s.xASum/n, setXG=s.setXGSum/n;
    const poss=s.possSum/n, possAdj=(poss-0.5)*0.3;
    const smXG=s.shotMapXGSum/n||xGBase, psXG=s.playerXGSum/n||xGBase;
    return (V2.xGW*xGBase+V2.xGOTW*xGOTAdj+V2.smW*smXG+V2.psW*psXG+V2.xAW*xA+V2.spW*setXG+V2.possW*(xGBase*(1+possAdj))+V2.convW*xGBase)*(1-V2.pace);
  })());
  console.log(`${p.fid}: ${p.away}(Away) @ ${p.home}(Home) | λH=${lH.toFixed(4)} λA=${lA.toFixed(4)} | Spread: Home ${p.spread}`);
  
  // Quick spread cover estimate
  const MAX=8;
  const pois = (k,l) => { let r=Math.exp(-l); for(let i=1;i<=k;i++) r*=l/i; return r; };
  let pHomeSpread=0, pAwaySpread=0;
  for(let h=0;h<=MAX;h++) for(let a=0;a<=MAX;a++){
    const pr=pois(h,lH)*pois(a,lA);
    if(h-a > Math.abs(p.spread)) pHomeSpread+=pr;
    if(a-h > Math.abs(p.spread)) pAwaySpread+=pr;
  }
  const prob2ml = p => p>=0.5 ? Math.round(-(p/(1-p)*100)) : Math.round((1-p)/p*100);
  console.log(`  Home Spread ${p.spread}: P=${(pHomeSpread*100).toFixed(1)}% → ${prob2ml(pHomeSpread)}`);
  console.log(`  Away Spread ${-p.spread}: P=${(pAwaySpread*100).toFixed(1)}% → ${prob2ml(pAwaySpread)}`);
}
