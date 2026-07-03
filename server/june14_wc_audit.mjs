/**
 * JUNE 14, 2026 — WC2026 FIXTURE AUDIT (confirmed column names)
 * wc2026_matches: match_id, match_date, kickoff_utc, group_letter, home_team_id, away_team_id
 * wc2026_teams: team_id, name, fifa_code, group_letter, flag_code, flag_url, slug
 * wc2026_odds_snapshots: id, match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname, port: parseInt(u.port || '3306'),
    user: u.username, password: u.password,
    database: u.pathname.slice(1).split('?')[0],
    ssl: { rejectUnauthorized: false }
  };
}

const conn = await mysql.createConnection(parseDbUrl(DB_URL));

console.log('\n' + '='.repeat(80));
console.log('[WC2026] JUNE 14, 2026 — WC2026 FIXTURE AUDIT');
console.log('='.repeat(80));

const [wcFixtures] = await conn.execute(`
  SELECT 
    f.match_id AS id, 
    f.match_date AS matchDate, 
    f.kickoff_utc AS kickoffUtc, 
    f.group_letter AS groupLetter,
    ht.name AS homeName, 
    ht.team_id AS homeId,
    at.name AS awayName, 
    at.team_id AS awayId,
    f.home_team_id AS homeTeamId, 
    f.away_team_id AS awayTeamId
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_date = '2026-06-14'
  ORDER BY f.kickoff_utc ASC
`);

console.log(`[WC2026] Found ${wcFixtures.length} fixtures for June 14\n`);

const wcIssues = [];
let wcClean = 0;

for (const f of wcFixtures) {
  // Get DK odds (book_id=68) — latest snapshot per market+selection
  const [dkOdds] = await conn.execute(`
    SELECT market, selection, american_odds AS price, snapshot_ts AS snapshotTs
    FROM wc2026_odds_snapshots
    WHERE match_id = ? AND book_id = 68
    ORDER BY snapshot_ts DESC
    LIMIT 30
  `, [f.id]);

  // Get model odds (book_id=0) — latest snapshot per market+selection
  const [modelOdds] = await conn.execute(`
    SELECT market, selection, american_odds AS price, snapshot_ts AS snapshotTs
    FROM wc2026_odds_snapshots
    WHERE match_id = ? AND book_id = 0
    ORDER BY snapshot_ts DESC
    LIMIT 30
  `, [f.id]);

  // Deduplicate by market+selection (latest only)
  const dkMap = {};
  for (const o of dkOdds) {
    const key = `${o.market}:${o.selection}`;
    if (!dkMap[key]) dkMap[key] = o;
  }
  const modelMap = {};
  for (const o of modelOdds) {
    const key = `${o.market}:${o.selection}`;
    if (!modelMap[key]) modelMap[key] = o;
  }

  const dkHomeML = dkMap['1X2:home']?.price;
  const dkDrawML = dkMap['1X2:draw']?.price;
  const dkAwayML = dkMap['1X2:away']?.price;
  const modelHomeML = modelMap['1X2:home']?.price;
  const modelDrawML = modelMap['1X2:draw']?.price;
  const modelAwayML = modelMap['1X2:away']?.price;

  const hasDk1x2 = dkHomeML !== undefined && dkDrawML !== undefined && dkAwayML !== undefined;
  const hasDkTotal = dkMap['TOTAL:over'] !== undefined && dkMap['TOTAL:under'] !== undefined;
  const hasModel1x2 = modelHomeML !== undefined && modelDrawML !== undefined && modelAwayML !== undefined;
  const hasModelTotal = modelMap['TOTAL:over'] !== undefined && modelMap['TOTAL:under'] !== undefined;

  // Direction check: model home odds should be consistent with team strength
  let directionNote = '';
  if (hasModel1x2) {
    const homeOdds = parseInt(modelHomeML);
    const awayOdds = parseInt(modelAwayML);
    // If home is favorite (negative odds), home should have lower abs value than away
    const homeFav = homeOdds < awayOdds;
    directionNote = `home(${f.homeId})=${homeOdds > 0 ? '+' : ''}${homeOdds} ${homeFav ? 'FAVORITE' : 'UNDERDOG'} vs away(${f.awayId})=${awayOdds > 0 ? '+' : ''}${awayOdds}`;
  }

  const issues = [];
  if (!hasDk1x2) issues.push('NO_DK_1X2');
  if (!hasDkTotal) issues.push('NO_DK_TOTAL');
  if (!hasModel1x2) issues.push('NO_MODEL_1X2');
  if (!hasModelTotal) issues.push('NO_MODEL_TOTAL');

  const statusStr = issues.length === 0 ? '✓ CLEAN' : '✗ ' + issues.join(', ');
  if (issues.length === 0) wcClean++;

  const fmtOdds = (v) => v === undefined ? '—' : (v > 0 ? `+${v}` : `${v}`);

  console.log(`[WC][${f.id}] Group ${f.groupLetter}: ${f.homeId.toUpperCase()} (home) vs ${f.awayId.toUpperCase()} (away)`);
  console.log(`  Kickoff: ${f.kickoffUtc} | Home: ${f.homeName} | Away: ${f.awayName}`);
  console.log(`  DK 1X2:    home(${f.homeId})=${fmtOdds(dkHomeML)} draw=${fmtOdds(dkDrawML)} away(${f.awayId})=${fmtOdds(dkAwayML)}`);
  console.log(`  DK Total:  over=${fmtOdds(dkMap['TOTAL:over']?.price)} under=${fmtOdds(dkMap['TOTAL:under']?.price)}`);
  console.log(`  Model 1X2: home(${f.homeId})=${fmtOdds(modelHomeML)} draw=${fmtOdds(modelDrawML)} away(${f.awayId})=${fmtOdds(modelAwayML)}`);
  console.log(`  Model Total: over=${fmtOdds(modelMap['TOTAL:over']?.price)} under=${fmtOdds(modelMap['TOTAL:under']?.price)}`);
  if (directionNote) console.log(`  Direction: ${directionNote}`);
  console.log(`  STATUS: ${statusStr}`);
  console.log('');

  if (issues.length > 0) {
    wcIssues.push({ id: f.id, home: f.homeId, away: f.awayId, issues });
  }
}

console.log(`[WC2026] SUMMARY: ${wcFixtures.length} fixtures | ${wcClean} CLEAN | ${wcIssues.length} WITH ISSUES`);
if (wcIssues.length > 0) {
  console.log('[WC2026] ISSUES:');
  for (const i of wcIssues) {
    console.log(`  [${i.id}] ${i.home} vs ${i.away}: ${i.issues.join(', ')}`);
  }
}

console.log('\n[WC2026 AUDIT COMPLETE]');
await conn.end();
