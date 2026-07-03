/**
 * seedWcJune23Scores.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot script: runs the ESPN ingester for June 23, 2026 with
 * onlyFinalMatches=false and forceReingest=true to seed all 3 final scores:
 *   - Portugal 5-0 Uzbekistan (FT)
 *   - England 0-0 Ghana (FT / DRAW)
 *   - Croatia 1-0 Panama (FT)
 *
 * [INPUT]  dateStr=20260623 onlyFinalMatches=false forceReingest=true
 * [OUTPUT] DB updated: homeScore, awayScore, status=FT for all 3 matches
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Load environment variables
const dotenv = await import("dotenv");
dotenv.config({ path: path.join(projectRoot, ".env") });

console.log("[SEED] [INPUT] Starting WC June 23 score seed");
console.log("[SEED] [INPUT] dateStr=20260623 onlyFinalMatches=false forceReingest=true");

// Dynamic import of the ingester (TypeScript compiled via tsx)
const { ingestWc2026EspnResults } = await import(
  pathToFileURL(path.join(projectRoot, "server/wc2026/wc2026EspnResultsIngester.ts")).href
);

const result = await ingestWc2026EspnResults({
  dateStr: "20260623",
  onlyFinalMatches: false,
  forceReingest: true,
});

console.log("[SEED] [OUTPUT] Ingestion complete:");
console.log(`  matchesUpdated: ${result.matchesUpdated}`);
console.log(`  statsWritten: ${result.statsWritten}`);
console.log(`  eventsWritten: ${result.eventsWritten}`);
console.log(`  lineupsWritten: ${result.lineupsWritten}`);
console.log(`  errors: ${result.errors.length}`);

if (result.matchSummaries.length > 0) {
  console.log("[SEED] [OUTPUT] Match summaries:");
  for (const s of result.matchSummaries) {
    console.log(`  ${s.matchId}: ${s.homeTeam} ${s.score} ${s.awayTeam} — status=${s.status}`);
  }
}

if (result.errors.length > 0) {
  console.log("[SEED] [VERIFY] FAIL — Errors:");
  for (const e of result.errors) {
    console.log(`  ERROR: ${e}`);
  }
  process.exit(1);
} else {
  console.log("[SEED] [VERIFY] PASS — All June 23 scores seeded successfully ✅");
  process.exit(0);
}
