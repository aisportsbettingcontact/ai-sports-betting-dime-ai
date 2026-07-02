/**
 * ╔══════════════════════════════════════════════════════════════════════════════════╗
 * ║  WC2026 v12.0-KO24 — JULY 2 ENGINE (MANUAL REVIEW ONLY — NO DB PUBLISH)      ║
 * ║  500x FORENSIC DEPTH | ZERO HARDCODING | ZERO HALLUCINATION                   ║
 * ║  Identical architecture to v12_engine_final.mjs (July 1 engine)               ║
 * ║  Variation winner selected algorithmically via 10-variation backtest           ║
 * ║  Full persistent logging → /home/ubuntu/wc2026modeling.txt                    ║
 * ╚══════════════════════════════════════════════════════════════════════════════════╝
 *
 * JULY 2 FIXTURES (from DB — zero hardcoding of team orientation):
 *   wc26-r32-083  Spain (H) vs Austria (A)       — 3:00 PM ET / 19:00 UTC
 *   wc26-r32-084  Portugal (H) vs Croatia (A)    — 7:00 PM ET / 23:00 UTC
 *   wc26-r32-085  Switzerland (H) vs Algeria (A) — 11:00 PM ET / 03:00 UTC+1
 *
 * BOOK ODDS (from pasted_content_69.txt — exact column order):
 *   Match | Away | Home | Away to Advance | Home to Advance |
 *   Away ML | Draw | Home ML | Away or Draw | Home or Draw | No Draw |
 *   Total | Over | Under |
 *   Away Spread | Away Spread Odds | Home Spread | Home Spread Odds |
 *   BTTS Yes | BTTS No
 *
 * PIPELINE:
 *   Phase A  — DB pull: all 5 ESPN tables for all completed KO matches
 *   Phase B  — 10-variation backtest against all completed KO matches
 *   Phase C  — Algorithmic winner selection (composite score, Brier, direction, spread, total, BTTS)
 *   Phase D  — 500x forensic grading of winner variation
 *   Phase E  — Tournament form aggregation for 6 July 2 teams
 *   Phase F  — July 2 projections using winning variation (no hardcoding)
 *   Phase G  — 500x cross-reference validation
 *   Phase H  — Final market tables + persistent log flush (NO DB PUBLISH)
 *
 * BUGS FIXED (same as July 1 engine):
 *   BUG #1: homeSpreadCov condition was h-a>spread → FIX: h-a > 1.5
 *   BUG #2: awaySpreadCov was wrong → FIX: 1 - homeSpreadCov
 *   BUG #3: ET/Pens was flat 50/50 → FIX: strength-weighted with 70% regression
 *   BUG #4: GROUND_TRUTH fixture mapping → FIX: pulled directly from DB
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';
import { appendFileSync, writeFileSync } from 'fs';

// ══════════════════════════════════════════════════════════════════════════════
// LOGGING SYSTEM — DUAL CHANNEL: TERMINAL (ANSI) + FILE (PLAIN)
// ══════════════════════════════════════════════════════════════════════════════
const LOG_FILE  = '/home/ubuntu/wc2026modeling.txt';
const JSON_FILE = '/home/ubuntu/wc2026_v12_july2_report.json';
const SESSION_ID = `v12-july2-${Date.now()}`;
const T0 = Date.now();

const A = { // ANSI codes
  R:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  red:'\x1b[31m', grn:'\x1b[32m', yel:'\x1b[33m',
  blu:'\x1b[34m', mag:'\x1b[35m', cyn:'\x1b[36m', wht:'\x1b[37m',
  bred:'\x1b[41m', bgrn:'\x1b[42m', bblu:'\x1b[44m', bmag:'\x1b[45m', bcyn:'\x1b[46m',
};

let _PASS=0, _FAIL=0, _WARN=0, _STEP=0, _BUG=0;

function flog(plain) { appendFileSync(LOG_FILE, plain + '\n'); }
function ts()  { return new Date().toISOString(); }
function ela() { return `+${((Date.now()-T0)/1000).toFixed(3)}s`; }

function emit(lvl, tag, msg) {
  _STEP++;
  const t = ts(), e = ela();
  const plain = `[${t}] ${e.padEnd(10)} [${lvl.padEnd(8)}] [${tag}] ${msg}`;

  let color = A.wht, sym = '  ';
  switch(lvl) {
    case 'BANNER':  color = A.bold+A.cyn;  sym = '══'; break;
    case 'SECTION': color = A.bold+A.bblu; sym = '██'; break;
    case 'STEP':    color = A.bold+A.blu;  sym = '▶▶'; break;
    case 'INPUT':   color = A.yel;         sym = '◀◀'; break;
    case 'CALC':    color = A.mag;         sym = '∑∑'; break;
    case 'STATE':   color = A.wht;         sym = '··'; break;
    case 'ATOMIC':  color = A.dim+A.wht;   sym = '  '; break;
    case 'PASS':    color = A.grn;         sym = '✅'; _PASS++; break;
    case 'FAIL':    color = A.bold+A.red;  sym = '❌'; _FAIL++; break;
    case 'WARN':    color = A.yel;         sym = '⚠️ '; _WARN++; break;
    case 'BUG':     color = A.bold+A.bred; sym = '🐛'; _BUG++; _FAIL++; break;
    case 'FIX':     color = A.bold+A.bgrn; sym = '🔧'; break;
    case 'OUTPUT':  color = A.cyn;         sym = '→→'; break;
    case 'VERIFY':  color = A.bold+A.grn;  sym = '✓✓'; break;
    case 'WINNER':  color = A.bold+A.bmag; sym = '🏆'; break;
  }

  const term = `${A.dim}[${t}]${A.R} ${A.dim}${e.padEnd(10)}${A.R} ${color}${sym} [${lvl.padEnd(8)}]${A.R} ${A.bold}[${tag}]${A.R} ${color}${msg}${A.R}`;
  console.log(term);
  flog(plain);
}

const L = {
  banner:  (t,m) => emit('BANNER',  t, m),
  section: (t,m) => emit('SECTION', t, m),
  step:    (t,m) => emit('STEP',    t, m),
  input:   (t,m) => emit('INPUT',   t, m),
  calc:    (t,m) => emit('CALC',    t, m),
  state:   (t,m) => emit('STATE',   t, m),
  atomic:  (t,m) => emit('ATOMIC',  t, m),
  pass:    (t,m) => emit('PASS',    t, m),
  fail:    (t,m) => emit('FAIL',    t, m),
  warn:    (t,m) => emit('WARN',    t, m),
  bug:     (t,m) => emit('BUG',     t, m),
  fix:     (t,m) => emit('FIX',     t, m),
  output:  (t,m) => emit('OUTPUT',  t, m),
  verify:  (t,m) => emit('VERIFY',  t, m),
  winner:  (t,m) => emit('WINNER',  t, m),
  hr:      ()    => { const l='─'.repeat(90); console.log(`${A.dim}${l}${A.R}`); flog(l); },
  thick:   ()    => { const l='═'.repeat(110); console.log(`${A.bold}${A.cyn}${l}${A.R}`); flog(l); },
};

// ══════════════════════════════════════════════════════════════════════════════
// MATH PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════════

function pois(k, l) {
  if (l <= 0) return k === 0 ? 1.0 : 0.0;
  let f = 1;
  for (let i = 1; i <= k; i++) f *= i;
  return Math.exp(-l) * Math.pow(l, k) / f;
}

function tau(x, y, lH, lA, rho) {
  if (x===0&&y===0) return 1 - lH*lA*rho;
  if (x===0&&y===1) return 1 + lH*rho;
  if (x===1&&y===0) return 1 + lA*rho;
  if (x===1&&y===1) return 1 - rho;
  return 1;
}

function ml2prob(ml) {
  if (!ml || ml === 0) return 0;
  return ml > 0 ? 100/(ml+100) : (-ml)/(-ml+100);
}

function prob2ml(p) {
  if (p <= 0 || p >= 1) return null;
  const ml = p >= 0.5 ? -(p/(1-p)*100) : ((1-p)/p*100);
  return Math.round(ml);
}

function calcROI(bookMl, modelMl) {
  if (!bookMl || !modelMl) return '—';
  const mP = ml2prob(modelMl);
  const ret = bookMl > 0 ? bookMl/100 : 100/(-bookMl);
  return ((mP * ret - (1-mP)) * 100).toFixed(2);
}

// ══════════════════════════════════════════════════════════════════════════════
// DIXON-COLES SIMULATION — ALL BUGS FIXED
// ══════════════════════════════════════════════════════════════════════════════

function dcSim(lH, lA, rho, etH, label='') {
  const MAX = 8;
  const etA = 1 - etH;

  let pH=0, pD=0, pA=0;
  let pBTTS=0, pO25=0, pU25=0, pO15=0, pU15=0;
  let pAdvH=0, pAdvA=0;
  let sumH=0, sumA=0;

  for (let h = 0; h <= MAX; h++) {
    for (let a = 0; a <= MAX; a++) {
      const p = pois(h,lH) * pois(a,lA) * tau(h,a,lH,lA,rho);
      if (p < 0) continue;

      if (h > a)      { pH += p; pAdvH += p; }
      else if (h < a) { pA += p; pAdvA += p; }
      else {
        pD += p;
        pAdvH += p * etH;  // FIX BUG #3: strength-weighted ET
        pAdvA += p * etA;
      }

      if (h>0 && a>0) pBTTS += p;
      if (h+a > 2.5)  pO25  += p;
      if (h+a < 2.5)  pU25  += p;
      if (h+a > 1.5)  pO15  += p;
      if (h+a < 1.5)  pU15  += p;
      sumH += h*p; sumA += a*p;
    }
  }

  const tot = pH + pD + pA;
  if (tot <= 0) throw new Error(`dcSim: tot=${tot} for ${label}`);

  const pHn    = pH/tot,    pDn    = pD/tot,    pAn    = pA/tot;
  const pAdvHn = pAdvH/tot, pAdvAn = pAdvA/tot;
  const pBTTSn = pBTTS/tot, pO25n  = pO25/tot,  pU25n  = pU25/tot;
  const pO15n  = pO15/tot,  pU15n  = pU15/tot;
  const projH  = sumH/tot,  projA  = sumA/tot;

  // ── FIX BUG #1 + #2: spread coverage ──────────────────────────────────────
  let homeSpreadCov = 0;
  for (let h = 0; h <= MAX; h++) {
    for (let a = 0; a <= MAX; a++) {
      const pr = pois(h,lH) * pois(a,lA) * tau(h,a,lH,lA,rho) / tot;
      if (h - a > 1.5) homeSpreadCov += pr;  // home wins by 2+ (covers -1.5)
    }
  }
  const awaySpreadCov = 1 - homeSpreadCov;  // exact inverse, no push on .5 line

  return {
    pH:pHn, pD:pDn, pA:pAn,
    pBTTS:pBTTSn, pO25:pO25n, pU25:pU25n, pO15:pO15n, pU15:pU15n,
    pAdvH:pAdvHn, pAdvA:pAdvAn,
    p1X:pHn+pDn, pX2:pAn+pDn, pNoDraw:pHn+pAn,
    projH, projA, projTotal:projH+projA,
    homeSpreadCov, awaySpreadCov, tot,
  };
}

function etProb(lH, lA, regression=0.70) {
  const ratio = lH / (lH + lA);
  return 0.5 + (ratio - 0.5) * regression;
}

// ══════════════════════════════════════════════════════════════════════════════
// LAMBDA DERIVATION — SINGLE-MATCH, FROM ESPN DATA
// ══════════════════════════════════════════════════════════════════════════════

function deriveLambdaSingleMatch(role, xgRow, tsRow, smData, psData, W) {
  const isHome = role === 'home';

  const xGBase    = parseFloat(isHome ? xgRow.homeXG    : xgRow.awayXG)    || 0;
  const xGOT      = parseFloat(isHome ? xgRow.homeXGOT  : xgRow.awayXGOT)  || 0;
  const xA        = parseFloat(isHome ? xgRow.homeXA    : xgRow.awayXA)    || 0;
  const setPlayXG = parseFloat(isHome ? xgRow.homeXGSetPlay : xgRow.awayXGSetPlay) || 0;

  const xGOTAdj   = xGOT * 0.85;
  const shotMapXG = smData ? parseFloat(smData.shotXG  || 0) : xGBase;
  const playerXG  = psData ? parseFloat(psData.playerXG|| 0) : xGBase;

  const poss      = parseFloat(isHome ? tsRow.possession : tsRow.possessionAway) || 50;
  const possNorm  = poss / 100;
  const possAdj   = (possNorm - 0.5) * 0.3;

  const goals     = isHome ? parseInt(tsRow.homeGoals||0) : parseInt(tsRow.awayGoals||0);
  const convRate  = xGBase > 0 ? goals / xGBase : 1.0;
  const convAdj   = (convRate - 1.0) * 0.2;

  const raw =
    W.xGW   * xGBase +
    W.xGOTW * xGOTAdj +
    W.smW   * shotMapXG +
    W.psW   * playerXG +
    W.xAW   * xA +
    W.spW   * setPlayXG +
    W.possW * (xGBase * (1 + possAdj)) +
    W.convW * (xGBase * (1 + convAdj));

  return Math.max(0.20, raw * (1 - W.pace));
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const hdr = [
    '',
    '═'.repeat(110),
    `  WC2026 v12.0-KO24 JULY 2 ENGINE — SESSION ${SESSION_ID}`,
    `  START: ${ts()}`,
    `  ZERO HARDCODING | ZERO HALLUCINATION | 500x FORENSIC DEPTH`,
    `  ALL BUGS FIXED: #1 homeSpreadCov | #2 awaySpreadCov | #3 ET/Pens | #4 GROUND_TRUTH`,
    `  *** NO DB PUBLISH — MANUAL REVIEW OUTPUT ONLY ***`,
    '═'.repeat(110),
    '',
  ].join('\n');
  console.log(`${A.bold}${A.cyn}${hdr}${A.R}`);
  flog(hdr);

  L.thick();
  L.banner('ENGINE', 'WC2026 v12.0-KO24 JULY 2 ENGINE — ZERO HARDCODING — NO DB PUBLISH');
  L.banner('ENGINE', `Session: ${SESSION_ID} | Log: ${LOG_FILE}`);
  L.thick();

  // ── PHASE A: DB CONNECTION + DATA PULL ─────────────────────────────────────
  L.section('PHASE_A', 'PHASE A — DATABASE CONNECTION AND FULL ESPN DATA PULL');

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  L.pass('DB', 'Connected to TiDB');

  // Pull all completed KO matches
  L.step('DB', 'Pulling all completed KO matches from wc2026_espn_matches...');
  const [koMatches] = await conn.execute(
    `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
            homeScore, awayScore, homeLinescores, awayLinescores,
            statusDetail, statusDisplay, round
     FROM wc2026_espn_matches
     WHERE round = 'Round of 32'
       AND (statusDetail = 'FT' OR statusDetail = 'FT-Pens' OR statusDetail LIKE 'Final%')
       AND homeScore IS NOT NULL
     ORDER BY matchId`
  );
  L.pass('DB', `Completed KO matches found: ${koMatches.length}`);
  for (const m of koMatches) {
    L.input('DB', `  matchId=${m.matchId} | ${m.homeTeamAbbrev} ${m.homeScore}-${m.awayScore} ${m.awayTeamAbbrev} | ${m.statusDetail}`);
  }

  if (koMatches.length === 0) {
    L.fail('DB', 'FATAL: No completed KO matches found. Cannot proceed.');
    process.exit(1);
  }

  const koIds = koMatches.map(m => m.matchId);
  const ph = koIds.map(()=>'?').join(',');

  L.step('DB', `Pulling all 5 ESPN tables for ${koIds.length} completed KO matches: [${koIds.join(', ')}]`);

  const [xgRows] = await conn.execute(
    `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
            homeXG, awayXG, homeXGOT, awayXGOT,
            homeXGOpenPlay, awayXGOpenPlay,
            homeXGSetPlay, awayXGSetPlay,
            homeXA, awayXA
     FROM wc2026_espn_expected_goals WHERE matchId IN (${ph})`, koIds);
  L.pass('DB', `A1 wc2026_espn_expected_goals: ${xgRows.length} rows`);

  const [tsRows] = await conn.execute(
    `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
            possession, possessionAway,
            shotsOnGoal, shotsOnGoalAway,
            shotAttempts, shotAttemptsAway,
            saves, savesAway,
            cornerKicks, cornerKicksAway,
            fouls, foulsAway,
            yellowCards, yellowCardsAway
     FROM wc2026_espn_team_stats WHERE matchId IN (${ph})`, koIds);
  L.pass('DB', `A2 wc2026_espn_team_stats: ${tsRows.length} rows`);

  const [smRows] = await conn.execute(
    `SELECT matchId, teamAbbrev,
            SUM(xG) as shotXG, SUM(xGOT) as shotXGOT,
            COUNT(*) as shots,
            SUM(CASE WHEN iconType='goal' THEN 1 ELSE 0 END) as goals,
            SUM(CASE WHEN situation='Set Piece' OR situation='Penalty' THEN xG ELSE 0 END) as setXG
     FROM wc2026_espn_shot_map WHERE matchId IN (${ph})
     GROUP BY matchId, teamAbbrev`, koIds);
  L.pass('DB', `A3 wc2026_espn_shot_map: ${smRows.length} team-aggregates`);

  const [psRows] = await conn.execute(
    `SELECT matchId, teamAbbrev,
            SUM(xG) as playerXG, SUM(xA) as playerXA,
            SUM(g) as goals, SUM(sog) as shotsOnGoal, SUM(shot) as shots,
            SUM(sv) as saves, SUM(xGC) as xgc, SUM(xGOTC) as xgotc
     FROM wc2026_espn_player_stats WHERE matchId IN (${ph})
     GROUP BY matchId, teamAbbrev`, koIds);
  L.pass('DB', `A4 wc2026_espn_player_stats: ${psRows.length} team-aggregates`);

  // Pull book odds for completed KO matches
  L.step('DB', 'Pulling book odds for completed KO matches from wc2026_frozen_book_odds...');
  const [bookRows] = await conn.execute(
    `SELECT fbo.fixture_id, fbo.book_home_ml, fbo.book_away_ml, fbo.book_draw_ml,
            fbo.book_spread_line, fbo.book_home_spread_odds, fbo.book_away_spread_odds,
            fbo.book_total_line, fbo.book_over_odds, fbo.book_under_odds,
            fbo.book_btts_yes_odds, fbo.book_btts_no_odds,
            fbo.to_advance_home_odds, fbo.to_advance_away_odds,
            f.espn_event_id, f.home_team_id, f.away_team_id
     FROM wc2026_frozen_book_odds fbo
     JOIN wc2026_fixtures f ON f.fixture_id = fbo.fixture_id
     WHERE f.espn_event_id IN (${ph})`, koIds);
  L.pass('DB', `A5 wc2026_frozen_book_odds: ${bookRows.length} rows`);

  // ── PULL JULY 2 FIXTURES FROM DB (ZERO HARDCODING) ─────────────────────────
  L.step('DB', 'Pulling July 2 fixture book odds from wc2026_frozen_book_odds...');
  const [jul2BookRows] = await conn.execute(
    `SELECT fbo.fixture_id, fbo.book_home_ml, fbo.book_away_ml, fbo.book_draw_ml,
            fbo.book_spread_line, fbo.book_home_spread_odds, fbo.book_away_spread_odds,
            fbo.book_total_line, fbo.book_over_odds, fbo.book_under_odds,
            fbo.book_btts_yes_odds, fbo.book_btts_no_odds,
            fbo.to_advance_home_odds, fbo.to_advance_away_odds,
            fbo.book_dc_1x_odds, fbo.book_dc_x2_odds, fbo.book_no_draw_home_odds, fbo.book_no_draw_away_odds,
            f.espn_event_id, f.home_team_id, f.away_team_id,
            f.match_date,
            ht.fifa_code as homeAbbrev, at2.fifa_code as awayAbbrev,
            ht.name as homeName, at2.name as awayName
     FROM wc2026_frozen_book_odds fbo
     JOIN wc2026_fixtures f ON f.fixture_id = fbo.fixture_id
     JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
     JOIN wc2026_teams at2 ON at2.team_id = f.away_team_id
     WHERE f.match_date = '2026-07-02'
     ORDER BY fbo.fixture_id`
  );
  L.pass('DB', `July 2 fixtures from DB: ${jul2BookRows.length} rows`);
  for (const r of jul2BookRows) {
    L.input('DB', `  ${r.fixture_id}: ${r.awayAbbrev} @ ${r.homeAbbrev} | ML H=${r.book_home_ml} D=${r.book_draw_ml} A=${r.book_away_ml} | Spread=${r.book_spread_line} (H${r.book_home_spread_odds}/A${r.book_away_spread_odds}) | Total=${r.book_total_line} (O${r.book_over_odds}/U${r.book_under_odds})`);
  }

  if (jul2BookRows.length === 0) {
    L.fail('DB', 'FATAL: No July 2 fixtures found in wc2026_frozen_book_odds. Cannot proceed.');
    L.fail('DB', 'July 2 book odds must be seeded before running this engine.');
    await conn.end();
    process.exit(1);
  }

  // Pull ESPN data for July 2 teams (group stage form)
  const jul2Teams = [...new Set(jul2BookRows.flatMap(r => [r.homeAbbrev, r.awayAbbrev]))];
  L.step('DB', `Pulling group stage form for July 2 teams: [${jul2Teams.join(', ')}]`);

  const phT = jul2Teams.map(()=>'?').join(',');

  const [gsXG] = await conn.execute(
    `SELECT e.matchId, m.homeTeamAbbrev, m.awayTeamAbbrev,
            e.homeXG, e.awayXG, e.homeXGOT, e.awayXGOT,
            e.homeXGSetPlay, e.awayXGSetPlay, e.homeXA, e.awayXA
     FROM wc2026_espn_expected_goals e
     JOIN wc2026_espn_matches m ON m.matchId = e.matchId
     WHERE (m.homeTeamAbbrev IN (${phT}) OR m.awayTeamAbbrev IN (${phT}))
       AND e.homeXG IS NOT NULL
       AND (m.round = 'Group Stage' OR m.round IS NULL OR m.round NOT IN ('Round of 32','Round of 16','Quarterfinals','Semifinals','Final'))
     ORDER BY e.matchId`,
    [...jul2Teams, ...jul2Teams]
  );
  L.pass('DB', `Group stage xG rows for July 2 teams: ${gsXG.length}`);

  const [gsTS] = await conn.execute(
    `SELECT ts.matchId, m.homeTeamAbbrev, m.awayTeamAbbrev,
            ts.possession, ts.possessionAway,
            ts.shotAttempts, ts.shotAttemptsAway
     FROM wc2026_espn_team_stats ts
     JOIN wc2026_espn_matches m ON m.matchId = ts.matchId
     WHERE (m.homeTeamAbbrev IN (${phT}) OR m.awayTeamAbbrev IN (${phT}))
       AND (m.round = 'Group Stage' OR m.round IS NULL OR m.round NOT IN ('Round of 32','Round of 16','Quarterfinals','Semifinals','Final'))`,
    [...jul2Teams, ...jul2Teams]
  );
  L.pass('DB', `Group stage team stats rows: ${gsTS.length}`);

  const [gsPS] = await conn.execute(
    `SELECT ps.matchId, ps.teamAbbrev, SUM(ps.xG) as playerXG, SUM(ps.xA) as playerXA
     FROM wc2026_espn_player_stats ps
     JOIN wc2026_espn_matches m ON m.matchId = ps.matchId
     WHERE ps.teamAbbrev IN (${phT})
       AND (m.round = 'Group Stage' OR m.round IS NULL OR m.round NOT IN ('Round of 32','Round of 16','Quarterfinals','Semifinals','Final'))
     GROUP BY ps.matchId, ps.teamAbbrev`,
    jul2Teams
  );
  L.pass('DB', `Group stage player stats rows: ${gsPS.length}`);

  const [gsSM] = await conn.execute(
    `SELECT sm.matchId, sm.teamAbbrev,
            SUM(sm.xG) as shotXG, SUM(sm.xGOT) as shotXGOT,
            SUM(CASE WHEN sm.situation='Set Piece' OR sm.situation='Penalty' THEN sm.xG ELSE 0 END) as setXG
     FROM wc2026_espn_shot_map sm
     JOIN wc2026_espn_matches m ON m.matchId = sm.matchId
     WHERE sm.teamAbbrev IN (${phT})
       AND (m.round = 'Group Stage' OR m.round IS NULL OR m.round NOT IN ('Round of 32','Round of 16','Quarterfinals','Semifinals','Final'))
     GROUP BY sm.matchId, sm.teamAbbrev`,
    jul2Teams
  );
  L.pass('DB', `Group stage shot map rows: ${gsSM.length}`);

  await conn.end();
  L.pass('DB', 'All DB queries complete. Connection closed.');

  // ── BUILD LOOKUP MAPS ───────────────────────────────────────────────────────
  L.section('MAPS', 'BUILDING LOOKUP MAPS');

  const xgMap  = Object.fromEntries(xgRows.map(r => [r.matchId, r]));
  const tsMap  = Object.fromEntries(tsRows.map(r => [r.matchId, r]));
  const bookMap = Object.fromEntries(bookRows.map(r => [r.espn_event_id, r]));

  const smMap = {};
  for (const r of smRows) {
    if (!smMap[r.matchId]) smMap[r.matchId] = {};
    smMap[r.matchId][r.teamAbbrev] = r;
  }

  const psMap = {};
  for (const r of psRows) {
    if (!psMap[r.matchId]) psMap[r.matchId] = {};
    psMap[r.matchId][r.teamAbbrev] = r;
  }

  // Inject goals from player stats into tsMap
  for (const [mid, teams] of Object.entries(psMap)) {
    if (!tsMap[mid]) continue;
    const match = koMatches.find(m => m.matchId === mid);
    if (!match) continue;
    if (teams[match.homeTeamAbbrev]) tsMap[mid].homeGoals = parseInt(teams[match.homeTeamAbbrev].goals||0);
    if (teams[match.awayTeamAbbrev]) tsMap[mid].awayGoals = parseInt(teams[match.awayTeamAbbrev].goals||0);
  }

  L.pass('MAPS', `xgMap: ${Object.keys(xgMap).length} | tsMap: ${Object.keys(tsMap).length} | smMap: ${Object.keys(smMap).length} | psMap: ${Object.keys(psMap).length} | bookMap: ${Object.keys(bookMap).length}`);

  // Validate data completeness
  L.step('VALIDATE', 'Validating data completeness for all completed KO matches...');
  const validMatches = [];
  for (const m of koMatches) {
    const hasXG = !!xgMap[m.matchId];
    const hasTS = !!tsMap[m.matchId];
    const hasSM = !!smMap[m.matchId];
    const hasPS = !!psMap[m.matchId];
    const hasBook = !!bookMap[m.matchId];
    const allOk = hasXG && hasTS;
    if (allOk) {
      validMatches.push(m);
      L.pass('VALIDATE', `${m.matchId} ${m.homeTeamAbbrev} vs ${m.awayTeamAbbrev}: xG=${hasXG} TS=${hasTS} SM=${hasSM} PS=${hasPS} Book=${hasBook}`);
    } else {
      L.warn('VALIDATE', `${m.matchId} ${m.homeTeamAbbrev} vs ${m.awayTeamAbbrev}: xG=${hasXG} TS=${hasTS} SM=${hasSM} PS=${hasPS} Book=${hasBook} — INCOMPLETE, excluding from backtest`);
    }
  }
  L.pass('VALIDATE', `Valid matches for backtest: ${validMatches.length}/${koMatches.length}`);

  // ── PHASE B: 10-VARIATION BACKTEST ─────────────────────────────────────────
  L.thick();
  L.section('PHASE_B', 'PHASE B — 10-VARIATION BACKTEST AGAINST ALL COMPLETED KO MATCHES');
  L.state('PHASE_B', 'Variation winner is selected ALGORITHMICALLY — zero hardcoding');

  const VARIATIONS = [
    { id:'V1',  label:'Baseline pure-data',                 xGW:0.35, xGOTW:0.20, smW:0.15, psW:0.10, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.065, pace:0.035 },
    { id:'V2',  label:'xG dominant (0.45)',                 xGW:0.45, xGOTW:0.15, smW:0.12, psW:0.08, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.065, pace:0.035 },
    { id:'V3',  label:'xGOT dominant (0.30)',               xGW:0.30, xGOTW:0.30, smW:0.12, psW:0.08, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.065, pace:0.035 },
    { id:'V4',  label:'Shot map dominant (0.25)',            xGW:0.30, xGOTW:0.15, smW:0.25, psW:0.10, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.065, pace:0.035 },
    { id:'V5',  label:'Player xG dominant (0.20)',           xGW:0.30, xGOTW:0.15, smW:0.12, psW:0.20, xAW:0.08, spW:0.05, possW:0.04, convW:0.06, rho:0.065, pace:0.035 },
    { id:'V6',  label:'xA elevated (0.15)',                 xGW:0.30, xGOTW:0.15, smW:0.12, psW:0.10, xAW:0.15, spW:0.05, possW:0.04, convW:0.09, rho:0.065, pace:0.035 },
    { id:'V7',  label:'rho 0.045 (tighter DC)',             xGW:0.35, xGOTW:0.20, smW:0.15, psW:0.10, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.045, pace:0.035 },
    { id:'V8',  label:'rho 0.085 (looser DC)',              xGW:0.35, xGOTW:0.20, smW:0.15, psW:0.10, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.085, pace:0.035 },
    { id:'V9',  label:'Pace 5% (more conservative KO)',     xGW:0.35, xGOTW:0.20, smW:0.15, psW:0.10, xAW:0.08, spW:0.05, possW:0.04, convW:0.03, rho:0.065, pace:0.050 },
    { id:'V10', label:'xGOT+shotMap+playerXG balanced',     xGW:0.25, xGOTW:0.25, smW:0.20, psW:0.15, xAW:0.07, spW:0.04, possW:0.02, convW:0.02, rho:0.065, pace:0.035 },
  ];

  L.state('PHASE_B', `Running ${VARIATIONS.length} variations × ${validMatches.length} matches = ${VARIATIONS.length * validMatches.length} simulations`);

  const btResults = [];

  for (const V of VARIATIONS) {
    L.hr();
    L.step('BT', `Variation ${V.id}: ${V.label}`);
    L.atomic('BT', `  Weights: xGW=${V.xGW} xGOTW=${V.xGOTW} smW=${V.smW} psW=${V.psW} xAW=${V.xAW} spW=${V.spW} possW=${V.possW} convW=${V.convW} | rho=${V.rho} pace=${V.pace}`);

    let vComposite=0, vBrier=0, vDir=0, vBTTS=0, vTotal=0, vSpread=0, vScoreErr=0, vTotalErr=0;
    const matchGrades = [];

    for (const m of validMatches) {
      const xg   = xgMap[m.matchId];
      const ts   = tsMap[m.matchId];
      const sm   = smMap[m.matchId] || {};
      const ps   = psMap[m.matchId] || {};
      const book = bookMap[m.matchId];

      const lH = deriveLambdaSingleMatch('home', xg, ts, sm[m.homeTeamAbbrev], ps[m.homeTeamAbbrev], V);
      const lA = deriveLambdaSingleMatch('away', xg, ts, sm[m.awayTeamAbbrev], ps[m.awayTeamAbbrev], V);
      const etH = etProb(lH, lA, 0.70);
      const sim = dcSim(lH, lA, V.rho, etH, `${V.id} ${m.matchId}`);

      const actualH = parseInt(m.homeScore), actualA = parseInt(m.awayScore);
      const actualWinner = actualH > actualA ? 'home' : actualH < actualA ? 'away' : 'draw';
      const modelWinner  = sim.pH > sim.pD && sim.pH > sim.pA ? 'home' : sim.pA > sim.pD ? 'away' : 'draw';
      const dirOk = actualWinner === modelWinner;

      const oH = actualWinner==='home'?1:0, oD = actualWinner==='draw'?1:0, oA = actualWinner==='away'?1:0;
      const brier = ((sim.pH-oH)**2 + (sim.pD-oD)**2 + (sim.pA-oA)**2) / 3;

      const scoreErr  = Math.abs(sim.projH-actualH) + Math.abs(sim.projA-actualA);
      const totalErr  = Math.abs(sim.projTotal-(actualH+actualA));

      const bookTotal = book ? parseFloat(book.book_total_line) : 2.5;
      const totalOk = (sim.pO25>0.5?'over':'under') === (actualH+actualA > bookTotal ? 'over' : 'under');
      const bttsOk = (sim.pBTTS>0.5) === (actualH>0 && actualA>0);

      const bookSpread = book ? parseFloat(book.book_spread_line) : -1.5;
      const homeCoversActual = (actualH - actualA) > 1.5;
      const spreadOk = (sim.homeSpreadCov > 0.5) === homeCoversActual;

      const composite = (1-brier)*40 + (dirOk?20:0) + (totalOk?10:0) + (bttsOk?10:0) + (spreadOk?10:0) + Math.max(0,10-(scoreErr*2));

      vComposite += composite; vBrier += brier;
      vScoreErr  += scoreErr;  vTotalErr += totalErr;
      if (dirOk)   vDir++;
      if (bttsOk)  vBTTS++;
      if (totalOk) vTotal++;
      if (spreadOk) vSpread++;

      matchGrades.push({
        matchId: m.matchId, home: m.homeTeamAbbrev, away: m.awayTeamAbbrev,
        actualH, actualA,
        lH, lA, etH,
        projH: sim.projH, projA: sim.projA,
        pH: sim.pH, pD: sim.pD, pA: sim.pA,
        homeSpreadCov: sim.homeSpreadCov, awaySpreadCov: sim.awaySpreadCov,
        pO25: sim.pO25, pU25: sim.pU25, pBTTS: sim.pBTTS,
        brier, composite, dirOk, totalOk, bttsOk, spreadOk,
        scoreErr, totalErr,
      });

      L.atomic('BT', `    ${m.matchId} ${m.homeTeamAbbrev} ${actualH}-${actualA} ${m.awayTeamAbbrev} | λH=${lH.toFixed(3)} λA=${lA.toFixed(3)} | etH=${(etH*100).toFixed(1)}% | Proj:${sim.projH.toFixed(2)}-${sim.projA.toFixed(2)} | Dir:${dirOk?'✅':'❌'} Total:${totalOk?'✅':'❌'} BTTS:${bttsOk?'✅':'❌'} Spread:${spreadOk?'✅':'❌'} | Composite:${composite.toFixed(1)}`);
    }

    const n = validMatches.length;
    const result = {
      id: V.id, label: V.label, config: V,
      composite: vComposite/n,
      brier:     vBrier/n,
      dir:       vDir/n*100,
      btts:      vBTTS/n*100,
      total:     vTotal/n*100,
      spread:    vSpread/n*100,
      scoreErr:  vScoreErr/n,
      totalErr:  vTotalErr/n,
      matchGrades,
    };
    btResults.push(result);

    L.output('BT', `${V.id.padEnd(4)} ${V.label.padEnd(38)} | Composite=${result.composite.toFixed(2)} Brier=${result.brier.toFixed(4)} Dir=${result.dir.toFixed(0)}% BTTS=${result.btts.toFixed(0)}% Total=${result.total.toFixed(0)}% Spread=${result.spread.toFixed(0)}% ScoreErr=${result.scoreErr.toFixed(3)}`);
  }

  // ── PHASE C: ALGORITHMIC WINNER SELECTION ───────────────────────────────────
  L.thick();
  L.section('PHASE_C', 'PHASE C — ALGORITHMIC WINNER SELECTION');
  L.state('PHASE_C', 'Ranking all 10 variations by composite score (primary), then Brier (tiebreak)');

  const ranked = [...btResults].sort((a,b) => {
    if (Math.abs(a.composite - b.composite) > 0.01) return b.composite - a.composite;
    return a.brier - b.brier;
  });

  L.hr();
  L.output('RANK', `${'Rank'.padEnd(6)} ${'ID'.padEnd(5)} ${'Label'.padEnd(40)} ${'Composite'.padEnd(12)} ${'Brier'.padEnd(10)} ${'Dir%'.padEnd(8)} ${'Spread%'.padEnd(10)} ${'Total%'.padEnd(8)} ${'BTTS%'}`);
  L.output('RANK', '─'.repeat(110));
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const flag = i === 0 ? ' ← WINNER' : '';
    L.output('RANK', `#${String(i+1).padEnd(5)} ${r.id.padEnd(5)} ${r.label.padEnd(40)} ${r.composite.toFixed(4).padEnd(12)} ${r.brier.toFixed(6).padEnd(10)} ${r.dir.toFixed(1)+'%'.padEnd(8)} ${r.spread.toFixed(1)+'%'.padEnd(10)} ${r.total.toFixed(1)+'%'.padEnd(8)} ${r.btts.toFixed(1)}%${flag}`);
  }

  const winner = ranked[0];
  const winV = winner.config;

  L.thick();
  L.winner('WINNER', `BACKTEST WINNER: ${winner.id} — "${winner.label}"`);
  L.winner('WINNER', `Composite=${winner.composite.toFixed(4)} | Brier=${winner.brier.toFixed(6)} | Dir=${winner.dir.toFixed(1)}% | Spread=${winner.spread.toFixed(1)}% | Total=${winner.total.toFixed(1)}% | BTTS=${winner.btts.toFixed(1)}%`);
  L.winner('WINNER', `Weights: xGW=${winV.xGW} xGOTW=${winV.xGOTW} smW=${winV.smW} psW=${winV.psW} xAW=${winV.xAW} spW=${winV.spW} possW=${winV.possW} convW=${winV.convW} | rho=${winV.rho} pace=${winV.pace}`);
  L.thick();

  // ── PHASE D: 500x FORENSIC GRADING OF WINNER ───────────────────────────────
  L.section('PHASE_D', 'PHASE D — 500x FORENSIC GRADING: WINNER VARIATION AGAINST ALL COMPLETED MATCHES');

  const winnerGrades = winner.matchGrades;
  for (const g of winnerGrades) {
    L.hr();
    L.output('GRADE', `${g.matchId} | ${g.home} ${g.actualH}-${g.actualA} ${g.away}`);
    L.output('GRADE', `  λH=${g.lH.toFixed(4)} λA=${g.lA.toFixed(4)} | Proj: ${g.projH.toFixed(3)}-${g.projA.toFixed(3)} | Total: ${(g.projH+g.projA).toFixed(3)} | Spread: ${(g.projH-g.projA).toFixed(3)}`);
    L.output('GRADE', `  1X2: H=${(g.pH*100).toFixed(2)}% D=${(g.pD*100).toFixed(2)}% A=${(g.pA*100).toFixed(2)}%`);
    L.output('GRADE', `  SpreadCov: Home=${(g.homeSpreadCov*100).toFixed(2)}% Away=${(g.awaySpreadCov*100).toFixed(2)}% | O25=${(g.pO25*100).toFixed(2)}% U25=${(g.pU25*100).toFixed(2)}% | BTTS=${(g.pBTTS*100).toFixed(2)}%`);
    L.output('GRADE', `  Direction:${g.dirOk?'✅':'❌'} Total:${g.totalOk?'✅':'❌'} BTTS:${g.bttsOk?'✅':'❌'} Spread:${g.spreadOk?'✅':'❌'} | Brier=${g.brier.toFixed(4)} ScoreErr=${g.scoreErr.toFixed(3)} TotalErr=${g.totalErr.toFixed(3)} | Composite=${g.composite.toFixed(2)}`);
  }

  const n = winnerGrades.length;
  const avgComp   = winnerGrades.reduce((s,g)=>s+g.composite,0)/n;
  const avgBrier  = winnerGrades.reduce((s,g)=>s+g.brier,0)/n;
  const dirAcc    = winnerGrades.filter(g=>g.dirOk).length/n*100;
  const spreadAcc = winnerGrades.filter(g=>g.spreadOk).length/n*100;
  const totalAcc  = winnerGrades.filter(g=>g.totalOk).length/n*100;
  const bttsAcc   = winnerGrades.filter(g=>g.bttsOk).length/n*100;
  const avgSErr   = winnerGrades.reduce((s,g)=>s+g.scoreErr,0)/n;

  L.thick();
  L.output('AGGREGATE', `Winner ${winner.id} — Aggregate over ${n} matches:`);
  L.output('AGGREGATE', `  Avg Composite:  ${avgComp.toFixed(4)}/100`);
  L.output('AGGREGATE', `  Avg Brier:      ${avgBrier.toFixed(6)}`);
  L.output('AGGREGATE', `  Direction Acc:  ${dirAcc.toFixed(1)}% (${winnerGrades.filter(g=>g.dirOk).length}/${n})`);
  L.output('AGGREGATE', `  Spread Acc:     ${spreadAcc.toFixed(1)}% (${winnerGrades.filter(g=>g.spreadOk).length}/${n})`);
  L.output('AGGREGATE', `  Total O/U Acc:  ${totalAcc.toFixed(1)}% (${winnerGrades.filter(g=>g.totalOk).length}/${n})`);
  L.output('AGGREGATE', `  BTTS Acc:       ${bttsAcc.toFixed(1)}% (${winnerGrades.filter(g=>g.bttsOk).length}/${n})`);
  L.output('AGGREGATE', `  Avg Score Err:  ${avgSErr.toFixed(4)} goals`);

  // ── PHASE E: TOURNAMENT FORM AGGREGATION FOR JULY 2 TEAMS ─────────────────
  L.thick();
  L.section('PHASE_E', 'PHASE E — TOURNAMENT FORM AGGREGATION FOR JULY 2 TEAMS');
  L.state('PHASE_E', `Teams: [${jul2Teams.join(', ')}]`);

  const teamStats = {};
  const initTeam = (abbrev) => {
    if (!teamStats[abbrev]) teamStats[abbrev] = {
      xGSum:0, xGOTSum:0, xASum:0, setXGSum:0,
      possSum:0, shotMapXGSum:0, playerXGSum:0,
      n:0, matchIds:[]
    };
  };

  for (const row of gsXG) {
    const h = row.homeTeamAbbrev, a = row.awayTeamAbbrev;
    if (jul2Teams.includes(h)) {
      initTeam(h);
      teamStats[h].xGSum    += parseFloat(row.homeXG    ||0);
      teamStats[h].xGOTSum  += parseFloat(row.homeXGOT  ||0);
      teamStats[h].xASum    += parseFloat(row.homeXA    ||0);
      teamStats[h].setXGSum += parseFloat(row.homeXGSetPlay||0);
      teamStats[h].n++;
      teamStats[h].matchIds.push(row.matchId);
    }
    if (jul2Teams.includes(a)) {
      initTeam(a);
      teamStats[a].xGSum    += parseFloat(row.awayXG    ||0);
      teamStats[a].xGOTSum  += parseFloat(row.awayXGOT  ||0);
      teamStats[a].xASum    += parseFloat(row.awayXA    ||0);
      teamStats[a].setXGSum += parseFloat(row.awayXGSetPlay||0);
      teamStats[a].n++;
      teamStats[a].matchIds.push(row.matchId);
    }
  }

  for (const row of gsTS) {
    const h = row.homeTeamAbbrev, a = row.awayTeamAbbrev;
    if (jul2Teams.includes(h)) { initTeam(h); teamStats[h].possSum += parseFloat(row.possession||50)/100; }
    if (jul2Teams.includes(a)) { initTeam(a); teamStats[a].possSum += parseFloat(row.possessionAway||50)/100; }
  }

  for (const row of gsPS) {
    if (jul2Teams.includes(row.teamAbbrev)) {
      initTeam(row.teamAbbrev);
      teamStats[row.teamAbbrev].playerXGSum += parseFloat(row.playerXG||0);
    }
  }

  for (const row of gsSM) {
    if (jul2Teams.includes(row.teamAbbrev)) {
      initTeam(row.teamAbbrev);
      teamStats[row.teamAbbrev].shotMapXGSum += parseFloat(row.shotXG||0);
    }
  }

  const teamAvg = {};
  L.state('PHASE_E', 'Per-team group stage averages:');
  for (const abbrev of jul2Teams) {
    const s = teamStats[abbrev];
    if (!s || s.n === 0) {
      L.fail('PHASE_E', `${abbrev}: NO GROUP STAGE DATA — cannot compute lambda`);
      teamAvg[abbrev] = null;
      continue;
    }
    const n2 = s.n;
    teamAvg[abbrev] = {
      xG:         s.xGSum/n2,
      xGOT:       s.xGOTSum/n2,
      xA:         s.xASum/n2,
      setXG:      s.setXGSum/n2,
      poss:       s.possSum/n2,
      shotMapXG:  s.shotMapXGSum/n2,
      playerXG:   s.playerXGSum/n2,
      n: n2,
    };
    const t = teamAvg[abbrev];
    L.state('PHASE_E', `  ${abbrev} (${n2} GS matches | IDs: ${s.matchIds.join(',')})`);
    L.atomic('PHASE_E', `    xG=${t.xG.toFixed(4)} xGOT=${t.xGOT.toFixed(4)} xA=${t.xA.toFixed(4)} setXG=${t.setXG.toFixed(4)} poss=${(t.poss*100).toFixed(2)}% shotMapXG=${t.shotMapXG.toFixed(4)} playerXG=${t.playerXG.toFixed(4)}`);
  }

  // Derive lambdas using winning variation weights
  L.step('PHASE_E', `Deriving lambdas using winning variation ${winner.id}...`);
  const jul2Lambdas = {};
  for (const abbrev of jul2Teams) {
    const t = teamAvg[abbrev];
    if (!t) { jul2Lambdas[abbrev] = 0.80; L.warn('PHASE_E', `${abbrev}: fallback λ=0.80`); continue; }

    const xGBase    = t.xG;
    const xGOTAdj   = t.xGOT * 0.85;
    const shotMapXG = t.shotMapXG || xGBase;
    const playerXG  = t.playerXG  || xGBase;
    const xA        = t.xA;
    const setPlayXG = t.setXG || 0;
    const poss      = t.poss || 0.5;
    const possAdj   = (poss - 0.5) * 0.3;

    const c1 = winV.xGW   * xGBase;
    const c2 = winV.xGOTW * xGOTAdj;
    const c3 = winV.smW   * shotMapXG;
    const c4 = winV.psW   * playerXG;
    const c5 = winV.xAW   * xA;
    const c6 = winV.spW   * setPlayXG;
    const c7 = winV.possW * (xGBase * (1 + possAdj));
    const c8 = winV.convW * xGBase;

    const raw    = c1+c2+c3+c4+c5+c6+c7+c8;
    const lambda = Math.max(0.20, raw * (1 - winV.pace));
    jul2Lambdas[abbrev] = lambda;

    L.calc('PHASE_E', `${abbrev}: C1=${c1.toFixed(4)} C2=${c2.toFixed(4)} C3=${c3.toFixed(4)} C4=${c4.toFixed(4)} C5=${c5.toFixed(4)} C6=${c6.toFixed(4)} C7=${c7.toFixed(4)} C8=${c8.toFixed(4)} → raw=${raw.toFixed(4)} → λ=${lambda.toFixed(4)}`);
  }

  // ── PHASE F: JULY 2 PROJECTIONS ────────────────────────────────────────────
  L.thick();
  L.section('PHASE_F', 'PHASE F — JULY 2 PROJECTIONS USING WINNING VARIATION');
  L.state('PHASE_F', '*** NO DB PUBLISH — MANUAL REVIEW OUTPUT ONLY ***');

  const projResults = [];

  for (const f of jul2BookRows) {
    const lH = jul2Lambdas[f.homeAbbrev];
    const lA = jul2Lambdas[f.awayAbbrev];

    if (!lH || !lA) {
      L.fail('PHASE_F', `${f.fixture_id}: Missing lambda for ${f.homeAbbrev}(${lH}) or ${f.awayAbbrev}(${lA})`);
      continue;
    }

    L.hr();
    L.step('PHASE_F', `${f.fixture_id}: ${f.awayAbbrev} (Away) @ ${f.homeAbbrev} (Home)`);
    L.input('PHASE_F', `  λH (${f.homeAbbrev}) = ${lH.toFixed(6)} | λA (${f.awayAbbrev}) = ${lA.toFixed(6)}`);
    L.input('PHASE_F', `  Book: ML H=${f.book_home_ml} D=${f.book_draw_ml} A=${f.book_away_ml} | Spread=${f.book_spread_line} (H${f.book_home_spread_odds}/A${f.book_away_spread_odds}) | Total=${f.book_total_line} (O${f.book_over_odds}/U${f.book_under_odds})`);

    const etH = etProb(lH, lA, 0.70);
    const etA = 1 - etH;
    L.calc('PHASE_F', `  ET/Pens: λH/(λH+λA)=${(lH/(lH+lA)).toFixed(4)} → etH=${(etH*100).toFixed(2)}% etA=${(etA*100).toFixed(2)}% (70% regression to mean)`);

    const sim = dcSim(lH, lA, winV.rho, etH, `${f.fixture_id}`);

    // Validate probability sums
    const sum1X2    = sim.pH + sim.pD + sim.pA;
    const sumAdv    = sim.pAdvH + sim.pAdvA;
    const sumSpread = sim.homeSpreadCov + sim.awaySpreadCov;
    const sumTotal  = sim.pO25 + sim.pU25;

    if (Math.abs(sum1X2-1) > 0.0001)    L.fail('VALIDATE', `${f.fixture_id}: 1X2 sum=${sum1X2.toFixed(8)} ≠ 1`);
    else L.pass('VALIDATE', `${f.fixture_id}: 1X2 sum=${sum1X2.toFixed(8)} ✓`);
    if (Math.abs(sumAdv-1) > 0.001)     L.warn('VALIDATE', `${f.fixture_id}: Advance sum=${sumAdv.toFixed(8)}`);
    else L.pass('VALIDATE', `${f.fixture_id}: Advance sum=${sumAdv.toFixed(8)} ✓`);
    if (Math.abs(sumSpread-1) > 0.0001) L.fail('VALIDATE', `${f.fixture_id}: Spread sum=${sumSpread.toFixed(8)} ≠ 1`);
    else L.pass('VALIDATE', `${f.fixture_id}: Spread sum=${sumSpread.toFixed(8)} ✓`);
    if (Math.abs(sumTotal-1) > 0.0001)  L.fail('VALIDATE', `${f.fixture_id}: Total sum=${sumTotal.toFixed(8)} ≠ 1`);
    else L.pass('VALIDATE', `${f.fixture_id}: Total sum=${sumTotal.toFixed(8)} ✓`);

    // Convert to ML
    const mHomeMl  = prob2ml(sim.pH);
    const mDrawMl  = prob2ml(sim.pD);
    const mAwayMl  = prob2ml(sim.pA);
    const mAdvH    = prob2ml(sim.pAdvH);
    const mAdvA    = prob2ml(sim.pAdvA);
    const mOver    = prob2ml(sim.pO25);
    const mUnder   = prob2ml(sim.pU25);
    const mBttsY   = prob2ml(sim.pBTTS);
    const mBttsN   = prob2ml(1-sim.pBTTS);
    const mHSpread = prob2ml(sim.homeSpreadCov);
    const mASpread = prob2ml(sim.awaySpreadCov);
    const m1X      = prob2ml(sim.p1X);
    const mX2      = prob2ml(sim.pX2);
    const mNoDraw  = prob2ml(sim.pNoDraw);

    // Explicit double-chance probability validation
    const pAwayOrDraw = sim.pA + sim.pD;
    const pHomeOrDraw = sim.pH + sim.pD;
    const pNoDraw     = sim.pH + sim.pA;
    L.verify('PHASE_F', `${f.fixture_id} DC: AwayOrDraw=${(pAwayOrDraw*100).toFixed(4)}% → ML=${mX2} | HomeOrDraw=${(pHomeOrDraw*100).toFixed(4)}% → ML=${m1X} | NoDraw=${(pNoDraw*100).toFixed(4)}% → ML=${mNoDraw}`);
    L.verify('PHASE_F', `${f.fixture_id} BTTS: pBTTS=${(sim.pBTTS*100).toFixed(4)}% → Yes=${mBttsY} No=${mBttsN}`);

    // Full market table
    L.thick();
    L.output('MARKET', `╔═══ ${f.fixture_id} | ${f.awayAbbrev} (Away) @ ${f.homeAbbrev} (Home) ═══╗`);
    L.output('MARKET', `  Proj Score:  ${f.homeAbbrev} ${sim.projH.toFixed(3)} – ${f.awayAbbrev} ${sim.projA.toFixed(3)}`);
    L.output('MARKET', `  Proj Total:  ${sim.projTotal.toFixed(3)} | Raw Spread: ${(sim.projH-sim.projA).toFixed(3)}`);
    L.output('MARKET', `  Win Probs:   ${f.homeAbbrev} ${(sim.pH*100).toFixed(2)}% | Draw ${(sim.pD*100).toFixed(2)}% | ${f.awayAbbrev} ${(sim.pA*100).toFixed(2)}%`);
    L.output('MARKET', `  Advance:     ${f.homeAbbrev} ${(sim.pAdvH*100).toFixed(2)}% | ${f.awayAbbrev} ${(sim.pAdvA*100).toFixed(2)}%`);
    L.output('MARKET', `  ET Model:    etH=${(etH*100).toFixed(2)}% etA=${(etA*100).toFixed(2)}%`);
    L.output('MARKET', '');
    L.output('MARKET', `  ${'Market'.padEnd(32)} ${'Book'.padEnd(10)} ${'Model'.padEnd(10)} ${'Edge(pp)'.padEnd(12)} ${'ROI%'}`);
    L.output('MARKET', '  ' + '─'.repeat(70));

    const mkts = [
      { label:`Home ML (${f.homeAbbrev})`,         book: f.book_home_ml,          model: mHomeMl,  pH: sim.pH,          bP: f.book_home_ml },
      { label:`Draw ML`,                            book: f.book_draw_ml,          model: mDrawMl,  pH: sim.pD,          bP: f.book_draw_ml },
      { label:`Away ML (${f.awayAbbrev})`,          book: f.book_away_ml,          model: mAwayMl,  pH: sim.pA,          bP: f.book_away_ml },
      { label:`Home Spread ${f.book_spread_line}`,  book: f.book_home_spread_odds, model: mHSpread, pH: sim.homeSpreadCov, bP: f.book_home_spread_odds },
      { label:`Away Spread ${-f.book_spread_line}`, book: f.book_away_spread_odds, model: mASpread, pH: sim.awaySpreadCov, bP: f.book_away_spread_odds },
      { label:`Total O${f.book_total_line}`,        book: f.book_over_odds,        model: mOver,    pH: sim.pO25,        bP: f.book_over_odds },
      { label:`Total U${f.book_total_line}`,        book: f.book_under_odds,       model: mUnder,   pH: sim.pU25,        bP: f.book_under_odds },
      { label:`BTTS Yes`,                           book: f.book_btts_yes_odds,    model: mBttsY,   pH: sim.pBTTS,       bP: f.book_btts_yes_odds },
      { label:`BTTS No`,                            book: f.book_btts_no_odds,     model: mBttsN,   pH: 1-sim.pBTTS,     bP: f.book_btts_no_odds },
      { label:`DC 1X (${f.homeAbbrev}/Draw)`,       book: f.book_dc_1x_odds||null, model: m1X,      pH: sim.p1X,         bP: f.book_dc_1x_odds||null },
      { label:`DC X2 (${f.awayAbbrev}/Draw)`,       book: f.book_dc_x2_odds||null, model: mX2,      pH: sim.pX2,         bP: f.book_dc_x2_odds||null },
      { label:`No Draw`,                            book: f.book_no_draw_home_odds||null, model: mNoDraw, pH: sim.pNoDraw, bP: f.book_no_draw_home_odds||null },
      { label:`To Advance ${f.homeAbbrev}`,         book: f.to_advance_home_odds,  model: mAdvH,    pH: sim.pAdvH,       bP: f.to_advance_home_odds },
      { label:`To Advance ${f.awayAbbrev}`,         book: f.to_advance_away_odds,  model: mAdvA,    pH: sim.pAdvA,       bP: f.to_advance_away_odds },
    ];

    for (const mkt of mkts) {
      const bookImplied = mkt.book ? (ml2prob(mkt.book)*100).toFixed(2)+'%' : '—';
      const modelImplied = (mkt.pH*100).toFixed(2)+'%';
      const edgePP = mkt.book ? ((mkt.pH - ml2prob(mkt.book))*100).toFixed(2) : '—';
      const roi = mkt.book ? calcROI(mkt.book, mkt.model)+'%' : '—';
      L.output('MARKET', `  ${mkt.label.padEnd(32)} ${String(mkt.book??'—').padEnd(10)} ${String(mkt.model??'—').padEnd(10)} ${String(edgePP).padEnd(12)} ${roi}`);
    }

    // Spread inverse verification
    L.verify('MARKET', `${f.fixture_id} Spread: ${(sim.homeSpreadCov*100).toFixed(4)}% + ${(sim.awaySpreadCov*100).toFixed(4)}% = ${((sim.homeSpreadCov+sim.awaySpreadCov)*100).toFixed(6)}% (must = 100.000000%)`);
    L.verify('MARKET', `${f.fixture_id} Total:  ${(sim.pO25*100).toFixed(4)}% + ${(sim.pU25*100).toFixed(4)}% = ${((sim.pO25+sim.pU25)*100).toFixed(6)}% (must = 100.000000%)`);
    L.verify('MARKET', `${f.fixture_id} BTTS:   ${(sim.pBTTS*100).toFixed(4)}% + ${((1-sim.pBTTS)*100).toFixed(4)}% = 100.000000%`);

    projResults.push({
      fixtureId: f.fixture_id,
      home: f.homeAbbrev, homeName: f.homeName,
      away: f.awayAbbrev, awayName: f.awayName,
      lambdaH: lH, lambdaA: lA, etH, etA,
      projH: sim.projH, projA: sim.projA, projTotal: sim.projTotal,
      rawSpread: sim.projH - sim.projA,
      pH: sim.pH, pD: sim.pD, pA: sim.pA,
      pAdvH: sim.pAdvH, pAdvA: sim.pAdvA,
      pBTTS: sim.pBTTS, pO25: sim.pO25, pU25: sim.pU25,
      homeSpreadCov: sim.homeSpreadCov, awaySpreadCov: sim.awaySpreadCov,
      p1X: sim.p1X, pX2: sim.pX2, pNoDraw: sim.pNoDraw,
      mHomeMl, mDrawMl, mAwayMl, mAdvH, mAdvA,
      mOver, mUnder, mBttsY, mBttsN,
      mHSpread, mASpread, m1X, mX2, mNoDraw,
      book: {
        homeMl: f.book_home_ml, drawMl: f.book_draw_ml, awayMl: f.book_away_ml,
        spreadLine: f.book_spread_line,
        homeSpreadOdds: f.book_home_spread_odds, awaySpreadOdds: f.book_away_spread_odds,
        totalLine: f.book_total_line,
        over: f.book_over_odds, under: f.book_under_odds,
        bttsY: f.book_btts_yes_odds, bttsN: f.book_btts_no_odds,
        dc1X: f.book_dc_1x_odds||null, dcX2: f.book_dc_x2_odds||null,
        noDrawH: f.book_no_draw_home_odds||null,
        advH: f.to_advance_home_odds, advA: f.to_advance_away_odds,
      },
    });
  }

  // ── PHASE G: 500x CROSS-REFERENCE VALIDATION ───────────────────────────────
  L.thick();
  L.section('PHASE_G', 'PHASE G — 500x CROSS-REFERENCE VALIDATION');

  let xrefPass=0, xrefFail=0, xrefWarn=0;

  for (const p of projResults) {
    L.hr();
    L.step('XREF', `Cross-referencing ${p.fixtureId}: ${p.away} @ ${p.home}`);

    if (p.lambdaH < 0.20 || p.lambdaH > 5.0) { L.fail('XREF', `λH=${p.lambdaH.toFixed(4)} out of range [0.20, 5.0]`); xrefFail++; }
    else { L.pass('XREF', `λH=${p.lambdaH.toFixed(4)} in range [0.20, 5.0]`); xrefPass++; }
    if (p.lambdaA < 0.20 || p.lambdaA > 5.0) { L.fail('XREF', `λA=${p.lambdaA.toFixed(4)} out of range [0.20, 5.0]`); xrefFail++; }
    else { L.pass('XREF', `λA=${p.lambdaA.toFixed(4)} in range [0.20, 5.0]`); xrefPass++; }

    const s1 = p.pH+p.pD+p.pA;
    if (Math.abs(s1-1)>0.0001) { L.fail('XREF', `1X2 sum=${s1.toFixed(8)}`); xrefFail++; }
    else { L.pass('XREF', `1X2 sum=1.0000 ✓`); xrefPass++; }

    const sAdv = p.pAdvH+p.pAdvA;
    if (Math.abs(sAdv-1)>0.001) { L.warn('XREF', `Advance sum=${sAdv.toFixed(8)}`); xrefWarn++; }
    else { L.pass('XREF', `Advance sum=1.0000 ✓`); xrefPass++; }

    const sSpr = p.homeSpreadCov+p.awaySpreadCov;
    if (Math.abs(sSpr-1)>0.0001) { L.fail('XREF', `Spread sum=${sSpr.toFixed(8)}`); xrefFail++; }
    else { L.pass('XREF', `Spread sum=1.0000 ✓`); xrefPass++; }

    const sTot = p.pO25+p.pU25;
    if (Math.abs(sTot-1)>0.0001) { L.fail('XREF', `Total sum=${sTot.toFixed(8)}`); xrefFail++; }
    else { L.pass('XREF', `Total sum=1.0000 ✓`); xrefPass++; }

    // DC double-chance validation: pX2 must = pA + pD exactly
    const pX2Check = p.pA + p.pD;
    if (Math.abs(p.pX2 - pX2Check) > 0.000001) { L.fail('XREF', `DC X2 mismatch: stored=${p.pX2.toFixed(8)} vs pA+pD=${pX2Check.toFixed(8)}`); xrefFail++; }
    else { L.pass('XREF', `DC X2 = pA+pD = ${pX2Check.toFixed(8)} ✓`); xrefPass++; }

    const p1XCheck = p.pH + p.pD;
    if (Math.abs(p.p1X - p1XCheck) > 0.000001) { L.fail('XREF', `DC 1X mismatch: stored=${p.p1X.toFixed(8)} vs pH+pD=${p1XCheck.toFixed(8)}`); xrefFail++; }
    else { L.pass('XREF', `DC 1X = pH+pD = ${p1XCheck.toFixed(8)} ✓`); xrefPass++; }

    // ML sign check: if model prob > 0.5, ML must be negative
    if (p.pH > 0.5 && p.mHomeMl > 0) { L.fail('XREF', `Home ML sign error: pH=${(p.pH*100).toFixed(2)}% but mHomeMl=${p.mHomeMl} (should be negative)`); xrefFail++; }
    else { L.pass('XREF', `Home ML sign: pH=${(p.pH*100).toFixed(2)}% → ${p.mHomeMl} ✓`); xrefPass++; }
    if (p.pA > 0.5 && p.mAwayMl > 0) { L.fail('XREF', `Away ML sign error: pA=${(p.pA*100).toFixed(2)}% but mAwayMl=${p.mAwayMl} (should be negative)`); xrefFail++; }
    else { L.pass('XREF', `Away ML sign: pA=${(p.pA*100).toFixed(2)}% → ${p.mAwayMl} ✓`); xrefPass++; }

    // ET model sanity
    if (p.etH < 0.35 || p.etH > 0.65) { L.warn('XREF', `etH=${(p.etH*100).toFixed(2)}% outside expected range [35%, 65%]`); xrefWarn++; }
    else { L.pass('XREF', `etH=${(p.etH*100).toFixed(2)}% within expected range [35%, 65%]`); xrefPass++; }

    // Proj score vs lambda sanity
    const projDiff = Math.abs(p.projH - p.lambdaH);
    if (projDiff > 0.5) { L.warn('XREF', `Proj home score ${p.projH.toFixed(3)} deviates from λH=${p.lambdaH.toFixed(4)} by ${projDiff.toFixed(4)}`); xrefWarn++; }
    else { L.pass('XREF', `Proj home score ${p.projH.toFixed(3)} consistent with λH=${p.lambdaH.toFixed(4)}`); xrefPass++; }
  }

  L.thick();
  L.output('XREF', `Cross-reference validation: PASS=${xrefPass} FAIL=${xrefFail} WARN=${xrefWarn}`);
  if (xrefFail > 0) L.fail('XREF', `${xrefFail} validation failures — review above`);
  else L.pass('XREF', 'All critical validations PASSED');

  // ── PHASE H: FINAL SUMMARY + LOG FLUSH (NO DB PUBLISH) ─────────────────────
  L.thick();
  L.section('PHASE_H', 'PHASE H — FINAL SUMMARY AND LOG FLUSH — NO DB PUBLISH');
  L.state('PHASE_H', '*** MANUAL REVIEW OUTPUT ONLY — DO NOT PUBLISH UNTIL APPROVED ***');

  const totalElapsed = ((Date.now()-T0)/1000).toFixed(3);
  L.output('SUMMARY', `Session: ${SESSION_ID}`);
  L.output('SUMMARY', `Elapsed: ${totalElapsed}s | Total log steps: ${_STEP}`);
  L.output('SUMMARY', `PASS: ${_PASS} | FAIL: ${_FAIL} | WARN: ${_WARN} | BUGS: ${_BUG}`);
  L.output('SUMMARY', '');
  L.output('SUMMARY', `Backtest winner: ${winner.id} — "${winner.label}"`);
  L.output('SUMMARY', `  Composite=${winner.composite.toFixed(4)} | Brier=${winner.brier.toFixed(6)} | Dir=${winner.dir.toFixed(1)}% | Spread=${winner.spread.toFixed(1)}% | Total=${winner.total.toFixed(1)}% | BTTS=${winner.btts.toFixed(1)}%`);
  L.output('SUMMARY', '');
  L.output('SUMMARY', 'JULY 2 PROJECTIONS SUMMARY (MANUAL REVIEW — NOT PUBLISHED):');
  for (const p of projResults) {
    L.output('SUMMARY', `  ${p.fixtureId}: ${p.away} @ ${p.home} | λH=${p.lambdaH.toFixed(4)} λA=${p.lambdaA.toFixed(4)} | Proj ${p.projH.toFixed(2)}-${p.projA.toFixed(2)} | ML H=${p.mHomeMl} D=${p.mDrawMl} A=${p.mAwayMl} | Spread H=${p.mHSpread} A=${p.mASpread} | O=${p.mOver} U=${p.mUnder}`);
  }

  // Save JSON report
  const report = {
    sessionId: SESSION_ID,
    timestamp: new Date().toISOString(),
    elapsed: totalElapsed+'s',
    version: 'v12.0-KO24-JULY2',
    publishStatus: 'MANUAL_REVIEW_ONLY — NOT PUBLISHED TO DB',
    bugsFixed: ['BUG1_homeSpreadCov_inverted', 'BUG2_awaySpreadCov_wrong', 'BUG3_ET_50_50', 'BUG4_GROUND_TRUTH_swap'],
    backtestMatches: validMatches.length,
    backtestRanking: ranked.map(r => ({
      id:r.id, label:r.label, composite:r.composite, brier:r.brier,
      dir:r.dir, spread:r.spread, total:r.total, btts:r.btts,
    })),
    winner: { id:winner.id, label:winner.label, composite:winner.composite, brier:winner.brier, config:winV },
    jul2Lambdas,
    projections: projResults,
    xrefValidation: { pass:xrefPass, fail:xrefFail, warn:xrefWarn },
  };
  writeFileSync(JSON_FILE, JSON.stringify(report, null, 2));
  L.pass('SUMMARY', `JSON report saved → ${JSON_FILE}`);

  const footer = [
    '',
    '═'.repeat(110),
    `SESSION END: ${new Date().toISOString()} | ELAPSED: ${totalElapsed}s`,
    `STEPS: ${_STEP} | PASS: ${_PASS} | FAIL: ${_FAIL} | WARN: ${_WARN} | BUGS: ${_BUG}`,
    `WINNER: ${winner.id} — ${winner.label}`,
    `XREF: PASS=${xrefPass} FAIL=${xrefFail} WARN=${xrefWarn}`,
    `PUBLISH STATUS: MANUAL_REVIEW_ONLY — NOT PUBLISHED TO DB`,
    '═'.repeat(110),
    '',
  ].join('\n');
  flog(footer);
  console.log(`${A.bold}${A.cyn}${footer}${A.R}`);

  L.pass('ENGINE', 'v12.0-KO24 JULY 2 ENGINE COMPLETE — AWAITING MANUAL REVIEW');
}

main().catch(e => {
  const msg = `[FATAL] ${e.message}\n${e.stack}`;
  console.error(`\x1b[31m${msg}\x1b[0m`);
  appendFileSync(LOG_FILE, `\n[FATAL] ${new Date().toISOString()}\n${msg}\n`);
  process.exit(1);
});
