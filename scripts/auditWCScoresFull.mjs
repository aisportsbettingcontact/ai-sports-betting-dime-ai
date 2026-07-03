/**
 * auditWCScoresFull.mjs
 * 
 * CORRECTED full audit — fixes:
 *   1. Uses stage = 'Group Stage' for wc_bt_matches (2018/2022)
 *   2. Extends 2026 ESPN date range to include Jun 11 (wc26-g-001, wc26-g-002)
 *   3. Audits ALL 40 completed 2026 group stage matches
 *
 * Scope:
 *   - 2018 WC: 48 group stage matches (wc_bt_matches, tournament_year=2018)
 *   - 2022 WC: 48 group stage matches (wc_bt_matches, tournament_year=2022)
 *   - 2026 WC: 40 completed group stage matches (wc2026_matches, stage=GROUP, status=FT)
 *
 * ESPN API:
 *   - 2018: Jun 14–Jun 28, 2018
 *   - 2022: Nov 20–Dec 2, 2022
 *   - 2026: Jun 11–Jun 26, 2026 (extended to capture Jun 11 matches)
 */
import mysql from 'mysql2/promise';
import https from 'https';
import { config } from 'dotenv';
config();

const TAG = '[WC_FULL_AUDIT]';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
      console.warn(`${TAG}   [WARN] ESPN ${date}: ${e.message}`);
    }
    await sleep(150);
  }
  return events;
}

function parseEspnEvent(ev) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  const completed = ev.status?.type?.completed;
  return {
    espnId: String(ev.id),
    date: ev.date?.substring(0, 10),
    homeTeam: home.team?.displayName || '',
    homeAbbr: (home.team?.abbreviation || '').toLowerCase(),
    awayTeam: away.team?.displayName || '',
    awayAbbr: (away.team?.abbreviation || '').toLowerCase(),
    homeScore: completed ? parseInt(home.score ?? '-1', 10) : null,
    awayScore: completed ? parseInt(away.score ?? '-1', 10) : null,
    completed: !!completed,
  };
}

// Comprehensive team name → DB abbreviation mapping
const TEAM_NORM = {
  'russia': 'rus', 'saudi arabia': 'ksa', 'egypt': 'egy', 'uruguay': 'uru',
  'morocco': 'mar', 'iran': 'irn', 'portugal': 'por', 'spain': 'esp',
  'france': 'fra', 'australia': 'aus', 'peru': 'per', 'denmark': 'den',
  'argentina': 'arg', 'iceland': 'isl', 'croatia': 'cro', 'nigeria': 'nga',
  'brazil': 'bra', 'switzerland': 'sui', 'costa rica': 'crc', 'serbia': 'srb',
  'germany': 'ger', 'mexico': 'mex', 'sweden': 'swe', 'south korea': 'kor',
  'korea republic': 'kor', 'republic of korea': 'kor', 'czechia': 'cze',
  'czech republic': 'cze', 'belgium': 'bel', 'panama': 'pan', 'tunisia': 'tun',
  'england': 'eng', 'colombia': 'col', 'japan': 'jpn', 'senegal': 'sen',
  'poland': 'pol', 'united states': 'usa', 'usa': 'usa',
  'qatar': 'qat', 'ecuador': 'ecu', 'netherlands': 'ned', 'cameroon': 'cmr',
  'ghana': 'gha', 'wales': 'wal', 'canada': 'can',
  'new zealand': 'nzl', 'cape verde': 'cpv', 'cape verde islands': 'cpv',
  'norway': 'nor', 'algeria': 'alg', 'jordan': 'jor', 'iraq': 'irq',
  'austria': 'aut', 'paraguay': 'par', 'venezuela': 'ven', 'chile': 'chi',
  'south africa': 'rsa', 'ivory coast': 'civ', "cote d'ivoire": 'civ',
  'cote d\'ivoire': 'civ', 'dr congo': 'cod', 'democratic republic of congo': 'cod',
  'congo dr': 'cod', 'uzbekistan': 'uzb', 'indonesia': 'idn',
  'bosnia-herzegovina': 'bih', 'bosnia and herzegovina': 'bih',
  'haiti': 'hai', 'scotland': 'sco', 'turkey': 'tur', 'curacao': 'cuw',
  'curaçao': 'cuw', 'iran': 'irn', 'islamic republic of iran': 'irn',
};

function normTeam(name) {
  if (!name) return '';
  const lower = name.toLowerCase().trim();
  return TEAM_NORM[lower] || lower.replace(/\s+/g, '_').substring(0, 8);
}

function findEspnMatch(dbHomeId, dbAwayId, dbEspnId, espnList) {
  // Method 1: ESPN event ID
  if (dbEspnId) {
    const byId = espnList.find(e => e.espnId === String(dbEspnId));
    if (byId) return { ev: byId, method: 'espn_id' };
  }
  // Method 2: Team name/abbr matching
  const byTeam = espnList.find(e => {
    const eH = normTeam(e.homeTeam);
    const eA = normTeam(e.awayTeam);
    const eHa = e.homeAbbr;
    const eAa = e.awayAbbr;
    return (
      (eH === dbHomeId || eHa === dbHomeId) && (eA === dbAwayId || eAa === dbAwayId)
    ) || (
      (eH === dbAwayId || eHa === dbAwayId) && (eA === dbHomeId || eAa === dbHomeId)
    );
  });
  if (byTeam) return { ev: byTeam, method: 'team_name' };
  return null;
}

function getOrientedScores(ev, dbHomeId) {
  const eH = normTeam(ev.homeTeam);
  const eHa = ev.homeAbbr;
  if (eH === dbHomeId || eHa === dbHomeId) {
    return { espnHomeScore: ev.homeScore, espnAwayScore: ev.awayScore };
  } else {
    return { espnHomeScore: ev.awayScore, espnAwayScore: ev.homeScore };
  }
}

async function auditTournament(label, dbRows, espnList, isWc2026) {
  console.log(`\n${TAG} ${'─'.repeat(72)}`);
  console.log(`${TAG} AUDITING: ${label}`);
  console.log(`${TAG} DB rows: ${dbRows.length} | ESPN completed events: ${espnList.length}`);
  console.log(`${TAG} ${'─'.repeat(72)}`);

  let passed = 0, failed = 0, noMatch = 0;
  const discrepancies = [];

  for (const row of dbRows) {
    const homeId = isWc2026 ? row.home_team_id : normTeam(row.home_team);
    const awayId = isWc2026 ? row.away_team_id : normTeam(row.away_team);
    const dbHome = row.home_score;
    const dbAway = row.away_score;
    const rowId = isWc2026 ? row.fixture_id : row.id;
    const dateStr = row.match_date instanceof Date
      ? row.match_date.toISOString().substring(0, 10)
      : String(row.match_date).substring(0, 10);
    const dbEspnId = row.espn_event_id;

    const result = findEspnMatch(homeId, awayId, dbEspnId, espnList);

    if (!result) {
      noMatch++;
      console.log(`${TAG}   ⚠️  NO_ESPN: ${rowId} | ${dateStr} | ${homeId} vs ${awayId} | DB: ${dbHome}-${dbAway}`);
      continue;
    }

    const { ev, method } = result;
    const { espnHomeScore, espnAwayScore } = getOrientedScores(ev, homeId);
    const scoreOk = dbHome === espnHomeScore && dbAway === espnAwayScore;

    if (scoreOk) {
      passed++;
      console.log(`${TAG}   ✅ ${rowId} | ${dateStr} | ${homeId} ${dbHome}-${dbAway} ${awayId} | ESPN: ${ev.homeScore}-${ev.awayScore} [${method}]`);
    } else {
      failed++;
      discrepancies.push({ rowId, dateStr, homeId, awayId, dbHome, dbAway, espnHomeScore, espnAwayScore, espnId: ev.espnId, method, isWc2026 });
      console.log(`${TAG}   ❌ MISMATCH: ${rowId} | ${dateStr} | ${homeId} vs ${awayId}`);
      console.log(`${TAG}      DB:   ${homeId} ${dbHome}-${dbAway} ${awayId}`);
      console.log(`${TAG}      ESPN: ${homeId} ${espnHomeScore}-${espnAwayScore} ${awayId} (espnId=${ev.espnId})`);
    }
  }

  console.log(`${TAG}   [VERIFY] ${label}: ✅ ${passed} | ❌ ${failed} | ⚠️  ${noMatch} no-ESPN | Total: ${dbRows.length}`);
  return { passed, failed, noMatch, discrepancies };
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} WORLD CUP SCORE FULL AUDIT — 2018 + 2022 + 2026 Group Stage`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(80)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── Load DB data ──────────────────────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Loading DB records...`);

  const [bt2018] = await conn.execute(
    `SELECT id, tournament_year, stage, group_letter, matchday, match_date,
            home_team, away_team, home_score, away_score, result, espn_event_id
     FROM wc_bt_matches
     WHERE tournament_year = 2018 AND stage = 'Group Stage'
     ORDER BY match_date, kickoff_utc`
  );
  console.log(`${TAG}   [INPUT] 2018 DB group stage rows: ${bt2018.length}`);

  const [bt2022] = await conn.execute(
    `SELECT id, tournament_year, stage, group_letter, matchday, match_date,
            home_team, away_team, home_score, away_score, result, espn_event_id
     FROM wc_bt_matches
     WHERE tournament_year = 2022 AND stage = 'Group Stage'
     ORDER BY match_date, kickoff_utc`
  );
  console.log(`${TAG}   [INPUT] 2022 DB group stage rows: ${bt2022.length}`);

  const [fx2026] = await conn.execute(
    `SELECT fixture_id, home_team_id, away_team_id, match_date, kickoff_utc,
            home_score, away_score, status, espn_event_id
     FROM wc2026_matches
     WHERE stage = 'GROUP' AND status = 'FT'
     ORDER BY kickoff_utc`
  );
  console.log(`${TAG}   [INPUT] 2026 DB completed group stage rows: ${fx2026.length}`);

  // ── Fetch ESPN data ───────────────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 2] Fetching ESPN API data...`);

  console.log(`${TAG}   Fetching 2018 WC (Jun 14–Jun 28, 2018)...`);
  const raw2018 = await fetchEspnDates(dateRange('2018-06-14', '2018-06-28'));
  const espn2018 = raw2018.map(parseEspnEvent).filter(e => e?.completed);
  console.log(`${TAG}   [STATE] 2018 ESPN completed: ${espn2018.length}`);

  console.log(`${TAG}   Fetching 2022 WC (Nov 20–Dec 2, 2022)...`);
  const raw2022 = await fetchEspnDates(dateRange('2022-11-20', '2022-12-02'));
  const espn2022 = raw2022.map(parseEspnEvent).filter(e => e?.completed);
  console.log(`${TAG}   [STATE] 2022 ESPN completed: ${espn2022.length}`);

  // 2026: Jun 11–Jun 26 (includes Jun 11 for wc26-g-001/002)
  console.log(`${TAG}   Fetching 2026 WC (Jun 11–Jun 26, 2026)...`);
  const raw2026 = await fetchEspnDates(dateRange('2026-06-11', '2026-06-26'));
  const espn2026 = raw2026.map(parseEspnEvent).filter(e => e?.completed);
  console.log(`${TAG}   [STATE] 2026 ESPN completed: ${espn2026.length}`);

  // ── Audit each tournament ─────────────────────────────────────────────────
  const r2018 = await auditTournament('2018 WC Group Stage', bt2018, espn2018, false);
  const r2022 = await auditTournament('2022 WC Group Stage', bt2022, espn2022, false);
  const r2026 = await auditTournament('2026 WC Group Stage (40 completed)', fx2026, espn2026, true);

  // ── Fix discrepancies ─────────────────────────────────────────────────────
  const allDisc = [...r2018.discrepancies, ...r2022.discrepancies, ...r2026.discrepancies];

  if (allDisc.length > 0) {
    console.log(`\n${TAG} [STEP 4] Fixing ${allDisc.length} discrepancies...`);
    for (const d of allDisc) {
      if (d.isWc2026) {
        const [res] = await conn.execute(
          `UPDATE wc2026_matches SET home_score = ?, away_score = ? WHERE fixture_id = ?`,
          [d.espnHomeScore, d.espnAwayScore, d.rowId]
        );
        console.log(`${TAG}   [FIX] wc2026_matches ${d.rowId}: ${d.homeId} ${d.dbHome}-${d.dbAway} → ${d.espnHomeScore}-${d.espnAwayScore} | rows=${res.affectedRows}`);
      } else {
        const [res] = await conn.execute(
          `UPDATE wc_bt_matches SET home_score = ?, away_score = ? WHERE id = ?`,
          [d.espnHomeScore, d.espnAwayScore, d.rowId]
        );
        console.log(`${TAG}   [FIX] wc_bt_matches ${d.rowId}: ${d.homeId} ${d.dbHome}-${d.dbAway} → ${d.espnHomeScore}-${d.espnAwayScore} | rows=${res.affectedRows}`);
      }
    }
  } else {
    console.log(`\n${TAG} [STEP 4] No discrepancies found. ✅`);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const totalDB = bt2018.length + bt2022.length + fx2026.length;
  const totalPassed = r2018.passed + r2022.passed + r2026.passed;
  const totalFixed = allDisc.length;
  const totalNoMatch = r2018.noMatch + r2022.noMatch + r2026.noMatch;

  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} FINAL AUDIT SUMMARY`);
  console.log(`${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} 2018 WC Group Stage (48 matches): ✅ ${r2018.passed} | ❌ ${r2018.failed} | ⚠️  ${r2018.noMatch}`);
  console.log(`${TAG} 2022 WC Group Stage (48 matches): ✅ ${r2022.passed} | ❌ ${r2022.failed} | ⚠️  ${r2022.noMatch}`);
  console.log(`${TAG} 2026 WC Group Stage (40 matches): ✅ ${r2026.passed} | ❌ ${r2026.failed} | ⚠️  ${r2026.noMatch}`);
  console.log(`${TAG} ${'─'.repeat(72)}`);
  console.log(`${TAG} TOTAL: ${totalDB} DB rows | ✅ ${totalPassed} verified | 🔧 ${totalFixed} corrected | ⚠️  ${totalNoMatch} no ESPN match`);

  const clean = totalNoMatch === 0 && totalFixed === 0;
  console.log(`${TAG} [VERIFY] Status: ${clean ? '✅ CLEAN — all scores match ESPN' : '⚠️  REVIEW NEEDED'}`);

  if (allDisc.length > 0) {
    console.log(`${TAG} [VERIFY] Corrections applied:`);
    for (const d of allDisc) {
      console.log(`${TAG}   ${d.rowId} | ${d.homeId} ${d.dbHome}-${d.dbAway} → ${d.espnHomeScore}-${d.espnAwayScore}`);
    }
  }

  await conn.end();
  console.log(`\n${TAG} Done.`);

  if (totalNoMatch > 0 || totalFixed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
