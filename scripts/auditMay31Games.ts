/**
 * auditMay31Games.ts
 * Deep audit of all May 31, 2026 MLB games in the DB.
 * Checks: book lines, pitchers, model outputs, RL sign invariant.
 */
import { getDb } from "../server/db.ts";
import { games } from "../drizzle/schema.ts";
import { like, and, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();

  const rows = await db.select({
    id:                   games.id,
    gamePk:               games.mlbGamePk,
    awayTeam:             games.awayTeam,
    homeTeam:             games.homeTeam,
    gameDate:             games.gameDate,
    awayML:               games.awayML,
    homeML:               games.homeML,
    awayRunLine:          games.awayRunLine,
    homeRunLine:          games.homeRunLine,
    awayRunLineOdds:      games.awayRunLineOdds,
    homeRunLineOdds:      games.homeRunLineOdds,
    bookTotal:            games.bookTotal,
    overOdds:             games.overOdds,
    underOdds:            games.underOdds,
    awayPitcher:          games.awayStartingPitcher,
    homePitcher:          games.homeStartingPitcher,
    awayPitcherConfirmed: games.awayPitcherConfirmed,
    homePitcherConfirmed: games.homePitcherConfirmed,
    modelTotal:           games.modelTotal,
    modelAwayScore:       games.modelAwayScore,
    modelHomeScore:       games.modelHomeScore,
    modelAwayWinPct:      games.modelAwayWinPct,
    modelHomeWinPct:      games.modelHomeWinPct,
    awayModelSpread:      games.awayModelSpread,
    homeModelSpread:      games.homeModelSpread,
    publishedModel:       games.publishedModel,
    venue:                games.venue,
    sport:                games.sport,
  }).from(games)
    .where(and(
      like(games.gameDate, "2026-05-31%"),
      eq(games.sport, "MLB")
    ));

  console.log(`\n[AuditMay31] ═══════════════════════════════════════════════════`);
  console.log(`[AuditMay31] [INPUT]  Date=2026-05-31  Sport=MLB`);
  console.log(`[AuditMay31] [STATE]  Total rows in DB: ${rows.length}`);
  console.log(`[AuditMay31] ═══════════════════════════════════════════════════\n`);

  let modeled = 0;
  let missingBookLines = 0;
  let missingPitchers = 0;
  let rlIssues = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const gameLabel = `${r.awayTeam ?? "?"} @ ${r.homeTeam ?? "?"}`;
    const hasModel = r.modelAwayScore !== null && r.modelHomeScore !== null && r.modelAwayWinPct !== null;
    const hasBook  = r.awayML !== null && r.homeML !== null && r.bookTotal !== null;
    const hasRL    = r.awayRunLine !== null && r.homeRunLine !== null &&
                     r.awayRunLineOdds !== null && r.homeRunLineOdds !== null;
    const hasPitchers = Boolean(r.awayPitcher && r.homePitcher &&
                                r.awayPitcher !== "TBD" && r.homePitcher !== "TBD");

    // RL sign invariant: awayRunLine + homeRunLine must sum to 0 (e.g. -1.5 + 1.5 = 0)
    let rlSignOk = true;
    if (r.awayRunLine && r.homeRunLine) {
      const awayRl = parseFloat(String(r.awayRunLine));
      const homeRl = parseFloat(String(r.homeRunLine));
      if (Math.abs(awayRl + homeRl) > 0.01) {
        rlSignOk = false;
        rlIssues++;
      }
    }

    if (hasModel) modeled++;
    if (!hasBook)     missingBookLines++;
    if (!hasPitchers) missingPitchers++;

    const modelFlag    = hasModel ? "✅ MODELED    " : "❌ NOT MODELED";
    const bookFlag     = hasBook  ? "BOOK:✓" : "BOOK:✗";
    const rlFlag       = hasRL    ? (rlSignOk ? "RL:✓" : "RL:⚠SIGN") : "RL:✗";
    const pitcherFlag  = hasPitchers ? "P:✓" : "P:✗";

    console.log(`[AuditMay31] [${String(i+1).padStart(2,"0")}/${rows.length}] ${modelFlag} | id=${r.id} pk=${r.gamePk ?? "null"} | ${gameLabel} | ${bookFlag} ${rlFlag} ${pitcherFlag}`);
    console.log(`           Book  : ML=${r.awayML ?? "null"}/${r.homeML ?? "null"}  RL=${r.awayRunLine ?? "null"}(${r.awayRunLineOdds ?? "null"})/${r.homeRunLine ?? "null"}(${r.homeRunLineOdds ?? "null"})  O/U=${r.bookTotal ?? "null"}(${r.overOdds ?? "null"}/${r.underOdds ?? "null"})`);
    console.log(`           Pitchers: AWAY=${r.awayPitcher ?? "null"}(${r.awayPitcherConfirmed ? "confirmed" : "projected"})  HOME=${r.homePitcher ?? "null"}(${r.homePitcherConfirmed ? "confirmed" : "projected"})`);
    console.log(`           Venue : ${r.venue ?? "null"}`);
    if (hasModel) {
      console.log(`           Model : projAway=${r.modelAwayScore}  projHome=${r.modelHomeScore}  total=${r.modelTotal}  spread=${r.awayModelSpread}  awayWin=${r.modelAwayWinPct}%  homeWin=${r.modelHomeWinPct}%`);
    }
    console.log("");
  }

  console.log(`[AuditMay31] ═══════════════════════════════════════════════════`);
  console.log(`[AuditMay31] [OUTPUT] SUMMARY`);
  console.log(`  Total games in DB:   ${rows.length}`);
  console.log(`  Modeled:             ${modeled}/${rows.length}`);
  console.log(`  Missing book lines:  ${missingBookLines}`);
  console.log(`  Missing pitchers:    ${missingPitchers}`);
  console.log(`  RL sign issues:      ${rlIssues}`);
  if (rows.length < 15) {
    console.log(`  ⚠ WARNING: Only ${rows.length} games found in DB — expected 15. Missing games need to be ingested first.`);
  }
  console.log(`[AuditMay31] [VERIFY] ${modeled === 15 ? "✅ ALL 15 GAMES MODELED" : `❌ ${modeled}/15 GAMES MODELED — ACTION REQUIRED`}`);
  console.log(`[AuditMay31] ═══════════════════════════════════════════════════`);

  process.exit(0);
}

main().catch(err => { console.error("[AuditMay31] FATAL:", err); process.exit(1); });
