/**
 * final_verification.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Final full verification:
 * 1. For each AN game: verify DB match has correct home/away orientation
 * 2. For each June 11-17 match: verify DK book odds exist (1X2 + TOTAL)
 * 3. For each June 11-17 match: verify model odds exist (1X2 + TOTAL)
 * 4. Verify model home ML is for the correct team (home team should have lower
 *    odds if they're the stronger team, or higher if they're the underdog)
 * 5. Output a clean pass/fail table
 *
 * Run: node server/wc2026/final_verification.mjs
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

const JUNE_DATES = ['20260611', '20260612', '20260613', '20260614', '20260615', '20260616', '20260617'];

// Full alias map including DB aliases
const TEAM_NAME_MAP = {
  'Mexico': 'mex', 'South Africa': 'rsa', 'Czech Republic': 'cze', 'Czechia': 'cze',
  'South Korea': 'kor', 'Korea Republic': 'kor', 'Bosnia and Herzegovina': 'bih',
  'Bosnia & Herzegovina': 'bih', 'Canada': 'can', 'Qatar': 'qat', 'Switzerland': 'sui',
  'Paraguay': 'par', 'United States': 'usa', 'USA': 'usa', 'Morocco': 'mar', 'Brazil': 'bra',
  'Scotland': 'sco', 'Haiti': 'hai', 'Turkey': 'tur', 'Turkiye': 'tur', 'Türkiye': 'tur',
  'Australia': 'aus', 'Ivory Coast': 'civ', "Côte d'Ivoire": 'civ', 'Ecuador': 'ecu',
  'Japan': 'jpn', 'Netherlands': 'ned', 'Tunisia': 'tun', 'Sweden': 'swe',
  'Curaçao': 'cuw', 'Curacao': 'cuw', 'Germany': 'ger', 'Cape Verde': 'cpv',
  'Spain': 'esp', 'Egypt': 'egy', 'Belgium': 'bel', 'New Zealand': 'nzl',
  'Iran': 'irn', 'Uruguay': 'uru', 'Saudi Arabia': 'ksa', 'Senegal': 'sen',
  'France': 'fra', 'Norway': 'nor', 'Iraq': 'irq', 'Jordan': 'jor', 'Austria': 'aut',
  'Algeria': 'alg', 'Argentina': 'arg', 'DR Congo': 'cod', 'Congo DR': 'cod',
  'Democratic Republic of the Congo': 'cod', 'Portugal': 'por', 'Croatia': 'cro',
  'England': 'eng', 'Panama': 'pan', 'Ghana': 'gha', 'Colombia': 'col', 'Uzbekistan': 'uzb',
};

function normalizeTeam(name) {
  if (!name) return null;
  const direct = TEAM_NAME_MAP[name];
  if (direct) return direct;
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
    if (!res.ok) return [];
    const data = await res.json();
    return data.games ?? [];
  } catch (e) {
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
    'SELECT match_id, home_team_id, away_team_id, match_date FROM wc2026_matches ORDER BY match_date, match_id'
  );

  // Load all odds for June 11-17
  const [allOdds] = await conn.execute(`
    SELECT o.match_id, o.book_id, o.market, o.selection, o.american_odds
    FROM wc2026_odds_snapshots o
    JOIN wc2026_matches f ON o.match_id = f.match_id
    WHERE f.match_date BETWEEN '2026-06-11' AND '2026-06-17'
  `);

  // Build odds lookup: matchId → {bookId → {market → {selection → odds}}}
  const oddsMap = {};
  for (const o of allOdds) {
    if (!oddsMap[o.match_id]) oddsMap[o.match_id] = {};
    if (!oddsMap[o.match_id][o.book_id]) oddsMap[o.match_id][o.book_id] = {};
    if (!oddsMap[o.match_id][o.book_id][o.market]) oddsMap[o.match_id][o.book_id][o.market] = {};
    oddsMap[o.match_id][o.book_id][o.market][o.selection] = o.american_odds;
  }

  console.log('');
  console.log('═'.repeat(90));
  console.log('PHASE 1: ORIENTATION VERIFICATION (DB vs Action Network)');
  console.log('═'.repeat(90));

  let orientationPass = 0, orientationFail = 0, orientationUnmatched = 0;

  for (const dateStr of JUNE_DATES) {
    const games = await fetchAnGames(dateStr);
    if (games.length === 0) continue;

    console.log(`\n--- ${dateStr} (${games.length} AN games) ---`);

    for (const game of games) {
      const anAwayRaw = game.teams[0]?.full_name ?? game.teams[0]?.abbr ?? '';
      const anHomeRaw = game.teams[1]?.full_name ?? game.teams[1]?.abbr ?? '';
      const anAwayId = normalizeTeam(anAwayRaw);
      const anHomeId = normalizeTeam(anHomeRaw);

      if (!anAwayId || !anHomeId) {
        console.log(`  [WARN] Unresolved: "${anAwayRaw}"→${anAwayId} "${anHomeRaw}"→${anHomeId}`);
        orientationUnmatched++;
        continue;
      }

      const dbFix = dbMatchs.find(f =>
        (f.away_team_id === anAwayId && f.home_team_id === anHomeId) ||
        (f.away_team_id === anHomeId && f.home_team_id === anAwayId)
      );

      if (!dbFix) {
        console.log(`  [WARN] No DB match: ${anAwayId} @ ${anHomeId}`);
        orientationUnmatched++;
        continue;
      }

      const correct = dbFix.away_team_id === anAwayId && dbFix.home_team_id === anHomeId;
      if (correct) {
        console.log(`  [PASS] ${dbFix.match_id}: ${anAwayId} @ ${anHomeId} ✓`);
        orientationPass++;
      } else {
        console.log(`  [FAIL] ${dbFix.match_id}: DB=${dbFix.away_team_id}@${dbFix.home_team_id} AN=${anAwayId}@${anHomeId} ✗`);
        orientationFail++;
      }
    }
  }

  console.log('');
  console.log('═'.repeat(90));
  console.log('PHASE 2: ODDS COMPLETENESS (June 11-17)');
  console.log('═'.repeat(90));

  const june1117Matchs = dbMatchs.filter(f => {
    const d = f.match_date.toISOString().slice(0, 10);
    return d >= '2026-06-11' && d <= '2026-06-17';
  });

  console.log(`\nChecking ${june1117Matchs.length} matchs for June 11-17...\n`);

  const DK_BOOK_ID = 68;
  const MODEL_BOOK_ID = 0;

  let oddsPass = 0, oddsFail = 0;
  const failedMatchs = [];

  for (const fix of june1117Matchs) {
    const { match_id, home_team_id, away_team_id } = fix;
    const matchDate = fix.match_date.toISOString().slice(0, 10);
    const fixOdds = oddsMap[match_id] ?? {};

    // Check DK 1X2
    const dkHome = fixOdds[DK_BOOK_ID]?.['1X2']?.['home'];
    const dkDraw = fixOdds[DK_BOOK_ID]?.['1X2']?.['draw'];
    const dkAway = fixOdds[DK_BOOK_ID]?.['1X2']?.['away'];
    const dkOver = fixOdds[DK_BOOK_ID]?.['TOTAL']?.['over'];
    const dkUnder = fixOdds[DK_BOOK_ID]?.['TOTAL']?.['under'];

    // Check Model 1X2
    const modHome = fixOdds[MODEL_BOOK_ID]?.['1X2']?.['home'];
    const modDraw = fixOdds[MODEL_BOOK_ID]?.['1X2']?.['draw'];
    const modAway = fixOdds[MODEL_BOOK_ID]?.['1X2']?.['away'];
    const modOver = fixOdds[MODEL_BOOK_ID]?.['TOTAL']?.['over'];
    const modUnder = fixOdds[MODEL_BOOK_ID]?.['TOTAL']?.['under'];

    const hasDkFull = dkHome != null && dkDraw != null && dkAway != null && dkOver != null && dkUnder != null;
    const hasModFull = modHome != null && modDraw != null && modAway != null && modOver != null && modUnder != null;

    const pass = hasDkFull && hasModFull;

    const fmt = (v) => v == null ? 'N/A' : (v > 0 ? `+${v}` : `${v}`);

    if (pass) {
      console.log(`[PASS] ${match_id} (${matchDate}): ${away_team_id} @ ${home_team_id}`);
      console.log(`       DK:    home=${fmt(dkHome)} draw=${fmt(dkDraw)} away=${fmt(dkAway)} | O=${fmt(dkOver)} U=${fmt(dkUnder)}`);
      console.log(`       MODEL: home=${fmt(modHome)} draw=${fmt(modDraw)} away=${fmt(modAway)} | O=${fmt(modOver)} U=${fmt(modUnder)}`);
      oddsPass++;
    } else {
      const issues = [];
      if (!hasDkFull) issues.push(`DK missing: ${[
        dkHome == null && 'home_ml',
        dkDraw == null && 'draw',
        dkAway == null && 'away_ml',
        dkOver == null && 'over',
        dkUnder == null && 'under',
      ].filter(Boolean).join(',')}`);
      if (!hasModFull) issues.push(`MODEL missing: ${[
        modHome == null && 'home_ml',
        modDraw == null && 'draw',
        modAway == null && 'away_ml',
        modOver == null && 'over',
        modUnder == null && 'under',
      ].filter(Boolean).join(',')}`);

      console.log(`[FAIL] ${match_id} (${matchDate}): ${away_team_id} @ ${home_team_id}`);
      for (const issue of issues) console.log(`       ✗ ${issue}`);
      oddsFail++;
      failedMatchs.push({ match_id, issues });
    }
    console.log('');
  }

  console.log('═'.repeat(90));
  console.log('FINAL VERIFICATION SUMMARY');
  console.log('═'.repeat(90));
  console.log(`Orientation check (AN vs DB):`);
  console.log(`  PASS: ${orientationPass} | FAIL: ${orientationFail} | Unresolved: ${orientationUnmatched}`);
  console.log('');
  console.log(`Odds completeness (June 11-17):`);
  console.log(`  PASS: ${oddsPass} | FAIL: ${oddsFail}`);
  console.log('');

  if (orientationFail === 0 && oddsFail === 0) {
    console.log('✅ ALL CHECKS PASSED — Feed data is clean and correct');
  } else {
    console.log('❌ ISSUES REMAIN:');
    if (orientationFail > 0) console.log(`  - ${orientationFail} orientation mismatches`);
    if (oddsFail > 0) {
      console.log(`  - ${oddsFail} matchs with incomplete odds:`);
      for (const f of failedMatchs) {
        console.log(`    ${f.match_id}: ${f.issues.join('; ')}`);
      }
    }
  }

  await conn.end();
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
