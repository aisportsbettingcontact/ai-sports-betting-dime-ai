/**
 * May 30, 2026 — Full post-run validation
 * Validates: 15/15 written, 15/15 published, RL signs correct, ML/RL invariants hold
 */
import 'dotenv/config';
import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { and, sql } from 'drizzle-orm';

const TAG = '[VALIDATE-MAY30]';

function mlToProb(ml: number): number {
  return ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
}

async function main() {
  const db = await getDb();

  const rows = await db.select({
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
    modelAwayScore: games.modelAwayScore,
    modelHomeScore: games.modelHomeScore,
    awayWinPct: games.modelAwayWinPct,
    homeWinPct: games.modelHomeWinPct,
    publishedToFeed: games.publishedToFeed,
    publishedModel: games.publishedModel,
    modelRunAt: games.modelRunAt,
  }).from(games).where(sql`${games.gameDate} = '2026-05-30'`).orderBy(games.startTimeEst);

  let written = 0, published = 0, signErrors = 0, violations = 0;

  console.log(`${TAG} ═══════════════════════════════════════════════════════════`);
  console.log(`${TAG} MAY 30, 2026 — FULL POST-RUN VALIDATION`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════════`);
  console.log('');

  for (const r of rows) {
    const modeled = r.modelRunAt != null;
    const pub = r.publishedToFeed === 1 || r.publishedToFeed === true;
    if (modeled) written++;
    if (pub) published++;

    // RL sign check
    let signStatus = 'N/A';
    if (r.awayModelSpread && r.awayRunLine) {
      const bookSign = Math.sign(parseFloat(String(r.awayRunLine)));
      const modelSign = Math.sign(parseFloat(String(r.awayModelSpread)));
      if (bookSign === modelSign) {
        signStatus = '✅ SIGN_OK';
      } else {
        signStatus = `❌ SIGN_ERR (book=${r.awayRunLine} model=${r.awayModelSpread})`;
        signErrors++;
      }
    }

    // ML/RL invariant check (home fav case: homeRunLine < 0)
    let invStatus = 'N/A';
    if (r.homeRunLine && r.modelHomeML && r.modelHomeSpreadOdds) {
      const homeRL = parseFloat(String(r.homeRunLine));
      if (homeRL < 0) {
        const homeML = parseFloat(String(r.modelHomeML));
        const homeRLOdds = parseFloat(String(r.modelHomeSpreadOdds));
        const pWin = mlToProb(homeML);
        const pCover = mlToProb(homeRLOdds);
        if (pCover > pWin + 0.02) {
          invStatus = `❌ VIOLATION P(cover)=${(pCover*100).toFixed(2)}% > P(win)=${(pWin*100).toFixed(2)}%`;
          violations++;
        } else {
          invStatus = `✅ INV_OK P(cover)=${(pCover*100).toFixed(2)}% ≤ P(win)=${(pWin*100).toFixed(2)}%`;
        }
      }
    }
    // Also check away fav case: awayRunLine < 0
    if (r.awayRunLine && r.modelAwayML && r.modelAwaySpreadOdds) {
      const awayRL = parseFloat(String(r.awayRunLine));
      if (awayRL < 0) {
        const awayML = parseFloat(String(r.modelAwayML));
        const awayRLOdds = parseFloat(String(r.modelAwaySpreadOdds));
        const pWin = mlToProb(awayML);
        const pCover = mlToProb(awayRLOdds);
        if (pCover > pWin + 0.02) {
          invStatus = `❌ VIOLATION(away) P(cover)=${(pCover*100).toFixed(2)}% > P(win)=${(pWin*100).toFixed(2)}%`;
          violations++;
        } else {
          invStatus = `✅ INV_OK(away) P(cover)=${(pCover*100).toFixed(2)}% ≤ P(win)=${(pWin*100).toFixed(2)}%`;
        }
      }
    }

    const statusIcon = modeled && pub ? '✅' : modeled && !pub ? '⚠️ ' : '❌';
    const awayScore = r.modelAwayScore ? parseFloat(String(r.modelAwayScore)).toFixed(2) : 'NULL';
    const homeScore = r.modelHomeScore ? parseFloat(String(r.modelHomeScore)).toFixed(2) : 'NULL';

    console.log(`${statusIcon} ${r.awayTeam}@${r.homeTeam} [${r.id}] | ${modeled ? 'MODELED' : 'NOT_MODELED'} | ${pub ? 'PUBLISHED' : 'UNPUBLISHED'}`);
    console.log(`   Proj: ${r.awayTeam} ${awayScore} – ${homeScore} ${r.homeTeam}`);
    console.log(`   Model ML: ${r.awayTeam} ${r.modelAwayML} / ${r.homeTeam} ${r.modelHomeML}`);
    console.log(`   Book RL: ${r.awayTeam} ${r.awayRunLine} / ${r.homeTeam} ${r.homeRunLine}`);
    console.log(`   Model RL: ${r.awayTeam} ${r.awayModelSpread}(${r.modelAwaySpreadOdds}) / ${r.homeTeam} ${r.homeModelSpread}(${r.modelHomeSpreadOdds})`);
    console.log(`   ${signStatus} | ${invStatus}`);
    console.log('');
  }

  console.log(`${TAG} ═══════════════════════════════════════════════════════════`);
  console.log(`${TAG} SUMMARY`);
  console.log(`${TAG}   Total games:     ${rows.length}`);
  console.log(`${TAG}   Written:         ${written}/15`);
  console.log(`${TAG}   Published:       ${published}/15`);
  console.log(`${TAG}   RL Sign Errors:  ${signErrors}`);
  console.log(`${TAG}   RL Violations:   ${violations}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════════`);

  if (written === 15 && published === 15 && signErrors === 0 && violations === 0) {
    console.log(`${TAG} ✅ RESULT: ALL 15 GAMES PASS — May 30, 2026 COMPLETE`);
    process.exit(0);
  } else {
    console.log(`${TAG} ❌ RESULT: VALIDATION FAILED — see above for details`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`${TAG} [ERROR] ${e.message}`);
  process.exit(1);
});
