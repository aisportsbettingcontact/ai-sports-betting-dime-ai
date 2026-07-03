/**
 * WC2026 DATE AUDIT — Pinpoint match_date values for 12 target fixtures
 * Run: node server/wc2026/wc2026DateAudit.mjs
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('[FATAL] DATABASE_URL not set'); process.exit(1); }

function parseDbUrl(url) {
  const u = new URL(url);
  return { host: u.hostname, port: parseInt(u.port || '3306'), user: u.username, password: u.password, database: u.pathname.replace(/^\//, '') };
}

const TARGET = [
  'wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091'
];

async function main() {
  const cfg = parseDbUrl(DB_URL);
  const conn = await mysql.createConnection({ ...cfg, ssl: { rejectUnauthorized: false } });
  console.log('[CONNECT] DB connected');

  // 1. Raw match_date + kickoff_utc for all 12 target fixtures
  console.log('\n══ TARGET FIXTURE DATES ══');
  const [rows] = await conn.execute(
    `SELECT match_id, stage, match_date, kickoff_utc, home_team_id, away_team_id, status
     FROM wc2026_matches
     WHERE match_id IN (${TARGET.map(() => '?').join(',')})
     ORDER BY match_id`,
    TARGET
  );
  console.log(`Rows returned: ${rows.length}`);
  for (const r of rows) {
    const md = r.match_date;
    const mdStr = md instanceof Date ? md.toISOString().split('T')[0] : String(md);
    console.log(`[${r.match_id}] stage=${r.stage} | match_date=${mdStr} | kickoff_utc=${r.kickoff_utc} | home=${r.home_team_id} | away=${r.away_team_id}`);
  }

  // 2. Simulate the exact query the router uses for each date Jul 1-7
  console.log('\n══ SIMULATE fixturesByDate QUERY FOR JUL 1-7 ══');
  const testDates = ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05','2026-07-06','2026-07-07'];
  for (const d of testDates) {
    const [res] = await conn.execute(
      `SELECT match_id, stage, match_date, kickoff_utc FROM wc2026_matches WHERE match_date = ? ORDER BY kickoff_utc`,
      [d]
    );
    console.log(`Date ${d}: ${res.length} fixture(s) → ${res.map(r => r.match_id).join(', ') || 'NONE'}`);
  }

  // 3. Show ALL R32/R16 fixtures with their dates
  console.log('\n══ ALL R32/R16 FIXTURES IN DB ══');
  const [koRows] = await conn.execute(
    `SELECT match_id, stage, match_date, kickoff_utc FROM wc2026_matches
     WHERE stage IN ('R32','R16','QF','SF','THIRD','FINAL')
     ORDER BY match_date, kickoff_utc, match_id`
  );
  console.log(`Total KO fixtures: ${koRows.length}`);
  for (const r of koRows) {
    const md = r.match_date;
    const mdStr = md instanceof Date ? md.toISOString().split('T')[0] : String(md);
    console.log(`  [${r.match_id}] stage=${r.stage} | match_date=${mdStr} | kickoff_utc=${r.kickoff_utc}`);
  }

  // 4. Check if match_date is stored as a Date object or string
  console.log('\n══ match_date TYPE CHECK ══');
  const [typeCheck] = await conn.execute(
    `SELECT match_id, match_date, TYPEOF(match_date) as md_type FROM wc2026_matches WHERE match_id = 'wc26-r32-080' LIMIT 1`
  );
  // TYPEOF is not MySQL — use CAST check instead
  const [castCheck] = await conn.execute(
    `SELECT match_id, match_date, 
            DATE_FORMAT(match_date, '%Y-%m-%d') as md_formatted,
            YEAR(match_date) as yr, MONTH(match_date) as mo, DAY(match_date) as dy
     FROM wc2026_matches WHERE match_id = 'wc26-r32-080' LIMIT 1`
  );
  console.log('wc26-r32-080 match_date raw:', castCheck[0]);

  // 5. Full table date distribution
  console.log('\n══ FULL TABLE DATE DISTRIBUTION ══');
  const [distRows] = await conn.execute(
    `SELECT DATE_FORMAT(match_date, '%Y-%m-%d') as md, stage, COUNT(*) as cnt
     FROM wc2026_matches
     GROUP BY md, stage
     ORDER BY md, stage`
  );
  for (const r of distRows) {
    console.log(`  ${r.md} | ${r.stage} | ${r.cnt} fixture(s)`);
  }

  await conn.end();
  console.log('\n[DONE]');
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
