'use strict';
const mysql = require('mysql2/promise');
require('dotenv').config();

// Simulate exactly what the router's buildOddsMap does
// to confirm what the component receives for all 4 June 18 fixtures

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[INPUT] Connected. Simulating router buildOddsMap for June 18 fixtures.\n');

  const fixtureIds = ['wc26-g-025','wc26-g-027','wc26-g-028','wc26-g-026'];

  // Pull ALL DK odds rows ordered by snapshot_ts DESC — exactly as router does
  const [dkRows] = await conn.execute(`
    SELECT fixture_id, market, selection, american_odds, line, snapshot_ts
    FROM wc2026_odds_snapshots
    WHERE book_id = 68
    ORDER BY snapshot_ts DESC
  `);

  // Pull ALL MODEL odds rows ordered by snapshot_ts DESC
  const [modelRows] = await conn.execute(`
    SELECT fixture_id, market, selection, american_odds, line, snapshot_ts
    FROM wc2026_odds_snapshots
    WHERE book_id = 0
    ORDER BY snapshot_ts DESC
  `);

  function buildOddsMap(rows) {
    const map = {};
    const seen = new Set();
    for (const row of rows) {
      if (!fixtureIds.includes(row.fixture_id)) continue;
      if (!map[row.fixture_id]) map[row.fixture_id] = {};
      const key = `${row.fixture_id}:${row.market}:${row.selection}`;
      if (!seen.has(key)) {
        seen.add(key);
        const o = map[row.fixture_id];
        if (row.market === '1X2') {
          o[row.selection] = row.american_odds;
        } else if (row.market === 'TOTAL') {
          if (row.selection === 'over') { o.overLine = row.line; o.overOdds = row.american_odds; }
          else if (row.selection === 'under') { o.underOdds = row.american_odds; }
        }
      }
    }
    return map;
  }

  const dkMap = buildOddsMap(dkRows);
  const modelMap = buildOddsMap(modelRows);

  // Pull fixture team info
  const [fixtures] = await conn.execute(`
    SELECT f.fixture_id, f.kickoff_utc,
           ht.name AS home_name, ht.fifa_code AS home_code,
           at2.name AS away_name, at2.fifa_code AS away_code
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
    ORDER BY f.kickoff_utc
  `);

  // DK screenshot ground truth
  const GT = {
    'wc26-g-025': { homeCode:'CZE', awayCode:'RSA', homeML:-120, draw:260, awayML:380 },
    'wc26-g-027': { homeCode:'SUI', awayCode:'BIH', homeML:-180, draw:310, awayML:500 },
    'wc26-g-028': { homeCode:'CAN', awayCode:'QAT', homeML:-350, draw:475, awayML:1000 },
    'wc26-g-026': { homeCode:'MEX', awayCode:'KOR', homeML:105, draw:230, awayML:295 },
  };

  console.log('=== ROUTER OUTPUT → COMPONENT RENDER SIMULATION ===');
  console.log('Component convention: AWAY = top row, HOME = bottom row');
  console.log('');

  let allPass = true;

  for (const f of fixtures) {
    const dk = dkMap[f.fixture_id] || {};
    const model = modelMap[f.fixture_id] || {};
    const gt = GT[f.fixture_id];

    console.log(`${f.fixture_id}  |  ${f.kickoff_utc}`);
    console.log(`  FIXTURE: home=${f.home_name}(${f.home_code})  away=${f.away_name}(${f.away_code})`);
    console.log('');
    console.log('  SCORE PANEL:');
    console.log(`    TOP ROW  (away): ${f.away_name}(${f.away_code})`);
    console.log(`    BOT ROW  (home): ${f.home_name}(${f.home_code})`);
    console.log('');
    console.log('  ML COLUMN:');
    console.log(`    TOP ROW  (away): BOOK=${dk.away}  MODEL=${model.away}`);
    console.log(`    BOT ROW  (home): BOOK=${dk.home}  MODEL=${model.home}`);
    console.log('');
    console.log('  TOTAL COLUMN:');
    console.log(`    TOP ROW  (over):  BOOK=${dk.overOdds}  MODEL=${model.overOdds}  line=${dk.overLine ?? model.overLine ?? 'N/A'}`);
    console.log(`    BOT ROW  (under): BOOK=${dk.underOdds}  MODEL=${model.underOdds}`);
    console.log('');
    console.log('  DRAW COLUMN:');
    console.log(`    SINGLE ROW: BOOK=${dk.draw}  MODEL=${model.draw}`);
    console.log('');

    // Verify against GT
    const orientOK = f.home_code === gt.homeCode && f.away_code === gt.awayCode;
    const dkHomeOK = dk.home === gt.homeML;
    const dkAwayOK = dk.away === gt.awayML;
    const dkDrawOK = dk.draw === gt.draw;

    const pass = orientOK && dkHomeOK && dkAwayOK && dkDrawOK;
    if (!pass) allPass = false;

    console.log(`  [VERIFY] orientation=${orientOK?'PASS ✓':'FAIL ✗'}  dk.home=${dkHomeOK?'PASS ✓':'FAIL ✗ (got '+dk.home+' expected '+gt.homeML+')'}  dk.away=${dkAwayOK?'PASS ✓':'FAIL ✗ (got '+dk.away+' expected '+gt.awayML+')'}  dk.draw=${dkDrawOK?'PASS ✓':'FAIL ✗ (got '+dk.draw+' expected '+gt.draw+')'}`);
    console.log('');
    console.log('  WHAT USER SEES ON FEED:');
    console.log(`    TOP:    ${f.away_name.padEnd(22)} BOOK ML: ${String(dk.away).padStart(5)}  MODEL ML: ${String(model.away).padStart(5)}`);
    console.log(`    BOTTOM: ${f.home_name.padEnd(22)} BOOK ML: ${String(dk.home).padStart(5)}  MODEL ML: ${String(model.home).padStart(5)}`);
    console.log(`    DRAW:   ${' '.repeat(22)} BOOK:    ${String(dk.draw).padStart(5)}  MODEL:    ${String(model.draw).padStart(5)}`);
    console.log(`    TOTAL:  line=${dk.overLine ?? model.overLine ?? 'N/A'}  OVER BOOK=${dk.overOdds}  UNDER BOOK=${dk.underOdds}`);
    console.log('='.repeat(70));
  }

  console.log(`\n[OUTPUT] Overall: ${allPass ? 'ALL PASS ✓' : 'FAILURES DETECTED ✗'}`);
  await conn.end();
}

main().catch(err => { console.error('[FAIL]', err); process.exit(1); });
