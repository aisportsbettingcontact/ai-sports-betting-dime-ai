import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════════');
console.log('[INPUT] Auditing May 20, 2026 MLB games — full DB scan');
console.log('═══════════════════════════════════════════════════════════════════\n');

// STEP 1: List all tables
const [tables] = await conn.execute(`SHOW TABLES`);
const tableNames = tables.map(t => Object.values(t)[0]);
console.log('[STEP 1] All tables:', tableNames.join(', '));

// STEP 2: Find game/projection-related tables
const gameRelated = tableNames.filter(t =>
  /game|proj|model|publish|mlb|slate|feed|schedule|pick|projection/i.test(t)
);
console.log('[STATE] Game-related tables:', gameRelated.join(', '));

// STEP 3: Deep scan each relevant table
for (const tbl of gameRelated) {
  try {
    const [cols] = await conn.execute(`DESCRIBE \`${tbl}\``);
    const colNames = cols.map(c => c.Field);
    const dateCol = colNames.find(c => /date|game_date|gamedate|start/i.test(c));
    const sportCol = colNames.find(c => /sport|league/i.test(c));
    const publishCol = colNames.find(c => /publish|status|active|visible/i.test(c));

    console.log(`\n[STEP 3] Table="${tbl}" cols=[${colNames.join(',')}]`);
    console.log(`  dateCol=${dateCol||'none'} sportCol=${sportCol||'none'} publishCol=${publishCol||'none'}`);

    if (dateCol) {
      // Count all May 20 rows
      const [total] = await conn.execute(
        `SELECT COUNT(*) as cnt FROM \`${tbl}\` WHERE \`${dateCol}\` LIKE '2026-05-20%'`
      );
      console.log(`  [STATE] May 20 total rows: ${total[0].cnt}`);

      // Count MLB-specific if sport col exists
      if (sportCol && total[0].cnt > 0) {
        const [mlbCnt] = await conn.execute(
          `SELECT COUNT(*) as cnt FROM \`${tbl}\` WHERE \`${dateCol}\` LIKE '2026-05-20%' AND UPPER(\`${sportCol}\`) = 'MLB'`
        );
        console.log(`  [STATE] May 20 MLB rows: ${mlbCnt[0].cnt}`);
      }

      // Sample rows
      if (total[0].cnt > 0 && total[0].cnt <= 50) {
        const [rows] = await conn.execute(
          `SELECT * FROM \`${tbl}\` WHERE \`${dateCol}\` LIKE '2026-05-20%' ORDER BY \`${dateCol}\` ASC LIMIT 20`
        );
        for (const r of rows) {
          console.log(`  [ROW]`, JSON.stringify(r).substring(0, 300));
        }
      }

      // Check publish status breakdown if publish col exists
      if (publishCol && total[0].cnt > 0) {
        const [statusBreakdown] = await conn.execute(
          `SELECT \`${publishCol}\`, COUNT(*) as cnt FROM \`${tbl}\` WHERE \`${dateCol}\` LIKE '2026-05-20%' GROUP BY \`${publishCol}\``
        );
        console.log(`  [STATE] Publish status breakdown:`, statusBreakdown.map(r => `${r[publishCol]}=${r.cnt}`).join(', '));
      }
    } else {
      const [cnt] = await conn.execute(`SELECT COUNT(*) as cnt FROM \`${tbl}\``);
      console.log(`  [STATE] No date col — total rows: ${cnt[0].cnt}`);
    }
  } catch (e) {
    console.log(`  [ERROR] ${tbl}: ${e.message}`);
  }
}

// STEP 4: Check all tables for any May 20 data (broader scan)
console.log('\n[STEP 4] Broad scan — all tables for any May 20 data...');
for (const tbl of tableNames) {
  if (gameRelated.includes(tbl)) continue; // already scanned
  try {
    const [cols] = await conn.execute(`DESCRIBE \`${tbl}\``);
    const colNames = cols.map(c => c.Field);
    const dateCol = colNames.find(c => /date|created_at|updated_at/i.test(c));
    if (!dateCol) continue;
    const [cnt] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM \`${tbl}\` WHERE \`${dateCol}\` LIKE '2026-05-20%'`
    );
    if (cnt[0].cnt > 0) {
      console.log(`  [STATE] Table="${tbl}" dateCol="${dateCol}" May20 rows=${cnt[0].cnt}`);
    }
  } catch { /* skip */ }
}

await conn.end();
console.log('\n[VERIFY] PASS — full audit complete');
