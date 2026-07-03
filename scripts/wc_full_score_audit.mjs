/**
 * wc_full_score_audit.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Full cross-tournament score integrity audit for 2018, 2022, 2026 WC.
 * 
 * For each tournament:
 *   1. Pull all group stage matches from ESPN API (ground truth)
 *   2. Compare against DB records in wc_bt_matches + wc2026_matches
 *   3. Identify every score mismatch and home/away orientation error
 *   4. Correct all mismatches in-place
 *   5. Re-validate after correction
 *
 * ESPN league slugs:
 *   2018: fifa.world (historical)
 *   2022: fifa.world (historical)
 *   2026: fifa.world (current)
 *
 * Logging: [WC_AUDIT] [INPUT/STEP/STATE/OUTPUT/VERIFY/FIX]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_AUDIT]';

// ─── ESPN API helpers ─────────────────────────────────────────────────────────
async function fetchEspnScoreboard(dateStr) {
  // dateStr: YYYYMMDD
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API error ${res.status} for date ${dateStr}`);
  return res.json();
}

async function fetchEspnEvent(eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function parseEspnGame(event) {
  const comps = event.competitions?.[0];
  if (!comps) return null;
  const competitors = comps.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
  const status = event.status?.type?.name || '';
  const isFinal = status === 'STATUS_FULL_TIME' || status === 'STATUS_FINAL';
  return {
    espnId: String(event.id),
    homeName: home?.team?.displayName || home?.team?.name || '',
    awayName: away?.team?.displayName || away?.team?.name || '',
    homeScore: isFinal ? parseInt(home?.score ?? '-1', 10) : null,
    awayScore: isFinal ? parseInt(away?.score ?? '-1', 10) : null,
    isFinal,
    date: event.date?.slice(0, 10) || '',
    status,
  };
}

// WC 2018 group stage dates: June 14 – July 3, 2018 (group stage ends July 3)
// WC 2022 group stage dates: Nov 20 – Dec 2, 2022
// WC 2026 group stage dates: June 12 – July 2, 2026

function dateRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    dates.push(cur.toISOString().slice(0, 10).replace(/-/g, ''));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} FULL CROSS-TOURNAMENT SCORE INTEGRITY AUDIT`);
console.log(`${TAG} Tournaments: 2018, 2022, 2026 World Cup Group Stage`);
console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
console.log(`${TAG} ================================================================\n`);

// ─── Step 1: Pull ESPN ground truth for all 3 tournaments ────────────────────
console.log(`${TAG} [STEP 1] Fetching ESPN ground truth for all 3 tournaments...`);

const tournamentDates = {
  2018: dateRange('2018-06-14', '2018-06-28'), // group stage only
  2022: dateRange('2022-11-20', '2022-12-02'), // group stage only
  2026: dateRange('2026-06-12', '2026-06-19'), // through June 19
};

const espnGames = { 2018: [], 2022: [], 2026: [] };

for (const [year, dates] of Object.entries(tournamentDates)) {
  console.log(`${TAG} [STEP 1] Fetching ${year} WC (${dates.length} dates)...`);
  for (const dateStr of dates) {
    try {
      const data = await fetchEspnScoreboard(dateStr);
      const events = data.events || [];
      for (const e of events) {
        const parsed = parseEspnGame(e);
        if (parsed && parsed.isFinal) {
          espnGames[year].push(parsed);
        }
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      console.log(`${TAG} [WARN] Failed to fetch ${year} date ${dateStr}: ${err.message}`);
    }
  }
  console.log(`${TAG} [STATE] ${year}: ${espnGames[year].length} final games from ESPN`);
}

// Deduplicate by espnId
for (const year of [2018, 2022, 2026]) {
  const seen = new Set();
  espnGames[year] = espnGames[year].filter(g => {
    if (seen.has(g.espnId)) return false;
    seen.add(g.espnId);
    return true;
  });
  console.log(`${TAG} [STATE] ${year}: ${espnGames[year].length} unique final games after dedup`);
}

// ─── Step 2: Pull DB records ──────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 2] Pulling DB records for all 3 tournaments...`);

// 2018 + 2022: from wc_bt_matches
const [btMatches] = await conn.query(`
  SELECT id, tournament_year, home_team, away_team, home_score, away_score, match_date, espn_event_id
  FROM wc_bt_matches
  WHERE tournament_year IN (2018, 2022, 2026)
  ORDER BY tournament_year, match_date
`);
console.log(`${TAG} [INPUT] wc_bt_matches total: ${btMatches.length}`);

// 2026: also from wc2026_matches (canonical source)
const [wc26Matchs] = await conn.query(`
  SELECT f.match_id, f.espn_event_id,
         ht.name as home_team, ht.team_id as home_team_id,
         at.name as away_team, at.team_id as away_team_id,
         f.home_score, f.away_score, f.status, f.match_date
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
  JOIN wc2026_teams at ON at.team_id = f.away_team_id
  WHERE f.status = 'FT'
  ORDER BY f.kickoff_utc
`);
console.log(`${TAG} [INPUT] wc2026_matches (FT): ${wc26Matchs.length}`);

// ─── Step 3: Cross-reference and identify mismatches ─────────────────────────
console.log(`\n${TAG} [STEP 3] Cross-referencing DB vs ESPN ground truth...`);

const mismatches = [];
const corrections = [];

// Helper: normalize team name for fuzzy matching
function normName(n) {
  return (n || '').toLowerCase()
    .replace(/ü/g, 'u').replace(/é/g, 'e').replace(/ñ/g, 'n')
    .replace(/türkiye/i, 'turkey').replace(/türkei/i, 'turkey')
    .replace(/côte d'ivoire/i, 'ivory coast').replace(/korea republic/i, 'south korea')
    .replace(/united states/i, 'usa').replace(/us$/i, 'usa')
    .replace(/[^a-z0-9 ]/g, '').trim();
}

function teamsMatch(a, b) {
  const na = normName(a), nb = normName(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Handle common abbreviations
  const abbrevMap = { 'usa': ['united states', 'us'], 'turkey': ['türkiye', 'turkiye'], 'south korea': ['korea republic', 'korea rep'] };
  for (const [key, vals] of Object.entries(abbrevMap)) {
    if ((na === key || vals.includes(na)) && (nb === key || vals.includes(nb))) return true;
  }
  return false;
}

// Audit 2026 matches (wc2026_matches is canonical)
console.log(`\n${TAG} [STEP 3a] Auditing 2026 wc2026_matches vs ESPN...`);
const espn26ById = Object.fromEntries(espnGames[2026].map(g => [g.espnId, g]));
const espn26ByTeams = espnGames[2026]; // for fallback matching

for (const f of wc26Matchs) {
  const espnId = String(f.espn_event_id || '');
  let espnGame = espn26ById[espnId];
  
  // Fallback: match by team names if espn_event_id not found
  if (!espnGame) {
    espnGame = espn26ByTeams.find(g =>
      (teamsMatch(g.homeName, f.home_team) && teamsMatch(g.awayName, f.away_team)) ||
      (teamsMatch(g.homeName, f.away_team) && teamsMatch(g.awayName, f.home_team))
    );
  }
  
  if (!espnGame) {
    console.log(`${TAG} [WARN] 2026 ${f.match_id}: No ESPN match found for ${f.home_team} vs ${f.away_team} (espnId=${espnId})`);
    continue;
  }
  
  const dbHomeScore = f.home_score;
  const dbAwayScore = f.away_score;
  const espnHomeScore = espnGame.homeScore;
  const espnAwayScore = espnGame.awayScore;
  
  // Check orientation: does ESPN home match our DB home?
  const homeMatch = teamsMatch(espnGame.homeName, f.home_team);
  const awayMatch = teamsMatch(espnGame.awayName, f.away_team);
  const orientationOk = homeMatch && awayMatch;
  
  // Check if scores match (considering orientation)
  let scoreOk = false;
  let orientationFlipped = false;
  
  if (orientationOk) {
    scoreOk = dbHomeScore === espnHomeScore && dbAwayScore === espnAwayScore;
  } else {
    // Check if orientation is flipped
    const homeMatchFlipped = teamsMatch(espnGame.homeName, f.away_team);
    const awayMatchFlipped = teamsMatch(espnGame.awayName, f.home_team);
    if (homeMatchFlipped && awayMatchFlipped) {
      orientationFlipped = true;
      // In flipped case, ESPN home = our away, ESPN away = our home
      scoreOk = dbHomeScore === espnAwayScore && dbAwayScore === espnHomeScore;
    }
  }
  
  if (!scoreOk || orientationFlipped) {
    const issue = orientationFlipped ? 'ORIENTATION_FLIPPED' : 'SCORE_MISMATCH';
    console.log(`${TAG} [MISMATCH] 2026 ${f.match_id}: ${issue}`);
    console.log(`${TAG}   DB:    ${f.home_team}(H) ${dbHomeScore}-${dbAwayScore} ${f.away_team}(A)`);
    console.log(`${TAG}   ESPN:  ${espnGame.homeName}(H) ${espnHomeScore}-${espnAwayScore} ${espnGame.awayName}(A)`);
    mismatches.push({ year: 2026, table: 'wc2026_matches', id: f.match_id, issue, f, espnGame, orientationFlipped });
  } else {
    console.log(`${TAG} [OK] 2026 ${f.match_id}: ${f.home_team} ${dbHomeScore}-${dbAwayScore} ${f.away_team} ✓`);
  }
}

// Audit 2018 + 2022 + 2026 in wc_bt_matches
for (const year of [2018, 2022, 2026]) {
  console.log(`\n${TAG} [STEP 3${year === 2018 ? 'b' : year === 2022 ? 'c' : 'd'}] Auditing ${year} wc_bt_matches vs ESPN...`);
  const dbMatches = btMatches.filter(m => m.tournament_year === year);
  const espnList = espnGames[year];
  const espnById = Object.fromEntries(espnList.map(g => [g.espnId, g]));
  
  console.log(`${TAG} [STATE] ${year}: DB has ${dbMatches.length} matches, ESPN has ${espnList.length} games`);
  
  for (const m of dbMatches) {
    const espnId = String(m.espn_event_id || '');
    let espnGame = espnById[espnId];
    
    // Fallback: match by team names
    if (!espnGame) {
      espnGame = espnList.find(g =>
        (teamsMatch(g.homeName, m.home_team) && teamsMatch(g.awayName, m.away_team)) ||
        (teamsMatch(g.homeName, m.away_team) && teamsMatch(g.awayName, m.home_team))
      );
    }
    
    if (!espnGame) {
      console.log(`${TAG} [WARN] ${year} ${m.id}: No ESPN match for ${m.home_team} vs ${m.away_team}`);
      continue;
    }
    
    const dbHomeScore = m.home_score;
    const dbAwayScore = m.away_score;
    const espnHomeScore = espnGame.homeScore;
    const espnAwayScore = espnGame.awayScore;
    
    const homeMatch = teamsMatch(espnGame.homeName, m.home_team);
    const awayMatch = teamsMatch(espnGame.awayName, m.away_team);
    const orientationOk = homeMatch && awayMatch;
    
    let scoreOk = false;
    let orientationFlipped = false;
    
    if (orientationOk) {
      scoreOk = dbHomeScore === espnHomeScore && dbAwayScore === espnAwayScore;
    } else {
      const homeMatchFlipped = teamsMatch(espnGame.homeName, m.away_team);
      const awayMatchFlipped = teamsMatch(espnGame.awayName, m.home_team);
      if (homeMatchFlipped && awayMatchFlipped) {
        orientationFlipped = true;
        scoreOk = dbHomeScore === espnAwayScore && dbAwayScore === espnHomeScore;
      }
    }
    
    if (!scoreOk || orientationFlipped) {
      const issue = orientationFlipped ? 'ORIENTATION_FLIPPED' : 'SCORE_MISMATCH';
      console.log(`${TAG} [MISMATCH] ${year} ${m.id}: ${issue}`);
      console.log(`${TAG}   DB:    ${m.home_team}(H) ${dbHomeScore}-${dbAwayScore} ${m.away_team}(A)`);
      console.log(`${TAG}   ESPN:  ${espnGame.homeName}(H) ${espnHomeScore}-${espnAwayScore} ${espnGame.awayName}(A)`);
      mismatches.push({ year, table: 'wc_bt_matches', id: m.id, issue, m, espnGame, orientationFlipped });
    } else {
      console.log(`${TAG} [OK] ${year} ${m.id}: ${m.home_team} ${dbHomeScore}-${dbAwayScore} ${m.away_team} ✓`);
    }
  }
}

// ─── Step 4: Summary of mismatches ───────────────────────────────────────────
console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} [STEP 4] MISMATCH SUMMARY`);
console.log(`${TAG} ================================================================`);
console.log(`${TAG} Total mismatches found: ${mismatches.length}`);

if (mismatches.length === 0) {
  console.log(`${TAG} [VERIFY] ✅ ALL SCORES MATCH ESPN GROUND TRUTH — No corrections needed`);
} else {
  for (const mm of mismatches) {
    console.log(`${TAG}   ${mm.year} [${mm.table}] ${mm.id}: ${mm.issue}`);
    if (mm.table === 'wc2026_matches') {
      const f = mm.f;
      console.log(`${TAG}     DB:   ${f.home_team}(H) ${f.home_score}-${f.away_score} ${f.away_team}(A)`);
    } else {
      const m = mm.m;
      console.log(`${TAG}     DB:   ${m.home_team}(H) ${m.home_score}-${m.away_score} ${m.away_team}(A)`);
    }
    const g = mm.espnGame;
    console.log(`${TAG}     ESPN: ${g.homeName}(H) ${g.homeScore}-${g.awayScore} ${g.awayName}(A)`);
  }
}

// ─── Step 5: Apply corrections ───────────────────────────────────────────────
if (mismatches.length > 0) {
  console.log(`\n${TAG} [STEP 5] Applying corrections...`);
  let fixed = 0;
  
  for (const mm of mismatches) {
    const g = mm.espnGame;
    
    if (mm.table === 'wc2026_matches') {
      const f = mm.f;
      if (mm.orientationFlipped) {
        // Swap home_team_id and away_team_id, then set correct scores
        await conn.query(`
          UPDATE wc2026_matches SET
            home_team_id = ?,
            away_team_id = ?,
            home_score = ?,
            away_score = ?
          WHERE match_id = ?
        `, [f.away_team_id, f.home_team_id, g.homeScore, g.awayScore, f.match_id]);
        console.log(`${TAG} [FIX] wc2026_matches ${f.match_id}: SWAPPED home/away + set scores ${g.homeScore}-${g.awayScore}`);
      } else {
        // Just fix scores
        await conn.query(`
          UPDATE wc2026_matches SET home_score = ?, away_score = ? WHERE match_id = ?
        `, [g.homeScore, g.awayScore, f.match_id]);
        console.log(`${TAG} [FIX] wc2026_matches ${f.match_id}: SCORE corrected to ${g.homeScore}-${g.awayScore}`);
      }
      fixed++;
    }
    
    if (mm.table === 'wc_bt_matches') {
      const m = mm.m;
      if (mm.orientationFlipped) {
        // Swap home/away team names and fix scores
        await conn.query(`
          UPDATE wc_bt_matches SET
            home_team = ?,
            away_team = ?,
            home_score = ?,
            away_score = ?,
            updated_at = NOW()
          WHERE id = ?
        `, [m.away_team, m.home_team, g.homeScore, g.awayScore, m.id]);
        console.log(`${TAG} [FIX] wc_bt_matches ${m.id}: SWAPPED home/away (${m.away_team} is now home) + scores ${g.homeScore}-${g.awayScore}`);
      } else {
        await conn.query(`
          UPDATE wc_bt_matches SET home_score = ?, away_score = ?, updated_at = NOW() WHERE id = ?
        `, [g.homeScore, g.awayScore, m.id]);
        console.log(`${TAG} [FIX] wc_bt_matches ${m.id}: SCORE corrected to ${g.homeScore}-${g.awayScore}`);
      }
      fixed++;
    }
  }
  
  console.log(`${TAG} [OUTPUT] Applied ${fixed} corrections`);
  
  // Also fix wc_bt_projections actual_result for corrected 2026 matches
  const june19Ids = ['wc26-g-029', 'wc26-g-030', 'wc26-g-031', 'wc26-g-032'];
  for (const fid of june19Ids) {
    const mm = mismatches.find(m => m.id === fid);
    if (mm) {
      const g = mm.espnGame;
      // Determine correct actual_result from ESPN perspective
      let actualResult;
      if (mm.orientationFlipped) {
        // After swap: ESPN home is now our home
        actualResult = g.homeScore > g.awayScore ? 'H' : g.homeScore < g.awayScore ? 'A' : 'D';
      } else {
        actualResult = g.homeScore > g.awayScore ? 'H' : g.homeScore < g.awayScore ? 'A' : 'D';
      }
      const actualTotal = g.homeScore + g.awayScore;
      await conn.query(`
        UPDATE wc_bt_projections SET
          actual_result = ?,
          actual_total_goals = ?,
          model_correct_result = CASE WHEN model_lean = ? THEN 1 ELSE 0 END
        WHERE match_id = ? AND tournament_year = 2026
      `, [actualResult, actualTotal, actualResult, fid]);
      console.log(`${TAG} [FIX] wc_bt_projections ${fid}: actual_result=${actualResult} total=${actualTotal}`);
    }
  }
}

// ─── Step 6: Post-correction verification ────────────────────────────────────
console.log(`\n${TAG} [STEP 6] Post-correction verification...`);

const [verifyRows] = await conn.query(`
  SELECT f.match_id, ht.name as home_team, at.name as away_team,
         f.home_score, f.away_score, f.status
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
  JOIN wc2026_teams at ON at.team_id = f.away_team_id
  WHERE f.status = 'FT'
  ORDER BY f.kickoff_utc
`);

console.log(`${TAG} [VERIFY] Final state of all FT 2026 matches:`);
for (const r of verifyRows) {
  const result = r.home_score > r.away_score ? 'H' : r.home_score < r.away_score ? 'A' : 'D';
  console.log(`${TAG}   ${r.match_id}: ${r.home_team}(H) ${r.home_score}-${r.away_score} ${r.away_team}(A) → ${result}`);
}

// ─── Final summary ────────────────────────────────────────────────────────────
console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} AUDIT COMPLETE`);
console.log(`${TAG} ================================================================`);
console.log(`${TAG} 2018 ESPN games fetched: ${espnGames[2018].length}`);
console.log(`${TAG} 2022 ESPN games fetched: ${espnGames[2022].length}`);
console.log(`${TAG} 2026 ESPN games fetched: ${espnGames[2026].length}`);
console.log(`${TAG} Total DB records audited: ${btMatches.length + wc26Matchs.length}`);
console.log(`${TAG} Mismatches found: ${mismatches.length}`);
console.log(`${TAG} Corrections applied: ${mismatches.length}`);
console.log(`${TAG} ================================================================\n`);

await conn.end();
