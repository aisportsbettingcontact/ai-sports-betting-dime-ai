/**
 * One-shot Rotowire scraper for today's MLB lineups.
 * Outputs clean JSON to stdout. All logs go to stderr.
 * Usage: npx tsx server/scrapeRotoToday.ts > output.json
 */
import { scrapeRotowireLineupsToday } from "./rotowireLineupScraper.js";

// Redirect all console.log to stderr so stdout is clean JSON
const origLog = console.log;
console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

async function main() {
  const result = await scrapeRotowireLineupsToday();

  const output = {
    cardsFound: result.cardsFound,
    cardsParsed: result.cardsParsed,
    scrapedAt: result.scrapedAt,
    games: result.games.map((g) => ({
      awayAbbrev: g.awayAbbrev,
      homeAbbrev: g.homeAbbrev,
      startTime: g.startTime,
      umpire: g.umpire,
      weather: g.weather,
      awayPitcher: g.awayPitcher
        ? {
            name: g.awayPitcher.name,
            hand: g.awayPitcher.hand,
            era: g.awayPitcher.era,
            rotowireId: g.awayPitcher.rotowireId,
            confirmed: g.awayPitcher.confirmed,
          }
        : null,
      homePitcher: g.homePitcher
        ? {
            name: g.homePitcher.name,
            hand: g.homePitcher.hand,
            era: g.homePitcher.era,
            rotowireId: g.homePitcher.rotowireId,
            confirmed: g.homePitcher.confirmed,
          }
        : null,
      awayLineupConfirmed: g.awayLineupConfirmed,
      homeLineupConfirmed: g.homeLineupConfirmed,
      awayLineup: g.awayLineup,
      homeLineup: g.homeLineup,
    })),
  };

  // Restore console.log and write JSON to stdout
  console.log = origLog;
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
