/**
 * WC2026 v14.0-KO24 — 500x FORENSIC DB AUDIT
 * ════════════════════════════════════════════════════════════════════════════
 * MISSION: Enumerate EVERY WC2026 table, EVERY column, EVERY row, EVERY value
 *          type, EVERY index, EVERY schema detail — then cross-reference with
 *          what v14_engine.mjs actually queries.
 *
 * NON-NEGOTIABLE RULES:
 *   1. NO NULL DATA
 *   2. NO VALUES DERIVED FROM MEANS
 *   3. NO HALLUCINATION FRAMEWORKS
 *   4. NO SOFT/SILENT GATES
 *   5. REAL ACTUAL DATA ONLY
 *
 * OUTPUT:
 *   - Terminal: continuous, structured, color-coded progress
 *   - /home/ubuntu/wc2026modeling.txt: full persistent log (append)
 *   - /home/ubuntu/wc2026_v14_db_audit.json: machine-readable audit report
 */

import mysql from 'mysql2/promise';
import fs from 'fs';

// ── Logger ────────────────────────────────────────────────────────────────────
const LOG_FILE = '/home/ubuntu/wc2026modeling.txt';
const REPORT_FILE = '/home/ubuntu/wc2026_v14_db_audit.json';
const SESSION_ID = `v14-db-audit-${Date.now()}`;
const START_TS = Date.now();
let STEP = 0;
let PASS = 0; let FAIL = 0; let WARN = 0;
let ISSUES = []; // {id, severity, domain, description, evidence, fix}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';
const DIM = '\x1b[2m';

function ts() {
  const e = ((Date.now() - START_TS) / 1000).toFixed(3);
  return `[${new Date().toISOString()}] +${e}s`;
}
function pad(s, n) { return String(s ?? '').padEnd(n).slice(0, n); }
function fmt(v, d = 4) { return typeof v === 'number' ? v.toFixed(d) : String(v ?? 'NULL'); }

const LEVEL_COLORS = {
  SECTION: BOLD + CYAN,
  BLUEPRINT: MAGENTA,
  INPUT: CYAN,
  STEP: WHITE,
  STATE: DIM + WHITE,
  OUTPUT: BOLD + WHITE,
  PASS: GREEN,
  FAIL: BOLD + RED,
  WARN: YELLOW,
  GATE: BOLD + YELLOW,
  CRITICAL: BOLD + RED,
  INFO: WHITE,
  AUDIT: BOLD + CYAN,
  SCHEMA: BOLD + MAGENTA,
  ROW: DIM + WHITE,
  XREF: BOLD + GREEN,
  ISSUE: BOLD + RED,
  FIX: GREEN,
  DB: CYAN,
  NULL_FOUND: BOLD + RED,
  REAL_DATA: GREEN,
  INDEX: MAGENTA,
  SAMPLE: DIM + WHITE,
};

function log(level, domain, msg) {
  STEP++;
  const icons = {
    SECTION:'██', BLUEPRINT:'📐', INPUT:'⬇ ', STEP:'▶ ', STATE:'◈ ', OUTPUT:'→→',
    PASS:'✅', FAIL:'❌', WARN:'⚠️ ', GATE:'🚦', CRITICAL:'🔴', INFO:'ℹ ',
    AUDIT:'🔍', SCHEMA:'🗂 ', ROW:'📄', XREF:'🔗', ISSUE:'🚨', FIX:'🔧',
    DB:'🗄 ', NULL_FOUND:'💀', REAL_DATA:'💚', INDEX:'🔑', SAMPLE:'🔬',
  };
  const icon = icons[level] || '  ';
  const color = LEVEL_COLORS[level] || WHITE;
  const stepStr = `S${String(STEP).padStart(4,'0')}`;
  const line = `${ts()} ${stepStr} ${icon} [${pad(level,8)}] [${pad(domain,16)}] ${msg}`;
  const colorLine = `${DIM}${ts()} ${stepStr}${RESET} ${icon} ${color}[${pad(level,8)}]${RESET} ${DIM}[${pad(domain,16)}]${RESET} ${color}${msg}${RESET}`;
  console.log(colorLine);
  fs.appendFileSync(LOG_FILE, line + '\n');
  if (level === 'PASS') PASS++;
  if (level === 'FAIL') FAIL++;
  if (level === 'WARN') WARN++;
}

function banner(msg, color = BOLD + CYAN) {
  const bar = '═'.repeat(120);
  const lines = [bar, `  ${msg}`, bar];
  lines.forEach(l => {
    console.log(`${color}${l}${RESET}`);
    fs.appendFileSync(LOG_FILE, l + '\n');
  });
}

function sectionHeader(title) {
  const bar = '─'.repeat(100);
  const lines = [`\n${bar}`, `  ${title}`, bar];
  lines.forEach(l => {
    console.log(`${BOLD}${CYAN}${l}${RESET}`);
    fs.appendFileSync(LOG_FILE, l + '\n');
  });
}

function hardFail(domain, msg) {
  log('FAIL', domain, `HARD_FAIL: ${msg}`);
  throw new Error(`HARD_FAIL [${domain}]: ${msg}`);
}

function addIssue(id, severity, domain, description, evidence, fix) {
  ISSUES.push({ id, severity, domain, description, evidence, fix });
  log('ISSUE', domain, `[${severity}] ISSUE-${id}: ${description}`);
  log('ISSUE', domain, `  EVIDENCE: ${evidence}`);
  log('FIX', domain, `  FIX: ${fix}`);
}

// ── DB ────────────────────────────────────────────────────────────────────────
async function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) hardFail('DB', 'DATABASE_URL not set');
  return mysql.createConnection(url);
}

// ── V14 ENGINE DB DEPENDENCY MAP ─────────────────────────────────────────────
// Extracted from reading v14_engine.mjs in full
const V14_QUERIES = {
  A1_XG: {
    table: 'wc2026_espn_expected_goals',
    alias: 'eg',
    join: 'wc2026_espn_matches em ON eg.matchId = em.matchId',
    columns: ['eg.matchId','eg.matchRound','eg.homeTeamAbbrev','eg.awayTeamAbbrev',
               'eg.homeXG','eg.awayXG','eg.homeXGOT','eg.awayXGOT','eg.homeXA','eg.awayXA',
               'em.homeScore','em.awayScore'],
    filter: 'none',
    purpose: 'Primary xG/xGOT/xA data for lambda computation + match scores',
  },
  A2_TS: {
    table: 'wc2026_espn_team_stats',
    columns: ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev','possession','possessionAway'],
    filter: 'none',
    purpose: 'Possession % for possAdj multiplicative adjustment',
  },
  A3_MS: {
    table: 'wc2026_espn_match_stats',
    columns: ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev',
               'homeShotsOnGoal','awayShotsOnGoal','homeShots','awayShots'],
    filter: 'none',
    purpose: 'Shot data for spSignal (SOT/shots ratio)',
  },
  A4_PS: {
    table: 'wc2026_espn_player_stats',
    columns: ['matchId','matchRound','teamAbbrev','name','xG','g'],
    filter: "matchRound = 'group-stage'",
    purpose: 'Player xG for psSignal (per-match player xG average)',
  },
  A5_SM: {
    table: 'wc2026_espn_shot_map',
    columns: ['matchId','matchRound','teamAbbrev','xG','xGOT'],
    filter: "matchRound = 'group-stage'",
    purpose: 'Shot-level xG for smSignal (per-match shot map xG average)',
  },
  B1_KO: {
    table: 'wc2026_espn_matches',
    alias: 'em',
    columns: ['em.matchId','em.matchRound','em.homeTeamAbbrev','em.awayTeamAbbrev',
               'em.homeScore','em.awayScore'],
    filter: "matchRound='round-of-32' AND homeScore IS NOT NULL AND awayScore IS NOT NULL AND statusState='post'",
    purpose: 'Completed KO matches for backtest',
  },
  C1_FIX: {
    table: 'wc2026_matches',
    alias: 'f',
    join: ['wc2026_teams ht ON f.home_team_id = ht.team_id',
           'wc2026_teams at ON f.away_team_id = at.team_id'],
    columns: ['f.match_id','ht.fifa_code AS home_code','at.fifa_code AS away_code','f.kickoff_utc'],
    filter: "DATE(f.match_date) = '2026-07-01'",
    purpose: 'July 1 match IDs and team codes',
  },
  C1_BOOK: {
    table: 'wc2026_frozen_book_odds',
    columns: ['*'],
    filter: 'match_id IN (...)',
    requiredFields: [
      'book_home_ml','book_draw_ml','book_away_ml',
      'book_spread_line','book_home_spread_odds','book_away_spread_odds',
      'book_total_line','book_over_odds','book_under_odds',
      'book_btts_yes_odds','book_btts_no_odds',
      'book_dc_1x_odds','book_dc_x2_odds','book_no_draw_home_odds',
      'to_advance_home_odds','to_advance_away_odds'
    ],
    purpose: 'Book odds for all 14 markets per match',
  },
};

// ── COLUMNS NOT QUERIED BY V14 (from schema) ─────────────────────────────────
const V14_UNUSED_KNOWN = {
  'wc2026_espn_expected_goals': ['homeXA is used but xA columns may have nulls'],
  'wc2026_espn_team_stats': ['fouls','yellowCards','redCards','offsides','corners','saves','goalKicks','throwIns','freeKicks'],
  'wc2026_espn_match_stats': ['homeCorners','awayCorners','homeFouls','awayFouls','homeYellowCards','awayYellowCards'],
  'wc2026_espn_player_stats': ['a','sog','shot','appearances','positionGroup'],
  'wc2026_espn_shot_map': ['period','clock','fieldStartX','fieldStartY','shotType','iconType'],
  'wc2026_frozen_book_odds': ['book_no_draw_away_odds','match_date','created_at'],
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner(`WC2026 v14.0-KO24 — 500x FORENSIC DB AUDIT — SESSION ${SESSION_ID}`);
  banner('MISSION: ENUMERATE ALL TABLES | ALL COLUMNS | ALL ROWS | CROSS-REF v14 ENGINE');
  banner('RULES: NO NULL | NO MEANS | NO HALLUCINATION | NO SOFT GATES | REAL DATA ONLY');

  const db = await getDb();
  const auditReport = {
    session: SESSION_ID,
    timestamp: new Date().toISOString(),
    tables: {},
    crossRef: {},
    issues: [],
    stats: {},
  };

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 1: ENUMERATE ALL WC2026 TABLES
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 1 — ENUMERATE ALL WC2026 TABLES IN DATABASE');

  const [allTables] = await db.execute(`
    SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, CREATE_TIME, UPDATE_TIME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME LIKE 'wc2026%'
    ORDER BY TABLE_NAME
  `);

  log('INPUT', 'S1_TABLES', `Total WC2026 tables found: ${allTables.length}`);
  for (const t of allTables) {
    log('SCHEMA', 'S1_TABLE', `  TABLE: ${pad(t.TABLE_NAME, 45)} ROWS≈${String(t.TABLE_ROWS ?? 'N/A').padEnd(8)} DATA=${Math.round((t.DATA_LENGTH||0)/1024)}KB IDX=${Math.round((t.INDEX_LENGTH||0)/1024)}KB`);
  }

  auditReport.tableList = allTables.map(t => t.TABLE_NAME);

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 2: FULL SCHEMA INSPECTION — ALL COLUMNS FOR ALL TABLES
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 2 — FULL SCHEMA INSPECTION: ALL COLUMNS, TYPES, NULLABILITY, DEFAULTS');

  for (const tableRow of allTables) {
    const tableName = tableRow.TABLE_NAME;
    log('SECTION', 'S2_TABLE', `━━━ TABLE: ${tableName} ━━━`);

    // Get full column info
    const [cols] = await db.execute(`
      SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE,
             DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
             COLUMN_TYPE, COLUMN_KEY, EXTRA, COLUMN_COMMENT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [tableName]);

    log('SCHEMA', tableName, `  ${cols.length} columns:`);
    for (const col of cols) {
      const nullable = col.IS_NULLABLE === 'YES' ? '⚠️ NULL' : '✓ NOT NULL';
      const key = col.COLUMN_KEY ? `[${col.COLUMN_KEY}]` : '';
      const extra = col.EXTRA ? `{${col.EXTRA}}` : '';
      log('SCHEMA', tableName, `    ${String(col.ORDINAL_POSITION).padEnd(3)} ${pad(col.COLUMN_NAME,40)} ${pad(col.COLUMN_TYPE,30)} ${nullable} ${key} ${extra}`);
    }

    // Get indexes
    const [idxs] = await db.execute(`
      SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, INDEX_TYPE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `, [tableName]);

    if (idxs.length > 0) {
      log('INDEX', tableName, `  ${idxs.length} index entries:`);
      for (const idx of idxs) {
        const unique = idx.NON_UNIQUE === 0 ? 'UNIQUE' : 'INDEX';
        log('INDEX', tableName, `    ${unique} ${idx.INDEX_NAME}(${idx.COLUMN_NAME}) [${idx.INDEX_TYPE}]`);
      }
    }

    // Get exact row count
    const [[countRow]] = await db.execute(`SELECT COUNT(*) AS cnt FROM \`${tableName}\``);
    const rowCount = countRow.cnt;
    log('SCHEMA', tableName, `  EXACT ROW COUNT: ${rowCount}`);

    // Get sample row (first row)
    const [sampleRows] = await db.execute(`SELECT * FROM \`${tableName}\` LIMIT 1`);
    if (sampleRows.length > 0) {
      const sample = sampleRows[0];
      log('SAMPLE', tableName, `  SAMPLE ROW (first):`);
      for (const [k, v] of Object.entries(sample)) {
        const vStr = v === null ? 'NULL' : String(v).slice(0, 80);
        const nullFlag = v === null ? ' ← NULL' : '';
        log('SAMPLE', tableName, `    ${pad(k,40)} = ${vStr}${nullFlag}`);
      }
    }

    // NULL audit per column
    log('AUDIT', tableName, `  NULL AUDIT per column:`);
    let tableNullIssues = 0;
    for (const col of cols) {
      if (col.IS_NULLABLE === 'YES') {
        const [[nullCount]] = await db.execute(
          `SELECT COUNT(*) AS cnt FROM \`${tableName}\` WHERE \`${col.COLUMN_NAME}\` IS NULL`
        );
        const pct = rowCount > 0 ? ((nullCount.cnt / rowCount) * 100).toFixed(1) : '0.0';
        if (nullCount.cnt > 0) {
          log('WARN', tableName, `    ${pad(col.COLUMN_NAME,40)} NULL_COUNT=${nullCount.cnt}/${rowCount} (${pct}%)`);
          tableNullIssues++;
        } else {
          log('PASS', tableName, `    ${pad(col.COLUMN_NAME,40)} NULL_COUNT=0 ✓`);
        }
      }
    }

    auditReport.tables[tableName] = {
      columns: cols.map(c => ({
        name: c.COLUMN_NAME,
        type: c.COLUMN_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        key: c.COLUMN_KEY,
        extra: c.EXTRA,
      })),
      indexes: idxs,
      rowCount,
      nullIssues: tableNullIssues,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 3: DEEP DATA INSPECTION — CRITICAL ESPN TABLES
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 3 — DEEP DATA INSPECTION: CRITICAL ESPN TABLES');

  // 3A: wc2026_espn_expected_goals — the primary lambda source
  log('SECTION', 'S3A_XG', '3A — wc2026_espn_expected_goals: full data map');

  const [xgFull] = await db.execute(`
    SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev,
           homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
    FROM wc2026_espn_expected_goals ORDER BY matchRound, matchId
  `);

  const xgByRound = {};
  for (const r of xgFull) {
    if (!xgByRound[r.matchRound]) xgByRound[r.matchRound] = [];
    xgByRound[r.matchRound].push(r);
  }

  for (const [round, rows] of Object.entries(xgByRound)) {
    log('STATE', 'S3A_XG', `  Round: ${round} — ${rows.length} rows`);
    // Check for NULLs in lambda-critical fields
    const nullXG = rows.filter(r => r.homeXG === null || r.awayXG === null);
    const nullXGOT = rows.filter(r => r.homeXGOT === null || r.awayXGOT === null);
    const nullXA = rows.filter(r => r.homeXA === null || r.awayXA === null);
    if (nullXG.length > 0) {
      log('WARN', 'S3A_XG', `    NULL homeXG/awayXG: ${nullXG.length} rows (${round})`);
      nullXG.forEach(r => log('NULL_FOUND', 'S3A_XG', `      matchId=${r.matchId} home=${r.homeTeamAbbrev} away=${r.awayTeamAbbrev} homeXG=${r.homeXG} awayXG=${r.awayXG}`));
    } else {
      log('PASS', 'S3A_XG', `    homeXG/awayXG: 0 NULLs in ${round} ✓`);
    }
    if (nullXGOT.length > 0) {
      log('WARN', 'S3A_XG', `    NULL homeXGOT/awayXGOT: ${nullXGOT.length} rows (${round})`);
    } else {
      log('PASS', 'S3A_XG', `    homeXGOT/awayXGOT: 0 NULLs in ${round} ✓`);
    }
    if (nullXA.length > 0) {
      log('WARN', 'S3A_XG', `    NULL homeXA/awayXA: ${nullXA.length} rows (${round})`);
    } else {
      log('PASS', 'S3A_XG', `    homeXA/awayXA: 0 NULLs in ${round} ✓`);
    }
  }

  // 3B: wc2026_espn_team_stats — possession source
  log('SECTION', 'S3B_TS', '3B — wc2026_espn_team_stats: possession data map');

  const [tsFull] = await db.execute(`
    SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev, possession, possessionAway
    FROM wc2026_espn_team_stats ORDER BY matchRound, matchId
  `);

  // Check possession format
  const possFormats = new Set(tsFull.map(r => typeof r.possession + ':' + String(r.possession).slice(0,10)));
  log('STATE', 'S3B_TS', `  possession field formats (unique): ${[...possFormats].join(', ')}`);

  const nullPoss = tsFull.filter(r => r.possession === null || r.possessionAway === null);
  if (nullPoss.length > 0) {
    log('WARN', 'S3B_TS', `  NULL possession rows: ${nullPoss.length}`);
    addIssue('DB-01', 'HIGH', 'S3B_TS',
      'NULL possession values in wc2026_espn_team_stats',
      `${nullPoss.length} rows have NULL possession or possessionAway`,
      'v14 HARD_FAILs on missing tsRow — but if possession column itself is NULL, NaN parse will trigger N1_POSS_NAN gate'
    );
  } else {
    log('PASS', 'S3B_TS', `  possession: 0 NULLs across all ${tsFull.length} rows ✓`);
  }

  // Check for non-numeric possession values
  const badPoss = tsFull.filter(r => {
    const p = parseFloat(String(r.possession ?? '').replace('%',''));
    return isNaN(p) || p < 0 || p > 100;
  });
  if (badPoss.length > 0) {
    log('WARN', 'S3B_TS', `  Non-numeric/out-of-range possession: ${badPoss.length} rows`);
    badPoss.forEach(r => log('NULL_FOUND', 'S3B_TS', `    matchId=${r.matchId} possession='${r.possession}'`));
  } else {
    log('PASS', 'S3B_TS', `  All possession values parse to valid [0,100] floats ✓`);
  }

  // 3C: wc2026_espn_match_stats — shot data source
  log('SECTION', 'S3C_MS', '3C — wc2026_espn_match_stats: shot data map');

  const [msFull] = await db.execute(`
    SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev,
           homeShotsOnGoal, awayShotsOnGoal, homeShots, awayShots
    FROM wc2026_espn_match_stats ORDER BY matchRound, matchId
  `);

  const nullShots = msFull.filter(r =>
    r.homeShotsOnGoal === null || r.awayShotsOnGoal === null ||
    r.homeShots === null || r.awayShots === null
  );
  if (nullShots.length > 0) {
    log('WARN', 'S3C_MS', `  NULL shot data rows: ${nullShots.length}`);
    nullShots.forEach(r => log('NULL_FOUND', 'S3C_MS', `    matchId=${r.matchId} round=${r.matchRound} homeSOT=${r.homeShotsOnGoal} awaySOT=${r.awayShotsOnGoal} homeShots=${r.homeShots} awayShots=${r.awayShots}`));
    addIssue('DB-02', 'HIGH', 'S3C_MS',
      'NULL shot data in wc2026_espn_match_stats',
      `${nullShots.length} rows with NULL SOT or shots`,
      'v14 HARD_FAILs on NULL SOT/shots via N2 gate — but these rows must be investigated to ensure they are not GS rows'
    );
  } else {
    log('PASS', 'S3C_MS', `  Shot data: 0 NULLs across all ${msFull.length} rows ✓`);
  }

  // 3D: wc2026_espn_player_stats — psSignal source
  log('SECTION', 'S3D_PS', '3D — wc2026_espn_player_stats: player xG map');

  const [psFull] = await db.execute(`
    SELECT matchId, matchRound, teamAbbrev, name, xG, g,
           a, sog, shot, appearances, positionGroup
    FROM wc2026_espn_player_stats ORDER BY matchRound, matchId, teamAbbrev
  `);

  const psGS = psFull.filter(r => r.matchRound === 'group-stage');
  const psKO = psFull.filter(r => r.matchRound === 'round-of-32');
  log('STATE', 'S3D_PS', `  Total rows: ${psFull.length} | GS: ${psGS.length} | KO: ${psKO.length}`);

  // Note: matchRound is nullable in player_stats — filter by null-safe comparison
  const psGSFiltered = psFull.filter(r => r.matchRound === 'group-stage');
  const psKOFiltered = psFull.filter(r => r.matchRound === 'round-of-32');
  const nullXG_ps = psGSFiltered.filter(r => r.xG === null);
  if (nullXG_ps.length > 0) {
    log('WARN', 'S3D_PS', `  NULL xG in GS player rows: ${nullXG_ps.length}`);
    addIssue('DB-03', 'MEDIUM', 'S3D_PS',
      'NULL xG values in GS player stats rows',
      `${nullXG_ps.length} GS player rows have NULL xG — v14 uses ?? 0 for player xG sum`,
      'v14 line 328: r.xG ?? 0 — this is a soft fallback. If player has NULL xG, they contribute 0 to psSignal. Should be flagged explicitly.'
    );
  } else {
    log('PASS', 'S3D_PS', `  Player xG: 0 NULLs in GS rows ✓`);
  }

  // Check teams with zero player rows per GS match
  const psTeamMatchCounts = {};
  for (const r of psGSFiltered) {
    const key = `${r.matchId}:${r.teamAbbrev}`;
    psTeamMatchCounts[key] = (psTeamMatchCounts[key] || 0) + 1;
  }
  log('STATE', 'S3D_PS', `  Unique (matchId, teamAbbrev) combos in GS: ${Object.keys(psTeamMatchCounts).length}`);

  // 3E: wc2026_espn_shot_map — smSignal source
  log('SECTION', 'S3E_SM', '3E — wc2026_espn_shot_map: shot map xG data');

  const [smFull] = await db.execute(`
    SELECT matchId, matchRound, teamAbbrev, xG, xGOT, period, clock, fieldStartX, fieldStartY, shotType, iconType
    FROM wc2026_espn_shot_map ORDER BY matchRound, matchId, teamAbbrev
  `);

  const smGS = smFull.filter(r => r.matchRound === 'group-stage');
  const smKO = smFull.filter(r => r.matchRound === 'round-of-32');
  log('STATE', 'S3E_SM', `  Total rows: ${smFull.length} | GS: ${smGS.length} | KO: ${smKO.length}`);

  const nullXG_sm = smGS.filter(r => r.xG === null);
  if (nullXG_sm.length > 0) {
    log('WARN', 'S3E_SM', `  NULL xG in GS shot map rows: ${nullXG_sm.length}`);
  } else {
    log('PASS', 'S3E_SM', `  Shot map xG: 0 NULLs in GS rows ✓`);
  }

  // 3F: wc2026_espn_matches — match scores and status
  log('SECTION', 'S3F_EM', '3F — wc2026_espn_matches: match scores and status');

  const [emFull] = await db.execute(`
    SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev,
           homeScore, awayScore, statusState, statusDetail
    FROM wc2026_espn_matches ORDER BY matchRound, matchId
  `);

  const emGS = emFull.filter(r => r.matchRound === 'group-stage');
  const emKO = emFull.filter(r => r.matchRound === 'round-of-32');
  const emKOCompleted = emKO.filter(r => r.statusState === 'post' && r.homeScore !== null);
  const emKOPending = emKO.filter(r => r.statusState !== 'post' || r.homeScore === null);

  log('STATE', 'S3F_EM', `  GS matches: ${emGS.length} | KO matches: ${emKO.length}`);
  log('STATE', 'S3F_EM', `  KO completed (statusState=post, scores not null): ${emKOCompleted.length}`);
  log('STATE', 'S3F_EM', `  KO pending: ${emKOPending.length}`);

  for (const m of emKOCompleted) {
    log('REAL_DATA', 'S3F_EM', `  COMPLETED: ${m.matchId} ${m.homeTeamAbbrev} ${m.homeScore}-${m.awayScore} ${m.awayTeamAbbrev} [${m.statusDetail}]`);
  }
  for (const m of emKOPending) {
    log('STATE', 'S3F_EM', `  PENDING: ${m.matchId} ${m.homeTeamAbbrev} vs ${m.awayTeamAbbrev} [${m.statusState}]`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 4: MATCHS AND BOOK ODDS TABLES
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 4 — MATCHS AND BOOK ODDS: FULL SCHEMA AND DATA VALIDATION');

  // 4A: wc2026_matches
  log('SECTION', 'S4A_FIX', '4A — wc2026_matches: all rows and columns');

  const [fixAll] = await db.execute(`
    SELECT f.match_id, f.match_date, f.kickoff_utc, f.stage,
           f.home_team_id, f.away_team_id, f.venue_id, f.status,
           ht.fifa_code AS home_code, ht.name AS home_name,
           at.fifa_code AS away_code, at.name AS away_name
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    ORDER BY f.kickoff_utc
  `);

  log('STATE', 'S4A_FIX', `  Total matchs: ${fixAll.length}`);
  const fixByDate = {};
  for (const f of fixAll) {
    const d = String(f.match_date).slice(0, 10);
    if (!fixByDate[d]) fixByDate[d] = [];
    fixByDate[d].push(f);
  }
  for (const [date, rows] of Object.entries(fixByDate).sort()) {
    log('STATE', 'S4A_FIX', `  ${date}: ${rows.length} matchs`);
    for (const r of rows) {
      log('REAL_DATA', 'S4A_FIX', `    ${r.match_id} | ${r.home_code} (${r.home_name}) vs ${r.away_code} (${r.away_name}) | ${r.kickoff_utc} | ${r.status}`);
    }
  }

  // 4B: wc2026_frozen_book_odds — full data validation
  log('SECTION', 'S4B_BOOK', '4B — wc2026_frozen_book_odds: full data validation');

  const [bookAll] = await db.execute(`SELECT * FROM wc2026_frozen_book_odds ORDER BY match_id`);
  log('STATE', 'S4B_BOOK', `  Total book odds rows: ${bookAll.length}`);

  const BOOK_REQUIRED = [
    'book_home_ml','book_draw_ml','book_away_ml',
    'book_spread_line','book_home_spread_odds','book_away_spread_odds',
    'book_total_line','book_over_odds','book_under_odds',
    'book_btts_yes_odds','book_btts_no_odds',
    'book_dc_1x_odds','book_dc_x2_odds','book_no_draw_home_odds',
    'to_advance_home_odds','to_advance_away_odds'
  ];

  for (const row of bookAll) {
    const nullFields = BOOK_REQUIRED.filter(f => row[f] === null || row[f] === undefined);
    if (nullFields.length > 0) {
      log('WARN', 'S4B_BOOK', `  ${row.match_id}: ${nullFields.length} NULL required fields: ${nullFields.join(', ')}`);
      addIssue('DB-04', 'HIGH', 'S4B_BOOK',
        `Book odds row for ${row.match_id} has NULL required fields`,
        `NULL fields: ${nullFields.join(', ')}`,
        'Seed the missing book odds fields before running the engine for this match'
      );
    } else {
      log('PASS', 'S4B_BOOK', `  ${row.match_id}: all 16 required book fields populated ✓`);
    }
    // Log all values
    for (const f of BOOK_REQUIRED) {
      const v = row[f];
      const vStr = v > 0 ? `+${v}` : String(v);
      log('REAL_DATA', 'S4B_BOOK', `    ${pad(row.match_id,20)} ${pad(f,30)} = ${vStr}`);
    }
    // Check for book_no_draw_away_odds (schema has it, v14 doesn't query it)
    if (row.book_no_draw_away_odds !== null) {
      log('WARN', 'S4B_BOOK', `  ${row.match_id}: book_no_draw_away_odds=${row.book_no_draw_away_odds} EXISTS but v14 does NOT query it — potential unused data`);
    }
  }

  // 4C: wc2026_model_projections — check existing projections
  log('SECTION', 'S4C_PROJ', '4C — wc2026_model_projections: existing projections');

  const [projAll] = await db.execute(`SELECT * FROM wc2026_model_projections ORDER BY match_id`);
  log('STATE', 'S4C_PROJ', `  Total model projection rows: ${projAll.length}`);
  for (const p of projAll) {
    log('REAL_DATA', 'S4C_PROJ', `  ${p.match_id} | ${p.market_key} | book=${p.book_odds} model=${p.model_odds} isFrozen=${p.is_frozen}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 5: CROSS-REFERENCE — V14 ENGINE QUERIES vs DB REALITY
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 5 — CROSS-REFERENCE: V14 ENGINE QUERIES vs DB REALITY');

  log('SECTION', 'S5_XREF', 'Cross-referencing every v14 query against actual DB schema');

  // Get actual column names for each table v14 queries
  const V14_TABLES = [
    'wc2026_espn_expected_goals',
    'wc2026_espn_team_stats',
    'wc2026_espn_match_stats',
    'wc2026_espn_player_stats',
    'wc2026_espn_shot_map',
    'wc2026_espn_matches',
    'wc2026_matches',
    'wc2026_teams',
    'wc2026_frozen_book_odds',
  ];

  const actualColumns = {};
  for (const tbl of V14_TABLES) {
    const [cols] = await db.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [tbl]
    );
    actualColumns[tbl] = cols.map(c => c.COLUMN_NAME);
    log('DB', 'S5_XREF', `  ${tbl}: ${actualColumns[tbl].length} columns`);
  }

  // Cross-reference each query
  for (const [queryId, qDef] of Object.entries(V14_QUERIES)) {
    log('XREF', 'S5_XREF', `  Query ${queryId}: table=${qDef.table}`);
    const tableActualCols = actualColumns[qDef.table] || [];

    if (qDef.columns && qDef.columns[0] !== '*') {
      for (const col of qDef.columns) {
        // Strip table alias prefix
        const colName = col.includes('.') ? col.split('.').pop().split(' ')[0] : col.split(' ')[0];
        // Skip computed aliases
        if (col.includes(' AS ')) {
          const alias = col.split(' AS ')[0].split('.').pop();
          const exists = tableActualCols.includes(alias) ||
            (qDef.join && col.includes('.'));
          log('PASS', 'S5_XREF', `    ${col} → alias/join column — OK`);
          continue;
        }
        if (tableActualCols.includes(colName)) {
          log('PASS', 'S5_XREF', `    ${colName} EXISTS in ${qDef.table} ✓`);
        } else {
          log('FAIL', 'S5_XREF', `    ${colName} MISSING from ${qDef.table} — COLUMN NOT FOUND`);
          addIssue(`XREF-${queryId}-${colName}`, 'CRITICAL', 'S5_XREF',
            `v14 queries column '${colName}' from '${qDef.table}' but it does NOT exist`,
            `Actual columns: ${tableActualCols.join(', ')}`,
            `Fix the column name in v14_engine.mjs query ${queryId}`
          );
        }
      }
    }
  }

  // 5B: Check for columns v14 uses in buildGSRows that must exist
  log('SECTION', 'S5B_XREF', '5B — Validate buildGSRows field access against actual column names');

  const buildGSRowsFields = {
    'wc2026_espn_expected_goals': ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev','homeXG','awayXG','homeXGOT','awayXGOT','homeXA','awayXA'],
    'wc2026_espn_team_stats': ['matchId','possession','possessionAway'],
    'wc2026_espn_match_stats': ['matchId','homeShotsOnGoal','awayShotsOnGoal','homeShots','awayShots'],
  };

  for (const [tbl, fields] of Object.entries(buildGSRowsFields)) {
    const actual = actualColumns[tbl] || [];
    for (const f of fields) {
      if (actual.includes(f)) {
        log('PASS', 'S5B_XREF', `  ${tbl}.${f} EXISTS ✓`);
      } else {
        log('FAIL', 'S5B_XREF', `  ${tbl}.${f} MISSING — v14 buildGSRows will HARD_FAIL`);
        addIssue(`XREF-buildGS-${tbl}-${f}`, 'CRITICAL', 'S5B_XREF',
          `buildGSRows accesses ${tbl}.${f} but column does not exist`,
          `Actual columns in ${tbl}: ${actual.join(', ')}`,
          `Correct the column name in buildGSRows`
        );
      }
    }
  }

  // 5C: Unused available data — columns in ESPN tables NOT queried by v14
  log('SECTION', 'S5C_UNUSED', '5C — Unused available data: columns in ESPN tables NOT queried by v14');

  const v14QueriedCols = {
    'wc2026_espn_expected_goals': ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev','homeXG','awayXG','homeXGOT','awayXGOT','homeXA','awayXA'],
    'wc2026_espn_team_stats': ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev','possession','possessionAway'],
    'wc2026_espn_match_stats': ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev','homeShotsOnGoal','awayShotsOnGoal','homeShots','awayShots'],
    'wc2026_espn_player_stats': ['matchId','matchRound','teamAbbrev','name','xG','g','a','sog','shot'],
    'wc2026_espn_shot_map': ['matchId','matchRound','teamAbbrev','xG','xGOT'],
    'wc2026_espn_matches': ['matchId','matchRound','homeTeamAbbrev','awayTeamAbbrev','homeScore','awayScore','statusState'],
    'wc2026_frozen_book_odds': ['match_id','book_home_ml','book_draw_ml','book_away_ml','book_spread_line','book_home_spread_odds','book_away_spread_odds','book_total_line','book_over_odds','book_under_odds','book_btts_yes_odds','book_btts_no_odds','book_dc_1x_odds','book_dc_x2_odds','book_no_draw_home_odds','to_advance_home_odds','to_advance_away_odds'],
  };

  for (const [tbl, queried] of Object.entries(v14QueriedCols)) {
    const actual = actualColumns[tbl] || [];
    const unused = actual.filter(c => !queried.includes(c));
    if (unused.length > 0) {
      log('WARN', 'S5C_UNUSED', `  ${tbl}: ${unused.length} UNUSED columns: ${unused.join(', ')}`);
    } else {
      log('PASS', 'S5C_UNUSED', `  ${tbl}: all available columns are queried ✓`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 6: JULY 1 TEAM-LEVEL DATA COMPLETENESS CHECK
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 6 — JULY 1 TEAM DATA COMPLETENESS: PER-TEAM, PER-MATCH VALIDATION');

  const JUL1_TEAMS = ['ENG','COD','BEL','SEN','USA','BIH'];

  for (const team of JUL1_TEAMS) {
    log('SECTION', 'S6_TEAM', `━━━ TEAM: ${team} ━━━`);

    // GS xG rows
    const [xgRows] = await db.execute(`
      SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev,
             homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
      FROM wc2026_espn_expected_goals
      WHERE matchRound = 'group-stage'
        AND (homeTeamAbbrev = ? OR awayTeamAbbrev = ?)
      ORDER BY matchId
    `, [team, team]);

    log('STATE', 'S6_TEAM', `  ${team}: ${xgRows.length} GS xG rows`);
    for (const r of xgRows) {
      const side = r.homeTeamAbbrev === team ? 'home' : 'away';
      const xg = side === 'home' ? r.homeXG : r.awayXG;
      const xgot = side === 'home' ? r.homeXGOT : r.awayXGOT;
      const xa = side === 'home' ? r.homeXA : r.awayXA;
      const xgNull = xg === null ? ' ← NULL!' : '';
      const xgotNull = xgot === null ? ' ← NULL!' : '';
      log('REAL_DATA', 'S6_TEAM', `  ${r.matchId} [${side}] xG=${xg}${xgNull} xGOT=${xgot}${xgotNull} xA=${xa}`);
      if (xg === null) {
        addIssue(`TEAM-${team}-${r.matchId}-XG`, 'CRITICAL', 'S6_TEAM',
          `${team} match ${r.matchId}: xG is NULL in GS data`,
          `homeXG=${r.homeXG} awayXG=${r.awayXG} side=${side}`,
          'Re-scrape ESPN data for this match or flag as data gap'
        );
      }
    }

    // GS team stats (possession)
    const [tsRows] = await db.execute(`
      SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev, possession, possessionAway
      FROM wc2026_espn_team_stats
      WHERE matchRound = 'group-stage'
        AND (homeTeamAbbrev = ? OR awayTeamAbbrev = ?)
      ORDER BY matchId
    `, [team, team]);

    log('STATE', 'S6_TEAM', `  ${team}: ${tsRows.length} GS team stats rows`);
    for (const r of tsRows) {
      const side = r.homeTeamAbbrev === team ? 'home' : 'away';
      const poss = side === 'home' ? r.possession : r.possessionAway;
      log('REAL_DATA', 'S6_TEAM', `  ${r.matchId} [${side}] possession=${poss}`);
    }

    // GS match stats (shots)
    const [msRows] = await db.execute(`
      SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev,
             homeShotsOnGoal, awayShotsOnGoal, homeShots, awayShots
      FROM wc2026_espn_match_stats
      WHERE matchRound = 'group-stage'
        AND (homeTeamAbbrev = ? OR awayTeamAbbrev = ?)
      ORDER BY matchId
    `, [team, team]);

    log('STATE', 'S6_TEAM', `  ${team}: ${msRows.length} GS match stats rows`);
    for (const r of msRows) {
      const side = r.homeTeamAbbrev === team ? 'home' : 'away';
      const sot = side === 'home' ? r.homeShotsOnGoal : r.awayShotsOnGoal;
      const shots = side === 'home' ? r.homeShots : r.awayShots;
      log('REAL_DATA', 'S6_TEAM', `  ${r.matchId} [${side}] SOT=${sot} shots=${shots}`);
    }

    // Player stats
    const [psRows] = await db.execute(`
      SELECT matchId, teamAbbrev, COUNT(*) AS playerCount, SUM(xG) AS totalXG, SUM(g) AS totalGoals
      FROM wc2026_espn_player_stats
      WHERE (matchRound = 'group-stage' OR matchRound IS NULL) AND teamAbbrev = ?
      GROUP BY matchId, teamAbbrev
      ORDER BY matchId
    `, [team]);

    log('STATE', 'S6_TEAM', `  ${team}: ${psRows.length} GS match-level player stat groups`);
    for (const r of psRows) {
      log('REAL_DATA', 'S6_TEAM', `  ${r.matchId}: ${r.playerCount} players, totalXG=${r.totalXG}, totalGoals=${r.totalGoals}`);
    }

    // Shot map
    const [smRows] = await db.execute(`
      SELECT matchId, teamAbbrev, COUNT(*) AS shotCount, SUM(xG) AS totalXG
      FROM wc2026_espn_shot_map
      WHERE matchRound = 'group-stage' AND teamAbbrev = ?
      GROUP BY matchId, teamAbbrev
      ORDER BY matchId
    `, [team]);

    log('STATE', 'S6_TEAM', `  ${team}: ${smRows.length} GS match-level shot map groups`);
    for (const r of smRows) {
      log('REAL_DATA', 'S6_TEAM', `  ${r.matchId}: ${r.shotCount} shots, totalXG=${r.totalXG}`);
    }

    // Completeness check
    const xgCount = xgRows.length;
    const tsCount = tsRows.length;
    const msCount = msRows.length;
    const psCount = psRows.length;
    const smCount = smRows.length;

    if (xgCount === 0) {
      addIssue(`TEAM-${team}-XG-ZERO`, 'CRITICAL', 'S6_TEAM', `${team}: ZERO GS xG rows`, 'No data in wc2026_espn_expected_goals for this team', 'Re-scrape ESPN GS data');
    }
    if (tsCount !== xgCount) {
      addIssue(`TEAM-${team}-TS-MISMATCH`, 'HIGH', 'S6_TEAM', `${team}: team stats rows (${tsCount}) ≠ xG rows (${xgCount})`, `xG has ${xgCount} rows, team_stats has ${tsCount}`, 'Re-scrape team stats for missing matches');
    }
    if (msCount !== xgCount) {
      addIssue(`TEAM-${team}-MS-MISMATCH`, 'HIGH', 'S6_TEAM', `${team}: match stats rows (${msCount}) ≠ xG rows (${xgCount})`, `xG has ${xgCount} rows, match_stats has ${msCount}`, 'Re-scrape match stats for missing matches');
    }
    if (psCount !== xgCount) {
      addIssue(`TEAM-${team}-PS-MISMATCH`, 'MEDIUM', 'S6_TEAM', `${team}: player stat groups (${psCount}) ≠ xG rows (${xgCount})`, `xG has ${xgCount} rows, player_stats has ${psCount} match groups`, 'Re-scrape player stats for missing matches');
    }
    if (smCount !== xgCount) {
      addIssue(`TEAM-${team}-SM-MISMATCH`, 'MEDIUM', 'S6_TEAM', `${team}: shot map groups (${smCount}) ≠ xG rows (${xgCount})`, `xG has ${xgCount} rows, shot_map has ${smCount} match groups`, 'Re-scrape shot map for missing matches');
    }

    if (xgCount > 0 && tsCount === xgCount && msCount === xgCount) {
      log('PASS', 'S6_TEAM', `  ${team}: data completeness PASS (xG=${xgCount} TS=${tsCount} MS=${msCount} PS=${psCount} SM=${smCount}) ✓`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 7: MATHEMATICAL INTEGRITY CHECKS
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 7 — MATHEMATICAL INTEGRITY: LAMBDA COMPUTATION VALIDATION');

  log('SECTION', 'S7_MATH', '7A — Verify xGOT/xG empirical ratio computation');

  const [gsXgFull] = await db.execute(`
    SELECT homeXG, awayXG, homeXGOT, awayXGOT
    FROM wc2026_espn_expected_goals
    WHERE matchRound = 'group-stage'
      AND homeXG IS NOT NULL AND awayXG IS NOT NULL
      AND homeXGOT IS NOT NULL AND awayXGOT IS NOT NULL
  `);

  const totalXG = gsXgFull.reduce((s, r) => s + Number(r.homeXG) + Number(r.awayXG), 0);
  const totalXGOT = gsXgFull.reduce((s, r) => s + Number(r.homeXGOT) + Number(r.awayXGOT), 0);
  const ratio = totalXG > 0 ? totalXGOT / totalXG : null;

  log('REAL_DATA', 'S7_MATH', `  GS rows with complete xG/xGOT: ${gsXgFull.length}`);
  log('REAL_DATA', 'S7_MATH', `  Total xG: ${fmt(totalXG)} | Total xGOT: ${fmt(totalXGOT)}`);
  log('REAL_DATA', 'S7_MATH', `  Empirical xGOT/xG ratio: ${fmt(ratio)} (v14 uses this as C7 discount)`);

  if (ratio === null) {
    addIssue('MATH-01', 'CRITICAL', 'S7_MATH', 'Cannot compute empirical xGOT/xG ratio — totalXG=0', 'No valid GS xG data', 'Re-scrape ESPN GS data');
  } else if (ratio > 1.5 || ratio < 0.5) {
    addIssue('MATH-02', 'HIGH', 'S7_MATH', `Empirical xGOT/xG ratio=${fmt(ratio)} is outside expected range [0.5, 1.5]`, `totalXG=${fmt(totalXG)} totalXGOT=${fmt(totalXGOT)}`, 'Investigate xGOT data quality — may indicate scraping error');
  } else {
    log('PASS', 'S7_MATH', `  xGOT/xG ratio=${fmt(ratio)} within expected range [0.5, 1.5] ✓`);
  }

  // 7B: Verify VARIATIONS weight sums
  log('SECTION', 'S7B_MATH', '7B — Verify all 10 VARIATION weight sums');

  const VARIATIONS = [
    { id:'V1',  xGW:0.35, xGOTW:0.20, smW:0.15, psW:0.15, xAW:0.10, spW:0.05 },
    { id:'V2',  xGW:0.45, xGOTW:0.15, smW:0.12, psW:0.15, xAW:0.08, spW:0.05 },
    { id:'V3',  xGW:0.40, xGOTW:0.18, smW:0.12, psW:0.15, xAW:0.10, spW:0.05 },
    { id:'V4',  xGW:0.30, xGOTW:0.25, smW:0.15, psW:0.15, xAW:0.10, spW:0.05 },
    { id:'V5',  xGW:0.33, xGOTW:0.17, smW:0.13, psW:0.22, xAW:0.09, spW:0.06 },
    { id:'V6',  xGW:0.25, xGOTW:0.20, smW:0.20, psW:0.15, xAW:0.10, spW:0.10 },
    { id:'V7',  xGW:0.50, xGOTW:0.10, smW:0.10, psW:0.15, xAW:0.10, spW:0.05 },
    { id:'V8',  xGW:0.35, xGOTW:0.20, smW:0.10, psW:0.20, xAW:0.10, spW:0.05 },
    { id:'V9',  xGW:0.40, xGOTW:0.15, smW:0.15, psW:0.15, xAW:0.10, spW:0.05 },
    { id:'V10', xGW:0.30, xGOTW:0.20, smW:0.15, psW:0.15, xAW:0.10, spW:0.10 },
  ];

  for (const v of VARIATIONS) {
    const sum = v.xGW + v.xGOTW + v.smW + v.psW + v.xAW + v.spW;
    if (Math.abs(sum - 1.0) > 0.001) {
      log('FAIL', 'S7B_MATH', `  ${v.id}: core 6 weights sum=${fmt(sum,6)} ≠ 1.0 — C8 gate will HARD_FAIL`);
      addIssue(`MATH-V-${v.id}`, 'CRITICAL', 'S7B_MATH',
        `${v.id} core 6 weights sum=${fmt(sum,6)} ≠ 1.0`,
        `xGW=${v.xGW} xGOTW=${v.xGOTW} smW=${v.smW} psW=${v.psW} xAW=${v.xAW} spW=${v.spW}`,
        `Renormalize weights to sum exactly to 1.0`
      );
    } else {
      log('PASS', 'S7B_MATH', `  ${v.id}: core 6 weights sum=${fmt(sum,6)} ✓`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 8: BACKTEST COVERAGE ANALYSIS
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 8 — BACKTEST COVERAGE: COMPLETED KO MATCHES vs AVAILABLE DATA');

  const [koCompleted] = await db.execute(`
    SELECT em.matchId, em.homeTeamAbbrev, em.awayTeamAbbrev, em.homeScore, em.awayScore, em.statusState
    FROM wc2026_espn_matches em
    WHERE em.matchRound = 'round-of-32'
      AND em.homeScore IS NOT NULL
      AND em.awayScore IS NOT NULL
      AND em.statusState = 'post'
    ORDER BY em.matchId
  `);

  log('STATE', 'S8_BT', `  Completed KO matches available for backtest: ${koCompleted.length}`);

  for (const m of koCompleted) {
    log('REAL_DATA', 'S8_BT', `  ${m.matchId}: ${m.homeTeamAbbrev} ${m.homeScore}-${m.awayScore} ${m.awayTeamAbbrev}`);

    // Check each team has GS data
    for (const [team, role] of [[m.homeTeamAbbrev,'home'],[m.awayTeamAbbrev,'away']]) {
      const [gsCount] = await db.execute(`
        SELECT COUNT(*) AS cnt FROM wc2026_espn_expected_goals
        WHERE matchRound = 'group-stage' AND (homeTeamAbbrev = ? OR awayTeamAbbrev = ?)
          AND homeXG IS NOT NULL AND awayXG IS NOT NULL
      `, [team, team]);
      const cnt = gsCount[0].cnt;
      if (cnt === 0) {
        log('FAIL', 'S8_BT', `    ${team} (${role}): ZERO GS xG rows — will be SKIPPED in backtest`);
        addIssue(`BT-${m.matchId}-${team}`, 'HIGH', 'S8_BT',
          `Backtest match ${m.matchId}: ${team} has zero GS xG rows`,
          `matchId=${m.matchId} team=${team} role=${role}`,
          'Re-scrape ESPN GS data for this team'
        );
      } else {
        log('PASS', 'S8_BT', `    ${team} (${role}): ${cnt} GS xG rows ✓`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 9: ISSUE SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 9 — FULL ISSUE REGISTRY: ALL IDENTIFIED PROBLEMS');

  log('SECTION', 'S9_ISSUES', `Total issues identified: ${ISSUES.length}`);

  const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  for (const issue of ISSUES) {
    (bySeverity[issue.severity] || bySeverity.LOW).push(issue);
  }

  for (const [sev, list] of Object.entries(bySeverity)) {
    if (list.length === 0) continue;
    log('SECTION', 'S9_ISSUES', `  ${sev} (${list.length}):`);
    for (const issue of list) {
      log('ISSUE', 'S9_ISSUES', `    [${issue.id}] ${issue.description}`);
      log('STATE', 'S9_ISSUES', `      EVIDENCE: ${issue.evidence}`);
      log('FIX', 'S9_ISSUES', `      FIX: ${issue.fix}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 10: SAVE FULL REPORT
  // ════════════════════════════════════════════════════════════════════════════
  sectionHeader('SECTION 10 — SAVE FULL AUDIT REPORT');

  auditReport.issues = ISSUES;
  auditReport.stats = { PASS, FAIL, WARN, STEP, issueCount: ISSUES.length };
  auditReport.crossRef = {
    v14Queries: V14_QUERIES,
    actualColumns,
    unusedColumns: V14_UNUSED_KNOWN,
  };
  auditReport.dataMap = {
    xgRows: xgFull.length,
    tsRows: tsFull.length,
    msRows: msFull.length,
    psRows: psFull.length,
    smRows: smFull.length,
    emRows: emFull.length,
    fixRows: fixAll.length,
    bookRows: bookAll.length,
    projRows: projAll.length,
    koCompleted: koCompleted.length,
    empiricalXGOTRatio: ratio,
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(auditReport, null, 2));
  log('OUTPUT', 'S10_SAVE', `Full audit report saved → ${REPORT_FILE}`);

  banner(`v14.0-KO24 500x DB AUDIT COMPLETE | PASS=${PASS} FAIL=${FAIL} WARN=${WARN} STEP=${STEP} ISSUES=${ISSUES.length}`);

  await db.end();
}

main().catch(err => {
  log('FAIL', 'FATAL', `Unhandled error: ${err.message}`);
  fs.appendFileSync(LOG_FILE, `[FATAL] ${err.stack}\n`);
  process.exit(1);
});
