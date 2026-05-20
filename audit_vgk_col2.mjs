import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const db = await createConnection(process.env.DATABASE_URL);

  console.log("=".repeat(80));
  console.log("[AUDIT] VGK@COL NHL Game — May 20, 2026");
  console.log("=".repeat(80));

  // Step 0: Get exact column names
  const [cols] = await db.query("SHOW COLUMNS FROM games");
  const allFields = cols.map(c => c.Field);
  console.log("\n[STEP 0] games table columns:");
  console.log(allFields.join(", "));

  // Step 1: Find NHL games for May 20
  console.log("\n[STEP 1] Locate NHL games for 2026-05-20");
  const [games] = await db.query(
    "SELECT * FROM games WHERE gameDate = '2026-05-20' AND sport = 'NHL'"
  );

  if (!games.length) {
    console.log("[OUTPUT] ❌ NO NHL games found for May 20, 2026");
    await db.end();
    return;
  }

  console.log(`[OUTPUT] Found ${games.length} NHL game(s)`);
  for (const g of games) {
    console.log("\n" + "─".repeat(60));
    // Print every column
    for (const [k, v] of Object.entries(g)) {
      if (v !== null && v !== undefined && v !== 0 && v !== "") {
        console.log(`  ${k}: ${v}`);
      } else {
        console.log(`  ${k}: ${v === null ? 'NULL' : v}`);
      }
    }
  }

  // Step 2: nhl_goalie_assignments
  console.log("\n[STEP 2] nhl_goalie_assignments for 2026-05-20");
  try {
    const [ga] = await db.query(
      "SELECT * FROM nhl_goalie_assignments WHERE gameDate = '2026-05-20'"
    );
    if (!ga.length) {
      console.log("[OUTPUT] ❌ No rows in nhl_goalie_assignments for 2026-05-20");
    } else {
      for (const r of ga) {
        console.log(`  ${JSON.stringify(r)}`);
      }
    }
  } catch (e) {
    console.log(`[OUTPUT] ⚠ nhl_goalie_assignments error: ${e.message}`);
  }

  // Step 3: nhl_team_stats
  console.log("\n[STEP 3] nhl_team_stats — all teams (check VGK/COL abbrevs)");
  try {
    const [ts] = await db.query(
      "SELECT teamAbbr, gamesPlayed, goalsFor, goalsAgainst, updatedAt FROM nhl_team_stats ORDER BY teamAbbr"
    );
    for (const t of ts) {
      console.log(`  [${t.teamAbbr}] GP=${t.gamesPlayed} GF=${t.goalsFor} GA=${t.goalsAgainst} updated=${t.updatedAt}`);
    }
  } catch (e) {
    console.log(`[OUTPUT] ⚠ nhl_team_stats error: ${e.message}`);
  }

  // Step 4: nhl_goalie_stats
  console.log("\n[STEP 4] nhl_goalie_stats — top goalies by team");
  try {
    const [gs] = await db.query(
      "SELECT goalieName, team, gamesStarted, savePercentage, goalsAgainstAverage, updatedAt FROM nhl_goalie_stats ORDER BY gamesStarted DESC LIMIT 20"
    );
    for (const g of gs) {
      console.log(`  [${g.team}] ${g.goalieName}: GS=${g.gamesStarted} SV%=${g.savePercentage} GAA=${g.goalsAgainstAverage}`);
    }
  } catch (e) {
    console.log(`[OUTPUT] ⚠ nhl_goalie_stats error: ${e.message}`);
  }

  await db.end();
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
