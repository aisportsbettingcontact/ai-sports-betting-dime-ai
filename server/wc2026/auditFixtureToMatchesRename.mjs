/**
 * auditFixtureToMatchesRename.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * 500X FORENSIC AUDIT: fixture → matches rename
 * 
 * PURPOSE: Enumerate every match_id column across all 20 WC2026 tables,
 * count rows, identify primary keys vs foreign keys, and build the exact
 * migration plan for adding match_id alias columns.
 * 
 * EXECUTION: Read-only. Zero writes. Zero mutations.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log("[AUDIT] 500X FORENSIC FIXTURE→MATCHES RENAME — DATABASE COLUMN AUDIT");
console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log(`[INPUT] Timestamp: ${new Date().toISOString()}`);
console.log(`[INPUT] Target: All 20 WC2026 tables`);
console.log(`[INPUT] Objective: Identify every column containing 'fixture' in name`);
console.log("");

// ─── PHASE 1: Get all WC2026 tables ─────────────────────────────────────────
console.log("─── PHASE 1: TABLE ENUMERATION ────────────────────────────────────────────");
const [tables] = await conn.query("SHOW TABLES LIKE 'wc2026%'");
const tableNames = tables.map(t => Object.values(t)[0]);
console.log(`[STATE] Found ${tableNames.length} WC2026 tables`);
tableNames.forEach((t, i) => console.log(`  ${String(i+1).padStart(2)}. ${t}`));
console.log("");

// ─── PHASE 2: For each table, find columns with 'fixture' in name ───────────
console.log("─── PHASE 2: FIXTURE COLUMN DISCOVERY ────────────────────────────────────");
const results = [];

for (const tableName of tableNames) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${tableName}\``);
  const fixtureCols = cols.filter(c => c.Field.toLowerCase().includes('fixture'));
  const [countResult] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
  const rowCount = countResult[0].cnt;
  
  if (fixtureCols.length > 0) {
    console.log(`[FOUND] ${tableName} — ${fixtureCols.length} fixture column(s), ${rowCount} rows`);
    for (const col of fixtureCols) {
      const isPK = col.Key === 'PRI';
      const isUNI = col.Key === 'UNI';
      const isMUL = col.Key === 'MUL';
      const keyType = isPK ? 'PRIMARY KEY' : isUNI ? 'UNIQUE' : isMUL ? 'INDEX/FK' : 'NONE';
      console.log(`  ├── Column: ${col.Field}`);
      console.log(`  │   Type: ${col.Type} | Null: ${col.Null} | Key: ${keyType} | Default: ${col.Default}`);
      
      // Check for non-null values
      const [nonNull] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${tableName}\` WHERE \`${col.Field}\` IS NOT NULL`);
      const [distinct] = await conn.query(`SELECT COUNT(DISTINCT \`${col.Field}\`) as cnt FROM \`${tableName}\``);
      console.log(`  │   Non-null: ${nonNull[0].cnt}/${rowCount} | Distinct values: ${distinct[0].cnt}`);
      console.log(`  └──`);
      
      results.push({
        table: tableName,
        column: col.Field,
        type: col.Type,
        nullable: col.Null === 'YES',
        keyType,
        rowCount,
        nonNullCount: nonNull[0].cnt,
        distinctCount: distinct[0].cnt,
      });
    }
  } else {
    console.log(`[SKIP] ${tableName} — 0 fixture columns, ${rowCount} rows`);
  }
}

console.log("");
console.log("─── PHASE 3: SUMMARY ─────────────────────────────────────────────────────");
console.log(`[STATE] Total tables with fixture columns: ${new Set(results.map(r => r.table)).size}`);
console.log(`[STATE] Total fixture columns found: ${results.length}`);
console.log("");

// Classify by key type
const pkCols = results.filter(r => r.keyType === 'PRIMARY KEY');
const fkCols = results.filter(r => r.keyType === 'INDEX/FK');
const uniCols = results.filter(r => r.keyType === 'UNIQUE');
const nonKeyCols = results.filter(r => r.keyType === 'NONE');

console.log("[STATE] Classification:");
console.log(`  PRIMARY KEY columns: ${pkCols.length}`);
pkCols.forEach(r => console.log(`    → ${r.table}.${r.column} (${r.rowCount} rows, ${r.distinctCount} distinct)`));
console.log(`  UNIQUE columns: ${uniCols.length}`);
uniCols.forEach(r => console.log(`    → ${r.table}.${r.column} (${r.rowCount} rows, ${r.distinctCount} distinct)`));
console.log(`  INDEX/FK columns: ${fkCols.length}`);
fkCols.forEach(r => console.log(`    → ${r.table}.${r.column} (${r.rowCount} rows, ${r.distinctCount} distinct)`));
console.log(`  Non-key columns: ${nonKeyCols.length}`);
nonKeyCols.forEach(r => console.log(`    → ${r.table}.${r.column} (${r.rowCount} rows, ${r.distinctCount} distinct)`));

console.log("");
console.log("─── PHASE 4: MIGRATION PLAN ──────────────────────────────────────────────");
console.log("[PLAN] Phase 1 Migration Steps (backward-compatible alias addition):");
console.log("");

for (const r of results) {
  const newColName = r.column.replace(/fixture/gi, 'match');
  console.log(`  ALTER TABLE \`${r.table}\``);
  console.log(`    ADD COLUMN \`${newColName}\` ${r.type} GENERATED ALWAYS AS (\`${r.column}\`) STORED;`);
  console.log(`    -- ${r.rowCount} rows auto-populated, ${r.keyType}`);
  console.log("");
}

console.log("─── PHASE 5: RISK ASSESSMENT ─────────────────────────────────────────────");
console.log("[RISK] Primary Key rename (match_id → match_id):");
console.log("  - Requires ALL foreign key references to be updated simultaneously");
console.log("  - Cannot use GENERATED column for PK (MySQL limitation)");
console.log("  - Must use ALTER TABLE RENAME COLUMN (MySQL 8.0+)");
console.log("");
console.log("[RISK] Foreign Key references:");
for (const r of fkCols) {
  console.log(`  - ${r.table}.${r.column} references wc2026_matches.match_id`);
}
console.log("");
console.log("[OUTPUT] Audit complete. Zero mutations performed.");
console.log("═══════════════════════════════════════════════════════════════════════════════");

await conn.end();
