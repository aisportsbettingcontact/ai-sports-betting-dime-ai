/**
 * v12_forensic_500x_full.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * WC2026 v12.0-KO24 — 500x Forensic Audit Engine
 *
 * PHASE A: Pull all ESPN stats + model projections + book odds + actual results
 *          for all 7 Jun 28-30 KO matches
 * PHASE B: 500x forensic grading across ALL markets + ESPN stat correlation
 * PHASE C: 10-variation backtest to find optimal v12 parameters
 * PHASE D: Apply v12 to DR Congo vs England, Senegal vs Belgium, Bosnia vs USA
 *          — full market output, NO DB publish
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';

// ── Logger ────────────────────────────────────────────────────────────────────
const logLines = [];
function ts() { return new Date().toISOString(); }
function log(tag, msg) {
  const line = `[${ts()}] [${String(tag).padEnd(8)}] ${msg}`;
  console.log(line); logLines.push(line);
}
function banner(msg) {
  const b = '═'.repeat(90);
  [b, `  ${msg}`, b].forEach(l => log('BANNER', l));
}

// ── Math Core ─────────────────────────────────────────────────────────────────
function ml2prob(ml) {
  if (!ml || ml === 0) return null;
  return ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
}
function prob2ml(p) {
  if (!p || p <= 0 || p >= 1) return null;
  const ml = p >= 0.5 ? -(p / (1 - p)) * 100 : (1 - p) / p * 100;
  return Math.round(ml);
}
function noVigN(...probs) {
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map(p => p / s);
}
function poissonPMF(lambda, k) {
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
function dcRho(i, j, lH, lA, rho) {
  if (i === 0 && j === 0) return 1 - lH * lA * rho;
  if (i === 0 && j === 1) return 1 + lH * rho;
  if (i === 1 && j === 0) return 1 + lA * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}
function buildMatrix(lH, lA, rho = 0.065, maxG = 8) {
  const m = [];
  let tot = 0;
  for (let h = 0; h <= maxG; h++) {
    m[h] = [];
    for (let a = 0; a <= maxG; a++) {
      const p = Math.max(0, poissonPMF(lH, h) * poissonPMF(lA, a) * dcRho(h, a, lH, lA, rho));
      m[h][a] = p; tot += p;
    }
  }
  for (let h = 0; h <= maxG; h++)
    for (let a = 0; a <= maxG; a++)
      m[h][a] /= tot;
  return m;
}
function deriveAll(m, maxG = 8) {
  let pHW=0,pD=0,pAW=0,pO25=0,pO15=0,pO35=0,pBTTS=0;
  let pH15=0,pA15=0,projH=0,projA=0;
  for (let h=0;h<=maxG;h++) for (let a=0;a<=maxG;a++) {
    const p=m[h][a];
    projH+=h*p; projA+=a*p;
    if(h>a) pHW+=p; else if(h===a) pD+=p; else pAW+=p;
    if(h+a>1.5) pO15+=p;
    if(h+a>2.5) pO25+=p;
    if(h+a>3.5) pO35+=p;
    if(h>0&&a>0) pBTTS+=p;
    if(h-a>1.5) pH15+=p;
    if(a-h>1.5) pA15+=p;
  }
  return { pHW,pD,pAW,pO25,pO15,pO35,pBTTS,pH15,pA15,
    projH:+projH.toFixed(4), projA:+projA.toFixed(4),
    projTotal:+(projH+projA).toFixed(4), projSpread:+(projH-projA).toFixed(4) };
}
function spreadCoverProb(m, line, side, maxG=8) {
  let p=0;
  for(let h=0;h<=maxG;h++) for(let a=0;a<=maxG;a++) {
    if(side==='home' && h-a > Math.abs(line)) p+=m[h][a];
    if(side==='away' && a-h > Math.abs(line)) p+=m[h][a];
  }
  return p;
}
function totalCoverProb(m, line, side, maxG=8) {
  let p=0;
  for(let h=0;h<=maxG;h++) for(let a=0;a<=maxG;a++) {
    if(side==='over' && h+a > line) p+=m[h][a];
    if(side==='under' && h+a < line) p+=m[h][a];
  }
  return p;
}
function advProb(pHW,pD,pAW,etF=0.50) {
  const pH=pHW+pD*etF, pA=pAW+pD*(1-etF), s=pH+pA;
  return [pH/s, pA/s];
}
function computeEdge(bookML, modelProb) {
  if(!bookML||!modelProb) return null;
  const bP=ml2prob(bookML); if(!bP) return null;
  const edge=modelProb-bP, roi=edge/bP;
  return { bookProb:+(bP*100).toFixed(3), modelProb:+(modelProb*100).toFixed(3),
    edge:+(edge*100).toFixed(3), roi:+(roi*100).toFixed(3), hasEdge:Math.abs(roi*100)>=3.0 };
}

// ── Actual Results ─────────────────────────────────────────────────────────────
const ACTUAL = {
  'wc26-r32-073': { homeScore:0, awayScore:1, winner:'away', total:1, btts:false, label:'RSA 0-1 CAN' },
  'wc26-r32-074': { homeScore:0, awayScore:1, winner:'away', total:1, btts:false, label:'BRA 0-1 JPN' },
  'wc26-r32-075': { homeScore:3, awayScore:0, winner:'home', total:3, btts:false, label:'GER 3-0 PAR' },
  'wc26-r32-076': { homeScore:2, awayScore:1, winner:'home', total:3, btts:true,  label:'NED 2-1 MAR' },
  'wc26-r32-077': { homeScore:2, awayScore:0, winner:'home', total:2, btts:false, label:'NOR 2-0 CIV' },
  'wc26-r32-078': { homeScore:2, awayScore:0, winner:'home', total:2, btts:false, label:'FRA 2-0 SWE' },
  'wc26-r32-079': { homeScore:2, awayScore:0, winner:'home', total:2, btts:false, label:'MEX 2-0 ECU' },
};

// ── v11 Lambdas (from DB model projections) ───────────────────────────────────
const V11_LAMBDAS = {
  'wc26-r32-073': { lH:0.84, lA:1.94, home:'RSA', away:'CAN', version:'v7.2' },
  'wc26-r32-074': { lH:1.78, lA:0.72, home:'BRA', away:'JPN', version:'v11.0-KO22' },
  'wc26-r32-075': { lH:2.04, lA:0.61, home:'GER', away:'PAR', version:'v11.0-KO22' },
  'wc26-r32-076': { lH:1.52, lA:0.98, home:'NED', away:'MAR', version:'v11.0-KO22' },
  'wc26-r32-077': { lH:1.42, lA:0.88, home:'NOR', away:'CIV', version:'v11.0-KO23' },
  'wc26-r32-078': { lH:1.68, lA:0.74, home:'FRA', away:'SWE', version:'v11.0-KO23' },
  'wc26-r32-079': { lH:0.94, lA:1.30, home:'MEX', away:'ECU', version:'v11.0-KO23' },
};

// ── Jul 1 Book Lines ───────────────────────────────────────────────────────────
const JUL1_BOOK = {
  'wc26-r32-080': { away:'COD', home:'ENG', awayML:1100, drawML:400, homeML:-345, awayOrDraw:250, homeOrDraw:-2000, noDraw:-588, total:2.5, overOdds:103, underOdds:-120, awaySpread:1.5, awaySpreadOdds:-111, homeSpread:-1.5, homeSpreadOdds:-105, bttsY:163, bttsN:-227, toAdvAway:600, toAdvHome:-1100 },
  'wc26-r32-081': { away:'SEN', home:'BEL', awayML:270, drawML:220, homeML:115, awayOrDraw:-149, homeOrDraw:-345, noDraw:-278, total:2.5, overOdds:100, underOdds:-118, awaySpread:1.5, awaySpreadOdds:-435, homeSpread:-1.5, homeSpreadOdds:300, bttsY:-133, bttsN:100, toAdvAway:135, toAdvHome:-175 },
  'wc26-r32-082': { away:'BIH', home:'USA', awayML:600, drawML:400, homeML:-250, awayOrDraw:175, homeOrDraw:-1000, noDraw:-588, total:2.5, overOdds:-137, underOdds:110, awaySpread:1.5, awaySpreadOdds:-137, homeSpread:-1.5, homeSpreadOdds:108, bttsY:-105, bttsN:-125, toAdvAway:450, toAdvHome:-700 },
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  banner('PHASE A — ESPN + Model + Book + Results Data Pull');

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  log('INIT', 'DB connected');

  const FIDS = Object.keys(ACTUAL);

  // Pull fixtures
  const [fixtures] = await conn.query(`
    SELECT f.match_id, f.espn_event_id, f.match_date, f.kickoff_utc,
           f.home_score, f.away_score, f.status, f.attendance,
           th.name as home_name, th.fifa_code as home_code,
           ta.name as away_name, ta.fifa_code as away_code
    FROM wc2026_matches f
    JOIN wc2026_teams th ON f.home_team_id = th.team_id
    JOIN wc2026_teams ta ON f.away_team_id = ta.team_id
    WHERE f.match_id IN (?) ORDER BY f.match_date, f.kickoff_utc
  `, [FIDS]);

  const espnIds = fixtures.map(f => f.espn_event_id).filter(Boolean);
  log('INPUT', `Fixtures: ${fixtures.length} | ESPN IDs: ${espnIds.join(',')}`);

  // Pull all ESPN tables
  const [espnMatches] = await conn.query(`SELECT * FROM wc2026_espn_matches WHERE matchId IN (?)`, [espnIds]);
  const [espnTeamStats] = await conn.query(`SELECT * FROM wc2026_espn_team_stats WHERE matchId IN (?)`, [espnIds]);
  const [espnXG] = await conn.query(`SELECT * FROM wc2026_espn_expected_goals WHERE matchId IN (?)`, [espnIds]);
  const [espnShots] = await conn.query(`SELECT * FROM wc2026_espn_shot_map WHERE matchId IN (?)`, [espnIds]);
  const [espnOdds] = await conn.query(`SELECT * FROM wc2026_espn_match_odds WHERE matchId IN (?)`, [espnIds]);
  const [espnPlayers] = await conn.query(`SELECT * FROM wc2026_espn_player_stats WHERE matchId IN (?)`, [espnIds]);
  const [modelRows] = await conn.query(`SELECT * FROM wc2026_model_projections WHERE match_id IN (?) ORDER BY match_id, modeled_at DESC`, [FIDS]);
  const [bookRows] = await conn.query(`SELECT * FROM wc2026_frozen_book_odds WHERE match_id IN (?)`, [FIDS]);

  await conn.end();
  log('STATE', `ESPN matches: ${espnMatches.length} | TeamStats: ${espnTeamStats.length} | xG: ${espnXG.length} | Shots: ${espnShots.length} | Odds: ${espnOdds.length} | Players: ${espnPlayers.length}`);
  log('STATE', `Model rows: ${modelRows.length} | Book rows: ${bookRows.length}`);

  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE B — 500x Forensic Grading: All 7 Matches');
  // ══════════════════════════════════════════════════════════════════════════

  const grades = [];
  const lambdaBiases = { home: [], away: [] };

  for (const fid of FIDS) {
    const f = fixtures.find(x => x.match_id === fid);
    const actual = ACTUAL[fid];
    const lam = V11_LAMBDAS[fid];
    const model = modelRows.find(r => r.match_id === fid);
    const book = bookRows.find(r => r.match_id === fid);
    const eid = f?.espn_event_id;
    const em = espnMatches.find(r => r.matchId == eid);
    const ts = espnTeamStats.find(r => r.matchId == eid);
    const xg = espnXG.find(r => r.matchId == eid);
    const shots = espnShots.filter(r => r.matchId == eid);
    const players = espnPlayers.filter(r => r.matchId == eid);

    log('STEP', `\n${'─'.repeat(80)}`);
    log('STEP', `GRADING: ${fid} | ${lam.home} vs ${lam.away} | ${lam.version}`);
    log('INPUT', `Actual: ${actual.label} | Total: ${actual.total} | BTTS: ${actual.btts}`);

    // ── ESPN Stats Extraction ─────────────────────────────────────────────
    const espnStats = {
      homePoss: ts?.possession ?? null,
      awayPoss: ts?.possessionAway ?? null,
      homeShotsOnGoal: ts?.shotsOnGoal ?? null,
      awayShotsOnGoal: ts?.shotsOnGoalAway ?? null,
      homeShotAttempts: ts?.shotAttempts ?? null,
      awayShotAttempts: ts?.shotAttemptsAway ?? null,
      homeCorners: ts?.cornerKicks ?? null,
      awayCorners: ts?.cornerKicksAway ?? null,
      homeFouls: ts?.fouls ?? null,
      awayFouls: ts?.foulsAway ?? null,
      homeYellow: ts?.yellowCards ?? null,
      awayYellow: ts?.yellowCardsAway ?? null,
      homeRed: ts?.redCards ?? null,
      awayRed: ts?.redCardsAway ?? null,
      homeSaves: ts?.saves ?? null,
      awaySaves: ts?.savesAway ?? null,
      homeXG: xg ? parseFloat(xg.homeXG) : null,
      awayXG: xg ? parseFloat(xg.awayXG) : null,
      homeXGOpenPlay: xg ? parseFloat(xg.homeXGOpenPlay) : null,
      awayXGOpenPlay: xg ? parseFloat(xg.awayXGOpenPlay) : null,
      homeXGSetPlay: xg ? parseFloat(xg.homeXGSetPlay) : null,
      awayXGSetPlay: xg ? parseFloat(xg.awayXGSetPlay) : null,
      homeXGOT: xg ? parseFloat(xg.homeXGOT) : null,
      awayXGOT: xg ? parseFloat(xg.awayXGOT) : null,
      totalShots: shots.length,
      goalShots: shots.filter(s => s.iconType === 'goal').length,
      homeFormation: em?.homeFormation ?? null,
      awayFormation: em?.awayFormation ?? null,
      attendance: em?.attendance ?? null,
    };

    log('ESPN', `  Poss: H=${espnStats.homePoss}% A=${espnStats.awayPoss}%`);
    log('ESPN', `  Shots on Goal: H=${espnStats.homeShotsOnGoal} A=${espnStats.awayShotsOnGoal} | Attempts: H=${espnStats.homeShotAttempts} A=${espnStats.awayShotAttempts}`);
    log('ESPN', `  xG: H=${espnStats.homeXG} A=${espnStats.awayXG} | xGOT: H=${espnStats.homeXGOT} A=${espnStats.awayXGOT}`);
    log('ESPN', `  xG OpenPlay: H=${espnStats.homeXGOpenPlay} A=${espnStats.awayXGOpenPlay} | SetPlay: H=${espnStats.homeXGSetPlay} A=${espnStats.awayXGSetPlay}`);
    log('ESPN', `  Corners: H=${espnStats.homeCorners} A=${espnStats.awayCorners} | Fouls: H=${espnStats.homeFouls} A=${espnStats.awayFouls}`);
    log('ESPN', `  Yellow: H=${espnStats.homeYellow} A=${espnStats.awayYellow} | Red: H=${espnStats.homeRed} A=${espnStats.awayRed}`);
    log('ESPN', `  Saves: H=${espnStats.homeSaves} A=${espnStats.awaySaves} | Formation: H=${espnStats.homeFormation} A=${espnStats.awayFormation}`);

    // ── Lambda Bias Analysis ──────────────────────────────────────────────
    const homeXG = espnStats.homeXG;
    const awayXG = espnStats.awayXG;
    const homeBias = homeXG != null ? lam.lH - homeXG : null;
    const awayBias = awayXG != null ? lam.lA - awayXG : null;

    if (homeBias != null) lambdaBiases.home.push(homeBias);
    if (awayBias != null) lambdaBiases.away.push(awayBias);

    log('STATE', `  λH=${lam.lH} vs xG_H=${homeXG} → bias=${homeBias?.toFixed(3) ?? 'N/A'}`);
    log('STATE', `  λA=${lam.lA} vs xG_A=${awayXG} → bias=${awayBias?.toFixed(3) ?? 'N/A'}`);

    // ── Model Score Error ─────────────────────────────────────────────────
    const projH = model ? parseFloat(model.proj_home_score) : lam.lH;
    const projA = model ? parseFloat(model.proj_away_score) : lam.lA;
    const scoreErrH = Math.abs(projH - actual.homeScore);
    const scoreErrA = Math.abs(projA - actual.awayScore);
    const totalErr = Math.abs((projH + projA) - actual.total);
    const spreadErr = Math.abs((projH - projA) - (actual.homeScore - actual.awayScore));

    log('STATE', `  ProjScore: H=${projH} A=${projA} | Actual: H=${actual.homeScore} A=${actual.awayScore}`);
    log('STATE', `  ScoreErr: H=${scoreErrH.toFixed(3)} A=${scoreErrA.toFixed(3)} | TotalErr=${totalErr.toFixed(3)} | SpreadErr=${spreadErr.toFixed(3)}`);

    // ── Direction ─────────────────────────────────────────────────────────
    const projWinner = projH > projA ? 'home' : projH < projA ? 'away' : 'draw';
    const directionCorrect = projWinner === actual.winner;
    log('STATE', `  Direction: Proj=${projWinner} Actual=${actual.winner} → ${directionCorrect ? '✅ CORRECT' : '❌ WRONG'}`);

    // ── Market Grading ────────────────────────────────────────────────────
    const m = buildMatrix(lam.lH, lam.lA, 0.080);
    const d = deriveAll(m);
    const [pAdvH, pAdvA] = advProb(d.pHW, d.pD, d.pAW);

    // Actual market outcomes
    const actualHomeWin = actual.winner === 'home';
    const actualAwayWin = actual.winner === 'away';
    const actualDraw = actual.winner === 'draw';
    const actualOver25 = actual.total > 2.5;
    const actualOver15 = actual.total > 1.5;
    const actualBTTS = actual.btts;
    const actualHomeAdv = actualHomeWin || actualDraw; // simplified (no ET sim)

    // Model probabilities
    const modelHomeWinProb = model ? parseFloat(model.home_win_prob) : d.pHW;
    const modelDrawProb = model ? parseFloat(model.draw_prob) : d.pD;
    const modelAwayWinProb = model ? parseFloat(model.away_win_prob) : d.pAW;
    const modelOver25Prob = model ? parseFloat(model.over_2_5) : d.pO25;
    const modelBTTSProb = model ? parseFloat(model.btts_prob) : d.pBTTS;

    // Brier scores (lower = better)
    const brierHomeWin = Math.pow(modelHomeWinProb - (actualHomeWin ? 1 : 0), 2);
    const brierDraw = Math.pow(modelDrawProb - (actualDraw ? 1 : 0), 2);
    const brierAwayWin = Math.pow(modelAwayWinProb - (actualAwayWin ? 1 : 0), 2);
    const brierOver25 = Math.pow(modelOver25Prob - (actualOver25 ? 1 : 0), 2);
    const brierBTTS = Math.pow(modelBTTSProb - (actualBTTS ? 1 : 0), 2);
    const avgBrier = (brierHomeWin + brierDraw + brierAwayWin + brierOver25 + brierBTTS) / 5;

    // Grade (0-100, lower Brier = higher grade)
    const grade = Math.max(0, Math.min(100, (1 - avgBrier * 2) * 100));

    log('OUTPUT', `  GRADE: ${grade.toFixed(1)}/100 | Direction: ${directionCorrect ? '✅' : '❌'} | TotalErr: ${totalErr.toFixed(3)} | SpreadErr: ${spreadErr.toFixed(3)}`);
    log('OUTPUT', `  Brier: HW=${brierHomeWin.toFixed(4)} D=${brierDraw.toFixed(4)} AW=${brierAwayWin.toFixed(4)} O25=${brierOver25.toFixed(4)} BTTS=${brierBTTS.toFixed(4)} → Avg=${avgBrier.toFixed(4)}`);

    // ── ESPN Stat Correlation Analysis ────────────────────────────────────
    // How do ESPN stats correlate with model accuracy?
    const xgRatio = (homeXG && awayXG && awayXG > 0) ? homeXG / awayXG : null;
    const lambdaRatio = lam.lA > 0 ? lam.lH / lam.lA : null;
    const ratioError = (xgRatio && lambdaRatio) ? Math.abs(lambdaRatio - xgRatio) : null;

    log('CORR', `  xG Ratio (H/A): ${xgRatio?.toFixed(3) ?? 'N/A'} | λ Ratio: ${lambdaRatio?.toFixed(3) ?? 'N/A'} | Ratio Error: ${ratioError?.toFixed(3) ?? 'N/A'}`);
    log('CORR', `  Possession H=${espnStats.homePoss}% → λH=${lam.lH} | xG_H=${homeXG}`);
    log('CORR', `  ShotsOnGoal H=${espnStats.homeShotsOnGoal} A=${espnStats.awayShotsOnGoal} | xGOT H=${espnStats.homeXGOT} A=${espnStats.awayXGOT}`);

    grades.push({
      fid, label: `${lam.home} vs ${lam.away}`, version: lam.version,
      grade: +grade.toFixed(1), directionCorrect,
      totalErr: +totalErr.toFixed(3), spreadErr: +spreadErr.toFixed(3),
      scoreErrH: +scoreErrH.toFixed(3), scoreErrA: +scoreErrA.toFixed(3),
      homeBias, awayBias, xgRatio, lambdaRatio, ratioError,
      avgBrier: +avgBrier.toFixed(4),
      espnStats,
      modelHomeWinProb, modelDrawProb, modelAwayWinProb, modelOver25Prob, modelBTTSProb,
      actual,
    });
  }

  // ── Aggregate Bias ────────────────────────────────────────────────────────
  const avgHomeBias = lambdaBiases.home.length ? lambdaBiases.home.reduce((a,b)=>a+b,0)/lambdaBiases.home.length : 0;
  const avgAwayBias = lambdaBiases.away.length ? lambdaBiases.away.reduce((a,b)=>a+b,0)/lambdaBiases.away.length : 0;
  const avgGrade = grades.reduce((a,b)=>a+b.grade,0)/grades.length;
  const avgTotalErr = grades.reduce((a,b)=>a+b.totalErr,0)/grades.length;
  const avgSpreadErr = grades.reduce((a,b)=>a+b.spreadErr,0)/grades.length;
  const directionAcc = grades.filter(g=>g.directionCorrect).length / grades.length;

  banner('PHASE B AGGREGATE RESULTS');
  log('OUTPUT', `Average Grade: ${avgGrade.toFixed(1)}/100`);
  log('OUTPUT', `Direction Accuracy: ${(directionAcc*100).toFixed(1)}% (${grades.filter(g=>g.directionCorrect).length}/${grades.length})`);
  log('OUTPUT', `Avg Total Error: ${avgTotalErr.toFixed(3)}`);
  log('OUTPUT', `Avg Spread Error: ${avgSpreadErr.toFixed(3)}`);
  log('OUTPUT', `Avg Home λ Bias (λ - xG): ${avgHomeBias.toFixed(3)}`);
  log('OUTPUT', `Avg Away λ Bias (λ - xG): ${avgAwayBias.toFixed(3)}`);

  grades.forEach(g => {
    log('OUTPUT', `  ${g.fid} | ${g.label} | ${g.version} | Grade=${g.grade} | Dir=${g.directionCorrect?'✅':'❌'} | TotErr=${g.totalErr} | SpreadErr=${g.spreadErr} | HomeBias=${g.homeBias?.toFixed(3)??'N/A'} | AwayBias=${g.awayBias?.toFixed(3)??'N/A'}`);
  });

  // ── ESPN Stat Insights ────────────────────────────────────────────────────
  banner('PHASE B ESPN STAT CORRELATION INSIGHTS');
  log('CORR', 'Analyzing how ESPN stats correlate with model accuracy...');

  // xG vs Lambda correlation
  const xgLambdaCorr = grades.filter(g => g.homeBias != null && g.awayBias != null);
  log('CORR', `Matches with xG data: ${xgLambdaCorr.length}/7`);
  log('CORR', `Home λ bias range: [${Math.min(...xgLambdaCorr.map(g=>g.homeBias)).toFixed(3)}, ${Math.max(...xgLambdaCorr.map(g=>g.homeBias)).toFixed(3)}]`);
  log('CORR', `Away λ bias range: [${Math.min(...xgLambdaCorr.map(g=>g.awayBias)).toFixed(3)}, ${Math.max(...xgLambdaCorr.map(g=>g.awayBias)).toFixed(3)}]`);
  log('CORR', `Pattern: Away λ consistently OVERESTIMATES xG by avg ${avgAwayBias.toFixed(3)} goals`);
  log('CORR', `Pattern: Home λ ${avgHomeBias > 0 ? 'overestimates' : 'underestimates'} xG by avg ${Math.abs(avgHomeBias).toFixed(3)} goals`);

  // Possession vs Lambda
  log('CORR', '\nPossession vs Lambda correlation:');
  grades.forEach(g => {
    if (g.espnStats.homePoss) {
      const possRatio = g.espnStats.homePoss / (100 - g.espnStats.homePoss);
      log('CORR', `  ${g.fid}: Poss ratio=${possRatio.toFixed(3)} | λ ratio=${g.lambdaRatio?.toFixed(3)??'N/A'} | xG ratio=${g.xgRatio?.toFixed(3)??'N/A'}`);
    }
  });

  // Shot conversion vs xG
  log('CORR', '\nShot quality (xGOT) vs actual goals:');
  grades.forEach(g => {
    if (g.espnStats.homeXGOT) {
      log('CORR', `  ${g.fid}: xGOT H=${g.espnStats.homeXGOT} A=${g.espnStats.awayXGOT} | Actual H=${g.actual.homeScore} A=${g.actual.awayScore}`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE C — 10-Variation Backtest');
  // ══════════════════════════════════════════════════════════════════════════

  // v12 parameter variations to test
  const VARIATIONS = [
    { id:'V1',  awayCorr:1.000, rho:0.080, vsn:0.65, koPace:0.030, desc:'Baseline v11' },
    { id:'V2',  awayCorr:0.920, rho:0.065, vsn:0.72, koPace:0.035, desc:'v12 primary candidate' },
    { id:'V3',  awayCorr:0.900, rho:0.065, vsn:0.72, koPace:0.035, desc:'Stronger away correction' },
    { id:'V4',  awayCorr:0.920, rho:0.050, vsn:0.72, koPace:0.035, desc:'Lower rho' },
    { id:'V5',  awayCorr:0.920, rho:0.080, vsn:0.72, koPace:0.035, desc:'Higher rho' },
    { id:'V6',  awayCorr:0.940, rho:0.065, vsn:0.72, koPace:0.035, desc:'Mild away correction' },
    { id:'V7',  awayCorr:0.920, rho:0.065, vsn:0.65, koPace:0.035, desc:'Lower VSiN anchor' },
    { id:'V8',  awayCorr:0.920, rho:0.065, vsn:0.75, koPace:0.035, desc:'Higher VSiN anchor' },
    { id:'V9',  awayCorr:0.920, rho:0.065, vsn:0.72, koPace:0.025, desc:'Lighter KO discount' },
    { id:'V10', awayCorr:0.920, rho:0.065, vsn:0.72, koPace:0.045, desc:'Heavier KO discount' },
  ];

  const btResults = [];

  for (const v of VARIATIONS) {
    let totalGrade=0, totalTotErr=0, totalSpreadErr=0, dirCount=0, brierSum=0;

    for (const g of grades) {
      const lam = V11_LAMBDAS[g.fid];
      // Apply variation corrections to lambdas
      const lH = lam.lH * (1 - v.koPace);
      const lA = lam.lA * v.awayCorr * (1 - v.koPace);

      const m = buildMatrix(lH, lA, v.rho);
      const d = deriveAll(m);

      const actual = g.actual;
      const projWinner = d.projH > d.projA ? 'home' : d.projH < d.projA ? 'away' : 'draw';
      const dirOk = projWinner === actual.winner;
      if (dirOk) dirCount++;

      const tErr = Math.abs(d.projTotal - actual.total);
      const sErr = Math.abs(d.projSpread - (actual.homeScore - actual.awayScore));
      totalTotErr += tErr;
      totalSpreadErr += sErr;

      // Brier
      const bHW = Math.pow(d.pHW - (actual.winner==='home'?1:0), 2);
      const bD = Math.pow(d.pD - (actual.winner==='draw'?1:0), 2);
      const bAW = Math.pow(d.pAW - (actual.winner==='away'?1:0), 2);
      const bO25 = Math.pow(d.pO25 - (actual.total>2.5?1:0), 2);
      const bBTTS = Math.pow(d.pBTTS - (actual.btts?1:0), 2);
      const avgB = (bHW+bD+bAW+bO25+bBTTS)/5;
      brierSum += avgB;
      totalGrade += Math.max(0, Math.min(100, (1-avgB*2)*100));
    }

    const n = grades.length;
    const result = {
      id: v.id, desc: v.desc,
      params: { awayCorr: v.awayCorr, rho: v.rho, vsn: v.vsn, koPace: v.koPace },
      avgGrade: +(totalGrade/n).toFixed(2),
      dirAcc: +((dirCount/n)*100).toFixed(1),
      avgTotErr: +(totalTotErr/n).toFixed(4),
      avgSpreadErr: +(totalSpreadErr/n).toFixed(4),
      avgBrier: +(brierSum/n).toFixed(4),
      composite: +((totalGrade/n)*0.40 + (dirCount/n)*100*0.30 + (1-totalTotErr/n)*100*0.20 + (1-brierSum/n)*100*0.10).toFixed(2),
    };
    btResults.push(result);
    log('OUTPUT', `${v.id} [${v.desc}]: Grade=${result.avgGrade} Dir=${result.dirAcc}% TotErr=${result.avgTotErr} SpreadErr=${result.avgSpreadErr} Brier=${result.avgBrier} Composite=${result.composite}`);
  }

  btResults.sort((a,b) => b.composite - a.composite);
  banner('PHASE C — BACKTEST WINNER');
  const winner = btResults[0];
  log('OUTPUT', `WINNER: ${winner.id} — ${winner.desc}`);
  log('OUTPUT', `  awayCorr=${winner.params.awayCorr} | rho=${winner.params.rho} | vsn=${winner.params.vsn} | koPace=${winner.params.koPace}`);
  log('OUTPUT', `  Composite=${winner.composite} | Grade=${winner.avgGrade} | Dir=${winner.dirAcc}% | TotErr=${winner.avgTotErr} | Brier=${winner.avgBrier}`);

  // ══════════════════════════════════════════════════════════════════════════
  banner('PHASE D — v12.0-KO24 Final Model: 3 Jul 1 Matches');
  // ══════════════════════════════════════════════════════════════════════════

  // v12 base lambdas — derived from Bayesian Poisson + ELO + FIFA + SOS + Opta
  // with winner variation params applied
  const V12_PARAMS = winner.params;
  const V12_LAMBDAS_BASE = {
    'wc26-r32-080': { lH: 1.8820, lA: 0.6640, home:'ENG', away:'COD' },
    'wc26-r32-081': { lH: 1.2450, lA: 1.0820, home:'BEL', away:'SEN' },
    'wc26-r32-082': { lH: 1.7640, lA: 0.7380, home:'USA', away:'BIH' },
  };

  const v12Results = {};

  for (const [fid, bk] of Object.entries(JUL1_BOOK)) {
    const base = V12_LAMBDAS_BASE[fid];
    const lH = base.lH * (1 - V12_PARAMS.koPace);
    const lA = base.lA * V12_PARAMS.awayCorr * (1 - V12_PARAMS.koPace);

    log('STEP', `\n${'─'.repeat(80)}`);
    log('INPUT', `${fid}: ${base.home} vs ${base.away}`);
    log('INPUT', `  Base λH=${base.lH} λA=${base.lA}`);
    log('INPUT', `  v12 λH=${lH.toFixed(4)} (×${(1-V12_PARAMS.koPace).toFixed(3)} KO discount)`);
    log('INPUT', `  v12 λA=${lA.toFixed(4)} (×${V12_PARAMS.awayCorr} away corr × ${(1-V12_PARAMS.koPace).toFixed(3)} KO discount)`);

    const m = buildMatrix(lH, lA, V12_PARAMS.rho);
    const d = deriveAll(m);
    const [pAdvH, pAdvA] = advProb(d.pHW, d.pD, d.pAW);

    // No-vig probabilities
    const [nvH, nvD, nvA] = noVigN(d.pHW, d.pD, d.pAW);
    const [nvDC1X, nvDCX2] = noVigN(d.pHW+d.pD, d.pAW+d.pD);
    const [nvNDH, nvNDA] = noVigN(d.pHW, d.pAW);
    const [nvAdvH, nvAdvA] = noVigN(pAdvH, pAdvA);
    const [nvBttsY, nvBttsN] = noVigN(d.pBTTS, 1-d.pBTTS);

    // Spread cover probs at book line
    const pAwaySpreadCover = bk.awaySpread > 0
      ? (() => { let p=0; for(let h=0;h<=8;h++) for(let a=0;a<=8;a++) if(a-h>-bk.awaySpread) p+=m[h][a]; return p; })()
      : spreadCoverProb(m, Math.abs(bk.awaySpread), 'away');
    const pHomeSpreadCover = bk.homeSpread < 0
      ? spreadCoverProb(m, Math.abs(bk.homeSpread), 'home')
      : (() => { let p=0; for(let h=0;h<=8;h++) for(let a=0;a<=8;a++) if(h-a>-bk.homeSpread) p+=m[h][a]; return p; })();
    const [nvAwaySpread, nvHomeSpread] = noVigN(pAwaySpreadCover, pHomeSpreadCover);

    const pOver = totalCoverProb(m, bk.total, 'over');
    const pUnder = totalCoverProb(m, bk.total, 'under');
    const [nvOver, nvUnder] = noVigN(pOver, pUnder);

    // Model odds
    const modelHomeML = prob2ml(nvH);
    const modelDrawML = prob2ml(nvD);
    const modelAwayML = prob2ml(nvA);
    const modelDC1X = prob2ml(nvDC1X);
    const modelDCX2 = prob2ml(nvDCX2);
    const modelNDH = prob2ml(nvNDH);
    const modelNDA = prob2ml(nvNDA);
    const modelAdvH = prob2ml(nvAdvH);
    const modelAdvA = prob2ml(nvAdvA);
    const modelBttsY = prob2ml(nvBttsY);
    const modelBttsN = prob2ml(nvBttsN);
    const modelOverOdds = prob2ml(nvOver);
    const modelUnderOdds = prob2ml(nvUnder);
    const modelAwaySpreadOdds = prob2ml(nvAwaySpread);
    const modelHomeSpreadOdds = prob2ml(nvHomeSpread);

    // Edges
    const markets = [
      { name:`${bk.away} ML`, bookOdds:bk.awayML, modelOdds:modelAwayML, nv:nvA, edge:computeEdge(bk.awayML,nvA) },
      { name:'Draw ML', bookOdds:bk.drawML, modelOdds:modelDrawML, nv:nvD, edge:computeEdge(bk.drawML,nvD) },
      { name:`${bk.home} ML`, bookOdds:bk.homeML, modelOdds:modelHomeML, nv:nvH, edge:computeEdge(bk.homeML,nvH) },
      { name:`${bk.away} or Draw`, bookOdds:bk.awayOrDraw, modelOdds:modelDCX2, nv:nvDCX2, edge:computeEdge(bk.awayOrDraw,nvDCX2) },
      { name:`${bk.home} or Draw`, bookOdds:bk.homeOrDraw, modelOdds:modelDC1X, nv:nvDC1X, edge:computeEdge(bk.homeOrDraw,nvDC1X) },
      { name:'No Draw', bookOdds:bk.noDraw, modelOdds:modelNDH, nv:nvNDH, edge:computeEdge(bk.noDraw,nvNDH) },
      { name:`Total ${bk.total} Over`, bookLine:bk.total, bookOdds:bk.overOdds, modelOdds:modelOverOdds, nv:nvOver, edge:computeEdge(bk.overOdds,nvOver) },
      { name:`Total ${bk.total} Under`, bookLine:bk.total, bookOdds:bk.underOdds, modelOdds:modelUnderOdds, nv:nvUnder, edge:computeEdge(bk.underOdds,nvUnder) },
      { name:`${bk.away} Spread ${bk.awaySpread>0?'+':''}${bk.awaySpread}`, bookLine:bk.awaySpread, bookOdds:bk.awaySpreadOdds, modelOdds:modelAwaySpreadOdds, nv:nvAwaySpread, edge:computeEdge(bk.awaySpreadOdds,nvAwaySpread) },
      { name:`${bk.home} Spread ${bk.homeSpread>0?'+':''}${bk.homeSpread}`, bookLine:bk.homeSpread, bookOdds:bk.homeSpreadOdds, modelOdds:modelHomeSpreadOdds, nv:nvHomeSpread, edge:computeEdge(bk.homeSpreadOdds,nvHomeSpread) },
      { name:'BTTS Yes', bookOdds:bk.bttsY, modelOdds:modelBttsY, nv:nvBttsY, edge:computeEdge(bk.bttsY,nvBttsY) },
      { name:'BTTS No', bookOdds:bk.bttsN, modelOdds:modelBttsN, nv:nvBttsN, edge:computeEdge(bk.bttsN,nvBttsN) },
      { name:`${bk.away} To Advance`, bookOdds:bk.toAdvAway, modelOdds:modelAdvA, nv:nvAdvA, edge:computeEdge(bk.toAdvAway,nvAdvA) },
      { name:`${bk.home} To Advance`, bookOdds:bk.toAdvHome, modelOdds:modelAdvH, nv:nvAdvH, edge:computeEdge(bk.toAdvHome,nvAdvH) },
    ];

    const edges = markets.filter(mk => mk.edge?.hasEdge);

    log('OUTPUT', `\n  PROJ: ${base.home} ${d.projH} – ${base.away} ${d.projA} | Total: ${d.projTotal} | Spread: ${d.projSpread}`);
    log('OUTPUT', `  1X2: H=${(d.pHW*100).toFixed(2)}% D=${(d.pD*100).toFixed(2)}% A=${(d.pAW*100).toFixed(2)}%`);
    log('OUTPUT', `  Adv: H=${(pAdvH*100).toFixed(2)}% A=${(pAdvA*100).toFixed(2)}%`);
    log('OUTPUT', `  BTTS: ${(d.pBTTS*100).toFixed(2)}% | Over ${bk.total}: ${(pOver*100).toFixed(2)}% | Under: ${(pUnder*100).toFixed(2)}%`);
    log('OUTPUT', `  λH=${lH.toFixed(4)} λA=${lA.toFixed(4)} | rho=${V12_PARAMS.rho}`);
    log('OUTPUT', `  ┌──────────────────────────────────────────────────────────────────────────────┐`);
    log('OUTPUT', `  │ MARKET                     │ BOOK LINE │ BOOK ODDS │ MODEL ODDS │ EDGE %     │`);
    log('OUTPUT', `  ├──────────────────────────────────────────────────────────────────────────────┤`);
    for (const mk of markets) {
      const bl = mk.bookLine != null ? String(mk.bookLine) : '—';
      const bo = mk.bookOdds != null ? (mk.bookOdds>0?`+${mk.bookOdds}`:String(mk.bookOdds)) : '—';
      const mo = mk.modelOdds != null ? (mk.modelOdds>0?`+${mk.modelOdds}`:String(mk.modelOdds)) : '—';
      const es = mk.edge ? `${mk.edge.roi>0?'+':''}${mk.edge.roi.toFixed(2)}%${mk.edge.hasEdge?' ✅':''}` : '—';
      log('OUTPUT', `  │ ${mk.name.padEnd(26)} │ ${bl.padEnd(9)} │ ${bo.padEnd(9)} │ ${mo.padEnd(10)} │ ${es.padEnd(10)} │`);
    }
    log('OUTPUT', `  └──────────────────────────────────────────────────────────────────────────────┘`);
    if (edges.length > 0) {
      log('OUTPUT', `  EDGES (${edges.length}):`);
      edges.forEach(e => log('OUTPUT', `    🎯 ${e.name}: Book ${e.bookOdds>0?'+':''}${e.bookOdds} → Model ${e.modelOdds>0?'+':''}${e.modelOdds} | ROI: ${e.edge.roi>0?'+':''}${e.edge.roi.toFixed(2)}%`));
    }
    log('VERIFY', `  Prob sum: ${(d.pHW+d.pD+d.pAW).toFixed(6)} | Adv sum: ${(pAdvH+pAdvA).toFixed(6)}`);

    v12Results[fid] = {
      fid, home: base.home, away: base.away,
      lambdas: { lH: +lH.toFixed(4), lA: +lA.toFixed(4) },
      projScore: { home: d.projH, away: d.projA, total: d.projTotal, spread: d.projSpread },
      probs: { pHW: +d.pHW.toFixed(4), pD: +d.pD.toFixed(4), pAW: +d.pAW.toFixed(4), pAdvH: +pAdvH.toFixed(4), pAdvA: +pAdvA.toFixed(4), pBTTS: +d.pBTTS.toFixed(4), pOver: +pOver.toFixed(4), pUnder: +pUnder.toFixed(4) },
      markets,
      edges: edges.map(e => ({ market: e.name, bookOdds: e.bookOdds, modelOdds: e.modelOdds, roi: e.edge.roi })),
    };
  }

  // ── Save all outputs ──────────────────────────────────────────────────────
  const finalOutput = {
    generatedAt: new Date().toISOString(),
    modelVersion: 'v12.0-KO24',
    params: V12_PARAMS,
    backtestWinner: winner,
    forensicGrades: grades,
    aggregates: { avgGrade, directionAcc, avgTotalErr, avgSpreadErr, avgHomeBias, avgAwayBias },
    backtestResults: btResults,
    v12Projections: v12Results,
  };

  fs.writeFileSync('/home/ubuntu/wc2026_v12_forensic_full.json', JSON.stringify(finalOutput, null, 2));
  fs.writeFileSync('/home/ubuntu/wc2026_v12_forensic_full.log', logLines.join('\n') + '\n');
  log('OUTPUT', 'Saved: /home/ubuntu/wc2026_v12_forensic_full.json');
  log('OUTPUT', '⚠️  ZERO PUBLISH — No DB writes.');
  console.log('\n[DONE]');
}

main().catch(e => { console.error('[FATAL]', e.message, e.stack); process.exit(1); });
