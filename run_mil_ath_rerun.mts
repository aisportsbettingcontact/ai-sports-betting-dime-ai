/**
 * Re-run MIL@ATH (June 8, 2026) with corrected Las Vegas Ballpark park factor
 * Park factor updated: pf2026=1.35, hrFactor=1.44 (BallparkPal: +35% runs, +44% HR)
 * Altitude: 2,001 ft | Wind: 10-15 mph out | Temp: 91°F | Humidity: 9%
 */
import { runMlbModelForDate } from './server/mlbModelRunner.js';
import * as fs from 'fs';

const LOG_FILE = '/home/ubuntu/mil_ath_rerun.log';
const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
};

// Clear log
fs.writeFileSync(LOG_FILE, '');

log('[INPUT] Re-running MIL@ATH for 2026-06-08');
log('[INPUT] Park factor override: Las Vegas Ballpark pf2026=1.35 hrFactor=1.44');
log('[INPUT] BallparkPal: +35% runs, +44% HR, altitude=2001ft, wind=10-15mph out, temp=91F, humidity=9%');
log('[STEP] Invoking runMlbModelForDate for 2026-06-08 with targetGameIds=[2250932], forceRerun=true');

try {
  const summary = await runMlbModelForDate('2026-06-08', { 
    targetGameIds: [2250932], 
    forceRerun: true 
  });
  
  log(`[OUTPUT] Model run complete.`);
  log(`[OUTPUT] Summary: ${JSON.stringify(summary)}`);
  log('[VERIFY] Re-run complete. Check DB for updated MIL@ATH model values.');
} catch (err: any) {
  log(`[ERROR] Re-run failed: ${err.message}`);
  log(`[ERROR] Stack: ${err.stack}`);
  process.exit(1);
}
