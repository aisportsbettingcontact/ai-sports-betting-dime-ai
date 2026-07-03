/**
 * WC2026 RIGOROUS AUDIT v2: ESPN API vs DB
 * =========================================
 * Uses CORRECT DB schema:
 * - wc2026_matches: match_id, home_team_id, away_team_id, home_score, away_score, etc.
 * - wc2026_match_stats: match_id, home_*, away_* (match-level, not team-level)
 *
 * Cross-validates every match against live ESPN API:
 * - Home team identity (correct team in home slot)
 * - Away team identity (correct team in away slot)
 * - Home score (exact goals)
 * - Away score (exact goals)
 * - Match date
 *
 * ZERO TOLERANCE: Every mismatch flagged with full details and correction SQL.
 */

import mysql2 from 'mysql2/promise';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
dotenv.config();

const db = await mysql2.createConnection(process.env.DATABASE_URL);
console.log('[DB] Connected');

// ─── STEP 1: Pull all completed matches ─────────────────────────────────────
const [dbMatches] = await db.execute(`
  SELECT match_id, home_team_id, away_team_id, home_score, away_score,
         match_date, kickoff_utc, group_letter, matchday, status, espn_event_id
  FROM wc2026_matches
  WHERE match_date < '2026-06-25' AND status = 'FT'
  ORDER BY kickoff_utc ASC
`);
console.log(`[DB] ${dbMatches.length} completed matches loaded`);

// ─── STEP 2: Pull match stats (match-level schema) ─────────────────────────
const [dbStats] = await db.execute(`
  SELECT match_id, 
         home_shots_on_target, away_shots_on_target,
         home_total_shots, away_total_shots,
         home_possession_pct, away_possession_pct,
         home_corners, away_corners,
         home_saves, away_saves,
         home_xg, away_xg
  FROM wc2026_match_stats
`);
console.log(`[DB] ${dbStats.length} match stat rows loaded`);

const statsByMatch = {};
for (const s of dbStats) statsByMatch[s.match_id] = s;

// ─── STEP 3: Pull team table to get ESPN IDs and abbreviations ────────────────
const [dbTeams] = await db.execute(`
  SELECT team_id, team_name, team_abbr, espn_id, fifa_code
  FROM wc2026_teams
`).catch(() => [[]]);
console.log(`[DB] ${dbTeams.length} teams loaded`);

const teamById = {};
for (const t of dbTeams) teamById[t.team_id] = t;

// ─── STEP 4: Fetch ESPN API for all matches ──────────────────────────────────
// ESPN Soccer API: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={id}
// We need ESPN event IDs. Two sources:
// 1. espn_event_id column in wc2026_matches (if populated)
// 2. Derive from the match stats JSON file (which has game_id)

// Load the match stats JSON to get ESPN game_ids
import { readFileSync } from 'fs';
let statJson = [];
try {
  statJson = JSON.parse(readFileSync('/home/ubuntu/wc2026_match_stats.json', 'utf8'));
  console.log(`[JSON] ${statJson.length} stat rows from JSON file`);
} catch(e) {
  console.log(`[WARN] Could not load wc2026_match_stats.json: ${e.message}`);
}

// Build match_id → ESPN game_id from JSON stats
// JSON stats have: game_id, team_abbr (uppercase), home_away, game_name
const jsonGameIdToTeams = {};
for (const row of statJson) {
  const gid = row.game_id;
  if (!jsonGameIdToTeams[gid]) jsonGameIdToTeams[gid] = new Set();
  jsonGameIdToTeams[gid].add(row.team_abbr.toLowerCase());
}

// Match each match to game_id by team set
const matchToEspnId = {};
for (const f of dbMatches) {
  // First check espn_event_id column
  if (f.espn_event_id) {
    matchToEspnId[f.match_id] = f.espn_event_id;
    continue;
  }
  // Fall back to JSON matching
  const fTeams = new Set([f.home_team_id, f.away_team_id]);
  for (const [gid, gTeams] of Object.entries(jsonGameIdToTeams)) {
    if (fTeams.size === gTeams.size && [...fTeams].every(t => gTeams.has(t))) {
      matchToEspnId[f.match_id] = parseInt(gid);
      break;
    }
  }
}

const matchedCount = Object.keys(matchToEspnId).length;
console.log(`[STEP 4] Matched ${matchedCount}/${dbMatches.length} matches to ESPN game_ids`);

// ─── STEP 5: Fetch ESPN API data ──────────────────────────────────────────────
console.log('\n[STEP 5] Fetching ESPN API data for all matches...');

// ESPN team abbreviation → our DB team_id normalization
const ESPN_TO_DB = {
  // ESPN abbr (lowercase) → DB team_id (lowercase)
  'rsa': 'rsa', 'mex': 'mex', 'kor': 'kor', 'cze': 'cze',
  'bih': 'bih', 'can': 'can', 'usa': 'usa', 'par': 'par',
  'bra': 'bra', 'mar': 'mar', 'hai': 'hai', 'sco': 'sco',
  'aus': 'aus', 'tur': 'tur', 'civ': 'civ', 'ecu': 'ecu',
  'ger': 'ger', 'cuw': 'cuw', 'swe': 'swe', 'tun': 'tun',
  'ned': 'ned', 'jpn': 'jpn', 'bel': 'bel', 'egy': 'egy',
  'irn': 'irn', 'nzl': 'nzl', 'esp': 'esp', 'cpv': 'cpv',
  'ksa': 'ksa', 'uru': 'uru', 'irq': 'irq', 'nor': 'nor',
  'fra': 'fra', 'sen': 'sen', 'aut': 'aut', 'jor': 'jor',
  'arg': 'arg', 'alg': 'alg', 'uzb': 'uzb', 'por': 'por',
  'cod': 'cod', 'col': 'col', 'gha': 'gha', 'eng': 'eng',
  'pan': 'pan', 'cro': 'cro', 'sui': 'sui', 'qat': 'qat',
  'qat': 'qat',
  // ESPN may use different codes
  'skr': 'kor', 'cze': 'cze', 'bos': 'bih',
  'saf': 'rsa', 'rsf': 'rsa',
  'kuw': 'cuw', // Curacao
  'cpv': 'cpv', 'cv': 'cpv',
  'cod': 'cod', 'drc': 'cod', 'cgo': 'cod',
  'swi': 'sui', 'swz': 'sui',
  'irn': 'irn', 'iri': 'irn',
  'nzl': 'nzl', 'nzd': 'nzl',
  'alg': 'alg', 'alge': 'alg',
};

function normalizeEspnAbbr(abbr) {
  if (!abbr) return null;
  const lower = abbr.toLowerCase().trim();
  return ESPN_TO_DB[lower] || lower;
}

const espnData = {};
const espnFetchErrors = [];

for (const f of dbMatches) {
  const espnId = matchToEspnId[f.match_id];
  if (!espnId) {
    espnFetchErrors.push({ match_id: f.match_id, error: 'No ESPN game_id found' });
    console.log(`  [SKIP] ${f.match_id}: No ESPN game_id`);
    continue;
  }
  
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnId}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      espnFetchErrors.push({ match_id: f.match_id, espn_id: espnId, error: `HTTP ${resp.status}` });
      console.log(`  [WARN] ${f.match_id} (espn=${espnId}): HTTP ${resp.status}`);
      continue;
    }
    
    const data = await resp.json();
    const comp = data.header?.competitions?.[0];
    if (!comp) {
      espnFetchErrors.push({ match_id: f.match_id, espn_id: espnId, error: 'No competition in response' });
      continue;
    }
    
    let homeComp = null, awayComp = null;
    for (const c of (comp.competitors || [])) {
      if (c.homeAway === 'home') homeComp = c;
      else awayComp = c;
    }
    
    const homeAbbr = normalizeEspnAbbr(homeComp?.team?.abbreviation);
    const awayAbbr = normalizeEspnAbbr(awayComp?.team?.abbreviation);
    const homeScore = parseInt(homeComp?.score ?? '-1', 10);
    const awayScore = parseInt(awayComp?.score ?? '-1', 10);
    const matchDate = comp.date ? comp.date.split('T')[0] : null;
    const statusName = comp.status?.type?.name;
    
    espnData[f.match_id] = {
      match_id: f.match_id,
      espn_id: espnId,
      home_abbr: homeAbbr,
      away_abbr: awayAbbr,
      home_score: homeScore,
      away_score: awayScore,
      home_display: homeComp?.team?.displayName,
      away_display: awayComp?.team?.displayName,
      match_date: matchDate,
      status: statusName,
      venue: data.gameInfo?.venue?.fullName,
    };
    
    console.log(`  [OK] ${f.match_id}: ESPN=${homeAbbr} ${homeScore}-${awayScore} ${awayAbbr} | DB=${f.home_team_id} ${f.home_score}-${f.away_score} ${f.away_team_id}`);
    
  } catch(err) {
    espnFetchErrors.push({ match_id: f.match_id, espn_id: espnId, error: err.message });
    console.log(`  [ERROR] ${f.match_id}: ${err.message}`);
  }
  
  await new Promise(r => setTimeout(r, 150));
}

console.log(`\n[STEP 5] Fetched ${Object.keys(espnData).length}/${dbMatches.length} matches from ESPN API`);

// ─── STEP 6: FULL CROSS-AUDIT ─────────────────────────────────────────────────
console.log('\n[STEP 6] Cross-auditing all fields...');

const auditResults = [];
const allCorrections = [];

for (const f of dbMatches) {
  const espn = espnData[f.match_id];
  const stats = statsByMatch[f.match_id];
  
  const result = {
    match_id: f.match_id,
    espn_id: matchToEspnId[f.match_id] || null,
    db: {
      home_team: f.home_team_id,
      away_team: f.away_team_id,
      home_score: f.home_score,
      away_score: f.away_score,
      match_date: String(f.match_date).split('T')[0],
      group_letter: f.group_letter,
      matchday: f.matchday,
    },
    espn: espn ? {
      home_team: espn.home_abbr,
      away_team: espn.away_abbr,
      home_score: espn.home_score,
      away_score: espn.away_score,
      home_display: espn.home_display,
      away_display: espn.away_display,
      match_date: espn.match_date,
      venue: espn.venue,
    } : null,
    errors: [],
    corrections: [],
    status: 'OK',
  };
  
  if (!espn) {
    result.status = 'NO_ESPN_DATA';
    result.errors.push({ field: 'espn_fetch', note: 'Could not fetch ESPN data' });
    auditResults.push(result);
    continue;
  }
  
  // ── Check home/away assignment ──
  const espnHomeMatchesDb = espn.home_abbr === f.home_team_id;
  const espnAwayMatchesDb = espn.away_abbr === f.away_team_id;
  const espnHomeMatchesDbAway = espn.home_abbr === f.away_team_id;
  const espnAwayMatchesDbHome = espn.away_abbr === f.home_team_id;
  
  if (!espnHomeMatchesDb && espnHomeMatchesDbAway && espnAwayMatchesDbHome) {
    // Teams are swapped in DB
    result.errors.push({
      field: 'HOME_AWAY_INVERTED',
      severity: 'CRITICAL',
      db_home: f.home_team_id, db_away: f.away_team_id,
      espn_home: espn.home_abbr, espn_away: espn.away_abbr,
      db_home_score: f.home_score, db_away_score: f.away_score,
      espn_home_score: espn.home_score, espn_away_score: espn.away_score,
      note: `DB has ${f.home_team_id} as home with score ${f.home_score}, but ESPN shows ${espn.home_abbr} as home with score ${espn.home_score}`,
    });
    result.corrections.push({
      type: 'SWAP_HOME_AWAY',
      match_id: f.match_id,
      sql: `UPDATE wc2026_matches SET home_team_id='${espn.home_abbr}', away_team_id='${espn.away_abbr}', home_score=${espn.home_score}, away_score=${espn.away_score} WHERE match_id='${f.match_id}';`,
      correct_home: espn.home_abbr,
      correct_away: espn.away_abbr,
      correct_home_score: espn.home_score,
      correct_away_score: espn.away_score,
    });
    result.status = 'ERROR';
  } else if (!espnHomeMatchesDb || !espnAwayMatchesDb) {
    // Unknown mismatch
    result.errors.push({
      field: 'TEAM_MISMATCH',
      severity: 'CRITICAL',
      db_home: f.home_team_id, db_away: f.away_team_id,
      espn_home: espn.home_abbr, espn_away: espn.away_abbr,
      note: 'Team abbreviation mismatch between DB and ESPN — may need manual mapping',
    });
    result.status = 'ERROR';
  } else {
    // Teams match — check scores
    if (espn.home_score !== f.home_score) {
      result.errors.push({
        field: 'HOME_SCORE_MISMATCH',
        severity: 'CRITICAL',
        db_value: f.home_score, espn_value: espn.home_score,
        team: f.home_team_id,
      });
      result.corrections.push({
        type: 'FIX_HOME_SCORE',
        match_id: f.match_id,
        sql: `UPDATE wc2026_matches SET home_score=${espn.home_score} WHERE match_id='${f.match_id}';`,
        correct_value: espn.home_score,
      });
      result.status = 'ERROR';
    }
    if (espn.away_score !== f.away_score) {
      result.errors.push({
        field: 'AWAY_SCORE_MISMATCH',
        severity: 'CRITICAL',
        db_value: f.away_score, espn_value: espn.away_score,
        team: f.away_team_id,
      });
      result.corrections.push({
        type: 'FIX_AWAY_SCORE',
        match_id: f.match_id,
        sql: `UPDATE wc2026_matches SET away_score=${espn.away_score} WHERE match_id='${f.match_id}';`,
        correct_value: espn.away_score,
      });
      result.status = 'ERROR';
    }
    
    // Check date (allow 1-day difference due to timezone)
    const dbDate = String(f.match_date).split('T')[0];
    const espnDate = espn.match_date;
    if (dbDate && espnDate && dbDate !== espnDate) {
      const diff = Math.abs(new Date(dbDate) - new Date(espnDate)) / (1000*60*60*24);
      if (diff > 1) {
        result.errors.push({
          field: 'DATE_MISMATCH',
          severity: 'WARNING',
          db_value: dbDate, espn_value: espnDate,
        });
        result.status = result.status === 'OK' ? 'WARNING' : result.status;
      }
    }
  }
  
  allCorrections.push(...result.corrections);
  auditResults.push(result);
}

// ─── STEP 7: PRINT FULL AUDIT REPORT ─────────────────────────────────────────
console.log('\n' + '='.repeat(80));
console.log('  WC2026 MATCH AUDIT REPORT — ESPN API vs DB');
console.log('='.repeat(80));

const errors = auditResults.filter(r => r.status === 'ERROR');
const warnings = auditResults.filter(r => r.status === 'WARNING');
const noData = auditResults.filter(r => r.status === 'NO_ESPN_DATA');
const ok = auditResults.filter(r => r.status === 'OK');

console.log(`\n  SUMMARY:`);
console.log(`  ✓ OK:           ${ok.length}/54`);
console.log(`  ✗ ERRORS:       ${errors.length}/54`);
console.log(`  ⚠ WARNINGS:     ${warnings.length}/54`);
console.log(`  ? NO ESPN DATA: ${noData.length}/54`);
console.log(`  Total corrections needed: ${allCorrections.length}`);

if (errors.length > 0) {
  console.log('\n  CRITICAL ERRORS:');
  for (const r of errors) {
    console.log(`\n  [${r.match_id}] DB: ${r.db.home_team} ${r.db.home_score}-${r.db.away_score} ${r.db.away_team}`);
    if (r.espn) console.log(`           ESPN: ${r.espn.home_team} ${r.espn.home_score}-${r.espn.away_score} ${r.espn.away_team} (${r.espn.home_display} vs ${r.espn.away_display})`);
    for (const e of r.errors) {
      console.log(`    ERROR [${e.field}]: ${e.note || JSON.stringify(e)}`);
    }
    for (const c of r.corrections) {
      console.log(`    CORRECTION SQL: ${c.sql}`);
    }
  }
}

if (warnings.length > 0) {
  console.log('\n  WARNINGS:');
  for (const r of warnings) {
    for (const e of r.errors) {
      console.log(`  [${r.match_id}] ${e.field}: DB=${e.db_value} ESPN=${e.espn_value}`);
    }
  }
}

if (noData.length > 0) {
  console.log('\n  NO ESPN DATA (manual verification required):');
  for (const r of noData) {
    console.log(`  [${r.match_id}] ${r.db.home_team} vs ${r.db.away_team} — ${r.db.home_score}-${r.db.away_score}`);
  }
}

// ─── STEP 8: GENERATE CORRECTION SQL ─────────────────────────────────────────
if (allCorrections.length > 0) {
  console.log('\n  CORRECTION SQL (apply to fix all errors):');
  for (const c of allCorrections) {
    console.log(`  ${c.sql}`);
  }
}

// ─── STEP 9: SAVE RESULTS ─────────────────────────────────────────────────────
const output = {
  summary: {
    total: auditResults.length,
    ok: ok.length,
    errors: errors.length,
    warnings: warnings.length,
    no_espn_data: noData.length,
    corrections_needed: allCorrections.length,
    espn_fetch_errors: espnFetchErrors.length,
  },
  audit_results: auditResults,
  corrections: allCorrections,
  espn_fetch_errors: espnFetchErrors,
};

writeFileSync('/home/ubuntu/wc2026_audit_results_v2.json', JSON.stringify(output, null, 2));
console.log('\n[OUTPUT] Full audit saved to /home/ubuntu/wc2026_audit_results_v2.json');

await db.end();
console.log('[DB] Disconnected');
