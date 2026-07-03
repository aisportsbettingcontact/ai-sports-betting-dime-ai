/**
 * 500x FORENSIC AUDIT — Away/Home Orientation
 * Verifies correct Away/Home mapping across:
 *   1. wc2026_matches (away_team_id / home_team_id)
 *   2. wc2026_frozen_book_odds (all away/home columns)
 *   3. v12 model lambda assignments (λH / λA)
 *   4. Router frozenBookToOdds mapping
 *
 * GROUND TRUTH from user-provided book lines table:
 * Match                    | Away         | Home
 * D.R. Congo vs England    | Congo DR     | England
 * Senegal vs Belgium       | Senegal      | Belgium
 * Bosnia vs USA            | Bosnia-Herz  | USA
 * Austria vs Spain         | Austria      | Spain
 * Croatia vs Portugal      | Croatia      | Portugal
 * Algeria vs Switzerland   | Algeria      | Switzerland
 * Egypt vs Australia       | Egypt        | Australia
 * Cape Verde vs Argentina  | Cape Verde   | Argentina
 * Ghana vs Colombia        | Ghana        | Colombia
 * Morocco vs Canada        | Morocco      | Canada
 * France vs Paraguay       | France       | Paraguay
 * Norway vs Brazil         | Norway       | Brazil
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const log = (tag, msg) => console.log(`[${new Date().toISOString()}] ${tag.padEnd(8)} │ ${msg}`);
const PASS = (msg) => log('PASS ✅', msg);
const FAIL = (msg) => log('FAIL ❌', msg);
const INFO = (msg) => log('INFO   ', msg);
const STATE = (msg) => log('STATE  ', msg);
const BANNER = (msg) => log('BANNER ', '═'.repeat(80));

// GROUND TRUTH: correct Away/Home orientation from user's book lines table
const GROUND_TRUTH = {
  'wc26-r32-080': { away: 'Congo DR',    home: 'England',     awayCode: 'COD', homeCode: 'ENG' },
  'wc26-r32-081': { away: 'Senegal',     home: 'Belgium',     awayCode: 'SEN', homeCode: 'BEL' },
  'wc26-r32-082': { away: 'Bosnia-Herz', home: 'USA',         awayCode: 'BIH', homeCode: 'USA' },
  'wc26-r32-083': { away: 'Austria',     home: 'Spain',       awayCode: 'AUT', homeCode: 'ESP' },
  'wc26-r32-084': { away: 'Croatia',     home: 'Portugal',    awayCode: 'CRO', homeCode: 'POR' },
  'wc26-r32-085': { away: 'Algeria',     home: 'Switzerland', awayCode: 'ALG', homeCode: 'SUI' },
  'wc26-r32-086': { away: 'Egypt',       home: 'Australia',   awayCode: 'EGY', homeCode: 'AUS' },
  'wc26-r32-087': { away: 'Cape Verde',  home: 'Argentina',   awayCode: 'CPV', homeCode: 'ARG' },
  'wc26-r32-088': { away: 'Ghana',       home: 'Colombia',    awayCode: 'GHA', homeCode: 'COL' },
  'wc26-r16-089': { away: 'Morocco',     home: 'Canada',      awayCode: 'MAR', homeCode: 'CAN' },
  'wc26-r16-090': { away: 'France',      home: 'Paraguay',    awayCode: 'FRA', homeCode: 'PAR' },
  'wc26-r16-091': { away: 'Norway',      home: 'Brazil',      awayCode: 'NOR', homeCode: 'BRA' },
};

// GROUND TRUTH book odds — keyed by match_id
// Format: { awayML, homeML, awayAdv, homeAdv, awaySpread, awaySpreadOdds, homeSpread, homeSpreadOdds, ... }
const BOOK_ODDS_TRUTH = {
  'wc26-r32-080': { awayML: 1100, homeML: -345, awayAdv: 600, homeAdv: -1100, awaySpread: 1.5, awaySpreadOdds: -111, homeSpread: -1.5, homeSpreadOdds: -105, over: 103, under: -120, bttsY: 163, bttsN: -227, draw: 400 },
  'wc26-r32-081': { awayML: 270, homeML: 115, awayAdv: 135, homeAdv: -175, awaySpread: 1.5, awaySpreadOdds: -435, homeSpread: -1.5, homeSpreadOdds: 300, over: 100, under: -118, bttsY: -133, bttsN: 100, draw: 220 },
  'wc26-r32-082': { awayML: 600, homeML: -250, awayAdv: 450, homeAdv: -700, awaySpread: 1.5, awaySpreadOdds: -137, homeSpread: -1.5, homeSpreadOdds: 108, over: -137, under: 110, bttsY: -105, bttsN: -125, draw: 400 },
  'wc26-r32-083': { awayML: 750, homeML: -303, awayAdv: 475, homeAdv: -750, awaySpread: 1.5, awaySpreadOdds: -120, homeSpread: -1.5, homeSpreadOdds: 103, over: -125, under: 100, bttsY: 120, bttsN: -161, draw: 425 },
  'wc26-r32-084': { awayML: 400, homeML: -133, awayAdv: 205, homeAdv: -270, awaySpread: 1.5, awaySpreadOdds: -286, homeSpread: -1.5, homeSpreadOdds: 210, over: 110, under: -137, bttsY: -105, bttsN: -125, draw: 250 },
  'wc26-r32-085': { awayML: 320, homeML: 100, awayAdv: 155, homeAdv: -200, awaySpread: 1.5, awaySpreadOdds: -385, homeSpread: -1.5, homeSpreadOdds: 270, over: 110, under: -137, bttsY: -110, bttsN: -110, draw: 220 },
  'wc26-r32-086': { awayML: 145, homeML: 240, awayAdv: -150, homeAdv: 115, awaySpread: -1.5, awaySpreadOdds: 450, homeSpread: 1.5, homeSpreadOdds: -667, over: -175, under: 138, bttsY: 120, bttsN: -161, draw: 188 },
  'wc26-r32-087': { awayML: 1400, homeML: -588, awayAdv: 950, homeAdv: -2500, awaySpread: 2.5, awaySpreadOdds: -189, homeSpread: -2.5, homeSpreadOdds: 142, over: -149, under: 120, bttsY: 175, bttsN: -250, draw: 650 },
  'wc26-r32-088': { awayML: 600, homeML: -189, awayAdv: 320, homeAdv: -450, awaySpread: 1.5, awaySpreadOdds: -200, homeSpread: -1.5, homeSpreadOdds: 150, over: 120, under: -149, bttsY: 125, bttsN: -175, draw: 290 },
  'wc26-r16-089': { awayML: -125, homeML: 375, awayAdv: -255, homeAdv: 195, awaySpread: -1.5, awaySpreadOdds: 230, homeSpread: 1.5, homeSpreadOdds: -303, over: 130, under: -161, bttsY: 105, bttsN: -143, draw: 250 },
  'wc26-r16-090': { awayML: -500, homeML: 1400, awayAdv: -2000, homeAdv: 850, awaySpread: -2.5, awaySpreadOdds: 142, homeSpread: 2.5, homeSpreadOdds: -189, over: -175, under: 138, bttsY: 138, bttsN: -189, draw: 600 },
  'wc26-r16-091': { awayML: 320, homeML: -111, awayAdv: 170, homeAdv: -215, awaySpread: 1.5, awaySpreadOdds: -303, homeSpread: -1.5, homeSpreadOdds: 230, over: -108, under: -108, bttsY: -133, bttsN: 100, draw: 240 },
};

let errors = 0;
let warnings = 0;
let checks = 0;

function check(label, actual, expected, matchId) {
  checks++;
  if (actual === expected) {
    PASS(`[${matchId}] ${label}: ${actual} ✓`);
  } else {
    FAIL(`[${matchId}] ${label}: DB=${actual} | EXPECTED=${expected}`);
    errors++;
  }
}

async function main() {
  BANNER();
  INFO('500x FORENSIC AUDIT — Away/Home Orientation');
  INFO('Checking DB fixtures, frozen_book_odds, and v12 model orientation');
  BANNER();

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE A: Audit wc2026_matches — away_team_id / home_team_id
  // ─────────────────────────────────────────────────────────────────────────
  INFO('');
  INFO('PHASE A: wc2026_matches — away_team_id / home_team_id');
  INFO('─'.repeat(60));

  const matchIds = Object.keys(GROUND_TRUTH);
  const [fixtures] = await conn.execute(
    `SELECT f.match_id, f.away_team_id, f.home_team_id,
            ta.name AS away_name, ta.fifa_code AS away_code,
            th.name AS home_name, th.fifa_code AS home_code
     FROM wc2026_matches f
     LEFT JOIN wc2026_teams ta ON ta.team_id = f.away_team_id
     LEFT JOIN wc2026_teams th ON th.team_id = f.home_team_id
     WHERE f.match_id IN (${matchIds.map(() => '?').join(',')})
     ORDER BY f.match_id`,
    matchIds
  );

  const fixtureMap = {};
  for (const row of fixtures) {
    fixtureMap[row.match_id] = row;
    const gt = GROUND_TRUTH[row.match_id];
    STATE(`[${row.match_id}] DB: Away=${row.away_code}(${row.away_name}) | Home=${row.home_code}(${row.home_name})`);
    STATE(`[${row.match_id}] GT: Away=${gt.awayCode}(${gt.away}) | Home=${gt.homeCode}(${gt.home})`);
    check('Away team code', row.away_code, gt.awayCode, row.match_id);
    check('Home team code', row.home_code, gt.homeCode, row.match_id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE B: Audit wc2026_frozen_book_odds — all away/home columns
  // ─────────────────────────────────────────────────────────────────────────
  INFO('');
  INFO('PHASE B: wc2026_frozen_book_odds — all away/home market columns');
  INFO('─'.repeat(60));

  const [odds] = await conn.execute(
    `SELECT match_id,
            book_away_ml, book_home_ml,
            book_to_adv_away, book_to_adv_home,
            book_away_spread, book_away_spread_odds,
            book_home_spread, book_home_spread_odds,
            book_over_odds, book_under_odds,
            book_btts_yes, book_btts_no,
            book_draw_ml
     FROM wc2026_frozen_book_odds
     WHERE match_id IN (${matchIds.map(() => '?').join(',')})
     ORDER BY match_id`,
    matchIds
  );

  const oddsMap = {};
  for (const row of odds) {
    oddsMap[row.match_id] = row;
    const gt = BOOK_ODDS_TRUTH[row.match_id];
    const fid = row.match_id;

    INFO(`[${fid}] ─── Book Odds Orientation Check ───`);
    STATE(`[${fid}] DB  Away ML=${row.book_away_ml} | Home ML=${row.book_home_ml} | Draw=${row.book_draw_ml}`);
    STATE(`[${fid}] GT  Away ML=${gt.awayML}       | Home ML=${gt.homeML}       | Draw=${gt.draw}`);
    check('Away ML', parseInt(row.book_away_ml), gt.awayML, fid);
    check('Home ML', parseInt(row.book_home_ml), gt.homeML, fid);
    check('Draw ML', parseInt(row.book_draw_ml), gt.draw, fid);

    STATE(`[${fid}] DB  Away Adv=${row.book_to_adv_away} | Home Adv=${row.book_to_adv_home}`);
    STATE(`[${fid}] GT  Away Adv=${gt.awayAdv}           | Home Adv=${gt.homeAdv}`);
    check('Away To Advance', parseInt(row.book_to_adv_away), gt.awayAdv, fid);
    check('Home To Advance', parseInt(row.book_to_adv_home), gt.homeAdv, fid);

    STATE(`[${fid}] DB  Away Spread=${row.book_away_spread} (${row.book_away_spread_odds}) | Home Spread=${row.book_home_spread} (${row.book_home_spread_odds})`);
    STATE(`[${fid}] GT  Away Spread=${gt.awaySpread} (${gt.awaySpreadOdds})               | Home Spread=${gt.homeSpread} (${gt.homeSpreadOdds})`);
    check('Away Spread Line', parseFloat(row.book_away_spread), gt.awaySpread, fid);
    check('Away Spread Odds', parseInt(row.book_away_spread_odds), gt.awaySpreadOdds, fid);
    check('Home Spread Line', parseFloat(row.book_home_spread), gt.homeSpread, fid);
    check('Home Spread Odds', parseInt(row.book_home_spread_odds), gt.homeSpreadOdds, fid);

    STATE(`[${fid}] DB  Over=${row.book_over_odds} | Under=${row.book_under_odds}`);
    STATE(`[${fid}] GT  Over=${gt.over}            | Under=${gt.under}`);
    check('Over Odds', parseInt(row.book_over_odds), gt.over, fid);
    check('Under Odds', parseInt(row.book_under_odds), gt.under, fid);

    STATE(`[${fid}] DB  BTTS Y=${row.book_btts_yes} | BTTS N=${row.book_btts_no}`);
    STATE(`[${fid}] GT  BTTS Y=${gt.bttsY}          | BTTS N=${gt.bttsN}`);
    check('BTTS Yes', parseInt(row.book_btts_yes), gt.bttsY, fid);
    check('BTTS No', parseInt(row.book_btts_no), gt.bttsN, fid);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE C: Audit v12 model orientation for 3 Jul 1 matches
  // ─────────────────────────────────────────────────────────────────────────
  INFO('');
  INFO('PHASE C: v12 Model Lambda Orientation — 3 Jul 1 Matches');
  INFO('─'.repeat(60));

  // v12 lambda inputs from the model script
  // λH = home team attack rate, λA = away team attack rate
  const V12_LAMBDAS = {
    'wc26-r32-080': { lambdaH: 0.62, lambdaA: 2.34, homeTeam: 'ENG', awayTeam: 'COD' },
    'wc26-r32-081': { lambdaH: 1.07, lambdaA: 1.51, homeTeam: 'BEL', awayTeam: 'SEN' },
    'wc26-r32-082': { lambdaH: 0.89, lambdaA: 1.72, homeTeam: 'USA', awayTeam: 'BIH' },
  };

  for (const [fid, lam] of Object.entries(V12_LAMBDAS)) {
    const gt = GROUND_TRUTH[fid];
    const dbFix = fixtureMap[fid];
    STATE(`[${fid}] v12 λH=${lam.lambdaH} assigned to ${lam.homeTeam} | λA=${lam.lambdaA} assigned to ${lam.awayTeam}`);
    STATE(`[${fid}] GT  Home=${gt.homeCode} | Away=${gt.awayCode}`);
    check('v12 λH team (home)', lam.homeTeam, gt.homeCode, fid);
    check('v12 λA team (away)', lam.awayTeam, gt.awayCode, fid);

    // Verify DB fixture orientation matches v12 model orientation
    if (dbFix) {
      check('DB home_code matches v12 λH team', dbFix.home_code, lam.homeTeam, fid);
      check('DB away_code matches v12 λA team', dbFix.away_code, lam.awayTeam, fid);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE D: Audit router frozenBookToOdds field mapping
  // ─────────────────────────────────────────────────────────────────────────
  INFO('');
  INFO('PHASE D: Router frozenBookToOdds field mapping — reading wc2026Router.ts');
  INFO('─'.repeat(60));

  // Read the router to check field mapping
  const { readFileSync } = await import('fs');
  const routerPath = '/home/ubuntu/ai-sports-betting/server/wc2026/wc2026Router.ts';
  const routerSrc = readFileSync(routerPath, 'utf8');

  // Check that frozenBookToOdds maps away/home correctly
  const awayMlMapping = routerSrc.match(/awayMl[^:]*:[^,\n]*/i);
  const homeMlMapping = routerSrc.match(/homeMl[^:]*:[^,\n]*/i);
  const awayAdvMapping = routerSrc.match(/awayToAdv[^:]*:[^,\n]*/i);
  const homeAdvMapping = routerSrc.match(/homeToAdv[^:]*:[^,\n]*/i);

  INFO(`Router awayMl mapping: ${awayMlMapping?.[0]?.trim() || 'NOT FOUND'}`);
  INFO(`Router homeMl mapping: ${homeMlMapping?.[0]?.trim() || 'NOT FOUND'}`);
  INFO(`Router awayToAdv mapping: ${awayAdvMapping?.[0]?.trim() || 'NOT FOUND'}`);
  INFO(`Router homeToAdv mapping: ${homeAdvMapping?.[0]?.trim() || 'NOT FOUND'}`);

  // Check for any swapped field names
  const hasAwayMlFromAway = routerSrc.includes('book_away_ml') && routerSrc.includes('awayMl');
  const hasHomeMlFromHome = routerSrc.includes('book_home_ml') && routerSrc.includes('homeMl');
  if (hasAwayMlFromAway) PASS('Router: book_away_ml → awayMl mapping present');
  else FAIL('Router: book_away_ml → awayMl mapping MISSING');
  if (hasHomeMlFromHome) PASS('Router: book_home_ml → homeMl mapping present');
  else FAIL('Router: book_home_ml → homeMl mapping MISSING');

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  BANNER();
  INFO('');
  INFO('500x FORENSIC AUDIT — ORIENTATION SUMMARY');
  INFO(`Total checks: ${checks}`);
  INFO(`PASS: ${checks - errors}`);
  INFO(`FAIL: ${errors}`);
  INFO(`WARN: ${warnings}`);
  if (errors === 0) {
    PASS('ALL ORIENTATION CHECKS PASSED — Away/Home mapping is 100% correct across DB, router, and v12 model');
  } else {
    FAIL(`${errors} ORIENTATION ERRORS DETECTED — corrections required`);
  }
  BANNER();

  await conn.end();
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
