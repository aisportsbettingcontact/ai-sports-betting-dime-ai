/**
 * readMay11Results.mjs
 * Read all May 11 model outputs from the DB and format for delivery.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const db = await mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });

const [rows] = await db.execute(`
  SELECT 
    id, awayTeam, homeTeam, startTimeEst,
    awayStartingPitcher, homeStartingPitcher,
    awayPitcherConfirmed, homePitcherConfirmed,
    -- Full game model
    modelAwayScore, modelHomeScore, modelTotal,
    awayModelSpread, homeModelSpread,
    modelAwaySpreadOdds, modelHomeSpreadOdds,
    awayBookSpread, homeBookSpread, bookTotal,
    awaySpreadOdds, homeSpreadOdds,
    spreadEdge, spreadDiff, totalEdge, totalDiff,
    -- F5 model
    modelF5AwayScore, modelF5HomeScore, modelF5Total,
    -- Inning model
    modelInningTotalExp, modelInningPHomeScores, modelInningPAwayScores, modelInningPNeitherScores,
    -- Projected total
    modelProjTotal
  FROM games
  WHERE gameDate = '2026-05-11' AND sport = 'MLB'
  ORDER BY startTimeEst ASC
`);

console.log(`\n${'='.repeat(80)}`);
console.log(`MAY 11, 2026 MLB MODEL PROJECTIONS`);
console.log(`Updated: 2026 pitcher stats + team batting splits + fg_ml_home_edge +0.03`);
console.log(`${'='.repeat(80)}\n`);

for (const r of rows) {
  const awayScore = parseFloat(r.modelAwayScore);
  const homeScore = parseFloat(r.modelHomeScore);
  const modelMargin = homeScore - awayScore;
  const modelTotal = parseFloat(r.modelTotal);
  const bookTotal = parseFloat(r.bookTotal);
  const totalEdge = parseFloat(r.totalEdge);
  const spreadEdge = parseFloat(r.spreadEdge);
  const spreadDiff = parseFloat(r.spreadDiff);
  const totalDiff = parseFloat(r.totalDiff);

  const awaySpread = parseFloat(r.awayBookSpread);
  const homeSpread = parseFloat(r.homeBookSpread);
  const awayModelSpread = r.awayModelSpread ? parseFloat(r.awayModelSpread) : null;
  const homeModelSpread = r.homeModelSpread ? parseFloat(r.homeModelSpread) : null;

  // Determine model side
  const modelFavHome = modelMargin > 0;
  const modelSpreadStr = modelFavHome
    ? `${r.homeTeam} -${Math.abs(modelMargin).toFixed(2)}`
    : `${r.awayTeam} -${Math.abs(modelMargin).toFixed(2)}`;

  // Total edge direction
  const totalDir = modelTotal > bookTotal ? 'OVER' : 'UNDER';
  const totalEdgeAbs = Math.abs(totalDiff);

  // F5 scores
  const f5Away = r.modelF5AwayScore ? parseFloat(r.modelF5AwayScore) : null;
  const f5Home = r.modelF5HomeScore ? parseFloat(r.modelF5HomeScore) : null;
  const f5Total = r.modelF5Total ? parseFloat(r.modelF5Total) : null;

  // NRFI/YRFI
  const pHome1 = r.modelInningPHomeScores ? JSON.parse(r.modelInningPHomeScores)[0] : null;
  const pAway1 = r.modelInningPAwayScores ? JSON.parse(r.modelInningPAwayScores)[0] : null;
  const pNRFI = (pHome1 !== null && pAway1 !== null)
    ? (1 - pHome1) * (1 - pAway1) : null;

  console.log(`${r.awayTeam} @ ${r.homeTeam} | ${r.startTimeEst}`);
  console.log(`  Pitchers: ${r.awayStartingPitcher || 'TBD'}${r.awayPitcherConfirmed ? ' ✓' : ''} vs ${r.homeStartingPitcher || 'TBD'}${r.homePitcherConfirmed ? ' ✓' : ''}`);
  console.log(`  Model Score:  ${r.awayTeam} ${awayScore.toFixed(2)} — ${r.homeTeam} ${homeScore.toFixed(2)}`);
  console.log(`  Model Spread: ${modelSpreadStr} (book: ${awaySpread > 0 ? '+' : ''}${awaySpread} / ${homeSpread > 0 ? '+' : ''}${homeSpread})`);
  console.log(`  Spread Edge:  ${spreadEdge >= 0 ? '+' : ''}${(spreadEdge * 100).toFixed(1)}% | Diff: ${spreadDiff >= 0 ? '+' : ''}${spreadDiff.toFixed(2)}`);
  console.log(`  Model Total:  ${modelTotal.toFixed(2)} vs Book ${bookTotal} → ${totalDir} by ${totalEdgeAbs.toFixed(2)}`);
  console.log(`  Total Edge:   ${totalEdge >= 0 ? '+' : ''}${(totalEdge * 100).toFixed(1)}%`);
  if (f5Away !== null) {
    console.log(`  F5 Scores:    ${r.awayTeam} ${f5Away.toFixed(2)} — ${r.homeTeam} ${f5Home.toFixed(2)} | F5 Total: ${f5Total.toFixed(2)}`);
  }
  if (pNRFI !== null) {
    console.log(`  NRFI/YRFI:    P(NRFI)=${(pNRFI * 100).toFixed(1)}% P(YRFI)=${((1-pNRFI) * 100).toFixed(1)}%`);
  }
  console.log();
}

// Now pull the multi-market backtest edges for today's games
const [btRows] = await db.execute(`
  SELECT b.gameId, b.market, b.modelSide, b.modelProb, b.bookNoVigProb, b.edge, b.ev,
         b.confidencePassed, b.bookOdds, b.bookLine,
         g.awayTeam, g.homeTeam, g.startTimeEst
  FROM mlb_backtest_results b
  JOIN games g ON g.id = b.gameId
  WHERE g.gameDate = '2026-05-11' AND g.sport = 'MLB'
    AND b.confidencePassed = 1
  ORDER BY g.startTimeEst ASC, b.edge DESC
`);

if (btRows.length > 0) {
  console.log(`${'='.repeat(80)}`);
  console.log(`MAY 11 EDGES (confidencePassed=1)`);
  console.log(`${'='.repeat(80)}\n`);
  for (const r of btRows) {
    const edge = parseFloat(r.edge);
    const modelProb = parseFloat(r.modelProb);
    const nvProb = r.bookNoVigProb ? parseFloat(r.bookNoVigProb) : null;
    const ev = r.ev ? parseFloat(r.ev) : null;
    console.log(`  ${r.awayTeam} @ ${r.homeTeam} | ${r.startTimeEst}`);
    console.log(`    Market: ${r.market} | Side: ${r.modelSide}`);
    console.log(`    Model P: ${(modelProb * 100).toFixed(1)}% | Book NV: ${nvProb !== null ? (nvProb * 100).toFixed(1) + '%' : 'N/A'}`);
    console.log(`    Edge: ${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(2)}% | EV: ${ev !== null ? (ev >= 0 ? '+' : '') + ev.toFixed(2) + '%' : 'N/A'} | Odds: ${r.bookOdds || 'N/A'}`);
    console.log();
  }
} else {
  console.log(`\n[NOTE] No confidencePassed=1 edges found in mlb_backtest_results for May 11.`);
  console.log(`[NOTE] The multi-market backtest runs on historical games only.`);
  console.log(`[NOTE] For today's edges, the model outputs are in the games table above.`);
}

await db.end();
