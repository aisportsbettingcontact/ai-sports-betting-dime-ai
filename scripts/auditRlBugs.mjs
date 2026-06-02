/**
 * auditRlBugs.mjs
 * Deep audit of MLB RL mapping bugs for TOR, CLE, SD.
 * Traces: DB values → Python engine logic → edge detection formula → display.
 *
 * Run: node scripts/auditRlBugs.mjs
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

// ── Utility: American odds → raw implied probability ──────────────────────────
function americanToImplied(odds) {
  if (isNaN(odds) || odds === 0) return NaN;
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

// ── Utility: Raw implied → American odds ──────────────────────────────────────
function impliedToAmerican(p) {
  if (p <= 0 || p >= 1) return NaN;
  return p >= 0.5 ? -(p / (1 - p)) * 100 : (1 - p) / p * 100;
}

// ── Option B edge check: modelImplied > bookImplied (raw vs raw) ──────────────
function optionBEdge(modelOdds, bookOdds) {
  const modelImpl = americanToImplied(parseFloat(String(modelOdds)));
  const bookImpl  = americanToImplied(parseFloat(String(bookOdds)));
  if (isNaN(modelImpl) || isNaN(bookImpl)) return { edge: false, modelImpl: NaN, bookImpl: NaN, diff: NaN };
  const diff = modelImpl - bookImpl;
  return { edge: diff > 0, modelImpl, bookImpl, diff };
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  console.log('\n' + '═'.repeat(90));
  console.log('  MLB RL MAPPING BUG AUDIT — TOR / CLE / SD');
  console.log('═'.repeat(90));

  const [rows] = await conn.execute(`
    SELECT 
      id, awayTeam, homeTeam, gameDate,
      awayRunLine, homeRunLine,
      awayRunLineOdds, homeRunLineOdds,
      awayML, homeML,
      awayBookSpread, homeBookSpread,
      modelAwaySpreadOdds, modelHomeSpreadOdds,
      awayModelSpread, homeModelSpread,
      spreadDiff, spreadEdge,
      modelAwayML, modelHomeML,
      modelAwayWinPct, modelHomeWinPct
    FROM games
    WHERE sport = 'MLB'
      AND (awayTeam IN ('TOR','CLE','SD') OR homeTeam IN ('TOR','CLE','SD'))
      AND DATE(gameDate) >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
    ORDER BY gameDate DESC
    LIMIT 15
  `);

  for (const g of rows) {
    const awayML = parseFloat(String(g.awayML ?? 'NaN'));
    const homeML = parseFloat(String(g.homeML ?? 'NaN'));
    const bkAwayRLOdds = parseFloat(String(g.awayRunLineOdds ?? 'NaN'));
    const bkHomeRLOdds = parseFloat(String(g.homeRunLineOdds ?? 'NaN'));
    const mdlAwayRLOdds = parseFloat(String(g.modelAwaySpreadOdds ?? 'NaN'));
    const mdlHomeRLOdds = parseFloat(String(g.modelHomeSpreadOdds ?? 'NaN'));
    const awayBookSpread = parseFloat(String(g.awayBookSpread ?? 'NaN'));
    const homeBookSpread = parseFloat(String(g.homeBookSpread ?? 'NaN'));
    const mdlAwayML = parseFloat(String(g.modelAwayML ?? 'NaN'));
    const mdlHomeML = parseFloat(String(g.modelHomeML ?? 'NaN'));

    console.log('\n' + '─'.repeat(90));
    console.log(`[GAME] id=${g.id}  ${g.awayTeam}@${g.homeTeam}  ${String(g.gameDate).slice(0,10)}`);
    console.log('─'.repeat(90));

    // ── BOOK DATA ──────────────────────────────────────────────────────────────
    console.log(`[BOOK]  ML:  away=${g.awayML}  home=${g.homeML}`);
    console.log(`[BOOK]  RL:  away=${g.awayRunLine}(${g.awayRunLineOdds})  home=${g.homeRunLine}(${g.homeRunLineOdds})`);
    console.log(`[BOOK]  Spread: awayBookSpread=${g.awayBookSpread}  homeBookSpread=${g.homeBookSpread}`);

    // ── MODEL DATA ─────────────────────────────────────────────────────────────
    console.log(`[MODEL] ML:  away=${g.modelAwayML}  home=${g.modelHomeML}`);
    console.log(`[MODEL] RL:  awayModelSpread=${g.awayModelSpread}  homeModelSpread=${g.homeModelSpread}`);
    console.log(`[MODEL] RL odds: modelAwaySpreadOdds=${g.modelAwaySpreadOdds}  modelHomeSpreadOdds=${g.modelHomeSpreadOdds}`);
    console.log(`[MODEL] Win%: away=${g.modelAwayWinPct}%  home=${g.modelHomeWinPct}%`);

    // ── DB EDGE FIELDS ─────────────────────────────────────────────────────────
    console.log(`[DB]    spreadDiff=${g.spreadDiff}  spreadEdge="${g.spreadEdge}"`);

    // ── BUG 1 ANALYSIS: RL odds swap ──────────────────────────────────────────
    console.log('\n  [ANALYSIS: BUG 1 — RL ODDS MAPPING]');
    if (!isNaN(awayML) && !isNaN(mdlAwayRLOdds)) {
      const awayIsUnderdog = awayML > 0;
      const awayRLImplied = americanToImplied(mdlAwayRLOdds);
      const awayMLImplied = americanToImplied(awayML);
      const mdlAwayMLImplied = americanToImplied(mdlAwayML);

      console.log(`  [INPUT]  awayML=${awayML} → implied=${(awayMLImplied*100).toFixed(2)}% (${awayIsUnderdog ? 'UNDERDOG' : 'FAVORITE'})`);
      console.log(`  [INPUT]  modelAwayML=${mdlAwayML} → implied=${(mdlAwayMLImplied*100).toFixed(2)}%`);
      console.log(`  [INPUT]  modelAwaySpreadOdds=${g.modelAwaySpreadOdds} → implied=${(awayRLImplied*100).toFixed(2)}%`);

      // Invariant: if away is underdog (ML > 0), their +1.5 cover% MUST be > their win%
      // So modelAwaySpreadOdds (for +1.5) should have HIGHER implied prob than modelAwayML
      if (awayIsUnderdog) {
        const rlHigherThanML = awayRLImplied > mdlAwayMLImplied;
        const verdict = rlHigherThanML ? 'CORRECT (RL cover% > ML win% for underdog)' : 'BUG DETECTED: RL cover% < ML win% for underdog — ODDS SWAPPED';
        console.log(`  [VERIFY] Away is underdog: modelAwaySpreadOdds implied (${(awayRLImplied*100).toFixed(2)}%) vs modelAwayML implied (${(mdlAwayMLImplied*100).toFixed(2)}%)`);
        console.log(`  [VERIFY] ${verdict}`);
        if (!rlHigherThanML) {
          console.log(`  [ROOT CAUSE] modelAwaySpreadOdds=${g.modelAwaySpreadOdds} is the FAVORITE's RL odds (${(awayRLImplied*100).toFixed(2)}% < ${(mdlAwayMLImplied*100).toFixed(2)}%)`);
          console.log(`  [ROOT CAUSE] modelHomeSpreadOdds=${g.modelHomeSpreadOdds} should be the AWAY team's RL odds`);
          const homeRLImplied = americanToImplied(mdlHomeRLOdds);
          console.log(`  [ROOT CAUSE] modelHomeSpreadOdds implied=${(homeRLImplied*100).toFixed(2)}% vs modelAwayML implied=${(mdlAwayMLImplied*100).toFixed(2)}% — ${homeRLImplied > mdlAwayMLImplied ? 'CORRECT if swapped' : 'still wrong'}`);
        }
      } else {
        // Away is favorite: their -1.5 cover% MUST be < their win%
        const rlLowerThanML = awayRLImplied < mdlAwayMLImplied;
        const verdict = rlLowerThanML ? 'CORRECT (RL cover% < ML win% for favorite)' : 'BUG DETECTED: RL cover% > ML win% for favorite — INVARIANT VIOLATION';
        console.log(`  [VERIFY] Away is favorite: modelAwaySpreadOdds implied (${(awayRLImplied*100).toFixed(2)}%) vs modelAwayML implied (${(mdlAwayMLImplied*100).toFixed(2)}%)`);
        console.log(`  [VERIFY] ${verdict}`);
      }
    }

    // ── BUG 2/3 ANALYSIS: Option B edge detection ─────────────────────────────
    console.log('\n  [ANALYSIS: BUG 2/3 — OPTION B EDGE DETECTION]');
    if (!isNaN(bkAwayRLOdds) && !isNaN(mdlAwayRLOdds)) {
      const awayCheck = optionBEdge(mdlAwayRLOdds, bkAwayRLOdds);
      const homeCheck = optionBEdge(mdlHomeRLOdds, bkHomeRLOdds);

      console.log(`  [INPUT]  AWAY RL: book=${g.awayRunLineOdds}(implied=${(awayCheck.bookImpl*100).toFixed(2)}%)  model=${g.modelAwaySpreadOdds}(implied=${(awayCheck.modelImpl*100).toFixed(2)}%)`);
      console.log(`  [INPUT]  HOME RL: book=${g.homeRunLineOdds}(implied=${(homeCheck.bookImpl*100).toFixed(2)}%)  model=${g.modelHomeSpreadOdds}(implied=${(homeCheck.modelImpl*100).toFixed(2)}%)`);
      console.log(`  [STATE]  AWAY Option B: modelImpl(${(awayCheck.modelImpl*100).toFixed(2)}%) > bookImpl(${(awayCheck.bookImpl*100).toFixed(2)}%) = ${awayCheck.edge} (diff=${(awayCheck.diff*100).toFixed(2)}pp)`);
      console.log(`  [STATE]  HOME Option B: modelImpl(${(homeCheck.modelImpl*100).toFixed(2)}%) > bookImpl(${(homeCheck.bookImpl*100).toFixed(2)}%) = ${homeCheck.edge} (diff=${(homeCheck.diff*100).toFixed(2)}pp)`);

      const correctEdge = awayCheck.edge ? 'AWAY' : homeCheck.edge ? 'HOME' : 'NONE';
      const dbEdge = g.spreadEdge ? (g.spreadEdge.includes(g.awayTeam) ? 'AWAY' : 'HOME') : 'NONE';
      const edgeMatch = correctEdge === dbEdge;

      console.log(`  [OUTPUT] Correct Option B edge: ${correctEdge}`);
      console.log(`  [OUTPUT] DB spreadEdge label: "${g.spreadEdge}" → parsed as: ${dbEdge}`);
      console.log(`  [VERIFY] Edge direction match: ${edgeMatch ? 'PASS ✓' : 'FAIL ✗ — DB label is WRONG'}`);

      if (!edgeMatch || (correctEdge === 'NONE' && g.spreadEdge && g.spreadEdge !== 'PASS')) {
        console.log(`  [BUG]    DB shows edge "${g.spreadEdge}" but Option B says NO EDGE`);
        console.log(`  [FIX]    RL edge detection in mlbModelRunner.ts must use Option B:`);
        console.log(`           edgeAway = americanToImplied(mdlAwayRLOdds) - americanToImplied(bkAwayRLOdds)`);
        console.log(`           edgeHome = americanToImplied(mdlHomeRLOdds) - americanToImplied(bkHomeRLOdds)`);
        console.log(`           Edge exists ONLY when edgeAway > 0 OR edgeHome > 0 (not both)`);
      }
    } else {
      console.log(`  [SKIP]   Missing RL odds — cannot perform Option B analysis`);
    }
  }

  console.log('\n' + '═'.repeat(90));
  console.log('  AUDIT COMPLETE');
  console.log('═'.repeat(90) + '\n');

  await conn.end();
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
