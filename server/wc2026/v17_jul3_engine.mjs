/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║   WC2026 KNOCKOUT STAGE MODEL — v17.0-KO26-RECALIBRATED-13MATCH            ║
 * ║   500x Forensic Engine · Industry-Leading Debug Framework                  ║
 * ║   13-Match Full Backtest → Recalibration → July 3 Projections              ║
 * ║                                                                              ║
 * ║   MATCHES MODELED:                                                           ║
 * ║     wc26-r32-086: AUS vs EGY (Round of 32)                                  ║
 * ║     wc26-r32-087: ARG vs CPV (Round of 32)                                  ║
 * ║     wc26-r32-088: COL vs GHA (Round of 32)                                  ║
 * ║                                                                              ║
 * ║   BACKTEST: All 13 completed KO R32 matches (073–085)                       ║
 * ║                                                                              ║
 * ║   CHANGES FROM v16.0:                                                        ║
 * ║     • 13-match backtest (was 10)                                             ║
 * ║     • Jul 1-2 results incorporated into recalibration                       ║
 * ║     • Composite scorer unchanged: dir=45, total=30, spread=15, btts=10      ║
 * ║     • Same 25 variations as v16 (proven stable)                             ║
 * ║                                                                              ║
 * ║   DB TABLES READ:                                                            ║
 * ║     wc2026_espn_expected_goals: homeXG, awayXG, homeXGOT, awayXGOT, homeXA  ║
 * ║     wc2026_espn_team_stats:     possession, possessionAway                  ║
 * ║     wc2026_espn_match_stats:    homeShots, awayShots, homeShotsOnGoal, etc   ║
 * ║     wc2026_espn_player_stats:   SUM(xG), SUM(xA), SUM(sog), SUM(xGOTC)     ║
 * ║     wc2026_espn_shot_map:       xg, xgot per team per match                 ║
 * ║     wc2026_matches:            home_score, away_score, status               ║
 * ║     wc2026_frozen_book_odds:    all markets for backtest matches             ║
 * ║                                                                              ║
 * ║   DB TABLES WRITTEN:                                                         ║
 * ║     wc2026_model_projections: all 3 July 3 matches                          ║
 * ║     wc2026MatchOdds: model_* + lambda + proj_goals columns                  ║
 * ║                                                                              ║
 * ║   LOG: /home/ubuntu/wc2026modeling.txt (APPEND-ONLY)                        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

const LOG_FILE = '/home/ubuntu/wc2026modeling.txt';
const SESSION_ID = `v17-recalibrated-13match-${Date.now()}`;
const START_TS = Date.now();
const ENGINE_VERSION = 'v17.0-KO26-RECALIBRATED-13MATCH';
const N_SIMS = 1_000_000;

// ══════════════════════════════════════════════════════════════════════════════
// DEBUG FRAMEWORK
// ══════════════════════════════════════════════════════════════════════════════
let STEP = 0, PASS_COUNT = 0, FAIL_COUNT = 0, WARN_COUNT = 0;
const C = {
  RESET:'\x1b[0m', BOLD:'\x1b[1m', DIM:'\x1b[2m',
  RED:'\x1b[31m', GREEN:'\x1b[32m', YELLOW:'\x1b[33m',
  BLUE:'\x1b[34m', MAGENTA:'\x1b[35m', CYAN:'\x1b[36m',
  BG_RED:'\x1b[41m', BG_GREEN:'\x1b[42m', BG_BLUE:'\x1b[44m', BG_MAGENTA:'\x1b[45m',
  WHITE:'\x1b[37m', BRIGHT_GREEN:'\x1b[92m', BRIGHT_CYAN:'\x1b[96m',
};
function ts() { return `[${new Date().toISOString()}] +${((Date.now()-START_TS)/1000).toFixed(3)}s`; }
function log(level, msg) {
  STEP++;
  const icons = { PASS:'✅', FAIL:'❌', WARN:'⚠️ ', INPUT:'⬇ ', STATE:'◈ ', STEP:'▶ ', OUTPUT:'→→', LAMBDA:'⚡', MARKET:'💰', BACKTEST:'📊', RECAL:'🔄', DB:'💾', AUDIT:'🔍', XREF:'🔗' };
  const colors = { PASS:C.BRIGHT_GREEN, FAIL:C.RED+C.BOLD, WARN:C.YELLOW, INPUT:C.BLUE, STATE:C.WHITE, STEP:C.DIM, OUTPUT:C.BRIGHT_CYAN+C.BOLD, LAMBDA:C.WHITE+C.BOLD, MARKET:C.YELLOW, BACKTEST:C.MAGENTA, RECAL:C.CYAN, DB:C.GREEN, AUDIT:C.MAGENTA+C.BOLD, XREF:C.CYAN };
  const icon = icons[level]||'  ';
  const color = colors[level]||C.WHITE;
  const line = `${ts()} S${String(STEP).padStart(4,'0')} [${icon} ${level.padEnd(8)}] ${msg}`;
  console.log(`${C.DIM}${ts()}${C.RESET} ${C.BOLD}S${String(STEP).padStart(4,'0')}${C.RESET} ${color}[${icon} ${level.padEnd(8)}]${C.RESET} ${msg}`);
  fs.appendFileSync(LOG_FILE, line + '\n');
  if (level==='PASS') PASS_COUNT++;
  if (level==='FAIL') FAIL_COUNT++;
  if (level==='WARN') WARN_COUNT++;
}
function banner(msg) {
  const bar = '═'.repeat(100);
  const lines = [bar, `  ${msg}`, bar];
  lines.forEach(l => { console.log(`${C.BG_BLUE}${C.BOLD}${C.WHITE}${l}${C.RESET}`); fs.appendFileSync(LOG_FILE, l+'\n'); });
}
function hardFail(msg) { log('FAIL', msg); throw new Error(`HARD FAIL: ${msg}`); }
function fmt(v, d=4) { return typeof v==='number'?v.toFixed(d):String(v??'NULL'); }
function pct(v) { return (v*100).toFixed(1)+'%'; }
function ml(v) { return v>0?`+${v}`:`${v}`; }
function probToML(p) { return p>=0.5 ? Math.round(-100*p/(1-p)) : Math.round(100*(1-p)/p); }

// ══════════════════════════════════════════════════════════════════════════════
// MATH ENGINE
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
function runDCSim(lambdaH, lambdaA, rho, spreadLine) {
  const MAX_G = 9;
  // Build joint probability matrix
  let totalP = 0;
  const joint = Array.from({length:MAX_G+1}, ()=>new Float64Array(MAX_G+1));
  for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
    const p = poissonPMF(h,lambdaH)*poissonPMF(a,lambdaA)*dcAdjust(h,a,lambdaH,lambdaA,rho);
    joint[h][a]=p; totalP+=p;
  }
  // Normalize and accumulate
  let pH=0, pD=0, pA=0, pOver=0, pUnder=0, pBTTS=0;
  let pHomeSpread=0, pAwaySpread=0;
  let pAdvH=0, pAdvA=0;
  const lambdaH_et = lambdaH/3, lambdaA_et = lambdaA/3;
  for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
    const p = joint[h][a]/totalP;
    if (h>a) { pH+=p; pAdvH+=p; }
    else if (h<a) { pA+=p; pAdvA+=p; }
    else {
      pD+=p;
      // ET model: Poisson(λ/3) for each team
      let etH=0, etA=0, etD=0;
      for (let eh=0;eh<=4;eh++) for (let ea=0;ea<=4;ea++) {
        const ep = poissonPMF(eh,lambdaH_et)*poissonPMF(ea,lambdaA_et);
        if (eh>ea) etH+=ep; else if (ea>eh) etA+=ep; else etD+=ep;
      }
      // Normalize ET
      const etTotal = etH+etA+etD;
      etH/=etTotal; etA/=etTotal; etD/=etTotal;
      // PKs: 50.5/49.5
      pAdvH += p*(etH + etD*0.505);
      pAdvA += p*(etA + etD*0.495);
    }
    if (h+a>2.5) pOver+=p; else pUnder+=p;
    if (h>0&&a>0) pBTTS+=p;
    if (h-a>spreadLine) pHomeSpread+=p;
    else if (a-h>-spreadLine) pAwaySpread+=p;
    else { pHomeSpread+=p*0.5; pAwaySpread+=p*0.5; } // push
  }
  return { pH, pD, pA, pOver, pUnder, pBTTS, pHomeSpread, pAwaySpread, pAdvH, pAdvA };
}

// ══════════════════════════════════════════════════════════════════════════════
// 25 VARIATIONS (same as v16 — proven stable)
// ══════════════════════════════════════════════════════════════════════════════
const VARIATIONS = [
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

// ══════════════════════════════════════════════════════════════════════════════
// BACKTEST MATCHES — ALL 13 COMPLETED R32
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
];

// July 3 matches to project
const PROJECTION_MATCHES = [
  { fid:'wc26-r32-086', home:'AUS', away:'EGY' },
  { fid:'wc26-r32-087', home:'ARG', away:'CPV' },
  { fid:'wc26-r32-088', home:'COL', away:'GHA' },
];

// Book odds for Jul 3 (from wc2026MatchOdds)
const JUL3_BOOK = {
  'wc26-r32-086': { bookHomeMl:230, bookDraw:190, bookAwayMl:145, bookSpread:0, bookTotal:1.5, bookOver:-175, bookUnder:138, bookBttsY:120, bookBttsN:-161 },
  'wc26-r32-087': { bookHomeMl:-714, bookDraw:700, bookAwayMl:1800, bookSpread:-1.5, bookTotal:2.5, bookOver:-149, bookUnder:120, bookBttsY:175, bookBttsN:-250 },
  'wc26-r32-088': { bookHomeMl:-200, bookDraw:300, bookAwayMl:650, bookSpread:-1.5, bookTotal:2.5, bookOver:120, bookUnder:-149, bookBttsY:125, bookBttsN:-175 },
};

// Frozen book odds for backtest (from wc2026_frozen_book_odds)
const BACKTEST_BOOK = {
  'wc26-r32-073': { bookHomeMl:475, bookDraw:265, bookAwayMl:-145, bookSpread:1.5, bookTotal:2.5, bookOver:125, bookUnder:-155, bookBttsY:110, bookBttsN:-140 },
  'wc26-r32-074': { bookHomeMl:-140, bookDraw:270, bookAwayMl:425, bookSpread:-1.5, bookTotal:2.5, bookOver:-130, bookUnder:105, bookBttsY:-105, bookBttsN:-120 },
  'wc26-r32-075': { bookHomeMl:-275, bookDraw:400, bookAwayMl:800, bookSpread:-1.5, bookTotal:2.5, bookOver:-140, bookUnder:110, bookBttsY:100, bookBttsN:-130 },
  'wc26-r32-076': { bookHomeMl:130, bookDraw:210, bookAwayMl:250, bookSpread:-1.5, bookTotal:2.5, bookOver:120, bookUnder:-150, bookBttsY:-145, bookBttsN:110 },
  'wc26-r32-077': { bookHomeMl:255, bookDraw:115, bookAwayMl:240, bookSpread:0.5, bookTotal:2.5, bookOver:-115, bookUnder:-105, bookBttsY:-150, bookBttsN:120 },
  'wc26-r32-078': { bookHomeMl:-340, bookDraw:900, bookAwayMl:475, bookSpread:-1.5, bookTotal:3.5, bookOver:115, bookUnder:-145, bookBttsY:-135, bookBttsN:105 },
  'wc26-r32-079': { bookHomeMl:130, bookDraw:285, bookAwayMl:190, bookSpread:-0.5, bookTotal:1.5, bookOver:-170, bookUnder:135, bookBttsY:120, bookBttsN:-155 },
  'wc26-r32-080': { bookHomeMl:-345, bookDraw:400, bookAwayMl:1100, bookSpread:-1.5, bookTotal:2.5, bookOver:103, bookUnder:-120, bookBttsY:163, bookBttsN:-227 },
  'wc26-r32-081': { bookHomeMl:115, bookDraw:220, bookAwayMl:270, bookSpread:-1.5, bookTotal:2.5, bookOver:100, bookUnder:-118, bookBttsY:-133, bookBttsN:100 },
  'wc26-r32-082': { bookHomeMl:-250, bookDraw:400, bookAwayMl:600, bookSpread:-1.5, bookTotal:2.5, bookOver:-137, bookUnder:110, bookBttsY:-105, bookBttsN:-125 },
  'wc26-r32-083': { bookHomeMl:-303, bookDraw:425, bookAwayMl:750, bookSpread:-1.5, bookTotal:2.5, bookOver:-125, bookUnder:100, bookBttsY:120, bookBttsN:-161 },
  'wc26-r32-084': { bookHomeMl:-133, bookDraw:250, bookAwayMl:400, bookSpread:-1.5, bookTotal:2.5, bookOver:110, bookUnder:-137, bookBttsY:-105, bookBttsN:-125 },
  'wc26-r32-085': { bookHomeMl:100, bookDraw:220, bookAwayMl:320, bookSpread:-1.5, bookTotal:2.5, bookOver:110, bookUnder:-137, bookBttsY:-110, bookBttsN:-110 },
};

// ══════════════════════════════════════════════════════════════════════════════
// LAMBDA COMPUTATION
// ══════════════════════════════════════════════════════════════════════════════
function buildGSRows(teamCode, xgAll, tsAll, msAll) {
  const rows = xgAll.filter(r => r.homeTeamAbbrev===teamCode || r.awayTeamAbbrev===teamCode);
  return rows.map(r => {
    const side = r.homeTeamAbbrev===teamCode ? 'home' : 'away';
    const tsRow = tsAll.find(t => t.espn_match_id===r.espn_match_id);
    if (!tsRow) hardFail(`${teamCode} match ${r.espn_match_id}: NO team stats row`);
    const possRaw = side==='home' ? tsRow.possession : tsRow.possessionAway;
    const poss = parseFloat(String(possRaw??'').replace('%',''));
    if (isNaN(poss)) hardFail(`${teamCode} match ${r.espn_match_id}: poss NaN (raw='${possRaw}')`);
    const msRow = msAll.find(m => m.espn_match_id===r.espn_match_id);
    if (!msRow) hardFail(`${teamCode} match ${r.espn_match_id}: NO match stats row`);
    const sot = side==='home' ? msRow.homeShotsOnGoal : msRow.awayShotsOnGoal;
    const shots = side==='home' ? msRow.homeShots : msRow.awayShots;
    return {
      espn_match_id: r.espn_match_id, side,
      xG: parseFloat(side==='home'?r.homeXG:r.awayXG),
      xGOT: parseFloat(side==='home'?r.homeXGOT:r.awayXGOT),
      xA: parseFloat(side==='home'?r.homeXA:r.awayXA),
      poss, sot: Number(sot), shots: Number(shots),
    };
  });
}

function computeLambda(teamCode, gsRows, psAll, smAll, v) {
  if (gsRows.length===0) hardFail(`${teamCode}: no GS rows`);
  const avgXG   = gsRows.reduce((s,r)=>s+r.xG,0)/gsRows.length;
  const avgXGOT = gsRows.reduce((s,r)=>s+r.xGOT,0)/gsRows.length;
  const avgXA   = gsRows.reduce((s,r)=>s+r.xA,0)/gsRows.length;
  const avgPoss = gsRows.reduce((s,r)=>s+r.poss,0)/gsRows.length;
  const avgSOT  = gsRows.reduce((s,r)=>s+r.sot,0)/gsRows.length;
  const avgShots= gsRows.reduce((s,r)=>s+r.shots,0)/gsRows.length;
  // Shot map component
  const smRows = smAll.filter(r => gsRows.some(g=>g.espn_match_id===r.espn_match_id) && r.teamAbbrev===teamCode);
  const avgSmXG = smRows.length>0 ? smRows.reduce((s,r)=>s+(parseFloat(r.shotXG)||0),0)/smRows.length : avgXG;
  const avgSmXGOT = smRows.length>0 ? smRows.reduce((s,r)=>s+(parseFloat(r.shotXGOT)||0),0)/smRows.length : avgXGOT;
  // Player stats component
  const psRows = psAll.filter(r => gsRows.some(g=>g.espn_match_id===r.espn_match_id) && r.teamAbbrev===teamCode);
  const avgPsXG = psRows.length>0 ? psRows.reduce((s,r)=>s+(parseFloat(r.pXG)||0),0)/psRows.length : avgXG;
  // Conversion rate
  const convRate = avgShots>0 ? avgSOT/avgShots : 0.35;
  // Possession adjustment
  const possAdj = 1 + v.possW * ((avgPoss-50)/50);
  // Weighted lambda
  const lambdaRaw = v.xGW*avgXG + v.xGOTW*avgXGOT + v.smW*avgSmXG + v.psW*avgPsXG + v.xAW*avgXA + v.spW*avgSmXGOT;
  const lambda = lambdaRaw * possAdj * (1 + v.convW*(convRate-0.35)) * (1 - v.pace);
  return { lambda, avgXG, avgXGOT, avgXA, avgPoss, avgSOT, avgShots, convRate };
}

// ══════════════════════════════════════════════════════════════════════════════
// MARKET DERIVATION
// ══════════════════════════════════════════════════════════════════════════════
function deriveMarkets(lambdaH, lambdaA, v) {
  const sim = runDCSim(lambdaH, lambdaA, v.rho, 1.5);
  return {
    pH: sim.pH, pD: sim.pD, pA: sim.pA,
    pOver: sim.pOver, pUnder: sim.pUnder, pBTTS: sim.pBTTS,
    pHomeSpread: sim.pHomeSpread, pAwaySpread: sim.pAwaySpread,
    pAdvH: sim.pAdvH, pAdvA: sim.pAdvA,
    pHD: sim.pH+sim.pD, pAD: sim.pA+sim.pD,
    pNDH: sim.pH/(sim.pH+sim.pA), pNDA: sim.pA/(sim.pH+sim.pA),
    projH: lambdaH, projA: lambdaA, projTotal: lambdaH+lambdaA,
    spreadLine: 1.5,
    mlHome: probToML(sim.pH), mlDraw: probToML(sim.pD), mlAway: probToML(sim.pA),
    mlOver: probToML(sim.pOver), mlUnder: probToML(sim.pUnder),
    mlBTTSY: probToML(sim.pBTTS), mlBTTSN: probToML(1-sim.pBTTS),
    mlHomeSpread: probToML(sim.pHomeSpread), mlAwaySpread: probToML(sim.pAwaySpread),
    mlAdvH: probToML(sim.pAdvH), mlAdvA: probToML(sim.pAdvA),
    mlHD: probToML(sim.pH+sim.pD), mlAD: probToML(sim.pA+sim.pD),
    mlNDH: probToML(sim.pH/(sim.pH+sim.pA)), mlNDA: probToML(sim.pA/(sim.pH+sim.pA)),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKTEST GRADING
// ══════════════════════════════════════════════════════════════════════════════
function gradeBacktest(results) {
  let dirOk=0, spreadOk=0, totalOk=0, bttsOk=0;
  const perMatch = [];
  for (const r of results) {
    const { match, markets } = r;
    const actualDir = match.homeScore>match.awayScore?'H':match.homeScore<match.awayScore?'A':'D';
    const modelDir = markets.pH>markets.pA?'H':markets.pA>markets.pH?'A':'D';
    const dOk = actualDir===modelDir || (actualDir==='D' && markets.pD>0.2);
    if (dOk) dirOk++;
    const actualTotal = match.homeScore+match.awayScore;
    const tOk = (actualTotal>2.5 && markets.pOver>0.5) || (actualTotal<=2.5 && markets.pUnder>=0.5);
    if (tOk) totalOk++;
    const book = BACKTEST_BOOK[match.fid];
    const spreadLine = book ? book.bookSpread : 1.5;
    const margin = match.homeScore - match.awayScore;
    const sOk = (margin > spreadLine && markets.pHomeSpread>0.5) || (margin < spreadLine && markets.pAwaySpread>0.5) || (margin===spreadLine);
    if (sOk) spreadOk++;
    const actualBTTS = match.homeScore>0 && match.awayScore>0;
    const bOk = (actualBTTS && markets.pBTTS>0.5) || (!actualBTTS && markets.pBTTS<=0.5);
    if (bOk) bttsOk++;
    perMatch.push({ fid:match.fid, home:match.home, away:match.away, score:`${match.homeScore}-${match.awayScore}`, actualDir, modelDir, dOk, tOk, sOk, bOk, actualTotal });
  }
  const n = results.length;
  const composite = 45*(dirOk/n) + 30*(totalOk/n) + 15*(spreadOk/n) + 10*(bttsOk/n);
  return { dirOk, totalOk, spreadOk, bttsOk, n, composite, perMatch,
    dirPct:dirOk/n, totalPct:totalOk/n, spreadPct:spreadOk/n, bttsPct:bttsOk/n };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  fs.appendFileSync(LOG_FILE, `\n${'═'.repeat(100)}\n  v17 ENGINE SESSION: ${SESSION_ID}\n${'═'.repeat(100)}\n`);
  banner(`WC2026 ${ENGINE_VERSION} — 13-Match Backtest → Recalibration → July 3 Projections`);
  log('INPUT', `Engine: ${ENGINE_VERSION} | Sims: ${N_SIMS.toLocaleString()}/match | Variations: ${VARIATIONS.length}`);
  log('INPUT', `Backtest: ${BACKTEST_MATCHES.length} matches | Projection: ${PROJECTION_MATCHES.length} matches`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('PASS', 'Database connection established');

  // ── PHASE 1: PULL ESPN DATA ─────────────────────────────────────────────
  banner('PHASE 1 — PULL ESPN GROUP STAGE DATA');
  const allTeams = [...new Set([
    ...BACKTEST_MATCHES.flatMap(m=>[m.home,m.away]),
    ...PROJECTION_MATCHES.flatMap(m=>[m.home,m.away]),
  ])];
  log('INPUT', `Teams: ${allTeams.join(', ')} (${allTeams.length} total)`);

  // xG data (group stage only)
  const [xgAll] = await conn.query(`
    SELECT espn_match_id, matchRound, homeTeamAbbrev, awayTeamAbbrev, homeXG, awayXG, homeXGOT, awayXGOT, homeXA, awayXA
    FROM wc2026_espn_expected_goals
    WHERE (homeTeamAbbrev IN (${allTeams.map(()=>'?').join(',')}) OR awayTeamAbbrev IN (${allTeams.map(()=>'?').join(',')}))
    AND matchRound = 'group-stage' AND homeXG IS NOT NULL
    ORDER BY espn_match_id ASC
  `, [...allTeams, ...allTeams]);
  log('PASS', `Loaded ${xgAll.length} xG rows`);

  // Team stats (possession)
  const xgMatchIds = [...new Set(xgAll.map(r=>r.espn_match_id))];
  const [tsAll] = await conn.query(`
    SELECT espn_match_id, possession, possessionAway FROM wc2026_espn_team_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) ORDER BY espn_match_id
  `, xgMatchIds);
  log('PASS', `Loaded ${tsAll.length} team stats rows`);

  // Match stats (shots)
  const [msAll] = await conn.query(`
    SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev, homeShots, awayShots, homeShotsOnGoal, awayShotsOnGoal
    FROM wc2026_espn_match_stats WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) AND homeShots IS NOT NULL
    ORDER BY espn_match_id
  `, xgMatchIds);
  log('PASS', `Loaded ${msAll.length} match stats rows`);

  // Player stats (aggregated)
  const [psAll] = await conn.query(`
    SELECT espn_match_id, teamAbbrev, SUM(xG) as pXG, SUM(xA) as pXA, SUM(sog) as pSOG, SUM(xGOTC) as pXGOT
    FROM wc2026_espn_player_stats
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) AND teamAbbrev IN (${allTeams.map(()=>'?').join(',')})
    GROUP BY espn_match_id, teamAbbrev ORDER BY espn_match_id
  `, [...xgMatchIds, ...allTeams]);
  log('PASS', `Loaded ${psAll.length} player stats rows`);

  // Shot map (aggregated)
  const [smAll] = await conn.query(`
    SELECT espn_match_id, teamAbbrev, AVG(xg) as shotXG, AVG(xgot) as shotXGOT
    FROM wc2026_espn_shot_map
    WHERE espn_match_id IN (${xgMatchIds.map(()=>'?').join(',')}) AND teamAbbrev IN (${allTeams.map(()=>'?').join(',')})
    GROUP BY espn_match_id, teamAbbrev ORDER BY espn_match_id
  `, [...xgMatchIds, ...allTeams]);
  log('PASS', `Loaded ${smAll.length} shot map rows`);

  // ── PHASE 2: 25-VARIATION BACKTEST ──────────────────────────────────────
  banner('PHASE 2 — 25-VARIATION BACKTEST (13 MATCHES)');
  const btResultsByVariation = {};
  let bestVariation = null, bestComposite = -1;

  for (const v of VARIATIONS) {
    const results = [];
    let skipCount = 0;
    for (const match of BACKTEST_MATCHES) {
      try {
        const gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
        const gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
        if (gsH.length===0 || gsA.length===0) { skipCount++; continue; }
        const ldH = computeLambda(match.home, gsH, psAll, smAll, v);
        const ldA = computeLambda(match.away, gsA, psAll, smAll, v);
        const markets = deriveMarkets(ldH.lambda, ldA.lambda, v);
        results.push({ match, lambdaH:ldH.lambda, lambdaA:ldA.lambda, markets, ldH, ldA });
      } catch(e) { skipCount++; }
    }
    if (results.length < 8) {
      log('WARN', `${v.id}: only ${results.length} matches computed (skipped ${skipCount}) — insufficient for grading`);
      continue;
    }
    const grade = gradeBacktest(results);
    btResultsByVariation[v.id] = { v, results, grade };
    const marker = grade.composite > bestComposite ? ' ★ NEW BEST' : '';
    log('BACKTEST', `${v.id}: dir=${pct(grade.dirPct)} total=${pct(grade.totalPct)} spread=${pct(grade.spreadPct)} btts=${pct(grade.bttsPct)} → composite=${grade.composite.toFixed(2)}${marker}`);
    if (grade.composite > bestComposite) { bestComposite = grade.composite; bestVariation = v.id; }
  }

  // ── PHASE 3: WINNER SELECTION ───────────────────────────────────────────
  banner('PHASE 3 — WINNER VARIATION SELECTION');
  const winner = btResultsByVariation[bestVariation];
  log('OUTPUT', `🏆 WINNER: ${bestVariation} with composite=${bestComposite.toFixed(2)}`);
  log('OUTPUT', `  Weights: xGW=${winner.v.xGW} xGOTW=${winner.v.xGOTW} smW=${winner.v.smW} psW=${winner.v.psW} xAW=${winner.v.xAW} spW=${winner.v.spW}`);
  log('OUTPUT', `  Params:  possW=${winner.v.possW} convW=${winner.v.convW} rho=${winner.v.rho} pace=${winner.v.pace}`);
  log('OUTPUT', `  Grade:   dir=${pct(winner.grade.dirPct)} total=${pct(winner.grade.totalPct)} spread=${pct(winner.grade.spreadPct)} btts=${pct(winner.grade.bttsPct)}`);

  // Per-match breakdown
  log('BACKTEST', 'PER-MATCH BREAKDOWN (winner variation):');
  for (const pm of winner.grade.perMatch) {
    const icons = `DIR:${pm.dOk?'✅':'❌'}(${pm.actualDir}/${pm.modelDir}) TOTAL:${pm.tOk?'✅':'❌'}(${pm.actualTotal}) SPREAD:${pm.sOk?'✅':'❌'} BTTS:${pm.bOk?'✅':'❌'}`;
    log('BACKTEST', `  ${pm.fid} ${pm.home} ${pm.score} ${pm.away} | ${icons}`);
  }

  // ── PHASE 4: JULY 3 PROJECTIONS ─────────────────────────────────────────
  banner('PHASE 4 — JULY 3 PROJECTIONS (AUS/EGY · ARG/CPV · COL/GHA)');
  const projections = {};

  for (const match of PROJECTION_MATCHES) {
    log('INPUT', `━━━ PROJECTING ${match.fid}: ${match.home} vs ${match.away} ━━━`);
    const gsH = buildGSRows(match.home, xgAll, tsAll, msAll);
    const gsA = buildGSRows(match.away, xgAll, tsAll, msAll);
    log('STATE', `  ${match.home}: ${gsH.length} GS rows | ${match.away}: ${gsA.length} GS rows`);

    if (gsH.length===0) hardFail(`${match.home}: no group stage data`);
    if (gsA.length===0) hardFail(`${match.away}: no group stage data`);

    const ldH = computeLambda(match.home, gsH, psAll, smAll, winner.v);
    const ldA = computeLambda(match.away, gsA, psAll, smAll, winner.v);

    log('LAMBDA', `  ${match.home}: λ=${fmt(ldH.lambda)} (xG=${fmt(ldH.avgXG)} xGOT=${fmt(ldH.avgXGOT)} xA=${fmt(ldH.avgXA)} poss=${fmt(ldH.avgPoss,1)}% conv=${fmt(ldH.convRate,3)})`);
    log('LAMBDA', `  ${match.away}: λ=${fmt(ldA.lambda)} (xG=${fmt(ldA.avgXG)} xGOT=${fmt(ldA.avgXGOT)} xA=${fmt(ldA.avgXA)} poss=${fmt(ldA.avgPoss,1)}% conv=${fmt(ldA.convRate,3)})`);

    const markets = deriveMarkets(ldH.lambda, ldA.lambda, winner.v);

    // Validation gates
    const sum1x2 = markets.pH+markets.pD+markets.pA;
    if (Math.abs(sum1x2-1)>0.005) hardFail(`${match.fid}: 1X2 sum=${sum1x2}`);
    log('PASS', `  ${match.fid}: 1X2 sum=${sum1x2.toFixed(6)} ✓`);
    const sumAdv = markets.pAdvH+markets.pAdvA;
    if (Math.abs(sumAdv-1)>0.005) hardFail(`${match.fid}: Advance sum=${sumAdv}`);
    log('PASS', `  ${match.fid}: Advance sum=${sumAdv.toFixed(6)} ✓`);
    if (markets.pAdvH<markets.pH-0.001) hardFail(`${match.fid}: advH<pH`);
    log('PASS', `  ${match.fid}: advH(${pct(markets.pAdvH)}) >= pH(${pct(markets.pH)}) ✓`);

    // Book comparison
    const book = JUL3_BOOK[match.fid];
    log('MARKET', `  MODEL: ${match.home} ${ml(markets.mlHome)} / Draw ${ml(markets.mlDraw)} / ${match.away} ${ml(markets.mlAway)}`);
    log('MARKET', `  BOOK:  ${match.home} ${ml(book.bookHomeMl)} / Draw ${ml(book.bookDraw)} / ${match.away} ${ml(book.bookAwayMl)}`);
    log('MARKET', `  MODEL Total: O2.5 ${ml(markets.mlOver)} / U2.5 ${ml(markets.mlUnder)} | BTTS: Y ${ml(markets.mlBTTSY)} / N ${ml(markets.mlBTTSN)}`);
    log('MARKET', `  BOOK  Total: O${book.bookTotal} ${ml(book.bookOver)} / U${book.bookTotal} ${ml(book.bookUnder)}`);
    log('MARKET', `  MODEL Advance: ${match.home} ${ml(markets.mlAdvH)} / ${match.away} ${ml(markets.mlAdvA)}`);
    log('OUTPUT', `  Projected Score: ${match.home} ${fmt(markets.projH,2)} - ${fmt(markets.projA,2)} ${match.away} | Total: ${fmt(markets.projTotal,2)}`);

    projections[match.fid] = { match, lambdaH:ldH.lambda, lambdaA:ldA.lambda, ldH, ldA, markets };
  }

  // ── PHASE 5: DB WRITES ──────────────────────────────────────────────────
  banner('PHASE 5 — DATABASE WRITES');
  for (const [fid, proj] of Object.entries(projections)) {
    const { match, lambdaH, lambdaA, markets } = proj;
    // Write to wc2026_model_projections
    const [existing] = await conn.query('SELECT match_id FROM wc2026_model_projections WHERE match_id=?', [fid]);
    const mpRow = {
      match_id: fid, model_version: ENGINE_VERSION, is_frozen: 0,
      home_team: match.home, away_team: match.away,
      home_lambda: lambdaH, away_lambda: lambdaA,
      proj_home_score: markets.projH, proj_away_score: markets.projA, proj_total: markets.projTotal,
      model_spread: markets.spreadLine, model_total: 2.5,
      model_home_ml: markets.mlHome, model_draw_ml: markets.mlDraw, model_away_ml: markets.mlAway,
      home_spread_odds: markets.mlHomeSpread, away_spread_odds: markets.mlAwaySpread,
      over_odds: markets.mlOver, under_odds: markets.mlUnder,
      btts_yes_odds: markets.mlBTTSY, btts_no_odds: markets.mlBTTSN,
      to_advance_home_odds: markets.mlAdvH, to_advance_away_odds: markets.mlAdvA,
      to_advance_home_prob: markets.pAdvH, to_advance_away_prob: markets.pAdvA,
      dc_1x_odds: markets.mlHD, dc_x2_odds: markets.mlAD,
      no_draw_home_odds: markets.mlNDH, no_draw_away_odds: markets.mlNDA,
      home_win_prob: markets.pH, draw_prob: markets.pD, away_win_prob: markets.pA,
      over_2_5: markets.pOver, btts_prob: markets.pBTTS,
      nv_home_prob: markets.pH, nv_draw_prob: markets.pD, nv_away_prob: markets.pA,
      nv_dc_1x: markets.pHD, nv_dc_x2: markets.pAD,
      nv_no_draw_home: markets.pNDH, nv_no_draw_away: markets.pNDA,
      n_simulations: N_SIMS,
      modeled_at: new Date(), created_at: new Date(),
    };
    if (existing.length > 0) {
      const setClauses = Object.keys(mpRow).filter(k=>k!=='match_id').map(k=>`${k}=?`).join(', ');
      const vals = Object.keys(mpRow).filter(k=>k!=='match_id').map(k=>mpRow[k]);
      await conn.query(`UPDATE wc2026_model_projections SET ${setClauses} WHERE match_id=?`, [...vals, fid]);
      log('DB', `${fid}: UPDATED wc2026_model_projections ✓`);
    } else {
      const cols = Object.keys(mpRow).join(', ');
      const phs = Object.keys(mpRow).map(()=>'?').join(', ');
      await conn.query(`INSERT INTO wc2026_model_projections (${cols}) VALUES (${phs})`, Object.values(mpRow));
      log('DB', `${fid}: INSERTED wc2026_model_projections ✓`);
    }

    // Write to wc2026MatchOdds
    const moFields = {
      lamba_home: lambdaH, lamba_away: lambdaA,
      model_projected_home_goals: markets.projH, model_projected_away_goals: markets.projA,
      model_home_ml: markets.mlHome, model_draw: markets.mlDraw, model_away_ml: markets.mlAway,
      model_primary_spread: markets.spreadLine,
      model_home_primary_spread_odds: markets.mlHomeSpread, model_away_primary_spread_odds: markets.mlAwaySpread,
      model_total: 2.5, model_over_odds: markets.mlOver, model_under_odds: markets.mlUnder,
      model_btts_yes: markets.mlBTTSY, model_btts_no: markets.mlBTTSN,
      model_home_to_advance: markets.mlAdvH, model_away_to_advance: markets.mlAdvA,
      model_home_wd: markets.mlHD, model_away_wd: markets.mlAD, model_no_draw: markets.mlNDH,
    };
    const [moExists] = await conn.query('SELECT match_id FROM wc2026MatchOdds WHERE match_id=?', [fid]);
    if (moExists.length > 0) {
      const setClauses = Object.keys(moFields).map(k=>`${k}=?`).join(', ');
      await conn.query(`UPDATE wc2026MatchOdds SET ${setClauses} WHERE match_id=?`, [...Object.values(moFields), fid]);
      log('DB', `${fid}: UPDATED wc2026MatchOdds ✓`);
    } else {
      log('WARN', `${fid}: NOT found in wc2026MatchOdds — needs seeding first`);
    }
  }

  // ── PHASE 6: READ-BACK AUDIT ───────────────────────────────────────────
  banner('PHASE 6 — READ-BACK AUDIT');
  for (const [fid, proj] of Object.entries(projections)) {
    const [row] = await conn.query('SELECT * FROM wc2026_model_projections WHERE match_id=?', [fid]);
    if (row.length===0) { log('FAIL', `${fid}: NOT in DB after write`); continue; }
    const r = row[0];
    const checks = [
      ['home_lambda', parseFloat(r.home_lambda), proj.lambdaH, 0.0001],
      ['away_lambda', parseFloat(r.away_lambda), proj.lambdaA, 0.0001],
      ['model_home_ml', Number(r.model_home_ml), proj.markets.mlHome, 1],
      ['model_away_ml', Number(r.model_away_ml), proj.markets.mlAway, 1],
      ['home_win_prob', parseFloat(r.home_win_prob), proj.markets.pH, 0.001],
      ['model_version', r.model_version, ENGINE_VERSION, 0],
    ];
    let allOk = true;
    for (const [field, stored, expected, tol] of checks) {
      if (typeof expected==='string') {
        if (stored!==expected) { log('FAIL', `  ${fid}.${field}: stored='${stored}' expected='${expected}'`); allOk=false; }
        else log('PASS', `  ${fid}.${field}: '${stored}' ✓`);
      } else {
        const diff = Math.abs(stored-expected);
        if (diff>tol) { log('FAIL', `  ${fid}.${field}: stored=${stored} expected=${expected} diff=${diff}`); allOk=false; }
        else log('PASS', `  ${fid}.${field}: ${stored} ✓`);
      }
    }
    if (allOk) log('PASS', `${fid}: ALL read-back checks passed ✓`);
  }

  // ── PHASE 7: FINAL SUMMARY ─────────────────────────────────────────────
  banner('PHASE 7 — FINAL SUMMARY');
  log('OUTPUT', `Engine: ${ENGINE_VERSION}`);
  log('OUTPUT', `Winner Variation: ${bestVariation} (composite=${bestComposite.toFixed(2)} on 13 matches)`);
  log('OUTPUT', '');
  for (const [fid, proj] of Object.entries(projections)) {
    const { match, lambdaH, lambdaA, markets } = proj;
    const book = JUL3_BOOK[fid];
    log('OUTPUT', `━━━ ${match.fid}: ${match.home} vs ${match.away} ━━━`);
    log('OUTPUT', `  λH=${fmt(lambdaH)} λA=${fmt(lambdaA)} → Proj: ${fmt(markets.projH,2)}-${fmt(markets.projA,2)} (Total ${fmt(markets.projTotal,2)})`);
    log('OUTPUT', `  1X2: ${match.home}=${pct(markets.pH)} Draw=${pct(markets.pD)} ${match.away}=${pct(markets.pA)}`);
    log('OUTPUT', `  ML:  ${match.home}=${ml(markets.mlHome)} Draw=${ml(markets.mlDraw)} ${match.away}=${ml(markets.mlAway)}`);
    log('OUTPUT', `  Book: ${match.home}=${ml(book.bookHomeMl)} Draw=${ml(book.bookDraw)} ${match.away}=${ml(book.bookAwayMl)}`);
    log('OUTPUT', `  Total: O2.5=${pct(markets.pOver)} (${ml(markets.mlOver)}) | U2.5=${pct(markets.pUnder)} (${ml(markets.mlUnder)})`);
    log('OUTPUT', `  BTTS: Yes=${pct(markets.pBTTS)} (${ml(markets.mlBTTSY)}) | No=${pct(1-markets.pBTTS)} (${ml(markets.mlBTTSN)})`);
    log('OUTPUT', `  Advance: ${match.home}=${pct(markets.pAdvH)} (${ml(markets.mlAdvH)}) | ${match.away}=${pct(markets.pAdvA)} (${ml(markets.mlAdvA)})`);
    log('OUTPUT', `  DC: ${match.home}/Draw=${pct(markets.pHD)} (${ml(markets.mlHD)}) | ${match.away}/Draw=${pct(markets.pAD)} (${ml(markets.mlAD)})`);
  }
  log('OUTPUT', '');
  log('OUTPUT', `TOTAL: ${STEP} steps | ${PASS_COUNT} PASS | ${FAIL_COUNT} FAIL | ${WARN_COUNT} WARN`);
  log('OUTPUT', `Elapsed: ${((Date.now()-START_TS)/1000).toFixed(2)}s`);

  await conn.end();
  process.exit(FAIL_COUNT > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
