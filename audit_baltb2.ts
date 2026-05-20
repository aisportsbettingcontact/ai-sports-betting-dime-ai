/**
 * DEEP AUDIT: BAL@TB 05/20/2026 — Prez Rays ML bet grading pipeline
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const db = await createConnection(process.env.DATABASE_URL!);

  // ── STEP 1: All May 20 MLB games ────────────────────────────────────────────
  console.log("\n[STEP 1] All May 20 MLB games in DB...");
  const [allGames] = await db.execute(`
    SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, mlbGamePk,
           awayScore, homeScore, gameStatus
    FROM games
    WHERE gameDate = '2026-05-20' AND sport = 'MLB'
    ORDER BY startTimeEst ASC
  `) as any[];
  for (const g of allGames) {
    console.log(`[STATE] id=${g.id} ${g.awayTeam}@${g.homeTeam} status="${g.gameStatus}" score=${g.awayScore}-${g.homeScore} gamePk=${g.mlbGamePk}`);
  }

  // ── STEP 2: Prez's bets on 2026-05-20 ──────────────────────────────────────
  console.log("\n[STEP 2] All Prez (userId=1) bets on 2026-05-20...");
  const [prezBets] = await db.execute(`
    SELECT id, gameDate, awayTeam, homeTeam, betType, betLine, betOdds,
           riskUnits, toWinUnits, result, notes, createdAt
    FROM tracked_bets
    WHERE userId = 1 AND gameDate = '2026-05-20'
    ORDER BY createdAt ASC
  `) as any[];
  for (const b of prezBets) {
    console.log(`[STATE] bet id=${b.id} ${b.awayTeam}@${b.homeTeam} ${b.betType}/${b.betLine} odds=${b.betOdds} risk=${b.riskUnits} result=${b.result}`);
  }

  // ── STEP 3: MLB Stats API — TB on 2026-05-20 ────────────────────────────────
  console.log("\n[STEP 3] Fetching MLB Stats API for TB (teamId=139) on 2026-05-20...");
  const resp = await fetch("https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-05-20&hydrate=linescore&teamId=139");
  const data = await resp.json() as any;
  for (const d of (data.dates || [])) {
    for (const g of (d.games || [])) {
      console.log(`[STATE] MLB API gamePk=${g.gamePk} ${g.teams?.away?.team?.abbreviation}@${g.teams?.home?.team?.abbreviation} status="${g.status?.detailedState}" awayScore=${g.teams?.away?.score} homeScore=${g.teams?.home?.score}`);
    }
  }

  // ── STEP 4: tracked_bets columns ────────────────────────────────────────────
  console.log("\n[STEP 4] tracked_bets schema...");
  const [betCols] = await db.execute(`
    SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracked_bets'
    ORDER BY ORDINAL_POSITION
  `) as any[];
  console.log("[STATE] columns:", betCols.map((c: any) => `${c.COLUMN_NAME}(${c.COLUMN_TYPE})`).join(", "));

  // ── STEP 5: All tables ───────────────────────────────────────────────────────
  console.log("\n[STEP 5] All DB tables...");
  const [allTables] = await db.execute(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME
  `) as any[];
  console.log("[STATE] tables:", allTables.map((t: any) => t.TABLE_NAME).join(", "));

  await db.end();
  console.log("\n[OUTPUT] Audit complete.");
}

main().catch(err => { console.error("[ERROR]", err); process.exit(1); });
