import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Item 1: Check model_primary_spread + model H/A spread odds on r16-089/090/092
const [rows] = await conn.execute(`
  SELECT match_id, 
    book_home_ml, book_away_ml, 
    book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
    model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds,
    model_projected_home_goals, model_projected_away_goals
  FROM wc2026MatchOdds 
  WHERE match_id IN ('wc26-r16-089', 'wc26-r16-090', 'wc26-r16-092')
  ORDER BY match_id
`);

console.log('=== ITEM 1: MODEL vs BOOK SPREAD CONVENTION CHECK ===\n');
for (const r of rows) {
  console.log(`${r.match_id}:`);
  console.log(`  BOOK:  ML home=${r.book_home_ml} away=${r.book_away_ml}`);
  console.log(`  BOOK:  spread=${r.book_primary_spread} H_odds=${r.book_home_primary_spread_odds} A_odds=${r.book_away_primary_spread_odds}`);
  console.log(`  MODEL: spread=${r.model_primary_spread} H_odds=${r.model_home_primary_spread_odds} A_odds=${r.model_away_primary_spread_odds}`);
  console.log(`  MODEL: proj_home_goals=${r.model_projected_home_goals} proj_away_goals=${r.model_projected_away_goals}`);
  
  // Determine if model spread is in home or favorite convention
  // If model_projected_home_goals < model_projected_away_goals, home is underdog
  // In home convention: underdog home should have POSITIVE spread (gets goals)
  // In favorite convention: the value would be negative (favorite gives goals)
  const homeIsUnderdog = r.model_projected_home_goals !== null && r.model_projected_away_goals !== null 
    ? r.model_projected_home_goals < r.model_projected_away_goals 
    : r.book_home_ml > 0;
  
  let modelVerdict = 'N/A';
  if (r.model_primary_spread !== null) {
    if (homeIsUnderdog && r.model_primary_spread > 0) modelVerdict = 'HOME_CONVENTION (correct)';
    else if (homeIsUnderdog && r.model_primary_spread < 0) modelVerdict = 'FAVORITE_CONVENTION (inverted like book)';
    else if (!homeIsUnderdog && r.model_primary_spread < 0) modelVerdict = 'HOME_CONVENTION (correct)';
    else if (!homeIsUnderdog && r.model_primary_spread > 0) modelVerdict = 'FAVORITE_CONVENTION (inverted)';
    else modelVerdict = 'PICK_EM (spread=0)';
  }
  
  console.log(`  HOME IS UNDERDOG: ${homeIsUnderdog}`);
  console.log(`  MODEL VERDICT: ${modelVerdict}`);
  console.log('');
}

await conn.end();
process.exit(0);
