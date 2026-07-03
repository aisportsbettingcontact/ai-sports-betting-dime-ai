/**
 * auditJune25.mjs — Final cross-validation audit for June 25 DK odds
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[AUDIT_JUNE25]';

function parseDbUrl(url) {
  const u = new URL(url);
  return { host: u.hostname, port: parseInt(u.port || '3306'), user: u.username, password: u.password, database: u.pathname.slice(1).split('?')[0], ssl: { rejectUnauthorized: false } };
}

(async () => {
  const conn = await mysql.createConnection(parseDbUrl(process.env.DATABASE_URL));

  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} JUNE 25 FINAL AUDIT — ORIENTATION + DK ODDS COVERAGE`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  // 1. Match orientation audit
  const [matchs] = await conn.query(`
    SELECT 
      f.match_id, f.kickoff_utc, f.group_letter,
      ht.team_id AS home_id, ht.fifa_code AS home_fifa, ht.name AS home_name,
      at.team_id AS away_id, at.fifa_code AS away_fifa, at.name AS away_name,
      v.city AS venue_city
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
    WHERE f.match_date = '2026-06-25'
    ORDER BY f.kickoff_utc
  `);

  // Expected orientations after swap
  const EXPECTED = {
    'wc26-g-057': { home: 'cuw', away: 'civ', homeLabel: 'Curacao', awayLabel: 'Ivory Coast' },
    'wc26-g-058': { home: 'ecu', away: 'ger', homeLabel: 'Ecuador', awayLabel: 'Germany' },
    'wc26-g-059': { home: 'jpn', away: 'swe', homeLabel: 'Japan', awayLabel: 'Sweden' },
    'wc26-g-060': { home: 'tun', away: 'ned', homeLabel: 'Tunisia', awayLabel: 'Netherlands' },
    'wc26-g-055': { home: 'tur', away: 'usa', homeLabel: 'Turkey', awayLabel: 'USA' },
    'wc26-g-056': { home: 'par', away: 'aus', homeLabel: 'Paraguay', awayLabel: 'Australia' },
  };

  console.log(`${TAG} [STEP 1] ORIENTATION AUDIT:`);
  let orientErrors = 0;
  for (const f of matchs) {
    const exp = EXPECTED[f.match_id];
    if (!exp) { console.log(`${TAG}   UNKNOWN match: ${f.match_id}`); continue; }
    const ok = f.home_id === exp.home && f.away_id === exp.away;
    const status = ok ? 'PASS ✓' : 'FAIL ✗';
    console.log(`${TAG}   ${f.match_id} | ${f.home_fifa}(home) vs ${f.away_fifa}(away) | ${status}`);
    if (!ok) {
      console.log(`${TAG}     EXPECTED: home=${exp.home} away=${exp.away}`);
      console.log(`${TAG}     ACTUAL:   home=${f.home_id} away=${f.away_id}`);
      orientErrors++;
    }
  }
  console.log(`${TAG}   Orientation errors: ${orientErrors}\n`);

  // 2. DK odds coverage audit
  const [coverage] = await conn.query(`
    SELECT 
      f.match_id,
      ht.fifa_code AS home_fifa,
      at.fifa_code AS away_fifa,
      COUNT(o.id) AS dk_rows,
      SUM(CASE WHEN o.market='1X2' AND o.selection='home' THEN 1 ELSE 0 END) AS home_ml,
      SUM(CASE WHEN o.market='1X2' AND o.selection='draw' THEN 1 ELSE 0 END) AS draw_ml,
      SUM(CASE WHEN o.market='1X2' AND o.selection='away' THEN 1 ELSE 0 END) AS away_ml,
      SUM(CASE WHEN o.market='1X2' AND o.selection='no_draw' THEN 1 ELSE 0 END) AS no_draw,
      SUM(CASE WHEN o.market='TOTAL' AND o.selection='over' THEN 1 ELSE 0 END) AS total_over,
      SUM(CASE WHEN o.market='TOTAL' AND o.selection='under' THEN 1 ELSE 0 END) AS total_under,
      SUM(CASE WHEN o.market='ASIAN_HANDICAP' AND o.selection='home' THEN 1 ELSE 0 END) AS spread_home,
      SUM(CASE WHEN o.market='ASIAN_HANDICAP' AND o.selection='away' THEN 1 ELSE 0 END) AS spread_away,
      SUM(CASE WHEN o.market='DOUBLE_CHANCE' AND o.selection='home_draw' THEN 1 ELSE 0 END) AS dc_home,
      SUM(CASE WHEN o.market='DOUBLE_CHANCE' AND o.selection='away_draw' THEN 1 ELSE 0 END) AS dc_away,
      SUM(CASE WHEN o.market='BTTS' AND o.selection='yes' THEN 1 ELSE 0 END) AS btts_yes,
      SUM(CASE WHEN o.market='BTTS' AND o.selection='no' THEN 1 ELSE 0 END) AS btts_no
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    LEFT JOIN wc2026_odds_snapshots o ON f.match_id = o.match_id AND o.book_id = 68
    WHERE f.match_date = '2026-06-25'
    GROUP BY f.match_id, ht.fifa_code, at.fifa_code
    ORDER BY f.kickoff_utc
  `);

  console.log(`${TAG} [STEP 2] DK ODDS COVERAGE AUDIT:`);
  let coverageErrors = 0;
  for (const r of coverage) {
    const allOk = r.home_ml == 1 && r.draw_ml == 1 && r.away_ml == 1 && r.no_draw == 1 &&
                  r.total_over == 1 && r.total_under == 1 &&
                  r.spread_home == 1 && r.spread_away == 1 &&
                  r.dc_home == 1 && r.dc_away == 1 &&
                  r.btts_yes == 1 && r.btts_no == 1;
    const status = allOk ? 'ALL 12 MARKETS ✓' : 'MISSING MARKETS ✗';
    console.log(`${TAG}   ${r.match_id} | ${r.home_fifa}(home) vs ${r.away_fifa}(away) | dk_rows=${r.dk_rows} | ${status}`);
    if (!allOk) {
      console.log(`${TAG}     home_ml=${r.home_ml} draw=${r.draw_ml} away_ml=${r.away_ml} no_draw=${r.no_draw}`);
      console.log(`${TAG}     total_over=${r.total_over} total_under=${r.total_under}`);
      console.log(`${TAG}     spread_home=${r.spread_home} spread_away=${r.spread_away}`);
      console.log(`${TAG}     dc_home=${r.dc_home} dc_away=${r.dc_away}`);
      console.log(`${TAG}     btts_yes=${r.btts_yes} btts_no=${r.btts_no}`);
      coverageErrors++;
    }
  }
  console.log(`${TAG}   Coverage errors: ${coverageErrors}\n`);

  // 3. Spot-check odds values for each match
  console.log(`${TAG} [STEP 3] ODDS VALUE SPOT-CHECK:`);
  const EXPECTED_ODDS = {
    'wc26-g-057': { home_ml: 1700, draw: 700, away_ml: -650, no_draw: -1400, total_line: 3.5, over: 125, under: -155, home_spread: 2.5, home_spread_odds: -150, away_spread: -2.5, away_spread_odds: 120, dc_home: 400, dc_away: -5000, btts_yes: 145, btts_no: -185 },
    'wc26-g-058': { home_ml: 425, draw: 400, away_ml: -190, no_draw: -550, total_line: 2.5, over: -160, under: 130, home_spread: 1.5, home_spread_odds: -180, away_spread: -1.5, away_spread_odds: 140, dc_home: 145, dc_away: -600, btts_yes: -135, btts_no: 105 },
    'wc26-g-059': { home_ml: -115, draw: 255, away_ml: 350, no_draw: -330, total_line: 2.5, over: -120, under: -105, home_spread: -1.5, home_spread_odds: 245, away_spread: 1.5, away_spread_odds: -320, dc_home: -475, dc_away: -110, btts_yes: -155, btts_no: 125 },
    'wc26-g-060': { home_ml: 2500, draw: 1000, away_ml: -1100, no_draw: -2500, total_line: 3.5, over: 100, under: -125, home_spread: 2.5, home_spread_odds: -110, away_spread: -2.5, away_spread_odds: -115, dc_home: 550, dc_away: -20000, btts_yes: 160, btts_no: -205 },
    'wc26-g-055': { home_ml: 275, draw: 310, away_ml: -115, no_draw: -400, total_line: 2.5, over: -145, under: 120, home_spread: 1.5, home_spread_odds: -300, away_spread: -1.5, away_spread_odds: 225, dc_home: -110, dc_away: -360, btts_yes: -155, btts_no: 120 },
    'wc26-g-056': { home_ml: 180, draw: 125, away_ml: 310, no_draw: -155, total_line: 1.5, over: -155, under: 125, home_spread: -1.5, home_spread_odds: 650, away_spread: 1.5, away_spread_odds: -1200, dc_home: -425, dc_away: -230, btts_yes: 130, btts_no: -165 },
  };

  let valueErrors = 0;
  for (const fid of Object.keys(EXPECTED_ODDS)) {
    const exp = EXPECTED_ODDS[fid];
    const [rows] = await conn.query(
      `SELECT market, selection, line, american_odds FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = 68`,
      [fid]
    );
    const get = (market, selection) => {
      const r = rows.find(x => x.market === market && x.selection === selection);
      return r ? r.american_odds : null;
    };
    const getLine = (market, selection) => {
      const r = rows.find(x => x.market === market && x.selection === selection);
      return r ? parseFloat(r.line) : null;
    };

    const checks = [
      ['1X2/home', get('1X2','home'), exp.home_ml],
      ['1X2/draw', get('1X2','draw'), exp.draw],
      ['1X2/away', get('1X2','away'), exp.away_ml],
      ['1X2/no_draw', get('1X2','no_draw'), exp.no_draw],
      ['TOTAL/over', get('TOTAL','over'), exp.over],
      ['TOTAL/under', get('TOTAL','under'), exp.under],
      ['TOTAL line', getLine('TOTAL','over'), exp.total_line],
      ['SPREAD/home', get('ASIAN_HANDICAP','home'), exp.home_spread_odds],
      ['SPREAD/home line', getLine('ASIAN_HANDICAP','home'), exp.home_spread],
      ['SPREAD/away', get('ASIAN_HANDICAP','away'), exp.away_spread_odds],
      ['SPREAD/away line', getLine('ASIAN_HANDICAP','away'), exp.away_spread],
      ['DC/home_draw', get('DOUBLE_CHANCE','home_draw'), exp.dc_home],
      ['DC/away_draw', get('DOUBLE_CHANCE','away_draw'), exp.dc_away],
      ['BTTS/yes', get('BTTS','yes'), exp.btts_yes],
      ['BTTS/no', get('BTTS','no'), exp.btts_no],
    ];

    let matchErrors = 0;
    for (const [label, actual, expected] of checks) {
      if (actual !== expected) {
        console.log(`${TAG}   ${fid} ${label}: EXPECTED=${expected} ACTUAL=${actual} ✗`);
        matchErrors++;
        valueErrors++;
      }
    }
    if (matchErrors === 0) {
      console.log(`${TAG}   ${fid}: ALL 15 VALUE CHECKS PASS ✓`);
    }
  }
  console.log(`${TAG}   Value errors: ${valueErrors}\n`);

  // Final verdict
  const totalErrors = orientErrors + coverageErrors + valueErrors;
  console.log(`${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} FINAL VERDICT: ${totalErrors === 0 ? 'ALL CHECKS PASSED — 100% ACCURATE ✓' : `${totalErrors} ERRORS FOUND ✗`}`);
  console.log(`${TAG}   Orientation: ${orientErrors === 0 ? 'PASS' : 'FAIL'} | Coverage: ${coverageErrors === 0 ? 'PASS' : 'FAIL'} | Values: ${valueErrors === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  await conn.end();
  process.exit(totalErrors > 0 ? 1 : 0);
})().catch(e => {
  console.error(`${TAG} [FATAL]`, e.message);
  process.exit(1);
});
