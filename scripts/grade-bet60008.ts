/**
 * grade-bet60008.ts
 *
 * Direct invocation of gradeTrackedBet for bet 60008 (HOU@BAL G2, 2026-04-30).
 * This exercises the EXACT same code path as the tRPC autoGrade procedure.
 *
 * Run: npx tsx scripts/grade-bet60008.ts
 *
 * Expected outcome:
 *   result=LOSS, awayScore=11, homeScore=5
 *   (BAL bet on HOME at -127, BAL lost G2 5-11)
 */

import { gradeTrackedBet } from "../server/scoreGrader";
import { getDb } from "../server/db";
import { trackedBets } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Bet 60008 exact parameters ───────────────────────────────────────────────
const BET_ID = 60008;
const BET_PARAMS = {
  sport:      "MLB" as const,
  gameDate:   "2026-04-30",
  awayTeam:   "HOU",
  homeTeam:   "BAL",
  timeframe:  "FULL_GAME" as const,
  market:     "ML" as const,
  pickSide:   "HOME" as const,
  odds:       -127,
  line:       null,
  anGameId:   290399,
  gameNumber: 2 as const,
};

console.log("═".repeat(70));
console.log(`[INPUT] Grading bet id=${BET_ID}`);
console.log(`[INPUT] sport=${BET_PARAMS.sport} date=${BET_PARAMS.gameDate}`);
console.log(`[INPUT] ${BET_PARAMS.awayTeam}@${BET_PARAMS.homeTeam} G${BET_PARAMS.gameNumber}`);
console.log(`[INPUT] market=${BET_PARAMS.market} pickSide=${BET_PARAMS.pickSide} odds=${BET_PARAMS.odds}`);
console.log(`[INPUT] anGameId=${BET_PARAMS.anGameId} (AN ID ≠ MLB gamePk — expect fallback)`);
console.log("═".repeat(70));

// ─── Step 1: Verify bet is PENDING in DB ─────────────────────────────────────
console.log("\n[STEP 1] Verifying bet is PENDING in DB...");
const db = await getDb();
const betRow = await db.select({
  id: trackedBets.id,
  result: trackedBets.result,
  awayScore: trackedBets.awayScore,
  homeScore: trackedBets.homeScore,
  gameNumber: trackedBets.gameNumber,
}).from(trackedBets).where(eq(trackedBets.id, BET_ID)).limit(1);

if (!betRow.length) {
  console.error(`[ERROR] Bet id=${BET_ID} not found in DB`);
  process.exit(1);
}

const bet = betRow[0];
console.log(`[STATE] DB state: id=${bet.id} result=${bet.result} awayScore=${bet.awayScore} homeScore=${bet.homeScore} gameNumber=${bet.gameNumber}`);

if (bet.result !== "PENDING") {
  console.error(`[ERROR] Bet id=${BET_ID} is not PENDING (result=${bet.result}) — cannot re-grade`);
  console.error(`[ERROR] Reset to PENDING first: UPDATE tracked_bets SET result='PENDING', awayScore=NULL, homeScore=NULL WHERE id=${BET_ID}`);
  process.exit(1);
}

console.log(`[VERIFY] Bet is PENDING ✅ — proceeding with gradeTrackedBet`);

// ─── Step 2: Invoke gradeTrackedBet ──────────────────────────────────────────
console.log("\n[STEP 2] Invoking gradeTrackedBet...");
const startMs = Date.now();
const gradeOut = await gradeTrackedBet(BET_PARAMS);
const elapsedMs = Date.now() - startMs;

console.log("\n[OUTPUT] gradeTrackedBet returned:");
console.log(`  result:     ${gradeOut.result}`);
console.log(`  awayScore:  ${gradeOut.awayScore}`);
console.log(`  homeScore:  ${gradeOut.homeScore}`);
console.log(`  gameState:  ${gradeOut.gameState}`);
console.log(`  reason:     ${gradeOut.reason}`);
console.log(`  awayAbbrev: ${gradeOut.awayAbbrev}`);
console.log(`  homeAbbrev: ${gradeOut.homeAbbrev}`);
console.log(`  elapsed:    ${elapsedMs}ms`);

// ─── Step 3: Validate output ──────────────────────────────────────────────────
console.log("\n[STEP 3] Validating gradeTrackedBet output...");

let allPass = true;

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ✅ PASS: ${label} → ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ❌ FAIL: ${label} → got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    allPass = false;
  }
}

check("result=LOSS (BAL lost G2 5-11)", gradeOut.result, "LOSS");
check("awayScore=11 (HOU)", gradeOut.awayScore, 11);
check("homeScore=5 (BAL)", gradeOut.homeScore, 5);
check("gameState=Final", gradeOut.gameState, "Final");
check("awayAbbrev=HOU", gradeOut.awayAbbrev, "HOU");
check("homeAbbrev=BAL", gradeOut.homeAbbrev, "BAL");

if (!allPass) {
  console.error("\n[ERROR] Validation failed — NOT updating DB");
  process.exit(1);
}

if (gradeOut.result === "PENDING") {
  console.log("\n[WARN] Grade result is still PENDING — game may not be final yet");
  console.log(`[WARN] Reason: ${gradeOut.reason}`);
  process.exit(0);
}

// ─── Step 4: Update DB ────────────────────────────────────────────────────────
console.log("\n[STEP 4] Updating DB with correct grade...");

await db.update(trackedBets).set({
  result: gradeOut.result as "WIN" | "LOSS" | "PUSH" | "PENDING" | "VOID",
  awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
  homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
}).where(eq(trackedBets.id, BET_ID));

console.log(`[STATE] DB updated: id=${BET_ID} result=${gradeOut.result} awayScore=${gradeOut.awayScore} homeScore=${gradeOut.homeScore}`);

// ─── Step 5: Verify DB update ─────────────────────────────────────────────────
console.log("\n[STEP 5] Verifying DB update...");

const updatedRow = await db.select({
  id: trackedBets.id,
  result: trackedBets.result,
  awayScore: trackedBets.awayScore,
  homeScore: trackedBets.homeScore,
}).from(trackedBets).where(eq(trackedBets.id, BET_ID)).limit(1);

const updated = updatedRow[0];
console.log(`[STATE] DB after update: id=${updated.id} result=${updated.result} awayScore=${updated.awayScore} homeScore=${updated.homeScore}`);

check("DB result=LOSS", updated.result, "LOSS");
check("DB awayScore=11", updated.awayScore, "11");
check("DB homeScore=5", updated.homeScore, "5");

// ─── Final summary ────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(70));
if (allPass) {
  console.log(`[VERIFY] ✅ ALL CHECKS PASS`);
  console.log(`[VERIFY] Bet id=${BET_ID} correctly graded:`);
  console.log(`[VERIFY]   HOU@BAL G2 (2026-04-30) gamePk=824850`);
  console.log(`[VERIFY]   HOU 11, BAL 5 → pickSide=HOME (BAL) → result=LOSS`);
  console.log(`[VERIFY]   DB updated: result=LOSS awayScore=11 homeScore=5`);
} else {
  console.log(`[VERIFY] ❌ SOME CHECKS FAILED — review above`);
}
console.log("═".repeat(70));

process.exit(0);
