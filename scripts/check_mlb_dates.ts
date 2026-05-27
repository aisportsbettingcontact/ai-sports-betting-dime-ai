import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
  const db = drizzle(connection, { schema, mode: "default" });

  console.log("[STEP 1] Most recent MLB games in DB:");
  const latest = await db
    .select({
      id: schema.games.id,
      awayTeam: schema.games.awayTeam,
      homeTeam: schema.games.homeTeam,
      gameDate: schema.games.gameDate,
      gameStatus: schema.games.gameStatus,
      modelAwayML: schema.games.modelAwayML,
      awayML: schema.games.awayML,
    })
    .from(schema.games)
    .where(eq(schema.games.sport, "mlb"))
    .orderBy(desc(schema.games.gameDate))
    .limit(10);

  latest.forEach((r) =>
    console.log(
      `  id=${r.id} ${r.awayTeam}@${r.homeTeam} date=${r.gameDate} status=${r.gameStatus} modelAwayML=${r.modelAwayML} awayML=${r.awayML}`
    )
  );

  console.log("\n[STEP 2] May 27, 2026 MLB games:");
  const may27 = await db
    .select({
      id: schema.games.id,
      awayTeam: schema.games.awayTeam,
      homeTeam: schema.games.homeTeam,
      gameDate: schema.games.gameDate,
      gameStatus: schema.games.gameStatus,
      modelAwayML: schema.games.modelAwayML,
      modelHomeML: schema.games.modelHomeML,
      awayML: schema.games.awayML,
      homeML: schema.games.homeML,
      awayStartingPitcher: schema.games.awayStartingPitcher,
      homeStartingPitcher: schema.games.homeStartingPitcher,
      venue: schema.games.venue,
      mlbGamePk: schema.games.mlbGamePk,
      bookTotal: schema.games.bookTotal,
      awayRunLine: schema.games.awayRunLine,
      modelRunAt: schema.games.modelRunAt,
    })
    .from(schema.games)
    .where(and(eq(schema.games.sport, "mlb"), eq(schema.games.gameDate, "20260527")));

  if (may27.length === 0) {
    console.log("  NONE — no rows for 20260527 in DB");
  } else {
    may27.forEach((r) =>
      console.log(
        `  id=${r.id} ${r.awayTeam}@${r.homeTeam} status=${r.gameStatus} modelAwayML=${r.modelAwayML} awayML=${r.awayML} bookTotal=${r.bookTotal} awayRL=${r.awayRunLine} awayP="${r.awayStartingPitcher}" homeP="${r.homeStartingPitcher}" venue="${r.venue}" mlbPk=${r.mlbGamePk} modelRunAt=${r.modelRunAt}`
      )
    );
  }

  // Distinct dates summary
  console.log("\n[STEP 3] Distinct MLB game dates in DB (most recent 10):");
  const allGames = await db
    .select({ gameDate: schema.games.gameDate })
    .from(schema.games)
    .where(eq(schema.games.sport, "mlb"))
    .orderBy(desc(schema.games.gameDate))
    .limit(500);

  const dateCounts: Record<string, number> = {};
  allGames.forEach((r) => {
    dateCounts[r.gameDate!] = (dateCounts[r.gameDate!] || 0) + 1;
  });
  Object.entries(dateCounts)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 10)
    .forEach(([date, total]) => console.log(`  date=${date} total=${total}`));

  await connection.end();
  console.log("\n[OUTPUT] Done.");
}

main().catch((e) => {
  console.error("[VERIFY] FAIL:", e);
  process.exit(1);
});
