import { scrapeAndIngest } from "./espnDbIngester.ts";
import { getDb } from "../db.ts";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

const GAME_ID = "760508";
const RESULT_FILE = "/tmp/espn_ingest_result_760508.json";
const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  console.log("[RUNNER] ════════════════════════════════════════════════════════════");
  console.log("[RUNNER]   ESPN WC2026 INGEST RUNNER — gameId=" + GAME_ID);
  console.log("[RUNNER]   MODE: " + (DRY_RUN ? "DRY-RUN (no writes)" : "PRODUCTION WRITE"));
  console.log("[RUNNER] ════════════════════════════════════════════════════════════");

  const ingestResult = await scrapeAndIngest(GAME_ID, { dryRun: DRY_RUN });
  console.log("[RUNNER] Ingest complete — success=" + ingestResult.success + " | rows=" + ingestResult.totalRowsWritten + " | errors=" + ingestResult.errors.length);

  // Save result JSON
  writeFileSync(RESULT_FILE, JSON.stringify(ingestResult, null, 2));
  console.log("[RUNNER] Result saved to " + RESULT_FILE);

  if (!DRY_RUN) {
    // DB row counts post-write
    const db = await getDb();
    const tables = [
      "wc2026_espn_matches",
      "wc2026_espn_team_stats",
      "wc2026_espn_match_stats",
      "wc2026_espn_expected_goals",
      "wc2026_espn_shot_map",
      "wc2026_espn_player_stats",
      "wc2026_espn_lineups",
      "wc2026_espn_glossary",
    ];

    console.log("\n[RUNNER] ═══ POST-WRITE ROW COUNTS ═══");
    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      const isGlossary = table === "wc2026_espn_glossary";
      const query = isGlossary
        ? sql.raw(`SELECT COUNT(*) as cnt FROM ${table}`)
        : sql.raw(`SELECT COUNT(*) as cnt FROM ${table} WHERE espn_match_id = '${GAME_ID}'`);
      const [rows] = await db.execute(query);
      rowCounts[table] = Number((rows as any)[0]?.cnt ?? 0);
      console.log("[RUNNER] Table " + table + " → " + rowCounts[table] + " rows (match-scoped)");
    }

    // Total counts across all matches
    console.log("\n[RUNNER] ═══ TOTAL ROW COUNTS (ALL MATCHES) ═══");
    for (const table of tables) {
      const [rows] = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ${table}`));
      console.log("[RUNNER] Table " + table + " → " + Number((rows as any)[0]?.cnt ?? 0) + " total rows");
    }
  }

  process.exit(0);
}

run().catch((err) => {
  console.error("[RUNNER] FATAL:", err);
  process.exit(1);
});
