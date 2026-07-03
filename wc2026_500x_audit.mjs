/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 500X WORLD CUP 2026 DATABASE FORENSIC AUDIT
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * SCOPE: Enumerate ALL WC2026 tables, verify zero "fixture" remnants in DB
 * STANDARD: Industry-leading, deterministic, zero-hallucination audit
 * OUTPUT: Terminal (real-time) + wc2026databasing.txt (persistent log)
 * 
 * AUDIT GATES:
 *   GATE 1: Table enumeration (all wc2026_* tables with row/column counts)
 *   GATE 2: Column name scan (zero "fixture" in any column name)
 *   GATE 3: Table name scan (zero "fixture" in any table name)
 *   GATE 4: Data content scan (sample check for "fixture" strings in data)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const LOG_FILE = '/home/ubuntu/wc2026databasing.txt';
const AUDIT_START = new Date().toISOString();

// ─── LOGGING FRAMEWORK ──────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function logSection(title) {
  const border = '═'.repeat(80);
  const line = `\n${border}\n[${new Date().toISOString()}] ${title}\n${border}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function logResult(gate, check, status, detail) {
  const emoji = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  const line = `  [${gate}] [${emoji} ${status}] ${check}: ${detail}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ─── MAIN AUDIT ─────────────────────────────────────────────────────────────
async function main() {
  logSection('500X FORENSIC AUDIT — PHASE 1: DATABASE TABLE ENUMERATION');
  log('INFO', `Audit initiated at ${AUDIT_START}`);
  log('INFO', `Database: TiDB (MySQL-compatible)`);
  log('INFO', `Target: ALL tables matching wc2026_*`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('INFO', 'Database connection established');

  // ─── GATE 1: Enumerate ALL wc2026_* tables ────────────────────────────────
  logSection('GATE 1: ENUMERATE ALL WC2026 TABLES');
  
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME, TABLE_ROWS 
     FROM information_schema.TABLES 
     WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME LIKE 'wc2026_%'
     ORDER BY TABLE_NAME`
  );

  log('INFO', `Total WC2026 tables found: ${tables.length}`);
  
  let totalRows = 0;
  let totalCols = 0;
  const tableDetails = [];

  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const tableName = t.TABLE_NAME;
    
    // Get exact row count
    const [[countRow]] = await conn.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
    const rowCount = countRow.cnt;
    
    // Get column count
    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`, [tableName]
    );
    
    totalRows += rowCount;
    totalCols += cols.length;
    
    const detail = {
      name: tableName,
      rows: rowCount,
      columns: cols.length,
      columnNames: cols.map(c => c.COLUMN_NAME)
    };
    tableDetails.push(detail);
    
    logResult('GATE-1', `Table ${i + 1}/${tables.length}`, 'PASS',
      `${tableName} | rows=${rowCount} | cols=${cols.length}`);
  }

  log('INFO', `═══ GATE 1 SUMMARY: ${tables.length} tables, ${totalRows} total rows, ${totalCols} total columns ═══`);

  // ─── GATE 2: Column name scan for "fixture" ──────────────────────────────
  logSection('GATE 2: COLUMN NAME SCAN — ZERO "fixture" TOLERANCE');
  
  const [fixtureColumns] = await conn.execute(
    `SELECT TABLE_NAME, COLUMN_NAME 
     FROM information_schema.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME LIKE 'wc2026_%'
       AND COLUMN_NAME LIKE '%fixture%'
     ORDER BY TABLE_NAME, COLUMN_NAME`
  );

  if (fixtureColumns.length === 0) {
    logResult('GATE-2', 'Column name scan', 'PASS', 
      'ZERO columns containing "fixture" found across all WC2026 tables');
  } else {
    for (const col of fixtureColumns) {
      logResult('GATE-2', 'Column name scan', 'FAIL', 
        `FOUND: ${col.TABLE_NAME}.${col.COLUMN_NAME}`);
    }
  }

  // ─── GATE 3: Table name scan for "fixture" ────────────────────────────────
  logSection('GATE 3: TABLE NAME SCAN — ZERO "fixture" TOLERANCE');
  
  const [fixtureTables] = await conn.execute(
    `SELECT TABLE_NAME 
     FROM information_schema.TABLES 
     WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME LIKE '%fixture%'`
  );

  if (fixtureTables.length === 0) {
    logResult('GATE-3', 'Table name scan', 'PASS', 
      'ZERO tables containing "fixture" found in entire database');
  } else {
    for (const t of fixtureTables) {
      logResult('GATE-3', 'Table name scan', 'FAIL', 
        `FOUND: ${t.TABLE_NAME}`);
    }
  }

  // ─── GATE 4: Scan ALL wc2026 tables for "fixture" in VARCHAR/TEXT data ────
  logSection('GATE 4: DATA CONTENT SCAN — SAMPLE CHECK FOR "fixture" IN DATA');
  
  let dataFixtureCount = 0;
  for (const detail of tableDetails) {
    const textCols = [];
    // Get text/varchar columns
    const [textColInfo] = await conn.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ?
         AND DATA_TYPE IN ('varchar', 'text', 'longtext', 'mediumtext', 'tinytext', 'char')`,
      [detail.name]
    );
    
    for (const tc of textColInfo) {
      const [matches] = await conn.execute(
        `SELECT COUNT(*) as cnt FROM \`${detail.name}\` WHERE \`${tc.COLUMN_NAME}\` LIKE '%fixture%'`
      );
      if (matches[0].cnt > 0) {
        dataFixtureCount += matches[0].cnt;
        logResult('GATE-4', `Data scan: ${detail.name}.${tc.COLUMN_NAME}`, 'FAIL',
          `FOUND ${matches[0].cnt} rows containing "fixture"`);
      }
    }
  }

  if (dataFixtureCount === 0) {
    logResult('GATE-4', 'Data content scan', 'PASS',
      'ZERO data cells containing "fixture" found across all WC2026 text columns');
  }

  // ─── FINAL SUMMARY ────────────────────────────────────────────────────────
  logSection('500X FORENSIC AUDIT — PHASE 1 FINAL SUMMARY');
  
  const allPass = fixtureColumns.length === 0 && fixtureTables.length === 0 && dataFixtureCount === 0;
  
  log('INFO', `Total WC2026 tables: ${tables.length}`);
  log('INFO', `Total rows across all tables: ${totalRows}`);
  log('INFO', `Total columns across all tables: ${totalCols}`);
  log('INFO', `"fixture" in column names: ${fixtureColumns.length}`);
  log('INFO', `"fixture" in table names: ${fixtureTables.length}`);
  log('INFO', `"fixture" in data content: ${dataFixtureCount}`);
  log('INFO', `OVERALL DATABASE VERDICT: ${allPass ? 'PASS ✓ — ZERO FIXTURE REMNANTS' : 'FAIL ✗ — FIXTURE REMNANTS DETECTED'}`);
  
  // Print full table inventory
  logSection('COMPLETE TABLE INVENTORY');
  console.log('\n┌─────────────────────────────────────────────────────────┬───────┬──────┐');
  console.log('│ TABLE NAME                                              │ ROWS  │ COLS │');
  console.log('├─────────────────────────────────────────────────────────┼───────┼──────┤');
  
  for (const d of tableDetails) {
    const name = d.name.padEnd(55);
    const rows = String(d.rows).padStart(5);
    const cols = String(d.columns).padStart(4);
    console.log(`│ ${name} │ ${rows} │ ${cols} │`);
  }
  console.log('└─────────────────────────────────────────────────────────┴───────┴──────┘');
  
  // Log table inventory to file
  fs.appendFileSync(LOG_FILE, '\nCOMPLETE TABLE INVENTORY:\n');
  for (const d of tableDetails) {
    fs.appendFileSync(LOG_FILE, `  ${d.name} | rows=${d.rows} | cols=${d.columns}\n`);
  }

  await conn.end();
  log('INFO', `Audit Phase 1 complete at ${new Date().toISOString()}`);
}

main().catch(e => {
  log('FATAL', `Audit crashed: ${e.message}`);
  process.exit(1);
});
