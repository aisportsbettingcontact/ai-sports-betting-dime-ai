/**
 * auditAllWCScoresFull.mjs
 *
 * Full ESPN API audit of all WC Group Stage completed matches:
 *   - 2018: 48 matches (wc_bt_matches, tournament='2018 FIFA World Cup')
 *   - 2022: 48 matches (wc_bt_matches, tournament='2022 FIFA World Cup')
 *   - 2026: 44 matches (wc2026_fixtures, status='FT')
 *
 * For each match:
 *   1. Pull ESPN event by date range
 *   2. Match to DB row by team names (normalized)
 *   3. Compare home_score and away_score
 *   4. Flag any discrepancy
 *
 * ESPN API: https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard?dates=YYYYMMDD
 * ESPN 2018 league: FIFA.WORLD (same endpoint, filter by year)
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// ─── ESPN team name normalization map ────────────────────────────────────────
// Maps ESPN display names → DB stored names (for mismatches)
const ESPN_NAME_MAP = {
  // 2018
  'Russia': 'Russia',
  'Saudi Arabia': 'Saudi Arabia',
  'Egypt': 'Egypt',
  'Uruguay': 'Uruguay',
  'Morocco': 'Morocco',
  'Iran': 'Iran',
  'Portugal': 'Portugal',
  'Spain': 'Spain',
  'France': 'France',
  'Australia': 'Australia',
  'Argentina': 'Argentina',
  'Iceland': 'Iceland',
  'Peru': 'Peru',
  'Denmark': 'Denmark',
  'Croatia': 'Croatia',
  'Nigeria': 'Nigeria',
  'Costa Rica': 'Costa Rica',
  'Serbia': 'Serbia',
  'Germany': 'Germany',
  'Mexico': 'Mexico',
  'Brazil': 'Brazil',
  'Switzerland': 'Switzerland',
  'Sweden': 'Sweden',
  'South Korea': 'South Korea',
  'Belgium': 'Belgium',
  'Panama': 'Panama',
  'Tunisia': 'Tunisia',
  'England': 'England',
  'Colombia': 'Colombia',
  'Japan': 'Japan',
  'Poland': 'Poland',
  'Senegal': 'Senegal',
  'South Africa': 'South Africa',
  // 2022
  'Qatar': 'Qatar',
  'Ecuador': 'Ecuador',
  'Netherlands': 'Netherlands',
  'Cameroon': 'Cameroon',
  'United States': 'United States',
  'Wales': 'Wales',
  'Ghana': 'Ghana',
  'Canada': 'Canada',
  'Japan': 'Japan',
  'Costa Rica': 'Costa Rica',
  'Spain': 'Spain',
  'Germany': 'Germany',
  'Morocco': 'Morocco',
  'Croatia': 'Croatia',
  'Belgium': 'Belgium',
  'Serbia': 'Serbia',
  'Switzerland': 'Switzerland',
  'Cameroon': 'Cameroon',
  'Uruguay': 'Uruguay',
  'South Korea': 'South Korea',
  'Portugal': 'Portugal',
  'Brazil': 'Brazil',
  'France': 'France',
  'Australia': 'Australia',
  'Tunisia': 'Tunisia',
  'Denmark': 'Denmark',
  'Mexico': 'Mexico',
  'Poland': 'Poland',
  'Argentina': 'Argentina',
  'Saudi Arabia': 'Saudi Arabia',
  'Iran': 'Iran',
  'England': 'England',
  'Senegal': 'Senegal',
  'Netherlands': 'Netherlands',
  // 2026 - ESPN may use different names
  'New Zealand': 'New Zealand',
  'South Africa': 'South Africa',
  'Algeria': 'Algeria',
  'Jordan': 'Jordan',
  'Norway': 'Norway',
  'Iraq': 'Iraq',
  'Austria': 'Austria',
  'Cape Verde': 'Cape Verde',
  'Uzbekistan': 'Uzbekistan',
  'DR Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'Democratic Republic of Congo': 'DR Congo',
  'Panama': 'Panama',
  'Colombia': 'Colombia',
  'Ghana': 'Ghana',
  'England': 'England',
};

function normalizeName(name) {
  if (!name) return '';
  return (ESPN_NAME_MAP[name] || name).toLowerCase().trim();
}

// ─── ESPN fetch helper ────────────────────────────────────────────────────────
async function fetchEspnScoreboard(dateStr) {
  // dateStr: YYYYMMDD
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard?dates=${dateStr}&limit=20`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}

// ─── Build date list for a year range ────────────────────────────────────────
function getDatesForRange(startDate, endDate) {
  const dates = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}${m}${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ─── Pull all ESPN events for a tournament ───────────────────────────────────
async function pullEspnEvents(startDate, endDate, label) {
  console.log(`\n[STEP] Pulling ESPN events for ${label} (${startDate} → ${endDate})...`);
  const dates = getDatesForRange(startDate, endDate);
  const allEvents = [];
  for (const dateStr of dates) {
    const events = await fetchEspnScoreboard(dateStr);
    const completed = events.filter(e => e.status?.type?.completed === true);
    if (completed.length > 0) {
      console.log(`  [ESPN] ${dateStr}: ${completed.length} completed event(s)`);
      allEvents.push(...completed);
    }
  }
  console.log(`[STATE] Total ESPN completed events for ${label}: ${allEvents.length}`);
  return allEvents;
}

// ─── Extract score from ESPN event ───────────────────────────────────────────
function extractEspnScore(event) {
  const comps = event.competitions?.[0]?.competitors || [];
  const home = comps.find(c => c.homeAway === 'home');
  const away = comps.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  return {
    homeTeam: home.team?.displayName || home.team?.name || '',
    awayTeam: away.team?.displayName || away.team?.name || '',
    homeScore: parseInt(home.score, 10),
    awayScore: parseInt(away.score, 10),
    eventId: event.id,
    date: event.date,
  };
}

// ─── Audit 2018 and 2022 (wc_bt_matches) ─────────────────────────────────────
async function audit2018and2022(espnEvents, tournamentYear, label) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`[AUDIT] ${label} — wc_bt_matches`);
  console.log(`${'═'.repeat(70)}`);

  const [dbRows] = await db.execute(
    `SELECT id, home_team, away_team, home_score, away_score, match_date
     FROM wc_bt_matches
     WHERE tournament_year = ? AND stage = 'Group Stage'
     ORDER BY match_date ASC`,
    [tournamentYear]
  );

  console.log(`[STATE] DB rows for ${label}: ${dbRows.length}`);

  if (dbRows.length === 0) {
    console.warn(`[WARN] No DB rows found for ${label} — skipping`);
    return { total: 0, matched: 0, discrepancies: [], unmatched: [] };
  }

  let matched = 0;
  const discrepancies = [];
  const unmatched = [];

  for (const row of dbRows) {
    const dbHome = normalizeName(row.home_team);
    const dbAway = normalizeName(row.away_team);

    // Find ESPN event matching these teams
    const espnMatch = espnEvents.find(e => {
      const s = extractEspnScore(e);
      if (!s) return false;
      const espnHome = normalizeName(s.homeTeam);
      const espnAway = normalizeName(s.awayTeam);
      // Try direct match
      if (espnHome === dbHome && espnAway === dbAway) return true;
      // Try swapped (ESPN may have home/away reversed vs DB)
      if (espnHome === dbAway && espnAway === dbHome) return true;
      return false;
    });

    if (!espnMatch) {
      unmatched.push({ id: row.id, home: row.home_team, away: row.away_team, date: row.match_date });
      console.log(`  [UNMATCHED] id=${row.id} | ${row.home_team} vs ${row.away_team} | ${row.match_date} — no ESPN event found`);
      continue;
    }

    const s = extractEspnScore(espnMatch);
    const espnHome = normalizeName(s.homeTeam);
    const espnAway = normalizeName(s.awayTeam);
    const swapped = espnHome === dbAway && espnAway === dbHome;

    // Determine expected DB scores based on orientation
    const expectedHomeScore = swapped ? s.awayScore : s.homeScore;
    const expectedAwayScore = swapped ? s.homeScore : s.awayScore;

    const homeOk = row.home_score === expectedHomeScore;
    const awayOk = row.away_score === expectedAwayScore;
    const pass = homeOk && awayOk;

    if (pass) {
      matched++;
      console.log(`  [✅] id=${row.id} | ${row.home_team} ${row.home_score}-${row.away_score} ${row.away_team}`);
    } else {
      discrepancies.push({
        id: row.id,
        home: row.home_team,
        away: row.away_team,
        dbHomeScore: row.home_score,
        dbAwayScore: row.away_score,
        espnHomeScore: expectedHomeScore,
        espnAwayScore: expectedAwayScore,
        espnEventId: s.eventId,
      });
      console.error(`  [❌] id=${row.id} | ${row.home_team} vs ${row.away_team} | DB: ${row.home_score}-${row.away_score} | ESPN: ${expectedHomeScore}-${expectedAwayScore}`);
    }
  }

  console.log(`\n[SUMMARY] ${label}: ${matched}/${dbRows.length} matched ✅ | ${discrepancies.length} discrepancies ❌ | ${unmatched.length} unmatched`);
  return { total: dbRows.length, matched, discrepancies, unmatched };
}

// ─── Audit 2026 (wc2026_fixtures) ────────────────────────────────────────────
async function audit2026(espnEvents) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`[AUDIT] 2026 WC Group Stage — wc2026_fixtures`);
  console.log(`${'═'.repeat(70)}`);

  const [dbRows] = await db.execute(`
    SELECT f.fixture_id, f.kickoff_utc, f.home_score, f.away_score, f.status,
           ht.name AS home_name, at.name AS away_name
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    WHERE f.status = 'FT'
    ORDER BY f.kickoff_utc ASC
  `);

  console.log(`[STATE] DB completed 2026 fixtures: ${dbRows.length}`);

  let matched = 0;
  const discrepancies = [];
  const unmatched = [];

  for (const row of dbRows) {
    const dbHome = normalizeName(row.home_name);
    const dbAway = normalizeName(row.away_name);

    const espnMatch = espnEvents.find(e => {
      const s = extractEspnScore(e);
      if (!s) return false;
      const espnHome = normalizeName(s.homeTeam);
      const espnAway = normalizeName(s.awayTeam);
      if (espnHome === dbHome && espnAway === dbAway) return true;
      if (espnHome === dbAway && espnAway === dbHome) return true;
      return false;
    });

    if (!espnMatch) {
      unmatched.push({ fixture_id: row.fixture_id, home: row.home_name, away: row.away_name, kickoff: row.kickoff_utc });
      console.log(`  [UNMATCHED] ${row.fixture_id} | ${row.home_name} vs ${row.away_name} | ${row.kickoff_utc}`);
      continue;
    }

    const s = extractEspnScore(espnMatch);
    const espnHome = normalizeName(s.homeTeam);
    const espnAway = normalizeName(s.awayTeam);
    const swapped = espnHome === dbAway && espnAway === dbHome;

    const expectedHomeScore = swapped ? s.awayScore : s.homeScore;
    const expectedAwayScore = swapped ? s.homeScore : s.awayScore;

    const pass = row.home_score === expectedHomeScore && row.away_score === expectedAwayScore;

    if (pass) {
      matched++;
      console.log(`  [✅] ${row.fixture_id} | ${row.home_name} ${row.home_score}-${row.away_score} ${row.away_name}`);
    } else {
      discrepancies.push({
        fixture_id: row.fixture_id,
        home: row.home_name,
        away: row.away_name,
        dbHomeScore: row.home_score,
        dbAwayScore: row.away_score,
        espnHomeScore: expectedHomeScore,
        espnAwayScore: expectedAwayScore,
        espnEventId: s.eventId,
      });
      console.error(`  [❌] ${row.fixture_id} | ${row.home_name} vs ${row.away_name} | DB: ${row.home_score}-${row.away_score} | ESPN: ${expectedHomeScore}-${expectedAwayScore}`);
    }
  }

  console.log(`\n[SUMMARY] 2026: ${matched}/${dbRows.length} matched ✅ | ${discrepancies.length} discrepancies ❌ | ${unmatched.length} unmatched`);
  return { total: dbRows.length, matched, discrepancies, unmatched };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════');
console.log('[STEP] auditAllWCScoresFull.mjs — START');
console.log('[INPUT] Auditing 2018 (48) + 2022 (48) + 2026 (44) = 140 WC Group Stage matches');
console.log('══════════════════════════════════════════════════════════════════════');

// Pull ESPN events for all 3 tournaments
const espn2018 = await pullEspnEvents('2018-06-14', '2018-06-28', '2018 WC');
const espn2022 = await pullEspnEvents('2022-11-20', '2022-12-02', '2022 WC');
const espn2026 = await pullEspnEvents('2026-06-11', '2026-06-23', '2026 WC');

// Run audits
const result2018 = await audit2018and2022(espn2018, 2018, '2018 WC');
const result2022 = await audit2018and2022(espn2022, 2022, '2022 WC');
const result2026 = await audit2026(espn2026);

// Final summary
const totalDb = result2018.total + result2022.total + result2026.total;
const totalMatched = result2018.matched + result2022.matched + result2026.matched;
const totalDiscrepancies = [
  ...result2018.discrepancies,
  ...result2022.discrepancies,
  ...result2026.discrepancies,
];
const totalUnmatched = [
  ...result2018.unmatched,
  ...result2022.unmatched,
  ...result2026.unmatched,
];

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('[FINAL AUDIT SUMMARY]');
console.log(`  2018: ${result2018.matched}/${result2018.total} ✅ | ${result2018.discrepancies.length} discrepancies | ${result2018.unmatched.length} unmatched`);
console.log(`  2022: ${result2022.matched}/${result2022.total} ✅ | ${result2022.discrepancies.length} discrepancies | ${result2022.unmatched.length} unmatched`);
console.log(`  2026: ${result2026.matched}/${result2026.total} ✅ | ${result2026.discrepancies.length} discrepancies | ${result2026.unmatched.length} unmatched`);
console.log(`  TOTAL: ${totalMatched}/${totalDb} ✅ | ${totalDiscrepancies.length} discrepancies | ${totalUnmatched.length} unmatched`);

if (totalDiscrepancies.length > 0) {
  console.log('\n[DISCREPANCIES TO FIX]:');
  for (const d of totalDiscrepancies) {
    const id = d.fixture_id || d.id;
    console.log(`  ❌ ${id} | ${d.home} vs ${d.away} | DB: ${d.dbHomeScore}-${d.dbAwayScore} | ESPN: ${d.espnHomeScore}-${d.espnAwayScore}`);
  }
}

if (totalUnmatched.length > 0) {
  console.log('\n[UNMATCHED (no ESPN event found)]:');
  for (const u of totalUnmatched) {
    const id = u.fixture_id || u.id;
    console.log(`  ⚠️  ${id} | ${u.home} vs ${u.away}`);
  }
}

const clean = totalDiscrepancies.length === 0;
console.log(`\n[RESULT] ${clean ? '✅ ALL SCORES CLEAN — 0 discrepancies' : '❌ DISCREPANCIES FOUND — fixes required'}`);
console.log('══════════════════════════════════════════════════════════════════════');

// Save results to file for reference
import { writeFileSync } from 'fs';
writeFileSync('/tmp/wc_audit_result.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  summary: { total: totalDb, matched: totalMatched, discrepancies: totalDiscrepancies.length, unmatched: totalUnmatched.length },
  discrepancies: totalDiscrepancies,
  unmatched: totalUnmatched,
}, null, 2));
console.log('[OUTPUT] Audit results saved to /tmp/wc_audit_result.json');

await db.end();
