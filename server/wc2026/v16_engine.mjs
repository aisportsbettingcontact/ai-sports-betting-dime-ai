/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║   WC2026 KNOCKOUT STAGE MODEL — v16.0-KO25-RECALIBRATED-10MATCH            ║
 * ║   500x Forensic Engine · Industry-Leading Debug Framework                  ║
 * ║   10-Match Full Backtest → Recalibration → July 2 Projections              ║
 * ║                                                                              ║
 * ║   MATCHES MODELED:                                                           ║
 * ║     wc26-r32-083: ESP vs AUT (ESPN 760497)                                  ║
 * ║     wc26-r32-084: POR vs CRO (ESPN 760496)                                  ║
 * ║     wc26-r32-085: SUI vs ALG (ESPN 760498)                                  ║
 * ║                                                                              ║
 * ║   BACKTEST: All 10 completed KO R32 matches (073–082)                       ║
 * ║                                                                              ║
 * ║   CHANGES FROM v15.0:                                                        ║
 * ║     • 10-match backtest (was 7)                                              ║
 * ║     • 15 new variation candidates (25 total, best selected)                 ║
 * ║     • Recalibrated composite scorer: dir=45, total=30, spread=15, btts=10   ║
 * ║     • xGOT up-weighted in new variations (v15 10-match shows total=80%)     ║
 * ║     • rho range expanded: 0.040–0.090                                        ║
 * ║     • pace range expanded: 0.020–0.050                                       ║
 * ║                                                                              ║
 * ║   DB TABLES READ:                                                            ║
 * ║     wc2026_espn_expected_goals: homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
 * ║     wc2026_espn_team_stats:     possession, possessionAway                  ║
 * ║     wc2026_espn_match_stats:    homeShots, awayShots, homeShotsOnGoal, awayShotsOnGoal
 * ║     wc2026_espn_player_stats:   g, a, xG, xA, sog, shot, tch, duelw        ║
 * ║     wc2026_espn_shot_map:       xg, xgot, isGoal, distanceYards            ║
 * ║     wc2026_matches:            home_score, away_score, status              ║
 * ║     wc2026_frozen_book_odds:    all markets for backtest matchs            ║
 * ║                                                                              ║
 * ║   DB TABLES WRITTEN:                                                         ║
 * ║     wc2026_model_projections: all 3 July 2 matchs                         ║
 * ║     wc2026MatchOdds: model_* + lambda + proj_goals columns                  ║
 * ║                                                                              ║
 * ║   LOG: /home/ubuntu/wc2026modeling.txt (APPEND-ONLY — nothing omitted)      ║
 * ║   REPORT: /home/ubuntu/wc2026_v16_report.json                               ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const LOG_FILE   = '/home/ubuntu/wc2026modeling.txt';
const REPORT_PATH = '/home/ubuntu/wc2026_v16_report.json';
const SESSION_ID = `v16-recalibrated-10match-${Date.now()}`;
const START_TS   = Date.now();
const ENGINE_VERSION = 'v16.0-KO25-RECALIBRATED-10MATCH';

// 10 completed KO R32 matches with verified actual results
const BACKTEST_MATCHS = [
  { fid:'wc26-r32-073', espnId:'760486', home:'RSA', away:'CAN', homeScore:0, awayScore:1, round:'round-of-32' },
  { fid:'wc26-r32-074', espnId:'760487', home:'BRA', away:'JPN', homeScore:2, awayScore:1, round:'round-of-32' },
  { fid:'wc26-r32-075', espnId:'760489', home:'GER', away:'PAR', homeScore:1, awayScore:1, round:'round-of-32', pens:true, penWinner:'GER' },
  { fid:'wc26-r32-076', espnId:'760488', home:'NED', away:'MAR', homeScore:1, awayScore:1, round:'round-of-32', pens:true, penWinner:'NED' },
  { fid:'wc26-r32-077', espnId:'760490', home:'CIV', away:'NOR', homeScore:1, awayScore:2, round:'round-of-32' },
  { fid:'wc26-r32-078', espnId:'760492', home:'FRA', away:'SWE', homeScore:3, awayScore:0, round:'round-of-32' },
  { fid:'wc26-r32-079', espnId:'760491', home:'MEX', away:'ECU', homeScore:2, awayScore:0, round:'round-of-32' },
  { fid:'wc26-r32-080', espnId:'760495', home:'ENG', away:'COD', homeScore:2, awayScore:1, round:'round-of-32' },
  { fid:'wc26-r32-081', espnId:'760493', home:'BEL', away:'SEN', homeScore:3, awayScore:2, round:'round-of-32' },
  { fid:'wc26-r32-082', espnId:'760494', home:'USA', away:'BIH', homeScore:2, awayScore:0, round:'round-of-32' },
];

// July 2 matchs to project
const PROJECTION_MATCHS = [
  { fid:'wc26-r32-083', espnId:'760497', home:'ESP', away:'AUT', round:'round-of-32' },
  { fid:'wc26-r32-084', espnId:'760496', home:'POR', away:'CRO', round:'round-of-32' },
  { fid:'wc26-r32-085', espnId:'760498', home:'SUI', away:'ALG', round:'round-of-32' },
];

// ══════════════════════════════════════════════════════════════════════════════
// INDUSTRY-LEADING DEBUG FRAMEWORK — 500x EDITION
// ══════════════════════════════════════════════════════════════════════════════
let STEP = 0, PASS = 0, FAIL = 0, WARN = 0, HARD_FAIL_COUNT = 0;
let XREF_PASS = 0, XREF_FAIL = 0;

const C = {
  RESET:'\x1b[0m', BOLD:'\x1b[1m', DIM:'\x1b[2m',
  RED:'\x1b[31m', GREEN:'\x1b[32m', YELLOW:'\x1b[33m',
  BLUE:'\x1b[34m', MAGENTA:'\x1b[35m', CYAN:'\x1b[36m', WHITE:'\x1b[37m',
  BRIGHT_GREEN:'\x1b[92m', BRIGHT_YELLOW:'\x1b[93m', BRIGHT_CYAN:'\x1b[96m',
  BRIGHT_WHITE:'\x1b[97m', BG_RED:'\x1b[41m', BG_GREEN:'\x1b[42m',
  BG_BLUE:'\x1b[44m', BG_MAGENTA:'\x1b[45m', BG_CYAN:'\x1b[46m',
};

const LEVEL_META = {
  SECTION:   { color: C.BG_BLUE+C.BOLD+C.WHITE,    icon: '██████' },
  PHASE:     { color: C.BG_MAGENTA+C.BOLD+C.WHITE,  icon: '▓▓▓▓▓▓' },
  PASS:      { color: C.BRIGHT_GREEN+C.BOLD,         icon: '✅ PASS' },
  FAIL:      { color: C.RED+C.BOLD,                  icon: '❌ FAIL' },
  WARN:      { color: C.BRIGHT_YELLOW,               icon: '⚠️  WARN' },
  GATE:      { color: C.CYAN+C.BOLD,                 icon: '🚦 GATE' },
  INPUT:     { color: C.BLUE,                        icon: '⬇  DATA' },
  REAL_DATA: { color: C.BRIGHT_GREEN,                icon: '💚 REAL' },
  STATE:     { color: C.WHITE,                       icon: '◈  STAT' },
  STEP:      { color: C.DIM+C.WHITE,                 icon: '▶  STEP' },
  OUTPUT:    { color: C.BRIGHT_CYAN+C.BOLD,          icon: '→→ OUT ' },
  BACKTEST:  { color: C.MAGENTA,                     icon: '📊 TEST' },
  WINNER:    { color: C.BG_GREEN+C.BOLD+C.WHITE,     icon: '🏆 WIN ' },
  MARKET:    { color: C.YELLOW,                      icon: '💰 MKT ' },
  XREF:      { color: C.CYAN,                        icon: '🔗 XREF' },
  LAMBDA:    { color: C.BRIGHT_WHITE+C.BOLD,         icon: '⚡ LAMB' },
  CRITICAL:  { color: C.BG_RED+C.BOLD+C.WHITE,       icon: '🔴 CRIT' },
  RECAL:     { color: C.BG_CYAN+C.BOLD+C.WHITE,      icon: '🔄 RCAL' },
  DB_WRITE:  { color: C.BRIGHT_GREEN+C.BOLD,         icon: '💾 DB  ' },
  AUDIT:     { color: C.MAGENTA+C.BOLD,              icon: '🔍 AUDT' },
};

function ts() {
  const e = ((Date.now() - START_TS) / 1000).toFixed(3);
  return `[${new Date().toISOString()}] +${e}s`;
}
function pad(s, n) { return String(s ?? '').padEnd(n).slice(0, n); }
function fmt(v, d=4) { return typeof v === 'number' ? v.toFixed(d) : String(v ?? 'NULL'); }
function pct(v) { return (v * 100).toFixed(1) + '%'; }
function ml(v) { return v > 0 ? `+${v}` : `${v}`; }

function log(level, domain, msg) {
  STEP++;
  const meta = LEVEL_META[level] || { color: C.WHITE, icon: '   LOG' };
  const stepStr = `S${String(STEP).padStart(5,'0')}`;
  const domStr  = pad(domain, 18);
  const lvlStr  = pad(meta.icon, 7);
  const termLine = `${C.DIM}${ts()}${C.RESET} ${C.BOLD}${stepStr}${C.RESET} ${meta.color}[${lvlStr}]${C.RESET} ${C.CYAN}[${domStr}]${C.RESET} ${msg}`;
  const logLine  = `${ts()} ${stepStr} [${lvlStr}] [${domStr}] ${msg}`;
  console.log(termLine);
  fs.appendFileSync(LOG_FILE, logLine + '\n');
  if (level === 'PASS')  PASS++;
  if (level === 'FAIL') { FAIL++; HARD_FAIL_COUNT++; }
  if (level === 'WARN')  WARN++;
}

function banner(msg, color = C.BG_BLUE+C.BOLD+C.WHITE) {
  const bar = '═'.repeat(120);
  [bar, `  ${msg}`, bar].forEach(l => {
    console.log(`${color}${l}${C.RESET}`);
    fs.appendFileSync(LOG_FILE, l + '\n');
  });
}

function subBanner(msg) {
  const bar = '─'.repeat(100);
  [`${bar}`, `  ▶ ${msg}`, `${bar}`].forEach(l => {
    console.log(`${C.CYAN}${l}${C.RESET}`);
    fs.appendFileSync(LOG_FILE, l + '\n');
  });
}

function progressBar(current, total, label='') {
  const pct_ = total > 0 ? current / total : 0;
  const filled = Math.round(pct_ * 50);
  const bar = '█'.repeat(filled) + '░'.repeat(50 - filled);
  const line = `  [${bar}] ${(pct_*100).toFixed(1)}% ${current}/${total} ${label}`;
  console.log(`${C.BRIGHT_GREEN}${line}${C.RESET}`);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function hardFail(domain, msg) {
  log('FAIL', domain, `HARD_FAIL: ${msg}`);
  throw new Error(`HARD_FAIL [${domain}]: ${msg}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MATH HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function dcAdjust(x, y, lambda, mu, rho) {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function prob2ml(p) {
  if (p <= 0 || p >= 1) return p <= 0 ? 99999 : -99999;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function ml2prob(ml_) {
  if (ml_ < 0) return (-ml_) / (-ml_ + 100);
  return 100 / (ml_ + 100);
}

function assertML(domain, market, ml_) {
  if (ml_ === null || ml_ === undefined) {
    log('WARN', domain, `${market}: model ML is null`);
    return;
  }
  if (Math.abs(ml_) < 100 && ml_ !== 0) {
    hardFail(domain, `${market}: model ML=${ml_} is in invalid range (-100, 100)`);
  }
  if (Math.abs(ml_) >= 9999) {
    log('WARN', domain, `${market}: model ML=${ml_} is extreme — flag for review`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DIXON-COLES SIMULATION
// ══════════════════════════════════════════════════════════════════════════════
function runDCSim(lambdaH, lambdaA, rho, spreadLine) {
  const MAX_G = 12;
  let pH=0, pD=0, pA=0, pOver=0, pUnder=0, pBTTS=0, pHomeSpread=0, pAwaySpread=0;
  for (let h=0; h<=MAX_G; h++) {
    for (let a=0; a<=MAX_G; a++) {
      const p = poissonPMF(h, lambdaH) * poissonPMF(a, lambdaA) * dcAdjust(h, a, lambdaH, lambdaA, rho);
      if (p <= 0) continue;
      if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
      if (h + a > 2.5) pOver += p; else pUnder += p;
      if (h > 0 && a > 0) pBTTS += p;
      if (h - a > spreadLine) pHomeSpread += p; else pAwaySpread += p;
    }
  }
  const tot = pH + pD + pA;
  if (tot < 0.99 || tot > 1.01) log('WARN', 'DC_SIM', `DC sim total=${tot.toFixed(6)} — renormalizing`);
  pH/=tot; pD/=tot; pA/=tot;
  pOver/=tot; pUnder/=tot; pBTTS/=tot; pHomeSpread/=tot; pAwaySpread/=tot;
  return { pH, pD, pA, pOver, pUnder, pBTTS, pHomeSpread, pAwaySpread };
}

// ══════════════════════════════════════════════════════════════════════════════
// ET/PENS MODEL (regression alpha=0.70)
// ══════════════════════════════════════════════════════════════════════════════
function etPensProbs(pH, pA, regressionAlpha=0.70) {
  const rawStrengthH = pH / (pH + pA);
  const pETH = regressionAlpha * 0.5 + (1 - regressionAlpha) * rawStrengthH;
  const pETA = 1 - pETH;
  return { pETH, pETA };
}

// ══════════════════════════════════════════════════════════════════════════════
// VARIATIONS — 25 TOTAL (V1-V10 from v15, V11-V25 new recalibrated)
// C8: core 6 weights (xGW+xGOTW+smW+psW+xAW+spW) must sum to 1.0 ±0.001
// ══════════════════════════════════════════════════════════════════════════════
const VARIATIONS = [
  // ── v15.0 original 10 variations ──────────────────────────────────────────
  { id:'V1',  xGW:0.35, xGOTW:0.20, smW:0.15, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.060, pace:0.030 },
  { id:'V2',  xGW:0.45, xGOTW:0.15, smW:0.12, psW:0.15, xAW:0.08, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.035 },
  { id:'V3',  xGW:0.40, xGOTW:0.18, smW:0.12, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.055, pace:0.025 },
  { id:'V4',  xGW:0.30, xGOTW:0.25, smW:0.15, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.070, pace:0.040 },
  { id:'V5',  xGW:0.33, xGOTW:0.17, smW:0.13, psW:0.22, xAW:0.09, spW:0.06, possW:0.04, convW:0.06, rho:0.065, pace:0.035 },
  { id:'V6',  xGW:0.25, xGOTW:0.20, smW:0.20, psW:0.15, xAW:0.10, spW:0.10, possW:0.03, convW:0.05, rho:0.060, pace:0.030 },
  { id:'V7',  xGW:0.50, xGOTW:0.10, smW:0.10, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.055, pace:0.025 },
  { id:'V8',  xGW:0.35, xGOTW:0.20, smW:0.10, psW:0.20, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.070, pace:0.040 },
  { id:'V9',  xGW:0.40, xGOTW:0.15, smW:0.15, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.035 },
  { id:'V10', xGW:0.30, xGOTW:0.20, smW:0.15, psW:0.15, xAW:0.10, spW:0.10, possW:0.03, convW:0.05, rho:0.060, pace:0.030 },
  // ── v16.0 new recalibrated variations (xGOT up-weighted, rho expanded) ───
  { id:'V11', xGW:0.28, xGOTW:0.30, smW:0.14, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.055, pace:0.025 },
  { id:'V12', xGW:0.32, xGOTW:0.28, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.060, pace:0.030 },
  { id:'V13', xGW:0.25, xGOTW:0.32, smW:0.13, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.035 },
  { id:'V14', xGW:0.30, xGOTW:0.25, smW:0.15, psW:0.12, xAW:0.12, spW:0.06, possW:0.04, convW:0.06, rho:0.070, pace:0.040 },
  { id:'V15', xGW:0.35, xGOTW:0.25, smW:0.10, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.060, pace:0.030 },
  { id:'V16', xGW:0.28, xGOTW:0.27, smW:0.15, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.075, pace:0.045 },
  { id:'V17', xGW:0.30, xGOTW:0.22, smW:0.18, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.050, pace:0.022 },
  { id:'V18', xGW:0.38, xGOTW:0.22, smW:0.12, psW:0.15, xAW:0.08, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.035 },
  { id:'V19', xGW:0.33, xGOTW:0.24, smW:0.13, psW:0.16, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.058, pace:0.028 },
  { id:'V20', xGW:0.27, xGOTW:0.28, smW:0.15, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.062, pace:0.032 },
  { id:'V21', xGW:0.30, xGOTW:0.30, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.068, pace:0.038 },
  { id:'V22', xGW:0.35, xGOTW:0.23, smW:0.14, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.055, pace:0.025 },
  { id:'V23', xGW:0.29, xGOTW:0.26, smW:0.15, psW:0.16, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.072, pace:0.042 },
  { id:'V24', xGW:0.32, xGOTW:0.25, smW:0.13, psW:0.17, xAW:0.08, spW:0.05, possW:0.03, convW:0.05, rho:0.063, pace:0.033 },
  { id:'V25', xGW:0.26, xGOTW:0.29, smW:0.15, psW:0.15, xAW:0.10, spW:0.05, possW:0.04, convW:0.06, rho:0.067, pace:0.037 },
];

// C8: Validate all weight sums
function validateWeights() {
  subBanner('C8 — VALIDATING CORE 6 WEIGHT SUMS FOR ALL 25 VARIATIONS');
  for (const v of VARIATIONS) {
    const sum = v.xGW + v.xGOTW + v.smW + v.psW + v.xAW + v.spW;
    if (Math.abs(sum - 1.0) > 0.001) {
      hardFail('C8_WEIGHTS', `${v.id} core 6 weights sum=${sum.toFixed(6)} ≠ 1.0`);
    }
    log('PASS', 'C8_GATE', `${v.id} | xGW=${v.xGW} xGOTW=${v.xGOTW} smW=${v.smW} psW=${v.psW} xAW=${v.xAW} spW=${v.spW} | SUM=${sum.toFixed(6)} ✓`);
  }
  log('PASS', 'C8_GATE', `ALL 25 VARIATIONS: weight sums validated ✓`);
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD GROUP STAGE ROWS — ZERO SOFT GATES
// ══════════════════════════════════════════════════════════════════════════════
function buildGSRows(teamCode, xgAll, tsAll, msAll) {
  const rows = xgAll.filter(r =>
    r.matchRound === 'group-stage' &&
    (r.homeTeamAbbrev === teamCode || r.awayTeamAbbrev === teamCode) &&
    r.homeXG !== null && r.awayXG !== null
  );
  log('STEP', 'BUILD_GS', `${teamCode}: found ${rows.length} GS rows with non-null xG`);
  if (rows.length === 0) {
    hardFail('BUILD_GS', `${teamCode}: ZERO group stage xG rows — cannot compute lambda`);
  }
  return rows.map(r => {
    const side = r.homeTeamAbbrev === teamCode ? 'home' : 'away';
    const tsRow = tsAll.find(t => t.espn_match_id === r.espn_match_id);
    if (!tsRow) hardFail('N1_POSS', `${teamCode} match ${r.espn_match_id}: NO team stats row`);
    const possRawHome = tsRow.possession;
    const possRawAway = tsRow.possessionAway;
    const possHome = parseFloat(String(possRawHome ?? '').replace('%', ''));
    const possAway = parseFloat(String(possRawAway ?? '').replace('%', ''));
    if (isNaN(possHome)) hardFail('N1_POSS_NAN', `${teamCode} match ${r.espn_match_id}: possHome='${possRawHome}' → NaN`);
    if (isNaN(possAway)) hardFail('N1_POSS_NAN', `${teamCode} match ${r.espn_match_id}: possAway='${possRawAway}' → NaN`);
    const poss = side === 'home' ? possHome : possAway;
    log('REAL_DATA', 'POSS_PARSE', `  ${teamCode} ${r.espn_match_id} [${side}]: raw='${side==='home'?possRawHome:possRawAway}' → ${poss.toFixed(1)}%`);
    const msRow = msAll.find(m => m.espn_match_id === r.espn_match_id);
    if (!msRow) hardFail('N2_SHOTS', `${teamCode} match ${r.espn_match_id}: NO match stats row`);
    const sot   = side === 'home' ? msRow.homeShotsOnGoal : msRow.awayShotsOnGoal;
    const shots = side === 'home' ? msRow.homeShots       : msRow.awayShots;
    if (sot   === null || sot   === undefined) hardFail('N2_SOT_NULL',   `${teamCode} match ${r.espn_match_id}: SOT is NULL`);
    if (shots === null || shots === undefined) hardFail('N2_SHOTS_NULL', `${teamCode} match ${r.espn_match_id}: shots is NULL`);
    log('REAL_DATA', 'SHOTS_PARSE', `  ${teamCode} ${r.espn_match_id} [${side}]: SOT=${sot} shots=${shots}`);
    return {
      espn_match_id: r.espn_match_id, side,
      xG:    side === 'home' ? parseFloat(r.homeXG)   : parseFloat(r.awayXG),
      xGOT:  side === 'home' ? parseFloat(r.homeXGOT) : parseFloat(r.awayXGOT),
      xA:    side === 'home' ? parseFloat(r.homeXA)   : parseFloat(r.awayXA),
      poss, sot, shots,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPUTE LAMBDA FROM GS ROWS
// ══════════════════════════════════════════════════════════════════════════════
function computeLambda(teamCode, gsRows, psAll, smAll, v) {
  if (gsRows.length === 0) hardFail('LAMBDA', `${teamCode}: no GS rows`);
  // xG component
  const avgXG   = gsRows.reduce((s,r) => s + r.xG, 0)   / gsRows.length;
  const avgXGOT = gsRows.reduce((s,r) => s + r.xGOT, 0) / gsRows.length;
  const avgXA   = gsRows.reduce((s,r) => s + r.xA, 0)   / gsRows.length;
  const avgPoss = gsRows.reduce((s,r) => s + r.poss, 0)  / gsRows.length;
  const avgSOT  = gsRows.reduce((s,r) => s + r.sot, 0)   / gsRows.length;
  const avgShots= gsRows.reduce((s,r) => s + r.shots, 0) / gsRows.length;
  // Shot map component
  const smRows = smAll.filter(r => gsRows.some(g => g.espn_match_id === r.espn_match_id) && r.teamAbbrev === teamCode);
  const avgSmXG   = smRows.length > 0 ? smRows.reduce((s,r) => s + (parseFloat(r.shotXG)   || 0), 0) / smRows.length : avgXG;
  const avgSmXGOT = smRows.length > 0 ? smRows.reduce((s,r) => s + (parseFloat(r.shotXGOT) || 0), 0) / smRows.length : avgXGOT;
  // Player stats component
  const psRows = psAll.filter(r => gsRows.some(g => g.espn_match_id === r.espn_match_id) && r.teamAbbrev === teamCode);
  const avgPsXG   = psRows.length > 0 ? psRows.reduce((s,r) => s + (parseFloat(r.pXG)   || 0), 0) / psRows.length : avgXG;
  const avgPsXGOT = psRows.length > 0 ? psRows.reduce((s,r) => s + (parseFloat(r.pXGOT) || 0), 0) / psRows.length : avgXGOT;
  // Conversion rate
  const convRate = avgShots > 0 ? avgSOT / avgShots : 0.35;
  // Possession adjustment
  const possAdj = 1 + v.possW * ((avgPoss - 50) / 50);
  // Weighted lambda
  const lambdaRaw =
    v.xGW   * avgXG   +
    v.xGOTW * avgXGOT +
    v.smW   * avgSmXG +
    v.psW   * avgPsXG +
    v.xAW   * avgXA   +
    v.spW   * avgSmXGOT;
  const lambda = lambdaRaw * possAdj * (1 + v.convW * (convRate - 0.35)) * (1 - v.pace);
  log('LAMBDA', 'LAMBDA_CALC', `  ${teamCode} [${v.id}]: avgXG=${fmt(avgXG)} avgXGOT=${fmt(avgXGOT)} avgXA=${fmt(avgXA)} poss=${fmt(avgPoss,1)}% convRate=${fmt(convRate,3)} → λ=${fmt(lambda)}`);
  return { lambda, avgXG, avgXGOT, avgXA, avgPoss, avgSOT, avgShots, convRate };
}

// ══════════════════════════════════════════════════════════════════════════════
// DERIVE ALL MARKETS FROM SIMULATION
// ══════════════════════════════════════════════════════════════════════════════
function deriveMarkets(fid, home, away, lambdaH, lambdaA, v) {
  const sim = runDCSim(lambdaH, lambdaA, v.rho, 1.5);
  const { pH, pD, pA, pOver, pUnder, pBTTS, pHomeSpread, pAwaySpread } = sim;
  const { pETH, pETA } = etPensProbs(pH, pA);
  const pAdvH = pD > 0 ? pH + pD * pETH : pH;
  const pAdvA = pD > 0 ? pA + pD * pETA : pA;
  const advSum = pAdvH + pAdvA;
  const pAdvHn = pAdvH / advSum;
  const pAdvAn = pAdvA / advSum;
  // Double chance
  const pHD = pH + pD;
  const pAD = pA + pD;
  // No draw
  const pND = pH + pA;
  const pNDH = pH / pND;
  const pNDA = pA / pND;
  // Projected goals
  const projH = lambdaH;
  const projA = lambdaA;
  const projTotal = projH + projA;
  // ML
  const mlHome = prob2ml(pH);
  const mlDraw = prob2ml(pD);
  const mlAway = prob2ml(pA);
  // Spread
  const spreadLine = -1.5;
  const mlHomeSpread = prob2ml(pHomeSpread);
  const mlAwaySpread = prob2ml(pAwaySpread);
  // Total
  const mlOver  = prob2ml(pOver);
  const mlUnder = prob2ml(pUnder);
  // BTTS
  const mlBTTSY = prob2ml(pBTTS);
  const mlBTTSN = prob2ml(1 - pBTTS);
  // Double chance
  const mlHD = prob2ml(pHD);
  const mlAD = prob2ml(pAD);
  // To advance
  const mlAdvH = prob2ml(pAdvHn);
  const mlAdvA = prob2ml(pAdvAn);
  // No draw
  const mlNDH = prob2ml(pNDH);
  const mlNDA = prob2ml(pNDA);
  // Assert all ML values
  [['ML_HOME', mlHome], ['ML_DRAW', mlDraw], ['ML_AWAY', mlAway],
   ['SPREAD_H', mlHomeSpread], ['SPREAD_A', mlAwaySpread],
   ['OVER', mlOver], ['UNDER', mlUnder],
   ['BTTS_Y', mlBTTSY], ['BTTS_N', mlBTTSN],
   ['ADV_H', mlAdvH], ['ADV_A', mlAdvA],
   ['DC_HD', mlHD], ['DC_AD', mlAD],
   ['ND_H', mlNDH], ['ND_A', mlNDA],
  ].forEach(([mkt, val]) => assertML(fid, mkt, val));
  return {
    pH, pD, pA, pOver, pUnder, pBTTS, pHomeSpread, pAwaySpread,
    pAdvHn, pAdvAn, pHD, pAD, pNDH, pNDA,
    projH, projA, projTotal,
    mlHome, mlDraw, mlAway,
    mlHomeSpread, mlAwaySpread, spreadLine,
    mlOver, mlUnder,
    mlBTTSY, mlBTTSN,
    mlHD, mlAD,
    mlAdvH, mlAdvA,
    mlNDH, mlNDA,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKTEST GRADER — 10-MATCH EDITION
// Composite = 45*dirPct + 30*totalPct + 15*spreadPct + 10*bttsPct - 50*brier
// ══════════════════════════════════════════════════════════════════════════════
function gradeVariation(v, btResults) {
  let dirCorrect=0, spreadCorrect=0, totalCorrect=0, bttsCorrect=0;
  let brierSum=0;
  const perMatch = [];
  for (const bt of btResults) {
    const { match, lambdaH, lambdaA, markets } = bt;
    const { homeScore, awayScore, pens, penWinner } = match;
    // Direction: who won (or draw in regulation)
    const actualDir = homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D';
    const modelDir  = markets.pH > markets.pD && markets.pH > markets.pA ? 'H' :
                      markets.pA > markets.pD && markets.pA > markets.pH ? 'A' : 'D';
    const dirOk = actualDir === modelDir;
    // Spread: home -1.5 covers?
    const spreadCovers = homeScore - awayScore > 1.5;
    const modelFavorsSpread = markets.pHomeSpread > 0.5;
    const spreadOk = spreadCovers === modelFavorsSpread;
    // Total: over 2.5?
    const actualTotal = homeScore + awayScore;
    const totalOver = actualTotal > 2.5;
    const modelOver = markets.pOver > 0.5;
    const totalOk = totalOver === modelOver;
    // BTTS
    const actualBTTS = homeScore > 0 && awayScore > 0;
    const modelBTTS  = markets.pBTTS > 0.5;
    const bttsOk = actualBTTS === modelBTTS;
    // Brier score on direction
    const actualPH = actualDir === 'H' ? 1 : 0;
    const actualPD = actualDir === 'D' ? 1 : 0;
    const actualPA = actualDir === 'A' ? 1 : 0;
    const brier = (Math.pow(markets.pH - actualPH, 2) + Math.pow(markets.pD - actualPD, 2) + Math.pow(markets.pA - actualPA, 2)) / 3;
    if (dirOk)    dirCorrect++;
    if (spreadOk) spreadCorrect++;
    if (totalOk)  totalCorrect++;
    if (bttsOk)   bttsCorrect++;
    brierSum += brier;
    perMatch.push({
      fid: match.fid, home: match.home, away: match.away,
      score: `${homeScore}-${awayScore}`,
      actualDir, modelDir, dirOk,
      actualTotal, totalOver, modelOver, totalOk,
      spreadCovers, modelFavorsSpread, spreadOk,
      actualBTTS, modelBTTS, bttsOk,
      brier: brier.toFixed(4),
      lambdaH: lambdaH.toFixed(4), lambdaA: lambdaA.toFixed(4),
    });
  }
  const n = btResults.length;
  const dirPct    = dirCorrect    / n;
  const spreadPct = spreadCorrect / n;
  const totalPct  = totalCorrect  / n;
  const bttsPct   = bttsCorrect   / n;
  const avgBrier  = brierSum / n;
  // v16 recalibrated composite: dir=45, total=30, spread=15, btts=10
  const composite = 45*dirPct + 30*totalPct + 15*spreadPct + 10*bttsPct - 50*avgBrier;
  return { dirPct, spreadPct, totalPct, bttsPct, avgBrier, composite, perMatch,
           dirCorrect, spreadCorrect, totalCorrect, bttsCorrect, n };
}

// ══════════════════════════════════════════════════════════════════════════════
// XREF VALIDATION
// ══════════════════════════════════════════════════════════════════════════════
function xrefValidate(fid, markets) {
  const checks = [];
  // Prob sum
  const probSum = markets.pH + markets.pD + markets.pA;
  const probOk = Math.abs(probSum - 1.0) < 0.0001;
  checks.push({ name:'PROB_SUM', ok:probOk, val:probSum.toFixed(6), expected:'1.000000' });
  // Advance prob sum
  const advSum = markets.pAdvHn + markets.pAdvAn;
  const advOk = Math.abs(advSum - 1.0) < 0.0001;
  checks.push({ name:'ADV_SUM', ok:advOk, val:advSum.toFixed(6), expected:'1.000000' });
  // DC consistency: pHD + pAD > 1 (overlap at draw)
  const dcOk = markets.pHD + markets.pAD > 1.0;
  checks.push({ name:'DC_OVERLAP', ok:dcOk, val:(markets.pHD + markets.pAD).toFixed(4), expected:'>1.0' });
  // Over + Under ≈ 1
  const ouSum = markets.pOver + markets.pUnder;
  const ouOk = Math.abs(ouSum - 1.0) < 0.0001;
  checks.push({ name:'OU_SUM', ok:ouOk, val:ouSum.toFixed(6), expected:'1.000000' });
  for (const c of checks) {
    if (c.ok) { XREF_PASS++; log('XREF', fid, `  ✓ ${c.name}: ${c.val} (expected ${c.expected})`); }
    else       { XREF_FAIL++; hardFail('XREF', `${fid} ${c.name}: ${c.val} ≠ ${c.expected}`); }
  }
  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  banner(`${ENGINE_VERSION} — SESSION: ${SESSION_ID}`);
  log('SECTION', 'ENGINE_INIT', `WC2026 v16.0 Engine starting — ${new Date().toISOString()}`);
  log('INPUT',   'ENGINE_INIT', `Backtest matchs: ${BACKTEST_MATCHS.length}`);
  log('INPUT',   'ENGINE_INIT', `Projection matchs: ${PROJECTION_MATCHS.length}`);
  log('INPUT',   'ENGINE_INIT', `Variations: ${VARIATIONS.length}`);
  log('INPUT',   'ENGINE_INIT', `Log file: ${LOG_FILE} (APPEND-ONLY)`);
  log('INPUT',   'ENGINE_INIT', `Report file: ${REPORT_PATH}`);

  // ── C8: Validate weights ─────────────────────────────────────────────────
  validateWeights();

  // ── DB Connection ────────────────────────────────────────────────────────
  banner('PHASE 1 — DATABASE CONNECTION');
  const url = process.env.DATABASE_URL;
  if (!url) hardFail('DB_INIT', 'DATABASE_URL not set');
  const conn = await mysql.createConnection(url);
  log('PASS', 'DB_INIT', 'Database connection established ✓');

  // ── Pull all ESPN data ───────────────────────────────────────────────────
  banner('PHASE 2 — ESPN DATA INGESTION');
  const allTeams = [
    ...new Set([
      ...BACKTEST_MATCHS.flatMap(f => [f.home, f.away]),
      ...PROJECTION_MATCHS.flatMap(f => [f.home, f.away]),
    ])
  ];
  log('INPUT', 'ESPN_PULL', `Teams to pull: ${allTeams.join(', ')}`);

  // xG data
  subBanner('PULLING wc2026_espn_expected_goals');
  const [xgAll] = await conn.query(`
    SELECT espn_match_id, matchRound, homeTeamAbbrev, awayTeamAbbrev,
           homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
    FROM wc2026_espn_expected_goals
    WHERE (homeTeamAbbrev IN (${allTeams.map(()=>'?').join(',')})
        OR awayTeamAbbrev IN (${allTeams.map(()=>'?').join(',')}))
    AND matchRound = 'group-stage'
    AND homeXG IS NOT NULL AND awayXG IS NOT NULL
    ORDER BY espn_match_id ASC
  `, [...allTeams, ...allTeams]);
  log('PASS', 'ESPN_XG', `Loaded ${xgAll.length} xG rows for ${allTeams.length} teams`);
  xgAll.forEach(r => log('REAL_DATA', 'XG_ROW', `  ${r.espn_match_id} ${r.homeTeamAbbrev} xG=${r.homeXG} xGOT=${r.homeXGOT} | ${r.awayTeamAbbrev} xG=${r.awayXG} xGOT=${r.awayXGOT}`));

  // Team stats (possession)
  subBanner('PULLING wc2026_espn_team_stats');
  const xgMatchIds = [...new Set(xgAll.map(r => r.espn_match_id))];
  const [tsAll] = await conn.query(`
    SELECT espn_match_id, possession, possessionAway
    FROM wc2026_espn_team_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')})
    ORDER BY espn_match_id ASC
  `, xgMatchIds);
  log('PASS', 'ESPN_TS', `Loaded ${tsAll.length} team stats rows`);

  // Match stats (shots)
  subBanner('PULLING wc2026_espn_match_stats');
  const [msAll] = await conn.query(`
    SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev,
           homeShots, awayShots, homeShotsOnGoal, awayShotsOnGoal
    FROM wc2026_espn_match_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')})
    AND homeShots IS NOT NULL
    ORDER BY espn_match_id ASC
  `, xgMatchIds);
  log('PASS', 'ESPN_MS', `Loaded ${msAll.length} match stats rows`);

  // Player stats (aggregated per team per match)
  subBanner('PULLING wc2026_espn_player_stats');
  const [psAll] = await conn.query(`
    SELECT espn_match_id, teamAbbrev,
           SUM(xG) as pXG, SUM(xA) as pXA, SUM(sog) as pSOG,
           SUM(shot) as pShot, SUM(tch) as pTch, SUM(duelw) as pDuelW,
           SUM(xGOTC) as pXGOT
    FROM wc2026_espn_player_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')})
    AND teamAbbrev IN (${allTeams.map(()=>'?').join(',')})
    GROUP BY espn_match_id, teamAbbrev
    ORDER BY espn_match_id, teamAbbrev ASC
  `, [...xgMatchIds, ...allTeams]);
  log('PASS', 'ESPN_PS', `Loaded ${psAll.length} player stats rows`);

  // Shot map (aggregated per team per match)
  subBanner('PULLING wc2026_espn_shot_map');
  const [smAll] = await conn.query(`
    SELECT espn_match_id, teamAbbrev,
           SUM(xG) as shotXG, SUM(xGOT) as shotXGOT,
           COUNT(*) as shots,
           SUM(CASE WHEN isOwnGoal=0 AND iconType='goal' THEN 1 ELSE 0 END) as goals,
           AVG(distance) as avgDist
    FROM wc2026_espn_shot_map
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')})
    AND teamAbbrev IN (${allTeams.map(()=>'?').join(',')})
    GROUP BY espn_match_id, teamAbbrev
    ORDER BY espn_match_id, teamAbbrev ASC
  `, [...xgMatchIds, ...allTeams]);
  log('PASS', 'ESPN_SM', `Loaded ${smAll.length} shot map rows`);

  // ── PHASE 3: BACKTEST — 25 VARIATIONS × 10 MATCHES ──────────────────────
  banner('PHASE 3 — 10-MATCH BACKTEST: 25 VARIATIONS');
  log('BACKTEST', 'BT_INIT', `Running ${VARIATIONS.length} variations × ${BACKTEST_MATCHS.length} matches`);

  const btResultsByVariation = {};

  for (const v of VARIATIONS) {
    subBanner(`VARIATION ${v.id} — xGW=${v.xGW} xGOTW=${v.xGOTW} smW=${v.smW} psW=${v.psW} xAW=${v.xAW} spW=${v.spW} rho=${v.rho} pace=${v.pace}`);
    const btResults = [];

    for (const match of BACKTEST_MATCHS) {
      log('BACKTEST', `BT_${v.id}`, `  Processing ${match.fid}: ${match.home} vs ${match.away}`);

      // Build GS rows for home and away
      let gsH, gsA, lambdaDataH, lambdaDataA;
      try {
        gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
        gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
        lambdaDataH = computeLambda(match.home, gsH, psAll, smAll, v);
        lambdaDataA = computeLambda(match.away, gsA, psAll, smAll, v);
      } catch (e) {
        log('WARN', `BT_${v.id}`, `  ${match.fid}: lambda computation failed — ${e.message} — SKIPPING`);
        continue;
      }

      const markets = deriveMarkets(match.fid, match.home, match.away, lambdaDataH.lambda, lambdaDataA.lambda, v);
      btResults.push({ match, lambdaH: lambdaDataH.lambda, lambdaA: lambdaDataA.lambda, markets });
      log('BACKTEST', `BT_${v.id}`, `  ${match.fid}: λH=${fmt(lambdaDataH.lambda)} λA=${fmt(lambdaDataA.lambda)} pH=${pct(markets.pH)} pD=${pct(markets.pD)} pA=${pct(markets.pA)} pOver=${pct(markets.pOver)}`);
    }

    const grade = gradeVariation(v, btResults);
    btResultsByVariation[v.id] = { v, btResults, grade };
    log('BACKTEST', `GRADE_${v.id}`, `  ${v.id}: dir=${pct(grade.dirPct)} spread=${pct(grade.spreadPct)} total=${pct(grade.totalPct)} btts=${pct(grade.bttsPct)} brier=${grade.avgBrier.toFixed(4)} composite=${grade.composite.toFixed(2)}`);
    progressBar(VARIATIONS.indexOf(v)+1, VARIATIONS.length, `Variation ${v.id} graded`);
  }

  // ── Select winner ────────────────────────────────────────────────────────
  banner('PHASE 4 — WINNER SELECTION');
  let winner = null;
  let bestComposite = -Infinity;
  for (const [vid, data] of Object.entries(btResultsByVariation)) {
    if (data.grade.composite > bestComposite) {
      bestComposite = data.grade.composite;
      winner = data;
    }
  }
  if (!winner) hardFail('WINNER', 'No winner selected — all variations failed');
  log('WINNER', 'WINNER_SEL', `WINNER: ${winner.v.id} | composite=${winner.grade.composite.toFixed(2)}`);
  log('WINNER', 'WINNER_SEL', `  dir=${pct(winner.grade.dirPct)} (${winner.grade.dirCorrect}/${winner.grade.n})`);
  log('WINNER', 'WINNER_SEL', `  spread=${pct(winner.grade.spreadPct)} (${winner.grade.spreadCorrect}/${winner.grade.n})`);
  log('WINNER', 'WINNER_SEL', `  total=${pct(winner.grade.totalPct)} (${winner.grade.totalCorrect}/${winner.grade.n})`);
  log('WINNER', 'WINNER_SEL', `  btts=${pct(winner.grade.bttsPct)} (${winner.grade.bttsCorrect}/${winner.grade.n})`);
  log('WINNER', 'WINNER_SEL', `  brier=${winner.grade.avgBrier.toFixed(4)}`);
  log('WINNER', 'WINNER_SEL', `  weights: xGW=${winner.v.xGW} xGOTW=${winner.v.xGOTW} smW=${winner.v.smW} psW=${winner.v.psW} xAW=${winner.v.xAW} spW=${winner.v.spW} rho=${winner.v.rho} pace=${winner.v.pace}`);

  // Per-match breakdown for winner
  subBanner(`WINNER ${winner.v.id} — PER-MATCH BREAKDOWN`);
  for (const pm of winner.grade.perMatch) {
    const dirIcon   = pm.dirOk    ? '✅' : '❌';
    const spreadIcon= pm.spreadOk ? '✅' : '❌';
    const totalIcon = pm.totalOk  ? '✅' : '❌';
    const bttsIcon  = pm.bttsOk   ? '✅' : '❌';
    log('BACKTEST', 'PER_MATCH', `  ${pm.fid} ${pm.home} ${pm.score} ${pm.away} | DIR:${dirIcon}(${pm.actualDir}/${pm.modelDir}) SPREAD:${spreadIcon} TOTAL:${totalIcon}(${pm.actualTotal}) BTTS:${bttsIcon} brier=${pm.brier}`);
  }

  // ── PHASE 5: RECALIBRATION ANALYSIS ─────────────────────────────────────
  banner('PHASE 5 — RECALIBRATION ANALYSIS');
  subBanner('10-MATCH vs 7-MATCH COMPARISON');
  // v15 winner was V10 with composite=55.68 on 7 matches
  // Now compute V10 on 10 matches for comparison
  const v10Data = btResultsByVariation['V10'];
  if (v10Data) {
    log('RECAL', 'V10_10MATCH', `V10 on 10 matches: dir=${pct(v10Data.grade.dirPct)} spread=${pct(v10Data.grade.spreadPct)} total=${pct(v10Data.grade.totalPct)} btts=${pct(v10Data.grade.bttsPct)} composite=${v10Data.grade.composite.toFixed(2)}`);
  }
  log('RECAL', 'WINNER_V16', `v16 winner ${winner.v.id} on 10 matches: composite=${winner.grade.composite.toFixed(2)}`);

  // Identify what changed between 7-match and 10-match
  const new3 = BACKTEST_MATCHS.slice(7);
  log('RECAL', 'NEW_3_RESULTS', `New 3 matches added to backtest:`);
  for (const f of new3) {
    log('RECAL', 'NEW_3_RESULTS', `  ${f.fid} ${f.home} ${f.homeScore}-${f.awayScore} ${f.away}`);
  }
  if (winner.grade.perMatch) {
    const new3Grades = winner.grade.perMatch.filter(pm => new3.some(f => f.fid === pm.fid));
    for (const pm of new3Grades) {
      log('RECAL', 'NEW_3_GRADE', `  ${pm.fid}: DIR:${pm.dirOk?'✅':'❌'} SPREAD:${pm.spreadOk?'✅':'❌'} TOTAL:${pm.totalOk?'✅':'❌'} BTTS:${pm.bttsOk?'✅':'❌'}`);
    }
  }

  // ── PHASE 6: JULY 2 PROJECTIONS ─────────────────────────────────────────
  banner('PHASE 6 — JULY 2 PROJECTIONS (ESP/AUT · POR/CRO · SUI/ALG)');
  const projections = {};

  for (const match of PROJECTION_MATCHS) {
    subBanner(`PROJECTING ${match.fid}: ${match.home} vs ${match.away}`);
    log('INPUT', 'PROJ_INIT', `${match.fid}: ${match.home} (home) vs ${match.away} (away) | ESPN: ${match.espnId}`);

    // Build GS rows
    const gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
    const gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
    log('STATE', 'GS_ROWS', `  ${match.home}: ${gsH.length} GS rows | ${match.away}: ${gsA.length} GS rows`);

    // Compute lambdas with winner variation
    const ldH = computeLambda(match.home, gsH, psAll, smAll, winner.v);
    const ldA = computeLambda(match.away, gsA, psAll, smAll, winner.v);
    const lambdaH = ldH.lambda;
    const lambdaA = ldA.lambda;

    log('LAMBDA', 'FINAL_LAMBDA', `  ${match.home}: λ=${fmt(lambdaH)} (xG=${fmt(ldH.avgXG)} xGOT=${fmt(ldH.avgXGOT)} xA=${fmt(ldH.avgXA)} poss=${fmt(ldH.avgPoss,1)}%)`);
    log('LAMBDA', 'FINAL_LAMBDA', `  ${match.away}: λ=${fmt(lambdaA)} (xG=${fmt(ldA.avgXG)} xGOT=${fmt(ldA.avgXGOT)} xA=${fmt(ldA.avgXA)} poss=${fmt(ldA.avgPoss,1)}%)`);

    // Derive markets
    const markets = deriveMarkets(match.fid, match.home, match.away, lambdaH, lambdaA, winner.v);

    // XREF validation
    subBanner(`XREF VALIDATION: ${match.fid}`);
    const xrefChecks = xrefValidate(match.fid, markets);

    // Log all markets
    subBanner(`MARKET OUTPUT: ${match.fid} ${match.home} vs ${match.away}`);
    log('OUTPUT', 'PROJ_LAMBDA', `  λH=${fmt(lambdaH,4)} · λA=${fmt(lambdaA,4)} · Proj: ${fmt(markets.projH,2)}–${fmt(markets.projA,2)} · Total=${fmt(markets.projTotal,2)}`);
    log('OUTPUT', 'PROJ_PROBS',  `  pH=${pct(markets.pH)} pD=${pct(markets.pD)} pA=${pct(markets.pA)} pOver=${pct(markets.pOver)} pBTTS=${pct(markets.pBTTS)}`);
    log('MARKET', 'ML',          `  ML: ${match.home}=${ml(markets.mlHome)} Draw=${ml(markets.mlDraw)} ${match.away}=${ml(markets.mlAway)}`);
    log('MARKET', 'SPREAD',      `  Spread: ${match.home} -1.5 ${ml(markets.mlHomeSpread)} / ${match.away} +1.5 ${ml(markets.mlAwaySpread)}`);
    log('MARKET', 'TOTAL',       `  Total: O2.5 ${ml(markets.mlOver)} / U2.5 ${ml(markets.mlUnder)}`);
    log('MARKET', 'BTTS',        `  BTTS: Yes ${ml(markets.mlBTTSY)} / No ${ml(markets.mlBTTSN)}`);
    log('MARKET', 'DBL_CHC',     `  Double Chance: ${match.home}/Draw ${ml(markets.mlHD)} / ${match.away}/Draw ${ml(markets.mlAD)}`);
    log('MARKET', 'NO_DRAW',     `  No Draw: ${match.home} ${ml(markets.mlNDH)} / ${match.away} ${ml(markets.mlNDA)}`);
    log('MARKET', 'TO_ADV',      `  To Advance: ${match.home} ${ml(markets.mlAdvH)} / ${match.away} ${ml(markets.mlAdvA)}`);

    projections[match.fid] = { match, lambdaH, lambdaA, ldH, ldA, markets, xrefChecks };
  }

  // ── PHASE 7: DB WRITES ───────────────────────────────────────────────────
  banner('PHASE 7 — DATABASE WRITES');

  for (const [fid, proj] of Object.entries(projections)) {
    const { match, lambdaH, lambdaA, ldH, ldA, markets } = proj;
    subBanner(`DB WRITE: ${fid} → wc2026_model_projections`);

    // Check if match exists in wc2026_matches
    const [fidRows] = await conn.query(`SELECT match_id FROM wc2026_matches WHERE match_id = ?`, [fid]);
    if (fidRows.length === 0) {
      log('WARN', 'DB_WRITE', `${fid}: NOT found in wc2026_matches — SKIPPING DB write`);
      continue;
    }
    log('PASS', 'DB_WRITE', `${fid}: confirmed in wc2026_matches ✓`);

    // Upsert into wc2026_model_projections
    const mpRow = {
      match_id: fid,
      model_version: ENGINE_VERSION,
      is_frozen: 0,
      home_team: match.home,
      away_team: match.away,
      home_lambda: lambdaH,
      away_lambda: lambdaA,
      proj_home_score: markets.projH,
      proj_away_score: markets.projA,
      proj_total: markets.projTotal,
      model_spread: markets.spreadLine,
      model_total: 2.5,
      model_home_ml: markets.mlHome,
      model_draw_ml: markets.mlDraw,
      model_away_ml: markets.mlAway,
      home_spread_odds: markets.mlHomeSpread,
      away_spread_odds: markets.mlAwaySpread,
      over_odds: markets.mlOver,
      under_odds: markets.mlUnder,
      btts_yes_odds: markets.mlBTTSY,
      btts_no_odds: markets.mlBTTSN,
      to_advance_home_odds: markets.mlAdvH,
      to_advance_away_odds: markets.mlAdvA,
      to_advance_home_prob: markets.pAdvHn,
      to_advance_away_prob: markets.pAdvAn,
      dc_1x_odds: markets.mlHD,
      dc_x2_odds: markets.mlAD,
      no_draw_home_odds: markets.mlNDH,
      no_draw_away_odds: markets.mlNDA,
      home_win_prob: markets.pH,
      draw_prob: markets.pD,
      away_win_prob: markets.pA,
      over_2_5: markets.pOver,
      btts_prob: markets.pBTTS,
      nv_home_prob: markets.pH,
      nv_draw_prob: markets.pD,
      nv_away_prob: markets.pA,
      nv_dc_1x: markets.pHD,
      nv_dc_x2: markets.pAD,
      nv_no_draw_home: markets.pNDH,
      nv_no_draw_away: markets.pNDA,
      modeled_at: new Date(),
      created_at: new Date(),
    };

    // Check if row exists
    const [existingMp] = await conn.query(`SELECT match_id FROM wc2026_model_projections WHERE match_id = ?`, [fid]);
    if (existingMp.length > 0) {
      log('STEP', 'DB_WRITE', `${fid}: updating existing wc2026_model_projections row`);
      const setClauses = Object.keys(mpRow).filter(k => k !== 'match_id').map(k => `${k} = ?`).join(', ');
      const vals = Object.keys(mpRow).filter(k => k !== 'match_id').map(k => mpRow[k]);
      await conn.query(`UPDATE wc2026_model_projections SET ${setClauses} WHERE match_id = ?`, [...vals, fid]);
    } else {
      log('STEP', 'DB_WRITE', `${fid}: inserting new wc2026_model_projections row`);
      const cols = Object.keys(mpRow).join(', ');
      const placeholders = Object.keys(mpRow).map(()=>'?').join(', ');
      await conn.query(`INSERT INTO wc2026_model_projections (${cols}) VALUES (${placeholders})`, Object.values(mpRow));
    }
    log('PASS', 'DB_WRITE', `${fid}: wc2026_model_projections write complete ✓`);

    // ── Write to wc2026MatchOdds ─────────────────────────────────────────
    subBanner(`DB WRITE: ${fid} → wc2026MatchOdds`);
    const [moRows] = await conn.query(`SELECT match_id FROM wc2026MatchOdds WHERE match_id = ?`, [fid]);

    const moFields = {
      lamba_home: lambdaH,
      lamba_away: lambdaA,
      model_projected_home_goals: markets.projH,
      model_projected_away_goals: markets.projA,
      model_home_ml: markets.mlHome,
      model_draw: markets.mlDraw,
      model_away_ml: markets.mlAway,
      model_primary_spread: markets.spreadLine,
      model_home_primary_spread_odds: markets.mlHomeSpread,
      model_away_primary_spread_odds: markets.mlAwaySpread,
      model_total: 2.5,
      model_over_odds: markets.mlOver,
      model_under_odds: markets.mlUnder,
      model_btts_yes: markets.mlBTTSY,
      model_btts_no: markets.mlBTTSN,
      model_home_to_advance: markets.mlAdvH,
      model_away_to_advance: markets.mlAdvA,
      model_home_wd: markets.mlHD,
      model_away_wd: markets.mlAD,
      model_no_draw: markets.mlNDH,
    };

    if (moRows.length > 0) {
      log('STEP', 'DB_WRITE', `${fid}: updating existing wc2026MatchOdds row (${Object.keys(moFields).length} fields)`);
      const setClauses = Object.keys(moFields).map(k => `${k} = ?`).join(', ');
      await conn.query(`UPDATE wc2026MatchOdds SET ${setClauses} WHERE match_id = ?`, [...Object.values(moFields), fid]);
      log('PASS', 'DB_WRITE', `${fid}: wc2026MatchOdds UPDATE complete ✓`);
    } else {
      log('WARN', 'DB_WRITE', `${fid}: NOT found in wc2026MatchOdds — row needs to be seeded first`);
    }
  }

  // ── PHASE 8: READ-BACK AUDIT ─────────────────────────────────────────────
  banner('PHASE 8 — READ-BACK AUDIT');
  for (const fid of Object.keys(projections)) {
    subBanner(`READ-BACK AUDIT: ${fid}`);
    const [mpAudit] = await conn.query(`
      SELECT match_id, model_version, home_lambda, away_lambda,
             proj_home_score, proj_away_score, proj_total,
             model_home_ml, model_draw_ml, model_away_ml,
             model_spread, home_spread_odds, away_spread_odds,
             over_odds, under_odds,
             btts_yes_odds, btts_no_odds,
             to_advance_home_odds, to_advance_away_odds,
             dc_1x_odds, dc_x2_odds
      FROM wc2026_model_projections WHERE match_id = ?
    `, [fid]);

    if (mpAudit.length === 0) {
      log('FAIL', 'AUDIT', `${fid}: NOT found in wc2026_model_projections after write`);
      continue;
    }
    const row = mpAudit[0];
    const proj = projections[fid];
    const checks = [
      ['home_lambda',            row.home_lambda,            proj.lambdaH,                  0.0001],
      ['away_lambda',            row.away_lambda,            proj.lambdaA,                  0.0001],
      ['proj_home_score',        row.proj_home_score,        proj.markets.projH,             0.0001],
      ['proj_away_score',        row.proj_away_score,        proj.markets.projA,             0.0001],
      ['model_home_ml',          row.model_home_ml,          proj.markets.mlHome,            0],
      ['model_draw_ml',          row.model_draw_ml,          proj.markets.mlDraw,            0],
      ['model_away_ml',          row.model_away_ml,          proj.markets.mlAway,            0],
      ['home_spread_odds',       row.home_spread_odds,       proj.markets.mlHomeSpread,      0],
      ['away_spread_odds',       row.away_spread_odds,       proj.markets.mlAwaySpread,      0],
      ['over_odds',              row.over_odds,              proj.markets.mlOver,            0],
      ['under_odds',             row.under_odds,             proj.markets.mlUnder,           0],
      ['btts_yes_odds',          row.btts_yes_odds,          proj.markets.mlBTTSY,           0],
      ['btts_no_odds',           row.btts_no_odds,           proj.markets.mlBTTSN,           0],
      ['to_advance_home_odds',   row.to_advance_home_odds,   proj.markets.mlAdvH,            0],
      ['to_advance_away_odds',   row.to_advance_away_odds,   proj.markets.mlAdvA,            0],
      ['dc_1x_odds',             row.dc_1x_odds,             proj.markets.mlHD,              0],
      ['dc_x2_odds',             row.dc_x2_odds,             proj.markets.mlAD,              0],
    ];
    let allPass = true;
    for (const [field, stored, expected, tol] of checks) {
      const storedN  = parseFloat(stored);
      const expectedN = parseFloat(expected);
      const diff = Math.abs(storedN - expectedN);
      const ok = diff <= (tol > 0 ? tol : 0.5);
      if (ok) {
        log('PASS', 'AUDIT', `  ${fid}.${field}: stored=${storedN} expected=${expectedN} diff=${diff.toFixed(6)} ✓`);
      } else {
        log('FAIL', 'AUDIT', `  ${fid}.${field}: stored=${storedN} expected=${expectedN} diff=${diff.toFixed(6)} ✗`);
        allPass = false;
      }
    }
    if (allPass) log('PASS', 'AUDIT', `${fid}: ALL ${checks.length} fields verified ✓`);
    else         log('FAIL', 'AUDIT', `${fid}: AUDIT FAILURES DETECTED`);
  }

  // ── PHASE 9: FINAL REPORT ────────────────────────────────────────────────
  banner('PHASE 9 — FINAL REPORT');
  const allVariationGrades = Object.entries(btResultsByVariation).map(([vid, data]) => ({
    id: vid,
    composite: data.grade.composite,
    dirPct: data.grade.dirPct,
    spreadPct: data.grade.spreadPct,
    totalPct: data.grade.totalPct,
    bttsPct: data.grade.bttsPct,
    avgBrier: data.grade.avgBrier,
    n: data.grade.n,
    dirCorrect: data.grade.dirCorrect,
    spreadCorrect: data.grade.spreadCorrect,
    totalCorrect: data.grade.totalCorrect,
    bttsCorrect: data.grade.bttsCorrect,
    weights: data.v,
  })).sort((a,b) => b.composite - a.composite);

  log('OUTPUT', 'FINAL_REPORT', `Top 5 variations by composite score:`);
  for (const g of allVariationGrades.slice(0, 5)) {
    log('OUTPUT', 'FINAL_REPORT', `  ${g.id}: composite=${g.composite.toFixed(2)} dir=${pct(g.dirPct)} spread=${pct(g.spreadPct)} total=${pct(g.totalPct)} btts=${pct(g.bttsPct)} brier=${g.avgBrier.toFixed(4)}`);
  }

  const projSummary = {};
  for (const [fid, proj] of Object.entries(projections)) {
    const { match, lambdaH, lambdaA, markets } = proj;
    projSummary[fid] = {
      match: `${match.home} vs ${match.away}`,
      espnId: match.espnId,
      lambdaH: parseFloat(lambdaH.toFixed(4)),
      lambdaA: parseFloat(lambdaA.toFixed(4)),
      projH: parseFloat(markets.projH.toFixed(2)),
      projA: parseFloat(markets.projA.toFixed(2)),
      projTotal: parseFloat(markets.projTotal.toFixed(2)),
      pH: parseFloat(markets.pH.toFixed(4)),
      pD: parseFloat(markets.pD.toFixed(4)),
      pA: parseFloat(markets.pA.toFixed(4)),
      pOver: parseFloat(markets.pOver.toFixed(4)),
      pBTTS: parseFloat(markets.pBTTS.toFixed(4)),
      pAdvH: parseFloat(markets.pAdvHn.toFixed(4)),
      pAdvA: parseFloat(markets.pAdvAn.toFixed(4)),
      mlHome: markets.mlHome,
      mlDraw: markets.mlDraw,
      mlAway: markets.mlAway,
      spreadLine: markets.spreadLine,
      mlHomeSpread: markets.mlHomeSpread,
      mlAwaySpread: markets.mlAwaySpread,
      mlOver: markets.mlOver,
      mlUnder: markets.mlUnder,
      mlBTTSY: markets.mlBTTSY,
      mlBTTSN: markets.mlBTTSN,
      mlHD: markets.mlHD,
      mlAD: markets.mlAD,
      mlAdvH: markets.mlAdvH,
      mlAdvA: markets.mlAdvA,
    };
  }

  const report = {
    engineVersion: ENGINE_VERSION,
    sessionId: SESSION_ID,
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - START_TS,
    totalSteps: STEP,
    pass: PASS, fail: FAIL, warn: WARN,
    xrefPass: XREF_PASS, xrefFail: XREF_FAIL,
    winner: {
      id: winner.v.id,
      composite: winner.grade.composite,
      dirPct: winner.grade.dirPct,
      spreadPct: winner.grade.spreadPct,
      totalPct: winner.grade.totalPct,
      bttsPct: winner.grade.bttsPct,
      avgBrier: winner.grade.avgBrier,
      n: winner.grade.n,
      dirCorrect: winner.grade.dirCorrect,
      spreadCorrect: winner.grade.spreadCorrect,
      totalCorrect: winner.grade.totalCorrect,
      bttsCorrect: winner.grade.bttsCorrect,
      weights: winner.v,
      perMatch: winner.grade.perMatch,
    },
    allVariationGrades,
    projections: projSummary,
    backtestMatchs: BACKTEST_MATCHS.map(f => ({ fid:f.fid, home:f.home, away:f.away, score:`${f.homeScore}-${f.awayScore}` })),
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log('PASS', 'REPORT', `Report written to ${REPORT_PATH} ✓`);

  // Final summary banner
  banner(`${ENGINE_VERSION} — COMPLETE`, C.BG_GREEN+C.BOLD+C.WHITE);
  log('OUTPUT', 'FINAL_SUMMARY', `STEPS: ${STEP} | PASS: ${PASS} | FAIL: ${FAIL} | WARN: ${WARN} | XREF: ${XREF_PASS}/${XREF_PASS+XREF_FAIL}`);
  log('OUTPUT', 'FINAL_SUMMARY', `WINNER: ${winner.v.id} | composite=${winner.grade.composite.toFixed(2)} | dir=${pct(winner.grade.dirPct)} | total=${pct(winner.grade.totalPct)}`);
  log('OUTPUT', 'FINAL_SUMMARY', `ELAPSED: ${((Date.now()-START_TS)/1000).toFixed(2)}s`);

  await conn.end();
  log('PASS', 'ENGINE_DONE', 'Database connection closed. Engine complete. ✓');
}

main().catch(err => {
  const msg = `FATAL ENGINE ERROR: ${err.message}`;
  console.error(`\x1b[41m\x1b[1m${msg}\x1b[0m`);
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} FATAL: ${msg}\n${err.stack}\n`);
  process.exit(1);
});
