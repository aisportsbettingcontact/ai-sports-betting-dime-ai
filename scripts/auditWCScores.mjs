/**
 * auditWCScores.mjs
 * 
 * Full rigorous audit of all WC Group Stage matches across:
 *   - 2018 World Cup (48 group stage matches)
 *   - 2022 World Cup (48 group stage matches)
 *   - 2026 World Cup Group Stage (completed matches only, stored in wc2026_matches)
 *
 * For 2018 and 2022: data is in wc_bt_matches (tournament_year = 2018 or 2022)
 * For 2026: data is in wc2026_matches
 *
 * ESPN API endpoints:
 *   2018: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20180614-20180628
 *   2022: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20221120-20221202
 *   2026: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260612-20260626
 *
 * Strategy:
 *   1. Pull all DB records for each tournament
 *   2. Pull ESPN API results for each tournament
 *   3. Match by ESPN event ID (espn_match_id) where available, fall back to team name matching
 *   4. Compare home_score, away_score, home_team, away_team
 *   5. Report all discrepancies with full context
 */
import mysql from 'mysql2/promise';
import https from 'https';
import { config } from 'dotenv';
config();

const TAG = '[WC_SCORE_AUDIT]';

// ── ESPN API helpers ──────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; audit-bot/1.0)',
        'Accept': 'application/json',
      },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message} | url=${url}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch all ESPN events for a given date range.
 * ESPN scoreboard API returns paginated results; we iterate days.
 */
async function fetchEspnDates(dateList) {
  const events = [];
  for (const date of dateList) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date}&limit=20`;
    try {
      const data = await httpsGet(url);
      const dayEvents = data.events || [];
      events.push(...dayEvents);
      if (dayEvents.length > 0) {
        console.log(`${TAG}   [ESPN] ${date}: ${dayEvents.length} events`);
      }
    } catch (e) {
      console.warn(`${TAG}   [WARN] ESPN fetch failed for ${date}: ${e.message}`);
    }
    await sleep(200); // rate limit
  }
  return events;
}

/**
 * Generate array of YYYYMMDD strings between two dates inclusive.
 */
function dateRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    dates.push(`${y}${m}${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Parse an ESPN event into a normalized record.
 */
function parseEspnEvent(ev) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const status = ev.status?.type?.completed;
  const homeScore = status ? parseInt(home.score ?? '-1', 10) : null;
  const awayScore = status ? parseInt(away.score ?? '-1', 10) : null;

  return {
    espnId: String(ev.id),
    date: ev.date?.substring(0, 10),
    homeTeam: home.team?.displayName || home.team?.name || '',
    homeAbbr: (home.team?.abbreviation || '').toLowerCase(),
    awayTeam: away.team?.displayName || away.team?.name || '',
    awayAbbr: (away.team?.abbreviation || '').toLowerCase(),
    homeScore,
    awayScore,
    completed: !!status,
    name: ev.name,
  };
}

// ── Team name normalization for fuzzy matching ────────────────────────────────
const TEAM_ALIASES = {
  // 2018/2022 common ESPN names → DB abbreviations
  'russia': 'rus', 'saudi arabia': 'ksa', 'egypt': 'egy', 'uruguay': 'uru',
  'morocco': 'mar', 'iran': 'irn', 'portugal': 'por', 'spain': 'esp',
  'france': 'fra', 'australia': 'aus', 'peru': 'per', 'denmark': 'den',
  'argentina': 'arg', 'iceland': 'isl', 'croatia': 'cro', 'nigeria': 'nga',
  'brazil': 'bra', 'switzerland': 'sui', 'costa rica': 'crc', 'serbia': 'srb',
  'germany': 'ger', 'mexico': 'mex', 'sweden': 'swe', 'south korea': 'kor',
  'korea republic': 'kor', 'belgium': 'bel', 'panama': 'pan', 'tunisia': 'tun',
  'england': 'eng', 'colombia': 'col', 'japan': 'jpn', 'senegal': 'sen',
  'poland': 'pol', 'united states': 'usa', 'usa': 'usa',
  'qatar': 'qat', 'ecuador': 'ecu', 'netherlands': 'ned', 'cameroon': 'cmr',
  'ghana': 'gha', 'wales': 'wal', 'canada': 'can', 'australia': 'aus',
  'new zealand': 'nzl', 'cape verde': 'cpv', 'cape verde islands': 'cpv',
  'norway': 'nor', 'algeria': 'alg', 'jordan': 'jor', 'iraq': 'irq',
  'austria': 'aut', 'paraguay': 'par', 'venezuela': 'ven', 'chile': 'chi',
  'bolivia': 'bol', 'honduras': 'hon', 'el salvador': 'slv', 'haiti': 'hai',
  'jamaica': 'jam', 'trinidad and tobago': 'tto', 'cuba': 'cub',
  'ivory coast': 'civ', "cote d'ivoire": 'civ', 'mali': 'mli',
  'guinea': 'gui', 'south africa': 'rsa', 'kenya': 'ken', 'tanzania': 'tan',
  'nigeria': 'nga', 'cameroon': 'cmr', 'ghana': 'gha', 'senegal': 'sen',
  'morocco': 'mar', 'egypt': 'egy', 'algeria': 'alg', 'tunisia': 'tun',
  'saudi arabia': 'ksa', 'iran': 'irn', 'iraq': 'irq', 'jordan': 'jor',
  'uzbekistan': 'uzb', 'indonesia': 'idn', 'thailand': 'tha',
  'new zealand': 'nzl', 'cape verde': 'cpv',
};

function normalizeTeamName(name) {
  if (!name) return '';
  const lower = name.toLowerCase().trim();
  return TEAM_ALIASES[lower] || lower.replace(/\s+/g, '_').substring(0, 8);
}

// ── Main audit ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} WORLD CUP SCORE AUDIT — 2018 + 2022 + 2026 Group Stage`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(80)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── PHASE 1: Fetch DB records ─────────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Loading DB records for 2018, 2022, 2026...`);

  const [bt2018] = await conn.execute(
    `SELECT id, tournament_year, stage, group_letter, matchday, match_date,
            home_team, away_team, home_score, away_score, result, espn_match_id
     FROM wc_bt_matches
     WHERE tournament_year = 2018 AND stage = 'GROUP'
     ORDER BY match_date, kickoff_utc`
  );
  console.log(`${TAG}   [INPUT] 2018 DB group stage rows: ${bt2018.length}`);

  const [bt2022] = await conn.execute(
    `SELECT id, tournament_year, stage, group_letter, matchday, match_date,
            home_team, away_team, home_score, away_score, result, espn_match_id
     FROM wc_bt_matches
     WHERE tournament_year = 2022 AND stage = 'GROUP'
     ORDER BY match_date, kickoff_utc`
  );
  console.log(`${TAG}   [INPUT] 2022 DB group stage rows: ${bt2022.length}`);

  const [fx2026] = await conn.execute(
    `SELECT match_id, home_team_id, away_team_id, match_date, kickoff_utc,
            home_score, away_score, status, espn_match_id
     FROM wc2026_matches
     WHERE stage = 'GROUP' AND status = 'FT'
     ORDER BY kickoff_utc`
  );
  console.log(`${TAG}   [INPUT] 2026 DB completed group stage rows: ${fx2026.length}`);

  // ── PHASE 2: Fetch ESPN data ───────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 2] Fetching ESPN API data...`);

  console.log(`${TAG}   [ESPN] Fetching 2018 WC (Jun 14 – Jun 28, 2018)...`);
  const espn2018Events = await fetchEspnDates(dateRange('2018-06-14', '2018-06-28'));
  const espn2018 = espn2018Events.map(parseEspnEvent).filter(Boolean).filter(e => e.completed);
  console.log(`${TAG}   [STATE] 2018 ESPN completed events: ${espn2018.length}`);

  console.log(`${TAG}   [ESPN] Fetching 2022 WC (Nov 20 – Dec 2, 2022)...`);
  const espn2022Events = await fetchEspnDates(dateRange('2022-11-20', '2022-12-02'));
  const espn2022 = espn2022Events.map(parseEspnEvent).filter(Boolean).filter(e => e.completed);
  console.log(`${TAG}   [STATE] 2022 ESPN completed events: ${espn2022.length}`);

  console.log(`${TAG}   [ESPN] Fetching 2026 WC Group Stage (Jun 12 – Jun 26, 2026)...`);
  const espn2026Events = await fetchEspnDates(dateRange('2026-06-12', '2026-06-26'));
  const espn2026 = espn2026Events.map(parseEspnEvent).filter(Boolean).filter(e => e.completed);
  console.log(`${TAG}   [STATE] 2026 ESPN completed events: ${espn2026.length}`);

  // ── PHASE 3: Audit each tournament ────────────────────────────────────────
  const allDiscrepancies = [];

  // Helper: match DB row to ESPN event
  function findEspnMatch(dbRow, espnList, isWc2026 = false) {
    const homeId = isWc2026 ? dbRow.home_team_id : normalizeTeamName(dbRow.home_team);
    const awayId = isWc2026 ? dbRow.away_team_id : normalizeTeamName(dbRow.away_team);

    // Try ESPN event ID first
    if (dbRow.espn_match_id) {
      const byId = espnList.find(e => e.espnId === String(dbRow.espn_match_id));
      if (byId) return { match: byId, method: 'espn_id' };
    }

    // Try team name matching
    const byTeam = espnList.find(e => {
      const eHome = normalizeTeamName(e.homeTeam);
      const eAway = normalizeTeamName(e.awayTeam);
      const eHomeAbbr = e.homeAbbr;
      const eAwayAbbr = e.awayAbbr;
      return (
        (eHome === homeId || eHomeAbbr === homeId) &&
        (eAway === awayId || eAwayAbbr === awayId)
      ) || (
        (eHome === awayId || eHomeAbbr === awayId) &&
        (eAway === homeId || eAwayAbbr === homeId)
      );
    });
    if (byTeam) return { match: byTeam, method: 'team_name' };

    return null;
  }

  async function auditTournament(label, dbRows, espnList, isWc2026 = false) {
    console.log(`\n${TAG} ${'─'.repeat(70)}`);
    console.log(`${TAG} AUDITING: ${label} (DB rows: ${dbRows.length}, ESPN events: ${espnList.length})`);
    console.log(`${TAG} ${'─'.repeat(70)}`);

    let passed = 0, failed = 0, noEspnMatch = 0;
    const discrepancies = [];

    for (const row of dbRows) {
      const homeId = isWc2026 ? row.home_team_id : normalizeTeamName(row.home_team);
      const awayId = isWc2026 ? row.away_team_id : normalizeTeamName(row.away_team);
      const dbHome = row.home_score;
      const dbAway = row.away_score;
      const rowId = isWc2026 ? row.match_id : row.id;
      const dateStr = row.match_date instanceof Date
        ? row.match_date.toISOString().substring(0, 10)
        : String(row.match_date).substring(0, 10);

      const result = findEspnMatch(row, espnList, isWc2026);

      if (!result) {
        noEspnMatch++;
        console.log(`${TAG}   ⚠️  NO ESPN MATCH: ${rowId} | ${dateStr} | ${homeId} vs ${awayId} | DB score: ${dbHome}-${dbAway}`);
        continue;
      }

      const { match: ev, method } = result;

      // Determine correct ESPN home/away orientation
      const espnHomeNorm = normalizeTeamName(ev.homeTeam);
      const espnAwayNorm = normalizeTeamName(ev.awayTeam);
      const espnHomeAbbr = ev.homeAbbr;
      const espnAwayAbbr = ev.awayAbbr;

      let espnHomeScore, espnAwayScore;
      const homeMatchesEspnHome = (espnHomeNorm === homeId || espnHomeAbbr === homeId);
      const awayMatchesEspnAway = (espnAwayNorm === awayId || espnAwayAbbr === awayId);

      if (homeMatchesEspnHome && awayMatchesEspnAway) {
        // Same orientation
        espnHomeScore = ev.homeScore;
        espnAwayScore = ev.awayScore;
      } else {
        // Flipped orientation
        espnHomeScore = ev.awayScore;
        espnAwayScore = ev.homeScore;
      }

      const scoreMatch = (dbHome === espnHomeScore && dbAway === espnAwayScore);

      if (scoreMatch) {
        passed++;
        console.log(`${TAG}   ✅ ${rowId} | ${dateStr} | ${homeId} ${dbHome}-${dbAway} ${awayId} | ESPN: ${ev.homeScore}-${ev.awayScore} [${method}]`);
      } else {
        failed++;
        const disc = {
          tournament: label,
          rowId,
          date: dateStr,
          homeId,
          awayId,
          dbHomeScore: dbHome,
          dbAwayScore: dbAway,
          espnHomeScore,
          espnAwayScore,
          espnMatchId: ev.espnId,
          method,
          isWc2026,
        };
        discrepancies.push(disc);
        allDiscrepancies.push(disc);
        console.log(`${TAG}   ❌ MISMATCH: ${rowId} | ${dateStr} | ${homeId} vs ${awayId}`);
        console.log(`${TAG}      DB:   ${homeId} ${dbHome}-${dbAway} ${awayId}`);
        console.log(`${TAG}      ESPN: ${homeId} ${espnHomeScore}-${espnAwayScore} ${awayId} (espnId=${ev.espnId})`);
      }
    }

    console.log(`\n${TAG}   [VERIFY] ${label}: Passed=${passed} Failed=${failed} NoESPNMatch=${noEspnMatch} Total=${dbRows.length}`);
    return { passed, failed, noEspnMatch, discrepancies };
  }

  const r2018 = await auditTournament('2018 WC Group Stage', bt2018, espn2018, false);
  const r2022 = await auditTournament('2022 WC Group Stage', bt2022, espn2022, false);
  const r2026 = await auditTournament('2026 WC Group Stage (completed)', fx2026, espn2026, true);

  // ── PHASE 4: Fix discrepancies ─────────────────────────────────────────────
  if (allDiscrepancies.length > 0) {
    console.log(`\n${TAG} ${'='.repeat(80)}`);
    console.log(`${TAG} [STEP 4] Fixing ${allDiscrepancies.length} discrepancies...`);

    for (const d of allDiscrepancies) {
      if (d.isWc2026) {
        // Fix in wc2026_matches
        const [res] = await conn.execute(
          `UPDATE wc2026_matches SET home_score = ?, away_score = ? WHERE match_id = ?`,
          [d.espnHomeScore, d.espnAwayScore, d.rowId]
        );
        console.log(`${TAG}   [FIX] wc2026_matches ${d.rowId}: ${d.homeId} ${d.dbHomeScore}-${d.dbAwayScore} → ${d.espnHomeScore}-${d.espnAwayScore} | affectedRows=${res.affectedRows}`);
      } else {
        // Fix in wc_bt_matches
        const [res] = await conn.execute(
          `UPDATE wc_bt_matches SET home_score = ?, away_score = ? WHERE id = ?`,
          [d.espnHomeScore, d.espnAwayScore, d.rowId]
        );
        console.log(`${TAG}   [FIX] wc_bt_matches ${d.rowId}: ${d.homeId} ${d.dbHomeScore}-${d.dbAwayScore} → ${d.espnHomeScore}-${d.espnAwayScore} | affectedRows=${res.affectedRows}`);
      }
    }
  } else {
    console.log(`\n${TAG} [STEP 4] No discrepancies to fix. ✅`);
  }

  // ── PHASE 5: Final summary ─────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} FINAL AUDIT SUMMARY`);
  console.log(`${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} 2018 WC Group Stage: ${r2018.passed} passed | ${r2018.failed} fixed | ${r2018.noEspnMatch} no ESPN match`);
  console.log(`${TAG} 2022 WC Group Stage: ${r2022.passed} passed | ${r2022.failed} fixed | ${r2022.noEspnMatch} no ESPN match`);
  console.log(`${TAG} 2026 WC Group Stage: ${r2026.passed} passed | ${r2026.failed} fixed | ${r2026.noEspnMatch} no ESPN match`);

  const totalRows = bt2018.length + bt2022.length + fx2026.length;
  const totalPassed = r2018.passed + r2022.passed + r2026.passed;
  const totalFixed = allDiscrepancies.length;
  const totalNoMatch = r2018.noEspnMatch + r2022.noEspnMatch + r2026.noEspnMatch;

  console.log(`${TAG} ─────────────────────────────────────────────────────────────────────────`);
  console.log(`${TAG} TOTAL: ${totalRows} DB rows | ${totalPassed} verified ✅ | ${totalFixed} corrected 🔧 | ${totalNoMatch} no ESPN match ⚠️`);

  if (totalFixed > 0) {
    console.log(`${TAG} [VERIFY] Corrections applied:`);
    for (const d of allDiscrepancies) {
      console.log(`${TAG}   ${d.rowId} | ${d.homeId} ${d.dbHomeScore}-${d.dbAwayScore} → ${d.espnHomeScore}-${d.espnAwayScore}`);
    }
  }

  const overallPass = totalNoMatch === 0 && totalFixed === 0;
  console.log(`${TAG} [VERIFY] Overall status: ${overallPass ? '✅ CLEAN — all scores match ESPN' : '⚠️  REVIEW NEEDED — see above'}`);

  await conn.end();
  console.log(`\n${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
