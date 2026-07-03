import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const SEP = '='.repeat(70);

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ─────────────────────────────────────────────────────────────────
  // PHASE 1: MATCHS TABLE — dates, orientations, schema
  // ─────────────────────────────────────────────────────────────────
  console.log(SEP);
  console.log('WC2026 DEEP AUDIT — PHASE 1: MATCHS TABLE');
  console.log(SEP);

  const [matchs] = await conn.query(`
    SELECT f.match_id, f.match_date, f.kickoff_utc, f.stage, f.group_letter,
           f.home_team_id, ht.name AS home_name, ht.fifa_code AS home_code,
           f.away_team_id, at.name AS away_name, at.fifa_code AS away_code,
           f.status, f.venue_id, f.is_host_home
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    ORDER BY f.match_date, f.match_id
  `);

  console.log(`\n[INPUT] Total matchs in DB: ${matchs.length}`);
  const byDate = {};
  for (const f of matchs) {
    const d = f.match_date instanceof Date
      ? f.match_date.toISOString().split('T')[0]
      : String(f.match_date).split('T')[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(f);
    console.log(`[FIX] ${f.match_id} | ${d} | ${f.home_code} (home) vs ${f.away_code} (away) | grp=${f.group_letter} | status=${f.status} | venue=${f.venue_id}`);
  }

  console.log('\n[STATE] Matchs grouped by date:');
  for (const [d, fxs] of Object.entries(byDate).sort()) {
    console.log(`  ${d}: ${fxs.length} match(s) — ${fxs.map(x => x.match_id).join(', ')}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // PHASE 2: ODDS SNAPSHOTS — per match, per book/model, per market
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('PHASE 2: ODDS SNAPSHOTS AUDIT');
  console.log(SEP);

  const [odds] = await conn.query(`
    SELECT o.match_id, o.book_id, o.market, o.selection, o.line,
           o.american_odds, o.implied_prob, o.snapshot_ts
    FROM wc2026_odds_snapshots o
    ORDER BY o.match_id, o.book_id, o.market, o.selection
  `);

  console.log(`\n[INPUT] Total odds rows: ${odds.length}`);

  const byMatch = {};
  for (const o of odds) {
    if (!byMatch[o.match_id]) byMatch[o.match_id] = { book: [], model: [] };
    if (Number(o.book_id) === 0) byMatch[o.match_id].model.push(o);
    else byMatch[o.match_id].book.push(o);
  }

  const allMatchIds = matchs.map(f => f.match_id);
  const seededMatchs = new Set(Object.keys(byMatch));

  let totalIssues = 0;
  const issueLog = [];

  console.log('\n[STATE] Per-match odds breakdown:');
  for (const f of matchs) {
    const d = f.match_date instanceof Date
      ? f.match_date.toISOString().split('T')[0]
      : String(f.match_date).split('T')[0];
    const data = byMatch[f.match_id] || { book: [], model: [] };

    const modelMarkets = [...new Set(data.model.map(o => o.market))];
    const bookMarkets = [...new Set(data.book.map(o => o.market))];

    // Detailed model odds
    const modelDetail = data.model.map(o =>
      `${o.market}:${o.selection}=${o.american_odds}(${Number(o.implied_prob).toFixed(4)})`
    ).join(' | ');
    const bookDetail = data.book.map(o =>
      `${o.market}:${o.selection}=${o.american_odds}(${Number(o.implied_prob).toFixed(4)})`
    ).join(' | ');

    // Validate: 1X2 must have HOME, DRAW, AWAY selections
    const model1X2 = data.model.filter(o => o.market === '1X2');
    const modelTotal = data.model.filter(o => o.market === 'TOTAL');
    const book1X2 = data.book.filter(o => o.market === '1X2');
    const bookTotal = data.book.filter(o => o.market === 'TOTAL');

    const flags = [];

    // Model 1X2 checks
    if (model1X2.length === 0) flags.push('NO_MODEL_1X2');
    else {
      const sels = model1X2.map(o => o.selection);
      if (!sels.includes('HOME')) flags.push('MODEL_1X2_MISSING_HOME');
      if (!sels.includes('DRAW')) flags.push('MODEL_1X2_MISSING_DRAW');
      if (!sels.includes('AWAY')) flags.push('MODEL_1X2_MISSING_AWAY');
      // Prob sum check
      const probSum = model1X2.reduce((s, o) => s + Number(o.implied_prob), 0);
      if (Math.abs(probSum - 1.0) > 0.02) flags.push(`MODEL_1X2_PROB_SUM=${probSum.toFixed(6)}`);
    }

    // Model TOTAL checks
    if (modelTotal.length === 0) flags.push('NO_MODEL_TOTAL');
    else {
      const sels = modelTotal.map(o => o.selection);
      if (!sels.includes('OVER')) flags.push('MODEL_TOTAL_MISSING_OVER');
      if (!sels.includes('UNDER')) flags.push('MODEL_TOTAL_MISSING_UNDER');
      // Line consistency
      const lines = [...new Set(modelTotal.map(o => Number(o.line)))];
      if (lines.length > 1) flags.push(`MODEL_TOTAL_INCONSISTENT_LINES=${lines.join(',')}`);
      const totalLine = modelTotal[0]?.line;
      if (totalLine === null || totalLine === undefined) flags.push('MODEL_TOTAL_NULL_LINE');
    }

    // Book 1X2 checks
    if (book1X2.length === 0) flags.push('NO_BOOK_1X2');
    else {
      const sels = book1X2.map(o => o.selection);
      if (!sels.includes('HOME')) flags.push('BOOK_1X2_MISSING_HOME');
      if (!sels.includes('DRAW')) flags.push('BOOK_1X2_MISSING_DRAW');
      if (!sels.includes('AWAY')) flags.push('BOOK_1X2_MISSING_AWAY');
    }

    // Book TOTAL checks
    if (bookTotal.length === 0) flags.push('NO_BOOK_TOTAL');
    else {
      const sels = bookTotal.map(o => o.selection);
      if (!sels.includes('OVER')) flags.push('BOOK_TOTAL_MISSING_OVER');
      if (!sels.includes('UNDER')) flags.push('BOOK_TOTAL_MISSING_UNDER');
    }

    const verdict = flags.length === 0 ? '✓ OK' : `✗ ISSUES: ${flags.join(', ')}`;
    if (flags.length > 0) {
      totalIssues++;
      issueLog.push({ match: f.match_id, date: d, home: f.home_code, away: f.away_code, flags });
    }

    console.log(`\n  [${f.match_id}] ${d} | ${f.home_code} vs ${f.away_code} | ${verdict}`);
    console.log(`    MODEL: ${data.model.length} rows | ${modelDetail || 'NONE'}`);
    console.log(`    BOOK:  ${data.book.length} rows | ${bookDetail || 'NONE'}`);
  }

  const noOdds = allMatchIds.filter(id => !seededMatchs.has(id));
  console.log(`\n[OUTPUT] Matchs with ZERO odds rows: ${noOdds.length} — ${noOdds.join(', ') || 'none'}`);
  console.log(`[OUTPUT] Matchs with issues: ${totalIssues}`);
  if (issueLog.length > 0) {
    console.log('\n[VERIFY] ISSUE SUMMARY:');
    for (const i of issueLog) {
      console.log(`  FAIL: ${i.match} (${i.date}) ${i.home} vs ${i.away} — ${i.flags.join(', ')}`);
    }
  } else {
    console.log('[VERIFY] PASS — All seeded matchs have correct model + book odds');
  }

  // ─────────────────────────────────────────────────────────────────
  // PHASE 3: LINEUPS AUDIT
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('PHASE 3: LINEUPS AUDIT');
  console.log(SEP);

  const [lineups] = await conn.query(`
    SELECT l.match_id, l.team_id, t.fifa_code, t.name AS team_name,
           COUNT(*) AS player_count,
           SUM(CASE WHEN l.is_starter = 1 THEN 1 ELSE 0 END) AS starters,
           SUM(CASE WHEN l.is_starter = 0 THEN 1 ELSE 0 END) AS bench
    FROM wc2026_lineups l
    JOIN wc2026_teams t ON l.team_id = t.team_id
    GROUP BY l.match_id, l.team_id, t.fifa_code, t.name
    ORDER BY l.match_id, l.team_id
  `);

  console.log(`\n[INPUT] Lineup team-match combos: ${lineups.length}`);
  const lineupByMatch = {};
  for (const l of lineups) {
    if (!lineupByMatch[l.match_id]) lineupByMatch[l.match_id] = [];
    lineupByMatch[l.match_id].push(l);
    console.log(`[LINEUP] ${l.match_id} | ${l.fifa_code} | players=${l.player_count} (starters=${l.starters}, bench=${l.bench})`);
  }

  const noLineups = allMatchIds.filter(id => !lineupByMatch[id]);
  console.log(`\n[OUTPUT] Matchs with NO lineups: ${noLineups.length} — ${noLineups.join(', ') || 'none'}`);

  await conn.end();
  console.log('\n' + SEP);
  console.log('AUDIT COMPLETE');
  console.log(SEP);
}

main().catch(e => { console.error('[FATAL]', e.message, e.stack); process.exit(1); });
