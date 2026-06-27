import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

const [rows] = await db.execute(`
  SELECT 
    id, game_pk, away_team, home_team,
    projected_away_score, projected_home_score,
    model_away_ml, model_home_ml,
    away_model_spread, home_model_spread,
    model_away_spread_odds, model_home_spread_odds,
    model_total, model_over_odds, model_under_odds,
    model_run_at, game_date
  FROM mlb_games
  WHERE game_date = '2026-06-27'
    AND model_run_at IS NOT NULL
  ORDER BY game_date, id
`);

console.log('[VALIDATE] June 27, 2026 MLB — DB Rows with Model Output');
console.log('='.repeat(90));
console.log(`Found: ${rows.length} rows`);
console.log('');

function mlToProb(ml) {
  if (!ml) return 0;
  const n = Number(ml);
  if (n < 0) return (-n) / (-n + 100);
  return 100 / (n + 100);
}

let rlViolations = 0;
let nullCount = 0;

for (const r of rows) {
  const projA = parseFloat(r.projected_away_score || '0');
  const projH = parseFloat(r.projected_home_score || '0');
  const total = projA + projH;
  const awaySpread = parseFloat(r.away_model_spread || '0');
  const favIsAway = awaySpread < 0;

  if (!r.model_away_ml || !r.model_home_ml) {
    nullCount++;
    console.log(`[NULL] ${r.away_team}@${r.home_team} (pk=${r.game_pk}) — NULL model outputs`);
    continue;
  }

  const favML = favIsAway ? Number(r.model_away_ml) : Number(r.model_home_ml);
  const favRLOdds = favIsAway ? Number(r.model_away_spread_odds) : Number(r.model_home_spread_odds);
  const favMLProb = mlToProb(favML);
  const favRLProb = mlToProb(favRLOdds);
  const rlOk = favRLProb <= favMLProb + 0.001;
  if (!rlOk) rlViolations++;

  const status = rlOk ? 'PASS' : 'FAIL-RL';
  console.log(`[${status}] ${r.away_team}@${r.home_team} (pk=${r.game_pk})`);
  console.log(`  Proj: ${projA.toFixed(2)}-${projH.toFixed(2)} (total ${total.toFixed(2)})`);
  console.log(`  Model ML: A${r.model_away_ml} / H${r.model_home_ml}`);
  console.log(`  Model RL: A${r.away_model_spread}(${r.model_away_spread_odds}) / H${r.home_model_spread}(${r.model_home_spread_odds})`);
  console.log(`  Model Total: ${r.model_total} O${r.model_over_odds}/U${r.model_under_odds}`);
  console.log(`  ModelRunAt: ${r.model_run_at}`);
}

console.log('');
console.log(`[SUMMARY] Total: ${rows.length}/15 | NULL: ${nullCount} | RL violations: ${rlViolations}`);
if (rlViolations === 0 && nullCount === 0 && rows.length === 15) {
  console.log('[VERIFY] PASS — All 15 games modeled, 0 RL violations, 0 nulls');
} else {
  console.log('[VERIFY] ISSUES DETECTED — review above');
}

await db.end();
