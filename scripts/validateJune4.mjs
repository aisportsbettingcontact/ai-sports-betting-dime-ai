import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  const [rows] = await conn.execute(`
    SELECT g.id, g.awayTeam, g.homeTeam,
           (g.modelRunAt IS NOT NULL) as hasModel,
           (g.modelAwayML IS NOT NULL) as hasML,
           (g.modelAwaySpreadOdds IS NOT NULL) as hasRL,
           (g.modelOverOdds IS NOT NULL) as hasTotal,
           (g.modelF5AwayML IS NOT NULL) as hasF5,
           (g.modelPNrfi IS NOT NULL) as hasNrfi,
           (g.modelAwayHrPct IS NOT NULL) as hasHrProps,
           (SELECT COUNT(*) FROM mlb_strikeout_props k WHERE k.gameId = g.id) > 0 as hasKProps,
           g.spreadEdge, g.totalEdge,
           g.modelAwayML, g.modelHomeML,
           g.modelAwaySpreadOdds, g.modelHomeSpreadOdds,
           g.modelOverOdds, g.modelUnderOdds, g.modelOverRate,
           g.awayRunLine, g.homeRunLine, g.awayRunLineOdds, g.homeRunLineOdds,
           g.awayML, g.homeML, g.overOdds, g.underOdds, g.bookTotal,
           g.modelAwayHrPct, g.modelHomeHrPct, g.modelBothHrPct,
           g.modelAwayExpHr, g.modelHomeExpHr,
           g.modelNrfiOdds, g.modelYrfiOdds, g.modelPNrfi,
           g.modelF5AwayML, g.modelF5HomeML, g.modelF5OverOdds, g.modelF5UnderOdds
    FROM games g
    WHERE g.sport='MLB' AND g.gameDate='2026-06-04'
    ORDER BY g.id ASC
  `);

  await conn.end();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(80));
  console.log('[AUDIT] June 4, 2026 MLB — Full DB Validation');
  console.log('='.repeat(80) + '\n');

  for (const r of rows) {
    const ok = r.hasModel && r.hasML && r.hasRL && r.hasTotal && r.hasF5 && r.hasNrfi && r.hasHrProps;
    if (ok) pass++; else fail++;
    const s = ok ? 'PASS' : 'FAIL';
    console.log(`[${s}] ${r.awayTeam}@${r.homeTeam} id=${r.id} K=${r.hasKProps ? 'YES' : 'NO'}`);
    console.log(`  Book ML:    away=${r.awayML}  home=${r.homeML}`);
    console.log(`  Model ML:   away=${r.modelAwayML}  home=${r.modelHomeML}`);
    console.log(`  Book RL:    ${r.awayTeam} ${r.awayRunLine} (${r.awayRunLineOdds}) | ${r.homeTeam} ${r.homeRunLine} (${r.homeRunLineOdds})`);
    console.log(`  Model RL:   away=${r.modelAwaySpreadOdds}  home=${r.modelHomeSpreadOdds}  edge=${r.spreadEdge || 'NO EDGE'}`);
    console.log(`  Book O/U:   ${r.bookTotal} (over=${r.overOdds} under=${r.underOdds})`);
    console.log(`  Model O/U:  over=${r.modelOverOdds}  under=${r.modelUnderOdds}  rate=${r.modelOverRate}%  edge=${r.totalEdge || 'NO EDGE'}`);
    console.log(`  F5:         awayML=${r.modelF5AwayML}  homeML=${r.modelF5HomeML}  over=${r.modelF5OverOdds}  under=${r.modelF5UnderOdds}`);
    console.log(`  NRFI:       pNrfi=${r.modelPNrfi}  nrfiOdds=${r.modelNrfiOdds}  yrfiOdds=${r.modelYrfiOdds}`);
    console.log(`  HR Props:   away=${r.modelAwayHrPct}%  home=${r.modelHomeHrPct}%  both=${r.modelBothHrPct}%  expAway=${r.modelAwayExpHr}  expHome=${r.modelHomeExpHr}`);

    if (!ok) {
      const missing = [];
      if (!r.hasModel) missing.push('modelRunAt');
      if (!r.hasML) missing.push('ML odds');
      if (!r.hasRL) missing.push('RL odds');
      if (!r.hasTotal) missing.push('Total odds');
      if (!r.hasF5) missing.push('F5');
      if (!r.hasNrfi) missing.push('NRFI');
      if (!r.hasHrProps) missing.push('HR props');
      console.log(`  [MISSING] ${missing.join(', ')}`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log(`[SUMMARY] ${pass}/${rows.length} PASS  |  ${fail} FAIL`);
  console.log('='.repeat(80));

  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
