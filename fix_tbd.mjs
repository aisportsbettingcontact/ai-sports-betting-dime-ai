import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ESPN truth:
// 760509 (wc26-r16-095): HOME = Argentina (arg), AWAY = Egypt (egy)
// 760508 (wc26-r16-096): HOME = Switzerland (sui), AWAY = Colombia (col)

// PRE-WRITE: show current state
console.log("=== PRE-WRITE STATE ===");
const [pre] = await conn.query(`SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id IN ('wc26-r16-095','wc26-r16-096')`);
for (const r of pre) console.log(JSON.stringify(r));

// UPDATE r16-095: home = arg (was tbd), away = egy (already correct)
const [r1] = await conn.query(`UPDATE wc2026_matches SET home_team_id = 'arg' WHERE match_id = 'wc26-r16-095' AND home_team_id = 'tbd'`);
console.log(`\nr16-095 update: ${r1.affectedRows} row(s) affected (home_team_id tbd → arg)`);

// UPDATE r16-096: home = sui (already correct), away = col (was tbd)
const [r2] = await conn.query(`UPDATE wc2026_matches SET away_team_id = 'col' WHERE match_id = 'wc26-r16-096' AND away_team_id = 'tbd'`);
console.log(`r16-096 update: ${r2.affectedRows} row(s) affected (away_team_id tbd → col)`);

// POST-WRITE: verify
console.log("\n=== POST-WRITE STATE ===");
const [post] = await conn.query(`SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id IN ('wc26-r16-095','wc26-r16-096')`);
for (const r of post) console.log(JSON.stringify(r));

await conn.end();
