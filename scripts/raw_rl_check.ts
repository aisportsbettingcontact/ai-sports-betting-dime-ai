import { getDb } from "../server/db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

function mlToProb(ml: number): number {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

async function main() {
  const db = await getDb();
  const rows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      modelAwayML: games.modelAwayML,
      modelHomeML: games.modelHomeML,
      awayModelSpread: games.awayModelSpread,
      modelAwaySpreadOdds: games.modelAwaySpreadOdds,
      homeModelSpread: games.homeModelSpread,
      modelHomeSpreadOdds: games.modelHomeSpreadOdds,
    })
    .from(games)
    .where(and(eq(games.gameDate, "2026-05-29"), eq(games.sport, "MLB")))
    .orderBy(games.startTimeEst);

  for (const r of rows) {
    const awaySpread = parseFloat(r.awayModelSpread ?? "0");
    const homeSpread = parseFloat(r.homeModelSpread ?? "0");
    const favIsAway = awaySpread < 0;
    const favML = favIsAway ? r.modelAwayML : r.modelHomeML;
    const favRLOdds = favIsAway ? r.modelAwaySpreadOdds : r.modelHomeSpreadOdds;

    console.log(`[${r.id}] ${r.awayTeam}@${r.homeTeam}`);
    console.log(`  ML raw: away=${r.modelAwayML} (${typeof r.modelAwayML}) | home=${r.modelHomeML} (${typeof r.modelHomeML})`);
    console.log(`  RL raw: away=${r.awayModelSpread}(${r.modelAwaySpreadOdds} ${typeof r.modelAwaySpreadOdds}) | home=${r.homeModelSpread}(${r.modelHomeSpreadOdds} ${typeof r.modelHomeSpreadOdds})`);
    if (favML != null && favRLOdds != null) {
      const pWin = mlToProb(Number(favML));
      const pCover = mlToProb(Number(favRLOdds));
      const favTeam = favIsAway ? r.awayTeam : r.homeTeam;
      console.log(`  Fav: ${favTeam} ML=${favML} -> P(win)=${pWin.toFixed(4)} | RL-1.5=${favRLOdds} -> P(cover)=${pCover.toFixed(4)}`);
      const ok = pCover < pWin;
      console.log(`  Invariant: ${ok ? "✅ PASS" : "❌ FAIL"} P(cover)=${pCover.toFixed(4)} ${ok ? "<" : ">="} P(win)=${pWin.toFixed(4)}`);
    }
    console.log();
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
