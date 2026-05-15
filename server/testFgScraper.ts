/**
 * testFgScraper.ts
 * Quick end-to-end test for the fangraphsScraper module.
 * Run: npx tsx server/testFgScraper.ts
 */
import { scrapeFangraphsDate, getPstDate } from "./fangraphsScraper";

async function main() {
  const todayDate = getPstDate(0);
  console.log(`[TEST] Testing date: ${todayDate}`);

  const result = await scrapeFangraphsDate(todayDate);

  console.log(`[TEST] Games found: ${result.games.length}`);
  console.log(`[TEST] Elapsed: ${result.elapsedMs}ms`);

  if (result.games.length === 0) {
    console.log("[TEST] No games found");
    return;
  }

  const g = result.games[0];
  console.log(`[TEST] First game: ${g.away.teamName} @ ${g.home.teamName}`);
  console.log(`[TEST] Game time (UTC): ${g.gameTimeUtc}`);
  console.log(`[TEST] Away pitcher: ${g.away.pitcher?.name ?? "TBD"} ${g.away.pitcher?.throws ?? ""} ${g.away.pitcher?.wins}-${g.away.pitcher?.losses} ${g.away.pitcher?.era} ERA`);
  console.log(`[TEST] Home pitcher: ${g.home.pitcher?.name ?? "TBD"} ${g.home.pitcher?.throws ?? ""} ${g.home.pitcher?.wins}-${g.home.pitcher?.losses} ${g.home.pitcher?.era} ERA`);
  console.log(`[TEST] Away lineup (${g.away.lineupStatus}):`);
  for (const b of g.away.lineup) {
    console.log(`  ${b.order}. ${b.name} (${b.bats}) ${b.position}`);
  }
  console.log(`[TEST] Home lineup (${g.home.lineupStatus}):`);
  for (const b of g.home.lineup) {
    console.log(`  ${b.order}. ${b.name} (${b.bats}) ${b.position}`);
  }

  console.log("\n[TEST] All games summary:");
  for (const game of result.games) {
    const awayPitcher = game.away.pitcher?.name ?? "TBD";
    const homePitcher = game.home.pitcher?.name ?? "TBD";
    console.log(`  ${game.away.teamAbbr} @ ${game.home.teamAbbr} | ${game.gameTimeUtc} | ${awayPitcher} vs ${homePitcher} | away=${game.away.lineup.length} home=${game.home.lineup.length}`);
  }
}

main().catch((err) => {
  console.error("[TEST] FATAL:", err);
  process.exit(1);
});
