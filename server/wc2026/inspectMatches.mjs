import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

const MATCH_IDS = ['760487','760489','760488','760486'];
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n══════════════════════════════════════════════════════════');
console.log('  WC2026 ESPN MATCH DB INSPECTION — All 4 Matches');
console.log('══════════════════════════════════════════════════════════\n');

// ── MATCHES TABLE ─────────────────────────────────────────────────────────────
const [matchRows] = await conn.execute(
  `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev, homeScore, awayScore,
          matchDateUtc, statusState, statusDetail, venue, city, attendance, referee,
          homeFormation, awayFormation, scrapeVersion, updatedAt
   FROM wc2026_espn_matches WHERE matchId IN (?,?,?,?) ORDER BY matchDateUtc`,
  MATCH_IDS
);
console.log('─── wc2026_espn_matches ─────────────────────────────────');
for (const r of matchRows) {
  const dt = new Date(Number(r.matchDateUtc));
  const etStr = dt.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  console.log(`[${r.matchId}] ${r.homeTeamAbbrev} ${r.homeScore}-${r.awayScore} ${r.awayTeamAbbrev}`);
  console.log(`  matchDateUtc: ${r.matchDateUtc} → ${dt.toISOString()} (ET: ${etStr})`);
  console.log(`  venue: "${r.venue}" | city: "${r.city}" | attendance: ${r.attendance}`);
  console.log(`  referee: "${r.referee}" | status: ${r.statusState}/${r.statusDetail}`);
  console.log(`  formations: H=${r.homeFormation} A=${r.awayFormation} | scrapeVersion: ${r.scrapeVersion}`);
  console.log(`  updatedAt: ${new Date(Number(r.updatedAt)).toISOString()}`);
}

// ── ROW COUNTS PER TABLE ──────────────────────────────────────────────────────
const tables = [
  'wc2026_espn_match_odds',
  'wc2026_espn_team_stats',
  'wc2026_espn_match_stats',
  'wc2026_espn_expected_goals',
  'wc2026_espn_shot_map',
  'wc2026_espn_player_stats',
  'wc2026_espn_lineups',
  'wc2026_espn_glossary',
];

console.log('\n─── Row Counts Per Table ────────────────────────────────');
console.log('Table'.padEnd(35) + MATCH_IDS.map(id => id.padStart(8)).join(''));
for (const tbl of tables) {
  const counts = [];
  for (const mid of MATCH_IDS) {
    const [[row]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM ${tbl} WHERE matchId=?`, [mid]);
    counts.push(String(row.cnt).padStart(8));
  }
  console.log(tbl.padEnd(35) + counts.join(''));
}

// ── MATCH STATS CATEGORY COMPLETENESS ────────────────────────────────────────
console.log('\n─── Match Stats Category Completeness ───────────────────');
const statCols = {
  'SHOTS':    ['homeShotsTotal','homeOnTarget','homeOffTarget','homeBlocked'],
  'PASSES':   ['homePassesTotal','homePassAccuracy','homeLongBalls'],
  'ATTACK':   ['homeDribbles','homeBigChances','homeCorners'],
  'EXPECTED': ['homeXg','awayXg'],
  'GK':       ['homeGkSaves','homeGkSavePct','homeGkGoalsAllowed'],
  'DEFENSE':  ['homeTackles','homeInterceptions','homeClearances'],
  'DUELS':    ['homeDuelsWon','homeDuelsTotal','homeDuelsWonPct'],
  'FOULS':    ['homeFoulsCommitted','homeYellowCards','homeRedCards'],
};
const [[msRow]] = await conn.execute(
  `SELECT matchId, ${Object.values(statCols).flat().join(',')} FROM wc2026_espn_match_stats WHERE matchId IN (?,?,?,?)`,
  MATCH_IDS
);
// Just check nulls per match
for (const mid of MATCH_IDS) {
  const [[ms]] = await conn.execute(
    `SELECT ${Object.values(statCols).flat().join(',')} FROM wc2026_espn_match_stats WHERE matchId=?`,
    [mid]
  );
  if (!ms) { console.log(`[${mid}] NO match_stats row!`); continue; }
  const nullFields = Object.entries(ms).filter(([k,v]) => v === null).map(([k]) => k);
  if (nullFields.length === 0) {
    console.log(`[${mid}] ✅ All stat categories populated (0 nulls)`);
  } else {
    console.log(`[${mid}] ⚠️  ${nullFields.length} null fields: ${nullFields.join(', ')}`);
  }
}

// ── SHOT MAP COORDINATE VALIDATION ───────────────────────────────────────────
console.log('\n─── Shot Map Coordinate Validation ─────────────────────');
for (const mid of MATCH_IDS) {
  const [[smStats]] = await conn.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN x IS NULL OR y IS NULL THEN 1 ELSE 0 END) AS nullCoords,
            SUM(CASE WHEN x < 0 OR x > 100 OR y < 0 OR y > 100 THEN 1 ELSE 0 END) AS outOfRange,
            SUM(CASE WHEN outcome='goal' THEN 1 ELSE 0 END) AS goals,
            SUM(CASE WHEN outcome='savedShot' THEN 1 ELSE 0 END) AS saves,
            SUM(CASE WHEN outcome='blockedShot' THEN 1 ELSE 0 END) AS blocked,
            SUM(CASE WHEN outcome='missedShots' THEN 1 ELSE 0 END) AS missed
     FROM wc2026_espn_shot_map WHERE matchId=?`,
    [mid]
  );
  console.log(`[${mid}] shots=${smStats.total} | goals=${smStats.goals} saves=${smStats.saves} blocked=${smStats.blocked} missed=${smStats.missed} | nullCoords=${smStats.nullCoords} outOfRange=${smStats.outOfRange}`);
}

// ── LINEUPS VALIDATION ────────────────────────────────────────────────────────
console.log('\n─── Lineups Validation ──────────────────────────────────');
for (const mid of MATCH_IDS) {
  const [[lu]] = await conn.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN role='starter' THEN 1 ELSE 0 END) AS starters,
            SUM(CASE WHEN role='substitute' THEN 1 ELSE 0 END) AS subs,
            SUM(CASE WHEN role='unused' THEN 1 ELSE 0 END) AS unused,
            SUM(CASE WHEN name IS NULL OR name='' THEN 1 ELSE 0 END) AS nullNames,
            SUM(CASE WHEN position IS NULL OR position='' THEN 1 ELSE 0 END) AS nullPos
     FROM wc2026_espn_lineups WHERE matchId=?`,
    [mid]
  );
  const starterCheck = lu.starters === 22 ? '✅' : `⚠️ (${lu.starters}/22)`;
  console.log(`[${mid}] total=${lu.total} | starters=${lu.starters}${starterCheck} subs=${lu.subs} unused=${lu.unused} | nullNames=${lu.nullNames} nullPos=${lu.nullPos}`);
}

// ── PLAYER STATS VALIDATION ───────────────────────────────────────────────────
console.log('\n─── Player Stats Validation ─────────────────────────────');
for (const mid of MATCH_IDS) {
  const [[ps]] = await conn.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN teamSide='home' THEN 1 ELSE 0 END) AS homePlayers,
            SUM(CASE WHEN teamSide='away' THEN 1 ELSE 0 END) AS awayPlayers,
            SUM(CASE WHEN isGk=1 THEN 1 ELSE 0 END) AS gks,
            SUM(CASE WHEN name IS NULL OR name='' THEN 1 ELSE 0 END) AS nullNames
     FROM wc2026_espn_player_stats WHERE matchId=?`,
    [mid]
  );
  console.log(`[${mid}] total=${ps.total} | home=${ps.homePlayers} away=${ps.awayPlayers} gks=${ps.gks} | nullNames=${ps.nullNames}`);
}

// ── EXPECTED GOALS ────────────────────────────────────────────────────────────
console.log('\n─── Expected Goals ──────────────────────────────────────');
const [xgRows] = await conn.execute(
  `SELECT matchId, homeXg, awayXg, homeXgFirstHalf, awayXgFirstHalf, homeXgSecondHalf, awayXgSecondHalf
   FROM wc2026_espn_expected_goals WHERE matchId IN (?,?,?,?) ORDER BY matchId`,
  MATCH_IDS
);
for (const r of xgRows) {
  const hxg = parseFloat(r.homeXg);
  const axg = parseFloat(r.awayXg);
  const valid = hxg >= 0 && hxg <= 5 && axg >= 0 && axg <= 5;
  console.log(`[${r.matchId}] homeXg=${r.homeXg} awayXg=${r.awayXg} | H1: ${r.homeXgFirstHalf}/${r.awayXgFirstHalf} H2: ${r.homeXgSecondHalf}/${r.awayXgSecondHalf} ${valid ? '✅' : '⚠️'}`);
}

// ── TEAM STATS VALIDATION ─────────────────────────────────────────────────────
console.log('\n─── Team Stats Validation ───────────────────────────────');
const [tsRows] = await conn.execute(
  `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
          homePossession, awayPossession,
          homeShots, awayShots,
          homeGoals, awayGoals,
          homeFouls, awayFouls,
          homeYellowCards, awayYellowCards,
          homeRedCards, awayRedCards,
          homeOffsides, awayOffsides,
          homeCorners, awayCorners
   FROM wc2026_espn_team_stats WHERE matchId IN (?,?,?,?) ORDER BY matchId`,
  MATCH_IDS
);
for (const r of tsRows) {
  const possSum = parseFloat(r.homePossession ?? 0) + parseFloat(r.awayPossession ?? 0);
  const possOk = Math.abs(possSum - 100) < 1;
  console.log(`[${r.matchId}] ${r.homeTeamAbbrev} vs ${r.awayTeamAbbrev}`);
  console.log(`  poss: ${r.homePossession}/${r.awayPossession} (sum=${possSum.toFixed(1)} ${possOk ? '✅' : '⚠️'}) | shots: ${r.homeShots}/${r.awayShots} | goals: ${r.homeGoals}/${r.awayGoals}`);
  console.log(`  fouls: ${r.homeFouls}/${r.awayFouls} | YC: ${r.homeYellowCards}/${r.awayYellowCards} | RC: ${r.homeRedCards}/${r.awayRedCards} | corners: ${r.homeCorners}/${r.awayCorners}`);
}

// ── ODDS TABLE ────────────────────────────────────────────────────────────────
console.log('\n─── Odds Table ──────────────────────────────────────────');
const [oddsRows] = await conn.execute(
  `SELECT matchId, provider, homeOdds, drawOdds, awayOdds, overUnder, homeSpread
   FROM wc2026_espn_match_odds WHERE matchId IN (?,?,?,?) ORDER BY matchId`,
  MATCH_IDS
);
for (const r of oddsRows) {
  console.log(`[${r.matchId}] provider=${r.provider} | H=${r.homeOdds} D=${r.drawOdds} A=${r.awayOdds} | OU=${r.overUnder} spread=${r.homeSpread}`);
}

// ── GLOSSARY ──────────────────────────────────────────────────────────────────
console.log('\n─── Glossary ────────────────────────────────────────────');
for (const mid of MATCH_IDS) {
  const [[gl]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM wc2026_espn_glossary WHERE matchId=?`, [mid]);
  console.log(`[${mid}] glossary terms: ${gl.cnt}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  INSPECTION COMPLETE');
console.log('══════════════════════════════════════════════════════════\n');
await conn.end();
