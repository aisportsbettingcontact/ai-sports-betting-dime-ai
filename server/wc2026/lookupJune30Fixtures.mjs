import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await db.execute(`
  SELECT f.fixture_id, f.match_date, f.kickoff_utc, f.stage, 
         f.home_team_id, f.away_team_id, f.display_order,
         ht.name as home_name, at.name as away_name
  FROM wc2026_fixtures f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_date = '2026-06-30'
  ORDER BY f.kickoff_utc
`);

console.log('\n=== JUNE 30 FIXTURES ===');
rows.forEach(r => {
  console.log(`${r.fixture_id} | ${r.kickoff_utc} | HOME: ${r.home_name} (${r.home_team_id}) | AWAY: ${r.away_name} (${r.away_team_id}) | stage=${r.stage} | order=${r.display_order}`);
});

// Also check existing model projections and frozen book odds for June 30
const fids = rows.map(r => r.fixture_id);
if (fids.length > 0) {
  const ph = fids.map(() => '?').join(',');
  const [mp] = await db.execute(`SELECT fixture_id, model_version, is_frozen FROM wc2026_model_projections WHERE fixture_id IN (${ph})`, fids);
  const [bo] = await db.execute(`SELECT fixture_id, book_source, book_home_ml FROM wc2026_frozen_book_odds WHERE fixture_id IN (${ph})`, fids);
  console.log('\n=== EXISTING MODEL PROJECTIONS ===');
  mp.forEach(r => console.log(JSON.stringify(r)));
  console.log('\n=== EXISTING FROZEN BOOK ODDS ===');
  bo.forEach(r => console.log(JSON.stringify(r)));
}

await db.end();
process.exit(0);
