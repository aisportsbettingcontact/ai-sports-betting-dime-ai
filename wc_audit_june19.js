const { createConnection } = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await createConnection(process.env.DATABASE_URL);

  // ── FIXTURE AUDIT ──────────────────────────────────────────────────────────
  const [fixtures] = await conn.query(`
    SELECT f.fixture_id, f.kickoff_utc,
      CONVERT_TZ(f.kickoff_utc, '+00:00', '-04:00') AS kickoff_edt,
      f.home_team_id, f.away_team_id,
      ht.name AS home_name, at.name AS away_name,
      ht.fifa_code AS home_code, at.fifa_code AS away_code,
      v.city AS venue_city, v.stadium AS venue_stadium,
      f.matchday, f.group_letter, f.status
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    LEFT JOIN wc2026_venues v ON v.venue_id = f.venue_id
    WHERE f.match_date = '2026-06-19'
    ORDER BY f.kickoff_utc
  `);

  console.log('\n[FIXTURE AUDIT] June 19, 2026 — 4 matches');
  console.log('='.repeat(80));
  for (const f of fixtures) {
    const edt = new Date(f.kickoff_edt);
    const h = edt.getHours();
    const m = String(edt.getMinutes()).padStart(2,'0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    const timeStr = `${h12}:${m} ${ampm} EDT`;
    console.log(`[${f.fixture_id}] ${f.home_name} (${f.home_code}) vs ${f.away_name} (${f.away_code})`);
    console.log(`  DB home_team_id=${f.home_team_id} away_team_id=${f.away_team_id}`);
    console.log(`  Kickoff UTC: ${f.kickoff_utc} → EDT: ${timeStr}`);
    console.log(`  Venue: ${f.venue_city} | ${f.venue_stadium}`);
    console.log(`  Group ${f.group_letter} | Matchday ${f.matchday} | Status: ${f.status}`);
  }

  // ── ODDS AUDIT ─────────────────────────────────────────────────────────────
  const [odds] = await conn.query(`
    SELECT o.fixture_id, o.book_id, o.market, o.selection, o.line, o.american_odds, o.implied_prob
    FROM wc2026_odds_snapshots o
    WHERE o.fixture_id IN ('wc26-g-029','wc26-g-030','wc26-g-031','wc26-g-032')
      AND o.market IN ('1X2','TOTAL','DOUBLE_CHANCE')
    ORDER BY o.fixture_id, o.market, o.book_id, o.selection
  `);

  // Group by fixture
  const byFixture = {};
  for (const row of odds) {
    const key = row.fixture_id;
    if (!byFixture[key]) byFixture[key] = [];
    byFixture[key].push(row);
  }

  const fixtureMap = {
    'wc26-g-029': 'USA(home) vs AUS(away)',
    'wc26-g-030': 'TUR(home) vs PAR(away)',
    'wc26-g-031': 'SCO(home) vs MAR(away)',
    'wc26-g-032': 'HAI(home) vs BRA(away)',
  };

  console.log('\n[ODDS AUDIT] All markets for June 19 fixtures');
  console.log('='.repeat(80));
  for (const [fid, rows] of Object.entries(byFixture)) {
    console.log(`\n--- ${fid}: ${fixtureMap[fid]} ---`);
    for (const r of rows) {
      const bookLabel = r.book_id === 68 ? 'DK  ' : (r.book_id === 0 ? 'MDL ' : `b${r.book_id}`);
      const lineStr = r.line ? ` line=${r.line}` : '';
      const implStr = r.implied_prob ? ` impl=${(parseFloat(r.implied_prob)*100).toFixed(2)}%` : '';
      console.log(`  [${bookLabel}] ${r.market.padEnd(15)} ${r.selection.padEnd(15)}${lineStr} => ${String(r.american_odds).padStart(6)}${implStr}`);
    }
  }

  // ── MODEL VALIDATION: 3-way probability check ─────────────────────────────
  console.log('\n[MODEL VALIDATION] 3-way probability sums');
  console.log('='.repeat(80));
  for (const [fid, rows] of Object.entries(byFixture)) {
    const modelRows = rows.filter(r => r.book_id === 0 && r.market === '1X2');
    const dkRows    = rows.filter(r => r.book_id === 68 && r.market === '1X2');
    const modelSum  = modelRows.reduce((s, r) => s + parseFloat(r.implied_prob), 0);
    const dkSum     = dkRows.reduce((s, r) => s + parseFloat(r.implied_prob), 0);
    const modelH    = modelRows.find(r => r.selection === 'home');
    const modelD    = modelRows.find(r => r.selection === 'draw');
    const modelA    = modelRows.find(r => r.selection === 'away');
    const dkH       = dkRows.find(r => r.selection === 'home');
    const dkD       = dkRows.find(r => r.selection === 'draw');
    const dkA       = dkRows.find(r => r.selection === 'away');
    console.log(`\n${fid}: ${fixtureMap[fid]}`);
    console.log(`  MODEL 1X2: home=${modelH?.american_odds} draw=${modelD?.american_odds} away=${modelA?.american_odds} | prob_sum=${modelSum.toFixed(4)}`);
    console.log(`  DK    1X2: home=${dkH?.american_odds} draw=${dkD?.american_odds} away=${dkA?.american_odds} | prob_sum=${dkSum.toFixed(4)}`);
    
    // Double Chance validation
    const dcModelHD = rows.find(r => r.book_id === 0 && r.market === 'DOUBLE_CHANCE' && r.selection === 'home_draw');
    const dcModelAD = rows.find(r => r.book_id === 0 && r.market === 'DOUBLE_CHANCE' && r.selection === 'away_draw');
    const dcDkHD    = rows.find(r => r.book_id === 68 && r.market === 'DOUBLE_CHANCE' && r.selection === 'home_draw');
    const dcDkAD    = rows.find(r => r.book_id === 68 && r.market === 'DOUBLE_CHANCE' && r.selection === 'away_draw');
    
    // Verify: home_draw (1X) = P(home) + P(draw) — computed from model fair probs
    if (modelH && modelD && modelA) {
      const rawSum = parseFloat(modelH.implied_prob) + parseFloat(modelD.implied_prob) + parseFloat(modelA.implied_prob);
      const fairH = parseFloat(modelH.implied_prob) / rawSum;
      const fairD = parseFloat(modelD.implied_prob) / rawSum;
      const fairA = parseFloat(modelA.implied_prob) / rawSum;
      const expected1X = fairH + fairD;
      const expectedX2 = fairA + fairD;
      const actual1X   = dcModelHD ? parseFloat(dcModelHD.implied_prob) : NaN;
      const actualX2   = dcModelAD ? parseFloat(dcModelAD.implied_prob) : NaN;
      console.log(`  DC MODEL: home_draw(1X) expected=${(expected1X*100).toFixed(2)}% actual=${(actual1X*100).toFixed(2)}% | away_draw(X2) expected=${(expectedX2*100).toFixed(2)}% actual=${(actualX2*100).toFixed(2)}%`);
      const err1X = Math.abs(expected1X - actual1X);
      const errX2 = Math.abs(expectedX2 - actualX2);
      console.log(`  DC VERIFY: 1X err=${(err1X*100).toFixed(3)}pp ${err1X < 0.005 ? 'PASS' : 'FAIL'} | X2 err=${(errX2*100).toFixed(3)}pp ${errX2 < 0.005 ? 'PASS' : 'FAIL'}`);
    }
    
    console.log(`  DC MODEL: home_draw=${dcModelHD?.american_odds} away_draw=${dcModelAD?.american_odds}`);
    console.log(`  DC DK:    home_draw=${dcDkHD?.american_odds} away_draw=${dcDkAD?.american_odds}`);
    
    // Total line check
    const dkTotal = rows.find(r => r.book_id === 68 && r.market === 'TOTAL' && r.selection === 'over');
    const mdlTotal = rows.find(r => r.book_id === 0 && r.market === 'TOTAL' && r.selection === 'over');
    console.log(`  TOTAL: DK line=${dkTotal?.line} over=${dkTotal?.american_odds} | MODEL line=${mdlTotal?.line} over=${mdlTotal?.american_odds}`);
  }

  await conn.end();
  console.log('\n[AUDIT COMPLETE]');
})().catch(e => { console.error('[ERROR]', e.message, e.stack); process.exit(1); });
