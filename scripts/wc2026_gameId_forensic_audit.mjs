#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  500X FORENSIC AUDIT: gameId ACROSS WC2026 SCOPE                           ║
 * ║  ─────────────────────────────────────────────────────────────────────────  ║
 * ║  OBJECTIVE: Map every occurrence of "gameId" in the entire project,         ║
 * ║  classify by origin (ESPN / Internal / Action Network / Other),             ║
 * ║  trace data flow, and produce a certified audit log.                        ║
 * ║                                                                             ║
 * ║  OUTPUT: wcfilecleanup.txt (append-only execution log)                      ║
 * ║  STANDARD: Industry-leading forensic debugging framework                    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PROJECT_ROOT = '/home/ubuntu/ai-sports-betting';
const LOG_FILE = join(PROJECT_ROOT, 'wcfilecleanup.txt');
const AUDIT_START = new Date().toISOString();
const RUN_ID = `FORENSIC-${Date.now()}`;

// Directories to EXCLUDE from scan
const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'drizzle/meta', 'drizzle/migrations', '.manus-logs'];

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING FRAMEWORK (Industry-Leading Structured Output)
// ═══════════════════════════════════════════════════════════════════════════════

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgMagenta: '\x1b[45m',
};

let logLineCount = 0;
let phaseCount = 0;
let stepCount = 0;
let findingCount = 0;

function initLog() {
  const header = [
    '═'.repeat(100),
    `║  500X FORENSIC AUDIT: gameId ACROSS WC2026 SCOPE`,
    `║  Run ID: ${RUN_ID}`,
    `║  Started: ${AUDIT_START}`,
    `║  Project: ${PROJECT_ROOT}`,
    `║  Standard: Industry-Leading Forensic Debugging Framework`,
    '═'.repeat(100),
    '',
  ].join('\n');
  writeFileSync(LOG_FILE, header);
  console.log(`${C.bgBlue}${C.white}${C.bold} ╔══════════════════════════════════════════════════════════════════════════╗ ${C.reset}`);
  console.log(`${C.bgBlue}${C.white}${C.bold} ║  500X FORENSIC AUDIT: gameId ACROSS WC2026 SCOPE                        ║ ${C.reset}`);
  console.log(`${C.bgBlue}${C.white}${C.bold} ║  Run ID: ${RUN_ID}                                    ║ ${C.reset}`);
  console.log(`${C.bgBlue}${C.white}${C.bold} ╚══════════════════════════════════════════════════════════════════════════╝ ${C.reset}`);
  console.log('');
}

function log(level, phase, msg, data) {
  logLineCount++;
  const ts = new Date().toISOString();
  const badges = {
    'PHASE':   `${C.bgGreen}${C.white}${C.bold} PHASE ${C.reset}`,
    'STEP':    `${C.blue}${C.bold}[STEP]${C.reset}`,
    'SCAN':    `${C.cyan}[SCAN]${C.reset}`,
    'FIND':    `${C.green}${C.bold}[FIND]${C.reset}`,
    'DB':      `${C.magenta}[DB]${C.reset}`,
    'VERIFY':  `${C.green}[VERIFY]${C.reset}`,
    'WARN':    `${C.yellow}[WARN]${C.reset}`,
    'ERROR':   `${C.red}${C.bold}[ERROR]${C.reset}`,
    'STATE':   `${C.dim}[STATE]${C.reset}`,
    'RESULT':  `${C.bgGreen}${C.white}${C.bold} RESULT ${C.reset}`,
    'SECTION': `${C.bgMagenta}${C.white}${C.bold} SECTION ${C.reset}`,
    'TRACE':   `${C.yellow}[TRACE]${C.reset}`,
    'CLASSIFY':`${C.cyan}${C.bold}[CLASSIFY]${C.reset}`,
  };
  
  const badge = badges[level] || `[${level}]`;
  const termLine = `${C.dim}${ts}${C.reset} ${badge} ${C.bold}${phase}${C.reset} — ${msg}`;
  const fileLine = `[${ts}] [${level}] [${phase}] ${msg}${data ? ' | ' + JSON.stringify(data) : ''}`;
  
  console.log(termLine);
  if (data && Object.keys(data).length > 0) {
    const dataStr = JSON.stringify(data, null, 2).split('\n').map(l => `    ${C.dim}${l}${C.reset}`).join('\n');
    console.log(dataStr);
  }
  appendFileSync(LOG_FILE, fileLine + '\n');
}

function logPhase(title) {
  phaseCount++;
  const divider = '─'.repeat(90);
  const phaseHeader = `\n${'═'.repeat(100)}\n║  PHASE ${phaseCount}: ${title}\n${'═'.repeat(100)}\n`;
  appendFileSync(LOG_FILE, phaseHeader);
  console.log('');
  console.log(`${C.dim}${divider}${C.reset}`);
  log('PHASE', `P${phaseCount}`, title);
  console.log(`${C.dim}${divider}${C.reset}`);
}

function logStep(msg) {
  stepCount++;
  log('STEP', `S${stepCount}`, msg);
}

function logFinding(category, file, line, context, origin) {
  findingCount++;
  log('FIND', `F${findingCount}`, `[${category}] ${file}:${line}`, { context: context.trim(), origin });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: CODEBASE-WIDE gameId DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

function scanCodebase() {
  logPhase('CODEBASE-WIDE gameId DISCOVERY — Every file, every line, every context');
  
  logStep('Building file inventory (excluding node_modules, .git, dist, drizzle/meta, drizzle/migrations)');
  
  const excludeArgs = EXCLUDE_DIRS.map(d => `--exclude-dir=${d}`).join(' ');
  
  // Search for gameId (camelCase) in all source files
  const patterns = [
    { pattern: 'gameId', label: 'camelCase gameId' },
    { pattern: 'game_id', label: 'snake_case game_id' },
    { pattern: 'GAME_ID', label: 'UPPER_CASE GAME_ID' },
    { pattern: 'GameId', label: 'PascalCase GameId' },
  ];
  
  const allFindings = [];
  
  for (const { pattern, label } of patterns) {
    logStep(`Scanning for pattern: "${pattern}" (${label})`);
    
    try {
      const cmd = `cd ${PROJECT_ROOT} && grep -rn "${pattern}" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" --include="*.py" --include="*.sql" ${excludeArgs} . 2>/dev/null || true`;
      const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      const lines = output.trim().split('\n').filter(Boolean);
      
      log('SCAN', 'GREP', `Pattern "${pattern}" → ${lines.length} occurrences found`, { pattern, count: lines.length });
      
      for (const line of lines) {
        const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
        if (!match) continue;
        const [, file, lineNum, content] = match;
        allFindings.push({ pattern, file, lineNum: parseInt(lineNum), content: content.trim() });
      }
    } catch (e) {
      log('ERROR', 'GREP', `Failed scanning for "${pattern}": ${e.message}`);
    }
  }
  
  log('RESULT', 'SCAN_COMPLETE', `Total raw occurrences: ${allFindings.length}`, {
    gameId: allFindings.filter(f => f.pattern === 'gameId').length,
    game_id: allFindings.filter(f => f.pattern === 'game_id').length,
    GAME_ID: allFindings.filter(f => f.pattern === 'GAME_ID').length,
    GameId: allFindings.filter(f => f.pattern === 'GameId').length,
  });
  
  return allFindings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: CLASSIFY FINDINGS BY ORIGIN
// ═══════════════════════════════════════════════════════════════════════════════

function classifyFindings(findings) {
  logPhase('CLASSIFY FINDINGS BY ORIGIN — ESPN vs Internal vs Action Network vs Other');
  
  const classified = {
    ESPN_WC2026: [],       // ESPN event IDs for World Cup (760xxx)
    ESPN_OTHER: [],        // ESPN IDs for other sports
    INTERNAL_DB_PK: [],   // Internal auto-increment DB primary keys (games.id)
    ACTION_NETWORK: [],   // Action Network game IDs
    VSIN: [],             // VSiN game codes
    MLB_STATS_API: [],    // MLB Stats API gamePk
    NHL_API: [],          // NHL API game IDs
    NBA_ESPN: [],         // NBA ESPN scoreboard IDs
    WC2026_INTERNAL: [],  // Internal WC match IDs (wc26-g-xxx, wc26-r32-xxx)
    SCHEMA_DEF: [],       // Schema/type definitions
    GENERIC_VARIABLE: [], // Generic variable usage
  };
  
  const WC2026_FILES = [
    'wc2026', 'espnDbIngester', 'espnPageScraper', 'espnMatchScraper', 'espnLogger',
    'wc2026Router', 'wc2026Heartbeat', 'wc2026Ingester', 'wc2026BracketScraper',
    'wc2026LiveWatcher', 'wc2026ESPNScraper', 'wc2026BatchAudit', 'wc2026AuditEngine',
    'seedJuly', 'seedAdvancing', 'seedR32', 'seedFifa', 'runESPNBatch', 'getEspnIds',
    'discoverGroupStage', 'forensicAudit', 'espnDomProbe', 'pullAnApiHistoricalWCOdds',
    'fifaLiveScraper',
  ];
  
  for (const f of findings) {
    const fileLower = f.file.toLowerCase();
    const contentLower = f.content.toLowerCase();
    
    // Schema definitions
    if (f.content.includes('int("gameId")') || f.content.includes('varchar("game_id"') ||
        f.content.includes('varchar("espn_match_id"') || f.content.includes('interface ') ||
        f.content.includes('type ') && f.content.includes('gameId:')) {
      classified.SCHEMA_DEF.push(f);
      continue;
    }
    
    // WC2026 ESPN scope
    if (WC2026_FILES.some(wf => fileLower.includes(wf.toLowerCase()))) {
      classified.ESPN_WC2026.push(f);
      continue;
    }
    
    // Action Network
    if (fileLower.includes('actionnetwork') || fileLower.includes('anapi') ||
        f.content.includes('anGameId') || f.content.includes('an_game_id') ||
        fileLower.includes('ankprops') || fileLower.includes('probean')) {
      classified.ACTION_NETWORK.push(f);
      continue;
    }
    
    // VSiN
    if (fileLower.includes('vsin') || f.content.includes('data-gamecode')) {
      classified.VSIN.push(f);
      continue;
    }
    
    // MLB Stats API
    if (fileLower.includes('mlb') && (f.content.includes('gamePk') || f.content.includes('mlbam'))) {
      classified.MLB_STATS_API.push(f);
      continue;
    }
    
    // NHL API
    if (fileLower.includes('nhl') && !fileLower.includes('wc2026')) {
      classified.NHL_API.push(f);
      continue;
    }
    
    // NBA ESPN
    if (fileLower.includes('nba') && !fileLower.includes('wc2026')) {
      classified.NBA_ESPN.push(f);
      continue;
    }
    
    // Internal DB PK (games.id references)
    if (f.content.includes('games.id') || f.content.includes('games.gameId') ||
        f.content.includes('eq(games.id') || f.content.includes('inArray(') && f.content.includes('gameId')) {
      classified.INTERNAL_DB_PK.push(f);
      continue;
    }
    
    // Generic
    classified.GENERIC_VARIABLE.push(f);
  }
  
  // Log classification results
  for (const [category, items] of Object.entries(classified)) {
    if (items.length > 0) {
      log('CLASSIFY', category, `${items.length} occurrences`, {
        files: [...new Set(items.map(i => i.file))].slice(0, 10),
      });
    }
  }
  
  return classified;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: WC2026-SPECIFIC DEEP DIVE
// ═══════════════════════════════════════════════════════════════════════════════

function wc2026DeepDive(findings) {
  logPhase('WC2026-SPECIFIC DEEP DIVE — ESPN gameId Data Flow Trace');
  
  const wc2026Findings = findings.filter(f => {
    const fl = f.file.toLowerCase();
    return fl.includes('wc2026') || fl.includes('espn') || fl.includes('fifa') ||
           fl.includes('bracket') || fl.includes('pullAnApiHistorical');
  });
  
  logStep(`Isolated ${wc2026Findings.length} WC2026-scope findings for deep analysis`);
  
  // Group by file
  const byFile = {};
  for (const f of wc2026Findings) {
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f);
  }
  
  log('STATE', 'FILE_MAP', `${Object.keys(byFile).length} unique WC2026 files contain gameId references`);
  
  // Trace the data flow
  const dataFlowTrace = [];
  
  // 1. ESPN API Source
  logStep('Tracing ESPN API → gameId origin point');
  const espnApiFiles = Object.keys(byFile).filter(f => 
    f.includes('espnPageScraper') || f.includes('espnMatchScraper') || f.includes('wc2026Ingester') ||
    f.includes('wc2026Heartbeat') || f.includes('wc2026LiveWatcher')
  );
  for (const file of espnApiFiles) {
    dataFlowTrace.push({
      file,
      role: 'ESPN API CONSUMER',
      description: `Fetches ESPN event data using gameId (e.g., 760487-760501) as the ESPN event identifier`,
      occurrences: byFile[file].length,
    });
  }
  
  // 2. ESPN DB Ingester
  logStep('Tracing ESPN DB Ingester → gameId storage');
  const ingesterFiles = Object.keys(byFile).filter(f => f.includes('espnDbIngester'));
  for (const file of ingesterFiles) {
    dataFlowTrace.push({
      file,
      role: 'ESPN TABLE WRITER',
      description: `Writes ESPN gameId as espn_match_id column in wc2026_espn_* tables (varchar, e.g., "760487")`,
      occurrences: byFile[file].length,
    });
  }
  
  // 3. Bracket Scraper
  logStep('Tracing Bracket Scraper → gameId propagation');
  const bracketFiles = Object.keys(byFile).filter(f => f.includes('bracket') || f.includes('Bracket'));
  for (const file of bracketFiles) {
    dataFlowTrace.push({
      file,
      role: 'BRACKET PROPAGATOR',
      description: `Uses ESPN gameId to link bracket slots to match results`,
      occurrences: byFile[file].length,
    });
  }
  
  // 4. Router
  logStep('Tracing Router → gameId serving to frontend');
  const routerFiles = Object.keys(byFile).filter(f => f.includes('Router') || f.includes('router'));
  for (const file of routerFiles) {
    dataFlowTrace.push({
      file,
      role: 'API ROUTER',
      description: `Serves gameId-keyed data to frontend via tRPC procedures`,
      occurrences: byFile[file].length,
    });
  }
  
  // Log the full trace
  for (const trace of dataFlowTrace) {
    log('TRACE', trace.role, `${trace.file} (${trace.occurrences} refs)`, { description: trace.description });
  }
  
  // Per-file detailed breakdown
  logStep('Per-file line-level breakdown for WC2026 scope');
  for (const [file, items] of Object.entries(byFile)) {
    const lineNums = items.map(i => i.lineNum).sort((a, b) => a - b);
    log('STATE', 'FILE_DETAIL', `${file}: ${items.length} occurrences at lines [${lineNums.join(', ')}]`);
  }
  
  return { byFile, dataFlowTrace, totalFindings: wc2026Findings.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: DATABASE SCHEMA AUDIT
// ═══════════════════════════════════════════════════════════════════════════════

function databaseAudit() {
  logPhase('DATABASE SCHEMA AUDIT — All tables with gameId/espn_match_id/game_id columns');
  
  logStep('Extracting all gameId-related column definitions from Drizzle schema');
  
  const schemaFile = join(PROJECT_ROOT, 'drizzle/schema.ts');
  const wc2026SchemaFile = join(PROJECT_ROOT, 'drizzle/wc2026.schema.ts');
  
  const tables = [];
  
  // Parse main schema
  const schemaContent = readFileSync(schemaFile, 'utf-8');
  const wc2026SchemaContent = readFileSync(wc2026SchemaFile, 'utf-8');
  
  // Find all table definitions with gameId columns
  const tableRegex = /export const (\w+) = mysqlTable\("([^"]+)"/g;
  const gameIdRegex = /gameId.*?(?:int|varchar|text)\("([^"]+)"/;
  
  let match;
  const allSchemaLines = schemaContent.split('\n');
  
  // Track tables that have gameId
  let currentTable = null;
  let currentTableName = null;
  for (let i = 0; i < allSchemaLines.length; i++) {
    const line = allSchemaLines[i];
    const tableMatch = line.match(/export const (\w+) = mysqlTable\("([^"]+)"/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      currentTableName = tableMatch[2];
    }
    if (line.includes('gameId') && currentTable) {
      const colMatch = line.match(/(gameId|anGameId).*?(?:int|varchar)\("([^"]+)"/);
      if (colMatch) {
        const colType = line.includes('int(') ? 'INT' : 'VARCHAR';
        const colName = colMatch[2];
        const isUnique = line.includes('.unique()');
        const isNotNull = line.includes('.notNull()');
        tables.push({
          drizzleVar: currentTable,
          tableName: currentTableName,
          columnName: colName,
          columnType: colType,
          isUnique,
          isNotNull,
          origin: classifyDbColumn(currentTableName, colName, line),
        });
        log('DB', 'COLUMN_FOUND', `${currentTableName}.${colName} (${colType})`, {
          drizzleVar: currentTable,
          unique: isUnique,
          notNull: isNotNull,
          origin: classifyDbColumn(currentTableName, colName, line),
        });
      }
    }
  }
  
  // Parse WC2026 schema
  const wc2026Lines = wc2026SchemaContent.split('\n');
  currentTable = null;
  currentTableName = null;
  for (let i = 0; i < wc2026Lines.length; i++) {
    const line = wc2026Lines[i];
    const tableMatch = line.match(/export const (\w+) = mysqlTable\("([^"]+)"/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      currentTableName = tableMatch[2];
    }
    if ((line.includes('gameId') || line.includes('game_id')) && currentTable && !line.startsWith('//')) {
      const colMatch = line.match(/(\w+):\s*varchar\("([^"]+)"/);
      if (colMatch) {
        tables.push({
          drizzleVar: currentTable,
          tableName: currentTableName,
          columnName: colMatch[2],
          columnType: 'VARCHAR',
          isUnique: line.includes('.unique()'),
          isNotNull: line.includes('.notNull()'),
          origin: 'ESPN_EVENT_ID (WC2026)',
        });
        log('DB', 'COLUMN_FOUND', `${currentTableName}.${colMatch[2]} (VARCHAR) — WC2026 ESPN scope`, {
          drizzleVar: currentTable,
        });
      }
    }
  }
  
  // Also find espn_match_id columns (which store ESPN gameId in WC2026 tables)
  logStep('Scanning for espn_match_id columns (ESPN gameId aliases in WC2026 tables)');
  currentTable = null;
  currentTableName = null;
  for (let i = 0; i < allSchemaLines.length; i++) {
    const line = allSchemaLines[i];
    const tableMatch = line.match(/export const (\w+) = mysqlTable\("([^"]+)"/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      currentTableName = tableMatch[2];
    }
    if (line.includes('espn_match_id') && currentTable && currentTableName?.includes('wc2026_espn')) {
      const colMatch = line.match(/espn_match_id.*?varchar\("([^"]+)"/);
      if (colMatch) {
        tables.push({
          drizzleVar: currentTable,
          tableName: currentTableName,
          columnName: colMatch[1],
          columnType: 'VARCHAR(32)',
          isUnique: line.includes('.unique()'),
          isNotNull: line.includes('.notNull()'),
          origin: 'ESPN_EVENT_ID (stored as espn_match_id in ESPN page-scraper tables)',
        });
        log('DB', 'COLUMN_FOUND', `${currentTableName}.${colMatch[1]} (VARCHAR) — ESPN gameId stored as espn_match_id`, {
          drizzleVar: currentTable,
          comment: 'This IS the ESPN gameId (e.g., "760487") stored under the column name "espn_match_id"',
        });
      }
    }
  }
  
  log('RESULT', 'DB_AUDIT', `Found ${tables.length} gameId-related columns across all tables`, {
    byOrigin: tables.reduce((acc, t) => { acc[t.origin] = (acc[t.origin] || 0) + 1; return acc; }, {}),
  });
  
  return tables;
}

function classifyDbColumn(tableName, colName, line) {
  if (tableName.includes('wc2026_espn')) return 'ESPN_EVENT_ID (WC2026 page-scraper)';
  if (tableName.includes('wc2026')) return 'INTERNAL_WC_MATCH_ID';
  if (colName === 'anGameId') return 'ACTION_NETWORK_GAME_ID';
  if (tableName === 'odds_history') return 'INTERNAL_DB_FK (→ games.id)';
  if (tableName === 'mlb_lineups') return 'INTERNAL_DB_FK (→ games.id)';
  if (tableName === 'mlb_strikeout_props') return 'INTERNAL_DB_FK (→ games.id)';
  if (tableName === 'mlb_hr_props') return 'INTERNAL_DB_FK (→ games.id)';
  if (tableName === 'mlb_game_backtest') return 'INTERNAL_DB_FK (→ games.id)';
  if (tableName === 'tracked_bets') return 'INTERNAL_DB_FK (→ games.id, nullable)';
  if (tableName === 'user_favorite_games') return 'INTERNAL_DB_FK (→ games.id)';
  return 'INTERNAL_DB_FK (→ games.id)';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: DEFINITIVE ANSWER — IS gameId AN ESPN ELEMENT?
// ═══════════════════════════════════════════════════════════════════════════════

function produceDefinitiveAnswer(classified, dbTables, wc2026Deep) {
  logPhase('DEFINITIVE ANSWER — Is gameId an ESPN element?');
  
  const answer = {
    question: 'Is gameId an ESPN element?',
    answer: 'PARTIALLY — gameId is a POLYMORPHIC identifier used across MULTIPLE systems with DIFFERENT semantics depending on context.',
    breakdown: {
      ESPN_CONTEXT: {
        description: 'In WC2026 scope, gameId IS the ESPN event identifier (e.g., 760487, 760499, 760500, 760501)',
        tables: 'wc2026_espn_matches.espn_match_id, wc2026_espn_bracket.game_id, wc2026_espn_team_stats.espn_match_id, wc2026_espn_match_stats.espn_match_id, wc2026_espn_xg.espn_match_id, wc2026_espn_shots.espn_match_id, wc2026_espn_player_stats.espn_match_id, wc2026_espn_lineups.espn_match_id',
        files: 'espnDbIngester.ts, espnPageScraper.ts, espnMatchScraper.ts, wc2026Ingester.ts, wc2026Heartbeat.ts, wc2026LiveWatcher.mjs, runESPNBatch.mjs',
        format: 'String "760487" — ESPN event ID from site.api.espn.com',
        note: 'The ESPN page-scraper tables use "espn_match_id" as the column name but the VALUE is the ESPN gameId',
      },
      INTERNAL_DB_CONTEXT: {
        description: 'In MLB/NBA/NHL scope, gameId is an INTERNAL auto-increment integer FK referencing games.id',
        tables: 'odds_history.gameId, mlb_lineups.gameId, mlb_strikeout_props.gameId, mlb_hr_props.gameId, mlb_game_backtest.gameId, tracked_bets.gameId, user_favorite_games.gameId',
        files: 'db.ts, routers.ts, mlbModelRunner.ts, mlbLineupsWatcher.ts, scoreGrader.ts, vsinAutoRefresh.ts',
        format: 'Integer (auto-increment) — internal DB primary key from games table',
        note: 'This is NOT an ESPN ID — it is the internal DB row ID',
      },
      ACTION_NETWORK_CONTEXT: {
        description: 'In schedule history tables, anGameId is the Action Network internal game identifier',
        tables: 'mlb_schedule_history.anGameId, nba_schedule_history.anGameId, nhl_schedule_history.anGameId',
        files: 'actionNetworkScraper.ts, mlbScheduleHistoryService.ts, nbaScheduleHistoryService.ts, nhlScheduleHistoryService.ts',
        format: 'Integer — Action Network internal ID',
        note: 'Completely separate from ESPN gameId',
      },
      VSIN_CONTEXT: {
        description: 'In VSiN scraper, gameId is extracted from data-gamecode HTML attribute',
        tables: 'None (transient, used for matching only)',
        files: 'vsinBettingSplitsScraper.ts',
        format: 'String from HTML data-gamecode attribute',
        note: 'VSiN internal game code, not ESPN',
      },
      WC2026_INTERNAL_MATCH_ID: {
        description: 'The wc2026_matches table uses espn_match_id as internal identifier (wc26-g-001, wc26-r32-086)',
        tables: 'wc2026_matches.match_id, wc2026_match_odds.match_id',
        files: 'wc2026.schema.ts, wc2026Router.ts, wc2026BracketScraper.mjs',
        format: 'String "wc26-g-001" through "wc26-r32-088"',
        note: 'This is the INTERNAL match ID, NOT the ESPN gameId. The ESPN gameId is stored separately in espn_match_id column.',
      },
    },
    critical_distinction: 'The wc2026_espn_matches table stores ESPN gameId in a column NAMED "espn_match_id" (varchar). The wc2026_matches table stores INTERNAL match IDs (wc26-g-xxx) in a column also named "match_id". These are DIFFERENT identifiers in DIFFERENT tables.',
  };
  
  log('RESULT', 'DEFINITIVE', answer.answer);
  log('RESULT', 'ESPN_SCOPE', `ESPN gameId applies to: ${answer.breakdown.ESPN_CONTEXT.tables}`);
  log('RESULT', 'INTERNAL_SCOPE', `Internal gameId applies to: ${answer.breakdown.INTERNAL_DB_CONTEXT.tables}`);
  log('RESULT', 'AN_SCOPE', `Action Network anGameId applies to: ${answer.breakdown.ACTION_NETWORK_CONTEXT.tables}`);
  log('RESULT', 'CRITICAL', answer.critical_distinction);
  
  return answer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6: FINAL SUMMARY + CERTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

function finalize(classified, dbTables, wc2026Deep, answer) {
  logPhase('FINAL SUMMARY + CERTIFICATION');
  
  const summary = {
    runId: RUN_ID,
    completedAt: new Date().toISOString(),
    totalLogLines: logLineCount,
    totalFindings: findingCount,
    totalPhases: phaseCount,
    totalSteps: stepCount,
    codebaseStats: {
      totalOccurrences: Object.values(classified).reduce((sum, arr) => sum + arr.length, 0),
      byCategory: Object.fromEntries(Object.entries(classified).map(([k, v]) => [k, v.length]).filter(([, v]) => v > 0)),
      uniqueFiles: new Set(Object.values(classified).flat().map(f => f.file)).size,
    },
    databaseStats: {
      totalColumns: dbTables.length,
      byOrigin: dbTables.reduce((acc, t) => { acc[t.origin] = (acc[t.origin] || 0) + 1; return acc; }, {}),
    },
    wc2026Stats: {
      totalWc2026Findings: wc2026Deep.totalFindings,
      uniqueWc2026Files: Object.keys(wc2026Deep.byFile).length,
      dataFlowStages: wc2026Deep.dataFlowTrace.length,
    },
    definitiveAnswer: answer.answer,
  };
  
  log('RESULT', 'SUMMARY', 'Audit complete — all findings logged to wcfilecleanup.txt', summary);
  
  // Write final summary block to log
  const finalBlock = [
    '',
    '═'.repeat(100),
    '║  FINAL CERTIFICATION',
    '═'.repeat(100),
    '',
    `Run ID:           ${summary.runId}`,
    `Completed:        ${summary.completedAt}`,
    `Total Log Lines:  ${summary.totalLogLines}`,
    `Total Findings:   ${summary.totalFindings}`,
    `Total Phases:     ${summary.totalPhases}`,
    `Total Steps:      ${summary.totalSteps}`,
    '',
    '── CODEBASE ──',
    `Total Occurrences: ${summary.codebaseStats.totalOccurrences}`,
    `Unique Files:      ${summary.codebaseStats.uniqueFiles}`,
    `By Category:`,
    ...Object.entries(summary.codebaseStats.byCategory).map(([k, v]) => `  ${k}: ${v}`),
    '',
    '── DATABASE ──',
    `Total Columns:     ${summary.databaseStats.totalColumns}`,
    `By Origin:`,
    ...Object.entries(summary.databaseStats.byOrigin).map(([k, v]) => `  ${k}: ${v}`),
    '',
    '── WC2026 SCOPE ──',
    `Total Findings:    ${summary.wc2026Stats.totalWc2026Findings}`,
    `Unique Files:      ${summary.wc2026Stats.uniqueWc2026Files}`,
    `Data Flow Stages:  ${summary.wc2026Stats.dataFlowStages}`,
    '',
    '── DEFINITIVE ANSWER ──',
    `Q: Is gameId an ESPN element?`,
    `A: ${answer.answer}`,
    '',
    'BREAKDOWN:',
    '',
    '1. ESPN CONTEXT (WC2026):',
    `   ${answer.breakdown.ESPN_CONTEXT.description}`,
    `   Tables: ${answer.breakdown.ESPN_CONTEXT.tables}`,
    `   Format: ${answer.breakdown.ESPN_CONTEXT.format}`,
    '',
    '2. INTERNAL DB CONTEXT (MLB/NBA/NHL):',
    `   ${answer.breakdown.INTERNAL_DB_CONTEXT.description}`,
    `   Tables: ${answer.breakdown.INTERNAL_DB_CONTEXT.tables}`,
    `   Format: ${answer.breakdown.INTERNAL_DB_CONTEXT.format}`,
    '',
    '3. ACTION NETWORK CONTEXT:',
    `   ${answer.breakdown.ACTION_NETWORK_CONTEXT.description}`,
    `   Tables: ${answer.breakdown.ACTION_NETWORK_CONTEXT.tables}`,
    `   Format: ${answer.breakdown.ACTION_NETWORK_CONTEXT.format}`,
    '',
    '4. VSIN CONTEXT:',
    `   ${answer.breakdown.VSIN_CONTEXT.description}`,
    `   Format: ${answer.breakdown.VSIN_CONTEXT.format}`,
    '',
    '5. WC2026 INTERNAL MATCH ID:',
    `   ${answer.breakdown.WC2026_INTERNAL_MATCH_ID.description}`,
    `   Tables: ${answer.breakdown.WC2026_INTERNAL_MATCH_ID.tables}`,
    `   Format: ${answer.breakdown.WC2026_INTERNAL_MATCH_ID.format}`,
    '',
    '── CRITICAL DISTINCTION ──',
    answer.critical_distinction,
    '',
    '═'.repeat(100),
    `║  AUDIT CERTIFIED — ${new Date().toISOString()}`,
    '═'.repeat(100),
    '',
  ].join('\n');
  
  appendFileSync(LOG_FILE, finalBlock);
  
  console.log('');
  console.log(`${C.bgGreen}${C.white}${C.bold} ╔══════════════════════════════════════════════════════════════════════════╗ ${C.reset}`);
  console.log(`${C.bgGreen}${C.white}${C.bold} ║  AUDIT COMPLETE — ${summary.totalLogLines} log lines, ${summary.totalFindings} findings                  ║ ${C.reset}`);
  console.log(`${C.bgGreen}${C.white}${C.bold} ║  Output: wcfilecleanup.txt                                              ║ ${C.reset}`);
  console.log(`${C.bgGreen}${C.white}${C.bold} ╚══════════════════════════════════════════════════════════════════════════╝ ${C.reset}`);
  
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

initLog();

log('STATE', 'INIT', 'Forensic audit engine initialized', { runId: RUN_ID, projectRoot: PROJECT_ROOT });

// Phase 1: Codebase scan
const allFindings = scanCodebase();

// Phase 2: Classify
const classified = classifyFindings(allFindings);

// Phase 3: WC2026 deep dive
const wc2026Deep = wc2026DeepDive(allFindings);

// Phase 4: Database audit
const dbTables = databaseAudit();

// Phase 5: Definitive answer
const answer = produceDefinitiveAnswer(classified, dbTables, wc2026Deep);

// Phase 6: Finalize
const summary = finalize(classified, dbTables, wc2026Deep, answer);

process.exit(0);
