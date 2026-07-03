
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Pull wc_bt_matches
  const [btRows] = await conn.query(`
    SELECT id, tournament_year, match_date, stage,
           home_team, away_team, home_score, away_score,
           result, group_letter, matchday
    FROM wc_bt_matches
    WHERE stage IN ('Group Stage', 'group', 'GROUP_STAGE', 'group_stage')
    ORDER BY tournament_year, match_date, id
  `);
  
  // Pull wc2026_matches
  const [f26Rows] = await conn.query(`
    SELECT f.match_id, f.match_date, f.stage, f.group_letter, f.matchday,
           f.status, f.home_score, f.away_score,
           ht.fifa_code as home_code, at.fifa_code as away_code,
           ht.name as home_name, at.name as away_name
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    WHERE f.stage = 'GROUP'
    ORDER BY f.match_date, f.match_id
  `);
  
  console.log(JSON.stringify({ bt: btRows, f26: f26Rows }));
  await conn.end();
}
main().catch(e => { console.error('DB_ERROR:', e.message); process.exit(1); });
