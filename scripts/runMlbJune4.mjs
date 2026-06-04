// June 4, 2026 MLB Model Run Script
// Calls runMlbModelForDate with forceRerun=true for all 9 games
import { runMlbModelForDate } from '../server/mlbModelRunner.ts';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const TARGET_DATE = '2026-06-04';

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[INPUT] MLB Model Run — ${TARGET_DATE}`);
  console.log(`[INPUT] Mode: forceRerun=true`);
  console.log(`${'='.repeat(70)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [games] = await conn.execute(`
    SELECT g.id, g.awayTeam, g.homeTeam,
           COALESCE(g.awayStartingPitcher, l.awayPitcherName) AS awayPitcher,
           COALESCE(g.homeStartingPitcher, l.homePitcherName) AS homePitcher
    FROM games g
    LEFT JOIN mlb_lineups l ON l.gameId = g.id
    WHERE g.sport='MLB' AND g.gameDate='${TARGET_DATE}'
    ORDER BY g.id ASC
  `);
  console.log(`[INPUT] Games in DB: ${games.length}`);
  games.forEach(g => {
    console.log(`[INPUT] ✓ ${g.awayTeam}@${g.homeTeam} id=${g.id} pitchers: ${g.awayPitcher||'?'} vs ${g.homePitcher||'?'}`);
  });
  await conn.end();

  console.log(`\n[STEP] Calling runMlbModelForDate('${TARGET_DATE}', { forceRerun: true })`);
  const startMs = Date.now();
  const summary = await runMlbModelForDate(TARGET_DATE, { forceRerun: true });
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n[OUTPUT] Complete in ${elapsed}s`);
  console.log(`[OUTPUT] modeled=${summary.modeled} skipped=${summary.skipped} errors=${summary.errors}`);

  // Post-run validation
  const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
  const [results] = await conn2.execute(`
    SELECT id, awayTeam, homeTeam,
           modelRunAt, modelAwayML, modelHomeML,
           modelAwaySpreadOdds, modelHomeSpreadOdds,
           modelOverOdds, modelUnderOdds, modelOverRate, modelUnderRate,
           modelF5AwayML, modelPNrfi, modelNrfiOdds, modelYrfiOdds,
           modelAwayHrPct, modelHomeHrPct, modelBothHrPct,
           spreadEdge, totalEdge, spreadDiff, totalDiff
    FROM games
    WHERE sport='MLB' AND gameDate='${TARGET_DATE}'
    ORDER BY id ASC
  `);
  await conn2.end();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[VERIFY] Post-run DB validation — ${results.length} games`);

  let pass = 0, fail = 0;
  results.forEach(r => {
    const ok = r.modelRunAt != null && r.modelAwayML != null && r.modelAwaySpreadOdds != null
      && r.modelOverOdds != null && r.modelF5AwayML != null && r.modelPNrfi != null
      && r.modelAwayHrPct != null;
    if (ok) pass++; else fail++;
    const s = ok ? '✓ PASS' : '✗ FAIL';
    console.log(`[${s}] ${r.awayTeam}@${r.homeTeam} id=${r.id}`);
    console.log(`  ML: away=${r.modelAwayML} home=${r.modelHomeML}`);
    console.log(`  RL: away=${r.modelAwaySpreadOdds} home=${r.modelHomeSpreadOdds} edge=${r.spreadEdge||'NO EDGE'}`);
    console.log(`  TOT: over=${r.modelOverOdds} under=${r.modelUnderOdds} rate=${r.modelOverRate}% edge=${r.totalEdge||'NO EDGE'}`);
    console.log(`  F5: awayML=${r.modelF5AwayML} NRFI: p=${r.modelPNrfi} nrfiOdds=${r.modelNrfiOdds} yrfiOdds=${r.modelYrfiOdds}`);
    console.log(`  HR: away=${r.modelAwayHrPct}% home=${r.modelHomeHrPct}% both=${r.modelBothHrPct}%`);
    if (!ok) {
      if (!r.modelRunAt) console.log(`  [FAIL] modelRunAt null — DB write failed`);
      if (!r.modelAwayML) console.log(`  [FAIL] ML odds missing`);
      if (!r.modelAwaySpreadOdds) console.log(`  [FAIL] RL odds missing`);
      if (!r.modelOverOdds) console.log(`  [FAIL] Total odds missing`);
      if (!r.modelF5AwayML) console.log(`  [FAIL] F5 missing`);
      if (!r.modelPNrfi) console.log(`  [FAIL] NRFI missing`);
      if (!r.modelAwayHrPct) console.log(`  [FAIL] HR props missing`);
    }
  });

  console.log(`\n[OUTPUT] ${pass}/${results.length} PASS, ${fail} FAIL`);
  if (fail === 0) {
    console.log(`[VERIFY] PASS — All ${results.length} June 4 games modeled and validated`);
  } else {
    console.log(`[VERIFY] FAIL — ${fail} game(s) have issues`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
