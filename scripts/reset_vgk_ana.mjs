/**
 * reset_vgk_ana.mjs
 * Queries the VGK @ ANA game and resets its model fields so nhlModelSync re-runs it
 * with the new playoff_mode=true logic.
 */
import { createConnection } from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[RESET] ERROR: DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(url);

// Step 1: Find the VGK @ ANA game
const [rows] = await conn.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, awayML, homeML, awayBookSpread, bookTotal,
          modelAwayML, modelHomeML, modelAwayPLOdds, modelHomePLOdds, modelOverOdds, modelUnderOdds
   FROM games WHERE sport = 'NHL' AND gameDate >= '2026-05-14' ORDER BY gameDate ASC LIMIT 20`
);

console.log(`[RESET] Found ${rows.length} NHL games from 2026-05-14:`);
for (const r of rows) {
  console.log(`  [${r.id}] ${r.awayTeam} @ ${r.homeTeam} on ${r.gameDate} | ML=${r.awayML}/${r.homeML} | modelML=${r.modelAwayML}/${r.modelHomeML} | modelPL=${r.modelAwayPLOdds}/${r.modelHomePLOdds}`);
}

// Step 2: Find VGK @ ANA specifically
const vgkAna = rows.find(r =>
  (r.awayTeam?.includes("vegas") || r.awayTeam?.includes("golden") || r.awayTeam?.includes("vgk")) &&
  (r.homeTeam?.includes("anaheim") || r.homeTeam?.includes("ducks") || r.homeTeam?.includes("ana"))
);

if (!vgkAna) {
  console.log("[RESET] VGK @ ANA game not found in DB. Listing all NHL games:");
  for (const r of rows) console.log(`  ${r.awayTeam} @ ${r.homeTeam}`);
  await conn.end();
  process.exit(0);
}

console.log(`\n[RESET] Found VGK @ ANA: id=${vgkAna.id} modelAwayPLOdds=${vgkAna.modelAwayPLOdds} modelHomePLOdds=${vgkAna.modelHomePLOdds}`);

// Step 3: Check if model odds are broken (absolute value > 1000 = overflow)
const awayPL = parseInt(vgkAna.modelAwayPLOdds ?? "0", 10);
const homePL = parseInt(vgkAna.modelHomePLOdds ?? "0", 10);
const overOdds = parseInt(vgkAna.modelOverOdds ?? "0", 10);
const underOdds = parseInt(vgkAna.modelUnderOdds ?? "0", 10);

const isBroken = Math.abs(awayPL) > 1000 || Math.abs(homePL) > 1000 ||
                 Math.abs(overOdds) > 1000 || Math.abs(underOdds) > 1000;

console.log(`[RESET] Model odds: awayPL=${awayPL} homePL=${homePL} over=${overOdds} under=${underOdds}`);
console.log(`[RESET] Model is ${isBroken ? 'BROKEN (overflow detected)' : 'OK'}`);

// Step 4: Reset all NHL model fields to NULL so nhlModelSync re-runs it
// Only reset columns that exist in the games table (NHL model columns)
const [result] = await conn.execute(
  `UPDATE games SET
    modelAwayML = NULL, modelHomeML = NULL,
    modelAwayPLOdds = NULL, modelHomePLOdds = NULL,
    modelOverOdds = NULL, modelUnderOdds = NULL,
    modelAwayScore = NULL, modelHomeScore = NULL,
    modelAwayWinPct = NULL, modelHomeWinPct = NULL,
    modelAwayPLCoverPct = NULL, modelHomePLCoverPct = NULL,
    modelAwayPuckLine = NULL, modelHomePuckLine = NULL,
    modelAwaySpreadOdds = NULL, modelHomeSpreadOdds = NULL,
    modelTotal = NULL, modelOverRate = NULL, modelUnderRate = NULL,
    modelSpreadClamped = NULL, modelTotalClamped = NULL,
    modelCoverDirection = NULL, modelRunAt = NULL
   WHERE id = ?`,
  [vgkAna.id]
);

console.log(`[RESET] ✅ Reset ${result.affectedRows} row(s) for game id=${vgkAna.id} (VGK @ ANA)`);
console.log("[RESET] The next nhlModelSync run will re-model this game with playoff_mode=true");

await conn.end();
