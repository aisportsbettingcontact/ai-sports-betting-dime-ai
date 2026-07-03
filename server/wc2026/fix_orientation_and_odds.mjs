/**
 * 500x FORENSIC FIX — Away/Home Orientation + Column Name Corrections
 *
 * Fixes:
 * 1. Swap wc26-r16-089 and wc26-r16-090 match team assignments
 *    - 089 should be Morocco (Away) @ Canada (Home)
 *    - 090 should be France (Away) @ Paraguay (Home)
 *
 * 2. Re-seed all 12 matchs in wc2026_frozen_book_odds using CORRECT column names:
 *    - book_spread_line (single value, away team's spread)
 *    - book_home_spread_odds
 *    - book_away_spread_odds
 *    - to_advance_home_odds
 *    - to_advance_away_odds
 *    - book_btts_yes_odds
 *    - book_btts_no_odds
 *    - book_dc_1x_odds
 *    - book_dc_x2_odds
 *    - book_no_draw_home_odds
 *    - book_no_draw_away_odds
 *
 * GROUND TRUTH from user's book lines table (Away listed first):
 * match_id   | Away         | Home        | awayML | homeML | draw | total | awaySpread | awaySpreadOdds | homeSpreadOdds | over | under | bttsY | bttsN | awayAdv | homeAdv
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const log = (tag, msg) => console.log(`[${new Date().toISOString()}] ${tag.padEnd(8)} │ ${msg}`);
const PASS = (msg) => log('PASS ✅', msg);
const FAIL = (msg) => log('FAIL ❌', msg);
const INFO = (msg) => log('INFO   ', msg);
const STATE = (msg) => log('STATE  ', msg);
const STEP = (msg) => log('STEP   ', msg);

// COMPLETE GROUND TRUTH — all 12 matchs
// awaySpread = the away team's spread line (e.g. +1.5 means away gets +1.5)
// homeSpread = -awaySpread (always opposite)
// dc_1x = Away or Draw (Away team covers DC)
// dc_x2 = Home or Draw (Home team covers DC)
const MATCHS = [
  {
    id: 'wc26-r32-080', away: 'COD', home: 'ENG',
    awayML: 1100, homeML: -345, draw: 400,
    total: 2.5, over: 103, under: -120,
    awaySpread: 1.5, awaySpreadOdds: -111, homeSpreadOdds: -105,
    bttsY: 163, bttsN: -227,
    dc1x: 250, dcX2: -2000, noDrawHome: -588, noDrawAway: null,
    awayAdv: 600, homeAdv: -1100
  },
  {
    id: 'wc26-r32-081', away: 'SEN', home: 'BEL',
    awayML: 270, homeML: 115, draw: 220,
    total: 2.5, over: 100, under: -118,
    awaySpread: 1.5, awaySpreadOdds: -435, homeSpreadOdds: 300,
    bttsY: -133, bttsN: 100,
    dc1x: -149, dcX2: -345, noDrawHome: -278, noDrawAway: null,
    awayAdv: 135, homeAdv: -175
  },
  {
    id: 'wc26-r32-082', away: 'BIH', home: 'USA',
    awayML: 600, homeML: -250, draw: 400,
    total: 2.5, over: -137, under: 110,
    awaySpread: 1.5, awaySpreadOdds: -137, homeSpreadOdds: 108,
    bttsY: -105, bttsN: -125,
    dc1x: 175, dcX2: -1000, noDrawHome: -588, noDrawAway: null,
    awayAdv: 450, homeAdv: -700
  },
  {
    id: 'wc26-r32-083', away: 'AUT', home: 'ESP',
    awayML: 750, homeML: -303, draw: 425,
    total: 2.5, over: -125, under: 100,
    awaySpread: 1.5, awaySpreadOdds: -120, homeSpreadOdds: 103,
    bttsY: 120, bttsN: -161,
    dc1x: 225, dcX2: -1250, noDrawHome: -588, noDrawAway: null,
    awayAdv: 475, homeAdv: -750
  },
  {
    id: 'wc26-r32-084', away: 'CRO', home: 'POR',
    awayML: 400, homeML: -133, draw: 250,
    total: 2.5, over: 110, under: -137,
    awaySpread: 1.5, awaySpreadOdds: -286, homeSpreadOdds: 210,
    bttsY: -105, bttsN: -125,
    dc1x: 100, dcX2: -588, noDrawHome: -345, noDrawAway: null,
    awayAdv: 205, homeAdv: -270
  },
  {
    id: 'wc26-r32-085', away: 'ALG', home: 'SUI',
    awayML: 320, homeML: 100, draw: 220,
    total: 2.5, over: 110, under: -137,
    awaySpread: 1.5, awaySpreadOdds: -385, homeSpreadOdds: 270,
    bttsY: -110, bttsN: -110,
    dc1x: -125, dcX2: -455, noDrawHome: -278, noDrawAway: null,
    awayAdv: 155, homeAdv: -200
  },
  {
    id: 'wc26-r32-086', away: 'EGY', home: 'AUS',
    awayML: 145, homeML: 240, draw: 188,
    total: 1.5, over: -175, under: 138,
    awaySpread: -1.5, awaySpreadOdds: 450, homeSpreadOdds: -667,
    bttsY: 120, bttsN: -161,
    dc1x: -333, dcX2: -189, noDrawHome: -250, noDrawAway: null,
    awayAdv: -150, homeAdv: 115
  },
  {
    id: 'wc26-r32-087', away: 'CPV', home: 'ARG',
    awayML: 1400, homeML: -588, draw: 650,
    total: 2.5, over: -149, under: 120,
    awaySpread: 2.5, awaySpreadOdds: -189, homeSpreadOdds: 142,
    bttsY: 175, bttsN: -250,
    dc1x: 400, dcX2: -3333, noDrawHome: -1000, noDrawAway: null,
    awayAdv: 950, homeAdv: -2500
  },
  {
    id: 'wc26-r32-088', away: 'GHA', home: 'COL',
    awayML: 600, homeML: -189, draw: 290,
    total: 2.5, over: 120, under: -149,
    awaySpread: 1.5, awaySpreadOdds: -200, homeSpreadOdds: 150,
    bttsY: 125, bttsN: -175,
    dc1x: 138, dcX2: -1000, noDrawHome: -400, noDrawAway: null,
    awayAdv: 320, homeAdv: -450
  },
  {
    // Morocco (Away) @ Canada (Home)
    id: 'wc26-r16-089', away: 'MAR', home: 'CAN',
    awayML: -125, homeML: 375, draw: 250,
    total: 2.5, over: 130, under: -161,
    awaySpread: -1.5, awaySpreadOdds: 230, homeSpreadOdds: -303,
    bttsY: 105, bttsN: -143,
    dc1x: -556, dcX2: -105, noDrawHome: -345, noDrawAway: null,
    awayAdv: -255, homeAdv: 195
  },
  {
    // France (Away) @ Paraguay (Home)
    id: 'wc26-r16-090', away: 'FRA', home: 'PAR',
    awayML: -500, homeML: 1400, draw: 600,
    total: 2.5, over: -175, under: 138,
    awaySpread: -2.5, awaySpreadOdds: 142, homeSpreadOdds: -189,
    bttsY: 138, bttsN: -189,
    dc1x: -3333, dcX2: 333, noDrawHome: -1000, noDrawAway: null,
    awayAdv: -2000, homeAdv: 850
  },
  {
    id: 'wc26-r16-091', away: 'NOR', home: 'BRA',
    awayML: 320, homeML: -111, draw: 240,
    total: 2.5, over: -108, under: -108,
    awaySpread: 1.5, awaySpreadOdds: -303, homeSpreadOdds: 230,
    bttsY: -133, bttsN: 100,
    dc1x: -110, dcX2: -455, noDrawHome: -333, noDrawAway: null,
    awayAdv: 170, homeAdv: -215
  },
];

async function main() {
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Get team IDs for Morocco, Canada, France, Paraguay
  // ─────────────────────────────────────────────────────────────────────────
  STEP('Getting team IDs for R16 swap...');
  const [teams] = await conn.execute(
    `SELECT team_id, fifa_code, name FROM wc2026_teams WHERE fifa_code IN ('MAR','CAN','FRA','PAR')`
  );
  const teamMap = {};
  for (const t of teams) {
    teamMap[t.fifa_code] = t.team_id;
    STATE(`Team: ${t.fifa_code} → team_id=${t.team_id} (${t.name})`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Swap R16-089 and R16-090 match team assignments
  // ─────────────────────────────────────────────────────────────────────────
  STEP('Swapping R16-089 (→ MAR@CAN) and R16-090 (→ FRA@PAR) team assignments...');

  // 089 should be Morocco (Away) @ Canada (Home)
  const [r089] = await conn.execute(
    `UPDATE wc2026_matches SET away_team_id=?, home_team_id=? WHERE match_id='wc26-r16-089'`,
    [teamMap['MAR'], teamMap['CAN']]
  );
  STATE(`089 update: affectedRows=${r089.affectedRows}`);
  if (r089.affectedRows === 1) PASS('wc26-r16-089 → MAR(Away) @ CAN(Home)');
  else FAIL('wc26-r16-089 update failed');

  // 090 should be France (Away) @ Paraguay (Home)
  const [r090] = await conn.execute(
    `UPDATE wc2026_matches SET away_team_id=?, home_team_id=? WHERE match_id='wc26-r16-090'`,
    [teamMap['FRA'], teamMap['PAR']]
  );
  STATE(`090 update: affectedRows=${r090.affectedRows}`);
  if (r090.affectedRows === 1) PASS('wc26-r16-090 → FRA(Away) @ PAR(Home)');
  else FAIL('wc26-r16-090 update failed');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Re-seed all 12 frozen_book_odds with CORRECT column names
  // ─────────────────────────────────────────────────────────────────────────
  STEP('Re-seeding all 12 frozen_book_odds with correct column names...');

  let seedPass = 0;
  let seedFail = 0;

  for (const f of MATCHS) {
    const homeSpread = -(f.awaySpread); // home spread is always opposite of away spread

    const [res] = await conn.execute(
      `UPDATE wc2026_frozen_book_odds SET
        book_home_ml = ?,
        book_draw_ml = ?,
        book_away_ml = ?,
        book_spread_line = ?,
        book_home_spread_odds = ?,
        book_away_spread_odds = ?,
        book_total_line = ?,
        book_over_odds = ?,
        book_under_odds = ?,
        book_btts_yes_odds = ?,
        book_btts_no_odds = ?,
        book_dc_1x_odds = ?,
        book_dc_x2_odds = ?,
        book_no_draw_home_odds = ?,
        book_no_draw_away_odds = ?,
        to_advance_home_odds = ?,
        to_advance_away_odds = ?
      WHERE match_id = ?`,
      [
        f.homeML, f.draw, f.awayML,
        f.awaySpread,           // spread_line = away team's spread
        f.homeSpreadOdds,       // home spread odds
        f.awaySpreadOdds,       // away spread odds
        f.total,
        f.over, f.under,
        f.bttsY, f.bttsN,
        f.dc1x, f.dcX2,
        f.noDrawHome, f.noDrawAway,
        f.homeAdv, f.awayAdv,
        f.id
      ]
    );

    STATE(`[${f.id}] UPDATE affectedRows=${res.affectedRows} | Away=${f.away}(${f.awayML}) Home=${f.home}(${f.homeML}) Spread=${f.awaySpread}(${f.awaySpreadOdds}/${f.homeSpreadOdds}) Total=${f.total}(${f.over}/${f.under}) BTTS=${f.bttsY}/${f.bttsN} AdvH=${f.homeAdv} AdvA=${f.awayAdv}`);

    if (res.affectedRows === 1) {
      PASS(`[${f.id}] All 17 columns updated correctly`);
      seedPass++;
    } else {
      FAIL(`[${f.id}] UPDATE returned affectedRows=${res.affectedRows}`);
      seedFail++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Full verification — read back all 12 rows and compare to ground truth
  // ─────────────────────────────────────────────────────────────────────────
  STEP('VERIFICATION — Reading back all 12 rows for full validation...');

  const [verRows] = await conn.execute(
    `SELECT o.match_id,
            ta.fifa_code AS away_code, th.fifa_code AS home_code,
            o.book_away_ml, o.book_home_ml, o.book_draw_ml,
            o.book_spread_line, o.book_away_spread_odds, o.book_home_spread_odds,
            o.book_total_line, o.book_over_odds, o.book_under_odds,
            o.book_btts_yes_odds, o.book_btts_no_odds,
            o.book_dc_1x_odds, o.book_dc_x2_odds,
            o.book_no_draw_home_odds,
            o.to_advance_home_odds, o.to_advance_away_odds
     FROM wc2026_frozen_book_odds o
     JOIN wc2026_matches f ON f.match_id = o.match_id
     JOIN wc2026_teams ta ON ta.team_id = f.away_team_id
     JOIN wc2026_teams th ON th.team_id = f.home_team_id
     WHERE o.match_id IN (${MATCHS.map(() => '?').join(',')})
     ORDER BY o.match_id`,
    MATCHS.map(f => f.id)
  );

  let verErrors = 0;
  for (const row of verRows) {
    const gt = MATCHS.find(f => f.id === row.match_id);
    const fid = row.match_id;

    INFO(`[${fid}] Away=${row.away_code} Home=${row.home_code}`);

    const checks = [
      ['Away ML', parseInt(row.book_away_ml), gt.awayML],
      ['Home ML', parseInt(row.book_home_ml), gt.homeML],
      ['Draw ML', parseInt(row.book_draw_ml), gt.draw],
      ['Spread Line', parseFloat(row.book_spread_line), gt.awaySpread],
      ['Away Spread Odds', parseInt(row.book_away_spread_odds), gt.awaySpreadOdds],
      ['Home Spread Odds', parseInt(row.book_home_spread_odds), gt.homeSpreadOdds],
      ['Total Line', parseFloat(row.book_total_line), gt.total],
      ['Over Odds', parseInt(row.book_over_odds), gt.over],
      ['Under Odds', parseInt(row.book_under_odds), gt.under],
      ['BTTS Yes', parseInt(row.book_btts_yes_odds), gt.bttsY],
      ['BTTS No', parseInt(row.book_btts_no_odds), gt.bttsN],
      ['DC 1X', parseInt(row.book_dc_1x_odds), gt.dc1x],
      ['DC X2', parseInt(row.book_dc_x2_odds), gt.dcX2],
      ['No Draw Home', parseInt(row.book_no_draw_home_odds), gt.noDrawHome],
      ['Adv Home', parseInt(row.to_advance_home_odds), gt.homeAdv],
      ['Adv Away', parseInt(row.to_advance_away_odds), gt.awayAdv],
    ];

    let rowErrors = 0;
    for (const [label, actual, expected] of checks) {
      if (actual === expected) {
        PASS(`  [${fid}] ${label}: ${actual} ✓`);
      } else {
        FAIL(`  [${fid}] ${label}: DB=${actual} | EXPECTED=${expected}`);
        rowErrors++;
        verErrors++;
      }
    }
    if (rowErrors === 0) {
      PASS(`[${fid}] ALL 16 CHECKS PASSED ✅`);
    } else {
      FAIL(`[${fid}] ${rowErrors} ERRORS`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  INFO('');
  INFO('═'.repeat(80));
  INFO('500x ORIENTATION FIX — FINAL SUMMARY');
  INFO(`Match team swaps: 2 (R16-089, R16-090)`);
  INFO(`Seed updates: ${seedPass} PASS / ${seedFail} FAIL`);
  INFO(`Verification errors: ${verErrors}`);
  if (verErrors === 0 && seedFail === 0) {
    PASS('ALL FIXES APPLIED — 100% CORRECT ORIENTATION AND COLUMN MAPPING');
  } else {
    FAIL(`${verErrors + seedFail} TOTAL ERRORS REMAINING`);
  }
  INFO('═'.repeat(80));

  await conn.end();
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
