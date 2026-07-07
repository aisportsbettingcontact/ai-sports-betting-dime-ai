import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, model_version, home_team, away_team, home_win_prob, draw_prob, away_win_prob, proj_home_score, proj_away_score, proj_total, proj_spread, model_home_ml, model_draw_ml, model_away_ml, model_spread, model_total, n_simulations, calculation_method FROM wc2026_model_projections WHERE match_id = 'wc26-r16-094'`);
if (rows.length === 0) console.log("NO MODEL PROJECTION for r16-094");
else for (const r of rows) console.log(JSON.stringify(r, null, 2));
await conn.end();
