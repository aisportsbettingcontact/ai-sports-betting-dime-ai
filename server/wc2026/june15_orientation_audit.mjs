/**
 * june15_orientation_audit.mjs
 * Verifies June 15 WC match home/away orientation against official FIFA schedule
 * and validates all DK + Model odds are correctly mapped to home/away teams
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

console.log('[INPUT] June 15 WC Match Orientation + Odds Audit');
console.log('[STEP] Verifying DB orientation vs Official FIFA WC2026 Schedule');
console.log('');

// Official FIFA WC2026 June 15 schedule
// Source: FIFA.com official match schedule
// Format: home = team listed first in official schedule (designated home team)
const OFFICIAL = {
  'wc26-g-015': { home: 'ESP', away: 'CPV', homeTeam: 'Spain', awayTeam: 'Cape Verde', kickoffET: '12:00 PM ET', venue: 'Atlanta' },
  'wc26-g-013': { home: 'BEL', away: 'EGY', homeTeam: 'Belgium', awayTeam: 'Egypt', kickoffET: '3:00 PM ET', venue: 'Seattle' },
  'wc26-g-016': { home: 'KSA', away: 'URU', homeTeam: 'Saudi Arabia', awayTeam: 'Uruguay', kickoffET: '6:00 PM ET', venue: 'Miami Gardens' },
  'wc26-g-014': { home: 'IRN', away: 'NZL', homeTeam: 'Iran', awayTeam: 'New Zealand', kickoffET: '9:00 PM ET', venue: 'Inglewood' },
};

// Step 1: Get match orientation from DB
const [fx] = await c.execute(`
  SELECT f.match_id, f.match_date, f.kickoff_utc, f.group_letter, f.matchday,
         f.away_team_id, f.home_team_id,
         t1.name as awayName, t1.fifa_code as awayCode,
         t2.name as homeName, t2.fifa_code as homeCode,
         v.stadium, v.city
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams t1 ON f.away_team_id = t1.team_id
  LEFT JOIN wc2026_teams t2 ON f.home_team_id = t2.team_id
  LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
  WHERE f.match_date = '2026-06-15'
  ORDER BY f.kickoff_utc
`);

console.log('[STATE] Matchs found in DB for June 15:', fx.length);
console.log('');

let orientationPasses = 0;
let orientationFails = 0;

for (const f of fx) {
  const official = OFFICIAL[f.match_id];
  if (!official) {
    console.log('[WARN] No official data for', f.match_id);
    continue;
  }
  const homeMatch = f.homeCode === official.home;
  const awayMatch = f.awayCode === official.away;
  const status = (homeMatch && awayMatch) ? 'PASS' : 'FAIL';
  if (homeMatch && awayMatch) orientationPasses++;
  else orientationFails++;
  
  console.log(`[VERIFY] ${status} ${f.match_id} | DB: away=${f.awayCode}(${f.awayName}) home=${f.homeCode}(${f.homeName}) | Official: away=${official.away}(${official.awayTeam}) home=${official.home}(${official.homeTeam})`);
  if (!homeMatch) console.log(`  [ERROR] HOME MISMATCH: DB=${f.homeCode} Official=${official.home}`);
  if (!awayMatch) console.log(`  [ERROR] AWAY MISMATCH: DB=${f.awayCode} Official=${official.away}`);
  console.log(`  Kickoff UTC: ${f.kickoff_utc} (${official.kickoffET}) | Venue: ${f.stadium}, ${f.city} | Group ${f.group_letter} MD${f.matchday}`);
  console.log('');
}

console.log(`[OUTPUT] Orientation: ${orientationPasses} PASS, ${orientationFails} FAIL`);
console.log('');

// Step 2: Validate DK odds (book_id=68) mapping per match
console.log('[STEP] Validating DK odds (book_id=68) — home/away/draw assignment');
const june15Ids = fx.map(f => f.match_id);
const ph = june15Ids.map(() => '?').join(',');

const [dkOdds] = await c.execute(
  `SELECT match_id, market, selection, american_odds, line
   FROM wc2026_odds_snapshots
   WHERE match_id IN (${ph}) AND book_id = 68
   AND snapshot_ts = (
     SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
     WHERE s2.match_id = wc2026_odds_snapshots.match_id AND s2.book_id = 68
   )
   ORDER BY match_id, market, selection`,
  june15Ids
);

const [modelOdds] = await c.execute(
  `SELECT match_id, market, selection, american_odds, line
   FROM wc2026_odds_snapshots
   WHERE match_id IN (${ph}) AND book_id = 0
   AND snapshot_ts = (
     SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
     WHERE s2.match_id = wc2026_odds_snapshots.match_id AND s2.book_id = 0
   )
   ORDER BY match_id, market, selection`,
  june15Ids
);

// Group by match
const dkByMatch = {};
const modelByMatch = {};
for (const o of dkOdds) {
  if (!dkByMatch[o.match_id]) dkByMatch[o.match_id] = {};
  const key = `${o.market}_${o.selection}`;
  dkByMatch[o.match_id][key] = { odds: o.american_odds, line: o.line };
}
for (const o of modelOdds) {
  if (!modelByMatch[o.match_id]) modelByMatch[o.match_id] = {};
  const key = `${o.market}_${o.selection}`;
  modelByMatch[o.match_id][key] = { odds: o.american_odds, line: o.line };
}

// Build match map for display
const fxMap = {};
for (const f of fx) fxMap[f.match_id] = f;

console.log('');
console.log('[STATE] Full odds matrix for June 15 WC matchs:');
console.log('');

let oddsIssues = 0;
for (const fid of june15Ids) {
  const f = fxMap[fid];
  const dk = dkByMatch[fid] || {};
  const model = modelByMatch[fid] || {};
  const official = OFFICIAL[fid];
  
  console.log(`[MATCH] ${fid} | ${f.awayCode} @ ${f.homeCode} | ${official.kickoffET}`);
  
  // 1X2 odds — home = designated home team, away = designated away team
  const dkHome1X2 = dk['1X2_home']?.odds;
  const dkDraw1X2 = dk['1X2_draw']?.odds;
  const dkAway1X2 = dk['1X2_away']?.odds;
  const modelHome1X2 = model['1X2_home']?.odds;
  const modelDraw1X2 = model['1X2_draw']?.odds;
  const modelAway1X2 = model['1X2_away']?.odds;
  
  const dkTotal = dk['TOTAL_over']?.line;
  const dkOver = dk['TOTAL_over']?.odds;
  const dkUnder = dk['TOTAL_under']?.odds;
  const modelTotal = model['TOTAL_over']?.line;
  const modelOver = model['TOTAL_over']?.odds;
  const modelUnder = model['TOTAL_under']?.odds;
  
  console.log(`  HOME (${f.homeCode}): DK ML=${dkHome1X2 ?? 'MISSING'} | Model ML=${modelHome1X2 ?? 'MISSING'}`);
  console.log(`  DRAW:          DK ML=${dkDraw1X2 ?? 'MISSING'} | Model ML=${modelDraw1X2 ?? 'MISSING'}`);
  console.log(`  AWAY (${f.awayCode}): DK ML=${dkAway1X2 ?? 'MISSING'} | Model ML=${modelAway1X2 ?? 'MISSING'}`);
  console.log(`  TOTAL:         DK ${dkTotal ?? '?'} o${dkOver ?? '?'}/u${dkUnder ?? '?'} | Model ${modelTotal ?? '?'} o${modelOver ?? '?'}/u${modelUnder ?? '?'}`);
  
  // Validate completeness
  const missing = [];
  if (dkHome1X2 == null) missing.push('DK_HOME_ML');
  if (dkDraw1X2 == null) missing.push('DK_DRAW_ML');
  if (dkAway1X2 == null) missing.push('DK_AWAY_ML');
  if (dkOver == null) missing.push('DK_OVER');
  if (dkUnder == null) missing.push('DK_UNDER');
  if (modelHome1X2 == null) missing.push('MODEL_HOME_ML');
  if (modelDraw1X2 == null) missing.push('MODEL_DRAW_ML');
  if (modelAway1X2 == null) missing.push('MODEL_AWAY_ML');
  if (modelOver == null) missing.push('MODEL_OVER');
  if (modelUnder == null) missing.push('MODEL_UNDER');
  
  if (missing.length > 0) {
    oddsIssues++;
    console.log(`  [ERROR] MISSING: ${missing.join(', ')}`);
  } else {
    console.log(`  [VERIFY] PASS — all odds present`);
  }
  
  // Direction check: DK favorite should match model favorite
  if (dkHome1X2 != null && dkAway1X2 != null && modelHome1X2 != null && modelAway1X2 != null) {
    const dkFav = dkHome1X2 < dkAway1X2 ? 'HOME' : 'AWAY';
    const modelFav = modelHome1X2 < modelAway1X2 ? 'HOME' : 'AWAY';
    const dirMatch = dkFav === modelFav ? 'AGREE' : 'DISAGREE';
    console.log(`  [STATE] Favorite: DK=${dkFav}(${f[dkFav === 'HOME' ? 'homeCode' : 'awayCode']}) Model=${modelFav}(${f[modelFav === 'HOME' ? 'homeCode' : 'awayCode']}) → ${dirMatch}`);
  }
  console.log('');
}

console.log(`[OUTPUT] Odds completeness: ${june15Ids.length - oddsIssues}/${june15Ids.length} matchs fully populated`);
if (oddsIssues > 0) console.log(`[VERIFY] FAIL — ${oddsIssues} matchs have missing odds`);
else console.log('[VERIFY] PASS — all June 15 WC matchs have complete DK + Model odds');

await c.end();
