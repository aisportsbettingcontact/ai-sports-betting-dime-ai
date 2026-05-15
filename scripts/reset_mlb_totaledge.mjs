/**
 * reset_mlb_totaledge.mjs
 * Reset modelRunAt for today's MLB games so they re-run with the new totalDiff/totalEdge logic.
 * Run: node scripts/reset_mlb_totaledge.mjs
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// Find today's MLB games that have been modeled (modelRunAt is not null)
const [rows] = await db.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, totalDiff, totalEdge, modelRunAt
   FROM games
   WHERE sport = 'MLB'
     AND gameDate = ?
     AND modelRunAt IS NOT NULL
   ORDER BY gameDate`,
  [today]
);

console.log(`[RESET] Found ${rows.length} modeled MLB games for ${today}:`);
for (const r of rows) {
  console.log(`  [${r.id}] ${r.awayTeam}@${r.homeTeam} | totalDiff=${r.totalDiff ?? 'NULL'} totalEdge=${r.totalEdge ?? 'NULL'}`);
}

if (rows.length === 0) {
  console.log('[RESET] No games to reset.');
  await db.end();
  process.exit(0);
}

// Reset modelRunAt so the model re-runs next cycle
const ids = rows.map(r => r.id);
const placeholders = ids.map(() => '?').join(',');
const [result] = await db.execute(
  `UPDATE games SET modelRunAt = NULL WHERE id IN (${placeholders})`,
  ids
);

console.log(`[RESET] ✓ Reset ${result.affectedRows} games. They will re-run on next model cycle.`);
await db.end();
