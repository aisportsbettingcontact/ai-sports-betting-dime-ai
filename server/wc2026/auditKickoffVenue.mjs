/**
 * WC2026 FORENSIC AUDIT — Kickoff UTC, Match Date, Venue, ET Times
 * Audits matchs wc26-r32-079 through wc26-r16-091 (13 total)
 * Validates: match_date alignment with kickoff_utc, venue assignment, ET display
 */
import mysql from 'mysql2/promise';
import 'dotenv/config';

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port || '3306'),
  user: url.username,
  password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

const TARGET_IDS = [
  'wc26-r32-079',
  'wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091'
];

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  WC2026 FORENSIC AUDIT — Kickoff / Match Date / Venue / ET');
console.log('  Matchs: wc26-r32-079 through wc26-r16-091 (13 total)');
console.log('════════════════════════════════════════════════════════════════\n');

// ── 1. Pull raw match data ──────────────────────────────────────────────────
const placeholders = TARGET_IDS.map(() => '?').join(',');
const [rows] = await conn.execute(`
  SELECT
    f.match_id,
    f.stage,
    f.match_date,
    f.kickoff_utc,
    f.display_order,
    f.venue_id,
    v.name        AS venue_name,
    v.city        AS venue_city,
    v.state       AS venue_state,
    ht.name       AS home_name,
    ht.team_id    AS home_id,
    at.name       AS away_name,
    at.team_id    AS away_id
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  LEFT JOIN wc2026_venues v  ON f.venue_id    = v.venue_id
  WHERE f.match_id IN (${placeholders})
  ORDER BY f.kickoff_utc, f.match_id
`, TARGET_IDS);

console.log(`[INPUT]  Queried ${TARGET_IDS.length} target match IDs`);
console.log(`[RESULT] Found ${rows.length} rows in DB\n`);

// ── 2. Per-match deep inspection ───────────────────────────────────────────
const issues = [];

for (const r of rows) {
  const kickoff = r.kickoff_utc ? new Date(r.kickoff_utc) : null;
  const matchDateRaw = r.match_date; // Date object from Drizzle/mysql2

  // Derive expected match_date from kickoff_utc
  // The feed uses match_date to bucket matchs per day
  // match_date should equal the LOCAL DATE of kickoff in ET
  // ET = UTC-4 (EDT, currently in effect Jul 2026)
  const ET_OFFSET_MS = -4 * 60 * 60 * 1000;

  let kickoffET = null;
  let expectedMatchDate = null;
  let kickoffETStr = '—';
  let kickoffUTCStr = '—';

  if (kickoff) {
    kickoffET = new Date(kickoff.getTime() + ET_OFFSET_MS);
    kickoffETStr = kickoffET.toISOString().replace('T', ' ').substring(0, 16) + ' ET';
    kickoffUTCStr = kickoff.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    // Expected match_date = YYYY-MM-DD in ET timezone
    expectedMatchDate = kickoffET.toISOString().split('T')[0];
  }

  // Actual match_date stored in DB
  const actualMatchDate = matchDateRaw instanceof Date
    ? matchDateRaw.toISOString().split('T')[0]
    : String(matchDateRaw).split('T')[0];

  // Venue check
  const venueDisplay = r.venue_name
    ? `${r.venue_name}, ${r.venue_city}, ${r.venue_state}`
    : `❌ NO VENUE (venue_id=${r.venue_id ?? 'NULL'})`;

  // Date mismatch check
  const dateMismatch = expectedMatchDate && expectedMatchDate !== actualMatchDate;

  console.log(`┌─ [${r.match_id}] ${r.away_name} @ ${r.home_name}`);
  console.log(`│  Stage:          ${r.stage}`);
  console.log(`│  kickoff_utc:    ${kickoffUTCStr}`);
  console.log(`│  kickoff_ET:     ${kickoffETStr}`);
  console.log(`│  match_date DB:  ${actualMatchDate}  ${dateMismatch ? '❌ MISMATCH' : '✅ CORRECT'}`);
  if (dateMismatch) {
    console.log(`│  match_date EXP: ${expectedMatchDate}  ← SHOULD BE THIS`);
    issues.push({
      espn_match_id: r.match_id,
      type: 'DATE_MISMATCH',
      actual: actualMatchDate,
      expected: expectedMatchDate,
      kickoffET: kickoffETStr,
      matchup: `${r.away_name} @ ${r.home_name}`
    });
  }
  console.log(`│  venue:          ${venueDisplay}`);
  if (!r.venue_name) {
    issues.push({
      espn_match_id: r.match_id,
      type: 'MISSING_VENUE',
      matchup: `${r.away_name} @ ${r.home_name}`
    });
  }
  console.log(`│  is_frozen:      ${r.is_frozen}`);
  console.log(`└──────────────────────────────────────────────────────────────\n`);
}

// ── 3. Check for matchs in TARGET_IDS not found in DB ──────────────────────
const foundIds = new Set(rows.map(r => r.match_id));
const missingFromDB = TARGET_IDS.filter(id => !foundIds.has(id));
if (missingFromDB.length > 0) {
  console.log(`[ERROR] ${missingFromDB.length} match(s) NOT FOUND in DB:`);
  missingFromDB.forEach(id => {
    console.log(`  ❌ ${id}`);
    issues.push({ espn_match_id: id, type: 'MISSING_FROM_DB' });
  });
  console.log();
}

// ── 4. Check all venues in wc2026_venues ─────────────────────────────────────
const [venues] = await conn.execute('SELECT venue_id, name, city, state, capacity FROM wc2026_venues ORDER BY venue_id');
console.log(`[VENUES] ${venues.length} venues in wc2026_venues table:`);
for (const v of venues) {
  console.log(`  venue_id=${v.venue_id} | ${v.name}, ${v.city}, ${v.state} | cap=${v.capacity}`);
}
console.log();

// ── 5. Summary ────────────────────────────────────────────────────────────────
console.log('════════════════════════════════════════════════════════════════');
console.log(`  AUDIT SUMMARY: ${issues.length} issue(s) found`);
console.log('════════════════════════════════════════════════════════════════');
if (issues.length === 0) {
  console.log('  ✅ All 13 matchs have correct match_date and venue assignments.');
} else {
  for (const iss of issues) {
    if (iss.type === 'DATE_MISMATCH') {
      console.log(`  ❌ DATE_MISMATCH  [${iss.espn_match_id}] ${iss.matchup}`);
      console.log(`     DB has: ${iss.actual} | Should be: ${iss.expected} | Kickoff ET: ${iss.kickoffET}`);
    } else if (iss.type === 'MISSING_VENUE') {
      console.log(`  ❌ MISSING_VENUE  [${iss.espn_match_id}] ${iss.matchup}`);
    } else if (iss.type === 'MISSING_FROM_DB') {
      console.log(`  ❌ MISSING_FROM_DB [${iss.espn_match_id}]`);
    }
  }
}
console.log('════════════════════════════════════════════════════════════════\n');

await conn.end();
console.log('[DONE] Forensic audit complete.');
