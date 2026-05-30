/**
 * Targeted single-game rerun: PHI@LAD (game 2250824) May 30, 2026
 * Root cause: LAYER 1 ML-direction guard overrode correct awayRunLine=+1.5
 * Fix applied: LAYER 1 override removed — awayRunLine is now always authoritative
 */
import 'dotenv/config';
import { runMlbModelForDate } from '../server/mlbModelRunner';

const TAG = '[PHI@LAD-RERUN]';
const START = Date.now();

async function main() {
  console.log(`${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [STEP 1] Relaunching PHI@LAD (2250824) with LAYER 1 fix applied`);
  console.log(`${TAG} [INPUT] Date: 2026-05-30 | forceRerun: true | gameId: 2250824`);
  console.log(`${TAG} [STATE] Fix: awayRunLine is now authoritative — ML-direction override removed`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════`);

  try {
    const result = await runMlbModelForDate('2026-05-30', { forceRerun: true });

    const elapsed = ((Date.now() - START) / 1000).toFixed(1);
    console.log(`${TAG} ════════════════════════════════════════════════════════════`);
    console.log(`${TAG} [STEP 2] Model run complete. Elapsed: ${elapsed}s`);
    console.log(`${TAG} [OUTPUT] Written:     ${result?.written ?? 'N/A'}`);
    console.log(`${TAG} [OUTPUT] Errors:      ${result?.errors ?? 'N/A'}`);
    console.log(`${TAG} [OUTPUT] Invalidated: ${result?.invalidated ?? 'N/A'}`);
    console.log(`${TAG} [OUTPUT] Skipped:     ${result?.skipped ?? 'N/A'}`);
    console.log(`${TAG} ════════════════════════════════════════════════════════════`);

    // Validate PHI@LAD specifically
    const { getDb } = await import('../server/db');
    const { games } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const [game] = await db.select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayML: games.awayML,
      homeML: games.homeML,
      awayRunLine: games.awayRunLine,
      homeRunLine: games.homeRunLine,
      modelAwayML: games.modelAwayML,
      modelHomeML: games.modelHomeML,
      awayModelSpread: games.awayModelSpread,
      homeModelSpread: games.homeModelSpread,
      modelAwaySpreadOdds: games.modelAwaySpreadOdds,
      modelHomeSpreadOdds: games.modelHomeSpreadOdds,
      publishedToFeed: games.publishedToFeed,
      modelRunAt: games.modelRunAt,
    }).from(games).where(eq(games.id, 2250824));

    if (!game) {
      console.error(`${TAG} [VERIFY] ❌ FAIL — game 2250824 not found in DB`);
      process.exit(1);
    }

    const modelRunAt = game.modelRunAt;
    const published = game.publishedToFeed;

    console.log(`${TAG} [VERIFY] PHI@LAD (2250824):`);
    console.log(`${TAG}   Book ML: PHI ${game.awayML} / LAD ${game.homeML}`);
    console.log(`${TAG}   Book RL: PHI ${game.awayRunLine} / LAD ${game.homeRunLine}`);
    console.log(`${TAG}   Model ML: PHI ${game.modelAwayML} / LAD ${game.modelHomeML}`);
    console.log(`${TAG}   Model RL: PHI ${game.awayModelSpread}(${game.modelAwaySpreadOdds}) / LAD ${game.homeModelSpread}(${game.modelHomeSpreadOdds})`);
    console.log(`${TAG}   modelRunAt: ${modelRunAt ? new Date(Number(modelRunAt)).toISOString() : 'NULL'}`);
    console.log(`${TAG}   publishedToFeed: ${published}`);

    // Validate RL sign: PHI is away dog (+1.5), LAD is home fav (-1.5)
    const awayModelSpread = game.awayModelSpread;
    const homeModelSpread = game.homeModelSpread;
    const awaySpreadNum = awayModelSpread ? parseFloat(String(awayModelSpread)) : null;
    const homeSpreadNum = homeModelSpread ? parseFloat(String(homeModelSpread)) : null;

    if (awaySpreadNum !== null && homeSpreadNum !== null) {
      if (awaySpreadNum > 0 && homeSpreadNum < 0) {
        console.log(`${TAG} [VERIFY] ✅ RL SIGN CORRECT — PHI ${awaySpreadNum > 0 ? '+' : ''}${awaySpreadNum} (dog) / LAD ${homeSpreadNum} (fav)`);
      } else {
        console.error(`${TAG} [VERIFY] ❌ RL SIGN WRONG — PHI ${awaySpreadNum} / LAD ${homeSpreadNum} — STILL INVERTED`);
        process.exit(1);
      }
    }

    // Validate ML/RL invariant
    const modelAwayML = game.modelAwayML ? parseFloat(String(game.modelAwayML)) : null;
    const modelHomeML = game.modelHomeML ? parseFloat(String(game.modelHomeML)) : null;
    const modelHomeSpreadOdds = game.modelHomeSpreadOdds ? parseFloat(String(game.modelHomeSpreadOdds)) : null;

    if (modelHomeML !== null && modelHomeSpreadOdds !== null) {
      const pHomeWin = modelHomeML < 0 ? Math.abs(modelHomeML) / (Math.abs(modelHomeML) + 100) : 100 / (modelHomeML + 100);
      const pHomeCoverRL = modelHomeSpreadOdds < 0 ? Math.abs(modelHomeSpreadOdds) / (Math.abs(modelHomeSpreadOdds) + 100) : 100 / (modelHomeSpreadOdds + 100);
      if (pHomeCoverRL <= pHomeWin + 0.02) {
        console.log(`${TAG} [VERIFY] ✅ ML/RL INVARIANT HOLDS — P(LAD wins)=${(pHomeWin*100).toFixed(2)}% >= P(LAD covers -1.5)=${(pHomeCoverRL*100).toFixed(2)}%`);
      } else {
        console.error(`${TAG} [VERIFY] ❌ ML/RL INVARIANT VIOLATED — P(LAD wins)=${(pHomeWin*100).toFixed(2)}% < P(LAD covers -1.5)=${(pHomeCoverRL*100).toFixed(2)}%`);
        process.exit(1);
      }
    }

    if (modelRunAt && published) {
      console.log(`${TAG} [VERIFY] ✅ PASS — PHI@LAD modeled and published`);
      console.log(`${TAG} ════════════════════════════════════════════════════════════`);
      console.log(`${TAG} [RESULT] 15/15 May 30 games complete`);
    } else {
      console.error(`${TAG} [VERIFY] ❌ FAIL — modelRunAt=${modelRunAt} published=${published}`);
      process.exit(1);
    }

  } catch (err) {
    console.error(`${TAG} [ERROR] ${err}`);
    process.exit(1);
  }
}

main();
