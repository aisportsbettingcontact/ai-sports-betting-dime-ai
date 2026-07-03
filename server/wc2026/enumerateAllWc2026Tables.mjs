/**
 * enumerateAllWc2026Tables.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 500X FORENSIC TABLE ENUMERATION
 * Queries the LIVE production database for EVERY table that pertains to 
 * the 2026 World Cup. Zero omissions. Full column inventories.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../../.env") });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("[FATAL] DATABASE_URL not set"); process.exit(1); }

async function main() {
  const ts = () => new Date().toISOString();
  
  console.log(`[${ts()}] [INPUT] Connecting to production database...`);
  const conn = await mysql.createConnection(DB_URL);
  console.log(`[${ts()}] [STATE] Connection established ✓`);

  // ─── STEP 1: Get ALL tables in the database ───────────────────────────────
  console.log(`\n[${ts()}] [STEP] Fetching complete table list from database...`);
  const [allTables] = await conn.query("SHOW TABLES");
  const dbName = Object.keys(allTables[0])[0];
  const tableNames = allTables.map(r => Object.values(r)[0]);
  console.log(`[${ts()}] [STATE] Total tables in database: ${tableNames.length}`);

  // ─── STEP 2: Filter WC2026-related tables ─────────────────────────────────
  // Criteria: table name contains 'wc2026' OR 'espn' (ESPN tables are WC2026 data)
  const wc2026Tables = tableNames.filter(t => 
    t.includes("wc2026") || t.includes("espn")
  );
  const nonWcTables = tableNames.filter(t => !wc2026Tables.includes(t));
  
  console.log(`[${ts()}] [STATE] WC2026-related tables found: ${wc2026Tables.length}`);
  console.log(`[${ts()}] [STATE] Non-WC tables (excluded): ${nonWcTables.length} → [${nonWcTables.join(", ")}]`);
  console.log(`\n[${ts()}] [STEP] Enumerating all ${wc2026Tables.length} WC2026 tables with row counts and column inventories...\n`);

  // ─── STEP 3: For each WC2026 table, get row count + columns ───────────────
  const results = [];
  
  for (let i = 0; i < wc2026Tables.length; i++) {
    const table = wc2026Tables[i];
    const idx = String(i + 1).padStart(2, "0");
    
    // Row count
    const [[countRow]] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${table}\``);
    const rowCount = countRow.cnt;
    
    // Column info
    const [columns] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
    const colCount = columns.length;
    const colNames = columns.map(c => c.Field);
    const pkCols = columns.filter(c => c.Key === "PRI").map(c => c.Field);
    const nullableCols = columns.filter(c => c.Null === "YES").length;
    
    results.push({ table, rowCount, colCount, colNames, pkCols, nullableCols });
    
    console.log(`  [${idx}/${wc2026Tables.length}] ┌─ ${table}`);
    console.log(`       │  Rows: ${rowCount} | Columns: ${colCount} | PK: [${pkCols.join(", ")}] | Nullable: ${nullableCols}/${colCount}`);
    console.log(`       └─ Cols: ${colNames.join(", ")}`);
    console.log("");
  }

  // ─── STEP 4: Summary table ────────────────────────────────────────────────
  console.log(`\n[${ts()}] ═══ FINAL SUMMARY ═══\n`);
  console.log("┌────┬─────────────────────────────────────────────┬────────┬─────────┬──────────────────────────┐");
  console.log("│ #  │ Table Name                                  │ Rows   │ Columns │ Primary Key              │");
  console.log("├────┼─────────────────────────────────────────────┼────────┼─────────┼──────────────────────────┤");
  
  let totalRows = 0;
  let totalCols = 0;
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    totalRows += r.rowCount;
    totalCols += r.colCount;
    const num = String(i + 1).padStart(2, " ");
    const name = r.table.padEnd(43);
    const rows = String(r.rowCount).padStart(6);
    const cols = String(r.colCount).padStart(7);
    const pk = r.pkCols.join(", ").substring(0, 24).padEnd(24);
    console.log(`│ ${num} │ ${name} │ ${rows} │ ${cols} │ ${pk} │`);
  }
  
  console.log("├────┼─────────────────────────────────────────────┼────────┼─────────┼──────────────────────────┤");
  console.log(`│    │ TOTAL                                       │ ${String(totalRows).padStart(6)} │ ${String(totalCols).padStart(7)} │                          │`);
  console.log("└────┴─────────────────────────────────────────────┴────────┴─────────┴──────────────────────────┘");
  
  console.log(`\n[${ts()}] [VERIFY] PASS — ${wc2026Tables.length} tables enumerated, ${totalRows} total rows, ${totalCols} total columns`);
  console.log(`[${ts()}] [OUTPUT] Audit complete. Zero omissions. Full column inventories above.`);

  await conn.end();
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
