import { getDb } from '../server/db.ts';
import { wc2026Fixtures } from '../drizzle/wc2026.schema.ts';
import { eq } from 'drizzle-orm';

const db = await getDb();
await db.update(wc2026Fixtures)
  .set({ homeScore: null, awayScore: null, status: 'SCHEDULED' })
  .where(eq(wc2026Fixtures.fixtureId, 'wc26-g-046'));
console.log('[REVERT] wc26-g-046 set to SCHEDULED with null scores ✅');
process.exit(0);
