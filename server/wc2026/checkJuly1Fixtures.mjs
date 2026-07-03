import { getDb } from "../db.js";
import { wc2026Matches, wc2026ModelProjections, wc2026FrozenBookOdds } from "../../drizzle/wc2026.schema.js";
import { sql, inArray } from "drizzle-orm";

const db = await getDb();

// Check match_date for July 1 matchs
const fxRows = await db.select({
  matchId: wc2026Matches.matchId,
  matchDate: wc2026Matches.matchDate,
  kickoffUtc: wc2026Matches.kickoffUtc,
  homeTeamId: wc2026Matches.homeTeamId,
  awayTeamId: wc2026Matches.awayTeamId,
}).from(wc2026Matches).where(
  sql`match_date LIKE '2026-07-01%' OR match_id IN ('wc26-r32-080','wc26-r32-081','wc26-r32-082')`
);
console.log("\n[MATCHS]", JSON.stringify(fxRows, null, 2));

// Check model projections
const mpRows = await db.select().from(wc2026ModelProjections).where(
  inArray(wc2026ModelProjections.matchId, ['wc26-r32-080','wc26-r32-081','wc26-r32-082'])
);
console.log("\n[MODEL PROJECTIONS] count=", mpRows.length);
for (const r of mpRows) {
  console.log(`  ${r.matchId}: home=${r.homeTeam} away=${r.awayTeam} | modelHomeML=${r.modelHomeML} modelDrawML=${r.modelDrawML} modelAwayML=${r.modelAwayML} | toAdvH=${r.toAdvanceHomeOdds} toAdvA=${r.toAdvanceAwayOdds} | isFrozen=${r.isFrozen}`);
}

// Check frozen book odds
const boRows = await db.select().from(wc2026FrozenBookOdds).where(
  inArray(wc2026FrozenBookOdds.matchId, ['wc26-r32-080','wc26-r32-081','wc26-r32-082'])
);
console.log("\n[FROZEN BOOK ODDS] count=", boRows.length);
for (const r of boRows) {
  console.log(`  ${r.matchId}: bookHomeMl=${r.bookHomeMl} bookDrawMl=${r.bookDrawMl} bookAwayMl=${r.bookAwayMl} | spread=${r.bookSpreadLine} H${r.bookHomeSpreadOdds}/A${r.bookAwaySpreadOdds} | total=${r.bookTotalLine} O${r.bookOverOdds}/U${r.bookUnderOdds} | toAdvH=${r.toAdvanceHomeOdds}/A${r.toAdvanceAwayOdds}`);
}

process.exit(0);
