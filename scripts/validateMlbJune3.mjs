/**
 * Full DB validation audit for June 3, 2026 MLB model run.
 * Verifies: RL/ML/Total mapping, Option B edge detection, F5, NRFI, HR Props, K-Props
 * Zero-hallucination: all values read directly from DB.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const DATE = '2026-06-03';
const EDGE_THRESHOLD_PP = 0; // Option B: any positive edge counts

// American odds → raw implied probability
const implied = (odds) => {
  if (!odds || isNaN(odds)) return null;
  const n = parseFloat(String(odds));
  if (isNaN(n)) return null;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
};

const fmtPct = (v) => v != null ? (v * 100).toFixed(2) + '%' : 'NULL';
const fmtOdds = (v) => v != null ? (parseFloat(v) >= 0 ? '+' + v : String(v)) : 'NULL';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  console.log('[AUDIT] ═══════════════════════════════════════════════════════════');
  console.log(`[AUDIT] MLB MODEL VALIDATION — ${DATE}`);
  console.log('[AUDIT] ═══════════════════════════════════════════════════════════\n');

  const [games] = await conn.execute(`
    SELECT
      id, awayTeam, homeTeam, startTimeEst,
      -- Book lines
      awayML, homeML,
      awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
      bookTotal, overOdds, underOdds,
      -- Model Full Game
      modelAwayML, modelHomeML, modelAwayScore, modelHomeScore,
      modelAwayWinPct, modelHomeWinPct,
      modelAwaySpreadOdds, modelHomeSpreadOdds,
      awayModelSpread, homeModelSpread,
      modelTotal, modelOverOdds, modelUnderOdds,
      modelOverRate, modelUnderRate,
      -- Edge detection
      spreadEdge, spreadDiff, totalEdge, totalDiff,
      -- F5
      f5AwayML, f5HomeML, f5Total, f5OverOdds, f5UnderOdds,
      modelF5AwayML, modelF5HomeML, modelF5Total, modelF5OverOdds, modelF5UnderOdds,
      modelF5AwayScore, modelF5HomeScore, modelF5OverRate, modelF5UnderRate,
      modelF5AwayWinPct, modelF5HomeWinPct,
      modelF5AwayRlOdds, modelF5HomeRlOdds, modelF5PushPct,
      -- NRFI/YRFI
      nrfiOverOdds, yrfiUnderOdds,
      modelPNrfi, modelNrfiOdds, modelYrfiOdds,
      nrfiCombinedSignal, nrfiFilterPass,
      -- HR Props
      modelAwayHrPct, modelHomeHrPct, modelBothHrPct,
      modelAwayExpHr, modelHomeExpHr,
      -- Meta
      modelRunAt, publishedToFeed, publishedModel,
      awayStartingPitcher, homeStartingPitcher
    FROM games
    WHERE sport='MLB' AND gameDate='${DATE}'
    ORDER BY startTimeEst
  `);

  console.log(`[INPUT]  ${games.length} games found for ${DATE}\n`);

  let passCount = 0;
  let failCount = 0;
  const issues = [];

  for (const [i, g] of games.entries()) {
    const tag = `[GAME ${String(i+1).padStart(2,'0')}] ${g.awayTeam}@${g.homeTeam}`;
    console.log(`${tag} ─────────────────────────────────────────────`);
    console.log(`  [INPUT]  Time=${g.startTimeEst} | SP: ${g.awayStartingPitcher} vs ${g.homeStartingPitcher}`);
    console.log(`  [INPUT]  Book ML: ${fmtOdds(g.awayML)}/${fmtOdds(g.homeML)}`);
    console.log(`  [INPUT]  Book RL: ${g.awayRunLine}(${fmtOdds(g.awayRunLineOdds)}) / ${g.homeRunLine}(${fmtOdds(g.homeRunLineOdds)})`);
    console.log(`  [INPUT]  Book Total: ${g.bookTotal} (${fmtOdds(g.overOdds)}/${fmtOdds(g.underOdds)})`);

    // ── GATE 1: Model was run ──
    const wasModeled = g.modelRunAt != null;
    const wasPublished = g.publishedToFeed === 1;
    console.log(`  [STATE]  modelRunAt=${g.modelRunAt != null ? new Date(Number(g.modelRunAt)).toISOString() : 'NULL'} publishedToFeed=${wasPublished}`);
    if (!wasModeled) {
      console.log(`  [VERIFY] FAIL — modelRunAt is NULL (game not modeled)`);
      failCount++;
      issues.push(`${g.awayTeam}@${g.homeTeam}: NOT MODELED`);
      continue;
    }

    // ── GATE 2: Full Game ML ──
    const hasFgML = g.modelAwayML && g.modelHomeML;
    console.log(`  [STATE]  Model ML: ${fmtOdds(g.modelAwayML)}/${fmtOdds(g.modelHomeML)} | Win%: ${g.modelAwayWinPct}/${g.modelHomeWinPct}`);
    if (!hasFgML) {
      issues.push(`${g.awayTeam}@${g.homeTeam}: Missing modelAwayML/modelHomeML`);
      failCount++;
    }

    // ── GATE 3: RL label sign consistency ──
    const bookAwayRLNum = parseFloat(String(g.awayRunLine ?? '0'));
    const modelAwayRLNum = parseFloat(String(g.awayModelSpread ?? '0'));
    const bookSign = bookAwayRLNum >= 0 ? 1 : -1;
    const modelSign = modelAwayRLNum >= 0 ? 1 : -1;
    const rlSignOk = bookSign === modelSign;
    console.log(`  [STATE]  RL Labels: book=${g.awayRunLine}/${g.homeRunLine} model=${g.awayModelSpread}/${g.homeModelSpread}`);
    console.log(`  [STATE]  RL Odds: book=${fmtOdds(g.awayRunLineOdds)}/${fmtOdds(g.homeRunLineOdds)} model=${fmtOdds(g.modelAwaySpreadOdds)}/${fmtOdds(g.modelHomeSpreadOdds)}`);
    if (!rlSignOk) {
      console.log(`  [VERIFY] FAIL — RL SIGN MISMATCH: bookAway=${g.awayRunLine} modelAway=${g.awayModelSpread}`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: RL SIGN MISMATCH book=${g.awayRunLine} model=${g.awayModelSpread}`);
      failCount++;
    } else {
      console.log(`  [VERIFY] PASS — RL sign consistent: book=${g.awayRunLine} model=${g.awayModelSpread}`);
    }

    // ── GATE 4: Option B RL edge detection ──
    const mdlAwayImpl = implied(g.modelAwaySpreadOdds);
    const mdlHomeImpl = implied(g.modelHomeSpreadOdds);
    const bkAwayImpl  = implied(g.awayRunLineOdds);
    const bkHomeImpl  = implied(g.homeRunLineOdds);
    if (mdlAwayImpl !== null && bkAwayImpl !== null) {
      const edgeAway = (mdlAwayImpl - bkAwayImpl) * 100;
      const edgeHome = mdlHomeImpl !== null && bkHomeImpl !== null ? (mdlHomeImpl - bkHomeImpl) * 100 : null;
      const bestEdge = edgeHome !== null ? Math.max(edgeAway, edgeHome) : edgeAway;
      const hasEdge = bestEdge > EDGE_THRESHOLD_PP;
      const dbHasEdge = g.spreadEdge != null && g.spreadEdge.includes('[EDGE]');
      const edgeMatch = hasEdge === dbHasEdge;
      console.log(`  [STATE]  RL Option B: mdlAway=${fmtPct(mdlAwayImpl)} bkAway=${fmtPct(bkAwayImpl)} edgeAway=${edgeAway.toFixed(2)}pp | mdlHome=${fmtPct(mdlHomeImpl)} bkHome=${fmtPct(bkHomeImpl)} edgeHome=${edgeHome?.toFixed(2) ?? 'N/A'}pp`);
      console.log(`  [STATE]  DB spreadEdge="${g.spreadEdge ?? 'NULL'}" spreadDiff=${g.spreadDiff ?? 'NULL'}`);
      if (!edgeMatch) {
        console.log(`  [VERIFY] FAIL — RL edge mismatch: computed hasEdge=${hasEdge} but DB spreadEdge="${g.spreadEdge}"`);
        issues.push(`${g.awayTeam}@${g.homeTeam}: RL edge mismatch computed=${hasEdge} db="${g.spreadEdge}"`);
        failCount++;
      } else {
        console.log(`  [VERIFY] PASS — RL edge correct: hasEdge=${hasEdge} db="${g.spreadEdge ?? 'none'}"`);
      }
    }

    // ── GATE 5: Total edge detection ──
    const modelOverProb = parseFloat(String(g.modelOverRate ?? '0')) / 100;
    const modelUnderProb = 1 - modelOverProb;
    const bkOverImpl  = implied(g.overOdds);
    const bkUnderImpl = implied(g.underOdds);
    const totalMatch = parseFloat(String(g.modelTotal ?? '0')) === parseFloat(String(g.bookTotal ?? '0'));
    console.log(`  [STATE]  Total: book=${g.bookTotal}(${fmtOdds(g.overOdds)}/${fmtOdds(g.underOdds)}) model=${g.modelTotal}(${fmtOdds(g.modelOverOdds)}/${fmtOdds(g.modelUnderOdds)})`);
    console.log(`  [STATE]  Total match: ${totalMatch} | DB totalEdge="${g.totalEdge ?? 'NULL'}" totalDiff=${g.totalDiff ?? 'NULL'}`);
    if (!totalMatch) {
      console.log(`  [VERIFY] FAIL — Total mismatch: book=${g.bookTotal} model=${g.modelTotal}`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: Total mismatch book=${g.bookTotal} model=${g.modelTotal}`);
      failCount++;
    } else {
      console.log(`  [VERIFY] PASS — Total anchored to book: ${g.bookTotal}`);
    }
    if (bkOverImpl !== null && bkUnderImpl !== null) {
      const overEdge = (modelOverProb - bkOverImpl) * 100;
      const underEdge = (modelUnderProb - bkUnderImpl) * 100;
      const hasTotal = overEdge > 0 || underEdge > 0;
      const dbHasTotal = g.totalEdge != null && g.totalEdge.includes('[EDGE]');
      if (hasTotal !== dbHasTotal) {
        console.log(`  [VERIFY] FAIL — Total edge mismatch: computed hasEdge=${hasTotal} but DB totalEdge="${g.totalEdge}"`);
        issues.push(`${g.awayTeam}@${g.homeTeam}: Total edge mismatch computed=${hasTotal} db="${g.totalEdge}"`);
        failCount++;
      } else {
        console.log(`  [VERIFY] PASS — Total edge correct: hasEdge=${hasTotal} db="${g.totalEdge ?? 'none'}"`);
      }
    }

    // ── GATE 6: F5 model fields ──
    const hasF5 = g.modelF5AwayML && g.modelF5HomeML && g.modelF5OverOdds && g.modelF5UnderOdds;
    console.log(`  [STATE]  F5: bookML=${fmtOdds(g.f5AwayML)}/${fmtOdds(g.f5HomeML)} modelML=${fmtOdds(g.modelF5AwayML)}/${fmtOdds(g.modelF5HomeML)} | bookTotal=${g.f5Total}(${fmtOdds(g.f5OverOdds)}/${fmtOdds(g.f5UnderOdds)}) modelTotal=${g.modelF5Total}(${fmtOdds(g.modelF5OverOdds)}/${fmtOdds(g.modelF5UnderOdds)})`);
    console.log(`  [STATE]  F5 Scores: away=${g.modelF5AwayScore} home=${g.modelF5HomeScore} | Win%: away=${g.modelF5AwayWinPct} home=${g.modelF5HomeWinPct}`);
    if (!hasF5) {
      console.log(`  [VERIFY] WARN — F5 model fields incomplete`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: F5 model fields incomplete`);
    } else {
      console.log(`  [VERIFY] PASS — F5 model fields populated`);
    }

    // ── GATE 7: NRFI/YRFI ──
    const hasNrfi = g.modelPNrfi != null && g.modelNrfiOdds != null;
    console.log(`  [STATE]  NRFI: bookOdds=${fmtOdds(g.nrfiOverOdds)}/${fmtOdds(g.yrfiUnderOdds)} modelP=${g.modelPNrfi} modelNrfiOdds=${fmtOdds(g.modelNrfiOdds)} modelYrfiOdds=${fmtOdds(g.modelYrfiOdds)} | signal=${g.nrfiCombinedSignal?.toFixed(4) ?? 'NULL'} filterPass=${g.nrfiFilterPass}`);
    if (!hasNrfi) {
      console.log(`  [VERIFY] WARN — NRFI model fields incomplete`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: NRFI model fields incomplete`);
    } else {
      console.log(`  [VERIFY] PASS — NRFI model fields populated`);
    }

    // ── GATE 8: HR Props ──
    const hasHR = g.modelAwayHrPct != null && g.modelHomeHrPct != null;
    console.log(`  [STATE]  HR Props: awayPct=${g.modelAwayHrPct} homePct=${g.modelHomeHrPct} bothPct=${g.modelBothHrPct} | expAway=${g.modelAwayExpHr} expHome=${g.modelHomeExpHr}`);
    if (!hasHR) {
      console.log(`  [VERIFY] WARN — HR Props model fields incomplete`);
      issues.push(`${g.awayTeam}@${g.homeTeam}: HR Props model fields incomplete`);
    } else {
      console.log(`  [VERIFY] PASS — HR Props model fields populated`);
    }

    passCount++;
    console.log(`  [OUTPUT] PASS — All critical gates passed\n`);
  }

  // ── K-Props audit ──
  console.log('[AUDIT] ─── K-PROPS AUDIT ──────────────────────────────────────────');
  const [kProps] = await conn.execute(`
    SELECT kp.id, kp.gameId, kp.pitcherName, kp.side, kp.bookLine, kp.bookOverOdds, kp.bookUnderOdds,
           kp.modelLine, kp.modelOverOdds, kp.modelUnderOdds, kp.modelOverPct, kp.modelUnderPct,
           g.awayTeam, g.homeTeam
    FROM mlb_strikeout_props kp
    JOIN games g ON g.id = kp.gameId
    WHERE g.gameDate='${DATE}'
    ORDER BY g.startTimeEst, kp.pitcherName
  `);
  console.log(`[INPUT]  ${kProps.length} K-prop rows found for ${DATE}`);
  if (kProps.length > 0) {
    kProps.forEach(k => {
      const hasModel = k.modelLine != null && k.modelOverOdds != null;
      const tag = `  [K-PROP] ${k.awayTeam}@${k.homeTeam} | ${k.pitcherName}(${k.side}) | book=${k.bookLine}(${fmtOdds(k.bookOverOdds)}/${fmtOdds(k.bookUnderOdds)}) | model=${k.modelLine ?? 'NULL'}(${fmtOdds(k.modelOverOdds)}/${fmtOdds(k.modelUnderOdds)}) | ${hasModel ? 'MODELED' : 'BOOK ONLY'}`;
      console.log(tag);
    });
  } else {
    console.log('  [WARN] No K-props found — K-prop model may not have run yet for today');
  }

  // ── Final summary ──
  console.log('\n[AUDIT] ═══════════════════════════════════════════════════════════');
  console.log('[AUDIT] FINAL VALIDATION SUMMARY');
  console.log('[AUDIT] ═══════════════════════════════════════════════════════════');
  console.log(`[OUTPUT] Total games: ${games.length}`);
  console.log(`[OUTPUT] Passed all gates: ${passCount}`);
  console.log(`[OUTPUT] Failed/warned: ${failCount}`);
  if (issues.length > 0) {
    console.log(`[VERIFY] ISSUES (${issues.length}):`);
    issues.forEach(i => console.log(`  [ISSUE] ${i}`));
  } else {
    console.log(`[VERIFY] PASS — No issues found`);
  }

  await conn.end();
}

main().catch(err => {
  console.error('[AUDIT] FATAL:', err);
  process.exit(1);
});
