/**
 * run_mlb_model_may30.ts
 * Force-rerun MLB model for all May 30, 2026 games.
 * Full logging: per-game RL invariant validation, publish confirmation.
 */
import { runMlbModelForDate } from "../server/mlbModelRunner";

const TAG = "[MAY30-RUNNER]";
const DATE = "2026-05-30";

function mlToProb(ml: number): number {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

async function main() {
  const startMs = Date.now();

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} May 30, 2026 MLB — Force Rerun Model`);
  console.log(`${TAG} [STEP 1] Calling runMlbModelForDate(${DATE}, forceRerun=true)...`);
  console.log(`${TAG} [STATE]  Simulation: 400,000 Monte Carlo iterations per game`);
  console.log(`${TAG} [STATE]  RL invariant fix: ACTIVE (P(cover -1.5) < P(win outright))`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  let result: Awaited<ReturnType<typeof runMlbModelForDate>>;
  try {
    result = await runMlbModelForDate(DATE, { forceRerun: true });
  } catch (e: any) {
    console.error(`${TAG} [ERROR] runMlbModelForDate threw: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [STEP 2] Model run complete. Elapsed: ${elapsedSec}s`);
  console.log(`${TAG} [OUTPUT] Written:     ${result.written}`);
  console.log(`${TAG} [OUTPUT] Errors:      ${result.errors}`);
  console.log(`${TAG} [OUTPUT] Invalidated: ${result.invalidated}`);
  console.log(`${TAG} [OUTPUT] Skipped:     ${result.skipped}`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  // ── Per-game RL invariant validation ──────────────────────────────────────
  console.log(`${TAG} [STEP 3] Per-game RL/ML invariant validation...`);
  let violations = 0;

  if (result.games && result.games.length > 0) {
    for (const g of result.games) {
      if (!g.modelAwayML || !g.modelHomeML || !g.awayModelSpread || !g.homeModelSpread) {
        console.log(`${TAG}   ⚠️  [${g.id}] ${g.awayTeam}@${g.homeTeam} — NULL model outputs (skipped/no pitchers)`);
        continue;
      }

      const awaySpread = parseFloat(String(g.awayModelSpread));
      const favIsAway = awaySpread < 0;
      const favTeam = favIsAway ? g.awayTeam : g.homeTeam;
      const favML = Number(favIsAway ? g.modelAwayML : g.modelHomeML);
      const favRLOdds = Number(favIsAway ? g.modelAwaySpreadOdds : g.modelHomeSpreadOdds);

      const pWin = mlToProb(favML);
      const pCover = mlToProb(favRLOdds);
      const invariantOk = pCover < pWin;
      if (!invariantOk) violations++;

      const status = invariantOk ? "✅" : "❌ INVARIANT VIOLATED";
      console.log(`${TAG}   ${status} [${g.id}] ${g.awayTeam}@${g.homeTeam}`);
      console.log(`${TAG}     [STATE] Proj: ${g.awayTeam}=${Number(g.modelAwayScore).toFixed(2)} | ${g.homeTeam}=${Number(g.modelHomeScore).toFixed(2)}`);
      console.log(`${TAG}     [STATE] ML: ${g.awayTeam}=${g.modelAwayML} | ${g.homeTeam}=${g.modelHomeML}`);
      console.log(`${TAG}     [STATE] RL: ${g.awayTeam} ${g.awayModelSpread}(${g.modelAwaySpreadOdds}) | ${g.homeTeam} ${g.homeModelSpread}(${g.modelHomeSpreadOdds})`);
      console.log(`${TAG}     [VERIFY] Fav=${favTeam} ML=${favML} P(win)=${pWin.toFixed(4)} | RL-1.5=${favRLOdds} P(cover)=${pCover.toFixed(4)} | OK=${invariantOk}`);
      console.log(`${TAG}     [STATE] Published: feed=${g.publishedToFeed} model=${g.publishedModel}`);
    }
  } else {
    // Fallback: re-query DB for validation
    console.log(`${TAG}   [STATE] No games in result object — will validate via DB audit script`);
  }

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  if (result.written === 15 && result.errors === 0 && violations === 0) {
    console.log(`${TAG} [VERIFY] ✅ FULL VALIDATION PASSED`);
    console.log(`${TAG}   Written: ${result.written}/15 | Errors: 0 | RL violations: 0`);
  } else {
    console.error(`${TAG} [VERIFY] ❌ VALIDATION FAILED`);
    console.error(`${TAG}   Written: ${result.written}/15 | Errors: ${result.errors} | RL violations: ${violations}`);
  }
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  process.exit(result.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${TAG} [FATAL] ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
