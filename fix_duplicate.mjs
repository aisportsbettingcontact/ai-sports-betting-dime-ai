import mysql from 'mysql2/promise';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const conn = await mysql.createConnection(dbUrl);

// Check both duplicates
const [dups] = await conn.execute("SELECT id, userId, sport, gameDate, pick, result, riskUnits, toWinUnits, createdAt FROM tracked_bets WHERE gameDate='2026-05-16' AND pick='STL ML'");
console.log('[DUPLICATES FOUND]:', dups.length);
for (const r of dups) console.log(JSON.stringify(r));

if (dups.length === 2) {
  // Delete the earlier one (id=150007), keep the later one (id=150008)
  const toDelete = dups.reduce((a, b) => a.id < b.id ? a : b);
  console.log('[ACTION] Deleting duplicate id=' + toDelete.id);
  await conn.execute('DELETE FROM tracked_bets WHERE id = ?', [toDelete.id]);
  console.log('[DONE] Deleted id=' + toDelete.id);
} else if (dups.length === 1) {
  console.log('[OK] No duplicate — only 1 Cardinals ML bet exists');
} else {
  console.log('[INFO] ' + dups.length + ' bets found — manual review needed');
}

// Verify final state
const [final] = await conn.execute("SELECT id, pick, result, riskUnits, toWinUnits FROM tracked_bets WHERE gameDate='2026-05-16'");
console.log('[FINAL 05/16 STATE]:');
for (const r of final) console.log(JSON.stringify(r));

await conn.end();
