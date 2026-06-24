import { getDb } from '../server/db.ts';
import { wc2026Fixtures } from '../drizzle/wc2026.schema.ts';
import { inArray } from 'drizzle-orm';

const db = await getDb();
const rows = await db
  .select({
    fixtureId: wc2026Fixtures.fixtureId,
    homeTeamId: wc2026Fixtures.homeTeamId,
    awayTeamId: wc2026Fixtures.awayTeamId,
    homeScore: wc2026Fixtures.homeScore,
    awayScore: wc2026Fixtures.awayScore,
    status: wc2026Fixtures.status,
  })
  .from(wc2026Fixtures)
  .where(inArray(wc2026Fixtures.fixtureId, ['wc26-g-045','wc26-g-046','wc26-g-047','wc26-g-048']));

console.log('[CHECK] June 23 WC Fixtures:');
for (const r of rows) {
  console.log(`  ${r.fixtureId}: ${r.homeTeamId} ${r.homeScore ?? 'null'}-${r.awayScore ?? 'null'} ${r.awayTeamId} | status=${r.status}`);
}
process.exit(0);
