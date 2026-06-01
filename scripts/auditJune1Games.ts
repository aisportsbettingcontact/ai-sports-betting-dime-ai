/**
 * auditJune1Games.ts
 * Audit all June 1, 2026 MLB games in the DB.
 * Reports: book lines, pitchers, model status, RL signs.
 */
import { getDb } from "../server/db.ts";
import { games } from "../drizzle/schema.ts";
import { like, eq, and } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const DATE = "2026-06-01";

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
    modelAwayScore:       games.modelAwayScore,
    modelHomeScore:       games.modelHomeScore,
    modelAwayWinPct:      games.modelAwayWinPct,
    modelHomeWinPct:      games.modelHomeWinPct,
    awayModelSpread:      games.awayModelSpread,
    homeModelSpread:      games.homeModelSpread,
    awayBookSpread:       games.awayBookSpread,
    homeBookSpread:       games.homeBookSpread,
    venue:                games.venue,
    modelRunAt:           games.modelRunAt,
  }).from(games)
    .where(and(like(games.gameDate, `${DATE}%`), eq(games.sport, "MLB")));

  console.log(`\n[AuditJune1] ═══════════════════════════════════════════════════`);
  console.log(`[AuditJune1] [INPUT]  date=${DATE}  sport=MLB`);
  console.log(`[AuditJune1] [STATE]  games in DB: ${rows.length}`);
  console.log(`[AuditJune1] ═══════════════════════════════════════════════════\n`);

  let missingLines = 0;
  let missingPitchers = 0;
  let rlIssues = 0;
  let modeled = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = `${r.awayTeam} @ ${r.homeTeam}`;
    const hasLines = r.awayML !== null && r.homeML !== null && r.bookTotal !== null;
    const hasPitchers = r.awayPitcher !== null && r.homePitcher !== null;
    const isModeled = r.modelAwayScore !== null;
    const awayRL = parseFloat(String(r.awayRunLine ?? "0"));
    const homeRL = parseFloat(String(r.homeRunLine ?? "0"));
    const rlOk = Math.abs(awayRL + homeRL) < 0.01;

    if (!hasLines) missingLines++;
    if (!hasPitchers) missingPitchers++;
    if (!rlOk) rlIssues++;
    if (isModeled) modeled++;

    const status = isModeled ? "✅ MODELED" : (hasLines && hasPitchers ? "⏳ READY" : "❌ INCOMPLETE");
    console.log(`[AuditJune1] [${String(i+1).padStart(2,"0")}/09] ${status} | id=${r.id} pk=${r.gamePk} | ${label}`);
    console.log(`  Book  : ML=${r.awayML}/${r.homeML}  RL=${r.awayRunLine}(${r.awayRunLineOdds})/${r.homeRunLine}(${r.homeRunLineOdds})  O/U=${r.bookTotal}(${r.overOdds}/${r.underOdds})`);
    console.log(`  Pitchers: AWAY=${r.awayPitcher ?? "TBD"}(confirmed=${r.awayPitcherConfirmed})  HOME=${r.homePitcher ?? "TBD"}(confirmed=${r.homePitcherConfirmed})`);
    console.log(`  Venue : ${r.venue ?? "UNKNOWN"}`);
    if (isModeled) {
      console.log(`  Model : projAway=${r.modelAwayScore}  projHome=${r.modelHomeScore}  spread=${r.awayModelSpread}  awayWin=${r.modelAwayWinPct}%  homeWin=${r.modelHomeWinPct}%`);
    }
    if (!rlOk) console.log(`  ⚠ RL SIGN ISSUE: awayRL=${awayRL} homeRL=${homeRL} sum=${awayRL+homeRL}`);
    console.log("");
  }

  console.log(`[AuditJune1] ═══════════════════════════════════════════════════`);
  console.log(`[AuditJune1] [OUTPUT] SUMMARY`);
  console.log(`  Total games in DB:   ${rows.length}`);
  console.log(`  Modeled:             ${modeled}/${rows.length}`);
  console.log(`  Missing book lines:  ${missingLines}`);
  console.log(`  Missing pitchers:    ${missingPitchers}`);
  console.log(`  RL sign issues:      ${rlIssues}`);
  const allReady = rows.length === 9 && missingLines === 0 && missingPitchers === 0 && rlIssues === 0;
  console.log(`[AuditJune1] [VERIFY] ${allReady ? "✅ ALL 9 GAMES READY TO MODEL" : "❌ ACTION REQUIRED BEFORE MODELING"}`);
  console.log(`[AuditJune1] ═══════════════════════════════════════════════════`);

  process.exit(0);
}

main().catch(err => { console.error("[AuditJune1] FATAL:", err); process.exit(1); });
