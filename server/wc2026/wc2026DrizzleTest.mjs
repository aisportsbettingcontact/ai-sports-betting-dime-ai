/**
 * WC2026 DRIZZLE SQL GENERATION TEST
 * Tests what SQL Drizzle generates for eq(matchDate, sql`${date}`) vs eq(matchDate, date)
 * Run: node server/wc2026/wc2026DrizzleTest.mjs
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

async function main() {
  const cfg = parseDbUrl(DB_URL);
  const conn = await mysql.createConnection({ ...cfg, ssl: { rejectUnauthorized: false } });
  console.log('[CONNECT] DB connected\n');

  const testDate = '2026-07-01';

  // Test 1: Direct string comparison (what Drizzle eq() with plain string does)
  console.log('══ TEST 1: Direct string comparison (match_date = ?) ══');
  const [t1] = await conn.execute(
    `SELECT fixture_id, stage, match_date FROM wc2026_fixtures WHERE match_date = ? ORDER BY kickoff_utc`,
    [testDate]
  );
  console.log(`Rows: ${t1.length}`);
  for (const r of t1) console.log(`  [${r.fixture_id}] match_date=${r.match_date}`);

  // Test 2: DATE() function comparison
  console.log('\n══ TEST 2: DATE() cast comparison ══');
  const [t2] = await conn.execute(
    `SELECT fixture_id, stage, match_date FROM wc2026_fixtures WHERE DATE(match_date) = ? ORDER BY kickoff_utc`,
    [testDate]
  );
  console.log(`Rows: ${t2.length}`);
  for (const r of t2) console.log(`  [${r.fixture_id}] match_date=${r.match_date}`);

  // Test 3: CAST to DATE
  console.log('\n══ TEST 3: CAST(? AS DATE) comparison ══');
  const [t3] = await conn.execute(
    `SELECT fixture_id, stage, match_date FROM wc2026_fixtures WHERE match_date = CAST(? AS DATE) ORDER BY kickoff_utc`,
    [testDate]
  );
  console.log(`Rows: ${t3.length}`);
  for (const r of t3) console.log(`  [${r.fixture_id}] match_date=${r.match_date}`);

  // Test 4: What does Drizzle's sql`` template actually produce?
  // Simulate: eq(wc2026Fixtures.matchDate, sql`${'2026-07-01'}`)
  // In Drizzle, sql`${value}` with a string becomes a parameterized binding
  // But the issue might be that the date column returns a Date object from MySQL
  // and the comparison fails when the column value is a Date object vs string
  
  // Test 5: Check what match_date actually looks like when returned from MySQL
  console.log('\n══ TEST 5: Raw match_date value type from MySQL ══');
  const [t5] = await conn.execute(
    `SELECT fixture_id, match_date, DATE_FORMAT(match_date, '%Y-%m-%d') as md_str FROM wc2026_fixtures WHERE fixture_id = 'wc26-r32-080' LIMIT 1`
  );
  if (t5.length > 0) {
    const row = t5[0];
    console.log(`  fixture_id: ${row.fixture_id}`);
    console.log(`  match_date raw value: ${JSON.stringify(row.match_date)}`);
    console.log(`  match_date type: ${typeof row.match_date}`);
    console.log(`  match_date instanceof Date: ${row.match_date instanceof Date}`);
    console.log(`  md_str: ${row.md_str}`);
    if (row.match_date instanceof Date) {
      console.log(`  match_date.toISOString(): ${row.match_date.toISOString()}`);
      console.log(`  match_date.toISOString().split('T')[0]: ${row.match_date.toISOString().split('T')[0]}`);
    }
  }

  // Test 6: The actual Drizzle query uses sql`${input.date}` which in Drizzle
  // creates a SQL fragment where the value is treated as a raw SQL expression.
  // This means it compares match_date (a Date column) against the string '2026-07-01'
  // as a raw SQL value — which MySQL should handle fine via implicit conversion.
  // BUT: if the column returns a Date object and Drizzle compares Date vs string...
  // Let's test with a Date object parameter
  console.log('\n══ TEST 6: Date object parameter ══');
  const dateObj = new Date('2026-07-01T00:00:00.000Z');
  const [t6] = await conn.execute(
    `SELECT fixture_id, stage, match_date FROM wc2026_fixtures WHERE match_date = ? ORDER BY kickoff_utc`,
    [dateObj]
  );
  console.log(`Rows with Date object param: ${t6.length}`);
  for (const r of t6) console.log(`  [${r.fixture_id}] match_date=${r.match_date}`);

  // Test 7: Check if there's a timezone offset issue
  // The DB stores match_date as a DATE column. MySQL returns it as a Date object
  // with time 00:00:00 UTC. But if the server timezone is different, the date
  // might shift by a day.
  console.log('\n══ TEST 7: Timezone check ══');
  const [tzRows] = await conn.execute(`SELECT @@global.time_zone, @@session.time_zone, NOW(), UTC_TIMESTAMP()`);
  console.log('Timezone info:', tzRows[0]);

  // Test 8: Check the exact SQL that Drizzle generates for the fixturesByDate query
  // by looking at what eq(matchDate, sql`${'2026-07-01'}`) produces
  // In Drizzle ORM, sql`${value}` where value is a string creates a parameterized query
  // The actual SQL would be: WHERE match_date = '2026-07-01'
  // But the column is a DATE type — let's verify MySQL handles this correctly
  console.log('\n══ TEST 8: String literal in WHERE clause ══');
  const [t8] = await conn.execute(
    `SELECT fixture_id, stage, match_date FROM wc2026_fixtures WHERE match_date = '2026-07-01' ORDER BY kickoff_utc`
  );
  console.log(`Rows with string literal '2026-07-01': ${t8.length}`);
  for (const r of t8) console.log(`  [${r.fixture_id}] match_date=${r.match_date}`);

  // Test 9: Check if the Drizzle query is actually being called with the right date
  // by checking what the server logs show for the query
  console.log('\n══ TEST 9: Check wc26-r32-079 (midnight match Jul 1) ══');
  const [t9] = await conn.execute(
    `SELECT fixture_id, stage, match_date, kickoff_utc FROM wc2026_fixtures WHERE fixture_id = 'wc26-r32-079'`
  );
  if (t9.length > 0) {
    const r = t9[0];
    console.log(`  fixture_id: ${r.fixture_id}`);
    console.log(`  match_date: ${JSON.stringify(r.match_date)}`);
    console.log(`  kickoff_utc: ${r.kickoff_utc}`);
    // wc26-r32-079 kicks off at 02:00 UTC Jul 1 = Jun 30 9pm ET
    // If match_date is stored as Jul 1 but the frontend shows "Jul 1" and queries "2026-07-01"
    // this should work. But if there's a timezone issue...
    if (r.match_date instanceof Date) {
      console.log(`  match_date UTC: ${r.match_date.toISOString()}`);
      console.log(`  match_date local: ${r.match_date.toLocaleDateString()}`);
    }
  }

  await conn.end();
  console.log('\n[DONE]');
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
