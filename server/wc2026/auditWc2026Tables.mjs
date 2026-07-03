/**
 * auditWc2026Tables.mjs
 * ============================================================
 * PURPOSE: Deep 500x forensic audit of ALL WC2026-related DB tables.
 * Enumerates every table, inspects schema/columns, queries row counts,
 * NULL rates, key field samples, and cross-references Drizzle schema.
 *
 * VERSION: v1.0-AUDIT-WC2026
 * DATE: 2026-07-02
 * LOG: /home/ubuntu/wc2026modeling.txt
 * ============================================================
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LOG_FILE = '/home/ubuntu/wc2026modeling.txt';
const SCRIPT_NAME = 'auditWc2026Tables.mjs';
const VERSION = 'v1.0-AUDIT-WC2026';

const startTs = Date.now();
const logLines = [];

function log(tag, label, msg) {
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(3);
  const line = `[${new Date().toISOString()}] +${elapsed}s ${tag.padEnd(10)} [${label.padEnd(8)}] ${SCRIPT_NAME} │ ${msg}`;
  console.log(line);
  logLines.push(line);
}

function flushLog() {
  const header = [
    '',
    '='.repeat(100),
    `SESSION START: ${new Date().toISOString()}`,
    `SCRIPT: ${SCRIPT_NAME}`,
    `PURPOSE: Deep 500x forensic audit of all WC2026-related database tables`,
    `VERSION: ${VERSION}`,
    '='.repeat(100),
  ].join('\n');
  fs.appendFileSync(LOG_FILE, header + '\n' + logLines.join('\n') + '\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('██ BANNER', 'INIT', `${VERSION} — WC2026 Table Forensic Audit`);
  log('██ BANNER', 'INIT', 'ZERO HALLUCINATION | ZERO OVERSIGHT | 500x FORENSIC PRECISION');

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('✅ PASS', 'DB', 'Connected to TiDB');

  // ── Section 1: Discover all WC2026 tables ────────────────────────────────
  log('', '', '');
  log('██ SECTION', 'DISC', 'SECTION 1: DISCOVER ALL WC2026-RELATED TABLES');

  // Get all tables in the database
  const [allTables] = await conn.execute(`SHOW TABLES`);
  const tableKey = Object.keys(allTables[0])[0];
  const allTableNames = allTables.map(r => r[tableKey]);

  // Filter for WC2026-related tables (case-insensitive match on wc2026)
  const wc2026Tables = allTableNames.filter(t =>
    t.toLowerCase().includes('wc2026') ||
    t.toLowerCase().includes('wc_2026') ||
    t.toLowerCase().includes('worldcup') ||
    t.toLowerCase().includes('world_cup_2026')
  );

  log('◀◀ INPUT', 'DISC', `Total tables in DB: ${allTableNames.length}`);
  log('◀◀ INPUT', 'DISC', `WC2026-related tables found: ${wc2026Tables.length}`);
  for (const t of wc2026Tables) {
    log('   ATOMIC', 'DISC', `  → ${t}`);
  }

  // ── Section 2: Per-table deep audit ──────────────────────────────────────
  log('', '', '');
  log('██ SECTION', 'AUDIT', 'SECTION 2: PER-TABLE DEEP AUDIT (row count + column inventory + NULL rates)');

  const tableReport = [];

  for (const tableName of wc2026Tables) {
    log('', '', '');
    log('▶▶ STEP', 'TABLE', `━━━ TABLE: ${tableName} ━━━`);

    // Row count
    const [[countRow]] = await conn.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
    const rowCount = countRow.cnt;
    log('·· STATE', 'TABLE', `  Row count: ${rowCount}`);

    // Column info
    const [cols] = await conn.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    log('·· STATE', 'TABLE', `  Column count: ${cols.length}`);

    const colDetails = [];
    for (const col of cols) {
      const colName = col.Field;
      const colType = col.Type;
      const colNull = col.Null;
      const colKey = col.Key;
      const colDefault = col.Default;

      // NULL rate for nullable columns (only if row count > 0)
      let nullCount = 0;
      let nullPct = 'N/A';
      if (rowCount > 0 && colNull === 'YES') {
        const [[nr]] = await conn.execute(
          `SELECT COUNT(*) as cnt FROM \`${tableName}\` WHERE \`${colName}\` IS NULL`
        );
        nullCount = nr.cnt;
        nullPct = `${((nullCount / rowCount) * 100).toFixed(1)}%`;
      }

      colDetails.push({ colName, colType, colNull, colKey, colDefault, nullCount, nullPct });
      const keyFlag = colKey ? ` [${colKey}]` : '';
      const nullFlag = colNull === 'YES' ? ` NULL=${nullPct}` : ' NOT NULL';
      log('   ATOMIC', 'COL', `    ${colName.padEnd(45)} ${colType.padEnd(30)}${keyFlag}${nullFlag}`);
    }

    // Sample first row (non-sensitive fields)
    if (rowCount > 0) {
      try {
        const [[sample]] = await conn.execute(`SELECT * FROM \`${tableName}\` LIMIT 1`);
        const sampleStr = JSON.stringify(sample).substring(0, 300);
        log('·· STATE', 'SAMPLE', `  First row (truncated): ${sampleStr}`);
      } catch (e) {
        log('⚠️ WARN', 'SAMPLE', `  Could not fetch sample: ${e.message}`);
      }
    }

    // Last updated (if updated_at or last_inserted_at exists)
    const hasUpdatedAt = cols.some(c => c.Field === 'updated_at');
    const hasLastInserted = cols.some(c => c.Field === 'last_inserted_at');
    if (rowCount > 0 && (hasUpdatedAt || hasLastInserted)) {
      const tsCol = hasLastInserted ? 'last_inserted_at' : 'updated_at';
      const [[latest]] = await conn.execute(
        `SELECT MAX(\`${tsCol}\`) as latest FROM \`${tableName}\``
      );
      log('·· STATE', 'TABLE', `  Latest ${tsCol}: ${latest.latest}`);
    }

    // Distinct match_id count (if column exists)
    const hasFixtureId = cols.some(c => c.Field === 'match_id');
    if (hasFixtureId && rowCount > 0) {
      const [[distFix]] = await conn.execute(
        `SELECT COUNT(DISTINCT match_id) as cnt FROM \`${tableName}\``
      );
      log('·· STATE', 'TABLE', `  Distinct match_ids: ${distFix.cnt}`);
    }

    // Distinct team_id count (if column exists)
    const hasTeamId = cols.some(c => c.Field === 'team_id');
    if (hasTeamId && rowCount > 0) {
      const [[distTeam]] = await conn.execute(
        `SELECT COUNT(DISTINCT team_id) as cnt FROM \`${tableName}\``
      );
      log('·· STATE', 'TABLE', `  Distinct team_ids: ${distTeam.cnt}`);
    }

    tableReport.push({
      tableName,
      rowCount,
      colCount: cols.length,
      columns: colDetails,
    });

    log('✅ PASS', 'TABLE', `  ${tableName}: audit complete — ${rowCount} rows, ${cols.length} columns`);
  }

  // ── Section 3: Cross-reference with Drizzle schema files ─────────────────
  log('', '', '');
  log('██ SECTION', 'SCHEMA', 'SECTION 3: DRIZZLE SCHEMA CROSS-REFERENCE');

  // Check wc2026.schema.ts
  const wc2026SchemaPath = path.resolve(__dirname, '../../drizzle/wc2026.schema.ts');
  const mainSchemaPath = path.resolve(__dirname, '../../drizzle/schema.ts');

  const wc2026SchemaExists = fs.existsSync(wc2026SchemaPath);
  const mainSchemaExists = fs.existsSync(mainSchemaPath);

  log('·· STATE', 'SCHEMA', `drizzle/wc2026.schema.ts exists: ${wc2026SchemaExists}`);
  log('·· STATE', 'SCHEMA', `drizzle/schema.ts exists: ${mainSchemaExists}`);

  if (wc2026SchemaExists) {
    const wc2026SchemaContent = fs.readFileSync(wc2026SchemaPath, 'utf8');
    // Extract all mysqlTable definitions
    const tableMatches = [...wc2026SchemaContent.matchAll(/export const (\w+)\s*=\s*mysqlTable\s*\(\s*['"`]([^'"`]+)['"`]/g)];
    log('·· STATE', 'SCHEMA', `wc2026.schema.ts: ${tableMatches.length} table definitions found`);
    for (const m of tableMatches) {
      const drizzleName = m[1];
      const dbName = m[2];
      const inDb = wc2026Tables.includes(dbName);
      log('   ATOMIC', 'SCHEMA', `  ${drizzleName.padEnd(40)} → DB: ${dbName.padEnd(40)} | In DB: ${inDb ? 'YES ✓' : 'NO ✗ (missing or deprecated)'}`);
    }
  }

  if (mainSchemaExists) {
    const mainSchemaContent = fs.readFileSync(mainSchemaPath, 'utf8');
    const wc2026Matches = [...mainSchemaContent.matchAll(/export const (\w+)\s*=\s*mysqlTable\s*\(\s*['"`]([^'"`]+)['"`]/g)]
      .filter(m => m[2].toLowerCase().includes('wc2026') || m[1].toLowerCase().includes('wc2026'));
    log('·· STATE', 'SCHEMA', `drizzle/schema.ts: ${wc2026Matches.length} WC2026 table definitions found`);
    for (const m of wc2026Matches) {
      const drizzleName = m[1];
      const dbName = m[2];
      const inDb = wc2026Tables.includes(dbName);
      log('   ATOMIC', 'SCHEMA', `  ${drizzleName.padEnd(40)} → DB: ${dbName.padEnd(40)} | In DB: ${inDb ? 'YES ✓' : 'NO ✗'}`);
    }
  }

  // ── Section 4: Summary table ──────────────────────────────────────────────
  log('', '', '');
  log('██ SECTION', 'SUM', 'SECTION 4: FINAL SUMMARY TABLE');
  log('·· STATE', 'SUM', `${'TABLE NAME'.padEnd(50)} ${'ROWS'.padStart(8)} ${'COLS'.padStart(6)}`);
  log('·· STATE', 'SUM', `${'-'.repeat(50)} ${'-'.repeat(8)} ${'-'.repeat(6)}`);
  let totalRows = 0;
  for (const t of tableReport) {
    log('·· STATE', 'SUM', `${t.tableName.padEnd(50)} ${String(t.rowCount).padStart(8)} ${String(t.colCount).padStart(6)}`);
    totalRows += t.rowCount;
  }
  log('·· STATE', 'SUM', `${'-'.repeat(50)} ${'-'.repeat(8)} ${'-'.repeat(6)}`);
  log('·· STATE', 'SUM', `${'TOTAL'.padEnd(50)} ${String(totalRows).padStart(8)}`);
  log('', '', '');
  log('✅ PASS', 'SUM', `WC2026 forensic audit complete: ${wc2026Tables.length} tables, ${totalRows} total rows`);

  await conn.end();
  log('✅ PASS', 'DB', 'Connection closed');
  flushLog();

  // Print clean summary to stdout for easy reading
  console.log('\n' + '='.repeat(100));
  console.log('WC2026 TABLE INVENTORY — FINAL SUMMARY');
  console.log('='.repeat(100));
  console.log(`${'#'.padStart(3)}  ${'TABLE NAME'.padEnd(50)} ${'ROWS'.padStart(8)} ${'COLS'.padStart(6)}`);
  console.log(`${'-'.repeat(3)}  ${'-'.repeat(50)} ${'-'.repeat(8)} ${'-'.repeat(6)}`);
  tableReport.forEach((t, i) => {
    console.log(`${String(i+1).padStart(3)}  ${t.tableName.padEnd(50)} ${String(t.rowCount).padStart(8)} ${String(t.colCount).padStart(6)}`);
  });
  console.log(`${'-'.repeat(3)}  ${'-'.repeat(50)} ${'-'.repeat(8)} ${'-'.repeat(6)}`);
  console.log(`     ${'TOTAL'.padEnd(50)} ${String(totalRows).padStart(8)}`);
  console.log('='.repeat(100));
  console.log(`[LOG] Full audit appended to ${LOG_FILE}`);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  fs.appendFileSync(LOG_FILE, `\n[FATAL] ${SCRIPT_NAME}: ${err.message}\n`);
  process.exit(1);
});
