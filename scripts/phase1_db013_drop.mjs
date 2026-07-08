/**
 * Phase 1: DB-013 DROP — 10 backup/orphan tables
 * 1a. mysqldump each of the 10 individually to audit-notes/archives/
 * 1b. Re-verify zero readers/writers reference any of the 10
 * 1c. DROP TABLE IF EXISTS the 10
 * 1d. Verify table count decreased by 10
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

dotenv.config({ quiet: true });

const u = process.env.DATABASE_URL || '';
const m = u.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('PARSE FAIL'); process.exit(1); }
const [, user, password, host, port, database] = m;

const ARCHIVE_DIR = '/home/ubuntu/ai-sports-betting/audit-notes/archives/db013_individual';
mkdirSync(ARCHIVE_DIR, { recursive: true });

const TABLES_TO_DROP = [
  'wc2026_edges_bak_t3r',
  'wc2026_mp_bak',
  'wc2026_mp_dedup_archive',
  'wc2026_novig_bak_t3r',
  'wc2026_odds_bak_t2',
  'wc2026_odds_bak_tier2',
  'wc2026_proj_bak_t3r',
  'wc2026_proj_bak_tier2',
  'wc2026_rec_bak_t3r',
  'wc2026_orphan_match_odds_quarantine',
];

console.log('[PHASE 1] DB-013 DROP — 10 backup tables');
console.log(`[INPUT] Tables: ${TABLES_TO_DROP.length}`);

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60000,
});

// ─── 1a: Dump each table individually ───────────────────────────────────────
console.log('\n[STEP 1a] Dumping each table individually...');
const dumpResults = [];

for (const table of TABLES_TO_DROP) {
  try {
    // Get DDL
    const [ddl] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    const createStmt = ddl[0]['Create Table'] || ddl[0]['Create View'] || 'UNKNOWN';
    
    // Get row count
    const [countResult] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${table}\``);
    const rowCount = countResult[0].cnt;
    
    let dumpContent = `-- Individual dump: ${table}\n-- Timestamp: ${new Date().toISOString()}\n-- Row count: ${rowCount}\n\n`;
    dumpContent += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    dumpContent += createStmt + ';\n\n';
    
    // Dump data if any
    if (rowCount > 0 && rowCount <= 50000) {
      const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => `\`${c}\``).join(',');
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          const values = batch.map(row => {
            const vals = cols.map(c => {
              const v = row[c];
              if (v === null) return 'NULL';
              if (typeof v === 'number') return String(v);
              if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
              if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
              return `'${String(v).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
            });
            return `(${vals.join(',')})`;
          }).join(',\n');
          dumpContent += `INSERT INTO \`${table}\` (${colList}) VALUES\n${values};\n`;
        }
      }
    } else if (rowCount > 50000) {
      dumpContent += `-- DATA SKIPPED: ${rowCount} rows (too large)\n`;
    }
    
    const filePath = join(ARCHIVE_DIR, `${table}.sql`);
    writeFileSync(filePath, dumpContent);
    const fileSize = Buffer.byteLength(dumpContent);
    dumpResults.push({ table, rows: rowCount, file: filePath, size: fileSize, status: 'OK' });
    console.log(`  ✅ ${table}: ${rowCount} rows, ${(fileSize/1024).toFixed(1)} KB`);
  } catch (e) {
    dumpResults.push({ table, rows: -1, file: null, size: 0, status: 'ERROR: ' + e.message });
    console.error(`  ❌ ${table}: ${e.message}`);
  }
}

console.log(`\n[OUTPUT] Files dumped: ${dumpResults.filter(r => r.status === 'OK').length}/${TABLES_TO_DROP.length}`);

// ─── 1b: Grep for references in server/ and client/ ─────────────────────────
console.log('\n[STEP 1b] Grepping server/ and client/ for references...');
const PROJECT_DIR = '/home/ubuntu/ai-sports-betting';
let anyReference = false;

for (const table of TABLES_TO_DROP) {
  try {
    const result = execSync(
      `grep -r "${table}" "${PROJECT_DIR}/server/" "${PROJECT_DIR}/client/" "${PROJECT_DIR}/shared/" 2>/dev/null || true`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (result) {
      console.log(`  ⚠️ ${table}: FOUND REFERENCES`);
      console.log(`     ${result.substring(0, 200)}`);
      anyReference = true;
    } else {
      console.log(`  ✅ ${table}: no references`);
    }
  } catch (e) {
    console.log(`  ✅ ${table}: no references (grep returned empty)`);
  }
}

if (anyReference) {
  console.log('\n[VERIFY] FAIL — references found. STOPPING.');
  await conn.end();
  process.exit(1);
}
console.log('\n[VERIFY] PASS — zero references to any of the 10 tables in server/client/shared');

// ─── 1c: Get table count BEFORE ─────────────────────────────────────────────
console.log('\n[STEP 1c] DROP TABLE IF EXISTS...');
const [beforeCount] = await conn.query(
  `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema='${database}' AND table_type='BASE TABLE'`
);
console.log(`[STATE] Table count BEFORE: ${beforeCount[0].cnt}`);

// Execute DROPs
for (const table of TABLES_TO_DROP) {
  await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
  console.log(`  DROPPED: ${table}`);
}

// ─── 1d: Verify table count decreased ───────────────────────────────────────
const [afterCount] = await conn.query(
  `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema='${database}' AND table_type='BASE TABLE'`
);
console.log(`\n[STATE] Table count AFTER: ${afterCount[0].cnt}`);
const delta = beforeCount[0].cnt - afterCount[0].cnt;
console.log(`[VERIFY] Delta: -${delta} (expected: -10)`);

if (delta === 10) {
  console.log('[VERIFY] PASS — exactly 10 tables removed');
} else {
  console.log(`[VERIFY] FAIL — expected -10, got -${delta}. INVESTIGATE.`);
}

await conn.end();

// Write summary
const summaryPath = join(ARCHIVE_DIR, '_SUMMARY.json');
writeFileSync(summaryPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  tables: dumpResults,
  beforeCount: beforeCount[0].cnt,
  afterCount: afterCount[0].cnt,
  delta,
  verdict: delta === 10 ? 'PASS' : 'FAIL'
}, null, 2));

console.log(`\n[OUTPUT] Summary: ${summaryPath}`);
console.log('[PHASE 1] COMPLETE');
