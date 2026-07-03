/**
 * full_orientation_audit.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches all WC2026 group stage matchs from Action Network (the live source
 * of truth) for every date from June 11 to July 2, compares home/away
 * orientation against the DB, and outputs a full mismatch report.
 *
 * Run: node server/wc2026/full_orientation_audit.mjs
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DB_URL = process.env.DATABASE_URL;
const m = DB_URL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = m;

const AN_URL = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer';
const AN_BOOK_IDS = '15,30,79,2988,75,123,71,68,69';
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
  Referer: 'https://www.actionnetwork.com/soccer/odds',
  Origin: 'https://www.actionnetwork.com',
};

// All WC2026 group stage dates
const DATES = [
  '20260611', '20260612', '20260613', '20260614', '20260615',
  '20260616', '20260617', '20260618', '20260619', '20260620',
  '20260621', '20260622', '20260623', '20260624', '20260625',
  '20260626', '20260627',
];

// Team name normalization map (AN names → DB team IDs)
const TEAM_NAME_MAP = {
  'Mexico': 'mex', 'South Africa': 'rsa', 'Czech Republic': 'cze', 'South Korea': 'kor',
  'Korea Republic': 'kor', 'Bosnia and Herzegovina': 'bih', 'Bosnia & Herzegovina': 'bih',
  'Canada': 'can', 'Qatar': 'qat', 'Switzerland': 'sui', 'Paraguay': 'par',
  'United States': 'usa', 'USA': 'usa', 'Morocco': 'mar', 'Brazil': 'bra',
  'Scotland': 'sco', 'Haiti': 'hai', 'Turkey': 'tur', 'Australia': 'aus',
  'Ivory Coast': 'civ', "Côte d'Ivoire": 'civ', 'Ecuador': 'ecu',
  'Japan': 'jpn', 'Netherlands': 'ned', 'Tunisia': 'tun', 'Sweden': 'swe',
  'Curaçao': 'cuw', 'Curacao': 'cuw', 'Germany': 'ger',
  'Cape Verde': 'cpv', 'Spain': 'esp', 'Egypt': 'egy', 'Belgium': 'bel',
  'New Zealand': 'nzl', 'Iran': 'irn', 'Uruguay': 'uru', 'Saudi Arabia': 'ksa',
  'Senegal': 'sen', 'France': 'fra', 'Norway': 'nor', 'Iraq': 'irq',
  'Jordan': 'jor', 'Austria': 'aut', 'Algeria': 'alg', 'Argentina': 'arg',
  'DR Congo': 'cod', 'Congo DR': 'cod', 'Democratic Republic of the Congo': 'cod',
  'Portugal': 'por', 'Croatia': 'cro', 'England': 'eng', 'Panama': 'pan',
  'Ghana': 'gha', 'Colombia': 'col', 'Uzbekistan': 'uzb',
  // Additional possible AN names
  'Netherlands (Holland)': 'ned', 'Holland': 'ned',
  'Ivory Coast (Côte d\'Ivoire)': 'civ',
  'United States of America': 'usa',
  'Bosnia-Herzegovina': 'bih',
};

function normalizeTeam(name) {
  if (!name) return null;
  const direct = TEAM_NAME_MAP[name];
  if (direct) return direct;
  // Try partial match
  for (const [key, val] of Object.entries(TEAM_NAME_MAP)) {
    if (name.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(name.toLowerCase())) {
      return val;
    }
  }
  return null;
}

async function fetchAnGames(dateStr) {
  const url = `${AN_URL}?bookIds=${AN_BOOK_IDS}&date=${dateStr}&periods=event`;
  try {
    const res = await fetch(url, { headers: AN_HEADERS });
    if (!res.ok) {
      console.log(`[WARN] AN returned ${res.status} for date=${dateStr}`);
      return [];
    }
    const data = await res.json();
    return data.games ?? [];
  } catch (e) {
    console.log(`[ERROR] AN fetch failed for ${dateStr}: ${e.message}`);
    return [];
  }
}

async function main() {
  const conn = await mysql.createConnection({
    user, password, host, port: parseInt(port), database,
    ssl: { rejectUnauthorized: false }
  });

  // Load all DB matchs
  const [dbMatchs] = await conn.execute(
    'SELECT match_id, home_team_id, away_team_id, match_date, kickoff_utc FROM wc2026_matches ORDER BY match_date, kickoff_utc'
  );

  console.log(`[INPUT] DB has ${dbMatchs.length} total matchs`);
  console.log('');

  const mismatches = [];
  const matched = [];
  const unmatched = [];
  const anGamesAll = [];

  for (const dateStr of DATES) {
    const games = await fetchAnGames(dateStr);
    if (games.length === 0) continue;

    console.log(`=== ${dateStr}: ${games.length} AN games ===`);

    for (const game of games) {
      // AN: teams[0]=away, teams[1]=home
      const anAwayRaw = game.teams[0]?.full_name ?? game.teams[0]?.abbr ?? '';
      const anHomeRaw = game.teams[1]?.full_name ?? game.teams[1]?.abbr ?? '';
      const anAwayId = normalizeTeam(anAwayRaw);
      const anHomeId = normalizeTeam(anHomeRaw);

      if (!anAwayId || !anHomeId) {
        console.log(`  [WARN] Unresolved: away="${anAwayRaw}"→${anAwayId} home="${anHomeRaw}"→${anHomeId}`);
        unmatched.push({ dateStr, anAwayRaw, anHomeRaw });
        continue;
      }

      // Find matching DB match
      const dbFix = dbMatchs.find(f =>
        (f.away_team_id === anAwayId && f.home_team_id === anHomeId) ||
        (f.away_team_id === anHomeId && f.home_team_id === anAwayId)
      );

      if (!dbFix) {
        console.log(`  [WARN] No DB match for AN: away=${anAwayId} home=${anHomeId}`);
        unmatched.push({ dateStr, anAwayId, anHomeId, anAwayRaw, anHomeRaw });
        continue;
      }

      const isCorrect = dbFix.away_team_id === anAwayId && dbFix.home_team_id === anHomeId;
      const status = isCorrect ? 'OK' : 'SWAPPED';

      if (!isCorrect) {
        console.log(`  [${status}] ${dbFix.match_id}: DB has home=${dbFix.home_team_id}/away=${dbFix.away_team_id} but AN says home=${anHomeId}/away=${anAwayId}`);
        mismatches.push({
          matchId: dbFix.match_id,
          dbHome: dbFix.home_team_id,
          dbAway: dbFix.away_team_id,
          anHome: anHomeId,
          anAway: anAwayId,
          anHomeRaw,
          anAwayRaw,
          dateStr,
        });
      } else {
        console.log(`  [OK]  ${dbFix.match_id}: ${anAwayId} @ ${anHomeId} ✓`);
        matched.push(dbFix.match_id);
      }

      anGamesAll.push({ dateStr, anAwayId, anHomeId, matchId: dbFix.match_id });
    }
    console.log('');
  }

  console.log('═'.repeat(70));
  console.log(`SUMMARY:`);
  console.log(`  AN games fetched:  ${anGamesAll.length}`);
  console.log(`  Correct:           ${matched.length}`);
  console.log(`  SWAPPED (need fix): ${mismatches.length}`);
  console.log(`  Unmatched:         ${unmatched.length}`);
  console.log('');

  if (mismatches.length > 0) {
    console.log('MISMATCHES TO FIX:');
    for (const m of mismatches) {
      console.log(`  ${m.matchId}: DB home=${m.dbHome}/away=${m.dbAway} → should be home=${m.anHome}/away=${m.anAway}`);
    }
  } else {
    console.log('ALL ORIENTATIONS CORRECT ✓');
  }

  await conn.end();
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
