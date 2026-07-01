/**
 * v12_fullmarket_crossref.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * WC2026 v12.0-KO24 — 500x Full-Market Book vs Model Cross-Reference
 * All 12 R32/R16 Fixtures | All 18 Markets per Game
 *
 * MARKETS COVERED:
 *   1.  Away ML
 *   2.  Draw ML
 *   3.  Home ML
 *   4.  Away or Draw (DC X2)
 *   5.  Home or Draw (DC 1X)
 *   6.  No Draw (Away or Home)
 *   7.  Total Line + Over Odds
 *   8.  Total Line + Under Odds
 *   9.  Away Spread + Away Spread Odds
 *   10. Home Spread + Home Spread Odds
 *   11. BTTS Yes
 *   12. BTTS No
 *   13. Away To Advance
 *   14. Home To Advance
 *
 * For each market:
 *   - Book line/odds (from user-provided table)
 *   - Model line/odds (from v12 Dixon-Coles engine)
 *   - No-vig implied probability (book)
 *   - No-vig implied probability (model)
 *   - Edge = model_nv_prob - book_nv_prob
 *   - ROI = edge / book_vig_prob
 *   - Edge flag: YES if |ROI| >= 3.0%
 * ══════════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';

// ── Logger ────────────────────────────────────────────────────────────────────
const logLines = [];
function ts() { return new Date().toISOString(); }
function log(level, msg) {
  const line = `[${ts()}] ${String(level).padEnd(7)} │ ${msg}`;
  console.log(line); logLines.push(line);
}
function banner(msg) {
  const b = '═'.repeat(80);
  [`${b}`, `  ${msg}`, `${b}`].forEach(l => log('BANNER', l));
}

// ── Math ──────────────────────────────────────────────────────────────────────
function ml2prob(ml) {
  if (ml == null || ml === 0) return null;
  return ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
}
function prob2ml(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  const ml = p >= 0.5 ? -(p / (1 - p)) * 100 : (1 - p) / p * 100;
  return parseFloat(ml.toFixed(2));
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
  let pHW = 0, pD = 0, pAW = 0, pO25 = 0, pO15 = 0, pO35 = 0, pBTTS = 0;
  let pH1 = 0, pA1 = 0, pH15 = 0, pA15 = 0, pH2 = 0, pA2 = 0;
  let projH = 0, projA = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = m[h][a];
      projH += h * p; projA += a * p;
      if (h > a) pHW += p;
      else if (h === a) pD += p;
      else pAW += p;
      if (h + a > 1.5) pO15 += p;
      if (h + a > 2.5) pO25 += p;
      if (h + a > 3.5) pO35 += p;
      if (h > 0 && a > 0) pBTTS += p;
      if (h - a > 0.5) pH1 += p;   // home -0.5 cover
      if (a - h > 0.5) pA1 += p;   // away -0.5 cover
      if (h - a > 1.5) pH15 += p;  // home -1.5 cover
      if (a - h > 1.5) pA15 += p;  // away -1.5 cover
      if (h - a > 2.5) pH2 += p;
      if (a - h > 2.5) pA2 += p;
    }
  }
  return {
    pHW, pD, pAW, pO25, pO15, pO35, pBTTS,
    pH1, pA1, pH15, pA15, pH2, pA2,
    projH: parseFloat(projH.toFixed(4)),
    projA: parseFloat(projA.toFixed(4)),
    projTotal: parseFloat((projH + projA).toFixed(4)),
    projSpread: parseFloat((projH - projA).toFixed(4)),
  };
}
function advProb(pHW, pD, pAW, etFactor = 0.50) {
  const pAdvH = pHW + pD * etFactor;
  const pAdvA = pAW + pD * (1 - etFactor);
  const s = pAdvH + pAdvA;
  return [pAdvH / s, pAdvA / s];
}

// Edge computation
function computeEdge(bookML, modelProb) {
  if (bookML == null || modelProb == null) return null;
  const bookProb = ml2prob(bookML);
  if (!bookProb) return null;
  const edge = modelProb - bookProb;
  const roi = edge / bookProb;
  return {
    bookProb: parseFloat((bookProb * 100).toFixed(3)),
    modelProb: parseFloat((modelProb * 100).toFixed(3)),
    edge: parseFloat((edge * 100).toFixed(3)),
    roi: parseFloat((roi * 100).toFixed(3)),
    hasEdge: Math.abs(roi * 100) >= 3.0,
  };
}

// Spread cover probability at a given line
function spreadCoverProb(m, line, side, maxG = 8) {
  // side = 'home' → home wins by more than |line|
  // side = 'away' → away wins by more than |line|
  let p = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const diff = h - a;
      if (side === 'home' && diff > Math.abs(line)) p += m[h][a];
      if (side === 'away' && diff < -Math.abs(line)) p += m[h][a];
    }
  }
  return p;
}

// Total cover probability at a given line
function totalCoverProb(m, line, side, maxG = 8) {
  let p = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const tot = h + a;
      if (side === 'over' && tot > line) p += m[h][a];
      if (side === 'under' && tot < line) p += m[h][a];
    }
  }
  return p;
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOK LINES — from user-provided table (exact values)
// ══════════════════════════════════════════════════════════════════════════════
const BOOK = {
  'wc26-r32-080': { away: 'COD', home: 'ENG', awayML: 1100, drawML: 400, homeML: -345, awayOrDraw: 250, homeOrDraw: -2000, noDraw: -588, total: 2.5, overOdds: 103, underOdds: -120, awaySpread: 1.5, awaySpreadOdds: -111, homeSpread: -1.5, homeSpreadOdds: -105, bttsY: 163, bttsN: -227, toAdvAway: 600, toAdvHome: -1100 },
  'wc26-r32-081': { away: 'SEN', home: 'BEL', awayML: 270, drawML: 220, homeML: 115, awayOrDraw: -149, homeOrDraw: -345, noDraw: -278, total: 2.5, overOdds: 100, underOdds: -118, awaySpread: 1.5, awaySpreadOdds: -435, homeSpread: -1.5, homeSpreadOdds: 300, bttsY: -133, bttsN: 100, toAdvAway: 135, toAdvHome: -175 },
  'wc26-r32-082': { away: 'BIH', home: 'USA', awayML: 600, drawML: 400, homeML: -250, awayOrDraw: 175, homeOrDraw: -1000, noDraw: -588, total: 2.5, overOdds: -137, underOdds: 110, awaySpread: 1.5, awaySpreadOdds: -137, homeSpread: -1.5, homeSpreadOdds: 108, bttsY: -105, bttsN: -125, toAdvAway: 450, toAdvHome: -700 },
  'wc26-r32-083': { away: 'AUT', home: 'ESP', awayML: 750, drawML: 425, homeML: -303, awayOrDraw: 225, homeOrDraw: -1250, noDraw: -588, total: 2.5, overOdds: -125, underOdds: 100, awaySpread: 1.5, awaySpreadOdds: -120, homeSpread: -1.5, homeSpreadOdds: 103, bttsY: 120, bttsN: -161, toAdvAway: 475, toAdvHome: -750 },
  'wc26-r32-084': { away: 'CRO', home: 'POR', awayML: 400, drawML: 250, homeML: -133, awayOrDraw: 100, homeOrDraw: -588, noDraw: -345, total: 2.5, overOdds: 110, underOdds: -137, awaySpread: 1.5, awaySpreadOdds: -286, homeSpread: -1.5, homeSpreadOdds: 210, bttsY: -105, bttsN: -125, toAdvAway: 205, toAdvHome: -270 },
  'wc26-r32-085': { away: 'ALG', home: 'SUI', awayML: 320, drawML: 220, homeML: 100, awayOrDraw: -125, homeOrDraw: -455, noDraw: -278, total: 2.5, overOdds: 110, underOdds: -137, awaySpread: 1.5, awaySpreadOdds: -385, homeSpread: -1.5, homeSpreadOdds: 270, bttsY: -110, bttsN: -110, toAdvAway: 155, toAdvHome: -200 },
  'wc26-r32-086': { away: 'EGY', home: 'AUS', awayML: 145, drawML: 188, homeML: 240, awayOrDraw: -333, homeOrDraw: -189, noDraw: -250, total: 1.5, overOdds: -175, underOdds: 138, awaySpread: -1.5, awaySpreadOdds: 450, homeSpread: 1.5, homeSpreadOdds: -667, bttsY: 120, bttsN: -161, toAdvAway: -150, toAdvHome: 115 },
  'wc26-r32-087': { away: 'CPV', home: 'ARG', awayML: 1400, drawML: 650, homeML: -588, awayOrDraw: 400, homeOrDraw: -3333, noDraw: -1000, total: 2.5, overOdds: -149, underOdds: 120, awaySpread: 2.5, awaySpreadOdds: -189, homeSpread: -2.5, homeSpreadOdds: 142, bttsY: 175, bttsN: -250, toAdvAway: 950, toAdvHome: -2500 },
  'wc26-r32-088': { away: 'GHA', home: 'COL', awayML: 600, drawML: 290, homeML: -189, awayOrDraw: 138, homeOrDraw: -1000, noDraw: -400, total: 2.5, overOdds: 120, underOdds: -149, awaySpread: 1.5, awaySpreadOdds: -200, homeSpread: -1.5, homeSpreadOdds: 150, bttsY: 125, bttsN: -175, toAdvAway: 320, toAdvHome: -450 },
  'wc26-r16-089': { away: 'FRA', home: 'PAR', awayML: -500, drawML: 600, homeML: 1400, awayOrDraw: -3333, homeOrDraw: 333, noDraw: -1000, total: 2.5, overOdds: -175, underOdds: 138, awaySpread: -2.5, awaySpreadOdds: 142, homeSpread: 2.5, homeSpreadOdds: -189, bttsY: 138, bttsN: -189, toAdvAway: -2000, toAdvHome: 850 },
  'wc26-r16-090': { away: 'MAR', home: 'CAN', awayML: -125, drawML: 250, homeML: 375, awayOrDraw: -556, homeOrDraw: -105, noDraw: -345, total: 2.5, overOdds: 130, underOdds: -161, awaySpread: -1.5, awaySpreadOdds: 230, homeSpread: 1.5, homeSpreadOdds: -303, bttsY: 105, bttsN: -143, toAdvAway: -255, toAdvHome: 195 },
  'wc26-r16-091': { away: 'NOR', home: 'BRA', awayML: 320, drawML: 240, homeML: -111, awayOrDraw: -110, homeOrDraw: -455, noDraw: -333, total: 2.5, overOdds: -108, underOdds: -108, awaySpread: 1.5, awaySpreadOdds: -303, homeSpread: -1.5, homeSpreadOdds: 230, bttsY: -133, bttsN: 100, toAdvAway: 170, toAdvHome: -215 },
};

// ══════════════════════════════════════════════════════════════════════════════
// v12.0-KO24 BASE LAMBDAS
// Derived from Bayesian Poisson + ELO + FIFA + SOS + 8 Opta + KO24 trends
// Away λ correction: ×0.920 (–8% bias correction from forensic audit)
// ══════════════════════════════════════════════════════════════════════════════
const LAMBDAS = {
  // Jul 1 R32
  'wc26-r32-080': { lH: 1.8820, lA: 0.6640 * 0.920, label: 'ENG vs COD' },
  'wc26-r32-081': { lH: 1.2450, lA: 1.0820 * 0.920, label: 'BEL vs SEN' },
  'wc26-r32-082': { lH: 1.7640, lA: 0.7380 * 0.920, label: 'USA vs BIH' },
  // Jul 2 R32
  'wc26-r32-083': { lH: 1.9840, lA: 0.6210 * 0.920, label: 'ESP vs AUT' },
  'wc26-r32-084': { lH: 1.5620, lA: 0.9340 * 0.920, label: 'POR vs CRO' },
  'wc26-r32-085': { lH: 1.1840, lA: 1.0120 * 0.920, label: 'SUI vs ALG' },
  // Jul 3 R32
  'wc26-r32-086': { lH: 0.8240, lA: 1.1640 * 0.920, label: 'AUS vs EGY' },
  'wc26-r32-087': { lH: 2.3840, lA: 0.4820 * 0.920, label: 'ARG vs CPV' },
  // Jul 4 R32 + R16
  'wc26-r32-088': { lH: 1.6420, lA: 0.7640 * 0.920, label: 'COL vs GHA' },
  'wc26-r16-089': { lH: 0.5840, lA: 2.1840 * 0.920, label: 'PAR vs FRA' },
  'wc26-r16-090': { lH: 0.8640, lA: 1.3240 * 0.920, label: 'CAN vs MAR' },
  // Jul 5 R16
  'wc26-r16-091': { lH: 1.5640, lA: 1.0240 * 0.920, label: 'BRA vs NOR' },
};

const V12_RHO = 0.065;
const ET_FACTOR = 0.50;

// ══════════════════════════════════════════════════════════════════════════════
// RUN ALL 12 FIXTURES
// ══════════════════════════════════════════════════════════════════════════════
banner('v12.0-KO24 — 500x Full-Market Book vs Model Cross-Reference');
log('INPUT', `Fixtures: ${Object.keys(BOOK).length} | Markets per game: 18 | rho: ${V12_RHO} | ET factor: ${ET_FACTOR}`);

const results = [];

for (const [fid, bk] of Object.entries(BOOK)) {
  const lam = LAMBDAS[fid];
  if (!lam) { log('WARN', `No lambdas for ${fid} — skipping`); continue; }

  log('STEP', `Processing ${fid}: ${lam.label}`);

  const m = buildMatrix(lam.lH, lam.lA, V12_RHO);
  const d = deriveAll(m);
  const [pAdvH, pAdvA] = advProb(d.pHW, d.pD, d.pAW, ET_FACTOR);

  // No-vig 1X2
  const [nvH, nvD, nvA] = noVigN(d.pHW, d.pD, d.pAW);
  // No-vig DC
  const [nvDC1X, nvDCX2] = noVigN(d.pHW + d.pD, d.pAW + d.pD);
  // No-vig NoDraw
  const [nvNDH, nvNDA] = noVigN(d.pHW, d.pAW);
  // No-vig Adv
  const [nvAdvH, nvAdvA] = noVigN(pAdvH, pAdvA);
  // No-vig BTTS
  const [nvBttsY, nvBttsN] = noVigN(d.pBTTS, 1 - d.pBTTS);

  // Spread cover probs at book line
  const bookAwaySpreadAbs = Math.abs(bk.awaySpread);
  const bookHomeSpreadAbs = Math.abs(bk.homeSpread);
  // Away spread: if awaySpread > 0 → away is getting points (underdog), cover = away wins or loses by less than line
  // If awaySpread < 0 → away is laying points (favorite), cover = away wins by more than |line|
  let pAwaySpreadCover, pHomeSpreadCover;
  if (bk.awaySpread > 0) {
    // Away +N: away covers if away wins OR home wins by < N
    pAwaySpreadCover = 0;
    for (let h = 0; h <= 8; h++)
      for (let a = 0; a <= 8; a++)
        if (a - h > -bk.awaySpread) pAwaySpreadCover += m[h][a]; // diff > -N → a-h > -N
  } else {
    // Away -N: away covers if away wins by > |N|
    pAwaySpreadCover = spreadCoverProb(m, bookAwaySpreadAbs, 'away');
  }
  if (bk.homeSpread < 0) {
    // Home -N: home covers if home wins by > N
    pHomeSpreadCover = spreadCoverProb(m, bookHomeSpreadAbs, 'home');
  } else {
    // Home +N: home covers if home wins OR away wins by < N
    pHomeSpreadCover = 0;
    for (let h = 0; h <= 8; h++)
      for (let a = 0; a <= 8; a++)
        if (h - a > -bk.homeSpread) pHomeSpreadCover += m[h][a];
  }
  const [nvAwaySpread, nvHomeSpread] = noVigN(pAwaySpreadCover, pHomeSpreadCover);

  // Total cover probs at book line
  const pOver = totalCoverProb(m, bk.total, 'over');
  const pUnder = totalCoverProb(m, bk.total, 'under');
  const [nvOver, nvUnder] = noVigN(pOver, pUnder);

  // Model ML (raw, precise)
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
  const eHomeML = computeEdge(bk.homeML, nvH);
  const eDrawML = computeEdge(bk.drawML, nvD);
  const eAwayML = computeEdge(bk.awayML, nvA);
  const eDC1X = computeEdge(bk.homeOrDraw, nvDC1X);
  const eDCX2 = computeEdge(bk.awayOrDraw, nvDCX2);
  const eNDH = computeEdge(bk.noDraw, nvNDH);
  const eAdvH = computeEdge(bk.toAdvHome, nvAdvH);
  const eAdvA = computeEdge(bk.toAdvAway, nvAdvA);
  const eBttsY = computeEdge(bk.bttsY, nvBttsY);
  const eBttsN = computeEdge(bk.bttsN, nvBttsN);
  const eOver = computeEdge(bk.overOdds, nvOver);
  const eUnder = computeEdge(bk.underOdds, nvUnder);
  const eAwaySpread = computeEdge(bk.awaySpreadOdds, nvAwaySpread);
  const eHomeSpread = computeEdge(bk.homeSpreadOdds, nvHomeSpread);

  const markets = [
    { name: `${bk.away} ML`,          bookLine: null, bookOdds: bk.awayML,          modelLine: null, modelOdds: modelAwayML,      nv: nvA,         edge: eAwayML },
    { name: 'Draw ML',                  bookLine: null, bookOdds: bk.drawML,          modelLine: null, modelOdds: modelDrawML,      nv: nvD,         edge: eDrawML },
    { name: `${bk.home} ML`,          bookLine: null, bookOdds: bk.homeML,          modelLine: null, modelOdds: modelHomeML,      nv: nvH,         edge: eHomeML },
    { name: `${bk.away} or Draw`,     bookLine: null, bookOdds: bk.awayOrDraw,      modelLine: null, modelOdds: modelDCX2,        nv: nvDCX2,      edge: eDCX2 },
    { name: `${bk.home} or Draw`,     bookLine: null, bookOdds: bk.homeOrDraw,      modelLine: null, modelOdds: modelDC1X,        nv: nvDC1X,      edge: eDC1X },
    { name: 'No Draw',                  bookLine: null, bookOdds: bk.noDraw,          modelLine: null, modelOdds: modelNDH,         nv: nvNDH,       edge: eNDH },
    { name: `Total ${bk.total} Over`, bookLine: bk.total, bookOdds: bk.overOdds,    modelLine: bk.total, modelOdds: modelOverOdds,  nv: nvOver,      edge: eOver },
    { name: `Total ${bk.total} Under`,bookLine: bk.total, bookOdds: bk.underOdds,   modelLine: bk.total, modelOdds: modelUnderOdds, nv: nvUnder,     edge: eUnder },
    { name: `${bk.away} Spread ${bk.awaySpread > 0 ? '+' : ''}${bk.awaySpread}`, bookLine: bk.awaySpread, bookOdds: bk.awaySpreadOdds, modelLine: bk.awaySpread, modelOdds: modelAwaySpreadOdds, nv: nvAwaySpread, edge: eAwaySpread },
    { name: `${bk.home} Spread ${bk.homeSpread > 0 ? '+' : ''}${bk.homeSpread}`, bookLine: bk.homeSpread, bookOdds: bk.homeSpreadOdds, modelLine: bk.homeSpread, modelOdds: modelHomeSpreadOdds, nv: nvHomeSpread, edge: eHomeSpread },
    { name: 'BTTS Yes',                 bookLine: null, bookOdds: bk.bttsY,           modelLine: null, modelOdds: modelBttsY,       nv: nvBttsY,     edge: eBttsY },
    { name: 'BTTS No',                  bookLine: null, bookOdds: bk.bttsN,           modelLine: null, modelOdds: modelBttsN,       nv: nvBttsN,     edge: eBttsN },
    { name: `${bk.away} To Advance`,  bookLine: null, bookOdds: bk.toAdvAway,       modelLine: null, modelOdds: modelAdvA,        nv: nvAdvA,      edge: eAdvA },
    { name: `${bk.home} To Advance`,  bookLine: null, bookOdds: bk.toAdvHome,       modelLine: null, modelOdds: modelAdvH,        nv: nvAdvH,      edge: eAdvH },
  ];

  const edges = markets.filter(mk => mk.edge?.hasEdge).map(mk => ({
    market: mk.name,
    bookOdds: mk.bookOdds,
    modelOdds: mk.modelOdds,
    roi: mk.edge.roi,
  }));

  const result = {
    fid,
    label: lam.label,
    away: bk.away,
    home: bk.home,
    lambdas: { lH: parseFloat(lam.lH.toFixed(4)), lA: parseFloat((lam.lA).toFixed(4)) },
    projScore: { home: d.projH, away: d.projA, total: d.projTotal, spread: d.projSpread },
    markets,
    edges,
    probs: { pHW: d.pHW, pD: d.pD, pAW: d.pAW, pAdvH, pAdvA, pBTTS: d.pBTTS, pOver, pUnder },
  };
  results.push(result);

  // Console output
  log('OUTPUT', `\n  ══ ${fid}: ${lam.label} ══`);
  log('OUTPUT', `  λH=${lam.lH.toFixed(4)} λA=${lam.lA.toFixed(4)} | Proj: ${bk.home} ${d.projH} – ${bk.away} ${d.projA} | Total: ${d.projTotal} | Spread: ${d.projSpread}`);
  log('OUTPUT', `  1X2: H=${(d.pHW*100).toFixed(1)}% D=${(d.pD*100).toFixed(1)}% A=${(d.pAW*100).toFixed(1)}%`);
  log('OUTPUT', `  ┌─────────────────────────────────────────────────────────────────────────┐`);
  log('OUTPUT', `  │ MARKET                    │ BOOK LINE │ BOOK ODDS │ MODEL ODDS │ EDGE %  │`);
  log('OUTPUT', `  ├─────────────────────────────────────────────────────────────────────────┤`);
  for (const mk of markets) {
    const bLine = mk.bookLine !== null ? String(mk.bookLine) : '—';
    const bOdds = mk.bookOdds != null ? (mk.bookOdds > 0 ? `+${mk.bookOdds}` : String(mk.bookOdds)) : '—';
    const mOdds = mk.modelOdds != null ? (mk.modelOdds > 0 ? `+${mk.modelOdds.toFixed(1)}` : mk.modelOdds.toFixed(1)) : '—';
    const edgeStr = mk.edge ? `${mk.edge.roi > 0 ? '+' : ''}${mk.edge.roi.toFixed(2)}%${mk.edge.hasEdge ? ' ✅' : ''}` : '—';
    log('OUTPUT', `  │ ${mk.name.padEnd(25)} │ ${bLine.padEnd(9)} │ ${bOdds.padEnd(9)} │ ${mOdds.padEnd(10)} │ ${edgeStr.padEnd(8)} │`);
  }
  log('OUTPUT', `  └─────────────────────────────────────────────────────────────────────────┘`);
  if (edges.length > 0) {
    log('OUTPUT', `  EDGES DETECTED (${edges.length}):`);
    edges.forEach(e => log('OUTPUT', `    🎯 ${e.market}: Book ${e.bookOdds > 0 ? '+' : ''}${e.bookOdds} → Model ${e.modelOdds > 0 ? '+' : ''}${e.modelOdds?.toFixed(1)} | ROI: ${e.roi > 0 ? '+' : ''}${e.roi.toFixed(2)}%`));
  } else {
    log('OUTPUT', `  No edges detected (all ROI < 3.0%)`);
  }
  log('VERIFY', `  Prob sum: ${(d.pHW + d.pD + d.pAW).toFixed(6)} | Adv sum: ${(pAdvH + pAdvA).toFixed(6)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// EDGE MASTER TABLE
// ══════════════════════════════════════════════════════════════════════════════
banner('EDGE MASTER TABLE — All 12 Fixtures');
const allEdges = [];
for (const r of results) {
  for (const e of r.edges) {
    allEdges.push({ fid: r.fid, label: r.label, ...e });
  }
}
allEdges.sort((a, b) => Math.abs(b.roi) - Math.abs(a.roi));
log('OUTPUT', `Total edges detected: ${allEdges.length}`);
for (const e of allEdges) {
  log('OUTPUT', `  🎯 [${e.fid}] ${e.label} | ${e.market}: Book ${e.bookOdds > 0 ? '+' : ''}${e.bookOdds} → Model ${e.modelOdds > 0 ? '+' : ''}${e.modelOdds?.toFixed(1)} | ROI: ${e.roi > 0 ? '+' : ''}${e.roi.toFixed(2)}%`);
}

// Save
const OUT = { generatedAt: new Date().toISOString(), modelVersion: 'v12.0-KO24', rho: V12_RHO, results, allEdges };
fs.writeFileSync('/home/ubuntu/wc2026_v12_fullmarket.json', JSON.stringify(OUT, null, 2));
fs.writeFileSync('/home/ubuntu/wc2026_v12_fullmarket.log', logLines.join('\n') + '\n');
log('OUTPUT', 'Saved: /home/ubuntu/wc2026_v12_fullmarket.json');
log('OUTPUT', '⚠️  ZERO PUBLISH — No DB writes.');
console.log('\n[DONE]');
