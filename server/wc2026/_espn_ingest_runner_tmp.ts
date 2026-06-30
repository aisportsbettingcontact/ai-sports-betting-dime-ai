
import { scrapeAndIngest } from "/home/ubuntu/ai-sports-betting/server/wc2026/espnDbIngester.ts";
import { getDb } from "/home/ubuntu/ai-sports-betting/server/db.ts";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

const GAME_ID = "760487";
const RESULT_FILE = "/tmp/espn_ingest_result.json";

async function run() {
  console.log("[RUNNER] Starting scrapeAndIngest for gameId=" + GAME_ID);
  const ingestResult = await scrapeAndIngest(GAME_ID, { dryRun: false });
  console.log("[RUNNER] Ingest complete — success=" + ingestResult.success);

  // DB row counts
  const db = await getDb();
  const tables = [
    "wc2026_espn_matches",
    "wc2026_espn_match_odds",
    "wc2026_espn_team_stats",
    "wc2026_espn_match_stats",
    "wc2026_espn_expected_goals",
    "wc2026_espn_shot_map",
    "wc2026_espn_player_stats",
    "wc2026_espn_lineups",
    "wc2026_espn_glossary",
  ];

  const rowCounts: Record<string, number> = {};
  for (const table of tables) {
    const isGlossary = table === "wc2026_espn_glossary";
    const query = isGlossary
      ? sql.raw(`SELECT COUNT(*) as cnt FROM ${table}`)
      : sql.raw(`SELECT COUNT(*) as cnt FROM ${table} WHERE matchId = '760487'`);
    const [rows] = await db.execute(query);
    rowCounts[table] = (rows as any)[0]?.cnt ?? 0;
  }

  // Spot checks
  const [matchData] = await db.execute(sql.raw(
    `SELECT homeTeamName, awayTeamName, homeScore, awayScore, venue FROM wc2026_espn_matches WHERE matchId = '760487' LIMIT 1`
  ));
  const [shotData] = await db.execute(sql.raw(
    `SELECT shotType, fieldStartX, fieldStartY, goalPositionY, playerName FROM wc2026_espn_shot_map WHERE matchId = '760487' LIMIT 1`
  ));
  const [defData] = await db.execute(sql.raw(
    `SELECT homeTackles, awayTackles, homeInterceptions, awayInterceptions, homeClearances, awayClearances FROM wc2026_espn_match_stats WHERE matchId = '760487' LIMIT 1`
  ));
  const [xgData] = await db.execute(sql.raw(
    `SELECT homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay, homeXGOT, awayXGOT, perPlayerJson FROM wc2026_espn_expected_goals WHERE matchId = '760487' LIMIT 1`
  ));
  const [oddsData] = await db.execute(sql.raw(
    `SELECT provider, homeMoneylineCurrent, awayMoneylineCurrent, drawMoneylineCurrent, homeSpreadLine, homeTotalSide FROM wc2026_espn_match_odds WHERE matchId = '760487' LIMIT 1`
  ));

  const output = {
    ingestResult,
    rowCounts,
    spotChecks: {
      match: (matchData as any)[0] ?? null,
      shot: (shotData as any)[0] ?? null,
      defense: (defData as any)[0] ?? null,
      xg: (xgData as any)[0] ?? null,
      odds: (oddsData as any)[0] ?? null,
    },
  };

  writeFileSync(RESULT_FILE, JSON.stringify(output, null, 2));
  console.log("[RUNNER] Result written to " + RESULT_FILE);
  process.exit(0);
}

run().catch(err => {
  console.error("[RUNNER] FATAL:", err);
  process.exit(1);
});
