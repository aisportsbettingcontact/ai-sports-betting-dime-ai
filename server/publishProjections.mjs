/**
 * publishProjections.mjs
 * Writes April 22, 2026 model projections to the DB and sets publishedModel=true.
 * Sources: mlb_model_v3.json + nhl_model_v3.json (from run_model_v3.py)
 *
 * DB game IDs confirmed from live query:
 * MLB: 2250336-2250349, 2252640
 * NHL: 3150009, 3150010, 3150011
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";

// ─── Load model results ───────────────────────────────────────────────────────
const mlbResults = JSON.parse(readFileSync("/tmp/mlb_model_v3.json", "utf8"));
const nhlResults = JSON.parse(readFileSync("/tmp/nhl_model_v3.json", "utf8"));

// ─── DB game ID map (from live query) ────────────────────────────────────────
const MLB_GAME_IDS = {
  "STL@MIA": 2250336,
  "HOU@CLE": 2250337,
  "CIN@TB": 2250338,
  "BAL@KC": 2250339,
  "TOR@LAA": 2250340,
  "ATH@SEA": 2250341,
  "MIL@DET": 2250342,
  "ATL@WSH": 2250343,
  "NYY@BOS": 2250344,
  "MIN@NYM": 2250345,
  "PHI@CHC": 2250346,
  "PIT@TEX": 2250347,
  "SD@COL": 2250348,
  "CWS@ARI": 2252640,
  "LAD@SF": 2250349,
};

const NHL_GAME_IDS = {
  "PIT@PHI": 3150009, // pittsburgh_penguins @ philadelphia_flyers
  "DAL@MIN": 3150010, // dallas_stars @ minnesota_wild
  "ANA@EDM": 3150011, // anaheim_ducks @ edmonton_oilers
};

// ─── Connect to DB ────────────────────────────────────────────────────────────
const dbUrl = new URL(process.env.DATABASE_URL.replace("mysql://", "http://"));
const pool = mysql.createPool({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port) || 4000,
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
  connectTimeout: 8000,
  waitForConnections: true,
  connectionLimit: 3,
});

async function main() {
  console.log(
    "[INPUT] MLB games:",
    mlbResults.length,
    "| NHL games:",
    nhlResults.length
  );
  console.log("[STEP] Connecting to TiDB...");

  const conn = await pool.getConnection();
  console.log("[STATE] Connected to TiDB successfully");

  let mlbUpdated = 0,
    nhlUpdated = 0,
    errors = 0;

  // ─── Write MLB projections ─────────────────────────────────────────────────
  console.log("\n[STEP] Writing MLB model projections...");
  for (const g of mlbResults) {
    const key = `${g.away}@${g.home}`;
    const gameId = MLB_GAME_IDS[key];

    if (!gameId) {
      console.warn(`  [WARN] No game ID for ${key} — skipping`);
      errors++;
      continue;
    }

    // modelSpread: positive = away favored by that many runs, negative = home favored
    // Convention: awayModelSpread = model run differential (away - home)
    const runDiff = g.away_runs - g.home_runs;
    const awayModelSpread = parseFloat(runDiff.toFixed(1));
    const homeModelSpread = parseFloat((-runDiff).toFixed(1));

    // spreadDiff: model spread vs book spread
    // book awayBookSpread is the RL value (e.g., -1.5 or +1.5)
    // We compare model run diff to 0 (ML equivalent)
    const spreadDiff = parseFloat(runDiff.toFixed(1));

    // totalDiff: model total vs book total
    const totalDiff = parseFloat((g.model_total - g.book_total).toFixed(1));

    // Edge strings for display
    const awayMlEdgePct = (g.away_ml_edge * 100).toFixed(1);
    const homeMlEdgePct = (g.home_ml_edge * 100).toFixed(1);
    const totalOverEdgePct = (g.total_over_edge * 100).toFixed(1);
    const totalUnderEdgePct = (g.total_under_edge * 100).toFixed(1);

    // spreadEdge: which side has the edge (for display)
    const spreadEdge =
      runDiff > 0
        ? `${g.away} ${awayMlEdgePct}%`
        : `${g.home} ${homeMlEdgePct}%`;
    const totalEdge =
      g.total_over_edge > g.total_under_edge
        ? `O${g.book_total} ${totalOverEdgePct}%`
        : `U${g.book_total} ${totalUnderEdgePct}%`;

    try {
      const [result] = await conn.execute(
        `UPDATE games SET
          modelTotal = ?,
          awayModelSpread = ?,
          homeModelSpread = ?,
          spreadDiff = ?,
          totalDiff = ?,
          spreadEdge = ?,
          totalEdge = ?,
          publishedModel = 1,
          publishedToFeed = 1
        WHERE id = ?`,
        [
          g.model_total,
          awayModelSpread,
          homeModelSpread,
          spreadDiff,
          totalDiff,
          spreadEdge,
          totalEdge,
          gameId,
        ]
      );

      const affected = result.affectedRows;
      if (affected > 0) {
        mlbUpdated++;
        console.log(
          `  [OUTPUT] ${key} (id=${gameId}): modelTotal=${g.model_total} | awaySpread=${awayModelSpread} | totalDiff=${totalDiff > 0 ? "+" : ""}${totalDiff} | spreadEdge="${spreadEdge}" | totalEdge="${totalEdge}" ✅`
        );
      } else {
        console.warn(`  [WARN] ${key} (id=${gameId}): 0 rows affected`);
        errors++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${key} (id=${gameId}): ${err.message}`);
      errors++;
    }
  }

  // ─── Write NHL projections ─────────────────────────────────────────────────
  console.log("\n[STEP] Writing NHL model projections...");

  // Map NHL model results to game IDs
  const nhlKeyMap = {
    "PIT@PHI": null,
    "DAL@MIN": null,
    "ANA@EDM": null,
  };

  for (const g of nhlResults) {
    const away = g.away.toUpperCase();
    const home = g.home.toUpperCase();
    const key = `${away}@${home}`;
    const gameId = NHL_GAME_IDS[key];

    if (!gameId) {
      console.warn(`  [WARN] No game ID for NHL ${key} — skipping`);
      errors++;
      continue;
    }

    const goalDiff = g.away_goals - g.home_goals;
    const awayModelSpread = parseFloat(goalDiff.toFixed(1));
    const homeModelSpread = parseFloat((-goalDiff).toFixed(1));
    const totalDiff = parseFloat((g.model_total - g.book_total).toFixed(1));

    const awayMlEdgePct = (g.away_ml_edge * 100).toFixed(1);
    const homeMlEdgePct = (g.home_ml_edge * 100).toFixed(1);
    const totalOverEdgePct = (g.total_over_edge * 100).toFixed(1);
    const totalUnderEdgePct = (g.total_under_edge * 100).toFixed(1);

    const spreadEdge =
      goalDiff > 0 ? `${away} ${awayMlEdgePct}%` : `${home} ${homeMlEdgePct}%`;
    const totalEdge =
      g.total_over_edge > g.total_under_edge
        ? `O${g.book_total} ${totalOverEdgePct}%`
        : `U${g.book_total} ${totalUnderEdgePct}%`;

    try {
      const [result] = await conn.execute(
        `UPDATE games SET
          modelTotal = ?,
          awayModelSpread = ?,
          homeModelSpread = ?,
          spreadDiff = ?,
          totalDiff = ?,
          spreadEdge = ?,
          totalEdge = ?,
          publishedModel = 1,
          publishedToFeed = 1
        WHERE id = ?`,
        [
          g.model_total,
          awayModelSpread,
          homeModelSpread,
          goalDiff,
          totalDiff,
          spreadEdge,
          totalEdge,
          gameId,
        ]
      );

      const affected = result.affectedRows;
      if (affected > 0) {
        nhlUpdated++;
        console.log(
          `  [OUTPUT] ${key} (id=${gameId}): modelTotal=${g.model_total} | goalDiff=${goalDiff > 0 ? "+" : ""}${goalDiff} | totalDiff=${totalDiff > 0 ? "+" : ""}${totalDiff} | totalEdge="${totalEdge}" ✅`
        );
      } else {
        console.warn(`  [WARN] ${key} (id=${gameId}): 0 rows affected`);
        errors++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${key} (id=${gameId}): ${err.message}`);
      errors++;
    }
  }

  // ─── Verify ────────────────────────────────────────────────────────────────
  console.log("\n[STEP] Verifying published games...");
  const [verifyRows] = await conn.execute(
    `SELECT id, awayTeam, homeTeam, sport, modelTotal, totalDiff, publishedModel, publishedToFeed 
     FROM games 
     WHERE gameDate = '2026-04-22' AND sport IN ('MLB','NHL') AND publishedModel = 1
     ORDER BY sport, startTimeEst`
  );

  console.log(`[VERIFY] Published games: ${verifyRows.length}`);
  for (const r of verifyRows) {
    const diff =
      r.totalDiff !== null
        ? parseFloat(r.totalDiff) > 0
          ? `+${r.totalDiff}`
          : r.totalDiff
        : "null";
    console.log(
      `  ${r.sport} | ${r.awayTeam} @ ${r.homeTeam} | modelTotal=${r.modelTotal} | totalDiff=${diff} | published=${r.publishedToFeed}`
    );
  }

  conn.release();
  await pool.end();

  console.log(
    `\n[OUTPUT] MLB updated: ${mlbUpdated}/15 | NHL updated: ${nhlUpdated}/3 | Errors: ${errors}`
  );

  if (errors === 0) {
    console.log("[VERIFY] PASS — All 18 games published successfully ✅");
  } else {
    console.log(`[VERIFY] PARTIAL — ${errors} errors encountered ⚠️`);
  }
}

main().catch(err => {
  console.error("[CRASH]", err);
  process.exit(1);
});
