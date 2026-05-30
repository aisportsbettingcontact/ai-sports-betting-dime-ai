import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  try {
    const db = await getDb();
    console.log("[DEBUG] DB connected");
    const rows = await db
      .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam })
      .from(games)
      .where(and(eq(games.gameDate, "2026-05-30"), eq(games.sport, "MLB")))
      .limit(3);
    console.log("[DEBUG] Row count:", rows.length);
    if (rows.length > 0) console.log("[DEBUG] Sample:", JSON.stringify(rows[0]));
    else console.log("[DEBUG] NO MAY 30 GAMES IN DB");
  } catch(e: any) {
    console.error("[ERROR]", e.message);
    console.error(e.stack);
  }
  process.exit(0);
}
main();
