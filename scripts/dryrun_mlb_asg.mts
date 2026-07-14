/**
 * dryrun_mlb_asg.mts — read-only preview of the MLB All-Star Game feed card.
 *
 * Runs in GitHub Actions (the sandbox has no AN egress). Scrapes Action Network
 * through the REAL scraper (fetchActionNetworkOdds), applies the owner model
 * config (server/mlbAllStarGame.ts), and prints the exact BOOK-vs-MODEL lines
 * that will publish — with the run-line + total rungs selected against the LIVE
 * book line. No database writes. This is the pre-publish relay preview.
 *
 * LOGGING: [ASG_DRYRUN]
 */
import { fetchActionNetworkOdds } from "../server/actionNetworkScraper";
import {
  MLB_ASG,
  findAsgInSlate,
  bookFromAnGame,
  computeAsgModel,
  impliedProb,
} from "../server/mlbAllStarGame";

const TAG = "[ASG_DRYRUN]";
const p = (pct: number) => (isNaN(pct) ? "?" : `${pct.toFixed(1)}%`);

async function main() {
  console.log(`${TAG} ${"=".repeat(78)}`);
  console.log(`${TAG} MLB All-Star Game — book-vs-model preview | date=${MLB_ASG.gameDate}`);
  console.log(`${TAG} ${"=".repeat(78)}`);

  const anGames = await fetchActionNetworkOdds("mlb", MLB_ASG.gameDate);
  console.log(`${TAG} AN slate: ${anGames.length} MLB game(s) for ${MLB_ASG.gameDate}`);

  const asg = findAsgInSlate(anGames);
  if (!asg) {
    console.error(`${TAG} [FAIL] ASG (anId=${MLB_ASG.anGameId}, ${MLB_ASG.awaySlug}@${MLB_ASG.homeSlug}) NOT found.`);
    process.exit(1);
  }

  // Orientation assertion — AL must be away, NL home (as verified from AN).
  const orientOk = asg.awayUrlSlug === MLB_ASG.awaySlug && asg.homeUrlSlug === MLB_ASG.homeSlug;
  console.log(
    `${TAG} anId=${asg.gameId} | ${asg.awayAbbr}/${asg.awayUrlSlug} @ ${asg.homeAbbr}/${asg.homeUrlSlug} | ` +
    `orientation ${orientOk ? "OK (AL away / NL home)" : "MISMATCH ⚠️"} | start=${asg.startTime}`,
  );
  if (!orientOk) {
    console.error(`${TAG} [FAIL] orientation mismatch — refusing preview.`);
    process.exit(1);
  }

  const book = bookFromAnGame(asg);
  const model = computeAsgModel(book);

  console.log(`${TAG} book source: ${book.source.toUpperCase()}`);
  console.log(`${TAG} rung selection: run line → ${model.runLineRung} (book away spread ${book.awaySpread}); total → ${model.totalRung} (book total ${book.total})`);
  console.log(`${TAG}`);
  console.log(`${TAG}  MARKET      │ SIDE        │ BOOK              │ MODEL`);
  console.log(`${TAG}  ────────────┼─────────────┼───────────────────┼──────────────────────`);
  console.log(`${TAG}  Moneyline   │ AL (away)   │ ${(book.awayML ?? "-").padEnd(17)} │ ${model.modelAwayML} (${p(impliedProb(model.modelAwayML))})`);
  console.log(`${TAG}              │ NL (home)   │ ${(book.homeML ?? "-").padEnd(17)} │ ${model.modelHomeML} (${p(impliedProb(model.modelHomeML))})`);
  console.log(`${TAG}  Run Line    │ AL ${(book.awaySpread ?? "?").padEnd(8)}│ ${(book.awaySpreadOdds ?? "-").padEnd(17)} │ ${model.modelAwaySpreadOdds} (${p(impliedProb(model.modelAwaySpreadOdds))} cover)`);
  console.log(`${TAG}              │ NL ${(book.homeSpread ?? "?").padEnd(8)}│ ${(book.homeSpreadOdds ?? "-").padEnd(17)} │ ${model.modelHomeSpreadOdds} (${p(impliedProb(model.modelHomeSpreadOdds))} cover)`);
  console.log(`${TAG}  Total       │ O ${(book.total ?? "?").padEnd(9)}│ ${(book.overOdds ?? "-").padEnd(17)} │ ${model.modelOverOdds} (${p(impliedProb(model.modelOverOdds))})`);
  console.log(`${TAG}              │ U ${(book.total ?? "?").padEnd(9)}│ ${(book.underOdds ?? "-").padEnd(17)} │ ${model.modelUnderOdds} (${p(impliedProb(model.modelUnderOdds))})`);
  console.log(`${TAG}`);
  console.log(`${TAG} FULL MODEL ROW (as it will be written): ${JSON.stringify(model)}`);
  console.log(`${TAG} FULL BOOK ROW: ${JSON.stringify(book)}`);
  console.log(`${TAG} ${"=".repeat(78)}`);
  console.log(`${TAG} DONE (read-only; nothing written).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} [FATAL] ${err?.stack ?? err}`);
  process.exit(1);
});
