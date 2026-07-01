/**
 * audit_bookmodel_pipeline.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * 500x FORENSIC AUDIT — Book/Model Line Population Pipeline
 *
 * LAYER 1: DB — actual scores, frozen_book_odds columns, model_projections columns
 * LAYER 2: SERVER — wc2026Router.ts fixturesByDate query, column aliases, JOIN
 * LAYER 3: FRONTEND — how the feed card reads and renders book/model lines
 *
 * ZERO HALLUCINATION. Every value traced to its source.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';

const logLines = [];
function ts() { return new Date().toISOString(); }
function log(tag, msg) {
  const line = `[${ts()}] [${String(tag).padEnd(10)}] ${msg}`;
  console.log(line); logLines.push(line);
}
function banner(msg) {
  const b = '═'.repeat(100);
  [b, `  ${msg}`, b].forEach(l => log('BANNER', l));
}
function pass(msg) { log('✅ PASS', msg); }
function fail(msg) { log('❌ FAIL', msg); }
function warn(msg) { log('⚠️  WARN', msg); }

// ── GROUND TRUTH: Correct actual results ─────────────────────────────────────
const CORRECT_RESULTS = {
  'wc26-r32-073': { homeScore: 0, awayScore: 1, home: 'South Africa', away: 'Canada',    label: 'RSA 0-1 CAN' },
  'wc26-r32-074': { homeScore: 2, awayScore: 1, home: 'Brazil',       away: 'Japan',     label: 'BRA 2-1 JPN' },
  'wc26-r32-075': { homeScore: 3, awayScore: 0, home: 'Germany',      away: 'Paraguay',  label: 'GER 3-0 PAR' },
  'wc26-r32-076': { homeScore: 2, awayScore: 1, home: 'Netherlands',  away: 'Morocco',   label: 'NED 2-1 MAR' },
  'wc26-r32-077': { homeScore: 2, awayScore: 0, home: 'Norway',       away: 'Ivory Coast', label: 'NOR 2-0 CIV' },
  'wc26-r32-078': { homeScore: 2, awayScore: 0, home: 'France',       away: 'Sweden',    label: 'FRA 2-0 SWE' },
  'wc26-r32-079': { homeScore: 2, awayScore: 0, home: 'Mexico',       away: 'Ecuador',   label: 'MEX 2-0 ECU' },
};

// ── EXPECTED BOOK ODDS COLUMNS ────────────────────────────────────────────────
const BOOK_COLS = [
  'book_home_ml','book_draw_ml','book_away_ml',
  'book_spread_line','book_home_spread_odds','book_away_spread_odds',
  'book_total_line','book_over_odds','book_under_odds',
  'book_btts_yes_odds','book_btts_no_odds',
  'book_dc_1x_odds','book_dc_x2_odds',
  'book_no_draw_home_odds','book_no_draw_away_odds',
  'to_advance_home_odds','to_advance_away_odds',
];

// ── EXPECTED MODEL PROJECTION COLUMNS ────────────────────────────────────────
const MODEL_COLS = [
  'proj_home_score','proj_away_score','proj_total','proj_spread',
  'home_win_prob','draw_prob','away_win_prob',
  'over_2_5','under_2_5','btts_prob',
  'model_home_ml','model_draw_ml','model_away_ml',
  'model_spread','model_total',
  'over_odds','under_odds',
  'home_spread_odds','away_spread_odds',
  'btts_yes_odds','btts_no_odds',
  'to_advance_home_prob','to_advance_away_prob',
  'to_advance_home_odds','to_advance_away_odds',
  'nv_dc_1x','nv_dc_x2','dc_1x_odds','dc_x2_odds',
  'nv_no_draw_home','nv_no_draw_away','no_draw_home_odds','no_draw_away_odds',
  'is_frozen',
];

const ALL_FIDS = Object.keys(CORRECT_RESULTS);
const JUL1_FIDS = ['wc26-r32-080','wc26-r32-081','wc26-r32-082'];

async function main() {
  banner('LAYER 1A — DB: Actual Scores Validation');

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  log('INIT', 'DB connected');

  // ── Check actual scores in DB ─────────────────────────────────────────────
  const [dbScores] = await conn.query(`
    SELECT f.fixture_id, f.home_score, f.away_score, f.status,
           th.name as home_name, ta.name as away_name
    FROM wc2026_fixtures f
    JOIN wc2026_teams th ON f.home_team_id = th.team_id
    JOIN wc2026_teams ta ON f.away_team_id = ta.team_id
    WHERE f.fixture_id IN (?)
    ORDER BY f.match_date, f.kickoff_utc
  `, [ALL_FIDS]);

  log('INPUT', `DB returned ${dbScores.length} fixture rows`);
  let scoreErrors = 0;
  for (const row of dbScores) {
    const expected = CORRECT_RESULTS[row.fixture_id];
    const dbH = row.home_score;
    const dbA = row.away_score;
    const expH = expected.homeScore;
    const expA = expected.awayScore;
    const match = dbH === expH && dbA === expA;
    const label = `${row.fixture_id} | ${row.home_name} ${dbH}-${dbA} ${row.away_name}`;
    if (match) {
      pass(`Score OK: ${label} | Expected: ${expected.label}`);
    } else {
      fail(`Score MISMATCH: ${label} | Expected: ${expected.label} (${expH}-${expA})`);
      scoreErrors++;
    }
    log('STATE', `  Status: ${row.status}`);
  }
  log('OUTPUT', `Score validation: ${scoreErrors === 0 ? 'ALL PASS' : scoreErrors + ' ERRORS'}`);

  // ── Check frozen_book_odds for all 7 historical + 3 Jul 1 fixtures ────────
  banner('LAYER 1B — DB: frozen_book_odds Column Completeness');

  const checkFids = [...ALL_FIDS, ...JUL1_FIDS];
  const [bookRows] = await conn.query(`
    SELECT * FROM wc2026_frozen_book_odds WHERE fixture_id IN (?)
  `, [checkFids]);

  log('INPUT', `frozen_book_odds rows: ${bookRows.length} for ${checkFids.length} fixtures`);

  let bookErrors = 0;
  for (const fid of checkFids) {
    const row = bookRows.find(r => r.fixture_id === fid);
    if (!row) {
      fail(`NO BOOK ROW: ${fid}`);
      bookErrors++;
      continue;
    }
    const nullCols = BOOK_COLS.filter(col => row[col] === null || row[col] === undefined);
    const zeroCols = BOOK_COLS.filter(col => row[col] === 0 && col !== 'book_spread_line');
    if (nullCols.length === 0 && zeroCols.length === 0) {
      pass(`Book odds complete: ${fid}`);
    } else {
      if (nullCols.length > 0) {
        fail(`Book odds NULL columns: ${fid} → [${nullCols.join(', ')}]`);
        bookErrors++;
      }
      if (zeroCols.length > 0) {
        warn(`Book odds ZERO columns: ${fid} → [${zeroCols.join(', ')}]`);
      }
    }
    // Log all values
    BOOK_COLS.forEach(col => {
      const val = row[col];
      const status = val === null ? '❌ NULL' : val === undefined ? '❌ UNDEF' : `✅ ${val}`;
      log('DATA', `  ${fid}.${col} = ${status}`);
    });
  }
  log('OUTPUT', `Book odds validation: ${bookErrors === 0 ? 'ALL PASS' : bookErrors + ' ERRORS'}`);

  // ── Check model_projections for all 7 historical + 3 Jul 1 fixtures ───────
  banner('LAYER 1C — DB: model_projections Column Completeness');

  const [modelRows] = await conn.query(`
    SELECT * FROM wc2026_model_projections
    WHERE fixture_id IN (?)
    ORDER BY fixture_id, modeled_at DESC
  `, [checkFids]);

  log('INPUT', `model_projections rows: ${modelRows.length} for ${checkFids.length} fixtures`);

  let modelErrors = 0;
  const seenFids = new Set();
  for (const row of modelRows) {
    const fid = row.fixture_id;
    if (seenFids.has(fid)) continue; // only check latest
    seenFids.add(fid);

    const nullCols = MODEL_COLS.filter(col => row[col] === null || row[col] === undefined);
    if (nullCols.length === 0) {
      pass(`Model projection complete: ${fid} | v${row.model_version}`);
    } else {
      fail(`Model projection NULL columns: ${fid} | v${row.model_version} → [${nullCols.join(', ')}]`);
      modelErrors++;
    }
    MODEL_COLS.forEach(col => {
      const val = row[col];
      const status = val === null ? '❌ NULL' : val === undefined ? '❌ UNDEF' : `✅ ${val}`;
      log('DATA', `  ${fid}.${col} = ${status}`);
    });
  }

  // Check which fixtures have NO model rows at all
  for (const fid of checkFids) {
    if (!seenFids.has(fid)) {
      fail(`NO MODEL ROW: ${fid}`);
      modelErrors++;
    }
  }
  log('OUTPUT', `Model projection validation: ${modelErrors === 0 ? 'ALL PASS' : modelErrors + ' ERRORS'}`);

  // ── Check ESPN matches for actual score confirmation ──────────────────────
  banner('LAYER 1D — DB: ESPN Match Scores vs Actual Results');

  const espnIds = dbScores.map(r => r.espn_event_id ?? null).filter(Boolean);
  // Get ESPN IDs from fixtures
  const [fixtureEspn] = await conn.query(`
    SELECT fixture_id, espn_event_id FROM wc2026_fixtures WHERE fixture_id IN (?)
  `, [ALL_FIDS]);

  const espnIdList = fixtureEspn.map(r => r.espn_event_id).filter(Boolean);
  log('INPUT', `ESPN IDs for 7 matches: ${espnIdList.join(', ')}`);

  if (espnIdList.length > 0) {
    const [espnMatches] = await conn.query(`
      SELECT matchId, homeTeamAbbrev, awayTeamAbbrev, homeScore, awayScore, statusState, statusDetail
      FROM wc2026_espn_matches WHERE matchId IN (?)
    `, [espnIdList]);

    log('STATE', `ESPN match rows: ${espnMatches.length}`);
    const fidByEspn = {};
    fixtureEspn.forEach(r => { fidByEspn[r.espn_event_id] = r.fixture_id; });

    for (const em of espnMatches) {
      const fid = fidByEspn[em.matchId];
      const expected = CORRECT_RESULTS[fid];
      if (!expected) { warn(`No expected result for ESPN ${em.matchId}`); continue; }
      const espnH = parseInt(em.homeScore);
      const espnA = parseInt(em.awayScore);
      const match = espnH === expected.homeScore && espnA === expected.awayScore;
      if (match) {
        pass(`ESPN score matches: ${fid} | ${em.homeTeamAbbrev} ${espnH}-${espnA} ${em.awayTeamAbbrev} | ${em.statusDetail}`);
      } else {
        fail(`ESPN score MISMATCH: ${fid} | ESPN: ${em.homeTeamAbbrev} ${espnH}-${espnA} ${em.awayTeamAbbrev} | Expected: ${expected.label}`);
      }
    }
  }

  await conn.end();
  log('INIT', 'DB connection closed');

  // ══════════════════════════════════════════════════════════════════════════
  banner('LAYER 2 — SERVER: wc2026Router.ts Query Trace');
  // ══════════════════════════════════════════════════════════════════════════

  // Read the actual router file and trace the query
  const routerPath = '/home/ubuntu/ai-sports-betting/server/wc2026/wc2026Router.ts';
  const routerContent = fs.existsSync(routerPath) ? fs.readFileSync(routerPath, 'utf8') : null;

  if (!routerContent) {
    fail('Router file not found: ' + routerPath);
  } else {
    pass('Router file found: ' + routerPath);
    log('STATE', `Router file size: ${routerContent.length} chars`);

    // Find fixturesByDate procedure
    const fidxByDateIdx = routerContent.indexOf('fixturesByDate');
    if (fidxByDateIdx === -1) {
      fail('fixturesByDate procedure NOT FOUND in router');
    } else {
      pass('fixturesByDate procedure found at char ' + fidxByDateIdx);
    }

    // Check how book odds are queried
    const bookOddsQuery = routerContent.match(/wc2026_frozen_book_odds[\s\S]{0,500}/);
    if (bookOddsQuery) {
      log('DATA', 'Book odds query snippet:\n' + bookOddsQuery[0].substring(0, 300));
    }

    // Check how model projections are queried
    const modelQuery = routerContent.match(/wc2026_model_projections[\s\S]{0,500}/);
    if (modelQuery) {
      log('DATA', 'Model projections query snippet:\n' + modelQuery[0].substring(0, 300));
    }

    // Check column selections for book odds
    const bookSelect = routerContent.match(/select\([^)]*book[^)]*\)/gi);
    if (bookSelect) {
      log('DATA', 'Book select calls: ' + bookSelect.join(' | '));
    }

    // Check for spread/total/btts column references
    const spreadRef = routerContent.includes('book_spread_line') || routerContent.includes('bookSpreadLine');
    const totalRef = routerContent.includes('book_total_line') || routerContent.includes('bookTotalLine');
    const bttsRef = routerContent.includes('book_btts_yes_odds') || routerContent.includes('bookBttsYesOdds');
    const modelSpreadRef = routerContent.includes('model_spread') || routerContent.includes('modelSpread');
    const modelTotalRef = routerContent.includes('model_total') || routerContent.includes('modelTotal');

    spreadRef ? pass('Router references book_spread_line') : fail('Router MISSING book_spread_line reference');
    totalRef ? pass('Router references book_total_line') : fail('Router MISSING book_total_line reference');
    bttsRef ? pass('Router references book_btts_yes_odds') : fail('Router MISSING book_btts_yes_odds reference');
    modelSpreadRef ? pass('Router references model_spread') : fail('Router MISSING model_spread reference');
    modelTotalRef ? pass('Router references model_total') : fail('Router MISSING model_total reference');

    // Check response shape — what fields are returned to frontend
    const returnMatch = routerContent.match(/return\s*\{[\s\S]{0,2000}/);
    if (returnMatch) {
      log('DATA', 'Router return shape (first 500 chars):\n' + returnMatch[0].substring(0, 500));
    }

    // Save full router for analysis
    fs.writeFileSync('/home/ubuntu/wc2026_router_audit.txt', routerContent);
    log('OUTPUT', 'Router saved to /home/ubuntu/wc2026_router_audit.txt');
  }

  // ══════════════════════════════════════════════════════════════════════════
  banner('LAYER 3 — FRONTEND: Feed Card Book/Model Line Rendering');
  // ══════════════════════════════════════════════════════════════════════════

  // Find all WC2026 frontend files
  const frontendFiles = [
    '/home/ubuntu/ai-sports-betting/client/src/pages/WorldCup2026.tsx',
    '/home/ubuntu/ai-sports-betting/client/src/components/WcFeedInline.tsx',
    '/home/ubuntu/ai-sports-betting/client/src/components/WcMatchCard.tsx',
    '/home/ubuntu/ai-sports-betting/client/src/components/WcProjectionCard.tsx',
  ].filter(f => fs.existsSync(f));

  log('INPUT', `Frontend files found: ${frontendFiles.length}`);
  frontendFiles.forEach(f => log('INPUT', '  ' + f));

  // Also search for any WC-related component files
  const { execSync } = await import('child_process');
  try {
    const found = execSync('find /home/ubuntu/ai-sports-betting/client/src -name "*.tsx" | xargs grep -l "bookOdds\\|book_home_ml\\|bookHomeMl\\|modelOdds\\|model_home_ml\\|modelHomeMl\\|frozenBook\\|frozen_book" 2>/dev/null').toString().trim();
    log('INPUT', 'Files referencing book/model odds:\n' + found);
  } catch(e) { log('WARN', 'grep search failed: ' + e.message); }

  for (const fp of frontendFiles) {
    const content = fs.readFileSync(fp, 'utf8');
    log('STATE', `\nAuditing: ${fp} (${content.length} chars)`);

    // Check for book line field references
    const bookFields = ['bookHomeMl','book_home_ml','bookHomeML','bookDrawMl','bookAwayMl',
      'bookSpreadLine','book_spread_line','bookTotalLine','book_total_line',
      'bookBttsYesOdds','book_btts_yes_odds','bookOverOdds','bookUnderOdds',
      'toAdvanceHomeOdds','to_advance_home_odds'];
    const modelFields = ['modelHomeMl','model_home_ml','modelHomeML','modelDrawMl','modelAwayMl',
      'modelSpread','model_spread','modelTotal','model_total',
      'modelOverOdds','modelUnderOdds','bttsYesOdds','btts_yes_odds',
      'toAdvanceHomeOdds','to_advance_home_odds'];

    const foundBook = bookFields.filter(f => content.includes(f));
    const foundModel = modelFields.filter(f => content.includes(f));
    const missingBook = bookFields.filter(f => !content.includes(f));
    const missingModel = modelFields.filter(f => !content.includes(f));

    log('DATA', `  Book fields referenced: [${foundBook.join(', ')}]`);
    log('DATA', `  Model fields referenced: [${foundModel.join(', ')}]`);
    if (missingBook.length > 0) warn(`  Book fields NOT referenced: [${missingBook.join(', ')}]`);
    if (missingModel.length > 0) warn(`  Model fields NOT referenced: [${missingModel.join(', ')}]`);

    // Save for analysis
    fs.writeFileSync(`/home/ubuntu/wc2026_frontend_${fp.split('/').pop()}.txt`, content);
  }

  // ── Save full audit log ───────────────────────────────────────────────────
  fs.writeFileSync('/home/ubuntu/wc2026_bookmodel_audit.log', logLines.join('\n') + '\n');
  log('OUTPUT', 'Saved: /home/ubuntu/wc2026_bookmodel_audit.log');
  console.log('\n[DONE]');
}

main().catch(e => { console.error('[FATAL]', e.message, e.stack); process.exit(1); });
