/**
 * DEEP AUDIT: BAL@TB 05/20/2026 — Prez Rays ML bet grading pipeline
 * [INPUT] Game: BAL@TB | Date: 2026-05-20 | Bet: Rays ML -114
 * [STEP] 1. Pull game row from DB (games table)
 * [STEP] 2. Pull Prez's tracked_bet for this game
 * [STEP] 3. Fetch live score from MLB Stats API
 * [STEP] 4. Check auto-grader scheduler state in server logs
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

// ── STEP 1: Game row ──────────────────────────────────────────────────────────
console.log("\n[STEP 1] Querying games table for BAL@TB on 2026-05-20...");
const [gameRows] = await db.execute(`
  SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, mlbGamePk,
         awayScore, homeScore, gameStatus, modelRunAt,
         awayML, homeML, awayRunLine, bookTotal
  FROM games
  WHERE gameDate = '2026-05-20'
    AND sport = 'MLB'
    AND (
      (awayTeam LIKE '%BAL%' AND homeTeam LIKE '%TB%')
      OR (awayTeam LIKE '%Baltimore%' AND homeTeam LIKE '%Tampa%')
      OR (awayTeam = 'BAL' AND homeTeam = 'TB')
    )
  LIMIT 5
`);
console.log("[STATE] BAL@TB game rows:", JSON.stringify(gameRows, null, 2));

if ((gameRows as any[]).length === 0) {
  // Try broader search
  console.log("[STEP 1b] Broader search for BAL or TB teams on 2026-05-20...");
  const [allGames] = await db.execute(`
    SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, mlbGamePk,
           awayScore, homeScore, gameStatus
    FROM games
    WHERE gameDate = '2026-05-20' AND sport = 'MLB'
    ORDER BY startTimeEst ASC
  `);
  console.log("[STATE] All May 20 MLB games:", JSON.stringify(allGames, null, 2));
}

// ── STEP 2: Prez's tracked_bet ────────────────────────────────────────────────
console.log("\n[STEP 2] Querying tracked_bets for Prez (userId=1) on 2026-05-20 with TB...");
const [betRows] = await db.execute(`
  SELECT id, userId, gameDate, awayTeam, homeTeam, betType, betLine, betOdds,
         riskUnits, toWinUnits, result, notes, createdAt
  FROM tracked_bets
  WHERE userId = 1
    AND gameDate = '2026-05-20'
    AND (homeTeam LIKE '%TB%' OR homeTeam LIKE '%Tampa%' OR homeTeam LIKE '%Rays%'
         OR awayTeam LIKE '%TB%' OR awayTeam LIKE '%Tampa%' OR awayTeam LIKE '%Rays%')
  ORDER BY createdAt DESC
  LIMIT 10
`);
console.log("[STATE] Prez TB bets on 2026-05-20:", JSON.stringify(betRows, null, 2));

// Also check all Prez bets on 2026-05-20
const [allPrezBets] = await db.execute(`
  SELECT id, gameDate, awayTeam, homeTeam, betType, betLine, betOdds,
         riskUnits, toWinUnits, result, createdAt
  FROM tracked_bets
  WHERE userId = 1 AND gameDate = '2026-05-20'
  ORDER BY createdAt DESC
`);
console.log("[STATE] All Prez bets on 2026-05-20:", JSON.stringify(allPrezBets, null, 2));

// ── STEP 3: MLB Stats API live score ─────────────────────────────────────────
console.log("\n[STEP 3] Fetching MLB Stats API score for BAL@TB on 2026-05-20...");
try {
  const schedUrl = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-05-20&hydrate=linescore,game(content(summary))&teamId=139";
  // TB teamId = 139
  const resp = await fetch(schedUrl);
  const data = await resp.json() as any;
  const dates = data.dates || [];
  if (dates.length === 0) {
    console.log("[STATE] MLB API: no games found for TB on 2026-05-20");
  } else {
    for (const d of dates) {
      for (const g of (d.games || [])) {
        console.log("[STATE] MLB API game:", {
          gamePk: g.gamePk,
          status: g.status?.detailedState,
          away: g.teams?.away?.team?.abbreviation,
          awayScore: g.teams?.away?.score,
          home: g.teams?.home?.team?.abbreviation,
          homeScore: g.teams?.home?.score,
          gameDate: g.gameDate,
        });
      }
    }
  }
} catch (err) {
  console.error("[ERROR] MLB Stats API fetch failed:", err instanceof Error ? err.message : String(err));
}

// ── STEP 4: Check auto-grader references in DB ────────────────────────────────
console.log("\n[STEP 4] Checking auto-grader job state — looking for grading_jobs or similar tables...");
const [tables] = await db.execute(`
  SELECT TABLE_NAME FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME LIKE '%grad%'
  ORDER BY TABLE_NAME
`);
console.log("[STATE] Grading-related tables:", JSON.stringify(tables, null, 2));

// Check if tracked_bets has a gameId foreign key to games
const [betCols] = await db.execute(`
  SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracked_bets'
  ORDER BY ORDINAL_POSITION
`);
console.log("[STATE] tracked_bets columns:", JSON.stringify(betCols, null, 2));

await db.end();
console.log("\n[OUTPUT] Audit complete.");
