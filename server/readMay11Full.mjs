/**
 * readMay11Full.mjs
 * Full May 11 model output reader — pulls from games + mlb_game_backtest
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const db = await mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });

// Check mlb_game_backtest schema
const [btCols] = await db.execute('DESCRIBE mlb_game_backtest');
const btColNames = btCols.map(c => c.Field);
console.log('[SCHEMA] mlb_game_backtest cols:', btColNames.join(', '));
console.log();

// Get May 11 game IDs
const [games] = await db.execute(`
  SELECT id, awayTeam, homeTeam, startTimeEst,
         awayStartingPitcher, homeStartingPitcher,
         awayPitcherConfirmed, homePitcherConfirmed,
         modelAwayScore, modelHomeScore, modelTotal,
         awayModelSpread, homeModelSpread,
         awayBookSpread, homeBookSpread, bookTotal,
         modelF5AwayScore, modelF5HomeScore, modelF5Total,
         modelInningPHomeScores, modelInningPAwayScores
  FROM games
  WHERE gameDate = '2026-05-11' AND sport = 'MLB'
  ORDER BY startTimeEst ASC
`);

console.log(`${'='.repeat(80)}`);
console.log(`MAY 11, 2026 MLB MODEL PROJECTIONS (2026 Data + All Calibration Fixes)`);
console.log(`${'='.repeat(80)}\n`);

for (const g of games) {
  const awayScore = parseFloat(g.modelAwayScore);
  const homeScore = parseFloat(g.modelHomeScore);
  const modelMargin = homeScore - awayScore;
  const modelTotal = parseFloat(g.modelTotal);
  const bookTotal = parseFloat(g.bookTotal);
  const totalDiff = modelTotal - bookTotal;

  const f5Away = g.modelF5AwayScore ? parseFloat(g.modelF5AwayScore) : null;
  const f5Home = g.modelF5HomeScore ? parseFloat(g.modelF5HomeScore) : null;
  const f5Total = g.modelF5Total ? parseFloat(g.modelF5Total) : null;

  // NRFI from inning probabilities
  let pNRFI = null;
  if (g.modelInningPHomeScores && g.modelInningPAwayScores) {
    try {
      const pH = JSON.parse(g.modelInningPHomeScores);
      const pA = JSON.parse(g.modelInningPAwayScores);
      pNRFI = (1 - pH[0]) * (1 - pA[0]);
    } catch {}
  }

  const modelFavHome = modelMargin > 0;
  const modelFav = modelFavHome ? g.homeTeam : g.awayTeam;
  const modelDog = modelFavHome ? g.awayTeam : g.homeTeam;

  console.log(`${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst}`);
  console.log(`  Pitchers: ${g.awayStartingPitcher || 'TBD'}${g.awayPitcherConfirmed ? ' ✓' : ''} vs ${g.homeStartingPitcher || 'TBD'}${g.homePitcherConfirmed ? ' ✓' : ''}`);
  console.log(`  Model Score:  ${g.awayTeam} ${awayScore.toFixed(2)} — ${g.homeTeam} ${homeScore.toFixed(2)}`);
  console.log(`  Model Margin: ${modelFav} by ${Math.abs(modelMargin).toFixed(2)} runs`);
  console.log(`  Book Spread:  ${g.awayTeam} ${g.awayBookSpread > 0 ? '+' : ''}${g.awayBookSpread} / ${g.homeTeam} ${g.homeBookSpread > 0 ? '+' : ''}${g.homeBookSpread}`);
  console.log(`  Model Total:  ${modelTotal.toFixed(2)} vs Book ${bookTotal} → ${totalDiff >= 0 ? 'OVER' : 'UNDER'} by ${Math.abs(totalDiff).toFixed(2)}`);
  if (f5Away !== null) {
    const f5Margin = f5Home - f5Away;
    const f5Fav = f5Margin > 0 ? g.homeTeam : g.awayTeam;
    console.log(`  F5 Scores:    ${g.awayTeam} ${f5Away.toFixed(2)} — ${g.homeTeam} ${f5Home.toFixed(2)} | F5 Total: ${f5Total.toFixed(2)} | F5 Fav: ${f5Fav} by ${Math.abs(f5Margin).toFixed(2)}`);
  }
  if (pNRFI !== null) {
    const pYRFI = 1 - pNRFI;
    const nrfiVerdict = pNRFI >= 0.58 ? '⚡ NRFI EDGE' : pYRFI >= 0.62 ? '⚡ YRFI EDGE' : '';
    console.log(`  NRFI/YRFI:    P(NRFI)=${(pNRFI * 100).toFixed(1)}% P(YRFI)=${(pYRFI * 100).toFixed(1)}% ${nrfiVerdict}`);
  }
  console.log();
}

// Pull game backtest data for May 11
const gameIds = games.map(g => g.id);
if (gameIds.length > 0) {
  const placeholders = gameIds.map(() => '?').join(',');
  const [btRows] = await db.execute(
    `SELECT * FROM mlb_game_backtest WHERE gameId IN (${placeholders}) ORDER BY gameId`,
    gameIds
  );

  if (btRows.length > 0) {
    console.log(`${'='.repeat(80)}`);
    console.log(`MAY 11 MULTI-MARKET BACKTEST RESULTS`);
    console.log(`${'='.repeat(80)}\n`);

    // Group by gameId
    const byGame = {};
    for (const r of btRows) {
      if (!byGame[r.gameId]) byGame[r.gameId] = [];
      byGame[r.gameId].push(r);
    }

    for (const g of games) {
      const rows = byGame[g.id] || [];
      if (rows.length === 0) continue;
      console.log(`${g.awayTeam} @ ${g.homeTeam}`);
      for (const r of rows) {
        const cols = Object.keys(r).filter(k => k !== 'gameId' && k !== 'id' && k !== 'createdAt' && k !== 'updatedAt');
        const vals = cols.map(k => `${k}=${r[k]}`).join(' | ');
        console.log(`  ${vals}`);
      }
      console.log();
    }
  } else {
    console.log(`[NOTE] No mlb_game_backtest rows for May 11 games yet.`);
    console.log(`[NOTE] The multi-market evaluator runs on completed games only.`);
    console.log(`[NOTE] Today's edges are derived from the model scores above.`);
  }
}

// Pull market-level model outputs from games table (ML/RL/Total probabilities)
console.log(`\n${'='.repeat(80)}`);
console.log(`MAY 11 MODEL PROBABILITIES & MARKET EDGES`);
console.log(`${'='.repeat(80)}\n`);

// Check if games table has ML probability columns
const [gCols] = await db.execute('DESCRIBE games');
const gColNames = gCols.map(c => c.Field);
const mlProbCols = gColNames.filter(c => 
  c.includes('Prob') || c.includes('prob') || c.includes('pHome') || c.includes('pAway') ||
  c.includes('noVig') || c.includes('NoVig') || c.includes('modelML') || c.includes('modelRl')
);
console.log('[SCHEMA] Probability/ML cols:', mlProbCols.join(', '));

if (mlProbCols.length > 0) {
  const [probRows] = await db.execute(`
    SELECT id, awayTeam, homeTeam, ${mlProbCols.join(', ')}
    FROM games
    WHERE gameDate = '2026-05-11' AND sport = 'MLB'
    ORDER BY startTimeEst ASC
  `);
  for (const r of probRows) {
    console.log(`\n${r.awayTeam} @ ${r.homeTeam}`);
    for (const col of mlProbCols) {
      if (r[col] !== null && r[col] !== undefined) {
        const val = typeof r[col] === 'number' ? r[col].toFixed(4) : r[col];
        console.log(`  ${col}: ${val}`);
      }
    }
  }
}

await db.end();
