import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check what's NULL in wc2026_model_projections for Jul 5
const [rows] = await conn.query(`SELECT * FROM wc2026_model_projections WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);

for (const row of rows) {
  const nullCols = Object.entries(row).filter(([k, v]) => v === null).map(([k]) => k);
  console.log(`\n${row.match_id} (${row.home_team} vs ${row.away_team}):`);
  console.log(`  Populated: ${Object.entries(row).filter(([k, v]) => v !== null).length}/${Object.keys(row).length}`);
  console.log(`  NULL (${nullCols.length}): ${nullCols.join(', ')}`);
  console.log(`  Lambda: H=${row.home_lambda} A=${row.away_lambda}`);
}

// Now compute and populate the missing probability fields from lambdas
// Using Dixon-Coles Poisson model
function poissonPmf(k, lambda) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

for (const row of rows) {
  const hLam = row.home_lambda;
  const aLam = row.away_lambda;
  const rho = 0.055; // DC correlation parameter from v19 engine
  
  // Build score matrix 0-9
  let homeWin = 0, draw = 0, awayWin = 0;
  let over25 = 0, under25 = 0;
  let bttsYes = 0, bttsNo = 0;
  const scoreProbs = {};
  
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      let p = poissonPmf(h, hLam) * poissonPmf(a, aLam);
      // DC correction for low scores
      if (h === 0 && a === 0) p *= (1 + rho * hLam * aLam);
      else if (h === 0 && a === 1) p *= (1 - rho * hLam);
      else if (h === 1 && a === 0) p *= (1 - rho * aLam);
      else if (h === 1 && a === 1) p *= (1 + rho);
      
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      
      if (h + a > 2.5) over25 += p;
      else under25 += p;
      
      if (h > 0 && a > 0) bttsYes += p;
      else bttsNo += p;
      
      scoreProbs[`${h}-${a}`] = p;
    }
  }
  
  // Normalize
  const total = homeWin + draw + awayWin;
  homeWin /= total; draw /= total; awayWin /= total;
  const ouTotal = over25 + under25;
  over25 /= ouTotal; under25 /= ouTotal;
  const bttsTotal = bttsYes + bttsNo;
  bttsYes /= bttsTotal; bttsNo /= bttsTotal;
  
  // Advance probability (home_win + 0.5*draw for knockout approximation)
  const homeAdvance = homeWin + 0.5 * draw;
  const awayAdvance = awayWin + 0.5 * draw;
  
  // Top correct scores
  const sortedScores = Object.entries(scoreProbs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  
  console.log(`\n═══ COMPUTED PROBABILITIES for ${row.match_id} ═══`);
  console.log(`  1X2: H=${(homeWin*100).toFixed(2)}% D=${(draw*100).toFixed(2)}% A=${(awayWin*100).toFixed(2)}%`);
  console.log(`  O/U 2.5: Over=${(over25*100).toFixed(2)}% Under=${(under25*100).toFixed(2)}%`);
  console.log(`  BTTS: Yes=${(bttsYes*100).toFixed(2)}% No=${(bttsNo*100).toFixed(2)}%`);
  console.log(`  Advance: H=${(homeAdvance*100).toFixed(2)}% A=${(awayAdvance*100).toFixed(2)}%`);
  console.log(`  Top CS: ${sortedScores.map(([s, p]) => `${s}(${(p*100).toFixed(1)}%)`).join(', ')}`);
  
  // Update the projections table
  await conn.query(`
    UPDATE wc2026_model_projections SET
      home_win_prob = ?,
      draw_prob = ?,
      away_win_prob = ?,
      proj_total = ?,
      proj_spread = ?,
      over_0_5 = ?,
      over_1_5 = ?,
      over_2_5 = ?,
      under_2_5 = ?
    WHERE match_id = ?
  `, [
    homeWin, draw, awayWin,
    hLam + aLam,
    hLam - aLam,
    1 - poissonPmf(0, hLam) * poissonPmf(0, aLam), // P(total > 0.5)
    1 - (poissonPmf(0, hLam) * poissonPmf(0, aLam) + poissonPmf(1, hLam) * poissonPmf(0, aLam) + poissonPmf(0, hLam) * poissonPmf(1, aLam)), // P(total > 1.5)
    over25,
    under25,
    row.match_id
  ]);
  console.log(`  ✅ Updated wc2026_model_projections for ${row.match_id}`);
}

// Also check wc2026MatchOdds DC columns
console.log('\n═══ CHECKING wc2026MatchOdds DC COLUMNS ═══');
const [oddsRows] = await conn.query(`SELECT match_id, home_team, away_team FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);
// Get actual column names
const [cols] = await conn.query(`SHOW COLUMNS FROM wc2026MatchOdds WHERE Field LIKE '%win_draw%' OR Field LIKE '%no_draw%' OR Field LIKE '%lambda%' OR Field LIKE '%version%' OR Field LIKE '%dc%'`);
console.log('DC/Lambda/Version columns:', cols.map(c => c.Field).join(', '));

await conn.end();
process.exit(0);
