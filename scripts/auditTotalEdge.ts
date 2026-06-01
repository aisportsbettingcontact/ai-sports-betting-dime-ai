/**
 * auditTotalEdge.ts
 * Fetches June 1 MLB games and prints a full edge direction audit for the total market.
 * Computes:
 *   - Book no-vig over probability
 *   - Model over probability (from modelOverOdds)
 *   - ROI for over and under
 *   - Correct edge direction
 *   - What the DB totalEdge label says
 *   - Whether they agree
 */
import { getDb } from '../server/db';
import { games as mlbGames } from '../drizzle/schema';
import { like, eq, and } from 'drizzle-orm';

function americanToImplied(odds: number): number {
  if (isNaN(odds)) return NaN;
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

function calculateRoi(modelML: number, bookML: number, bookOppML: number): number {
  if (isNaN(modelML) || isNaN(bookML) || isNaN(bookOppML)) return NaN;
  const modelWinProb = americanToImplied(modelML);
  const rawBook = americanToImplied(bookML);
  const rawOpp  = americanToImplied(bookOppML);
  const vigTotal = rawBook + rawOpp;
  if (vigTotal <= 0 || isNaN(vigTotal)) return NaN;
  const bookNoVigProb = rawBook / vigTotal;
  if (bookNoVigProb <= 0) return NaN;
  return (modelWinProb / bookNoVigProb - 1) * 100;
}

function toNum(s: string | null | undefined): number {
  if (!s) return NaN;
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

async function main() {
  const targetDate = process.argv[2] ?? '2026-06-01';
  console.log(`[INPUT] Fetching ${targetDate} MLB games from DB...`);
  const db = await getDb();
  const games = await db.select({
    id: mlbGames.id,
    awayTeam: mlbGames.awayTeam,
    homeTeam: mlbGames.homeTeam,
    bookTotal: mlbGames.bookTotal,
    overOdds: mlbGames.overOdds,
    underOdds: mlbGames.underOdds,
    modelOverOdds: mlbGames.modelOverOdds,
    modelUnderOdds: mlbGames.modelUnderOdds,
    totalEdge: mlbGames.totalEdge,
  }).from(mlbGames).where(and(eq(mlbGames.sport, 'MLB'), eq(mlbGames.gameDate, targetDate)));

  console.log(`[STATE] Found ${games.length} games for ${targetDate}\n`);

  let issueCount = 0;

  for (const g of games) {
    const bkOver  = toNum(g.overOdds);
    const bkUnder = toNum(g.underOdds);
    const mdlOver = toNum(g.modelOverOdds);
    const mdlUnder = toNum(g.modelUnderOdds);

    // No-vig book probabilities
    const rawBkOver  = americanToImplied(bkOver);
    const rawBkUnder = americanToImplied(bkUnder);
    const vigTotal   = rawBkOver + rawBkUnder;
    const bkNoVigOverProb  = vigTotal > 0 ? rawBkOver  / vigTotal : NaN;
    const bkNoVigUnderProb = vigTotal > 0 ? rawBkUnder / vigTotal : NaN;

    // Model probabilities
    const mdlOverProb  = americanToImplied(mdlOver);
    const mdlUnderProb = americanToImplied(mdlUnder);

    // ROI for each side
    const roiOver  = calculateRoi(mdlOver,  bkOver,  bkUnder);
    const roiUnder = calculateRoi(mdlUnder, bkUnder, bkOver);

    // Correct edge direction from probability comparison
    const correctEdgeIsOver = !isNaN(mdlOverProb) && !isNaN(bkNoVigOverProb)
      ? mdlOverProb > bkNoVigOverProb
      : null;

    // What the DB label says
    const dbLabel = g.totalEdge ?? 'null';
    const dbSaysOver = dbLabel.toUpperCase().startsWith('OVER');
    const dbSaysUnder = dbLabel.toUpperCase().startsWith('UNDER');
    const dbDirection = dbSaysOver ? true : dbSaysUnder ? false : null;

    // Agree?
    const agree = correctEdgeIsOver === dbDirection;

    // Is the displayed ROI positive for the displayed direction?
    const displayedRoi = dbDirection === true ? roiOver : dbDirection === false ? roiUnder : NaN;
    const roiIsPositive = !isNaN(displayedRoi) && displayedRoi > 0;

    const status = (!agree || !roiIsPositive) ? '❌ ISSUE' : '✅ OK';
    if (!agree || !roiIsPositive) issueCount++;

    console.log(`[GAME] ${g.awayTeam} @ ${g.homeTeam}`);
    console.log(`  [INPUT]  book total=${g.bookTotal} | o${g.bookTotal}(${g.overOdds}) u${g.bookTotal}(${g.underOdds})`);
    console.log(`  [INPUT]  model overOdds=${g.modelOverOdds} | model underOdds=${g.modelUnderOdds}`);
    console.log(`  [STATE]  bkNoVigOverProb=${(bkNoVigOverProb*100).toFixed(2)}% | bkNoVigUnderProb=${(bkNoVigUnderProb*100).toFixed(2)}%`);
    console.log(`  [STATE]  mdlOverProb=${(mdlOverProb*100).toFixed(2)}% | mdlUnderProb=${(mdlUnderProb*100).toFixed(2)}%`);
    console.log(`  [STATE]  roiOver=${roiOver.toFixed(2)}% | roiUnder=${roiUnder.toFixed(2)}%`);
    console.log(`  [STATE]  correctEdge=${correctEdgeIsOver === true ? 'OVER' : correctEdgeIsOver === false ? 'UNDER' : 'null'}`);
    console.log(`  [STATE]  dbTotalEdge="${dbLabel}" → dbDirection=${dbDirection === true ? 'OVER' : dbDirection === false ? 'UNDER' : 'null'}`);
    console.log(`  [STATE]  displayedROI=${displayedRoi.toFixed(2)}% | roiIsPositive=${roiIsPositive}`);
    console.log(`  [OUTPUT] ${status} — agree=${agree} | roiPositive=${roiIsPositive}\n`);
  }

  console.log(`[VERIFY] ${issueCount === 0 ? 'ALL PASS' : `${issueCount} ISSUES FOUND`} — ${games.length - issueCount}/${games.length} correct`);
  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
