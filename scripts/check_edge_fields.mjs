/**
 * check_edge_fields.mjs
 * Dumps all edge-related DB fields for today's games to diagnose edge detection failures.
 */
import { createConnection } from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("NO DATABASE_URL"); process.exit(1); }

const conn = await createConnection(url);

const today = new Date().toISOString().slice(0, 10);
console.log(`[CHECK] Querying games for date >= ${today}`);

const [rows] = await conn.execute(
  `SELECT id, sport, awayTeam, homeTeam, gameDate,
          awayBookSpread, homeBookSpread, bookTotal,
          awayML, homeML,
          modelAwayML, modelHomeML,
          modelAwaySpreadOdds, modelHomeSpreadOdds,
          modelOverOdds, modelUnderOdds,
          modelAwayPLOdds, modelHomePLOdds,
          spreadDiff, totalDiff,
          spreadEdge, totalEdge,
          modelAwayScore, modelHomeScore, modelTotal,
          modelRunAt
   FROM games
   WHERE gameDate >= ?
   ORDER BY sport, gameDate, id
   LIMIT 50`,
  [today]
);

console.log(`\n[CHECK] Found ${rows.length} games\n`);
console.log('='.repeat(120));

for (const r of rows) {
  const spreadDiffNum = r.spreadDiff !== null ? parseFloat(r.spreadDiff) : null;
  const totalDiffNum = r.totalDiff !== null ? parseFloat(r.totalDiff) : null;
  
  // Diagnose edge detection
  const spreadPass = spreadDiffNum === null || isNaN(spreadDiffNum) || spreadDiffNum <= 0;
  const totalPass = totalDiffNum === null || isNaN(totalDiffNum) || totalDiffNum <= 0;
  
  const issues = [];
  if (!r.modelRunAt) issues.push('NO_MODEL_RUN');
  if (spreadDiffNum === null) issues.push('spreadDiff=NULL');
  else if (isNaN(spreadDiffNum)) issues.push('spreadDiff=NaN');
  else if (spreadDiffNum <= 0) issues.push(`spreadDiff=${spreadDiffNum}<=0`);
  if (totalDiffNum === null) issues.push('totalDiff=NULL');
  else if (isNaN(totalDiffNum)) issues.push('totalDiff=NaN');
  else if (totalDiffNum <= 0) issues.push(`totalDiff=${totalDiffNum}<=0`);
  if (!r.spreadEdge && !spreadPass) issues.push('spreadEdge=NULL_but_diff>0');
  if (!r.totalEdge && !totalPass) issues.push('totalEdge=NULL_but_diff>0');
  
  const edgeStatus = spreadPass && totalPass ? '❌ NO EDGE' : '✅ HAS EDGE';
  
  console.log(`[${r.sport}] ${r.awayTeam} @ ${r.homeTeam} | ${r.gameDate} | ${edgeStatus}`);
  console.log(`  spreadDiff=${r.spreadDiff} totalDiff=${r.totalDiff} spreadEdge="${r.spreadEdge}" totalEdge="${r.totalEdge}"`);
  console.log(`  modelAwayML=${r.modelAwayML} modelHomeML=${r.modelHomeML}`);
  console.log(`  modelAwaySpreadOdds=${r.modelAwaySpreadOdds} modelHomeSpreadOdds=${r.modelHomeSpreadOdds}`);
  console.log(`  modelOverOdds=${r.modelOverOdds} modelUnderOdds=${r.modelUnderOdds}`);
  console.log(`  modelAwayPLOdds=${r.modelAwayPLOdds} modelHomePLOdds=${r.modelHomePLOdds}`);
  console.log(`  bookSpread=${r.awayBookSpread}/${r.homeBookSpread} bookTotal=${r.bookTotal} ML=${r.awayML}/${r.homeML}`);
  if (issues.length > 0) console.log(`  ⚠️  ISSUES: ${issues.join(', ')}`);
  console.log();
}

// Summary
const withEdge = rows.filter(r => {
  const sd = r.spreadDiff !== null ? parseFloat(r.spreadDiff) : null;
  const td = r.totalDiff !== null ? parseFloat(r.totalDiff) : null;
  return (sd !== null && !isNaN(sd) && sd > 0) || (td !== null && !isNaN(td) && td > 0);
});
const noEdge = rows.filter(r => {
  const sd = r.spreadDiff !== null ? parseFloat(r.spreadDiff) : null;
  const td = r.totalDiff !== null ? parseFloat(r.totalDiff) : null;
  return (sd === null || isNaN(sd) || sd <= 0) && (td === null || isNaN(td) || td <= 0);
});

console.log('='.repeat(120));
console.log(`[SUMMARY] Total: ${rows.length} | With edge: ${withEdge.length} | No edge: ${noEdge.length}`);
console.log(`[SUMMARY] Games with NULL spreadDiff: ${rows.filter(r => r.spreadDiff === null).length}`);
console.log(`[SUMMARY] Games with NULL totalDiff: ${rows.filter(r => r.totalDiff === null).length}`);
console.log(`[SUMMARY] Games with NULL spreadEdge: ${rows.filter(r => r.spreadEdge === null).length}`);
console.log(`[SUMMARY] Games with NULL totalEdge: ${rows.filter(r => r.totalEdge === null).length}`);
console.log(`[SUMMARY] Games with no modelRunAt: ${rows.filter(r => !r.modelRunAt).length}`);

await conn.end();
