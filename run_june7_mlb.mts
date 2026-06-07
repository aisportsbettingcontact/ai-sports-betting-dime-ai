/**
 * run_june7_mlb.mts
 * ─────────────────────────────────────────────────────────────────────────────
 * Executes the full MLB Monte Carlo model for June 7, 2026 (all 15 games).
 * Run from project root: npx tsx run_june7_mlb.mts
 *
 * LOGGING FORMAT:
 *   [INPUT]  — source data
 *   [STEP]   — operation description
 *   [STATE]  — intermediate computations
 *   [OUTPUT] — result
 *   [VERIFY] — pass/fail + reason
 */

import 'dotenv/config';
import { runMlbModelForDate, validateMlbModelResults } from './server/mlbModelRunner';

const DATE = '2026-06-07';

console.log(`[INPUT] Starting MLB model run for ${DATE}`);
console.log(`[INPUT] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
console.log('[STEP] Config: 400K sims | pitcher rolling5 | park factors | bullpen | umpire | lineup Statcast | weather');
console.log('[STEP] Fix active: normalizeAccents() — José Soriano + Randy Vásquez will resolve from DB (not fallback)');

const t0 = Date.now();

const summary = await runMlbModelForDate(DATE, { forceRerun: true });

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`[OUTPUT] ${DATE} MLB Model Run Complete`);
console.log(`[OUTPUT] Elapsed: ${elapsed}s`);
console.log(`[OUTPUT] Games processed: ${summary.gamesProcessed}`);
console.log(`[OUTPUT] Games succeeded: ${summary.gamesSucceeded}`);
console.log(`[OUTPUT] Games failed: ${summary.gamesFailed}`);
console.log(`[OUTPUT] Games skipped: ${summary.gamesSkipped}`);
console.log('════════════════════════════════════════════════════════════════\n');

// ── Detailed per-game results ─────────────────────────────────────────────────
if (summary.results && summary.results.length > 0) {
  console.log('[STEP] Per-game results:');
  for (const r of summary.results) {
    const status = r.success ? '✓ PASS' : '✗ FAIL';
    const m = r.modelOutput;
    console.log(`  [${status}] id=${r.gameId} | ${r.awayTeam}@${r.homeTeam}`);
    if (r.message) console.log(`    MSG: ${r.message}`);
    if (m) {
      console.log(`    FG  ML: away=${m.modelAwayML} home=${m.modelHomeML} | awayWin=${m.modelAwayWinPct != null ? (Number(m.modelAwayWinPct)*100).toFixed(1)+'%' : 'N/A'}`);
      console.log(`    FG  RL: awayRL=${m.modelAwayPLCoverPct != null ? (Number(m.modelAwayPLCoverPct)*100).toFixed(1)+'%' : 'N/A'} | homeRL=${m.modelHomePLCoverPct != null ? (Number(m.modelHomePLCoverPct)*100).toFixed(1)+'%' : 'N/A'}`);
      console.log(`    FG TOT: modelTotal=${m.modelTotal} | over=${m.modelOverRate != null ? (Number(m.modelOverRate)*100).toFixed(1)+'%' : 'N/A'} | under=${m.modelUnderRate != null ? (Number(m.modelUnderRate)*100).toFixed(1)+'%' : 'N/A'}`);
      console.log(`    F5  ML: awayWin=${m.modelF5AwayWinPct != null ? (Number(m.modelF5AwayWinPct)*100).toFixed(1)+'%' : 'N/A'} | f5Total=${m.modelF5Total ?? 'N/A'}`);
      console.log(`    NRFI  : p=${m.modelPNrfi != null ? (Number(m.modelPNrfi)*100).toFixed(1)+'%' : 'N/A'}`);
    }
    if (!r.success && r.error) console.log(`    ERR: ${r.error}`);
  }
}

// ── Post-model validation ─────────────────────────────────────────────────────
console.log(`\n[STEP] Running post-model validation for ${DATE}...`);
const validation = await validateMlbModelResults(DATE);
console.log(`[VERIFY] Validation status: ${validation.status}`);
console.log(`[VERIFY] Games validated: ${validation.gamesValidated}`);
console.log(`[VERIFY] Games passed: ${validation.gamesPassed}`);
console.log(`[VERIFY] Games failed: ${validation.gamesFailed}`);
if (validation.errors && validation.errors.length > 0) {
  console.log('[VERIFY] Validation errors:');
  validation.errors.forEach((e: string) => console.log(`  ✗ ${e}`));
} else {
  console.log('[VERIFY] All validation checks PASSED ✓');
}

process.exit(0);
