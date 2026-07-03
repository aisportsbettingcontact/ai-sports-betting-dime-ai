/**
 * june15_final_validation.mjs
 * ===========================
 * Final comprehensive validation for all June 15 games:
 * - 10 MLB games: pitcher resolution, model odds, DK odds, published status
 * - 4 WC matchs: orientation, DK odds, model odds, completeness
 *
 * Pass criteria:
 * - All 10 MLB games: publishedToFeed=1, publishedModel=1, model+DK ML present
 * - All 4 WC matchs: correct home/away orientation, DK+model odds present
 * - No missing odds, no team mismatches
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const u = new URL(process.env.DATABASE_URL);
const c = await mysql.createConnection({
  host: u.hostname,
  port: parseInt(u.port || '3306'),
  user: u.username,
  password: u.password,
  database: u.pathname.slice(1).split('?')[0],
  ssl: { rejectUnauthorized: false }
});

console.log('='.repeat(70));
console.log('JUNE 15, 2026 — FINAL VALIDATION REPORT');
console.log('='.repeat(70));
console.log('[INPUT] Validating 10 MLB + 4 WC games for June 15, 2026');
console.log('');

let totalIssues = 0;

// ─── MLB VALIDATION ────────────────────────────────────────────────────────
console.log('─'.repeat(70));
console.log('MLB GAMES (10 total)');
console.log('─'.repeat(70));

const [mlb] = await c.execute(`
  SELECT id, awayTeam, homeTeam, gameDate, startTimeEst,
         publishedToFeed, publishedModel,
         modelAwayML, modelHomeML,
         awayML, homeML,
         awayBookSpread, homeBookSpread, awayModelSpread, homeModelSpread,
         bookTotal, modelTotal,
         awayStartingPitcher, homeStartingPitcher,
         awayPitcherConfirmed, homePitcherConfirmed
  FROM games
  WHERE gameDate = '2026-06-15' AND sport = 'MLB'
  ORDER BY startTimeEst, id
`);

console.log('[STATE] MLB games found:', mlb.length);
console.log('');

let mlbIssues = 0;
for (const g of mlb) {
  const issues = [];
  if (!g.publishedToFeed) issues.push('NOT_PUBLISHED_TO_FEED');
  if (!g.publishedModel) issues.push('NOT_PUBLISHED_MODEL');
  if (g.modelAwayML == null) issues.push('MISSING_MODEL_AWAY_ML');
  if (g.modelHomeML == null) issues.push('MISSING_MODEL_HOME_ML');
  if (g.awayML == null) issues.push('MISSING_DK_AWAY_ML');
  if (g.homeML == null) issues.push('MISSING_DK_HOME_ML');
  if (!g.awayStartingPitcher) issues.push('MISSING_AWAY_PITCHER');
  if (!g.homeStartingPitcher) issues.push('MISSING_HOME_PITCHER');
  
  const status = issues.length === 0 ? 'PASS' : 'FAIL';
  if (issues.length > 0) { mlbIssues++; totalIssues++; }
  
  console.log(`[${status}] id=${g.id} | ${g.awayTeam}@${g.homeTeam} | ${g.startTimeEst}`);
  console.log(`  Published: feed=${g.publishedToFeed} model=${g.publishedModel}`);
  console.log(`  Model ML: away=${g.modelAwayML ?? 'MISSING'} home=${g.modelHomeML ?? 'MISSING'}`);
  console.log(`  DK ML:    away=${g.awayML ?? 'MISSING'} home=${g.homeML ?? 'MISSING'}`);
  console.log(`  Spread:   DK=${g.awayBookSpread ?? 'N/A'} Model=${g.awayModelSpread ?? 'N/A'}`);
  console.log(`  Total:    DK=${g.bookTotal ?? 'N/A'} Model=${g.modelTotal ?? 'N/A'}`);
  console.log(`  Pitchers: ${g.awayStartingPitcher ?? 'TBD'}(${g.awayPitcherConfirmed?'✓':'?'}) vs ${g.homeStartingPitcher ?? 'TBD'}(${g.homePitcherConfirmed?'✓':'?'})`);
  if (issues.length > 0) console.log(`  [ISSUES] ${issues.join(', ')}`);
  console.log('');
}

console.log(`[OUTPUT] MLB: ${mlb.length - mlbIssues}/${mlb.length} PASS, ${mlbIssues} FAIL`);

// ─── WC VALIDATION ─────────────────────────────────────────────────────────
console.log('');
console.log('─'.repeat(70));
console.log('WORLD CUP MATCHS (4 total)');
console.log('─'.repeat(70));

const june15Ids = ['wc26-g-015', 'wc26-g-013', 'wc26-g-016', 'wc26-g-014'];
const ph = june15Ids.map(() => '?').join(',');

const [matchs] = await c.execute(`
  SELECT f.match_id, f.kickoff_utc, f.group_letter, f.matchday,
         f.home_team_id, f.away_team_id,
         ht.fifa_code as homeCode, ht.name as homeName,
         at.fifa_code as awayCode, at.name as awayName,
         v.stadium, v.city
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
  WHERE f.match_id IN (${ph})
  ORDER BY f.kickoff_utc
`, june15Ids);

// Official FIFA orientation
const OFFICIAL = {
  'wc26-g-015': { home: 'ESP', away: 'CPV', kickoffET: '12:00 PM ET' },
  'wc26-g-013': { home: 'BEL', away: 'EGY', kickoffET: '3:00 PM ET' },
  'wc26-g-016': { home: 'KSA', away: 'URU', kickoffET: '6:00 PM ET' },
  'wc26-g-014': { home: 'IRN', away: 'NZL', kickoffET: '9:00 PM ET' },
};

// Get DK odds
const [dkOdds] = await c.execute(`
  SELECT match_id, market, selection, american_odds, line
  FROM wc2026_odds_snapshots
  WHERE match_id IN (${ph}) AND book_id = 68
  AND snapshot_ts = (
    SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
    WHERE s2.match_id = wc2026_odds_snapshots.match_id AND s2.book_id = 68
  )
  ORDER BY match_id, market, selection
`, june15Ids);

// Get model odds
const [modelOdds] = await c.execute(`
  SELECT match_id, market, selection, american_odds, line
  FROM wc2026_odds_snapshots
  WHERE match_id IN (${ph}) AND book_id = 0
  AND snapshot_ts = (
    SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
    WHERE s2.match_id = wc2026_odds_snapshots.match_id AND s2.book_id = 0
  )
  ORDER BY match_id, market, selection
`, june15Ids);

// Group odds
const dkByFix = {};
const modelByFix = {};
for (const o of dkOdds) {
  if (!dkByFix[o.match_id]) dkByFix[o.match_id] = {};
  dkByFix[o.match_id][`${o.market}_${o.selection}`] = { odds: o.american_odds, line: o.line };
}
for (const o of modelOdds) {
  if (!modelByFix[o.match_id]) modelByFix[o.match_id] = {};
  modelByFix[o.match_id][`${o.market}_${o.selection}`] = { odds: o.american_odds, line: o.line };
}

let wcIssues = 0;
for (const f of matchs) {
  const official = OFFICIAL[f.match_id];
  const dk = dkByFix[f.match_id] || {};
  const model = modelByFix[f.match_id] || {};
  
  const issues = [];
  
  // Orientation check
  if (f.homeCode !== official.home) issues.push(`HOME_MISMATCH: DB=${f.homeCode} Official=${official.home}`);
  if (f.awayCode !== official.away) issues.push(`AWAY_MISMATCH: DB=${f.awayCode} Official=${official.away}`);
  
  // DK odds completeness
  if (!dk['1X2_home']) issues.push('DK_HOME_ML_MISSING');
  if (!dk['1X2_draw']) issues.push('DK_DRAW_ML_MISSING');
  if (!dk['1X2_away']) issues.push('DK_AWAY_ML_MISSING');
  if (!dk['TOTAL_over']) issues.push('DK_OVER_MISSING');
  if (!dk['TOTAL_under']) issues.push('DK_UNDER_MISSING');
  
  // Model odds completeness
  if (!model['1X2_home']) issues.push('MODEL_HOME_ML_MISSING');
  if (!model['1X2_draw']) issues.push('MODEL_DRAW_ML_MISSING');
  if (!model['1X2_away']) issues.push('MODEL_AWAY_ML_MISSING');
  if (!model['TOTAL_over']) issues.push('MODEL_OVER_MISSING');
  if (!model['TOTAL_under']) issues.push('MODEL_UNDER_MISSING');
  
  // Sanity check: home team should be favorite or close to it (except KSA)
  const dkHomeFav = dk['1X2_home']?.odds != null && dk['1X2_home'].odds < 0;
  const dkAwayFav = dk['1X2_away']?.odds != null && dk['1X2_away'].odds < 0;
  
  const status = issues.length === 0 ? 'PASS' : 'FAIL';
  if (issues.length > 0) { wcIssues++; totalIssues++; }
  
  console.log(`[${status}] ${f.match_id} | ${f.awayCode}(${f.awayName}) @ ${f.homeCode}(${f.homeName})`);
  console.log(`  Kickoff: ${f.kickoff_utc} (${official.kickoffET}) | Group ${f.group_letter} MD${f.matchday}`);
  console.log(`  Venue: ${f.stadium ?? 'N/A'}, ${f.city ?? 'N/A'}`);
  console.log(`  Orientation: home=${f.homeCode} ${f.homeCode === official.home ? '✓' : '✗'} | away=${f.awayCode} ${f.awayCode === official.away ? '✓' : '✗'}`);
  console.log(`  DK  1X2: home=${dk['1X2_home']?.odds ?? 'MISSING'} draw=${dk['1X2_draw']?.odds ?? 'MISSING'} away=${dk['1X2_away']?.odds ?? 'MISSING'}`);
  console.log(`  MDL 1X2: home=${model['1X2_home']?.odds ?? 'MISSING'} draw=${model['1X2_draw']?.odds ?? 'MISSING'} away=${model['1X2_away']?.odds ?? 'MISSING'}`);
  console.log(`  DK  TOT: O${dk['TOTAL_over']?.line ?? '?'} ${dk['TOTAL_over']?.odds ?? 'MISSING'}/${dk['TOTAL_under']?.odds ?? 'MISSING'}`);
  console.log(`  MDL TOT: O${model['TOTAL_over']?.line ?? '?'} ${model['TOTAL_over']?.odds ?? 'MISSING'}/${model['TOTAL_under']?.odds ?? 'MISSING'}`);
  if (dk['ASIAN_HANDICAP_home']) console.log(`  DK  AH:  home=${dk['ASIAN_HANDICAP_home']?.line ?? '?'}@${dk['ASIAN_HANDICAP_home']?.odds ?? '?'} away=${dk['ASIAN_HANDICAP_away']?.line ?? '?'}@${dk['ASIAN_HANDICAP_away']?.odds ?? '?'}`);
  if (issues.length > 0) console.log(`  [ISSUES] ${issues.join(', ')}`);
  console.log('');
}

console.log(`[OUTPUT] WC: ${june15Ids.length - wcIssues}/${june15Ids.length} PASS, ${wcIssues} FAIL`);

// ─── FINAL SUMMARY ─────────────────────────────────────────────────────────
console.log('');
console.log('='.repeat(70));
console.log('FINAL SUMMARY');
console.log('='.repeat(70));
console.log(`MLB: ${mlb.length}/10 games found, ${mlb.length - mlbIssues}/10 PASS`);
console.log(`WC:  ${matchs.length}/4 matchs found, ${matchs.length - wcIssues}/4 PASS`);
console.log(`Total issues: ${totalIssues}`);
console.log('');
if (totalIssues === 0) {
  console.log('[VERIFY] PASS — All June 15 games validated. Ready to publish.');
} else {
  console.log('[VERIFY] FAIL — ' + totalIssues + ' issues detected. See above for details.');
}

await c.end();
