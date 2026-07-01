import mysql from 'mysql2/promise';
import 'dotenv/config';

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
for (const t of ['wc2026_espn_team_stats','wc2026_espn_shot_map','wc2026_espn_player_stats','wc2026_espn_expected_goals']) {
  const [r] = await c.execute(`DESCRIBE ${t}`);
  console.log(`\n=== ${t} ===`);
  console.log(r.map(x=>x.Field).join(', '));
  const [s] = await c.execute(`SELECT * FROM ${t} LIMIT 1`);
  if (s[0]) console.log('SAMPLE:', JSON.stringify(s[0]));
}
await c.end();
