// June 6, 2026 MLB Model Run Script
// Calls runMlbModelForDate with forceRerun=true for all 15 games
// Full scope: Full Game + F5 + NRFI/YRFI + HR Props + K-Props
import { runMlbModelForDate } from '../server/mlbModelRunner.ts';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const TARGET_DATE = '2026-06-06';

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[INPUT] MLB Model Run — ${TARGET_DATE}`);
  console.log(`[INPUT] Mode: forceRerun=true`);
  console.log(`[INPUT] Scope: Full Game + F5 + NRFI/YRFI + HR Props`);
  console.log(`${'='.repeat(70)}\n`);

  // ── Phase 1: Pre-run DB audit ──────────────────────────────────────────
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [games] = await conn.execute(`
    SELECT g.id, g.awayTeam, g.homeTeam,
           COALESCE(g.awayStartingPitcher, l.awayPitcherName) AS awayPitcher,
           COALESCE(g.homeStartingPitcher, l.homePitcherName) AS homePitcher,
           g.awayML, g.homeML, g.awayRunLine, g.awayRunLineOdds,
           g.homeRunLine, g.homeRunLineOdds, g.bookTotal,
           g.f5AwayML, g.f5HomeML, g.f5Total,
           g.nrfiOverOdds, g.yrfiUnderOdds
    FROM games g
    LEFT JOIN mlb_lineups l ON l.gameId = g.id
    WHERE g.sport='MLB' AND g.gameDate='${TARGET_DATE}'
    ORDER BY g.id ASC
  `);
  console.log(`[INPUT] Games in DB: ${games.length}`);
  if (games.length !== 15) {
    console.error(`[FAIL] Expected 15 games, found ${games.length} — aborting`);
    await conn.end();
    process.exit(1);
  }
  games.forEach(g => {
    const mlOk = g.awayML && g.homeML ? '✓' : '✗';
    const rlOk = g.awayRunLine && g.awayRunLineOdds ? '✓' : '✗';
    const totOk = g.bookTotal ? '✓' : '✗';
    const f5Ok = g.f5AwayML ? '✓' : '○';
    const nrfiOk = g.nrfiOverOdds ? '✓' : '○';
    console.log(`[INPUT] ${mlOk}ML ${rlOk}RL ${totOk}TOT ${f5Ok}F5 ${nrfiOk}NRFI | ${g.awayTeam}@${g.homeTeam} id=${g.id} pitchers=${g.awayPitcher||'?'}/${g.homePitcher||'?'}`);
  });
  await conn.end();

  // ── Phase 2: Run model ─────────────────────────────────────────────────
  console.log(`\n[STEP] Calling runMlbModelForDate('${TARGET_DATE}', { forceRerun: true })`);
  console.log(`[STEP] Monte Carlo: 400,000 simulations per game`);
  const startMs = Date.now();
  const summary = await runMlbModelForDate(TARGET_DATE, { forceRerun: true });
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n[OUTPUT] Complete in ${elapsed}s`);
  console.log(`[OUTPUT] modeled=${summary.modeled} skipped=${summary.skipped} errors=${summary.errors}`);

  if (summary.errors > 0) {
    console.error(`[FAIL] ${summary.errors} error(s) during model run`);
    process.exit(1);
  }

  // ── Phase 3: Post-run validation ───────────────────────────────────────
  const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
  const [results] = await conn2.execute(`
    SELECT id, awayTeam, homeTeam,
           modelRunAt, modelAwayML, modelHomeML,
           modelAwaySpreadOdds, modelHomeSpreadOdds,
           modelOverOdds, modelUnderOdds, modelOverRate, modelUnderRate,
           modelAwayWinPct, modelHomeWinPct,
           modelAwayScore, modelHomeScore,
           modelF5AwayML, modelF5HomeML, modelF5OverOdds, modelF5UnderOdds,
           modelF5AwayScore, modelF5HomeScore,
           modelPNrfi, modelNrfiOdds, modelYrfiOdds,
           modelAwayHrPct, modelHomeHrPct, modelBothHrPct,
           modelAwayExpHr, modelHomeExpHr,
           spreadEdge, totalEdge, spreadDiff, totalDiff
    FROM games
    WHERE sport='MLB' AND gameDate='${TARGET_DATE}'
    ORDER BY id ASC
  `);
  await conn2.end();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[VERIFY] Post-run DB validation — ${results.length} games`);
  console.log(`${'='.repeat(70)}`);

  let pass = 0, fail = 0;
  results.forEach(r => {
    const checks = {
      modelRunAt:         r.modelRunAt != null,
      awayML:             r.modelAwayML != null,
      homeML:             r.modelHomeML != null,
      awaySpreadOdds:     r.modelAwaySpreadOdds != null,
      homeSpreadOdds:     r.modelHomeSpreadOdds != null,
      overOdds:           r.modelOverOdds != null,
      underOdds:          r.modelUnderOdds != null,
      overRate:           r.modelOverRate != null,
      awayScore:          r.modelAwayScore != null,
      homeScore:          r.modelHomeScore != null,
      f5AwayML:           r.modelF5AwayML != null,
      f5OverOdds:         r.modelF5OverOdds != null,
      nrfiP:              r.modelPNrfi != null,
      nrfiOdds:           r.modelNrfiOdds != null,
      yrfiOdds:           r.modelYrfiOdds != null,
      awayHrPct:          r.modelAwayHrPct != null,
      homeHrPct:          r.modelHomeHrPct != null,
    };
    const ok = Object.values(checks).every(Boolean);
    if (ok) pass++; else fail++;
    const s = ok ? '✓ PASS' : '✗ FAIL';
    console.log(`\n[${s}] ${r.awayTeam}@${r.homeTeam} id=${r.id}`);
    console.log(`  [STATE] Scores: ${r.modelAwayScore} - ${r.modelHomeScore} | WinPct: away=${r.modelAwayWinPct}% home=${r.modelHomeWinPct}%`);
    console.log(`  [STATE] ML:  away=${r.modelAwayML} home=${r.modelHomeML}`);
    console.log(`  [STATE] RL:  away=${r.modelAwaySpreadOdds} home=${r.modelHomeSpreadOdds} | edge=${r.spreadEdge||'NO EDGE'} diff=${r.spreadDiff}`);
    console.log(`  [STATE] TOT: over=${r.modelOverOdds}(${r.modelOverRate}%) under=${r.modelUnderOdds} | edge=${r.totalEdge||'NO EDGE'} diff=${r.totalDiff}`);
    console.log(`  [STATE] F5:  awayML=${r.modelF5AwayML} homeML=${r.modelF5HomeML} scores=${r.modelF5AwayScore}-${r.modelF5HomeScore} over=${r.modelF5OverOdds} under=${r.modelF5UnderOdds}`);
    console.log(`  [STATE] NRFI: p=${r.modelPNrfi}% nrfiOdds=${r.modelNrfiOdds} yrfiOdds=${r.modelYrfiOdds}`);
    console.log(`  [STATE] HR:  away=${r.modelAwayHrPct}%(exp=${r.modelAwayExpHr}) home=${r.modelHomeHrPct}%(exp=${r.modelHomeExpHr}) both=${r.modelBothHrPct}%`);
    if (!ok) {
      Object.entries(checks).forEach(([k, v]) => {
        if (!v) console.log(`  [FAIL] ${k} is null — field missing`);
      });
    }
  });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[OUTPUT] ${pass}/${results.length} PASS, ${fail} FAIL`);
  if (fail === 0) {
    console.log(`[VERIFY] PASS — All ${results.length} June 6 games modeled and validated`);
    console.log(`[VERIFY] Full Game ✓ | F5 ✓ | NRFI/YRFI ✓ | HR Props ✓`);
  } else {
    console.log(`[VERIFY] FAIL — ${fail} game(s) have issues`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  console.error(e.stack);
  process.exit(1);
});
