/**
 * runJune13Mlb.ts
 * One-shot script: run MLB model for 2026-06-13 with forceRerun=true
 * Usage: npx tsx server/runJune13Mlb.ts
 */
import dotenv from 'dotenv';
dotenv.config();
import { runMlbModelForDate } from './mlbModelRunner';

async function main() {
  console.log('[INPUT] date=2026-06-13, forceRerun=true');
  console.log('[STEP] Invoking runMlbModelForDate...');
  const result = await runMlbModelForDate('2026-06-13', { forceRerun: true });
  console.log('[OUTPUT] Done');
  console.log('[STATE]', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
