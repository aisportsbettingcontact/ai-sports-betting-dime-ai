import mysql from 'mysql2/promise';
import 'dotenv/config';

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname, port: parseInt(url.port || '3306'),
  user: url.username, password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

// Get all knockout matchs Jun 28-30 with model projections
const [rows] = await conn.execute(`
  SELECT f.match_id, f.match_date, f.kickoff_utc, f.stage,
         ht.name AS home_name, at.name AS away_name,
         p.proj_home_score, p.proj_away_score,
         p.model_home_ml, p.model_away_ml, p.model_draw_ml,
         p.model_spread, p.model_total,
         p.btts_yes_odds,
         p.to_advance_home_odds, p.to_advance_away_odds,
         p.home_win_prob, p.away_win_prob, p.draw_prob,
         p.n_simulations, p.model_version,
         p.modeled_at, p.created_at, p.is_frozen
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  LEFT JOIN wc2026_model_projections p ON p.match_id = f.match_id
  WHERE f.stage IN ('R32','R16','QF','SF','F')
    AND f.match_date BETWEEN '2026-06-28' AND '2026-06-30'
  ORDER BY f.kickoff_utc, f.match_id
`);

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  KNOCKOUT STAGE — Jun 28-30 — MODELED MATCHS');
console.log('════════════════════════════════════════════════════════════════\n');
console.log(`Found ${rows.length} match(s)\n`);

let modeledCount = 0;
for (const r of rows) {
  const md = r.match_date instanceof Date ? r.match_date.toISOString().split('T')[0] : String(r.match_date).split('T')[0];
  const ku = r.kickoff_utc instanceof Date ? r.kickoff_utc : new Date(r.kickoff_utc);
  const etStr = new Date(ku.getTime() - 4*60*60*1000).toISOString().replace('T',' ').substring(11,16) + ' ET';
  const hasModel = r.model_home_ml !== null;
  if (hasModel) modeledCount++;
  
  console.log(`[${r.match_id}] ${md} ${etStr} | ${r.stage} | ${r.away_name} @ ${r.home_name}`);
  if (hasModel) {
    console.log(`  ✅ MODELED | v${r.model_version} | ${r.n_simulations?.toLocaleString()} sims | frozen=${r.is_frozen}`);
    console.log(`  Proj Score: ${r.proj_away_score} - ${r.proj_home_score} | Total: ${r.model_total} | Spread: ${r.model_spread}`);
    console.log(`  Home ML: ${r.model_home_ml} | Away ML: ${r.model_away_ml} | Draw: ${r.model_draw_ml}`);
    console.log(`  BTTS Yes: ${r.btts_yes_odds} | ToAdv H: ${r.to_advance_home_odds} | ToAdv A: ${r.to_advance_away_odds}`);
    console.log(`  Win%: H=${(r.home_win_prob*100).toFixed(1)}% A=${(r.away_win_prob*100).toFixed(1)}% D=${(r.draw_prob*100).toFixed(1)}%`);
    console.log(`  Modeled at: ${r.modeled_at}`);
  } else {
    console.log(`  ❌ NOT MODELED`);
  }
  console.log();
}

console.log(`Summary: ${modeledCount}/${rows.length} matchs modeled`);

await conn.end();
