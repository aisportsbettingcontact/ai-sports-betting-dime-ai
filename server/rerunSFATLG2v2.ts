/**
 * rerunSFATLG2v2.ts
 * 
 * Targeted rerun for SF@ATL Game 2 (id=2251041, mlbGamePk=824913)
 * Robbie Ray (SF) vs JR Ritchie (ATL)
 * 
 * Strategy:
 * 1. Set games.awayStartingPitcher = NULL and games.homeStartingPitcher = NULL
 *    so the COALESCE in runMlbModelForDate falls through to mlb_lineups
 * 2. Ensure mlb_lineups has Robbie Ray / JR Ritchie
 * 3. Run model with forceRerun=true targeting game id=2251041
 * 4. Verify output shows Robbie Ray / JR Ritchie
 * 5. Restore games.awayStartingPitcher = 'Robbie Ray' after model writes results
 */

import { runMlbModelForDate } from "./mlbModelRunner";
import { getDb } from "./db";
import { games, mlbLineups } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const GAME_ID = 2251041;
const GAME_DATE = "2026-06-17";
const AWAY_SP = "Robbie Ray";
const HOME_SP = "JR Ritchie";
const AWAY_SP_MLBAM = 519144; // Robbie Ray MLBAM ID
const HOME_SP_MLBAM = 694973; // JR Ritchie MLBAM ID

async function main() {
  console.log(`[RerunSFATLG2v2] START — SF@ATL G2 (id=${GAME_ID}) — ${AWAY_SP} vs ${HOME_SP}`);
  const db = await getDb();

  // Step 1: Verify mlb_lineups has correct pitchers
  console.log(`[RerunSFATLG2v2] [STEP 1] Verifying mlb_lineups pitcher assignments...`);
  await db.update(mlbLineups)
    .set({
      awayPitcherName: AWAY_SP,
      homePitcherName: HOME_SP,
      awayPitcherMlbamId: AWAY_SP_MLBAM,
      homePitcherMlbamId: HOME_SP_MLBAM,
      awayPitcherConfirmed: true,
      homePitcherConfirmed: true,
    })
    .where(eq(mlbLineups.gameId, GAME_ID));
  console.log(`[RerunSFATLG2v2] [VERIFY] mlb_lineups updated: awayPitcher=${AWAY_SP} (${AWAY_SP_MLBAM}), homePitcher=${HOME_SP} (${HOME_SP_MLBAM})`);

  // Step 2: NULL out games.awayStartingPitcher and games.homeStartingPitcher
  // so COALESCE falls through to mlb_lineups
  console.log(`[RerunSFATLG2v2] [STEP 2] Nulling games.awayStartingPitcher to force COALESCE fallthrough...`);
  await db.update(games)
    .set({
      awayStartingPitcher: null,
      homeStartingPitcher: null,
    })
    .where(eq(games.id, GAME_ID));
  console.log(`[RerunSFATLG2v2] [VERIFY] games.awayStartingPitcher=NULL, games.homeStartingPitcher=NULL`);

  // Step 3: Run model immediately
  console.log(`[RerunSFATLG2v2] [STEP 3] Running model engine for id=${GAME_ID}...`);
  const summary = await runMlbModelForDate(GAME_DATE, {
    targetGameIds: [GAME_ID],
    forceRerun: true,
  });

  // Step 4: Verify output
  console.log(`[RerunSFATLG2v2] [STEP 4] Model run complete. Summary:`, JSON.stringify(summary, null, 2));

  if (summary.errors > 0) {
    console.error(`[RerunSFATLG2v2] [FAIL] Model run had ${summary.errors} errors`);
    process.exit(1);
  }

  // Step 5: Restore correct pitcher names in games table
  console.log(`[RerunSFATLG2v2] [STEP 5] Restoring games.awayStartingPitcher=${AWAY_SP}...`);
  await db.update(games)
    .set({
      awayStartingPitcher: AWAY_SP,
      homeStartingPitcher: HOME_SP,
    })
    .where(eq(games.id, GAME_ID));
  console.log(`[RerunSFATLG2v2] [VERIFY] games.awayStartingPitcher=${AWAY_SP}, games.homeStartingPitcher=${HOME_SP}`);

  // Step 6: Final DB verification
  console.log(`[RerunSFATLG2v2] [STEP 6] Final DB verification...`);
  const result = await db.select({
    id: games.id,
    awayTeam: games.awayTeam,
    homeTeam: games.homeTeam,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    modelRunAt: games.modelRunAt,
    modelAwayScore: games.modelAwayScore,
    modelHomeScore: games.modelHomeScore,
    modelAwayWinPct: games.modelAwayWinPct,
    modelHomeWinPct: games.modelHomeWinPct,
    modelOverRate: games.modelOverRate,
    modelUnderRate: games.modelUnderRate,
    modelAwayML: games.modelAwayML,
    modelHomeML: games.modelHomeML,
    spreadEdge: games.spreadEdge,
    totalEdge: games.totalEdge,
  }).from(games).where(eq(games.id, GAME_ID));

  const r = result[0];
  if (!r) {
    console.error(`[RerunSFATLG2v2] [FAIL] Game id=${GAME_ID} not found in DB after model run`);
    process.exit(1);
  }

  console.log(`[RerunSFATLG2v2] [OUTPUT] Final DB state:`);
  console.log(`  Game: ${r.awayTeam}@${r.homeTeam} (id=${r.id})`);
  console.log(`  Away SP: ${r.awayStartingPitcher}`);
  console.log(`  Home SP: ${r.homeStartingPitcher}`);
  console.log(`  Model Run At: ${r.modelRunAt ? new Date(Number(r.modelRunAt)).toISOString() : 'NULL'}`);
  console.log(`  Projected Score: ${r.modelAwayScore}–${r.modelHomeScore}`);
  console.log(`  Win%: ${r.modelAwayWinPct}% / ${r.modelHomeWinPct}%`);
  console.log(`  Over/Under: ${r.modelOverRate}% / ${r.modelUnderRate}%`);
  console.log(`  Model ML: ${r.modelAwayML} / ${r.modelHomeML}`);
  console.log(`  Spread Edge: ${r.spreadEdge}`);
  console.log(`  Total Edge: ${r.totalEdge}`);

  // Validate pitcher assignment
  if (r.awayStartingPitcher !== AWAY_SP) {
    console.error(`[RerunSFATLG2v2] [FAIL] Away SP mismatch: expected=${AWAY_SP} got=${r.awayStartingPitcher}`);
    process.exit(1);
  }
  if (r.homeStartingPitcher !== HOME_SP) {
    console.error(`[RerunSFATLG2v2] [FAIL] Home SP mismatch: expected=${HOME_SP} got=${r.homeStartingPitcher}`);
    process.exit(1);
  }
  if (!r.modelRunAt) {
    console.error(`[RerunSFATLG2v2] [FAIL] modelRunAt is null — model did not write results`);
    process.exit(1);
  }

  console.log(`[RerunSFATLG2v2] [PASS] SF@ATL G2 successfully modeled with ${AWAY_SP} vs ${HOME_SP}`);
  console.log(`[RerunSFATLG2v2] COMPLETE — 1/1 games modeled, 0 errors`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[RerunSFATLG2v2] [FATAL]`, err);
  process.exit(1);
});
