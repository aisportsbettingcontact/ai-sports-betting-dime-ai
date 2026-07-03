/**
 * WC2026 FEED FORENSIC AUDIT — 500x ELITE
 * =========================================
 * Full-pipeline audit: DB fixtures → frozen_book_odds → tRPC query logic → date filtering
 * Pinpoints exactly why 12 R32/R16 matches do not appear on the Projections Feed.
 *
 * Run: node server/wc2026/wc2026FeedAudit.mjs
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// Load env
dotenv.config({ path: path.join(projectRoot, '.env') });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('[FATAL] DATABASE_URL not set in environment');
  process.exit(1);
}

// ─── LOGGER ──────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
};

function log(level, msg, data) {
  const ts = new Date().toISOString();
  const colors = {
    AUDIT: C.cyan + C.bold,
    PASS: C.green + C.bold,
    FAIL: C.red + C.bold,
    WARN: C.yellow + C.bold,
    INFO: C.white,
    DATA: C.magenta,
    STEP: C.blue + C.bold,
    VERIFY: C.green,
  };
  const color = colors[level] || C.white;
  const prefix = `${color}[${level}]${C.reset}`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`);
    if (typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(String(data));
    }
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

function section(title) {
  console.log('\n' + C.bold + C.cyan + '═'.repeat(70) + C.reset);
  console.log(C.bold + C.cyan + `  ${title}` + C.reset);
  console.log(C.bold + C.cyan + '═'.repeat(70) + C.reset);
}

// ─── PARSE DATABASE_URL ───────────────────────────────────────────────────────
function parseDbUrl(url) {
  // mysql://user:pass@host:port/db?params
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '3306'),
    user: u.username,
    password: u.password,
    database: u.pathname.replace(/^\//, ''),
    ssl: u.searchParams.get('ssl-mode') === 'REQUIRED' ? { rejectUnauthorized: false } : undefined,
  };
}

const TARGET_FIXTURES = [
  'wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091'
];

let PASS = 0, FAIL = 0, WARN = 0;

function pass(msg) { PASS++; log('PASS', msg); }
function fail(msg, data) { FAIL++; log('FAIL', msg, data); }
function warn(msg, data) { WARN++; log('WARN', msg, data); }

async function main() {
  section('WC2026 PROJECTIONS FEED — 500x FORENSIC AUDIT');
  log('INFO', `Timestamp: ${new Date().toISOString()}`);
  log('INFO', `Target fixtures: ${TARGET_FIXTURES.join(', ')}`);

  const dbConfig = parseDbUrl(DB_URL);
  log('INFO', `Connecting to DB: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  const conn = await mysql.createConnection({
    ...dbConfig,
    multipleStatements: true,
    ssl: { rejectUnauthorized: false },
  });
  log('PASS', 'DB connection established');

  // ─── PHASE 1: FIXTURE ROW AUDIT ──────────────────────────────────────────
  section('PHASE 1: wc2026_matches — Row Existence + Field Values');

  const [fixtureRows] = await conn.execute(
    `SELECT match_id, stage, match_date, kickoff_utc, home_team_id, away_team_id, status,
            espn_event_id
     FROM wc2026_matches
     WHERE match_id IN (${TARGET_FIXTURES.map(() => '?').join(',')})
     ORDER BY match_id`,
    TARGET_FIXTURES
  );

  log('DATA', `wc2026_matches rows returned: ${fixtureRows.length} / 12 expected`);

  if (fixtureRows.length !== 12) {
    fail(`Expected 12 fixture rows, got ${fixtureRows.length}`);
  } else {
    pass('All 12 fixture rows present in wc2026_matches');
  }

  const fixtureMap = {};
  for (const row of fixtureRows) {
    fixtureMap[row.match_id] = row;
    const fid = row.match_id;
    log('DATA', `[${fid}] stage=${row.stage} | match_date=${row.match_date} | kickoff_utc=${row.kickoff_utc} | status=${row.status} | home=${row.home_team_id} | away=${row.away_team_id}`);

    // Check stage
    if (!row.stage) fail(`[${fid}] stage is NULL`);
    else if (!['R32','R16','QF','SF','THIRD','FINAL'].includes(row.stage)) fail(`[${fid}] stage='${row.stage}' is not a valid knockout stage`);
    else pass(`[${fid}] stage='${row.stage}' valid`);

    // Check match_date
    if (!row.match_date) fail(`[${fid}] match_date is NULL — this is a critical bug`);
    else pass(`[${fid}] match_date='${row.match_date}'`);

    // Check kickoff_utc
    if (!row.kickoff_utc) warn(`[${fid}] kickoff_utc is NULL`);
    else pass(`[${fid}] kickoff_utc='${row.kickoff_utc}'`);

    // Check home/away teams
    if (!row.home_team_id) fail(`[${fid}] home_team_id is NULL`);
    if (!row.away_team_id) fail(`[${fid}] away_team_id is NULL`);
  }

  // ─── PHASE 2: FROZEN BOOK ODDS AUDIT ─────────────────────────────────────
  section('PHASE 2: wc2026_frozen_book_odds — Row Existence + Market Values');

  const [oddsRows] = await conn.execute(
    `SELECT match_id, book_away_ml, book_home_ml, book_draw_ml, book_total_line,
            book_over_odds, book_under_odds, book_spread_line,
            to_advance_home_odds, to_advance_away_odds
     FROM wc2026_frozen_book_odds
     WHERE match_id IN (${TARGET_FIXTURES.map(() => '?').join(',')})
     ORDER BY match_id`,
    TARGET_FIXTURES
  );

  log('DATA', `wc2026_frozen_book_odds rows returned: ${oddsRows.length} / 12 expected`);

  if (oddsRows.length !== 12) {
    fail(`Expected 12 odds rows, got ${oddsRows.length}`);
  } else {
    pass('All 12 odds rows present in wc2026_frozen_book_odds');
  }

  for (const row of oddsRows) {
    const fid = row.match_id;
    const nullFields = Object.entries(row).filter(([k, v]) => v === null && k !== 'match_id').map(([k]) => k);
    if (nullFields.length > 0) {
      fail(`[${fid}] NULL market fields: ${nullFields.join(', ')}`);
    } else {
      pass(`[${fid}] All market fields populated`);
    }
    log('DATA', `[${fid}] away_ml=${row.book_away_ml} | home_ml=${row.book_home_ml} | draw=${row.book_draw_ml} | total=${row.book_total_line}`);
  }

  // ─── PHASE 3: JOIN AUDIT ─────────────────────────────────────────────────
  section('PHASE 3: JOIN Integrity — fixtures LEFT JOIN frozen_book_odds');

  const [joinRows] = await conn.execute(
    `SELECT f.match_id, f.stage, f.match_date, f.kickoff_utc,
            o.match_id AS odds_fid, o.book_away_ml
     FROM wc2026_matches f
     LEFT JOIN wc2026_frozen_book_odds o ON f.match_id = o.match_id
     WHERE f.match_id IN (${TARGET_FIXTURES.map(() => '?').join(',')})
     ORDER BY f.match_id`,
    TARGET_FIXTURES
  );

  log('DATA', `JOIN result rows: ${joinRows.length}`);
  for (const row of joinRows) {
    if (!row.odds_fid) {
      fail(`[${row.match_id}] JOIN MISS — no odds row matched`);
    } else {
      pass(`[${row.match_id}] JOIN OK — odds_fid=${row.odds_fid} away_ml=${row.book_away_ml}`);
    }
  }

  // ─── PHASE 4: TEAM RESOLUTION AUDIT ──────────────────────────────────────
  section('PHASE 4: Team Resolution — home_team_id + away_team_id → wc2026_teams');

  // Get all team IDs used by target fixtures
  const allTeamIds = new Set();
  for (const row of fixtureRows) {
    if (row.home_team_id) allTeamIds.add(row.home_team_id);
    if (row.away_team_id) allTeamIds.add(row.away_team_id);
  }
  const teamIdList = [...allTeamIds];
  log('DATA', `Unique team IDs in target fixtures: ${teamIdList.join(', ')}`);

  if (teamIdList.length > 0) {
    const [teamRows] = await conn.execute(
      `SELECT team_id, team_name, team_abbrev FROM wc2026_teams
       WHERE team_id IN (${teamIdList.map(() => '?').join(',')})`,
      teamIdList
    );
    log('DATA', `Teams resolved: ${teamRows.length} / ${teamIdList.length}`);
    const teamMap = {};
    for (const t of teamRows) {
      teamMap[t.team_id] = t;
      log('DATA', `  team_id=${t.team_id} | name=${t.team_name} | abbrev=${t.team_abbrev}`);
    }
    for (const tid of teamIdList) {
      if (!teamMap[tid]) fail(`team_id='${tid}' NOT FOUND in wc2026_teams`);
      else pass(`team_id='${tid}' → '${teamMap[tid].team_name}'`);
    }
  } else {
    fail('No team IDs found in fixture rows — home_team_id/away_team_id are all NULL');
  }

  // ─── PHASE 5: DATE RANGE AUDIT ────────────────────────────────────────────
  section('PHASE 5: Date Range — What dates do these fixtures fall on?');

  const matchDates = [...new Set(fixtureRows.map(r => r.match_date).filter(Boolean))].sort();
  log('DATA', `Distinct match_date values: ${JSON.stringify(matchDates)}`);

  if (matchDates.length === 0) {
    fail('ALL match_date values are NULL — this is the root cause of missing feed entries');
  } else {
    pass(`match_date values present: ${matchDates.join(', ')}`);
  }

  // ─── PHASE 6: FULL FIXTURE TABLE STAGE DISTRIBUTION ──────────────────────
  section('PHASE 6: Full wc2026_matches Stage Distribution');

  const [stageDistRows] = await conn.execute(
    `SELECT stage, COUNT(*) as cnt, MIN(match_date) as min_date, MAX(match_date) as max_date
     FROM wc2026_matches
     GROUP BY stage
     ORDER BY FIELD(stage,'GROUP','R32','R16','QF','SF','THIRD','FINAL')`
  );
  log('DATA', 'Stage distribution:');
  for (const row of stageDistRows) {
    log('DATA', `  stage=${row.stage} | count=${row.cnt} | date_range=${row.min_date} → ${row.max_date}`);
  }

  // ─── PHASE 7: FROZEN ODDS TABLE FULL AUDIT ───────────────────────────────
  section('PHASE 7: wc2026_frozen_book_odds — Full Table Audit');

  const [allOddsRows] = await conn.execute(
    `SELECT match_id FROM wc2026_frozen_book_odds ORDER BY match_id`
  );
  log('DATA', `Total rows in wc2026_frozen_book_odds: ${allOddsRows.length}`);
  log('DATA', `All match_ids: ${allOddsRows.map(r => r.match_id).join(', ')}`);

  // ─── PHASE 8: READ SERVER-SIDE QUERY FILES ────────────────────────────────
  section('PHASE 8: Server-Side File Audit — db.ts + routers.ts');

  const dbTsPath = path.join(projectRoot, 'server/db.ts');
  const routersTsPath = path.join(projectRoot, 'server/routers.ts');

  if (fs.existsSync(dbTsPath)) {
    const dbTs = fs.readFileSync(dbTsPath, 'utf8');
    const wc2026Lines = dbTs.split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => /wc2026|frozen_book|knockout|R32|R16|stage|match_date|kickoff/i.test(line));
    log('DATA', `db.ts — WC2026-relevant lines (${wc2026Lines.length} found):`);
    for (const { n, line } of wc2026Lines) {
      log('DATA', `  L${n}: ${line.trim()}`);
    }
  } else {
    warn('db.ts not found at expected path');
  }

  if (fs.existsSync(routersTsPath)) {
    const routersTs = fs.readFileSync(routersTsPath, 'utf8');
    const wc2026Lines = routersTs.split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => /wc2026|frozen_book|knockout|R32|R16|stage|match_date|kickoff|worldCup|wc/i.test(line));
    log('DATA', `routers.ts — WC2026-relevant lines (${wc2026Lines.length} found):`);
    for (const { n, line } of wc2026Lines) {
      log('DATA', `  L${n}: ${line.trim()}`);
    }
  } else {
    warn('routers.ts not found at expected path');
  }

  // ─── PHASE 9: FRONTEND PAGE FILE AUDIT ───────────────────────────────────
  section('PHASE 9: Frontend Page File Audit — WC2026 page component');

  const pagesDir = path.join(projectRoot, 'client/src/pages');
  if (fs.existsSync(pagesDir)) {
    const pageFiles = fs.readdirSync(pagesDir).filter(f => /wc|world.?cup|wc2026/i.test(f));
    log('DATA', `WC2026 page files: ${pageFiles.join(', ') || 'NONE FOUND'}`);

    // Also search all page files for wc2026 references
    const allPageFiles = fs.readdirSync(pagesDir);
    for (const fname of allPageFiles) {
      const fpath = path.join(pagesDir, fname);
      if (!fs.statSync(fpath).isFile()) continue;
      const content = fs.readFileSync(fpath, 'utf8');
      if (/wc2026|worldCup|frozen_book|knockout/i.test(content)) {
        const relevantLines = content.split('\n')
          .map((line, i) => ({ n: i + 1, line }))
          .filter(({ line }) => /wc2026|worldCup|frozen_book|knockout|stage|match_date|GROUP|R32|R16|date.*filter|filter.*date/i.test(line));
        log('DATA', `\n  FILE: ${fname} — ${relevantLines.length} WC2026-relevant lines:`);
        for (const { n, line } of relevantLines) {
          log('DATA', `    L${n}: ${line.trim()}`);
        }
      }
    }
  } else {
    fail('client/src/pages directory not found');
  }

  // ─── PHASE 10: SIMULATE THE FEED QUERY ───────────────────────────────────
  section('PHASE 10: Simulate Feed Query — What does the DB return for Jul 1–7?');

  // Simulate the most likely query pattern: fixtures for a given date with odds
  const testDates = ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05','2026-07-06','2026-07-07'];
  for (const d of testDates) {
    const [rows] = await conn.execute(
      `SELECT f.match_id, f.stage, f.match_date, f.kickoff_utc,
              t_h.team_name AS home_name, t_a.team_name AS away_name,
              o.book_away_ml
       FROM wc2026_matches f
       LEFT JOIN wc2026_teams t_h ON f.home_team_id = t_h.team_id
       LEFT JOIN wc2026_teams t_a ON f.away_team_id = t_a.team_id
       LEFT JOIN wc2026_frozen_book_odds o ON f.match_id = o.match_id
       WHERE f.match_date = ?
       ORDER BY f.kickoff_utc`,
      [d]
    );
    if (rows.length > 0) {
      pass(`Date ${d}: ${rows.length} fixture(s) found`);
      for (const r of rows) {
        log('DATA', `  [${r.match_id}] ${r.away_name} @ ${r.home_name} | stage=${r.stage} | kickoff=${r.kickoff_utc} | away_ml=${r.book_away_ml}`);
      }
    } else {
      fail(`Date ${d}: 0 fixtures returned — EMPTY`);
    }
  }

  // ─── PHASE 11: CHECK ACTUAL match_date VALUES FOR TARGET FIXTURES ─────────
  section('PHASE 11: Raw match_date dump for all 12 target fixtures');

  const [rawDates] = await conn.execute(
    `SELECT match_id, match_date, kickoff_utc, stage FROM wc2026_matches
     WHERE match_id IN (${TARGET_FIXTURES.map(() => '?').join(',')})
     ORDER BY match_id`,
    TARGET_FIXTURES
  );
  for (const r of rawDates) {
    log('DATA', `[${r.match_id}] match_date=${JSON.stringify(r.match_date)} | kickoff_utc=${JSON.stringify(r.kickoff_utc)} | stage=${r.stage}`);
    if (!r.match_date) {
      fail(`[${r.match_id}] match_date IS NULL — CRITICAL ROOT CAUSE`);
    }
    if (!r.kickoff_utc) {
      warn(`[${r.match_id}] kickoff_utc IS NULL`);
    }
  }

  // ─── PHASE 12: SCHEMA COLUMN AUDIT ───────────────────────────────────────
  section('PHASE 12: Schema Column Audit — wc2026_matches column list');

  const [colRows] = await conn.execute(
    `SHOW COLUMNS FROM wc2026_matches`
  );
  log('DATA', 'wc2026_matches columns:');
  for (const col of colRows) {
    log('DATA', `  ${col.Field} | type=${col.Type} | null=${col.Null} | default=${col.Default}`);
  }

  // ─── PHASE 13: LOOK FOR ROUTER FILES OUTSIDE routers.ts ──────────────────
  section('PHASE 13: Router File Discovery — all tRPC router files');

  const serverDir = path.join(projectRoot, 'server');
  function findTsFiles(dir, results = []) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory() && !f.startsWith('.') && f !== 'node_modules') {
        findTsFiles(full, results);
      } else if (/\.(ts|mjs)$/.test(f) && !/\.test\./.test(f)) {
        results.push(full);
      }
    }
    return results;
  }
  const serverFiles = findTsFiles(serverDir);
  for (const fpath of serverFiles) {
    const content = fs.readFileSync(fpath, 'utf8');
    if (/wc2026.*feed|feed.*wc2026|projections.*wc|wc.*projections|frozen_book|wc2026Matches/i.test(content)) {
      const relPath = path.relative(projectRoot, fpath);
      const relevantLines = content.split('\n')
        .map((line, i) => ({ n: i + 1, line }))
        .filter(({ line }) => /wc2026|frozen_book|stage|match_date|kickoff|R32|R16|GROUP/i.test(line));
      log('DATA', `\n  FILE: ${relPath} — ${relevantLines.length} relevant lines:`);
      for (const { n, line } of relevantLines.slice(0, 60)) {
        log('DATA', `    L${n}: ${line.trim()}`);
      }
    }
  }

  // ─── FINAL SUMMARY ────────────────────────────────────────────────────────
  section('FORENSIC AUDIT SUMMARY');
  const total = PASS + FAIL + WARN;
  log('INFO', `Total checks: ${total} | PASS: ${PASS} | FAIL: ${FAIL} | WARN: ${WARN}`);
  const rate = total > 0 ? ((PASS / total) * 100).toFixed(1) : '0.0';
  if (FAIL === 0) {
    log('PASS', `ELITE — ${rate}% pass rate`);
  } else {
    log('FAIL', `${FAIL} FAILURES DETECTED — ${rate}% pass rate`);
  }

  await conn.end();
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
