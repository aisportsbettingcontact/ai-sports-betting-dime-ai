/**
 * audit_missing_may27_games.ts
 * 
 * Deep forensic audit of the 3 missing May 27, 2026 MLB games:
 *   STL@MIL, SEA@ATH, TB@BAL
 * 
 * Checks: gameId, teams, modelRun, all model output columns, all model input
 * columns (pitchers, park, odds, lineups), and why model runner skipped them.
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import { eq, and, like, or, sql } from "drizzle-orm";

const TARGET_DATE = "20260527";
const TARGET_GAMES = [
  { away: "STL", home: "MIL" },
  { away: "SEA", home: "ATH" },
  { away: "TB",  home: "BAL" },
];

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection, { schema, mode: "default" });

  console.log(`\n${"=".repeat(80)}`);
  console.log(`[INPUT] Auditing 3 missing MLB games for date=${TARGET_DATE}`);
  console.log(`[INPUT] Target matchups: ${TARGET_GAMES.map(g => `${g.away}@${g.home}`).join(", ")}`);
  console.log(`${"=".repeat(80)}\n`);

  // Step 1: Pull all May 27 MLB games from DB
  console.log(`[STEP 1] Querying all MLB games for date=${TARGET_DATE}...`);
  const allGames = await db.select().from(schema.games).where(
    and(
      eq(schema.games.gameDate, TARGET_DATE),
      eq(schema.games.sport, "mlb")
    )
  );
  console.log(`[STATE] Total MLB games found for ${TARGET_DATE}: ${allGames.length}`);
  console.log(`[STATE] All games: ${allGames.map(g => `${g.awayTeam}@${g.homeTeam}(id=${g.id})`).join(", ")}\n`);

  // Step 2: Find each target game
  for (const target of TARGET_GAMES) {
    console.log(`${"─".repeat(70)}`);
    console.log(`[STEP 2] Inspecting ${target.away}@${target.home}...`);

    const game = allGames.find(g =>
      (g.awayTeam?.toUpperCase().includes(target.away) || g.awayAbbr?.toUpperCase() === target.away) &&
      (g.homeTeam?.toUpperCase().includes(target.home) || g.homeAbbr?.toUpperCase() === target.home)
    );

    if (!game) {
      // Try broader search
      const broader = allGames.find(g =>
        g.awayAbbr?.toUpperCase() === target.away ||
        g.homeAbbr?.toUpperCase() === target.home
      );
      if (broader) {
        console.log(`[STATE] PARTIAL MATCH: ${broader.awayAbbr}@${broader.homeAbbr} id=${broader.id}`);
        console.log(`[VERIFY] WARN — team abbreviation mismatch. Expected ${target.away}@${target.home}`);
      } else {
        console.log(`[VERIFY] FAIL — Game NOT FOUND in DB for ${target.away}@${target.home} on ${TARGET_DATE}`);
        console.log(`[STATE] This game either has no DB row or uses different team abbreviations`);
        // Try searching by team name fragments
        const byAway = allGames.filter(g => 
          g.awayTeam?.toLowerCase().includes(target.away.toLowerCase()) ||
          g.awayAbbr?.toLowerCase().includes(target.away.toLowerCase())
        );
        const byHome = allGames.filter(g => 
          g.homeTeam?.toLowerCase().includes(target.home.toLowerCase()) ||
          g.homeAbbr?.toLowerCase().includes(target.home.toLowerCase())
        );
        console.log(`[STATE] Games with away=${target.away}: ${byAway.map(g => `${g.awayAbbr}@${g.homeAbbr}(id=${g.id})`).join(", ") || "NONE"}`);
        console.log(`[STATE] Games with home=${target.home}: ${byHome.map(g => `${g.awayAbbr}@${g.homeAbbr}(id=${g.id})`).join(", ") || "NONE"}`);
      }
      console.log();
      continue;
    }

    console.log(`[STATE] Found: id=${game.id} | ${game.awayAbbr}@${game.homeAbbr} | gameTime=${game.gameTime}`);
    console.log();

    // Step 3: Model output columns
    console.log(`[STEP 3] Model output columns for id=${game.id}:`);
    console.log(`  modelRun:           ${game.modelRun ?? "NULL"}`);
    console.log(`  modelAwayML:        ${game.modelAwayML ?? "NULL"}`);
    console.log(`  modelHomeML:        ${game.modelHomeML ?? "NULL"}`);
    console.log(`  modelAwaySpread:    ${(game as any).modelAwaySpread ?? "NULL"}`);
    console.log(`  modelHomeSpread:    ${(game as any).modelHomeSpread ?? "NULL"}`);
    console.log(`  modelTotal:         ${(game as any).modelTotal ?? "NULL"}`);
    console.log(`  awayScore:          ${game.awayScore ?? "NULL"}`);
    console.log(`  homeScore:          ${game.homeScore ?? "NULL"}`);
    console.log();

    // Step 4: Model input columns — odds
    console.log(`[STEP 4] Book odds (model inputs) for id=${game.id}:`);
    console.log(`  awayML:             ${game.awayML ?? "NULL"}`);
    console.log(`  homeML:             ${game.homeML ?? "NULL"}`);
    console.log(`  awayBookSpread:     ${game.awayBookSpread ?? "NULL"}`);
    console.log(`  homeBookSpread:     ${game.homeBookSpread ?? "NULL"}`);
    console.log(`  awaySpreadOdds:     ${game.awaySpreadOdds ?? "NULL"}`);
    console.log(`  homeSpreadOdds:     ${game.homeSpreadOdds ?? "NULL"}`);
    console.log(`  awayRunLine:        ${game.awayRunLine ?? "NULL"}`);
    console.log(`  homeRunLine:        ${game.homeRunLine ?? "NULL"}`);
    console.log(`  awayRunLineOdds:    ${game.awayRunLineOdds ?? "NULL"}`);
    console.log(`  homeRunLineOdds:    ${game.homeRunLineOdds ?? "NULL"}`);
    console.log(`  overUnder:          ${game.overUnder ?? "NULL"}`);
    console.log(`  overOdds:           ${game.overOdds ?? "NULL"}`);
    console.log(`  underOdds:          ${game.underOdds ?? "NULL"}`);
    console.log();

    // Step 5: Pitcher columns
    console.log(`[STEP 5] Pitcher data for id=${game.id}:`);
    console.log(`  awayPitcher:        ${(game as any).awayPitcher ?? "NULL"}`);
    console.log(`  homePitcher:        ${(game as any).homePitcher ?? "NULL"}`);
    console.log(`  awayPitcherId:      ${(game as any).awayPitcherId ?? "NULL"}`);
    console.log(`  homePitcherId:      ${(game as any).homePitcherId ?? "NULL"}`);
    console.log(`  awayStartingPitcher: ${(game as any).awayStartingPitcher ?? "NULL"}`);
    console.log(`  homeStartingPitcher: ${(game as any).homeStartingPitcher ?? "NULL"}`);
    console.log();

    // Step 6: Park / venue
    console.log(`[STEP 6] Park/venue data for id=${game.id}:`);
    console.log(`  venue:              ${(game as any).venue ?? "NULL"}`);
    console.log(`  park:               ${(game as any).park ?? "NULL"}`);
    console.log(`  parkFactor:         ${(game as any).parkFactor ?? "NULL"}`);
    console.log();

    // Step 7: Game status
    console.log(`[STEP 7] Game status for id=${game.id}:`);
    console.log(`  status:             ${game.status ?? "NULL"}`);
    console.log(`  gameStatus:         ${(game as any).gameStatus ?? "NULL"}`);
    console.log(`  isPostponed:        ${(game as any).isPostponed ?? "NULL"}`);
    console.log(`  isDoubleHeader:     ${(game as any).isDoubleHeader ?? "NULL"}`);
    console.log();

    // Step 8: Determine model skip reason
    console.log(`[STEP 8] Model skip diagnosis for id=${game.id}:`);
    const issues: string[] = [];
    if (!game.awayML && !game.homeML) issues.push("MISSING: awayML + homeML (no odds)");
    if (!game.overUnder) issues.push("MISSING: overUnder (no total)");
    if (!(game as any).awayPitcher && !(game as any).awayStartingPitcher) issues.push("MISSING: awayPitcher");
    if (!(game as any).homePitcher && !(game as any).homeStartingPitcher) issues.push("MISSING: homePitcher");
    if (!(game as any).venue && !(game as any).park) issues.push("MISSING: venue/park");
    if (game.modelRun) issues.push("NOTE: modelRun IS set — model already ran but may have failed silently");
    
    if (issues.length === 0) {
      console.log(`  [VERIFY] All required inputs present — model skip reason is UNKNOWN (check model runner filter logic)`);
    } else {
      issues.forEach(i => console.log(`  [VERIFY] FAIL — ${i}`));
    }
    console.log();
  }

  // Step 9: Show all column names available on the games table
  console.log(`${"─".repeat(70)}`);
  console.log(`[STEP 9] All column keys on games table (first game sample):`);
  if (allGames.length > 0) {
    const keys = Object.keys(allGames[0]);
    console.log(`  ${keys.join(", ")}`);
  }
  console.log();

  await connection.end();
  console.log(`[OUTPUT] Audit complete.`);
}

main().catch(e => {
  console.error(`[VERIFY] FAIL — Audit script error:`, e);
  process.exit(1);
});
