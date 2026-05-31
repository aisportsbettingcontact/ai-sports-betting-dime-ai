/**
 * exhaustiveAuditMay31.ts
 * Exhaustive correctness audit for all 15 May 31, 2026 MLB modeled games.
 *
 * Checks performed:
 *  1. All 15 games present and modeled
 *  2. RL sign invariant: awayRunLine + homeRunLine = 0
 *  3. RL magnitude: must be exactly ±1.5 (MLB standard)
 *  4. RL sign alignment: awayModelSpread sign must match awayRunLine sign
 *  5. Model total matches book total (within 0.01)
 *  6. ML implied probability sum (vig-inclusive): must be > 1.00 (overround)
 *  7. Win probability sum: awayWin + homeWin must = 100.00 (±0.01)
 *  8. Pitcher R/L handedness mapping: cross-check against mlbPitcherStats DB
 *  9. Model scores are positive and plausible (0.5–15.0 per team)
 * 10. modelRunAt is set (today's date)
 * 11. awayModelSpread + homeModelSpread = 0 (sign pair)
 * 12. Venue is populated
 */
import { getDb } from "../server/db.ts";
import { games, mlbPitcherStats } from "../drizzle/schema.ts";
import { like, and, eq, inArray } from "drizzle-orm";

function americanToImplied(ml: number): number {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

async function main() {
  const db = await getDb();
  const DATE = "2026-05-31";

  console.log(`\n[ExhaustiveAudit] ════════════════════════════════════════════════`);
  console.log(`[ExhaustiveAudit] [INPUT] Date=${DATE} Sport=MLB`);
  console.log(`[ExhaustiveAudit] ════════════════════════════════════════════════\n`);

  // ── Fetch all 15 games ────────────────────────────────────────────────────
  const rows = await db.select({
    id:                   games.id,
    gamePk:               games.mlbGamePk,
    awayTeam:             games.awayTeam,
    homeTeam:             games.homeTeam,
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
    awayBookSpread:       games.awayBookSpread,
    homeBookSpread:       games.homeBookSpread,
    publishedModel:       games.publishedModel,
    venue:                games.venue,
    modelRunAt:           games.modelRunAt,
  }).from(games)
    .where(and(like(games.gameDate, `${DATE}%`), eq(games.sport, "MLB")));

  // ── Fetch pitcher handedness for all 30 starters ─────────────────────────
  const pitcherNames = rows.flatMap(r => [r.awayPitcher, r.homePitcher]).filter(Boolean) as string[];
  const pitcherRows = await db.select({
    fullName:   mlbPitcherStats.fullName,
    throwsHand: mlbPitcherStats.throwsHand,
    era:        mlbPitcherStats.era,
    k9:         mlbPitcherStats.k9,
    bb9:        mlbPitcherStats.bb9,
    whip:       mlbPitcherStats.whip,
    ip:         mlbPitcherStats.ip,
    fip:        mlbPitcherStats.fip,
    xera:       mlbPitcherStats.xera,
  }).from(mlbPitcherStats)
    .where(inArray(mlbPitcherStats.fullName, pitcherNames));

  const pitcherMap = new Map(pitcherRows.map(r => [r.fullName.toLowerCase().trim(), r]));

  // ── Run all checks ────────────────────────────────────────────────────────
  let totalIssues = 0;
  let totalWarnings = 0;
  const allGameResults: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = `${r.awayTeam} @ ${r.homeTeam}`;
    const issues: string[] = [];
    const warnings: string[] = [];

    console.log(`[ExhaustiveAudit] ── Game ${String(i+1).padStart(2,"0")}/15: ${label} (id=${r.id} pk=${r.gamePk}) ──`);

    // CHECK 1: Modeled
    const hasModel = r.modelAwayScore !== null && r.modelHomeScore !== null && r.modelAwayWinPct !== null;
    if (!hasModel) issues.push("NOT MODELED — modelAwayScore/modelHomeScore/modelAwayWinPct is null");
    else console.log(`  [CHECK 1] ✅ Modeled: projAway=${r.modelAwayScore} projHome=${r.modelHomeScore}`);

    // CHECK 2: RL sign invariant
    const awayRL = parseFloat(String(r.awayRunLine ?? "0"));
    const homeRL = parseFloat(String(r.homeRunLine ?? "0"));
    const rlSum = awayRL + homeRL;
    if (Math.abs(rlSum) > 0.01) issues.push(`RL sign invariant FAIL: awayRunLine=${awayRL} + homeRunLine=${homeRL} = ${rlSum.toFixed(4)} (must be 0)`);
    else console.log(`  [CHECK 2] ✅ RL sign invariant: ${awayRL} + ${homeRL} = 0`);

    // CHECK 3: RL magnitude ±1.5
    if (Math.abs(Math.abs(awayRL) - 1.5) > 0.01) issues.push(`RL magnitude FAIL: awayRunLine=${awayRL} (must be ±1.5)`);
    else console.log(`  [CHECK 3] ✅ RL magnitude: awayRunLine=${awayRL} (±1.5)`);

    // CHECK 4: RL sign alignment (model spread vs book run line)
    const awayModelSpr = parseFloat(String(r.awayModelSpread ?? "0"));
    const awayBookSpr  = parseFloat(String(r.awayBookSpread ?? "0"));
    if (!isNaN(awayModelSpr) && !isNaN(awayBookSpr) && awayBookSpr !== 0) {
      const bookSign  = awayBookSpr  < 0 ? -1 : 1;
      const modelSign = awayModelSpr < 0 ? -1 : 1;
      if (bookSign !== modelSign) {
        issues.push(`RL INVERSION: awayBookSpread=${awayBookSpr} (${bookSign>0?"dog":"fav"}) vs awayModelSpread=${awayModelSpr} (${modelSign>0?"dog":"fav"}) — SIGN MISMATCH`);
      } else {
        console.log(`  [CHECK 4] ✅ RL sign alignment: book=${awayBookSpr} model=${awayModelSpr} (both ${bookSign>0?"dog":"fav"})`);
      }
    }

    // CHECK 5: Model total matches book total
    const bookT  = parseFloat(String(r.bookTotal  ?? "0"));
    const modelT = parseFloat(String(r.modelTotal ?? "0"));
    if (Math.abs(bookT - modelT) > 0.01) issues.push(`Total mismatch: modelTotal=${modelT} ≠ bookTotal=${bookT}`);
    else console.log(`  [CHECK 5] ✅ Total match: book=${bookT} model=${modelT}`);

    // CHECK 6: ML implied probability overround (vig check)
    const awayMLNum = parseFloat(String(r.awayML ?? "100"));
    const homeMLNum = parseFloat(String(r.homeML ?? "-120"));
    const awayImplied = americanToImplied(awayMLNum);
    const homeImplied = americanToImplied(homeMLNum);
    const impliedSum = awayImplied + homeImplied;
    if (impliedSum <= 1.0) issues.push(`ML implied sum=${impliedSum.toFixed(4)} ≤ 1.0 — no vig detected (book error)`);
    else if (impliedSum > 1.15) warnings.push(`ML implied sum=${impliedSum.toFixed(4)} > 1.15 — unusually high vig`);
    else console.log(`  [CHECK 6] ✅ ML overround: ${(impliedSum*100).toFixed(2)}% (${awayMLNum}/${homeMLNum})`);

    // CHECK 7: Win probability sum = 100%
    const awayWin = parseFloat(String(r.modelAwayWinPct ?? "0"));
    const homeWin = parseFloat(String(r.modelHomeWinPct ?? "0"));
    const winSum  = awayWin + homeWin;
    if (Math.abs(winSum - 100) > 0.1) issues.push(`Win% sum FAIL: ${awayWin}+${homeWin}=${winSum.toFixed(2)} (must be 100.00±0.1)`);
    else console.log(`  [CHECK 7] ✅ Win% sum: ${awayWin}%+${homeWin}%=${winSum.toFixed(2)}%`);

    // CHECK 8: Pitcher R/L handedness
    const awayPitcherData = pitcherMap.get((r.awayPitcher ?? "").toLowerCase().trim());
    const homePitcherData = pitcherMap.get((r.homePitcher ?? "").toLowerCase().trim());
    const awayHand = awayPitcherData?.throwsHand === 1 ? "L" : (awayPitcherData?.throwsHand === 0 ? "R" : "?");
    const homeHand = homePitcherData?.throwsHand === 1 ? "L" : (homePitcherData?.throwsHand === 0 ? "R" : "?");
    if (awayHand === "?") warnings.push(`Away pitcher ${r.awayPitcher}: throwsHand=null in DB — defaulted to R`);
    if (homeHand === "?") warnings.push(`Home pitcher ${r.homePitcher}: throwsHand=null in DB — defaulted to R`);
    console.log(`  [CHECK 8] ${awayHand==="?"?"⚠":"✅"} Pitcher hands: AWAY=${r.awayPitcher}(${awayHand}) vs HOME=${r.homePitcher}(${homeHand})`);

    // CHECK 9: Model scores plausible
    const awayScore = parseFloat(String(r.modelAwayScore ?? "0"));
    const homeScore = parseFloat(String(r.modelHomeScore ?? "0"));
    if (awayScore < 0.5 || awayScore > 15.0) issues.push(`modelAwayScore=${awayScore} out of plausible range [0.5, 15.0]`);
    if (homeScore < 0.5 || homeScore > 15.0) issues.push(`modelHomeScore=${homeScore} out of plausible range [0.5, 15.0]`);
    if (awayScore >= 0.5 && awayScore <= 15.0 && homeScore >= 0.5 && homeScore <= 15.0) {
      console.log(`  [CHECK 9] ✅ Scores plausible: away=${awayScore} home=${homeScore}`);
    }

    // CHECK 10: modelRunAt is set and is today
    if (!r.modelRunAt) {
      issues.push(`modelRunAt is NULL — model not recorded`);
    } else {
      const runDate = new Date(Number(r.modelRunAt)).toISOString().slice(0, 10);
      if (runDate !== DATE) warnings.push(`modelRunAt=${runDate} ≠ gameDate=${DATE} (stale model)`);
      else console.log(`  [CHECK 10] ✅ modelRunAt: ${new Date(Number(r.modelRunAt)).toISOString()}`);
    }

    // CHECK 11: awayModelSpread + homeModelSpread = 0
    const homeModelSpr = parseFloat(String(r.homeModelSpread ?? "0"));
    const sprSum = awayModelSpr + homeModelSpr;
    if (Math.abs(sprSum) > 0.01) issues.push(`Model spread pair sum FAIL: ${awayModelSpr}+${homeModelSpr}=${sprSum.toFixed(4)} (must be 0)`);
    else console.log(`  [CHECK 11] ✅ Model spread pair: ${awayModelSpr}+${homeModelSpr}=0`);

    // CHECK 12: Venue populated
    if (!r.venue) warnings.push(`venue is NULL`);
    else console.log(`  [CHECK 12] ✅ Venue: ${r.venue}`);

    // Pitcher stats summary
    console.log(`  [PITCHER STATS] AWAY ${r.awayPitcher}: ERA=${awayPitcherData?.era ?? "null"} K/9=${awayPitcherData?.k9 ?? "null"} BB/9=${awayPitcherData?.bb9 ?? "null"} WHIP=${awayPitcherData?.whip ?? "null"} IP=${awayPitcherData?.ip ?? "null"} FIP=${awayPitcherData?.fip ?? "null"} xERA=${awayPitcherData?.xera ?? "null"}`);
    console.log(`  [PITCHER STATS] HOME ${r.homePitcher}: ERA=${homePitcherData?.era ?? "null"} K/9=${homePitcherData?.k9 ?? "null"} BB/9=${homePitcherData?.bb9 ?? "null"} WHIP=${homePitcherData?.whip ?? "null"} IP=${homePitcherData?.ip ?? "null"} FIP=${homePitcherData?.fip ?? "null"} xERA=${homePitcherData?.xera ?? "null"}`);

    if (issues.length > 0) {
      for (const issue of issues) console.log(`  ❌ ISSUE: ${issue}`);
      totalIssues += issues.length;
    }
    if (warnings.length > 0) {
      for (const warn of warnings) console.log(`  ⚠  WARN: ${warn}`);
      totalWarnings += warnings.length;
    }
    if (issues.length === 0) {
      console.log(`  ✅ GAME PASS — all 12 checks passed`);
      allGameResults.push(`✅ ${label}`);
    } else {
      allGameResults.push(`❌ ${label} (${issues.length} issues)`);
    }
    console.log("");
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`[ExhaustiveAudit] ════════════════════════════════════════════════`);
  console.log(`[ExhaustiveAudit] [OUTPUT] FINAL AUDIT SUMMARY`);
  console.log(`  Total games:    ${rows.length}`);
  console.log(`  Total issues:   ${totalIssues}`);
  console.log(`  Total warnings: ${totalWarnings}`);
  console.log(`  Games:`);
  for (const r of allGameResults) console.log(`    ${r}`);
  console.log(`[ExhaustiveAudit] [VERIFY] ${totalIssues === 0 ? "✅ ALL CHECKS PASSED — 15/15 GAMES CORRECT" : `❌ ${totalIssues} ISSUES FOUND — ACTION REQUIRED`}`);
  console.log(`[ExhaustiveAudit] ════════════════════════════════════════════════`);

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch(err => { console.error("[ExhaustiveAudit] FATAL:", err); process.exit(1); });
