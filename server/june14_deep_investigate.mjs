import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const u = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: parseInt(u.port || '3306'),
  user: u.username,
  password: u.password,
  database: u.pathname.slice(1).split('?')[0],
  ssl: { rejectUnauthorized: false }
});

// ─── 1. Full model data for all 4 flagged games ───────────────────────────────
const [games] = await conn.execute(`
  SELECT awayTeam, homeTeam, awayStartingPitcher, homeStartingPitcher,
         awayML, homeML, modelAwayML, modelHomeML,
         modelAwayWinPct, modelHomeWinPct, modelAwayScore, modelHomeScore,
         modelRunAt, venue
  FROM games
  WHERE gameDate='2026-06-14'
  AND ((awayTeam='ARI' AND homeTeam='CIN')
    OR (awayTeam='ATL' AND homeTeam='NYM')
    OR (awayTeam='LAD' AND homeTeam='CWS')
    OR (awayTeam='PHI' AND homeTeam='MIL'))
  ORDER BY awayTeam
`);

console.log('\n========== GAME MODEL DATA ==========');
for (const g of games) {
  const dkFavors = (g.awayML < 0 && g.homeML > 0) ? g.awayTeam : (g.homeML < 0 && g.awayML > 0) ? g.homeTeam : 'PUSH';
  const modelFavors = (g.modelAwayML < 0 && g.modelHomeML > 0) ? g.awayTeam : (g.modelHomeML < 0 && g.modelAwayML > 0) ? g.homeTeam : 'PUSH';
  const agree = dkFavors === modelFavors ? '✓ AGREE' : '✗ DISAGREE';
  console.log(`\n=== ${g.awayTeam} @ ${g.homeTeam} ===`);
  console.log(`  Venue: ${g.venue}`);
  console.log(`  Pitchers: away=${g.awayStartingPitcher} | home=${g.homeStartingPitcher}`);
  console.log(`  DK ML:    away=${g.awayML} home=${g.homeML} → DK favors: ${dkFavors}`);
  console.log(`  Model ML: away=${g.modelAwayML} home=${g.modelHomeML} → Model favors: ${modelFavors}`);
  console.log(`  Agreement: ${agree}`);
  console.log(`  Model Win%: away=${g.modelAwayWinPct}% home=${g.modelHomeWinPct}%`);
  console.log(`  Proj Score: away=${g.modelAwayScore} home=${g.modelHomeScore}`);
  console.log(`  Model ran at: ${g.modelRunAt}`);
}

// ─── 2. Pitcher stats for all 8 pitchers ─────────────────────────────────────
const pitchers = [
  'Zac Gallen', 'Hunter Greene',
  'Chris Sale', 'Sean Manaea',
  'Emmet Sheehan', 'Bryan Hudson',
  'Cristopher Sánchez', 'Kyle Harrison'
];

const placeholders = pitchers.map(() => '?').join(',');
const [ps] = await conn.execute(
  `SELECT fullName, teamAbbrev, era, k9, bb9, fip, xfip, whip, ip, gamesStarted, lastFetchedAt
   FROM mlb_pitcher_stats
   WHERE fullName IN (${placeholders})
   ORDER BY fullName`,
  pitchers
);

console.log('\n========== PITCHER SEASON STATS ==========');
if (ps.length === 0) {
  console.log('  [WARN] No pitcher stats found — check exact name spelling');
} else {
  for (const p of ps) {
    console.log(`  ${p.fullName} (${p.teamAbbrev}): ERA=${p.era} FIP=${p.fip} xFIP=${p.xfip} K/9=${p.k9} BB/9=${p.bb9} WHIP=${p.whip} IP=${p.ip} GS=${p.gamesStarted} | fetched=${p.lastFetchedAt}`);
  }
}

// ─── 3. Rolling-5 stats ───────────────────────────────────────────────────────
const [pr] = await conn.execute(
  `SELECT fullName, teamAbbrev, era5, k9_5, bb9_5, whip5, fip5, startsIncluded, lastStartDate, lastFetchedAt
   FROM mlb_pitcher_rolling5
   WHERE fullName IN (${placeholders})
   ORDER BY fullName`,
  pitchers
);

console.log('\n========== PITCHER ROLLING-5 STATS ==========');
if (pr.length === 0) {
  console.log('  [WARN] No rolling-5 stats found');
} else {
  for (const p of pr) {
    console.log(`  ${p.fullName} (${p.teamAbbrev}): ERA5=${p.era5} FIP5=${p.fip5} K9_5=${p.k9_5} BB9_5=${p.bb9_5} WHIP5=${p.whip5} Starts=${p.startsIncluded} LastStart=${p.lastStartDate} | fetched=${p.lastFetchedAt}`);
  }
}

// ─── 4. Check for name variants in DB (fuzzy search) ─────────────────────────
console.log('\n========== FUZZY PITCHER NAME SEARCH ==========');
const searchTerms = ['Sanchez', 'Sánchez', 'Gallen', 'Greene', 'Sale', 'Manaea', 'Sheehan', 'Hudson', 'Harrison'];
for (const term of searchTerms) {
  const [rows] = await conn.execute(
    `SELECT fullName, teamAbbrev, era FROM mlb_pitcher_stats WHERE fullName LIKE ? LIMIT 3`,
    [`%${term}%`]
  );
  if (rows.length > 0) {
    console.log(`  "${term}" → ${rows.map(r => `${r.fullName}(${r.teamAbbrev}) ERA=${r.era}`).join(' | ')}`);
  } else {
    console.log(`  "${term}" → NOT FOUND`);
  }
}

// ─── 5. Check batting splits for teams in these games ─────────────────────────
const teams = ['ARI', 'CIN', 'ATL', 'NYM', 'LAD', 'CWS', 'PHI', 'MIL'];
const teamPlaceholders = teams.map(() => '?').join(',');

// Check if mlb_batting_splits table exists
const [tables] = await conn.execute(`SHOW TABLES LIKE 'mlb_batting_splits'`);
if (tables.length > 0) {
  const [splits] = await conn.execute(
    `SELECT teamAbbrev, wRC_plus, wOBA, OPS, runsPerGame FROM mlb_batting_splits WHERE teamAbbrev IN (${teamPlaceholders}) ORDER BY teamAbbrev`,
    teams
  );
  console.log('\n========== BATTING SPLITS (wRC+) ==========');
  for (const s of splits) {
    console.log(`  ${s.teamAbbrev}: wRC+=${s.wRC_plus} wOBA=${s.wOBA} OPS=${s.OPS} R/G=${s.runsPerGame}`);
  }
} else {
  // Try alternate table name
  const [tables2] = await conn.execute(`SHOW TABLES LIKE '%batting%'`);
  console.log('\n========== BATTING TABLES ==========');
  console.log('  Found:', tables2.map(t => Object.values(t)[0]).join(', ') || 'NONE');
}

// ─── 6. Check park factors ────────────────────────────────────────────────────
const [pfTables] = await conn.execute(`SHOW TABLES LIKE '%park%'`);
if (pfTables.length > 0) {
  const pfTable = Object.values(pfTables[0])[0];
  const [pf] = await conn.execute(
    `SELECT * FROM ${pfTable} WHERE teamAbbrev IN (${teamPlaceholders}) ORDER BY teamAbbrev`,
    teams
  );
  console.log(`\n========== PARK FACTORS (${pfTable}) ==========`);
  for (const p of pf) {
    console.log(`  ${JSON.stringify(p)}`);
  }
} else {
  console.log('\n[INFO] No park factor table found');
}

await conn.end();
console.log('\n[DONE] Investigation complete.');
