import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { games } from '../drizzle/schema';
import { and, eq, isNotNull } from 'drizzle-orm';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }
  const conn = await mysql.createConnection(dbUrl);
  const db = drizzle(conn);
  const rows = await db.select({
    id: games.id, gameDate: games.gameDate, awayTeam: games.awayTeam, homeTeam: games.homeTeam,
    awayML: games.awayML, homeML: games.homeML,
    awayBookSpread: games.awayBookSpread, homeBookSpread: games.homeBookSpread,
    awaySpreadOdds: games.awaySpreadOdds, homeSpreadOdds: games.homeSpreadOdds,
    awayRunLineOdds: games.awayRunLineOdds, homeRunLineOdds: games.homeRunLineOdds,
  }).from(games).where(and(eq(games.sport,'MLB'), isNotNull(games.awayBookSpread), isNotNull(games.awaySpreadOdds), isNotNull(games.homeSpreadOdds)));

  for (const r of rows) {
    const awayBS = parseFloat(String(r.awayBookSpread ?? 'NaN'));
    const awaySO = parseFloat(String(r.awaySpreadOdds ?? 'NaN'));
    const homeSO = parseFloat(String(r.homeSpreadOdds ?? 'NaN'));
    if (isNaN(awayBS) || isNaN(awaySO) || isNaN(homeSO)) continue;
    const awayIsFavBySpread = awayBS < 0;
    const awayHasFavOdds = awaySO < homeSO;
    if (awayIsFavBySpread !== awayHasFavOdds) {
      console.log('[REMAINING]', JSON.stringify(r, null, 2));
    }
  }
  console.log('[DONE]');
  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
