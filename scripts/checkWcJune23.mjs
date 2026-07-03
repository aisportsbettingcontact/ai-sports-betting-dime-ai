import { getDb } from '../server/db.ts';
import { wc2026Matches } from '../drizzle/wc2026.schema.ts';
import { inArray } from 'drizzle-orm';

const db = await getDb();
const rows = await db
  .select({
    fixtureId: wc2026Matches.fixtureId,
    homeTeamId: wc2026Matches.homeTeamId,
    awayTeamId: wc2026Matches.awayTeamId,
    homeScore: wc2026Matches.homeScore,
    awayScore: wc2026Matches.awayScore,
    status: wc2026Matches.status,
  })
  .from(wc2026Matches)
  .where(inArray(wc2026Matches.fixtureId, ['wc26-g-045','wc26-g-046','wc26-g-047','wc26-g-048']));

console.log('[CHECK] June 23 WC Fixtures:');
for (const r of rows) {
  console.log(`  ${r.fixtureId}: ${r.homeTeamId} ${r.homeScore ?? 'null'}-${r.awayScore ?? 'null'} ${r.awayTeamId} | status=${r.status}`);
}
process.exit(0);
