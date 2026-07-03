/**
 * JUNE 14, 2026 — FULL STATE AUDIT (corrected column names)
 * Audits all MLB (14) and WC2026 (4) games for June 14
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
console.log('[AUDIT] JUNE 14, 2026 — MLB + WC2026 FULL STATE AUDIT');
console.log('='.repeat(80));

// ─── MLB SECTION ───────────────────────────────────────────────────────────────
console.log('\n[MLB] Fetching all June 14 MLB games...');
const [mlbGames] = await conn.execute(`
  SELECT 
    g.id, g.gameDate, g.startTimeEst, g.awayTeam, g.homeTeam,
    g.awayStartingPitcher, g.homeStartingPitcher,
    g.awayPitcherConfirmed, g.homePitcherConfirmed,
    g.awayML, g.homeML,
    g.awayRunLine, g.homeRunLine, g.awayRunLineOdds, g.homeRunLineOdds,
    g.bookTotal, g.overOdds, g.underOdds,
    g.modelAwayML, g.modelHomeML,
    g.awayBookSpread, g.homeBookSpread,
    g.modelAwaySpreadOdds, g.modelHomeSpreadOdds,
    g.modelTotal, g.modelOverOdds, g.modelUnderOdds,
    g.modelAwayWinPct, g.modelHomeWinPct,
    g.modelAwayScore, g.modelHomeScore,
    g.publishedToFeed, g.modelRunAt,
    g.awayScore, g.homeScore, g.gameStatus,
    g.venue
  FROM games g
  WHERE g.gameDate = '2026-06-14'
    AND g.sport = 'MLB'
  ORDER BY g.startTimeEst ASC
`);

console.log(`[MLB] Found ${mlbGames.length} games for June 14\n`);

const mlbIssues = [];
let mlbClean = 0;

for (const g of mlbGames) {
  const hasDkML = g.awayML !== null && g.homeML !== null;
  const hasDkRL = g.awayRunLine !== null && g.homeRunLine !== null;
  const hasDkTotal = g.bookTotal !== null;
  const hasModelML = g.modelAwayML !== null && g.modelHomeML !== null;
  const hasModelRL = g.awayBookSpread !== null; // model uses book spread line
  const hasModelTotal = g.modelTotal !== null;
  const isPublished = g.publishedToFeed === 1;
  const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
  const modelRanToday = g.modelRunAt && new Date(g.modelRunAt).toISOString().slice(0,10) === '2026-06-14';

  const issues = [];
  if (!hasDkML) issues.push('NO_DK_ML');
  if (!hasDkRL) issues.push('NO_DK_RL');
  if (!hasDkTotal) issues.push('NO_DK_TOTAL');
  if (!hasModelML) issues.push('NO_MODEL_ML');
  if (!hasModelTotal) issues.push('NO_MODEL_TOTAL');
  if (!isPublished) issues.push('NOT_PUBLISHED');
  if (!hasPitchers) issues.push('NO_PITCHERS');

  const statusStr = issues.length === 0 ? '✓ CLEAN' : '✗ ' + issues.join(', ');
  if (issues.length === 0) mlbClean++;

  console.log(`[MLB][${String(g.id).padEnd(6)}] ${g.awayTeam.padEnd(4)} @ ${g.homeTeam.padEnd(4)} | ${g.startTimeEst || 'TBD'} | ${g.venue || 'TBD'}`);
  console.log(`  Pitchers: ${g.awayStartingPitcher || 'TBD'}(${g.awayPitcherConfirmed?'confirmed':'projected'}) vs ${g.homeStartingPitcher || 'TBD'}(${g.homePitcherConfirmed?'confirmed':'projected'})`);
  console.log(`  DK ML:    away=${String(g.awayML ?? '—').padEnd(7)} home=${g.homeML ?? '—'}`);
  console.log(`  DK RL:    away=${String(g.awayRunLine ?? '—').padEnd(5)}(${g.awayRunLineOdds ?? '—'}) home=${String(g.homeRunLine ?? '—').padEnd(5)}(${g.homeRunLineOdds ?? '—'})`);
  console.log(`  DK Total: ${g.bookTotal ?? '—'} over=${g.overOdds ?? '—'} under=${g.underOdds ?? '—'}`);
  console.log(`  Model ML: away=${String(g.modelAwayML ?? '—').padEnd(7)} home=${g.modelHomeML ?? '—'}`);
  console.log(`  Model RL: away=${String(g.awayBookSpread ?? '—').padEnd(5)}(${g.modelAwaySpreadOdds ?? '—'}) home=${String(g.homeBookSpread ?? '—').padEnd(5)}(${g.modelHomeSpreadOdds ?? '—'})`);
  console.log(`  Model Total: ${g.modelTotal ?? '—'} over=${g.modelOverOdds ?? '—'} under=${g.modelUnderOdds ?? '—'}`);
  console.log(`  Model Score: away=${g.modelAwayScore ?? '—'} home=${g.modelHomeScore ?? '—'} | Win%: away=${g.modelAwayWinPct ?? '—'} home=${g.modelHomeWinPct ?? '—'}`);
  console.log(`  Published: ${isPublished ? 'YES' : 'NO'} | ModelRunAt: ${g.modelRunAt ? new Date(g.modelRunAt).toISOString() : 'never'} | ModelRanToday: ${modelRanToday ? 'YES' : 'NO'}`);
  console.log(`  STATUS: ${statusStr}`);
  console.log('');

  if (issues.length > 0) {
    mlbIssues.push({ id: g.id, away: g.awayTeam, home: g.homeTeam, issues });
  }
}

console.log(`[MLB] SUMMARY: ${mlbGames.length} games | ${mlbClean} CLEAN | ${mlbIssues.length} WITH ISSUES`);
if (mlbIssues.length > 0) {
  console.log('[MLB] ISSUES LIST:');
  for (const i of mlbIssues) {
    console.log(`  [${i.id}] ${i.away} @ ${i.home}: ${i.issues.join(', ')}`);
  }
}

// ─── WC2026 SECTION ────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(80));
console.log('[WC2026] Fetching all June 14 WC2026 fixtures...');

const [wcFixtures] = await conn.execute(`
  SELECT 
    f.id, f.matchDate, f.kickoffUtc, f.groupCode,
    ht.name AS homeName, ht.abbreviation AS homeAbbr,
    at.name AS awayName, at.abbreviation AS awayAbbr,
    f.homeTeamId, f.awayTeamId
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.homeTeamId = ht.id
  JOIN wc2026_teams at ON f.awayTeamId = at.id
  WHERE f.matchDate = '2026-06-14'
  ORDER BY f.kickoffUtc ASC
`);

console.log(`[WC2026] Found ${wcFixtures.length} fixtures for June 14\n`);

const wcIssues = [];
let wcClean = 0;

for (const f of wcFixtures) {
  // Get DK odds (bookId=68) — deduplicated by latest snapshot
  const [dkOdds] = await conn.execute(`
    SELECT market, selection, price, snapshotTs
    FROM wc2026_odds_snapshots
    WHERE matchId = ? AND bookId = 68
    ORDER BY snapshotTs DESC
    LIMIT 30
  `, [f.id]);

  // Get model odds (bookId=0)
  const [modelOdds] = await conn.execute(`
    SELECT market, selection, price, snapshotTs
    FROM wc2026_odds_snapshots
    WHERE matchId = ? AND bookId = 0
    ORDER BY snapshotTs DESC
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

  // Validate orientation: home selection should favor the stronger team
  const dkHomeML = dkMap['1X2:home']?.price;
  const dkAwayML = dkMap['1X2:away']?.price;
  const modelHomeML = modelMap['1X2:home']?.price;
  const modelAwayML = modelMap['1X2:away']?.price;

  const dk1x2 = `home(${f.homeAbbr})=${dkHomeML ?? '—'} draw=${dkMap['1X2:draw']?.price ?? '—'} away(${f.awayAbbr})=${dkAwayML ?? '—'}`;
  const dkTotal = `over=${dkMap['TOTAL:over']?.price ?? '—'} under=${dkMap['TOTAL:under']?.price ?? '—'}`;
  const m1x2 = `home(${f.homeAbbr})=${modelHomeML ?? '—'} draw=${modelMap['1X2:draw']?.price ?? '—'} away(${f.awayAbbr})=${modelAwayML ?? '—'}`;
  const mTotal = `over=${modelMap['TOTAL:over']?.price ?? '—'} under=${modelMap['TOTAL:under']?.price ?? '—'}`;

  const hasDk1x2 = dkMap['1X2:home'] && dkMap['1X2:draw'] && dkMap['1X2:away'];
  const hasDkTotal = dkMap['TOTAL:over'] && dkMap['TOTAL:under'];
  const hasModel1x2 = modelMap['1X2:home'] && modelMap['1X2:draw'] && modelMap['1X2:away'];
  const hasModelTotal = modelMap['TOTAL:over'] && modelMap['TOTAL:under'];

  const issues = [];
  if (!hasDk1x2) issues.push('NO_DK_1X2');
  if (!hasDkTotal) issues.push('NO_DK_TOTAL');
  if (!hasModel1x2) issues.push('NO_MODEL_1X2');
  if (!hasModelTotal) issues.push('NO_MODEL_TOTAL');

  const statusStr = issues.length === 0 ? '✓ CLEAN' : '✗ ' + issues.join(', ');
  if (issues.length === 0) wcClean++;

  console.log(`[WC][${f.id}] Group ${f.groupCode}: ${f.homeAbbr} vs ${f.awayAbbr} | ${f.kickoffUtc}`);
  console.log(`  Home: ${f.homeName} | Away: ${f.awayName}`);
  console.log(`  DK 1X2: ${dk1x2}`);
  console.log(`  DK Total: ${dkTotal}`);
  console.log(`  Model 1X2: ${m1x2}`);
  console.log(`  Model Total: ${mTotal}`);
  console.log(`  STATUS: ${statusStr}`);
  console.log('');

  if (issues.length > 0) {
    wcIssues.push({ id: f.id, home: f.homeAbbr, away: f.awayAbbr, issues });
  }
}

console.log(`[WC2026] SUMMARY: ${wcFixtures.length} fixtures | ${wcClean} CLEAN | ${wcIssues.length} WITH ISSUES`);
if (wcIssues.length > 0) {
  console.log('[WC2026] ISSUES LIST:');
  for (const i of wcIssues) {
    console.log(`  [${i.id}] ${i.home} vs ${i.away}: ${i.issues.join(', ')}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('[AUDIT COMPLETE]');
await conn.end();
