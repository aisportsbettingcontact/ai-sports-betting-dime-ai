/**
 * audit_may29_rl.ts
 * Full post-run audit: all 15 May 29 games, RL/ML invariant validation.
 */
import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const TAG = "[AUDIT-MAY29]";
const DATE = "2026-05-29";

function mlToProb(ml: number): number {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

async function main() {
  const dbConn = await getDb();
  const rows = await dbConn
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      startTimeEst: games.startTimeEst,
      modelAwayML: games.modelAwayML,
      modelHomeML: games.modelHomeML,
      awayModelSpread: games.awayModelSpread,
      homeModelSpread: games.homeModelSpread,
      modelAwaySpreadOdds: games.modelAwaySpreadOdds,
      modelHomeSpreadOdds: games.modelHomeSpreadOdds,
      modelAwayScore: games.modelAwayScore,
      modelHomeScore: games.modelHomeScore,
      publishedToFeed: games.publishedToFeed,
      publishedModel: games.publishedModel,
      modelRunAt: games.modelRunAt,
    })
    .from(games)
    .where(and(eq(games.gameDate, DATE), eq(games.sport, "MLB")))
    .orderBy(games.startTimeEst);

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} May 29, 2026 MLB — Full RL/ML Invariant Audit`);
  console.log(`${TAG} Games in DB: ${rows.length}/15`);
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  let violations = 0;
  let nullOdds = 0;
  let modeled = 0;
  let published = 0;

  for (const g of rows) {
    const hasModel = g.modelRunAt !== null;
    if (hasModel) modeled++;
    if (g.publishedToFeed) published++;

    const awaySpread = parseFloat(g.awayModelSpread ?? "0");
    const homeSpread = parseFloat(g.homeModelSpread ?? "0");

    // Determine fav (-1.5 side)
    const favIsAway = awaySpread < 0;
    const favTeam = favIsAway ? g.awayTeam : g.homeTeam;
    const favML = favIsAway ? g.modelAwayML : g.modelHomeML;
    const favRLOdds = favIsAway ? g.modelAwaySpreadOdds : g.modelHomeSpreadOdds;
    const dogTeam = favIsAway ? g.homeTeam : g.awayTeam;
    const dogML = favIsAway ? g.modelHomeML : g.modelAwayML;
    const dogRLOdds = favIsAway ? g.modelHomeSpreadOdds : g.modelAwaySpreadOdds;

    if (!favML || !favRLOdds || !dogML || !dogRLOdds) {
      nullOdds++;
      console.log(`${TAG} ⚠️  [${g.id}] ${g.awayTeam}@${g.homeTeam} — NULL odds (model not run)`);
      continue;
    }

    const pFavWin = mlToProb(favML);
    const pFavCover = mlToProb(favRLOdds);
    const invariantOk = pFavCover < pFavWin;

    // RL odds for -1.5 side must be LESS negative than ML (harder to cover than to win)
    const rlLessNegativeThanML = favML >= 0 || favRLOdds > favML;

    const gameOk = invariantOk && rlLessNegativeThanML;
    const status = gameOk ? "✅" : "❌";
    if (!gameOk) violations++;

    console.log(`${TAG} ${status} [${g.id}] ${g.awayTeam}@${g.homeTeam} | ${g.startTimeEst}`);
    const awayScore = g.modelAwayScore != null ? Number(g.modelAwayScore).toFixed(2) : "null";
    const homeScore = g.modelHomeScore != null ? Number(g.modelHomeScore).toFixed(2) : "null";
    console.log(`${TAG}    [STATE] Proj:  ${g.awayTeam}=${awayScore} | ${g.homeTeam}=${homeScore}`);
    console.log(`${TAG}    [STATE] ML:    ${g.awayTeam}=${g.modelAwayML} | ${g.homeTeam}=${g.modelHomeML}`);
    console.log(`${TAG}    [STATE] RL:    ${g.awayTeam} ${g.awayModelSpread}(${g.modelAwaySpreadOdds}) | ${g.homeTeam} ${g.homeModelSpread}(${g.modelHomeSpreadOdds})`);
    console.log(`${TAG}    [STATE] Fav:   ${favTeam} ML=${favML} RL-1.5=${favRLOdds} | Dog: ${dogTeam} ML=${dogML} RL+1.5=${dogRLOdds}`);
    console.log(`${TAG}    [STATE] Pub:   feed=${g.publishedToFeed ? "✅" : "❌"} model=${g.publishedModel ? "✅" : "❌"} modelRunAt=${hasModel ? "SET" : "NULL"}`);

    if (invariantOk) {
      console.log(`${TAG}    [VERIFY] ✅ P(${favTeam} wins)=${pFavWin.toFixed(4)} > P(${favTeam} covers -1.5)=${pFavCover.toFixed(4)} — INVARIANT HOLDS`);
    } else {
      console.error(`${TAG}    [VERIFY] ❌ P(${favTeam} covers -1.5)=${pFavCover.toFixed(4)} >= P(${favTeam} wins)=${pFavWin.toFixed(4)} — INVARIANT VIOLATED`);
    }
    if (!rlLessNegativeThanML) {
      console.error(`${TAG}    [VERIFY] ❌ RL odds ${favRLOdds} more negative than ML ${favML} — IMPOSSIBLE`);
    }
    console.log(`${TAG}    ${"─".repeat(70)}`);
  }

  console.log(`\n${TAG} ════════════════════════════════════════════════════════════`);
  console.log(`${TAG} [OUTPUT] Games in DB:       ${rows.length}/15`);
  console.log(`${TAG} [OUTPUT] Modeled:           ${modeled}/15`);
  console.log(`${TAG} [OUTPUT] Published:         ${published}/15`);
  console.log(`${TAG} [OUTPUT] RL violations:     ${violations}`);
  console.log(`${TAG} [OUTPUT] Null odds:         ${nullOdds}`);

  if (violations === 0 && nullOdds === 0 && modeled === 15) {
    console.log(`${TAG} [VERIFY] ✅ FULL AUDIT PASSED — all 15 games correct`);
  } else {
    console.error(`${TAG} [VERIFY] ❌ AUDIT FAILED — violations=${violations} nullOdds=${nullOdds} modeled=${modeled}`);
  }
  console.log(`${TAG} ════════════════════════════════════════════════════════════\n`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
