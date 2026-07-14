/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  WC2026 v26.0 — 500X BACKTEST + CORRECT SCORE + RECALIBRATION ENGINE       ║
 * ║  Date: 2026-07-15                                                           ║
 * ║  Scope: Jul 15 SF Match (102: ENG vs ARG)                                  ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  PIPELINE (identical to v25 Jul 14 run):                                   ║
 * ║    1. Pull ESPN data (xG, team stats, match stats, player stats, shot map) ║
 * ║    2. 500X Monte Carlo backtest across 25 variations (24 matches)          ║
 * ║    3. Correct Score outcome grading (exact score probability)              ║
 * ║    4. Recalibration from backtest performance                              ║
 * ║    5. Reinforcement — lock optimal parameters                              ║
 * ║    6. Model Jul 15 SF match (ENG vs ARG) with final engine                 ║
 * ║    7. Full audit + DB write                                                 ║
 * ║                                                                              ║
 * ║  ORIENTATION (advancement-map verified): SF-102 (ESPN 760515) home =       ║
 * ║    W(M99)=ENG (won QF-099 NOR v ENG), away = W(M100)=ARG (won QF-100).      ║
 * ║    Matches BetExplorer england-argentina (ENG home) + owner to-advance.     ║
 * ║    ESPN URL slug 'argentina-england' is text ordering only; canonical      ║
 * ║    home/away comes from wc2026_matches (asserted live before any write).   ║
 * ║                                                                              ║
 * ║  BOOK ODDS SOURCE: BetExplorer bet365 (scraped 2026-07-15 via CI probe)    ║
 * ║  EXECUTION: designed to run INSIDE Railway (valid DATABASE_URL) via the    ║
 * ║    owner-triggered POST /api/scheduled/wc2026-engine endpoint, which       ║
 * ║    spawns this .mjs the same way bracket-sync spawns its scraper.          ║
 * ║  LOG: ./wc2026modeling_jul15.txt (APPEND — also to stdout for Railway logs)║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const LOG_FILE = './wc2026modeling_jul15.txt';
const SESSION_ID = `v26-JUL15-500X-BACKTEST-RECAL-${Date.now()}`;
const START_TS = Date.now();
const ENGINE_VERSION = 'v26.0-500X-CORRECT-SCORE-RECALIBRATED-SF-JUL15';

// ══════════════════════════════════════════════════════════════════════════════
// FORENSIC DEBUG FRAMEWORK
// ══════════════════════════════════════════════════════════════════════════════
let STEP = 0, PASS_COUNT = 0, FAIL_COUNT = 0, WARN_COUNT = 0;
const C = {
  RESET:'\x1b[0m', BOLD:'\x1b[1m', DIM:'\x1b[2m',
  RED:'\x1b[31m', GREEN:'\x1b[32m', YELLOW:'\x1b[33m',
  BLUE:'\x1b[34m', MAGENTA:'\x1b[35m', CYAN:'\x1b[36m',
  BG_RED:'\x1b[41m', BG_GREEN:'\x1b[42m', BG_BLUE:'\x1b[44m', BG_MAGENTA:'\x1b[45m',
  WHITE:'\x1b[37m', BRIGHT_GREEN:'\x1b[92m', BRIGHT_CYAN:'\x1b[96m', BRIGHT_YELLOW:'\x1b[93m',
};
function ts() { return `[${new Date().toISOString()}]`; }
function elapsed() { return `+${((Date.now()-START_TS)/1000).toFixed(3)}s`; }
function log(level, msg) {
  STEP++;
  const icons = { PASS:'✅', FAIL:'❌', WARN:'⚠️ ', INPUT:'📥', STATE:'◈ ', STEP:'▶ ', OUTPUT:'📤', LAMBDA:'⚡', MARKET:'💰', BACKTEST:'📊', RECAL:'🔄', DB:'💾', AUDIT:'🔍', XREF:'🔗', PROJ:'🎯', SCORE:'🎲', REINF:'🔒', GRADE:'📋', SIM:'🎰' };
  const colors = { PASS:C.BRIGHT_GREEN, FAIL:C.RED+C.BOLD, WARN:C.YELLOW, INPUT:C.BLUE, STATE:C.WHITE, STEP:C.DIM, OUTPUT:C.BRIGHT_CYAN+C.BOLD, LAMBDA:C.WHITE+C.BOLD, MARKET:C.YELLOW, BACKTEST:C.MAGENTA, RECAL:C.CYAN, DB:C.GREEN, AUDIT:C.MAGENTA+C.BOLD, XREF:C.CYAN, PROJ:C.BRIGHT_GREEN+C.BOLD, SCORE:C.BRIGHT_YELLOW, REINF:C.BRIGHT_GREEN+C.BOLD, GRADE:C.MAGENTA, SIM:C.CYAN+C.BOLD };
  const icon = icons[level]||'  ';
  const color = colors[level]||C.WHITE;
  const line = `${ts()} ${elapsed()} S${String(STEP).padStart(4,'0')} [${icon} ${level.padEnd(8)}] ${msg}`;
  console.log(`${C.DIM}${ts()} ${elapsed()}${C.RESET} ${C.BOLD}S${String(STEP).padStart(4,'0')}${C.RESET} ${color}[${icon} ${level.padEnd(8)}]${C.RESET} ${msg}`);
  fs.appendFileSync(LOG_FILE, line + '\n');
  if (level==='PASS') PASS_COUNT++;
  if (level==='FAIL') FAIL_COUNT++;
  if (level==='WARN') WARN_COUNT++;
}
function banner(msg) {
  const bar = '═'.repeat(100);
  const lines = [`\n${bar}`, `  ${msg}`, bar];
  lines.forEach(l => { console.log(`${C.BG_BLUE}${C.BOLD}${C.WHITE}${l}${C.RESET}`); fs.appendFileSync(LOG_FILE, l+'\n'); });
}
function hardFail(msg) { log('FAIL', msg); throw new Error(`HARD FAIL: ${msg}`); }
function fmt(v, d=4) { return typeof v==='number'?v.toFixed(d):String(v??'NULL'); }
function pct(v) { return (v*100).toFixed(1)+'%'; }
function ml(v) { return v>0?`+${v}`:`${v}`; }
function probToML(p) { if(p<=0.001) return 99999; if(p>=0.999) return -99999; return p>=0.5 ? Math.round(-100*p/(1-p)) : Math.round(100*(1-p)/p); }

// ══════════════════════════════════════════════════════════════════════════════
// TIER MULTIPLIERS (v19)
// ══════════════════════════════════════════════════════════════════════════════
const TIER_MULTIPLIER = {
  'FRA': 1.15, 'ARG': 1.12, 'BRA': 1.10, 'ESP': 1.10, 'ENG': 1.08,
  'POR': 1.06, 'GER': 1.05, 'NED': 1.05, 'BEL': 1.04, 'COL': 1.04, 'USA': 1.03,
  'MEX': 1.02, 'MAR': 1.03, 'CRO': 1.02, 'SUI': 1.01, 'NOR': 1.01,
};

// ══════════════════════════════════════════════════════════════════════════════
// MATH ENGINE — Dixon-Coles with correlation parameter
// ══════════════════════════════════════════════════════════════════════════════
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
function dcAdjust(x, y, lambda, mu, rho) {
  if (x===0 && y===0) return 1 - lambda*mu*rho;
  if (x===0 && y===1) return 1 + lambda*rho;
  if (x===1 && y===0) return 1 + mu*rho;
  if (x===1 && y===1) return 1 - rho;
  return 1;
}

function buildJointMatrix(lambdaH, lambdaA, rho) {
  const MAX_G = 9;
  let totalP = 0;
  const joint = Array.from({length:MAX_G+1}, ()=>new Float64Array(MAX_G+1));
  for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
    const p = poissonPMF(h,lambdaH)*poissonPMF(a,lambdaA)*dcAdjust(h,a,lambdaH,lambdaA,rho);
    joint[h][a]=p; totalP+=p;
  }
  for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) joint[h][a]/=totalP;
  return joint;
}

function deriveAllMarkets(joint, lambdaH, lambdaA, spreadLine) {
  const MAX_G = 9;
  let pH=0, pD=0, pA=0, pOver=0, pUnder=0, pBTTS=0;
  let pHomeSpread=0, pAwaySpread=0;
  let pAdvH=0, pAdvA=0;
  const lambdaH_et = lambdaH/3, lambdaA_et = lambdaA/3;
  
  for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
    const p = joint[h][a];
    if (h>a) { pH+=p; pAdvH+=p; }
    else if (h<a) { pA+=p; pAdvA+=p; }
    else {
      pD+=p;
      let etH=0, etA=0, etD=0;
      for (let eh=0;eh<=4;eh++) for (let ea=0;ea<=4;ea++) {
        const ep = poissonPMF(eh,lambdaH_et)*poissonPMF(ea,lambdaA_et);
        if (eh>ea) etH+=ep; else if (ea>eh) etA+=ep; else etD+=ep;
      }
      const etTotal = etH+etA+etD;
      etH/=etTotal; etA/=etTotal; etD/=etTotal;
      pAdvH += p*(etH + etD*0.505);
      pAdvA += p*(etA + etD*0.495);
    }
    if (h+a>2.5) pOver+=p; else pUnder+=p;
    if (h>0&&a>0) pBTTS+=p;
    const margin = h - a;
    if (Math.abs(spreadLine) % 1 !== 0) {
      if (margin > -spreadLine) pHomeSpread+=p;
      else pAwaySpread+=p;
    } else {
      if (margin > -spreadLine) pHomeSpread+=p;
      else if (margin < -spreadLine) pAwaySpread+=p;
      else { pHomeSpread+=p*0.5; pAwaySpread+=p*0.5; }
    }
  }
  
  const pHomeWD = pH + pD;
  const pAwayWD = pA + pD;
  const pNoDraw = pH + pA;
  
  return {
    pH, pD, pA, pOver, pUnder, pBTTS, pHomeSpread, pAwaySpread, pAdvH, pAdvA,
    pHomeWD, pAwayWD, pNoDraw,
    projH: lambdaH, projA: lambdaA, projTotal: lambdaH+lambdaA,
    spreadLine,
    mlHome: probToML(pH), mlDraw: probToML(pD), mlAway: probToML(pA),
    mlOver: probToML(pOver), mlUnder: probToML(pUnder),
    mlBTTSY: probToML(pBTTS), mlBTTSN: probToML(1-pBTTS),
    mlHomeSpread: probToML(pHomeSpread), mlAwaySpread: probToML(pAwaySpread),
    mlAdvH: probToML(pAdvH), mlAdvA: probToML(pAdvA),
    mlHomeWD: probToML(pHomeWD), mlAwayWD: probToML(pAwayWD), mlNoDraw: probToML(pNoDraw),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CORRECT SCORE PROBABILITY
// ══════════════════════════════════════════════════════════════════════════════
function correctScoreProb(joint, homeScore, awayScore) {
  if (homeScore > 9 || awayScore > 9) return 0;
  return joint[homeScore][awayScore];
}

function correctScoreGrade(joint, actualHome, actualAway) {
  const prob = correctScoreProb(joint, actualHome, actualAway);
  const allScores = [];
  for (let h=0;h<=9;h++) for (let a=0;a<=9;a++) allScores.push({h,a,p:joint[h][a]});
  allScores.sort((a,b)=>b.p-a.p);
  const rank = allScores.findIndex(s=>s.h===actualHome && s.a===actualAway) + 1;
  const topScore = allScores[0];
  return { prob, rank, totalScores: allScores.length, topScore: `${topScore.h}-${topScore.a}`, topProb: topScore.p };
}

// ══════════════════════════════════════════════════════════════════════════════
// 25 VARIATIONS (v19 — expanded parameter space)
// ══════════════════════════════════════════════════════════════════════════════
const VARIATIONS = [
  { id:'V1',  xGW:0.30, xGOTW:0.28, smW:0.12, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.060, pace:0.012 },
  { id:'V2',  xGW:0.35, xGOTW:0.25, smW:0.12, psW:0.15, xAW:0.08, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.015 },
  { id:'V3',  xGW:0.32, xGOTW:0.27, smW:0.12, psW:0.14, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.055, pace:0.010 },
  { id:'V4',  xGW:0.25, xGOTW:0.32, smW:0.13, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.070, pace:0.018 },
  { id:'V5',  xGW:0.28, xGOTW:0.25, smW:0.13, psW:0.20, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.014 },
  { id:'V6',  xGW:0.22, xGOTW:0.28, smW:0.18, psW:0.15, xAW:0.10, spW:0.07, possW:0.03, convW:0.05, rho:0.060, pace:0.012 },
  { id:'V7',  xGW:0.40, xGOTW:0.22, smW:0.10, psW:0.15, xAW:0.08, spW:0.05, possW:0.03, convW:0.05, rho:0.055, pace:0.010 },
  { id:'V8',  xGW:0.30, xGOTW:0.30, smW:0.10, psW:0.18, xAW:0.07, spW:0.05, possW:0.03, convW:0.05, rho:0.070, pace:0.016 },
  { id:'V9',  xGW:0.33, xGOTW:0.26, smW:0.13, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.013 },
  { id:'V10', xGW:0.27, xGOTW:0.30, smW:0.13, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.060, pace:0.011 },
  { id:'V11', xGW:0.25, xGOTW:0.35, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.058, pace:0.012 },
  { id:'V12', xGW:0.28, xGOTW:0.32, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.062, pace:0.014 },
  { id:'V13', xGW:0.23, xGOTW:0.35, smW:0.12, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.065, pace:0.015 },
  { id:'V14', xGW:0.26, xGOTW:0.30, smW:0.14, psW:0.14, xAW:0.10, spW:0.06, possW:0.03, convW:0.05, rho:0.068, pace:0.017 },
  { id:'V15', xGW:0.30, xGOTW:0.30, smW:0.10, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.060, pace:0.012 },
  { id:'V16', xGW:0.25, xGOTW:0.33, smW:0.12, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.072, pace:0.019 },
  { id:'V17', xGW:0.28, xGOTW:0.28, smW:0.15, psW:0.14, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.052, pace:0.010 },
  { id:'V18', xGW:0.32, xGOTW:0.28, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.063, pace:0.013 },
  { id:'V19', xGW:0.29, xGOTW:0.29, smW:0.13, psW:0.15, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.058, pace:0.011 },
  { id:'V20', xGW:0.24, xGOTW:0.34, smW:0.12, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.064, pace:0.014 },
  { id:'V21', xGW:0.27, xGOTW:0.33, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.066, pace:0.015 },
  { id:'V22', xGW:0.31, xGOTW:0.29, smW:0.12, psW:0.14, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.057, pace:0.011 },
  { id:'V23', xGW:0.26, xGOTW:0.31, smW:0.13, psW:0.16, xAW:0.09, spW:0.05, possW:0.03, convW:0.05, rho:0.070, pace:0.016 },
  { id:'V24', xGW:0.29, xGOTW:0.30, smW:0.12, psW:0.16, xAW:0.08, spW:0.05, possW:0.03, convW:0.05, rho:0.061, pace:0.012 },
  { id:'V25', xGW:0.24, xGOTW:0.33, smW:0.13, psW:0.15, xAW:0.10, spW:0.05, possW:0.03, convW:0.05, rho:0.067, pace:0.015 },
];

// ══════════════════════════════════════════════════════════════════════════════
// BACKTEST MATCHES — ALL 16 COMPLETED R32 (073-088)
// ══════════════════════════════════════════════════════════════════════════════
const BACKTEST_MATCHES = [
  { fid:'wc26-r32-073', home:'RSA', away:'CAN', homeScore:0, awayScore:1 },
  { fid:'wc26-r32-074', home:'BRA', away:'JPN', homeScore:2, awayScore:1 },
  { fid:'wc26-r32-075', home:'GER', away:'PAR', homeScore:1, awayScore:1 },
  { fid:'wc26-r32-076', home:'NED', away:'MAR', homeScore:1, awayScore:1 },
  { fid:'wc26-r32-077', home:'CIV', away:'NOR', homeScore:1, awayScore:2 },
  { fid:'wc26-r32-078', home:'FRA', away:'SWE', homeScore:3, awayScore:0 },
  { fid:'wc26-r32-079', home:'MEX', away:'ECU', homeScore:2, awayScore:0 },
  { fid:'wc26-r32-080', home:'ENG', away:'COD', homeScore:2, awayScore:1 },
  { fid:'wc26-r32-081', home:'BEL', away:'SEN', homeScore:3, awayScore:2 },
  { fid:'wc26-r32-082', home:'USA', away:'BIH', homeScore:2, awayScore:0 },
  { fid:'wc26-r32-083', home:'ESP', away:'AUT', homeScore:3, awayScore:0 },
  { fid:'wc26-r32-084', home:'POR', away:'CRO', homeScore:2, awayScore:1 },
  { fid:'wc26-r32-085', home:'SUI', away:'ALG', homeScore:2, awayScore:0 },
  { fid:'wc26-r32-086', home:'AUS', away:'EGY', homeScore:1, awayScore:1 },
  { fid:'wc26-r32-087', home:'ARG', away:'CPV', homeScore:3, awayScore:2 },
  { fid:'wc26-r32-088', home:'COL', away:'GHA', homeScore:1, awayScore:0 },
  // Jul 5 R16 results (added for v20 backtest)
  { fid:'wc26-r16-091', home:'BRA', away:'NOR', homeScore:1, awayScore:2 },
  { fid:'wc26-r16-092', home:'MEX', away:'ENG', homeScore:2, awayScore:3 },
  // Jul 6-7 R16 results (added for v22 backtest)
  { fid:'wc26-r16-089', home:'PAR', away:'FRA', homeScore:0, awayScore:1 },
  { fid:'wc26-r16-090', home:'CAN', away:'MAR', homeScore:0, awayScore:3 },
  { fid:'wc26-r16-093', home:'POR', away:'ESP', homeScore:0, awayScore:1 },
  { fid:'wc26-r16-094', home:'USA', away:'BEL', homeScore:1, awayScore:4 },
  // Jul 7 R16 results (added for v23 backtest — wc2026_matches via CI probe):
  // 095 ARG 3-2 EGY (FT) | 096 SUI 0-0 COL (FT_PEN — 0-0 through 120', graded
  // as a 90-minute draw, same convention as prior ET/pens backtest entries)
  { fid:'wc26-r16-095', home:'ARG', away:'EGY', homeScore:3, awayScore:2 },
  { fid:'wc26-r16-096', home:'SUI', away:'COL', homeScore:0, awayScore:0 },
];

const ESPN_TEAM_IDS = {
  'BRA': 205, 'NOR': 464, 'MEX': 203, 'ENG': 448,
  'PAR': 210, 'FRA': 478, 'CAN': 206, 'MAR': 2869,
  'AUS': 220,   'EGY': 2620, 'ARG': 202, 'CPV': 2851,
  'COL': 207, 'GHA': 2849, 'RSA': 2862, 'JPN': 7850,
  'GER': 481, 'NED': 487, 'CIV': 2848, 'SWE': 497,
  'ECU': 2166, 'COD': 2850, 'BEL': 459, 'SEN': 654,
  'USA': 660, 'BIH': 452, 'ESP': 164, 'AUT': 474,
  'POR': 482, 'CRO': 477, 'SUI': 2847, 'ALG': 2833,
};

// July 15 SF match to project. Carries the metadata the Phase-7 write needs so
// nothing is hardcoded to a single fixture: espnId (xG join / row), beId+beSlug
// (BetExplorer event id + slug written to bet_explorer_* columns), espnSlug
// (espn_slug column — the real ESPN URL slug, used only for the ESPN link, NOT
// for orientation), and homeId/awayId (lowercase wc2026_matches team ids used to
// repair any lingering 'tbd' slots before the odds write).
//
// ORIENTATION (advancement-map verified, wc2026BracketScraper ADVANCEMENT):
//   760512 (QF-099/M99 winner  = ENG) → 760515 (SF-102/M102) HOME = England
//   760513 (QF-100/M100 winner = ARG) → 760515 (SF-102/M102) AWAY = Argentina
// BetExplorer 'england-argentina' (ENG home) and the owner to-advance both agree.
// The ESPN URL slug 'argentina-england' is text ordering only. A live
// wc2026_matches orientation assertion (Phase 6) hard-fails if the DB disagrees,
// so a flip can never be silently written.
const PROJECTION_MATCHES = [
  // seedDatePT = the PACIFIC-TIME calendar day of kickoff (the app's seeding-day
  // rule); the kickoff TIME is displayed in ET. SF-102 is July 15 in PT. The
  // match_date repair only fires if the seeded DATE differs from seedDatePT, so
  // this is a safe no-op when the bracket already bucketed it on Jul 15.
  //   Venue: NOT repaired here (venueCityLike omitted) — the seeded venue is
  //   left untouched to avoid hardcoding an unverified stadium (zero-hallucination).
  { fid:'wc26-sf-102', home:'ENG', away:'ARG', espnId:'760515',
    beId:'pKVyGJbD', beSlug:'england-argentina', espnSlug:'argentina-england',
    homeId:'eng', awayId:'arg', venueCityLike:null, seedDatePT:'2026-07-15' },
];

// bet365 book odds for SF-102 (ENG home vs ARG away). The six BetExplorer
// markets (1x2, DC, BTTS, OU, AH) are filled from the CI probe
// wc-jul15-probe.yml, which reuses the production scraper's own
// parse_*/_select_primary_* functions against event pKVyGJbD (slug
// england-argentina). Advance (to-qualify) odds are NOT offered on BetExplorer,
// so bookHomeAdv/bookAwayAdv are the owner-provided "To Advance" (to-final)
// market — hardcoded below once the owner supplies them. The model computes its
// own to-advance odds independently (model_*_to_advance), so the feed shows both
// book and model advance prices.
//
// The six BetExplorer values and the two to-advance values below are placeholders
// (null) until the probe runs and the owner provides the advance line; the
// projection loop hard-fails if any is still null, so the engine can never model
// or publish against a placeholder book (zero-oversight).
const JUL15_BOOK = {
  'wc26-sf-102': {   // ENG (home) vs ARG (away)
    // ── 6 BetExplorer markets — FILL FROM wc-jul15-probe.yml OUTPUT ──
    bookHomeMl: null, bookDraw: null, bookAwayMl: null,
    bookSpread: null, bookTotal: null,
    bookOver: null, bookUnder: null,
    bookBttsY: null, bookBttsN: null,
    bookHomeWD: null, bookAwayWD: null, bookNoDraw: null,
    bookHomeSpreadOdds: null, bookAwaySpreadOdds: null,
    // ── To-advance (owner-provided; BetExplorer doesn't carry it) ──
    // FILL with the owner's ENG (home) / ARG (away) to-final lines.
    bookHomeAdv: null, bookAwayAdv: null,
  },
};

// Frozen book odds for backtest (same as Jul 4 engine)
const BACKTEST_BOOK = {
  'wc26-r32-073': { bookHomeMl:475, bookDraw:265, bookAwayMl:-145, bookSpread:1.5, bookTotal:2.5, bookOver:125, bookUnder:-155, bookBttsY:110, bookBttsN:-140 },
  'wc26-r32-074': { bookHomeMl:-140, bookDraw:270, bookAwayMl:425, bookSpread:-1.5, bookTotal:2.5, bookOver:-130, bookUnder:105, bookBttsY:-105, bookBttsN:-120 },
  'wc26-r32-075': { bookHomeMl:-275, bookDraw:400, bookAwayMl:800, bookSpread:-1.5, bookTotal:2.5, bookOver:-140, bookUnder:110, bookBttsY:100, bookBttsN:-130 },
  'wc26-r32-076': { bookHomeMl:130, bookDraw:210, bookAwayMl:250, bookSpread:-0.5, bookTotal:2.5, bookOver:120, bookUnder:-150, bookBttsY:-145, bookBttsN:110 },
  'wc26-r32-077': { bookHomeMl:255, bookDraw:115, bookAwayMl:240, bookSpread:0.5, bookTotal:2.5, bookOver:-115, bookUnder:-105, bookBttsY:-150, bookBttsN:120 },
  'wc26-r32-078': { bookHomeMl:-340, bookDraw:900, bookAwayMl:475, bookSpread:-1.5, bookTotal:3.5, bookOver:115, bookUnder:-145, bookBttsY:-135, bookBttsN:105 },
  'wc26-r32-079': { bookHomeMl:130, bookDraw:285, bookAwayMl:190, bookSpread:-0.5, bookTotal:1.5, bookOver:-170, bookUnder:135, bookBttsY:120, bookBttsN:-155 },
  'wc26-r32-080': { bookHomeMl:-345, bookDraw:400, bookAwayMl:1100, bookSpread:-1.5, bookTotal:2.5, bookOver:103, bookUnder:-120, bookBttsY:163, bookBttsN:-227 },
  'wc26-r32-081': { bookHomeMl:115, bookDraw:220, bookAwayMl:270, bookSpread:-0.5, bookTotal:2.5, bookOver:100, bookUnder:-118, bookBttsY:-133, bookBttsN:100 },
  'wc26-r32-082': { bookHomeMl:-250, bookDraw:400, bookAwayMl:600, bookSpread:-1.5, bookTotal:2.5, bookOver:-137, bookUnder:110, bookBttsY:-105, bookBttsN:-125 },
  'wc26-r32-083': { bookHomeMl:-303, bookDraw:425, bookAwayMl:750, bookSpread:-1.5, bookTotal:2.5, bookOver:-125, bookUnder:100, bookBttsY:120, bookBttsN:-161 },
  'wc26-r32-084': { bookHomeMl:-133, bookDraw:250, bookAwayMl:400, bookSpread:-1.5, bookTotal:2.5, bookOver:110, bookUnder:-137, bookBttsY:-105, bookBttsN:-125 },
  'wc26-r32-085': { bookHomeMl:100, bookDraw:220, bookAwayMl:320, bookSpread:-0.5, bookTotal:2.5, bookOver:110, bookUnder:-137, bookBttsY:-110, bookBttsN:-110 },
  'wc26-r32-086': { bookHomeMl:230, bookDraw:190, bookAwayMl:145, bookSpread:0, bookTotal:1.5, bookOver:-175, bookUnder:138, bookBttsY:120, bookBttsN:-161 },
  'wc26-r32-087': { bookHomeMl:-714, bookDraw:700, bookAwayMl:1800, bookSpread:-1.5, bookTotal:2.5, bookOver:-149, bookUnder:120, bookBttsY:175, bookBttsN:-250 },
  'wc26-r32-088': { bookHomeMl:-200, bookDraw:300, bookAwayMl:650, bookSpread:-1.5, bookTotal:2.5, bookOver:120, bookUnder:-149, bookBttsY:125, bookBttsN:-175 },
  // Jul 5 R16 (added for v20 backtest)
  'wc26-r16-091': { bookHomeMl:-133, bookDraw:270, bookAwayMl:375, bookSpread:-1.5, bookTotal:2.5, bookOver:-137, bookUnder:110, bookBttsY:-149, bookBttsN:110 },
  'wc26-r16-092': { bookHomeMl:200, bookDraw:220, bookAwayMl:145, bookSpread:-0.5, bookTotal:2.5, bookOver:138, bookUnder:-175, bookBttsY:100, bookBttsN:-133 },
  // Jul 6-7 R16 (added for v22 backtest)
  'wc26-r16-089': { bookHomeMl:1600, bookDraw:600, bookAwayMl:-588, bookSpread:-1.5, bookTotal:2.5, bookOver:-161, bookUnder:130, bookBttsY:138, bookBttsN:-189 },
  'wc26-r16-090': { bookHomeMl:400, bookDraw:225, bookAwayMl:-120, bookSpread:-0.5, bookTotal:2.5, bookOver:130, bookUnder:-161, bookBttsY:105, bookBttsN:-143 },
  'wc26-r16-093': { bookHomeMl:290, bookDraw:250, bookAwayMl:-105, bookSpread:0, bookTotal:2.5, bookOver:-125, bookUnder:100, bookBttsY:-149, bookBttsN:110 },
  'wc26-r16-094': { bookHomeMl:150, bookDraw:240, bookAwayMl:175, bookSpread:0, bookTotal:2.5, bookOver:-149, bookUnder:120, bookBttsY:-189, bookBttsN:138 },
  // Jul 7 R16 (added for v23 backtest — frozen v22 book, scraped 2026-07-07 ~16:30 UTC)
  'wc26-r16-095': { bookHomeMl:-303, bookDraw:375, bookAwayMl:1000, bookSpread:-1.5, bookTotal:2.5, bookOver:-102, bookUnder:-114, bookBttsY:150, bookBttsN:-200 },
  'wc26-r16-096': { bookHomeMl:250, bookDraw:210, bookAwayMl:125, bookSpread:0.5, bookTotal:2.5, bookOver:130, bookUnder:-161, bookBttsY:-105, bookBttsN:-125 },
};

// ══════════════════════════════════════════════════════════════════════════════
// LAMBDA COMPUTATION
// ══════════════════════════════════════════════════════════════════════════════
function buildGSRows(teamCode, xgAll, tsAll, msAll) {
  const rows = xgAll.filter(r => r.homeTeamAbbrev===teamCode || r.awayTeamAbbrev===teamCode);
  return rows.map(r => {
    const side = r.homeTeamAbbrev===teamCode ? 'home' : 'away';
    const tsRow = tsAll.find(t => t.espn_match_id===r.espn_match_id);
    if (!tsRow) return null;
    const possRaw = side==='home' ? tsRow.possession : tsRow.possessionAway;
    const poss = parseFloat(String(possRaw??'').replace('%',''));
    if (isNaN(poss)) return null;
    const msRow = msAll.find(m => m.espn_match_id===r.espn_match_id);
    if (!msRow) return null;
    const sot = side==='home' ? msRow.homeShotsOnGoal : msRow.awayShotsOnGoal;
    const shots = side==='home' ? msRow.homeShots : msRow.awayShots;
    return {
      espn_match_id: r.espn_match_id, side,
      xG: parseFloat(side==='home'?r.homeXG:r.awayXG),
      xGOT: parseFloat(side==='home'?r.homeXGOT:r.awayXGOT),
      xA: parseFloat(side==='home'?(r.homeXA||0):(r.awayXA||0)),
      poss, sot: Number(sot), shots: Number(shots),
    };
  }).filter(Boolean);
}

function computeLambda(teamCode, gsRows, psAll, smAll, v) {
  if (gsRows.length===0) hardFail(`${teamCode}: no GS rows`);
  const avgXG   = gsRows.reduce((s,r)=>s+r.xG,0)/gsRows.length;
  const avgXGOT = gsRows.reduce((s,r)=>s+r.xGOT,0)/gsRows.length;
  const avgXA   = gsRows.reduce((s,r)=>s+(r.xA||0),0)/gsRows.length;
  const avgPoss = gsRows.reduce((s,r)=>s+r.poss,0)/gsRows.length;
  const avgSOT  = gsRows.reduce((s,r)=>s+r.sot,0)/gsRows.length;
  const avgShots= gsRows.reduce((s,r)=>s+r.shots,0)/gsRows.length;
  const smRows = smAll.filter(r => gsRows.some(g=>g.espn_match_id===r.espn_match_id) && r.teamAbbrev===teamCode);
  const avgSmXG = smRows.length>0 ? smRows.reduce((s,r)=>s+(parseFloat(r.shotXG)||0),0)/smRows.length : avgXG;
  const avgSmXGOT = smRows.length>0 ? smRows.reduce((s,r)=>s+(parseFloat(r.shotXGOT)||0),0)/smRows.length : avgXGOT;
  const psRows = psAll.filter(r => gsRows.some(g=>g.espn_match_id===r.espn_match_id) && r.teamAbbrev===teamCode);
  const avgPsXG = psRows.length>0 ? psRows.reduce((s,r)=>s+(parseFloat(r.pXG)||0),0)/psRows.length : avgXG;
  const convRate = avgShots>0 ? avgSOT/avgShots : 0.35;
  const possAdj = 1 + v.possW * ((avgPoss-50)/50);
  const lambdaRaw = v.xGW*avgXG + v.xGOTW*avgXGOT + v.smW*avgSmXG + v.psW*avgPsXG + v.xAW*avgXA + v.spW*avgSmXGOT;
  const tierMult = TIER_MULTIPLIER[teamCode] || 1.0;
  const lambda = lambdaRaw * possAdj * (1 + v.convW*(convRate-0.35)) * (1 - v.pace) * tierMult;
  return { lambda, avgXG, avgXGOT, avgXA, avgPoss, avgSOT, avgShots, convRate, tierMult };
}

// ══════════════════════════════════════════════════════════════════════════════
// 500X BACKTEST GRADING WITH CORRECT SCORE
// ══════════════════════════════════════════════════════════════════════════════
function gradeBacktest500X(results) {
  let dirOk=0, spreadOk=0, totalOk=0, bttsOk=0;
  let correctScoreSum=0, correctScoreRankSum=0;
  const perMatch = [];
  
  for (const r of results) {
    const { match, markets, joint } = r;
    const actualDir = match.homeScore>match.awayScore?'H':match.homeScore<match.awayScore?'A':'D';
    const modelDir = markets.pH>markets.pA?'H':markets.pA>markets.pH?'A':'D';
    const dOk = actualDir===modelDir || (actualDir==='D' && markets.pD>0.2);
    if (dOk) dirOk++;
    
    const actualTotal = match.homeScore+match.awayScore;
    const book = BACKTEST_BOOK[match.fid];
    const totalLine = book ? book.bookTotal : 2.5;
    const tOk = (actualTotal>totalLine && markets.pOver>0.5) || (actualTotal<=totalLine && markets.pUnder>=0.5);
    if (tOk) totalOk++;
    
    const spreadLine = book ? book.bookSpread : 1.5;
    const margin = match.homeScore - match.awayScore;
    let sOk;
    if (Math.abs(spreadLine) % 1 !== 0) {
      sOk = (margin > -spreadLine && markets.pHomeSpread>0.5) || (margin < -spreadLine && markets.pAwaySpread>0.5);
    } else {
      sOk = (margin > -spreadLine && markets.pHomeSpread>0.5) || (margin < -spreadLine && markets.pAwaySpread>0.5) || (Math.abs(margin+spreadLine)<0.01);
    }
    if (sOk) spreadOk++;
    
    const actualBTTS = match.homeScore>0 && match.awayScore>0;
    const bOk = (actualBTTS && markets.pBTTS>0.5) || (!actualBTTS && markets.pBTTS<=0.5);
    if (bOk) bttsOk++;
    
    const csGrade = correctScoreGrade(joint, match.homeScore, match.awayScore);
    correctScoreSum += csGrade.prob;
    correctScoreRankSum += csGrade.rank;
    
    perMatch.push({ fid:match.fid, home:match.home, away:match.away, score:`${match.homeScore}-${match.awayScore}`, actualDir, modelDir, dOk, tOk, sOk, bOk, csProb:csGrade.prob, csRank:csGrade.rank, topScore:csGrade.topScore, topProb:csGrade.topProb });
  }
  
  const n = results.length;
  const composite = 45*(dirOk/n) + 30*(totalOk/n) + 15*(spreadOk/n) + 10*(bttsOk/n);
  const avgCSProb = correctScoreSum/n;
  const avgCSRank = correctScoreRankSum/n;
  
  return { dirOk, totalOk, spreadOk, bttsOk, n, composite, perMatch,
    dirPct:dirOk/n, totalPct:totalOk/n, spreadPct:spreadOk/n, bttsPct:bttsOk/n,
    avgCSProb, avgCSRank };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  fs.appendFileSync(LOG_FILE, `\n${'═'.repeat(100)}\n  v26 JUL15 ENGINE SESSION: ${SESSION_ID}\n  STARTED: ${new Date().toISOString()}\n${'═'.repeat(100)}\n`);
  banner(`WC2026 ${ENGINE_VERSION} — 500X BACKTEST → CORRECT SCORE → RECALIBRATION → REINFORCEMENT → JUL 15 SF PROJECTION`);
  log('INPUT', `Engine: ${ENGINE_VERSION}`);
  log('INPUT', `Session: ${SESSION_ID}`);
  log('INPUT', `Backtest: ${BACKTEST_MATCHES.length} matches | Variations: ${VARIATIONS.length} | Projection: ${PROJECTION_MATCHES.length} matches`);
  log('INPUT', `Scoring: Dir=45% Total=30% Spread=15% BTTS=10% + Correct Score overlay`);
  log('INPUT', `Book source: BetExplorer bet365 (scraped 2026-07-15 via CI odds probe wc-jul15-probe.yml)`);
  log('STEP', `Pipeline: DATA → 500X BACKTEST → CORRECT SCORE GRADE → RECALIBRATION → 25 VARIATIONS → REINFORCEMENT → MODEL → AUDIT → DB`);

  // TiDB Serverless mandates TLS; the migration-cluster URL also carries no
  // default schema, so resolve the schema that holds the wc2026 tables.
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  log('PASS', 'Database connection established (TLS)');
  const [[dbRow]] = await conn.query('SELECT DATABASE() AS db');
  const CANDIDATE_SCHEMAS = ['9w3eZzSJhkkc5sJ763dXxA', 'MW3FicTy7ae3qrm8dx8Lua', 'ZTNf5uThCjBDEX2kNSs593', 'mLJ3UFRGiMBjj6Ve3qzhT4'];
  let wcSchema = null;
  for (const sName of (dbRow.db ? [dbRow.db, ...CANDIDATE_SCHEMAS] : CANDIDATE_SCHEMAS)) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'wc2026_matches'`, [sName]);
    if (rows[0].n > 0) { wcSchema = sName; break; }
  }
  if (!wcSchema) hardFail('wc2026 schema not found on this cluster');
  await conn.query(`USE \`${wcSchema}\``);
  log('PASS', `wc2026 schema resolved: ${wcSchema}`);
  const DRY_RUN = process.env.DRY_RUN === '1';
  log(DRY_RUN ? 'WARN' : 'STATE', `DRY_RUN=${DRY_RUN ? '1 — Phase 7 DB writes will be SKIPPED' : '0 — Phase 7 will write to DB'}`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: PULL ESPN DATA
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 1/7 — PULL ESPN DATA (GROUP STAGE + R32)');
  const allTeams = [...new Set([
    ...BACKTEST_MATCHES.flatMap(m=>[m.home,m.away]),
    ...PROJECTION_MATCHES.flatMap(m=>[m.home,m.away]),
  ])];
  log('INPUT', `Teams: ${allTeams.join(', ')} (${allTeams.length} total)`);

  const [xgAll] = await conn.query(`
    SELECT espn_match_id, matchRound, homeTeamAbbrev, awayTeamAbbrev, homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
    FROM wc2026_espn_expected_goals
    WHERE (homeTeamAbbrev IN (${allTeams.map(()=>'?').join(',')}) OR awayTeamAbbrev IN (${allTeams.map(()=>'?').join(',')}))
    AND homeXG IS NOT NULL ORDER BY espn_match_id ASC
  `, [...allTeams, ...allTeams]);
  log('PASS', `xG data: ${xgAll.length} rows loaded`);
  if (xgAll.length===0) hardFail('NO xG DATA — cannot proceed');

  const xgMatchIds = [...new Set(xgAll.map(r=>r.espn_match_id))];
  log('STATE', `Unique match IDs in xG data: ${xgMatchIds.length}`);

  const [tsAll] = await conn.query(`
    SELECT espn_match_id, possession, possessionAway FROM wc2026_espn_team_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) ORDER BY espn_match_id
  `, xgMatchIds);
  log('PASS', `Team stats: ${tsAll.length} rows loaded`);

  const [msAll] = await conn.query(`
    SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev, homeShots, awayShots, homeShotsOnGoal, awayShotsOnGoal
    FROM wc2026_espn_match_stats WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) AND homeShots IS NOT NULL
    ORDER BY espn_match_id
  `, xgMatchIds);
  log('PASS', `Match stats: ${msAll.length} rows loaded`);

  const [psAll] = await conn.query(`
    SELECT espn_match_id, teamAbbrev, SUM(xG) as pXG, SUM(xA) as pXA, SUM(sog) as pSOG, SUM(xGOTC) as pXGOT
    FROM wc2026_espn_player_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) AND teamAbbrev IN (${allTeams.map(()=>'?').join(',')})
    GROUP BY espn_match_id, teamAbbrev ORDER BY espn_match_id
  `, [...xgMatchIds, ...allTeams]);
  log('PASS', `Player stats: ${psAll.length} rows loaded`);

  const [smAll] = await conn.query(`
    SELECT espn_match_id, teamAbbrev, AVG(xg) as shotXG, AVG(xgot) as shotXGOT
    FROM wc2026_espn_shot_map
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) AND teamAbbrev IN (${allTeams.map(()=>'?').join(',')})
    GROUP BY espn_match_id, teamAbbrev ORDER BY espn_match_id
  `, [...xgMatchIds, ...allTeams]);
  log('PASS', `Shot map: ${smAll.length} rows loaded`);

  // Validate data completeness
  let dataGaps = 0;
  for (const team of allTeams) {
    const teamXG = xgAll.filter(r => r.homeTeamAbbrev===team || r.awayTeamAbbrev===team);
    if (teamXG.length === 0) { log('WARN', `${team}: ZERO xG rows — will skip in backtest`); dataGaps++; }
    else { log('STATE', `${team}: ${teamXG.length} xG rows available`); }
  }
  log(dataGaps>0?'WARN':'PASS', `Data completeness check: ${allTeams.length-dataGaps}/${allTeams.length} teams have data (${dataGaps} gaps)`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: 500X BACKTEST (25 VARIATIONS × 16 MATCHES)
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 2/7 — 500X BACKTEST (25 VARIATIONS × 16 MATCHES = 400 MODEL RUNS)');
  const btResultsByVariation = {};
  let bestVariation = null, bestComposite = -1;
  let variationCount = 0;

  for (const v of VARIATIONS) {
    variationCount++;
    const results = [];
    let skipCount = 0;
    for (const match of BACKTEST_MATCHES) {
      try {
        const gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
        const gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
        if (gsH.length===0 || gsA.length===0) { skipCount++; continue; }
        const lH = computeLambda(match.home, gsH, psAll, smAll, v);
        const lA = computeLambda(match.away, gsA, psAll, smAll, v);
        const book = BACKTEST_BOOK[match.fid];
        const spreadLine = book ? book.bookSpread : 1.5;
        const joint = buildJointMatrix(lH.lambda, lA.lambda, v.rho);
        const markets = deriveAllMarkets(joint, lH.lambda, lA.lambda, spreadLine);
        results.push({ match, lambdaH:lH.lambda, lambdaA:lA.lambda, markets, joint });
      } catch(e) { skipCount++; }
    }
    const grade = gradeBacktest500X(results);
    btResultsByVariation[v.id] = { grade, results, skipCount, variation: v };
    if (grade.composite > bestComposite) { bestComposite = grade.composite; bestVariation = v; }
    
    log('BACKTEST', `${v.id} [${variationCount}/25]: composite=${grade.composite.toFixed(1)} | Dir=${grade.dirOk}/${grade.n} Tot=${grade.totalOk}/${grade.n} Spr=${grade.spreadOk}/${grade.n} BTTS=${grade.bttsOk}/${grade.n} | CS_avg_prob=${(grade.avgCSProb*100).toFixed(2)}% CS_avg_rank=${grade.avgCSRank.toFixed(1)} | Skip=${skipCount}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3: CORRECT SCORE OUTCOME GRADE
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 3/7 — CORRECT SCORE OUTCOME GRADE (BEST VARIATION)');
  const bestData = btResultsByVariation[bestVariation.id];
  log('GRADE', `Best Variation: ${bestVariation.id} | Composite: ${bestComposite.toFixed(1)}`);
  log('GRADE', `Parameters: xGW=${bestVariation.xGW} xGOTW=${bestVariation.xGOTW} smW=${bestVariation.smW} psW=${bestVariation.psW} xAW=${bestVariation.xAW} rho=${bestVariation.rho} pace=${bestVariation.pace}`);
  
  log('SCORE', `┌─────────────────────────────────────────────────────────────────────────────────────────────┐`);
  log('SCORE', `│  CORRECT SCORE ASSESSMENT — ${bestVariation.id} (${bestData.grade.n} matches)                                     │`);
  log('SCORE', `├────────────┬──────────┬──────────┬──────────┬────────┬────────┬────────┬────────┬──────────┤`);
  log('SCORE', `│ Match      │ Score    │ CS Prob  │ CS Rank  │ Top    │ Dir    │ Total  │ Spread │ BTTS     │`);
  log('SCORE', `├────────────┼──────────┼──────────┼──────────┼────────┼────────┼────────┼────────┼──────────┤`);
  
  for (const pm of bestData.grade.perMatch) {
    log('SCORE', `│ ${pm.fid.slice(-3)} ${pm.home.padEnd(3)}-${pm.away.padEnd(3)} │ ${pm.score.padEnd(8)} │ ${(pm.csProb*100).toFixed(2).padStart(6)}%  │ #${String(pm.csRank).padStart(2)}/100  │ ${pm.topScore.padEnd(6)} │ ${pm.dOk?'✅':'❌'}      │ ${pm.tOk?'✅':'❌'}      │ ${pm.sOk?'✅':'❌'}      │ ${pm.bOk?'✅':'❌'}        │`);
  }
  
  log('SCORE', `├────────────┴──────────┴──────────┴──────────┴────────┴────────┴────────┴────────┴──────────┤`);
  log('SCORE', `│ TOTALS: Dir=${bestData.grade.dirOk}/${bestData.grade.n} Total=${bestData.grade.totalOk}/${bestData.grade.n} Spread=${bestData.grade.spreadOk}/${bestData.grade.n} BTTS=${bestData.grade.bttsOk}/${bestData.grade.n} | AvgCSProb=${(bestData.grade.avgCSProb*100).toFixed(2)}% AvgCSRank=#${bestData.grade.avgCSRank.toFixed(1)} │`);
  log('SCORE', `└──────────────────────────────────────────────────────────────────────────────────────────────┘`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 4: RECALIBRATION
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 4/7 — RECALIBRATION FROM BACKTEST RESULTS');
  
  const sorted = Object.entries(btResultsByVariation).sort((a,b)=>b[1].grade.composite-a[1].grade.composite);
  log('RECAL', `TOP 5 VARIATIONS:`);
  for (let i=0; i<5; i++) {
    const [vid, data] = sorted[i];
    const g = data.grade;
    log('RECAL', `  #${i+1} ${vid}: composite=${g.composite.toFixed(1)} | Dir=${pct(g.dirPct)} Tot=${pct(g.totalPct)} Spr=${pct(g.spreadPct)} BTTS=${pct(g.bttsPct)} | CS=${(g.avgCSProb*100).toFixed(2)}%`);
  }
  log('RECAL', `BOTTOM 5 VARIATIONS:`);
  for (let i=sorted.length-5; i<sorted.length; i++) {
    const [vid, data] = sorted[i];
    const g = data.grade;
    log('RECAL', `  #${i+1} ${vid}: composite=${g.composite.toFixed(1)} | Dir=${pct(g.dirPct)} Tot=${pct(g.totalPct)} Spr=${pct(g.spreadPct)} BTTS=${pct(g.bttsPct)} | CS=${(g.avgCSProb*100).toFixed(2)}%`);
  }
  
  const top3 = sorted.slice(0,3).map(([vid,data])=>data.variation);
  const recalParams = {};
  for (const key of Object.keys(top3[0])) {
    if (key==='id') continue;
    recalParams[key] = top3.reduce((s,v)=>s+v[key],0)/3;
  }
  recalParams.id = 'RECAL';
  log('RECAL', `Recalibrated params (avg of top-3): xGW=${recalParams.xGW.toFixed(4)} xGOTW=${recalParams.xGOTW.toFixed(4)} smW=${recalParams.smW.toFixed(4)} psW=${recalParams.psW.toFixed(4)} rho=${recalParams.rho.toFixed(4)} pace=${recalParams.pace.toFixed(4)}`);

  const recalResults = [];
  for (const match of BACKTEST_MATCHES) {
    try {
      const gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
      const gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
      if (gsH.length===0 || gsA.length===0) continue;
      const lH = computeLambda(match.home, gsH, psAll, smAll, recalParams);
      const lA = computeLambda(match.away, gsA, psAll, smAll, recalParams);
      const book = BACKTEST_BOOK[match.fid];
      const spreadLine = book ? book.bookSpread : 1.5;
      const joint = buildJointMatrix(lH.lambda, lA.lambda, recalParams.rho);
      const markets = deriveAllMarkets(joint, lH.lambda, lA.lambda, spreadLine);
      recalResults.push({ match, lambdaH:lH.lambda, lambdaA:lA.lambda, markets, joint });
    } catch(e) {}
  }
  const recalGrade = gradeBacktest500X(recalResults);
  log('RECAL', `RECALIBRATED RESULT: composite=${recalGrade.composite.toFixed(1)} | Dir=${recalGrade.dirOk}/${recalGrade.n} Tot=${recalGrade.totalOk}/${recalGrade.n} Spr=${recalGrade.spreadOk}/${recalGrade.n} BTTS=${recalGrade.bttsOk}/${recalGrade.n} | CS=${(recalGrade.avgCSProb*100).toFixed(2)}%`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 5: REINFORCEMENT — LOCK OPTIMAL PARAMETERS
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 5/7 — REINFORCEMENT: SELECT FINAL PARAMETERS');
  
  let finalVariation, finalComposite, finalGrade;
  if (recalGrade.composite > bestComposite) {
    finalVariation = recalParams;
    finalComposite = recalGrade.composite;
    finalGrade = recalGrade;
    log('REINF', `🔒 LOCKED: RECALIBRATED params (composite=${recalGrade.composite.toFixed(1)} > ${bestComposite.toFixed(1)})`);
  } else {
    finalVariation = bestVariation;
    finalComposite = bestComposite;
    finalGrade = bestData.grade;
    log('REINF', `🔒 LOCKED: ${bestVariation.id} params (composite=${bestComposite.toFixed(1)} >= recal ${recalGrade.composite.toFixed(1)})`);
  }
  
  log('REINF', `FINAL LOCKED PARAMETERS:`);
  log('REINF', `  xGW=${finalVariation.xGW} xGOTW=${finalVariation.xGOTW} smW=${finalVariation.smW} psW=${finalVariation.psW}`);
  log('REINF', `  xAW=${finalVariation.xAW} spW=${finalVariation.spW} possW=${finalVariation.possW} convW=${finalVariation.convW}`);
  log('REINF', `  rho=${finalVariation.rho} pace=${finalVariation.pace}`);
  log('REINF', `  Backtest: Dir=${finalGrade.dirOk}/${finalGrade.n}(${pct(finalGrade.dirPct)}) Tot=${finalGrade.totalOk}/${finalGrade.n}(${pct(finalGrade.totalPct)}) Spr=${finalGrade.spreadOk}/${finalGrade.n}(${pct(finalGrade.spreadPct)}) BTTS=${finalGrade.bttsOk}/${finalGrade.n}(${pct(finalGrade.bttsPct)})`);
  log('REINF', `  Correct Score: AvgProb=${(finalGrade.avgCSProb*100).toFixed(2)}% AvgRank=#${finalGrade.avgCSRank.toFixed(1)}`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 6: MODEL JULY 15 SF MATCH
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 6/7 — MODEL JULY 15 SF MATCH (FINAL CALIBRATED ENGINE)');
  const projections = [];

  for (const match of PROJECTION_MATCHES) {
    log('PROJ', `${'━'.repeat(80)}`);
    log('PROJ', `${match.fid}: ${match.home} vs ${match.away} (SF — Jul 15, 2026)`);
    log('PROJ', `${'━'.repeat(80)}`);
    
    const gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
    const gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
    log('INPUT', `${match.home}: ${gsH.length} data rows | ${match.away}: ${gsA.length} data rows`);
    if (gsH.length===0) hardFail(`${match.home}: NO data rows`);
    if (gsA.length===0) hardFail(`${match.away}: NO data rows`);

    const lH = computeLambda(match.home, gsH, psAll, smAll, finalVariation);
    const lA = computeLambda(match.away, gsA, psAll, smAll, finalVariation);
    log('LAMBDA', `${match.home}: λ=${fmt(lH.lambda,6)} | xG=${fmt(lH.avgXG)} xGOT=${fmt(lH.avgXGOT)} xA=${fmt(lH.avgXA)} poss=${fmt(lH.avgPoss,1)}% SOT=${fmt(lH.avgSOT,1)} conv=${pct(lH.convRate)} tier=${lH.tierMult}x`);
    log('LAMBDA', `${match.away}: λ=${fmt(lA.lambda,6)} | xG=${fmt(lA.avgXG)} xGOT=${fmt(lA.avgXGOT)} xA=${fmt(lA.avgXA)} poss=${fmt(lA.avgPoss,1)}% SOT=${fmt(lA.avgSOT,1)} conv=${pct(lA.convRate)} tier=${lA.tierMult}x`);

    const book = JUL15_BOOK[match.fid];

    // ── BOOK COMPLETENESS GUARD — refuse to run on an unfilled placeholder book ──
    // The six BetExplorer markets are hand-filled from the wc-jul15-probe.yml
    // output. If any is still null the book block was never filled; hard-fail so
    // the engine can never model/publish against placeholder (missing) book lines.
    {
      const required = ['bookHomeMl','bookDraw','bookAwayMl','bookSpread','bookTotal',
        'bookOver','bookUnder','bookBttsY','bookBttsN','bookHomeWD','bookAwayWD',
        'bookNoDraw','bookHomeSpreadOdds','bookAwaySpreadOdds'];
      const missing = required.filter(k => book[k] == null);
      if (missing.length) hardFail(`${match.fid}: JUL15_BOOK not filled from probe — null: ${missing.join(', ')}. Run wc-jul15-probe.yml and paste the six BetExplorer markets before modeling.`);
      if (book.bookHomeAdv == null || book.bookAwayAdv == null) hardFail(`${match.fid}: to-advance book lines missing (owner-provided ENG (home) / ARG (away) to-final line required)`);
    }

    // ── LIVE ORIENTATION ASSERTION (home/away flip tripwire vs the canonical row) ─
    // The whole pipeline binds odds POSITIONALLY. The intended orientation (ENG
    // home, ARG away) is advancement-map verified, but assert it against the LIVE
    // wc2026_matches row so a bracket-scraper disagreement can never be silently
    // written. 'tbd'/empty slots are allowed (Phase 7 repairs them to homeId/awayId).
    {
      const [[mrow]] = await conn.query(
        `SELECT home_team_id, away_team_id FROM wc2026_matches WHERE match_id = ?`, [match.fid]);
      if (!mrow) hardFail(`${match.fid}: no wc2026_matches row — cannot assert orientation`);
      const h = String(mrow.home_team_id || '').toLowerCase();
      const a = String(mrow.away_team_id || '').toLowerCase();
      log('STATE', `${match.fid}: live wc2026_matches home=${h||'∅'} away=${a||'∅'} (expected home=${match.homeId} away=${match.awayId})`);
      if (h && h !== 'tbd' && h !== match.homeId)
        hardFail(`${match.fid}: LIVE home_team_id='${h}' disagrees with intended home '${match.homeId}' (ENG) — orientation flip; refusing to model/write`);
      if (a && a !== 'tbd' && a !== match.awayId)
        hardFail(`${match.fid}: LIVE away_team_id='${a}' disagrees with intended away '${match.awayId}' (ARG) — orientation flip; refusing to model/write`);
      log('PASS', `${match.fid}: live orientation consistent with ${match.home}(home) vs ${match.away}(away)`);
    }

    const spreadLine = book.bookSpread;
    const joint = buildJointMatrix(lH.lambda, lA.lambda, finalVariation.rho);
    const markets = deriveAllMarkets(joint, lH.lambda, lA.lambda, spreadLine);

    // ── ORIENTATION GUARD (home/away flip tripwire) ──────────────────────────
    // The whole pipeline binds odds POSITIONALLY (bookHomeMl vs bookAwayMl), and
    // the book block is hand-typed — the exact failure mode that made England
    // (the favorite) show underdog prices. A home/away flip reliably surfaces as
    // the BOOK favorite disagreeing with the MODEL favorite. Hard-fail on a real
    // disagreement (>8pp implied-prob gap) so a flipped book can never be written.
    {
      const amToProb = (a) => a == null ? null : (a < 0 ? (-a) / (-a + 100) : 100 / (a + 100));
      const bph = amToProb(book.bookHomeMl), bpa = amToProb(book.bookAwayMl);
      if (bph != null && bpa != null && markets.mlHome != null && markets.mlAway != null) {
        const bookFav = book.bookHomeMl <= book.bookAwayMl ? 'home' : 'away';
        const modelFav = markets.mlHome <= markets.mlAway ? 'home' : 'away';
        const gap = Math.abs(bph - bpa);
        if (bookFav !== modelFav && gap > 0.08) {
          hardFail(`${match.fid}: BOOK favors ${bookFav} (H=${book.bookHomeMl}/A=${book.bookAwayMl}) but MODEL favors ${modelFav} (H=${markets.mlHome}/A=${markets.mlAway}), gap=${(gap*100).toFixed(1)}pp — likely home/away flip; refusing to write`);
        }
        log('PASS', `${match.fid}: book/model favorite agree (${bookFav}), gap=${(gap*100).toFixed(1)}pp`);
      }
    }

    log('MARKET', `──── 1X2 MONEYLINE ────`);
    log('MARKET', `  MODEL: H=${ml(markets.mlHome)}(${pct(markets.pH)}) D=${ml(markets.mlDraw)}(${pct(markets.pD)}) A=${ml(markets.mlAway)}(${pct(markets.pA)})`);
    log('MARKET', `  BOOK:  H=${ml(book.bookHomeMl)} D=${ml(book.bookDraw)} A=${ml(book.bookAwayMl)}`);
    log('MARKET', `──── TO ADVANCE ────`);
    log('MARKET', `  MODEL: H=${ml(markets.mlAdvH)}(${pct(markets.pAdvH)}) A=${ml(markets.mlAdvA)}(${pct(markets.pAdvA)})`);
    log('MARKET', `  BOOK:  H=${ml(book.bookHomeAdv)} A=${ml(book.bookAwayAdv)}`);
    log('MARKET', `──── SPREAD (${spreadLine}) ────`);
    log('MARKET', `  MODEL: H=${ml(markets.mlHomeSpread)}(${pct(markets.pHomeSpread)}) A=${ml(markets.mlAwaySpread)}(${pct(markets.pAwaySpread)})`);
    log('MARKET', `  BOOK:  H=${ml(book.bookHomeSpreadOdds)} A=${ml(book.bookAwaySpreadOdds)}`);
    log('MARKET', `──── TOTAL (O/U 2.5) ────`);
    log('MARKET', `  MODEL: O=${ml(markets.mlOver)}(${pct(markets.pOver)}) U=${ml(markets.mlUnder)}(${pct(markets.pUnder)})`);
    log('MARKET', `  BOOK:  O=${ml(book.bookOver)} U=${ml(book.bookUnder)}`);
    log('MARKET', `──── BTTS ────`);
    log('MARKET', `  MODEL: Y=${ml(markets.mlBTTSY)}(${pct(markets.pBTTS)}) N=${ml(markets.mlBTTSN)}(${pct(1-markets.pBTTS)})`);
    log('MARKET', `  BOOK:  Y=${ml(book.bookBttsY)} N=${ml(book.bookBttsN)}`);
    log('MARKET', `──── DOUBLE CHANCE ────`);
    log('MARKET', `  MODEL: HomeWD=${ml(markets.mlHomeWD)}(${pct(markets.pHomeWD)}) AwayWD=${ml(markets.mlAwayWD)}(${pct(markets.pAwayWD)}) NoDraw=${ml(markets.mlNoDraw)}(${pct(markets.pNoDraw)})`);
    log('MARKET', `  BOOK:  HomeWD=${ml(book.bookHomeWD)} AwayWD=${ml(book.bookAwayWD)} NoDraw=${ml(book.bookNoDraw)}`);
    log('MARKET', `──── PROJECTED SCORE ────`);
    log('MARKET', `  ${match.home} ${fmt(markets.projH,2)} — ${fmt(markets.projA,2)} ${match.away} (Total: ${fmt(markets.projTotal,2)})`);

    // Top 5 correct scores
    log('SCORE', `──── TOP 5 MOST LIKELY SCORES ────`);
    const allScores = [];
    for (let h=0;h<=9;h++) for (let a=0;a<=9;a++) allScores.push({h,a,p:joint[h][a]});
    allScores.sort((a,b)=>b.p-a.p);
    for (let i=0;i<5;i++) {
      log('SCORE', `  #${i+1}: ${match.home} ${allScores[i].h}-${allScores[i].a} ${match.away} (${(allScores[i].p*100).toFixed(2)}%)`);
    }

    projections.push({ match, lambdaH:lH.lambda, lambdaA:lA.lambda, markets, book, lH, lA, joint });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 7: WRITE TO DATABASE + AUDIT
  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE 7/7 — WRITE TO DATABASE + FINAL AUDIT');
  
  if (DRY_RUN) {
    log('WARN', 'DRY_RUN=1 — skipping ALL Phase 7 DB writes and audit (projection output above is the deliverable)');
  }
  for (const proj of DRY_RUN ? [] : projections) {
    const { match, lambdaH, lambdaA, markets, book } = proj;

    // The SF fixture may still carry 'tbd' team slots (bracket scraper lag) —
    // repair to the confirmed QF winners (eng/arg) before writing odds. On the
    // live feed these are already resolved, and the Phase-6 orientation assertion
    // has already proven any non-tbd slots agree with eng/arg, so this is a no-op
    // safety net; it only writes when a slot is still 'tbd'.
    const [fixRes] = await conn.query(`
      UPDATE wc2026_matches SET home_team_id = ?, away_team_id = ?
      WHERE match_id = ? AND home_team_id = 'tbd'
    `, [match.homeId, match.awayId, match.fid]);
    if (fixRes.affectedRows > 0) log('DB', `wc2026_matches: ${match.fid} team slots tbd/tbd -> ${match.homeId}/${match.awayId} (bracket-confirmed)`);

    // Venue repair is DISABLED for SF-102 (venueCityLike=null): the seeded venue
    // is left untouched rather than repaired to an unverified stadium. Look the
    // correct venue_id up from wc2026_venues BY CITY only when venueCityLike is
    // set (never hardcode a guessed slug); only update when a row matches.
    if (match.venueCityLike) {
      const [vrows] = await conn.query(
        `SELECT venue_id, city FROM wc2026_venues WHERE LOWER(city) LIKE ? ORDER BY venue_id LIMIT 1`,
        [`%${match.venueCityLike.toLowerCase()}%`]);
      if (vrows.length > 0) {
        const [vres] = await conn.query(
          `UPDATE wc2026_matches SET venue_id = ? WHERE match_id = ?`, [vrows[0].venue_id, match.fid]);
        log('DB', `wc2026_matches: ${match.fid} venue_id -> '${vrows[0].venue_id}' (${vrows[0].city}) [matched '${match.venueCityLike}', rows=${vres.affectedRows}]`);
      } else {
        log('WARN', `No wc2026_venues row with city like '${match.venueCityLike}' for ${match.fid} — venue left unchanged`);
      }
    }

    // Match-date bucketing repair. The feed groups matches by match_date, and the
    // seeding DAY must be the kickoff's PACIFIC-TIME calendar day (kickoff TIME is
    // shown in ET). SF-102 is a Jul-15 match; if a late kickoff pushed its UTC day
    // to Jul 16 it would mis-bucket off the Jul-15 feed. Repair match_date to the
    // PT day (seedDatePT=2026-07-15) WITHOUT touching the (correct) kickoff_utc.
    // The guard only fires when the seeded DATE differs, so it is a no-op if the
    // bracket already bucketed SF-102 on Jul 15.
    if (match.seedDatePT) {
      const [dres] = await conn.query(
        `UPDATE wc2026_matches SET match_date = ? WHERE match_id = ? AND DATE(match_date) <> ?`,
        [match.seedDatePT, match.fid, match.seedDatePT]);
      if (dres.affectedRows > 0) log('DB', `wc2026_matches: ${match.fid} match_date -> ${match.seedDatePT} (PT kickoff-day rule; kickoff_utc unchanged)`);
      else log('STATE', `wc2026_matches: ${match.fid} match_date already ${match.seedDatePT} (PT kickoff day)`);
    }

    // SF wc2026MatchOdds rows are not auto-created by any scraper (the
    // BetExplorer scraper's match list stops at R16) — INSERT with ODKU keyed
    // on the unique match_id, safe whether or not a row already exists.
    const [oddsRes] = await conn.query(`
      INSERT INTO wc2026MatchOdds (
        match_id, espn_match_id, espn_slug, bet_explorer_match_id, bet_explorer_slug,
        world_cup_stage, world_cup_round, home_team, away_team,
        model_home_ml, model_away_ml, model_draw,
        model_home_to_advance, model_away_to_advance,
        model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds,
        model_total, model_over_odds, model_under_odds,
        model_btts_yes, model_btts_no,
        model_home_wd, model_away_wd, model_no_draw,
        lamba_home, lamba_away,
        model_projected_home_goals, model_projected_away_goals,
        book_home_ml, book_away_ml, book_draw,
        book_home_to_advance, book_away_to_advance,
        book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
        book_total, book_over_odds, book_under_odds,
        book_btts_yes, book_btts_no,
        book_home_wd, book_away_wd, book_no_draw,
        insert_method, last_inserted_at, last_insert_method, odds_source
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,'betexplorer+owner_advance')
      ON DUPLICATE KEY UPDATE
        espn_match_id=VALUES(espn_match_id), espn_slug=VALUES(espn_slug),
        bet_explorer_match_id=VALUES(bet_explorer_match_id), bet_explorer_slug=VALUES(bet_explorer_slug),
        world_cup_stage=VALUES(world_cup_stage), world_cup_round=VALUES(world_cup_round),
        home_team=VALUES(home_team), away_team=VALUES(away_team),
        model_home_ml=VALUES(model_home_ml), model_away_ml=VALUES(model_away_ml), model_draw=VALUES(model_draw),
        model_home_to_advance=VALUES(model_home_to_advance), model_away_to_advance=VALUES(model_away_to_advance),
        model_primary_spread=VALUES(model_primary_spread),
        model_home_primary_spread_odds=VALUES(model_home_primary_spread_odds),
        model_away_primary_spread_odds=VALUES(model_away_primary_spread_odds),
        model_total=VALUES(model_total), model_over_odds=VALUES(model_over_odds), model_under_odds=VALUES(model_under_odds),
        model_btts_yes=VALUES(model_btts_yes), model_btts_no=VALUES(model_btts_no),
        model_home_wd=VALUES(model_home_wd), model_away_wd=VALUES(model_away_wd), model_no_draw=VALUES(model_no_draw),
        lamba_home=VALUES(lamba_home), lamba_away=VALUES(lamba_away),
        model_projected_home_goals=VALUES(model_projected_home_goals),
        model_projected_away_goals=VALUES(model_projected_away_goals),
        book_home_ml=VALUES(book_home_ml), book_away_ml=VALUES(book_away_ml), book_draw=VALUES(book_draw),
        book_home_to_advance=COALESCE(VALUES(book_home_to_advance), book_home_to_advance),
        book_away_to_advance=COALESCE(VALUES(book_away_to_advance), book_away_to_advance),
        book_primary_spread=VALUES(book_primary_spread),
        book_home_primary_spread_odds=VALUES(book_home_primary_spread_odds),
        book_away_primary_spread_odds=VALUES(book_away_primary_spread_odds),
        book_total=VALUES(book_total), book_over_odds=VALUES(book_over_odds), book_under_odds=VALUES(book_under_odds),
        book_btts_yes=VALUES(book_btts_yes), book_btts_no=VALUES(book_btts_no),
        book_home_wd=VALUES(book_home_wd), book_away_wd=VALUES(book_away_wd), book_no_draw=VALUES(book_no_draw),
        last_inserted_at=NOW(), last_insert_method=VALUES(last_insert_method), odds_source=VALUES(odds_source)
    `, [
      match.fid, match.espnId, match.espnSlug, match.beId, match.beSlug,
      'knockout', 'semifinals', ESPN_TEAM_IDS[match.home], ESPN_TEAM_IDS[match.away],
      markets.mlHome, markets.mlAway, markets.mlDraw,
      markets.mlAdvH, markets.mlAdvA,
      markets.spreadLine, markets.mlHomeSpread, markets.mlAwaySpread,
      markets.projTotal, markets.mlOver, markets.mlUnder,
      markets.mlBTTSY, markets.mlBTTSN,
      markets.mlHomeWD, markets.mlAwayWD, markets.mlNoDraw,
      lambdaH, lambdaA,
      markets.projH, markets.projA,
      book.bookHomeMl, book.bookAwayMl, book.bookDraw,
      book.bookHomeAdv, book.bookAwayAdv,
      book.bookSpread, book.bookHomeSpreadOdds, book.bookAwaySpreadOdds,
      book.bookTotal, book.bookOver, book.bookUnder,
      book.bookBttsY, book.bookBttsN,
      book.bookHomeWD, book.bookAwayWD, book.bookNoDraw,
      ENGINE_VERSION, ENGINE_VERSION
    ]);
    if (oddsRes.affectedRows === 0) hardFail(`wc2026MatchOdds write affected 0 rows for ${match.fid}`);
    log('DB', `wc2026MatchOdds UPSERTED: ${match.fid} (${match.home} vs ${match.away}) — ALL 36+ columns + odds_source written`);

    // Update wc2026_model_projections
    await conn.query(`
      INSERT INTO wc2026_model_projections (
        match_id, model_version, n_simulations, home_team, away_team, home_lambda, away_lambda,
        proj_home_score, proj_away_score, proj_total,
        model_home_ml, model_draw_ml, model_away_ml,
        to_advance_home_odds, to_advance_away_odds,
        over_odds, under_odds, btts_yes_odds, btts_no_odds,
        home_spread_odds, away_spread_odds,
        dc_1x_odds, dc_x2_odds, no_draw_home_odds,
        model_spread, model_total,
        modeled_at, created_at
      ) VALUES (?, ?, 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        model_version=VALUES(model_version), home_lambda=VALUES(home_lambda), away_lambda=VALUES(away_lambda),
        proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score), proj_total=VALUES(proj_total),
        model_home_ml=VALUES(model_home_ml), model_draw_ml=VALUES(model_draw_ml), model_away_ml=VALUES(model_away_ml),
        to_advance_home_odds=VALUES(to_advance_home_odds), to_advance_away_odds=VALUES(to_advance_away_odds),
        over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
        btts_yes_odds=VALUES(btts_yes_odds), btts_no_odds=VALUES(btts_no_odds),
        home_spread_odds=VALUES(home_spread_odds), away_spread_odds=VALUES(away_spread_odds),
        dc_1x_odds=VALUES(dc_1x_odds), dc_x2_odds=VALUES(dc_x2_odds), no_draw_home_odds=VALUES(no_draw_home_odds),
        model_spread=VALUES(model_spread), model_total=VALUES(model_total), modeled_at=NOW()
    `, [
      match.fid, ENGINE_VERSION, match.home, match.away, lambdaH, lambdaA,
      markets.projH, markets.projA, markets.projTotal,
      markets.mlHome, markets.mlDraw, markets.mlAway,
      markets.mlAdvH, markets.mlAdvA,
      markets.mlOver, markets.mlUnder, markets.mlBTTSY, markets.mlBTTSN,
      markets.mlHomeSpread, markets.mlAwaySpread,
      markets.mlHomeWD, markets.mlAwayWD, markets.mlNoDraw,
      markets.spreadLine, markets.projTotal
    ]);
    log('DB', `wc2026_model_projections UPSERTED: ${match.fid}`);
  }

  // ── FINAL AUDIT ─────────────────────────────────────────────────────────
  banner('FINAL AUDIT — VERIFY ALL COLUMNS NON-NULL');
  let nullCount = 0;
  if (DRY_RUN) {
    log('WARN', 'DRY_RUN=1 — audit skipped (no rows were written)');
  } else {
  const [auditRows] = await conn.query(`
    SELECT match_id, 
      CASE WHEN book_home_ml IS NULL THEN 'book_home_ml' ELSE NULL END as n1,
      CASE WHEN book_away_ml IS NULL THEN 'book_away_ml' ELSE NULL END as n2,
      CASE WHEN book_draw IS NULL THEN 'book_draw' ELSE NULL END as n3,
      CASE WHEN model_home_ml IS NULL THEN 'model_home_ml' ELSE NULL END as n4,
      CASE WHEN model_away_ml IS NULL THEN 'model_away_ml' ELSE NULL END as n5,
      CASE WHEN model_draw IS NULL THEN 'model_draw' ELSE NULL END as n6,
      CASE WHEN model_projected_home_goals IS NULL THEN 'proj_h' ELSE NULL END as n7,
      CASE WHEN model_projected_away_goals IS NULL THEN 'proj_a' ELSE NULL END as n8,
      CASE WHEN book_home_wd IS NULL THEN 'book_home_wd' ELSE NULL END as n9,
      CASE WHEN model_home_wd IS NULL THEN 'model_home_wd' ELSE NULL END as n10,
      CASE WHEN lamba_home IS NULL THEN 'lamba_home' ELSE NULL END as n11,
      CASE WHEN lamba_away IS NULL THEN 'lamba_away' ELSE NULL END as n12,
      CASE WHEN book_home_to_advance IS NULL THEN 'book_home_to_advance' ELSE NULL END as n13,
      CASE WHEN book_away_to_advance IS NULL THEN 'book_away_to_advance' ELSE NULL END as n14,
      CASE WHEN model_home_to_advance IS NULL THEN 'model_home_to_advance' ELSE NULL END as n15,
      CASE WHEN model_away_to_advance IS NULL THEN 'model_away_to_advance' ELSE NULL END as n16
    FROM wc2026MatchOdds WHERE match_id IN ('wc26-sf-102')
  `);
  
  // book_home/away_to_advance are WARN-only in v23: BetExplorer offers no
  // to-qualify market and no prior row existed to preserve — a NULL there is
  // a documented data gap, not a write failure.
  const WARN_ONLY = new Set(['book_home_to_advance', 'book_away_to_advance']);
  for (const row of auditRows) {
    const nulls = Object.entries(row).filter(([k,v])=>k!=='match_id'&&v!==null).map(([k,v])=>v);
    const hard = nulls.filter(c => !WARN_ONLY.has(c));
    const soft = nulls.filter(c => WARN_ONLY.has(c));
    if (soft.length > 0) log('WARN', `${row.match_id}: NULL (warn-only, no book source): ${soft.join(', ')}`);
    if (hard.length > 0) { log('FAIL', `${row.match_id}: NULL columns: ${hard.join(', ')}`); nullCount += hard.length; }
    else log('PASS', `${row.match_id}: ALL hard-audited columns populated ✓`);
  }

  if (nullCount === 0) log('PASS', `AUDIT PASSED: Zero NULLs detected in critical columns`);
  else log('FAIL', `AUDIT FAILED: ${nullCount} NULL values detected`);
  }

  // ── FINAL SUMMARY ───────────────────────────────────────────────────────
  banner('═══ FINAL CERTIFICATION ═══');
  log('OUTPUT', `Engine: ${ENGINE_VERSION}`);
  log('OUTPUT', `Final Variation: ${finalVariation.id || 'RECAL'} (composite=${finalComposite.toFixed(1)})`);
  log('OUTPUT', `Backtest: Dir=${finalGrade.dirOk}/${finalGrade.n}(${pct(finalGrade.dirPct)}) Tot=${finalGrade.totalOk}/${finalGrade.n}(${pct(finalGrade.totalPct)}) Spr=${finalGrade.spreadOk}/${finalGrade.n}(${pct(finalGrade.spreadPct)}) BTTS=${finalGrade.bttsOk}/${finalGrade.n}(${pct(finalGrade.bttsPct)})`);
  log('OUTPUT', `Correct Score: AvgProb=${(finalGrade.avgCSProb*100).toFixed(2)}% AvgRank=#${finalGrade.avgCSRank.toFixed(1)}`);
  log('OUTPUT', `NULL Audit: ${DRY_RUN ? 'SKIPPED (dry run)' : (nullCount===0?'PASSED ✅':'FAILED ❌')}`);
  log('OUTPUT', `Session: ${PASS_COUNT} PASS | ${FAIL_COUNT} FAIL | ${WARN_COUNT} WARN`);
  log('OUTPUT', `Duration: ${((Date.now()-START_TS)/1000).toFixed(1)}s`);
  
  for (const proj of projections) {
    log('PROJ', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log('PROJ', `${proj.match.fid}: ${proj.match.home} vs ${proj.match.away}`);
    log('PROJ', `  Score: ${proj.match.home} ${fmt(proj.markets.projH,2)} — ${fmt(proj.markets.projA,2)} ${proj.match.away}`);
    log('PROJ', `  ML: H=${ml(proj.markets.mlHome)} D=${ml(proj.markets.mlDraw)} A=${ml(proj.markets.mlAway)}`);
    log('PROJ', `  Advance: H=${ml(proj.markets.mlAdvH)}(${pct(proj.markets.pAdvH)}) A=${ml(proj.markets.mlAdvA)}(${pct(proj.markets.pAdvA)})`);
    log('PROJ', `  Spread(${proj.markets.spreadLine}): H=${ml(proj.markets.mlHomeSpread)} A=${ml(proj.markets.mlAwaySpread)}`);
    log('PROJ', `  O/U(2.5): O=${ml(proj.markets.mlOver)} U=${ml(proj.markets.mlUnder)}`);
    log('PROJ', `  BTTS: Y=${ml(proj.markets.mlBTTSY)} N=${ml(proj.markets.mlBTTSN)}`);
    log('PROJ', `  DC: HomeWD=${ml(proj.markets.mlHomeWD)} AwayWD=${ml(proj.markets.mlAwayWD)} NoDraw=${ml(proj.markets.mlNoDraw)}`);
  }

  await conn.end();
  log('PASS', `Database connection closed. Engine complete.`);
  process.exit(0);
}

main().catch(e => { log('FAIL', `FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
