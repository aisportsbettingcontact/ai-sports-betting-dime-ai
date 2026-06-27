/**
 * run_mlb_model_june27.ts
 * Force-rerun MLB model for all June 27, 2026 games.
 * Full logging: per-game RL invariant validation, publish confirmation.
 * 15 games: HOU@DET, NYY@BOS, TEX@TOR, CIN@PIT, PHI@NYM, KC@CWS,
 *            ARI@TB, WSH@BAL, SEA@CLE, COL@MIN, CHC@MIL, MIA@STL,
 *            LAD@SD, ATL@SF, ATH@LAA
 */
import { runMlbModelForDate } from "../server/mlbModelRunner";

const TAG  = "[JUNE27-RUNNER]";
const DATE = "2026-06-27";

// Expected 15 game IDs from MLB Stats API
const EXPECTED_GAME_PKS = [
  824257, // HOU@DET
  824745, // NYY@BOS
  822794, // TEX@TOR
  823364, // CIN@PIT
  823609, // PHI@NYM
  824581, // KC@CWS
  822960, // ARI@TB
  824825, // WSH@BAL
  824421, // SEA@CLE
  823689, // COL@MIN
  823770, // CHC@MIL
  823038, // MIA@STL
  823283, // LAD@SD
  823207, // ATL@SF
  824015, // ATH@LAA
];

function mlToProb(ml: number): number {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

async function main() {
  const startMs = Date.now();

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} June 27, 2026 MLB — Force Rerun Model`);
  console.log(`${TAG} [INPUT]  Date: ${DATE}`);
  console.log(`${TAG} [INPUT]  Expected games: ${EXPECTED_GAME_PKS.length}`);
  console.log(`${TAG} [INPUT]  Game PKs: ${EXPECTED_GAME_PKS.join(', ')}`);
  console.log(`${TAG} [STATE]  Simulation: 400,000 Monte Carlo iterations per game`);
  console.log(`${TAG} [STATE]  RL invariant fix: ACTIVE (P(cover -1.5) < P(win outright))`);
  console.log(`${TAG} [STATE]  forceRerun: true (overwrites any existing model rows)`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  let result: Awaited<ReturnType<typeof runMlbModelForDate>>;

  try {
    console.log(`${TAG} [STEP 1] Calling runMlbModelForDate("${DATE}", { forceRerun: true })...`);
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
  let nullCount  = 0;

  if (result.games && result.games.length > 0) {
    for (const g of result.games) {
      if (!g.modelAwayML || !g.modelHomeML || !g.awayModelSpread || !g.homeModelSpread) {
        nullCount++;
        console.log(`${TAG}   ⚠️  [${g.id}] ${g.awayTeam}@${g.homeTeam} — NULL model outputs (skipped/no pitchers)`);
        continue;
      }

      const awaySpread = parseFloat(String(g.awayModelSpread));
      const favIsAway  = awaySpread < 0;
      const favTeam    = favIsAway ? g.awayTeam : g.homeTeam;
      const favML      = Number(favIsAway ? g.modelAwayML : g.modelHomeML);
      const favRLOdds  = Number(favIsAway ? g.modelAwaySpreadOdds : g.modelHomeSpreadOdds);

      const favMLProb  = mlToProb(favML);
      const favRLProb  = mlToProb(favRLOdds);

      const projHome   = Number(g.projectedHomeScore ?? 0);
      const projAway   = Number(g.projectedAwayScore ?? 0);
      const projTotal  = projHome + projAway;

      console.log(`${TAG}   [${g.id}] ${g.awayTeam}@${g.homeTeam}`);
      console.log(`${TAG}     Proj: ${projAway.toFixed(2)}-${projHome.toFixed(2)} (total ${projTotal.toFixed(2)})`);
      console.log(`${TAG}     Model ML: A${g.modelAwayML} / H${g.modelHomeML}`);
      console.log(`${TAG}     Model RL: A${g.awayModelSpread}(${g.modelAwaySpreadOdds}) / H${g.homeModelSpread}(${g.modelHomeSpreadOdds})`);
      console.log(`${TAG}     Model Total: ${g.modelTotal} O${g.modelOverOdds}/U${g.modelUnderOdds}`);

      // RL invariant: fav P(cover -1.5) must be < P(win outright)
      if (favRLProb > favMLProb + 0.001) {
        violations++;
        console.log(`${TAG}     ❌ RL INVARIANT VIOLATION: ${favTeam} P(RL)=${(favRLProb*100).toFixed(1)}% > P(ML)=${(favMLProb*100).toFixed(1)}%`);
      } else {
        console.log(`${TAG}     ✅ RL invariant OK: ${favTeam} P(ML)=${(favMLProb*100).toFixed(1)}% >= P(RL)=${(favRLProb*100).toFixed(1)}%`);
      }
    }
  } else {
    console.log(`${TAG}   [WARN] No games returned in result.games`);
  }

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [STEP 4] Validation Summary`);
  console.log(`${TAG}   Games returned:   ${result.games?.length ?? 0}`);
  console.log(`${TAG}   Written to DB:    ${result.written}`);
  console.log(`${TAG}   NULL outputs:     ${nullCount}`);
  console.log(`${TAG}   RL violations:    ${violations}`);
  console.log(`${TAG}   Errors:           ${result.errors}`);

  if (violations > 0) {
    console.log(`${TAG}   ⚠️  ${violations} RL invariant violations detected — review model outputs`);
  } else {
    console.log(`${TAG}   ✅ All RL invariants passed`);
  }

  if (result.written === 0 && result.errors === 0 && result.skipped > 0) {
    console.log(`${TAG}   ⚠️  All games skipped — check if forceRerun is working or if games are already modeled`);
  }

  console.log(`${TAG} [OUTPUT] Total elapsed: ${elapsedSec}s`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  process.exit(violations > 0 || result.errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`${TAG} [FATAL] Unhandled error:`, e);
  process.exit(1);
});
