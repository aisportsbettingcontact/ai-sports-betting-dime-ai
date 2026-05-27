import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL as string);
  const db = drizzle(connection, { schema, mode: "default" });

  console.log("[STEP] Querying May 27, 2026 MLB games with sport='MLB' (uppercase)...");

  // First find what dates exist for MLB
  const allMlb = await db
    .select({ gameDate: schema.games.gameDate, awayTeam: schema.games.awayTeam, homeTeam: schema.games.homeTeam })
    .from(schema.games)
    .where(eq(schema.games.sport, "MLB"))
    .orderBy(schema.games.gameDate)
    .limit(5);

  if (allMlb.length === 0) {
    console.log("[STATE] No MLB games found at all in DB with sport='MLB'");
  } else {
    console.log("[STATE] Sample MLB games (first 5):");
    allMlb.forEach(g => console.log(`  date=${g.gameDate} ${g.awayTeam}@${g.homeTeam}`));
  }

  // Now check the actual date format used
  const latestMlb = await db
    .select({ gameDate: schema.games.gameDate })
    .from(schema.games)
    .where(eq(schema.games.sport, "MLB"))
    .orderBy(schema.games.gameDate)
    .limit(1);

  if (latestMlb.length > 0) {
    console.log(`\n[STATE] Sample gameDate value: "${latestMlb[0].gameDate}"`);
  }

  // Try both date formats for May 27
  const formats = ["20260527", "2026-05-27", "05/27/2026"];
  for (const fmt of formats) {
    const rows = await db
      .select({ id: schema.games.id, awayTeam: schema.games.awayTeam, homeTeam: schema.games.homeTeam, modelAwayML: schema.games.modelAwayML })
      .from(schema.games)
      .where(and(eq(schema.games.sport, "MLB"), eq(schema.games.gameDate, fmt)));
    if (rows.length > 0) {
      console.log(`\n[OUTPUT] Found ${rows.length} games with gameDate='${fmt}':`);
      rows.forEach(g => console.log(`  id=${g.id} ${g.awayTeam}@${g.homeTeam} modelAwayML=${g.modelAwayML}`));
      break;
    } else {
      console.log(`[STATE] No games with gameDate='${fmt}'`);
    }
  }

  await connection.end();
  console.log("\n[OUTPUT] Done.");
}

main().catch((e) => {
  console.error("[VERIFY] FAIL:", e.message);
  process.exit(1);
});
