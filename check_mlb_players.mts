import { getDb } from "./server/db.js";
import { mlbPlayers } from "./drizzle/schema.js";
import { isNotNull, count, like, or } from "drizzle-orm";

const db = await getDb();
const total = await db.select({ c: count() }).from(mlbPlayers);
const withId = await db.select({ c: count() }).from(mlbPlayers).where(isNotNull(mlbPlayers.mlbamId));

console.log("[CHECK] Total mlb_players:", total[0].c);
console.log("[CHECK] With mlbamId:", withId[0].c);

// Sample a few
const sample = await db.select({ name: mlbPlayers.name, mlbamId: mlbPlayers.mlbamId })
  .from(mlbPlayers).where(isNotNull(mlbPlayers.mlbamId)).limit(5);
console.log("[CHECK] Sample:", JSON.stringify(sample));

// Check for key players from today's slate
const testNames = ["Aaron Judge", "Corbin Carroll", "Jose Ramirez", "Matt Olson", "Juan Soto"];
for (const name of testNames) {
  const rows = await db.select({ name: mlbPlayers.name, mlbamId: mlbPlayers.mlbamId })
    .from(mlbPlayers)
    .where(like(mlbPlayers.name, `%${name}%`))
    .limit(1);
  console.log(`[CHECK] "${name}":`, rows[0] ? `mlbamId=${rows[0].mlbamId}` : "NOT FOUND");
}

process.exit(0);
