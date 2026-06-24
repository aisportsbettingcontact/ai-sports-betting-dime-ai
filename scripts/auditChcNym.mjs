/**
 * auditChcNym.mjs
 * Simulates the full frontend model display logic for CHC@NYM (id=2251113)
 * to determine why model odds show '—' in the UI.
 *
 * [AUDIT][STEP] 1. Fetch raw DB values
 * [AUDIT][STEP] 2. Simulate hasModelData gate
 * [AUDIT][STEP] 3. Simulate mlbMdlAwayLabel / mlbMdlHomeLabel
 * [AUDIT][STEP] 4. Simulate mdlAwaySpreadStr / mdlHomeSpreadStr
 * [AUDIT][STEP] 5. Simulate mdlOverTotalStr / mdlUnderTotalStr
 * [AUDIT][STEP] 6. Simulate mdlAwayMl / mdlHomeMl
 * [AUDIT][OUTPUT] Final expected display values
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

function toNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = parseFloat(String(v));
  return isNaN(n) ? NaN : n;
}

function spreadSign(n) {
  return n > 0 ? `+${n}` : String(n);
}

function fmtOddsSign(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v), 10);
  if (isNaN(n)) return String(v);
  return n > 0 ? `+${n}` : String(n);
}

(async () => {
  const db = await mysql.createConnection(process.env.DATABASE_URL);

  // [AUDIT][STEP] 1. Fetch raw DB values
  const [rows] = await db.execute(
    `SELECT awayTeam, homeTeam, awayBookSpread, homeBookSpread, bookTotal, modelTotal,
            awayModelSpread, homeModelSpread, modelAwayML, modelHomeML,
            modelOverOdds, modelUnderOdds, modelAwaySpreadOdds, modelHomeSpreadOdds,
            awayRunLine, homeRunLine, modelRunAt, publishedModel, publishedToFeed,
            awayML, homeML, overOdds, underOdds, gameStatus
     FROM games WHERE id=2251113`
  );
  const g = rows[0];

  console.log('[AUDIT][INPUT] Raw DB values for CHC@NYM (id=2251113):');
  console.log('[AUDIT][STATE] awayTeam:', JSON.stringify(g.awayTeam), '| homeTeam:', JSON.stringify(g.homeTeam));
  console.log('[AUDIT][STATE] awayBookSpread:', JSON.stringify(g.awayBookSpread), '| homeBookSpread:', JSON.stringify(g.homeBookSpread));
  console.log('[AUDIT][STATE] bookTotal:', JSON.stringify(g.bookTotal), '| modelTotal:', JSON.stringify(g.modelTotal));
  console.log('[AUDIT][STATE] awayModelSpread:', JSON.stringify(g.awayModelSpread), '| homeModelSpread:', JSON.stringify(g.homeModelSpread));
  console.log('[AUDIT][STATE] modelAwayML:', JSON.stringify(g.modelAwayML), '| modelHomeML:', JSON.stringify(g.modelHomeML));
  console.log('[AUDIT][STATE] modelOverOdds:', JSON.stringify(g.modelOverOdds), '| modelUnderOdds:', JSON.stringify(g.modelUnderOdds));
  console.log('[AUDIT][STATE] modelAwaySpreadOdds:', JSON.stringify(g.modelAwaySpreadOdds), '| modelHomeSpreadOdds:', JSON.stringify(g.modelHomeSpreadOdds));
  console.log('[AUDIT][STATE] awayRunLine:', JSON.stringify(g.awayRunLine), '| homeRunLine:', JSON.stringify(g.homeRunLine));
  console.log('[AUDIT][STATE] modelRunAt:', g.modelRunAt, '(type:', typeof g.modelRunAt, ')');
  console.log('[AUDIT][STATE] publishedModel:', g.publishedModel, '| publishedToFeed:', g.publishedToFeed);
  console.log('[AUDIT][STATE] awayML:', JSON.stringify(g.awayML), '| homeML:', JSON.stringify(g.homeML));
  console.log('[AUDIT][STATE] overOdds:', JSON.stringify(g.overOdds), '| underOdds:', JSON.stringify(g.underOdds));
  console.log('[AUDIT][STATE] gameStatus:', JSON.stringify(g.gameStatus));

  // [AUDIT][STEP] 2. Simulate hasModelData gate
  const modelRunAt = g.modelRunAt;
  const hasModelData = modelRunAt != null;
  console.log('\n[AUDIT][STEP 2] hasModelData gate:');
  console.log('[AUDIT][STATE]   modelRunAt value:', modelRunAt, '| type:', typeof modelRunAt);
  console.log('[AUDIT][STATE]   modelRunAt != null:', modelRunAt != null);
  console.log('[AUDIT][VERIFY]  hasModelData =', hasModelData, hasModelData ? '✅ PASS' : '❌ FAIL — this is why model shows —');

  // [AUDIT][STEP] 3. Simulate mlbMdlAwayLabel / mlbMdlHomeLabel
  const awayRunLine = g.awayRunLine;
  const homeRunLine = g.homeRunLine;
  const awayBookSpread = toNum(g.awayBookSpread);
  const homeBookSpread = toNum(g.homeBookSpread);
  const mlbMdlAwayLabel = (awayRunLine != null && awayRunLine !== '')
    ? awayRunLine
    : (!isNaN(awayBookSpread) ? spreadSign(awayBookSpread) : null);
  const mlbMdlHomeLabel = (homeRunLine != null && homeRunLine !== '')
    ? homeRunLine
    : (!isNaN(homeBookSpread) ? spreadSign(homeBookSpread) : null);
  console.log('\n[AUDIT][STEP 3] MLB RL Label computation:');
  console.log('[AUDIT][STATE]   awayRunLine:', JSON.stringify(awayRunLine), '| awayBookSpread:', awayBookSpread);
  console.log('[AUDIT][STATE]   mlbMdlAwayLabel =', mlbMdlAwayLabel, mlbMdlAwayLabel ? '✅' : '❌ null — RL will show —');
  console.log('[AUDIT][STATE]   homeRunLine:', JSON.stringify(homeRunLine), '| homeBookSpread:', homeBookSpread);
  console.log('[AUDIT][STATE]   mlbMdlHomeLabel =', mlbMdlHomeLabel, mlbMdlHomeLabel ? '✅' : '❌ null — RL will show —');

  // [AUDIT][STEP] 4. Simulate mdlAwaySpreadStr / mdlHomeSpreadStr
  const mdlAwaySpreadOdds = g.modelAwaySpreadOdds;
  const mdlHomeSpreadOdds = g.modelHomeSpreadOdds;
  const mdlAwaySpreadStr = !hasModelData ? '—'
    : (mlbMdlAwayLabel
        ? (mdlAwaySpreadOdds ? `${mlbMdlAwayLabel} (${fmtOddsSign(mdlAwaySpreadOdds)})` : mlbMdlAwayLabel)
        : '—');
  const mdlHomeSpreadStr = !hasModelData ? '—'
    : (mlbMdlHomeLabel
        ? (mdlHomeSpreadOdds ? `${mlbMdlHomeLabel} (${fmtOddsSign(mdlHomeSpreadOdds)})` : mlbMdlHomeLabel)
        : '—');
  console.log('\n[AUDIT][STEP 4] Model spread string:');
  console.log('[AUDIT][STATE]   mdlAwaySpreadOdds:', JSON.stringify(mdlAwaySpreadOdds));
  console.log('[AUDIT][STATE]   mdlHomeSpreadOdds:', JSON.stringify(mdlHomeSpreadOdds));
  console.log('[AUDIT][OUTPUT]  mdlAwaySpreadStr =', mdlAwaySpreadStr);
  console.log('[AUDIT][OUTPUT]  mdlHomeSpreadStr =', mdlHomeSpreadStr);

  // [AUDIT][STEP] 5. Simulate mdlOverTotalStr / mdlUnderTotalStr
  const bookTotal = toNum(g.bookTotal);
  const modelTotal = toNum(g.modelTotal);
  const mdlDisplayTotal = !isNaN(bookTotal) ? bookTotal : modelTotal;
  const mdlOverOdds = g.modelOverOdds;
  const mdlUnderOdds = g.modelUnderOdds;
  const mdlOverTotalStr = !hasModelData ? '—'
    : (!isNaN(mdlDisplayTotal)
        ? (mdlOverOdds ? `${mdlDisplayTotal} (${fmtOddsSign(mdlOverOdds)})` : String(mdlDisplayTotal))
        : '—');
  const mdlUnderTotalStr = !hasModelData ? '—'
    : (!isNaN(mdlDisplayTotal)
        ? (mdlUnderOdds ? `${mdlDisplayTotal} (${fmtOddsSign(mdlUnderOdds)})` : String(mdlDisplayTotal))
        : '—');
  console.log('\n[AUDIT][STEP 5] Model total string:');
  console.log('[AUDIT][STATE]   bookTotal:', bookTotal, '| modelTotal:', modelTotal, '| mdlDisplayTotal:', mdlDisplayTotal);
  console.log('[AUDIT][STATE]   mdlOverOdds:', JSON.stringify(mdlOverOdds), '| mdlUnderOdds:', JSON.stringify(mdlUnderOdds));
  console.log('[AUDIT][OUTPUT]  mdlOverTotalStr =', mdlOverTotalStr);
  console.log('[AUDIT][OUTPUT]  mdlUnderTotalStr =', mdlUnderTotalStr);

  // [AUDIT][STEP] 6. Simulate mdlAwayMl / mdlHomeMl
  const modelAwayML = g.modelAwayML;
  const modelHomeML = g.modelHomeML;
  const mdlAwayMl = hasModelData ? (modelAwayML ?? '—') : '—';
  const mdlHomeMl = hasModelData ? (modelHomeML ?? '—') : '—';
  console.log('\n[AUDIT][STEP 6] Model ML:');
  console.log('[AUDIT][STATE]   modelAwayML:', JSON.stringify(modelAwayML), '| modelHomeML:', JSON.stringify(modelHomeML));
  console.log('[AUDIT][OUTPUT]  mdlAwayMl =', mdlAwayMl);
  console.log('[AUDIT][OUTPUT]  mdlHomeMl =', mdlHomeMl);

  // [AUDIT][OUTPUT] Final summary
  console.log('\n[AUDIT][OUTPUT] ═══════════════════════════════════════════════════');
  console.log('[AUDIT][OUTPUT] FINAL EXPECTED DISPLAY for CHC@NYM:');
  console.log('[AUDIT][OUTPUT]   Run Line Away:', mdlAwaySpreadStr, '| Home:', mdlHomeSpreadStr);
  console.log('[AUDIT][OUTPUT]   Total Over:', mdlOverTotalStr, '| Under:', mdlUnderTotalStr);
  console.log('[AUDIT][OUTPUT]   ML Away:', mdlAwayMl, '| Home:', mdlHomeMl);

  const allGood = mdlAwaySpreadStr !== '—' && mdlHomeSpreadStr !== '—'
    && mdlOverTotalStr !== '—' && mdlUnderTotalStr !== '—'
    && mdlAwayMl !== '—' && mdlHomeMl !== '—';
  console.log('[AUDIT][VERIFY]  All model values populated:', allGood ? '✅ YES' : '❌ NO — root cause identified above');
  console.log('[AUDIT][OUTPUT] ═══════════════════════════════════════════════════');

  await db.end();
})();
