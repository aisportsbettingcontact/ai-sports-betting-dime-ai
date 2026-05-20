/**
 * run_nhl_model_today.mjs
 * Manually triggers the NHL model sync for today (2026-05-20) with forceRerun=true.
 * This will re-run the model with fresh stats and update the DB.
 */
import 'dotenv/config';
// Use tsx to run the TypeScript module
import { execSync } from 'child_process';

console.log('[INPUT] Triggering NHL model sync for 2026-05-20 with forceRerun=true...');
console.log('[STEP] Running: npx tsx -e "import(\'./server/nhlModelSync.ts\').then(m => m.syncNhlModelForToday(\'manual\', true, false, \'2026-05-20\'))"');

try {
  const result = execSync(
    'npx tsx -e "import(\'./server/nhlModelSync.ts\').then(async m => { const r = await m.syncNhlModelForToday(\'manual\', true, false, \'2026-05-20\'); console.log(\'[OUTPUT] Result:\', JSON.stringify(r, null, 2)); process.exit(0); }).catch(e => { console.error(\'[ERROR]\', e.message); process.exit(1); })"',
    { cwd: '/home/ubuntu/ai-sports-betting', timeout: 120000, encoding: 'utf8', stdio: 'pipe' }
  );
  console.log(result);
} catch (err) {
  console.error('[ERROR]', err.message);
  if (err.stdout) console.log('[STDOUT]', err.stdout);
  if (err.stderr) console.log('[STDERR]', err.stderr);
}
