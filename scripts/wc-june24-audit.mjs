/**
 * wc-june24-audit.mjs
 * Full audit of June 24 WC2026 matches:
 * - home/away team orientation
 * - all 6 market odds vs ground truth
 * - model spread accuracy
 * - projected scores
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_JUNE24_AUDIT]';

// Ground truth from user — all 6 June 24 matches
const GROUND_TRUTH = {
  'wc26-g-049': {
    label: 'Canada vs Switzerland',
    awayTeam: 'Canada', homeTeam: 'Switzerland',
    awayAbbr: 'CAN', homeAbbr: 'SUI',
    book: {
      '1X2:away': 240, '1X2:home': 135, '1X2:draw': 210, '1X2:no_draw': -270,
      'TOTAL:over': 100, 'TOTAL:under': -125,
      'ASIAN_HANDICAP:away': -575, 'ASIAN_HANDICAP:home': 400,
      'DOUBLE_CHANCE:away_draw': -170, 'DOUBLE_CHANCE:home_draw': -310,
      'BTTS:yes': -140, 'BTTS:no': 110,
    },
    awaySpreadLine: 1.5, homeSpreadLine: -1.5,
    totalLine: 2.5,
    notes: 'CAN away +1.5 -575 | SUI home -1.5 +400'
  },
  'wc26-g-050': {
    label: 'Qatar @ Bosnia',
    awayTeam: 'Qatar', homeTeam: 'Bosnia',
    awayAbbr: 'QAT', homeAbbr: 'BIH',
    book: {
      '1X2:away': 600, '1X2:home': -240, '1X2:draw': 400, '1X2:no_draw': -575,
      'TOTAL:over': -175, 'TOTAL:under': 140,
      'ASIAN_HANDICAP:away': -140, 'ASIAN_HANDICAP:home': 110,
      'DOUBLE_CHANCE:away_draw': 185, 'DOUBLE_CHANCE:home_draw': -1000,
      'BTTS:yes': -135, 'BTTS:no': 105,
    },
    awaySpreadLine: 1.5, homeSpreadLine: -1.5,
    totalLine: 2.5,
    notes: 'QAT away +1.5 -140 | BIH home -1.5 +110'
  },
  'wc26-g-051': {
    label: 'Brazil vs Scotland',
    awayTeam: 'Brazil', homeTeam: 'Scotland',
    awayAbbr: 'BRA', homeAbbr: 'SCO',
    book: {
      '1X2:away': -265, '1X2:home': 700, '1X2:draw': 425, '1X2:no_draw': -600,
      'TOTAL:over': -115, 'TOTAL:under': -105,
      'ASIAN_HANDICAP:away': 100, 'ASIAN_HANDICAP:home': -130,
      'DOUBLE_CHANCE:away_draw': -1100, 'DOUBLE_CHANCE:home_draw': 200,
      'BTTS:yes': 130, 'BTTS:no': -165,
    },
    awaySpreadLine: -1.5, homeSpreadLine: 1.5,
    totalLine: 2.5,
    notes: 'BRA away -1.5 +100 | SCO home +1.5 -130'
  },
  'wc26-g-052': {
    label: 'Haiti @ Morocco',
    awayTeam: 'Haiti', homeTeam: 'Morocco',
    awayAbbr: 'HAI', homeAbbr: 'MAR',
    book: {
      '1X2:away': 1400, '1X2:home': -500, '1X2:draw': 600, '1X2:no_draw': -1000,
      'TOTAL:over': 145, 'TOTAL:under': -175,
      'ASIAN_HANDICAP:away': 135, 'ASIAN_HANDICAP:home': -170,
      'DOUBLE_CHANCE:away_draw': 340, 'DOUBLE_CHANCE:home_draw': -3500,
      'BTTS:yes': 130, 'BTTS:no': -165,
    },
    awaySpreadLine: 1.5, homeSpreadLine: -1.5,
    totalLine: 3.5,
    notes: 'HAI away +1.5 +135 | MAR home -1.5 -170'
  },
  'wc26-g-053': {
    label: 'Mexico @ Czech Republic',
    awayTeam: 'Mexico', homeTeam: 'Czech Republic',
    awayAbbr: 'MEX', homeAbbr: 'CZE',
    book: {
      '1X2:away': -105, '1X2:home': 265, '1X2:draw': 285, '1X2:no_draw': -370,
      'TOTAL:over': 105, 'TOTAL:under': -130,
      'ASIAN_HANDICAP:away': 260, 'ASIAN_HANDICAP:home': -350,
      'DOUBLE_CHANCE:away_draw': -350, 'DOUBLE_CHANCE:home_draw': -120,
      'BTTS:yes': -110, 'BTTS:no': -115,
    },
    awaySpreadLine: -1.5, homeSpreadLine: 1.5,
    totalLine: 2.5,
    notes: 'MEX away -1.5 +260 | CZE home +1.5 -350'
  },
  'wc26-g-054': {
    label: 'South Korea @ South Africa',
    awayTeam: 'South Korea', homeTeam: 'South Africa',
    awayAbbr: 'KOR', homeAbbr: 'RSA',
    book: {
      '1X2:away': -150, '1X2:home': 425, '1X2:draw': 295, '1X2:no_draw': -390,
      'TOTAL:over': 105, 'TOTAL:under': -130,
      'ASIAN_HANDICAP:away': 195, 'ASIAN_HANDICAP:home': -250,
      'DOUBLE_CHANCE:away_draw': -600, 'DOUBLE_CHANCE:home_draw': 115,
      'BTTS:yes': -105, 'BTTS:no': -125,
    },
    awaySpreadLine: -1.5, homeSpreadLine: 1.5,
    totalLine: 2.5,
    notes: 'KOR away -1.5 +195 | RSA home +1.5 -250'
  },
};

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Step 1: Get match home/away orientation from DB
  console.log(`\n${TAG} ═══ STEP 1: HOME/AWAY ORIENTATION AUDIT ═══`);
  const matchIds = Object.keys(GROUND_TRUTH);
  const [matches] = await conn.query(
    `SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id IN (${matchIds.map(() => '?').join(',')}) ORDER BY match_id`,
    matchIds
  );
  const [teams] = await conn.query(`SELECT team_id, name, fifa_code FROM wc2026_teams`);
  const teamMap = Object.fromEntries(teams.map(t => [t.team_id, { name: t.name, abbr: t.fifa_code }]));

  for (const f of matches) {
    const gt = GROUND_TRUTH[f.match_id];
    const homeTeam = teamMap[f.home_team_id];
    const awayTeam = teamMap[f.away_team_id];
    const homeOk = homeTeam?.name === gt.homeTeam || homeTeam?.abbr === gt.homeAbbr;
    const awayOk = awayTeam?.name === gt.awayTeam || awayTeam?.abbr === gt.awayAbbr;
    console.log(`${f.match_id} | ${gt.label}`);
    console.log(`  DB:  home=${homeTeam?.name}(${homeTeam?.abbr}) away=${awayTeam?.name}(${awayTeam?.abbr})`);
    console.log(`  GT:  home=${gt.homeTeam}(${gt.homeAbbr}) away=${gt.awayTeam}(${gt.awayAbbr})`);
    console.log(`  ${homeOk && awayOk ? '✅ CORRECT' : '❌ MISMATCH'}`);
  }

  // Step 2: Get all odds snapshots for June 24 matches
  console.log(`\n${TAG} ═══ STEP 2: BOOK ODDS AUDIT (book_id=68) ═══`);
  const [snaps] = await conn.query(
    `SELECT match_id, book_id, market, selection, line, american_odds FROM wc2026_odds_snapshots WHERE match_id IN (${matchIds.map(() => '?').join(',')}) ORDER BY match_id, book_id, market, selection`,
    matchIds
  );

  for (const fid of matchIds) {
    const gt = GROUND_TRUTH[fid];
    const bookRows = snaps.filter(r => r.match_id === fid && r.book_id === 68);
    const modelRows = snaps.filter(r => r.match_id === fid && r.book_id === 0);
    console.log(`\n${fid} | ${gt.label}`);
    console.log(`  DB book rows: ${bookRows.length} | model rows: ${modelRows.length}`);

    // Check each market
    for (const [key, gtOdds] of Object.entries(gt.book)) {
      const [market, selection] = key.split(':');
      const row = bookRows.find(r => r.market === market && r.selection === selection);
      const dbOdds = row ? Number(row.american_odds) : null;
      const ok = dbOdds === gtOdds;
      const lineInfo = row?.line != null ? ` line=${Number(row.line)}` : '';
      console.log(`  ${ok ? '✅' : '❌'} ${market}:${selection}${lineInfo} DB=${dbOdds} GT=${gtOdds}`);
    }

    // Check spread lines
    const awaySpread = bookRows.find(r => r.market === 'ASIAN_HANDICAP' && r.selection === 'away');
    const homeSpread = bookRows.find(r => r.market === 'ASIAN_HANDICAP' && r.selection === 'home');
    const awayLine = awaySpread ? Number(awaySpread.line) : null;
    const homeLine = homeSpread ? Number(homeSpread.line) : null;
    console.log(`  SPREAD lines: away=${awayLine} (GT=${gt.awaySpreadLine}) home=${homeLine} (GT=${gt.homeSpreadLine})`);
    console.log(`  TOTAL line: ${bookRows.find(r => r.market === 'TOTAL')?.line} (GT=${gt.totalLine})`);
  }

  // Step 3: Model spread accuracy check
  console.log(`\n${TAG} ═══ STEP 3: MODEL SPREAD ODDS ACCURACY ═══`);
  for (const fid of matchIds) {
    const gt = GROUND_TRUTH[fid];
    const modelRows = snaps.filter(r => r.match_id === fid && r.book_id === 0);
    const modelAwaySpread = modelRows.find(r => r.market === 'ASIAN_HANDICAP' && r.selection === 'away');
    const modelHomeSpread = modelRows.find(r => r.market === 'ASIAN_HANDICAP' && r.selection === 'home');
    const bookAwaySpread = snaps.find(r => r.match_id === fid && r.book_id === 68 && r.market === 'ASIAN_HANDICAP' && r.selection === 'away');
    const bookHomeSpread = snaps.find(r => r.match_id === fid && r.book_id === 68 && r.market === 'ASIAN_HANDICAP' && r.selection === 'home');
    console.log(`${fid} | ${gt.label}`);
    console.log(`  Away spread: book_line=${bookAwaySpread?.line} book_odds=${bookAwaySpread?.american_odds} | model_line=${modelAwaySpread?.line} model_odds=${modelAwaySpread?.american_odds}`);
    console.log(`  Home spread: book_line=${bookHomeSpread?.line} book_odds=${bookHomeSpread?.american_odds} | model_line=${modelHomeSpread?.line} model_odds=${modelHomeSpread?.american_odds}`);
  }

  // Step 4: Projected scores
  console.log(`\n${TAG} ═══ STEP 4: PROJECTED SCORES ═══`);
  const [projs] = await conn.query(
    `SELECT match_id, proj_home_score, proj_away_score, proj_total, proj_spread, home_lambda, away_lambda FROM wc2026_model_projections WHERE match_id IN (${matchIds.map(() => '?').join(',')}) ORDER BY match_id`,
    matchIds
  );
  for (const p of projs) {
    const gt = GROUND_TRUTH[p.match_id];
    const projTotal = Number(p.proj_total);
    const isRound = projTotal === 2.5 || projTotal === 3.5;
    console.log(`${p.match_id} | ${gt.label}`);
    console.log(`  proj_home=${p.proj_home_score} proj_away=${p.proj_away_score} proj_total=${projTotal} ${isRound ? '⚠️ ROUND NUMBER' : '✅'}`);
    console.log(`  lambdaH=${Number(p.home_lambda).toFixed(4)} lambdaA=${Number(p.away_lambda).toFixed(4)}`);
  }

  await conn.end();
  console.log(`\n${TAG} ═══ AUDIT COMPLETE ═══`);
}

main().catch(e => {
  console.error(`${TAG} FAIL: ${e.message}`);
  process.exit(1);
});
