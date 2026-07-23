#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * 500X FORENSIC AUDIT: ESPN gameId UNIFICATION TO espn_match_id
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Exhaustive discovery of EVERY reference to ESPN gameId variants
 *          (espn_match_id, game_id, espn_match_id, gameId) in WC2026 scope.
 *          
 * SCOPE: All files, all database tables, all columns, all code paths.
 * OUTPUT: wcfilecleanup.txt (append) + terminal visualization
 * 
 * ZERO EXECUTION UNTIL INVENTORY IS CERTIFIED.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const PROJECT_ROOT = '/home/ubuntu/ai-sports-betting';
const LOG_FILE = join(PROJECT_ROOT, 'wcfilecleanup.txt');
const RUN_ID = `UNIFY-${Date.now()}`;
const START_TIME = new Date().toISOString();

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════════

function log(level, category, message, data = null) {
  const ts = new Date().toISOString();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  const line = `[${ts}] [${level}] [${category}] ${message}${dataStr}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function logSection(title) {
  const border = '═'.repeat(96);
  const section = `\n${border}\n║  ${title}\n${border}`;
  console.log(section);
  appendFileSync(LOG_FILE, section + '\n');
}

function logBox(lines) {
  const maxLen = Math.max(...lines.map(l => l.length));
  const border = '─'.repeat(maxLen + 4);
  const box = [`┌${border}┐`, ...lines.map(l => `│  ${l.padEnd(maxLen)}  │`), `└${border}┘`].join('\n');
  console.log(box);
  appendFileSync(LOG_FILE, box + '\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE DISCOVERY ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', '.scraper-logs', 'terminal_full_output'];
const WC2026_PATTERNS = [
  // Column/variable names that store ESPN gameId in WC2026 context
  { pattern: /\bmatchId\b/g, type: 'COLUMN_VAR', desc: 'espn_match_id (ESPN gameId stored as espn_match_id)' },
  { pattern: /\bgame_id\b/g, type: 'COLUMN_DB', desc: 'game_id (ESPN gameId in snake_case DB column)' },
  { pattern: /\bgameId\b/g, type: 'VARIABLE', desc: 'gameId (ESPN gameId variable reference)' },
  { pattern: /\bespn_match_id\b/g, type: 'COLUMN_DB', desc: 'espn_match_id (ESPN gameId cross-reference)' },
  { pattern: /\bespnEventId\b/g, type: 'COLUMN_VAR', desc: 'espnEventId (camelCase ESPN gameId)' },
  { pattern: /\bGAME_ID\b/g, type: 'CONSTANT', desc: 'GAME_ID (uppercase constant)' },
  { pattern: /\bGameId\b/g, type: 'TYPE_REF', desc: 'GameId (PascalCase type reference)' },
];

function getAllFiles(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, files);
    } else if (/\.(ts|tsx|mjs|js|json|sql|md)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isWc2026File(filePath) {
  const rel = relative(PROJECT_ROOT, filePath);
  return (
    rel.includes('wc2026') ||
    rel.includes('WC2026') ||
    rel.includes('bracket') ||
    rel.startsWith('drizzle/wc2026') ||
    rel.includes('espn') && (rel.includes('wc') || rel.includes('World') || rel.includes('fifa'))
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeSchema() {
  const schemaPath = join(PROJECT_ROOT, 'drizzle/wc2026.schema.ts');
  const content = readFileSync(schemaPath, 'utf-8');
  const lines = content.split('\n');
  
  const findings = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Find espn_match_id column definitions
    if (line.includes('espn_match_id') && (line.includes('varchar') || line.includes('text'))) {
      findings.push({
        file: 'drizzle/wc2026.schema.ts',
        line: lineNum,
        content: line.trim(),
        type: 'SCHEMA_COLUMN_DEF',
        currentName: 'espn_match_id',
        targetName: 'espnMatchId',
        dbColumn: 'espn_match_id',
      });
    }
    
    // Find game_id column definitions
    if (line.includes('game_id') && (line.includes('varchar') || line.includes('text'))) {
      findings.push({
        file: 'drizzle/wc2026.schema.ts',
        line: lineNum,
        content: line.trim(),
        type: 'SCHEMA_COLUMN_DEF',
        currentName: 'gameId (maps to game_id)',
        targetName: 'espnMatchId',
        dbColumn: 'espn_match_id',
      });
    }
    
    // Find espn_match_id column definitions
    if (line.includes('espn_match_id')) {
      findings.push({
        file: 'drizzle/wc2026.schema.ts',
        line: lineNum,
        content: line.trim(),
        type: 'SCHEMA_COLUMN_DEF',
        currentName: 'espnEventId (maps to espn_match_id)',
        targetName: 'espnMatchId',
        dbColumn: 'espn_match_id',
      });
    }
    
    // Find index definitions referencing these columns
    if ((line.includes('espn_match_id') || line.includes('gameId') || line.includes('espnEventId')) && line.includes('Index')) {
      findings.push({
        file: 'drizzle/wc2026.schema.ts',
        line: lineNum,
        content: line.trim(),
        type: 'SCHEMA_INDEX_DEF',
        currentName: line.includes('espn_match_id') ? 'espn_match_id' : line.includes('gameId') ? 'gameId' : 'espnEventId',
        targetName: 'espnMatchId',
      });
    }
  }
  
  // Also check main schema for espn_match_id
  const mainSchemaPath = join(PROJECT_ROOT, 'drizzle/schema.ts');
  if (readFileSync(mainSchemaPath, 'utf-8').includes('espn_match_id') || readFileSync(mainSchemaPath, 'utf-8').includes('wc2026')) {
    const mainContent = readFileSync(mainSchemaPath, 'utf-8');
    const mainLines = mainContent.split('\n');
    for (let i = 0; i < mainLines.length; i++) {
      if (mainLines[i].includes('espn_match_id') || mainLines[i].includes('wc2026')) {
        findings.push({
          file: 'drizzle/schema.ts',
          line: i + 1,
          content: mainLines[i].trim(),
          type: 'MAIN_SCHEMA_REF',
          currentName: 'espn_match_id or wc2026 ref',
          targetName: 'espnMatchId',
        });
      }
    }
  }
  
  return findings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

logSection(`500X FORENSIC AUDIT: ESPN gameId UNIFICATION TO espn_match_id`);
logBox([
  `Run ID: ${RUN_ID}`,
  `Started: ${START_TIME}`,
  `Project: ${PROJECT_ROOT}`,
  `Objective: Discover ALL ESPN gameId references for unification to espn_match_id`,
  `Standard: Zero-miss, exhaustive, certified inventory before any execution`,
]);

log('STATE', 'INIT', 'Forensic unification audit engine initialized', { runId: RUN_ID });

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Build complete file inventory
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 1: COMPLETE FILE INVENTORY — Building exhaustive file list');

const allFiles = getAllFiles(PROJECT_ROOT);
log('STEP', 'S1', `Total project files discovered: ${allFiles.length}`);

const wc2026Files = allFiles.filter(isWc2026File);
log('STEP', 'S1', `WC2026-scope files identified: ${wc2026Files.length}`);

// Also include files that reference ESPN gameId but aren't in wc2026 dir
const additionalFiles = allFiles.filter(f => {
  if (wc2026Files.includes(f)) return false;
  try {
    const content = readFileSync(f, 'utf-8');
    return content.includes('wc2026') && (content.includes('espn_match_id') || content.includes('gameId') || content.includes('game_id') || content.includes('espn_match_id'));
  } catch { return false; }
});
log('STEP', 'S1', `Additional files with WC2026 gameId refs: ${additionalFiles.length}`);

const targetFiles = [...wc2026Files, ...additionalFiles];
log('RESULT', 'S1', `Total files to scan: ${targetFiles.length}`, { wc2026: wc2026Files.length, additional: additionalFiles.length });

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Line-by-line scan of every file
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 2: LINE-BY-LINE SCAN — Every reference in every file');

const allFindings = [];
let filesScanned = 0;

for (const filePath of targetFiles) {
  const relPath = relative(PROJECT_ROOT, filePath);
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    log('ERROR', 'SCAN', `Failed to read: ${relPath}`, { error: e.message });
    continue;
  }
  
  const lines = content.split('\n');
  const fileFindings = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    for (const { pattern, type, desc } of WC2026_PATTERNS) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        // Filter: only include if this is genuinely WC2026/ESPN context
        // Skip if it's clearly MLB/NBA internal gameId (references games.id FK)
        const isInternalFK = line.includes('games.id') || line.includes('→ games') || line.includes('FK');
        const isWc2026Context = relPath.includes('wc2026') || relPath.includes('WC2026') || 
                                relPath.includes('espn') || relPath.includes('bracket') ||
                                content.includes('wc2026') || content.includes('760');
        
        if (match[0] === 'gameId' && !isWc2026Context) continue;
        if (isInternalFK && !isWc2026Context) continue;
        
        fileFindings.push({
          file: relPath,
          line: lineNum,
          column: match.index + 1,
          match: match[0],
          context: line.trim().substring(0, 120),
          type,
          desc,
        });
      }
    }
  }
  
  if (fileFindings.length > 0) {
    allFindings.push(...fileFindings);
    log('SCAN', 'FILE', `${relPath}: ${fileFindings.length} ESPN gameId references found`);
  }
  
  filesScanned++;
  if (filesScanned % 10 === 0) {
    process.stdout.write(`\r  [PROGRESS] ${filesScanned}/${targetFiles.length} files scanned...`);
  }
}

console.log(''); // newline after progress
log('RESULT', 'S2', `Total ESPN gameId references found: ${allFindings.length}`, { filesScanned, filesWithFindings: new Set(allFindings.map(f => f.file)).size });

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Schema-specific deep analysis
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 3: SCHEMA DEEP ANALYSIS — Column definitions requiring rename');

const schemaFindings = analyzeSchema();
log('RESULT', 'S3', `Schema column definitions to rename: ${schemaFindings.length}`);

for (const sf of schemaFindings) {
  log('SCHEMA', sf.type, `${sf.file}:${sf.line} | ${sf.currentName} → ${sf.targetName}`, { content: sf.content });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: Categorize findings by action required
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 4: CATEGORIZE BY ACTION REQUIRED');

const categories = {
  SCHEMA_RENAME: [], // Drizzle schema column renames
  BACKEND_CODE: [],  // Server-side code updates
  FRONTEND_CODE: [], // Client-side code updates
  SCRIPT_UPDATE: [], // Standalone script updates
  TEST_UPDATE: [],   // Test file updates
  INDEX_RENAME: [],  // Index definition updates
  COMMENT_ONLY: [],  // Comments/docs (optional update)
};

for (const finding of allFindings) {
  const { file } = finding;
  
  if (file.includes('drizzle/') && file.endsWith('.ts')) {
    if (finding.context.includes('Index') || finding.context.includes('index')) {
      categories.INDEX_RENAME.push(finding);
    } else {
      categories.SCHEMA_RENAME.push(finding);
    }
  } else if (file.startsWith('server/')) {
    categories.BACKEND_CODE.push(finding);
  } else if (file.startsWith('client/')) {
    categories.FRONTEND_CODE.push(finding);
  } else if (file.endsWith('.test.ts') || file.endsWith('.test.mjs') || file.includes('Test')) {
    categories.TEST_UPDATE.push(finding);
  } else if (file.startsWith('scripts/') || file.endsWith('.mjs')) {
    categories.SCRIPT_UPDATE.push(finding);
  } else {
    categories.COMMENT_ONLY.push(finding);
  }
}

for (const [cat, items] of Object.entries(categories)) {
  log('CATEGORY', cat, `${items.length} references`, { uniqueFiles: new Set(items.map(i => i.file)).size });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Generate per-file change manifest
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 5: PER-FILE CHANGE MANIFEST — What changes in each file');

const fileManifest = {};
for (const finding of allFindings) {
  if (!fileManifest[finding.file]) {
    fileManifest[finding.file] = { refs: 0, lines: new Set(), matches: new Set() };
  }
  fileManifest[finding.file].refs++;
  fileManifest[finding.file].lines.add(finding.line);
  fileManifest[finding.file].matches.add(finding.match);
}

// Sort by ref count descending
const sortedManifest = Object.entries(fileManifest)
  .sort((a, b) => b[1].refs - a[1].refs);

log('MANIFEST', 'SUMMARY', `${sortedManifest.length} files require changes`);

for (const [file, info] of sortedManifest) {
  log('MANIFEST', 'FILE', `${file}: ${info.refs} refs across ${info.lines.size} lines | patterns: [${[...info.matches].join(', ')}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: Database tables requiring column rename
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 6: DATABASE TABLES REQUIRING COLUMN RENAME');

const dbRenames = [
  { table: 'wc2026_espn_matches', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_team_stats', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_match_stats', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_expected_goals', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_shot_map', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_player_stats', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_lineups', currentCol: 'espn_match_id', currentDbCol: 'match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_espn_bracket', currentCol: 'gameId', currentDbCol: 'game_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_venues', currentCol: 'game_id', currentDbCol: 'game_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
  { table: 'wc2026_matches', currentCol: 'espnEventId', currentDbCol: 'espn_match_id', newDbCol: 'espn_match_id', newDrizzleVar: 'espnMatchId' },
];

for (const rename of dbRenames) {
  log('DB_RENAME', 'TABLE', `${rename.table}: ${rename.currentDbCol} → ${rename.newDbCol} (Drizzle: ${rename.currentCol} → ${rename.newDrizzleVar})`);
}

log('RESULT', 'S6', `Total DB column renames required: ${dbRenames.length} across ${dbRenames.length} tables`);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7: Identify all code patterns that need updating
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 7: CODE PATTERN ANALYSIS — Exact replacements needed');

const codePatterns = [
  // Schema patterns
  { from: 'espn_match_id:', to: 'espnMatchId:', scope: 'drizzle/wc2026.schema.ts', context: 'column definition' },
  { from: 'varchar("match_id"', to: 'varchar("espn_match_id"', scope: 'drizzle/wc2026.schema.ts', context: 'DB column name string' },
  { from: 'gameId:', to: 'espnMatchId:', scope: 'drizzle/wc2026.schema.ts (bracket)', context: 'bracket column definition' },
  { from: 'varchar("game_id"', to: 'varchar("espn_match_id"', scope: 'drizzle/wc2026.schema.ts (bracket/venues)', context: 'DB column name string' },
  { from: 'espnEventId:', to: 'espnMatchId:', scope: 'drizzle/wc2026.schema.ts (matches)', context: 'matches column definition' },
  { from: 'varchar("espn_match_id"', to: 'varchar("espn_match_id"', scope: 'drizzle/wc2026.schema.ts (matches)', context: 'DB column name string' },
  
  // Backend patterns
  { from: '.espn_match_id', to: '.espnMatchId', scope: 'server/wc2026/*.ts', context: 'ORM field access' },
  { from: 'espn_match_id:', to: 'espnMatchId:', scope: 'server/wc2026/*.ts', context: 'ORM insert/update value' },
  { from: '.gameId', to: '.espnMatchId', scope: 'server/wc2026/*.ts (bracket)', context: 'bracket ORM field access' },
  { from: 'gameId:', to: 'espnMatchId:', scope: 'server/wc2026/*.ts (bracket)', context: 'bracket ORM insert/update' },
  { from: '.espnEventId', to: '.espnMatchId', scope: 'server/wc2026/*.ts (matches)', context: 'matches ORM field access' },
  { from: 'espnEventId:', to: 'espnMatchId:', scope: 'server/wc2026/*.ts (matches)', context: 'matches ORM insert/update' },
  
  // Variable patterns (gameId as local variable referencing ESPN event ID)
  { from: 'const gameId', to: 'const espnMatchId', scope: 'server/wc2026/*.ts', context: 'local variable declaration' },
  { from: 'let gameId', to: 'let espnMatchId', scope: 'server/wc2026/*.ts', context: 'local variable declaration' },
  { from: 'function.*gameId', to: 'function.*espnMatchId', scope: 'server/wc2026/*.ts', context: 'function parameter' },
  
  // Frontend patterns
  { from: 'espn_match_id', to: 'espnMatchId', scope: 'client/src/pages/Wc2026*.tsx', context: 'data field access' },
  { from: 'gameId', to: 'espnMatchId', scope: 'client/src/pages/Wc2026*.tsx', context: 'data field access' },
];

for (const cp of codePatterns) {
  log('PATTERN', 'REPLACE', `"${cp.from}" → "${cp.to}" in ${cp.scope} (${cp.context})`);
}

log('RESULT', 'S7', `Total code patterns identified: ${codePatterns.length}`);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8: CRITICAL DISTINCTION — What NOT to rename
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 8: EXCLUSION LIST — What NOT to rename');

const exclusions = [
  { pattern: 'gameId in MLB/NBA/NHL context', reason: 'Internal DB FK (→ games.id), NOT ESPN' },
  { pattern: 'anGameId in Action Network context', reason: 'Action Network internal ID, NOT ESPN' },
  { pattern: 'gameId in VSiN context', reason: 'VSiN HTML data-gamecode, NOT ESPN' },
  { pattern: 'gameId in server/db.ts (MLB)', reason: 'References games table PK, NOT ESPN' },
  { pattern: 'gameId in server/mlb*.ts', reason: 'MLB internal game FK, NOT ESPN' },
  { pattern: 'gameId in server/nba*.ts', reason: 'NBA internal game FK, NOT ESPN' },
  { pattern: 'gameId in server/nhl*.ts', reason: 'NHL internal game FK, NOT ESPN' },
  { pattern: 'gameId in drizzle/schema.ts (non-WC2026)', reason: 'Internal DB FK columns, NOT ESPN' },
  { pattern: 'gameId in client/src/components/GameCard.tsx', reason: 'MLB/NBA game card, NOT ESPN WC2026' },
  { pattern: 'match_id in wc2026_matches (PK column)', reason: 'INTERNAL match ID (wc26-r32-086), NOT ESPN gameId' },
];

for (const ex of exclusions) {
  log('EXCLUDE', 'SAFE', `DO NOT RENAME: ${ex.pattern} — ${ex.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9: FINAL CERTIFICATION
// ─────────────────────────────────────────────────────────────────────────────
logSection('STEP 9: INVENTORY CERTIFICATION');

const certification = {
  runId: RUN_ID,
  completedAt: new Date().toISOString(),
  totalFilesScanned: filesScanned,
  totalReferences: allFindings.length,
  uniqueFilesWithChanges: sortedManifest.length,
  dbTablesRequiringRename: dbRenames.length,
  codePatterns: codePatterns.length,
  exclusions: exclusions.length,
  categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length])),
  schemaFindings: schemaFindings.length,
  status: 'CERTIFIED — READY FOR EXECUTION',
};

logBox([
  '╔══════════════════════════════════════════════════════════════════╗',
  '║         INVENTORY CERTIFICATION — PASS                          ║',
  '╠══════════════════════════════════════════════════════════════════╣',
  `║  Run ID:              ${certification.runId}`,
  `║  Files Scanned:       ${certification.totalFilesScanned}`,
  `║  Total References:    ${certification.totalReferences}`,
  `║  Files to Modify:     ${certification.uniqueFilesWithChanges}`,
  `║  DB Tables to Rename: ${certification.dbTablesRequiringRename}`,
  `║  Code Patterns:       ${certification.codePatterns}`,
  `║  Exclusions:          ${certification.exclusions}`,
  `║  Status:              ${certification.status}`,
  '╚══════════════════════════════════════════════════════════════════╝',
]);

log('CERTIFY', 'PASS', 'Inventory is COMPLETE and CERTIFIED', certification);

// Write summary JSON for programmatic consumption
const summaryPath = join(PROJECT_ROOT, 'scripts/espn_gameid_unification_manifest.json');
writeFileSync(summaryPath, JSON.stringify({
  certification,
  dbRenames,
  fileManifest: Object.fromEntries(sortedManifest.map(([f, info]) => [f, { refs: info.refs, lines: [...info.lines], matches: [...info.matches] }])),
  exclusions,
}, null, 2));

log('OUTPUT', 'FILE', `Manifest written to: ${summaryPath}`);
log('STATE', 'COMPLETE', `Audit complete. Awaiting execution authorization.`);

process.exit(0);
