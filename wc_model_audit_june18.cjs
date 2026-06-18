'use strict';
/**
 * WC2026 MODEL ODDS DEEP AUDIT — June 18, 2026
 *
 * Audits ALL model odds (book_id=0) for the 4 June 18 fixtures across:
 *   - 1X2 (ML): home, draw, away
 *   - TOTAL: over, under
 *   - ASIAN_HANDICAP: (if present)
 *
 * For each market+selection:
 *   [INPUT]  raw DB row (fixture_id, market, selection, american_odds, line, snapshot_ts, book_id)
 *   [STATE]  implied probability from american odds
 *   [VERIFY] cross-check against expected no-vig structure
 *
 * Ground truth (DK screenshot, June 18 2026):
 *   wc26-g-025: CZE(home) -120 | Draw +260 | RSA(away) +380
 *   wc26-g-027: SUI(home) -180 | Draw +310 | BIH(away) +500
 *   wc26-g-028: CAN(home) -350 | Draw +475 | QAT(away) +1000
 *   wc26-g-026: MEX(home) +105 | Draw +230 | KOR(away) +295
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// ── Math helpers ──────────────────────────────────────────────────────────────
function americanToDecimal(odds) {
  if (odds == null || isNaN(odds)) return null;
  return odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100;
}
function impliedProb(odds) {
  const dec = americanToDecimal(odds);
  if (!dec) return null;
  return (1 / dec * 100).toFixed(4) + '%';
}
function noVigFairProbs(home, draw, away) {
  if (home == null || draw == null || away == null) return null;
  const rH = 1 / americanToDecimal(home);
  const rD = 1 / americanToDecimal(draw);
  const rA = 1 / americanToDecimal(away);
  const vig = rH + rD + rA;
  return {
    fairHome:  (rH / vig * 100).toFixed(4) + '%',
    fairDraw:  (rD / vig * 100).toFixed(4) + '%',
    fairAway:  (rA / vig * 100).toFixed(4) + '%',
    vigPct:    ((vig - 1) * 100).toFixed(4) + '%',
    sumCheck:  ((rH + rD + rA) / vig * 100).toFixed(6) + '%',
  };
}
function edgePP(bookOdds, modelOdds) {
  if (bookOdds == null || modelOdds == null) return 'N/A';
  const bkImpl = 1 / americanToDecimal(bookOdds);
  const mdlImpl = 1 / americanToDecimal(modelOdds);
  if (bkImpl <= 0) return 'N/A';
  return ((mdlImpl - bkImpl) / bkImpl * 100).toFixed(4) + '%';
}

// ── DK ground truth ───────────────────────────────────────────────────────────
const DK_GT = {
  'wc26-g-025': { home: -120, draw: 260, away: 380, homeCode: 'CZE', awayCode: 'RSA' },
  'wc26-g-027': { home: -180, draw: 310, away: 500, homeCode: 'SUI', awayCode: 'BIH' },
  'wc26-g-028': { home: -350, draw: 475, away: 1000, homeCode: 'CAN', awayCode: 'QAT' },
  'wc26-g-026': { home: 105,  draw: 230, away: 295,  homeCode: 'MEX', awayCode: 'KOR' },
};

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[INPUT] Connected to DB. Starting full model odds audit for June 18 fixtures.\n');

  const fixtureIds = ['wc26-g-025','wc26-g-027','wc26-g-028','wc26-g-026'];

  // ── Step 1: Pull fixture orientation ─────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('STEP 1: FIXTURE ORIENTATION AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════');
  const [fixtures] = await conn.execute(`
    SELECT f.fixture_id, f.kickoff_utc,
           ht.name AS home_name, ht.fifa_code AS home_code,
           at2.name AS away_name, at2.fifa_code AS away_code
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
    ORDER BY f.kickoff_utc
  `);
  const fixtureMap = {};
  for (const f of fixtures) {
    fixtureMap[f.fixture_id] = f;
    const gt = DK_GT[f.fixture_id];
    const homeOK = f.home_code === gt.homeCode;
    const awayOK = f.away_code === gt.awayCode;
    console.log(`[INPUT]  ${f.fixture_id} | kickoff=${f.kickoff_utc}`);
    console.log(`[STATE]  DB: home=${f.home_name}(${f.home_code})  away=${f.away_name}(${f.away_code})`);
    console.log(`[STATE]  GT: home=${gt.homeCode}  away=${gt.awayCode}`);
    console.log(`[VERIFY] home=${homeOK?'PASS ✓':'FAIL ✗'}  away=${awayOK?'PASS ✓':'FAIL ✗'}`);
    console.log('');
  }

  // ── Step 2: Pull ALL model odds (book_id=0) for June 18 ──────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('STEP 2: ALL MODEL ODDS SNAPSHOTS (book_id=0)');
  console.log('═══════════════════════════════════════════════════════════════════');
  const [allModelRows] = await conn.execute(`
    SELECT fixture_id, market, selection, american_odds, line, snapshot_ts, book_id
    FROM wc2026_odds_snapshots
    WHERE book_id = 0
      AND fixture_id IN (${fixtureIds.map(()=>'?').join(',')})
    ORDER BY fixture_id, market, selection, snapshot_ts DESC
  `, fixtureIds);

  console.log(`[INPUT]  Total model rows found: ${allModelRows.length}`);
  console.log('');

  // ── Step 3: Build latest-snapshot map (deduplicated) ─────────────────────────
  const modelMap = {}; // fixtureId -> { market -> { selection -> row } }
  const seenKeys = new Set();
  for (const row of allModelRows) {
    const key = `${row.fixture_id}:${row.market}:${row.selection}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      if (!modelMap[row.fixture_id]) modelMap[row.fixture_id] = {};
      if (!modelMap[row.fixture_id][row.market]) modelMap[row.fixture_id][row.market] = {};
      modelMap[row.fixture_id][row.market][row.selection] = row;
    }
  }

  // ── Step 4: Pull ALL DK odds (book_id=68) for cross-reference ────────────────
  const [allDkRows] = await conn.execute(`
    SELECT fixture_id, market, selection, american_odds, line, snapshot_ts
    FROM wc2026_odds_snapshots
    WHERE book_id = 68
      AND fixture_id IN (${fixtureIds.map(()=>'?').join(',')})
    ORDER BY fixture_id, market, selection, snapshot_ts DESC
  `, fixtureIds);
  const dkMap = {};
  const seenDk = new Set();
  for (const row of allDkRows) {
    const key = `${row.fixture_id}:${row.market}:${row.selection}`;
    if (!seenDk.has(key)) {
      seenDk.add(key);
      if (!dkMap[row.fixture_id]) dkMap[row.fixture_id] = {};
      if (!dkMap[row.fixture_id][row.market]) dkMap[row.fixture_id][row.market] = {};
      dkMap[row.fixture_id][row.market][row.selection] = row;
    }
  }

  // ── Step 5: Game-by-game deep audit ──────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('STEP 3: GAME-BY-GAME DEEP AUDIT');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let totalIssues = 0;

  for (const fid of fixtureIds) {
    const f = fixtureMap[fid];
    const gt = DK_GT[fid];
    const mdl = modelMap[fid] || {};
    const dk  = dkMap[fid] || {};

    console.log(`┌─────────────────────────────────────────────────────────────────`);
    console.log(`│ FIXTURE: ${fid}`);
    console.log(`│ ${f.home_name}(${f.home_code}) vs ${f.away_name}(${f.away_code})`);
    console.log(`│ Kickoff: ${f.kickoff_utc}`);
    console.log(`└─────────────────────────────────────────────────────────────────`);
    console.log('');

    // ── 1X2 (ML) ──────────────────────────────────────────────────────────────
    console.log('  ── 1X2 (MONEYLINE) ──────────────────────────────────────────');
    const mdlHome = mdl['1X2']?.['home']?.american_odds;
    const mdlDraw = mdl['1X2']?.['draw']?.american_odds;
    const mdlAway = mdl['1X2']?.['away']?.american_odds;
    const dkHome  = dk['1X2']?.['home']?.american_odds;
    const dkDraw  = dk['1X2']?.['draw']?.american_odds;
    const dkAway  = dk['1X2']?.['away']?.american_odds;

    console.log(`  [INPUT]  DK  home=${dkHome}  draw=${dkDraw}  away=${dkAway}`);
    console.log(`  [INPUT]  MDL home=${mdlHome}  draw=${mdlDraw}  away=${mdlAway}`);
    console.log(`  [INPUT]  GT  home=${gt.home}  draw=${gt.draw}  away=${gt.away}`);
    console.log('');

    // DK vs GT check
    const dkHomeOK = dkHome === gt.home;
    const dkDrawOK = dkDraw === gt.draw;
    const dkAwayOK = dkAway === gt.away;
    if (!dkHomeOK) { console.log(`  [FAIL ✗] DK home: got ${dkHome}, expected ${gt.home}`); totalIssues++; }
    if (!dkDrawOK) { console.log(`  [FAIL ✗] DK draw: got ${dkDraw}, expected ${gt.draw}`); totalIssues++; }
    if (!dkAwayOK) { console.log(`  [FAIL ✗] DK away: got ${dkAway}, expected ${gt.away}`); totalIssues++; }
    if (dkHomeOK && dkDrawOK && dkAwayOK) console.log(`  [VERIFY] DK 1X2 vs GT: PASS ✓`);

    // Model implied probs
    if (mdlHome != null && mdlDraw != null && mdlAway != null) {
      const fair = noVigFairProbs(mdlHome, mdlDraw, mdlAway);
      console.log(`  [STATE]  MODEL implied: home=${impliedProb(mdlHome)}  draw=${impliedProb(mdlDraw)}  away=${impliedProb(mdlAway)}`);
      console.log(`  [STATE]  MODEL no-vig:  fairHome=${fair.fairHome}  fairDraw=${fair.fairDraw}  fairAway=${fair.fairAway}  vig=${fair.vigPct}  sum=${fair.sumCheck}`);

      // Sanity: model probs must sum to ~100%
      const rH = 1 / americanToDecimal(mdlHome);
      const rD = 1 / americanToDecimal(mdlDraw);
      const rA = 1 / americanToDecimal(mdlAway);
      const vig = rH + rD + rA;
      const sum = (rH + rD + rA) / vig;
      if (Math.abs(sum - 1.0) > 0.0001) {
        console.log(`  [FAIL ✗] MODEL 1X2 no-vig sum=${sum.toFixed(6)} (expected 1.000000)`); totalIssues++;
      } else {
        console.log(`  [VERIFY] MODEL 1X2 no-vig sum=1.000000: PASS ✓`);
      }

      // Edge detection (model vs DK)
      const homeEdge = edgePP(dkHome, mdlHome);
      const drawEdge = edgePP(dkDraw, mdlDraw);
      const awayEdge = edgePP(dkAway, mdlAway);
      console.log(`  [STATE]  Edge pp: home=${homeEdge}  draw=${drawEdge}  away=${awayEdge}`);

      // Sanity: model favorite should be the team with highest fair prob
      const fairH = rH / vig;
      const fairD = rD / vig;
      const fairA = rA / vig;
      const modelFav = fairH > fairD && fairH > fairA ? f.home_code
                     : fairA > fairD && fairA > fairH ? f.away_code
                     : 'DRAW';
      console.log(`  [STATE]  MODEL favorite: ${modelFav} (fairH=${(fairH*100).toFixed(2)}% fairD=${(fairD*100).toFixed(2)}% fairA=${(fairA*100).toFixed(2)}%)`);
    } else {
      console.log(`  [WARN]   MODEL 1X2 incomplete: home=${mdlHome} draw=${mdlDraw} away=${mdlAway}`);
      totalIssues++;
    }
    console.log('');

    // ── TOTAL ──────────────────────────────────────────────────────────────────
    console.log('  ── TOTAL (OVER/UNDER) ───────────────────────────────────────');
    const mdlOver  = mdl['TOTAL']?.['over'];
    const mdlUnder = mdl['TOTAL']?.['under'];
    const dkOver   = dk['TOTAL']?.['over'];
    const dkUnder  = dk['TOTAL']?.['under'];

    if (mdlOver && mdlUnder) {
      console.log(`  [INPUT]  MDL over=${mdlOver.american_odds}  under=${mdlUnder.american_odds}  line=${mdlOver.line ?? mdlUnder.line}`);
      console.log(`  [INPUT]  DK  over=${dkOver?.american_odds ?? 'N/A'}  under=${dkUnder?.american_odds ?? 'N/A'}  line=${dkOver?.line ?? dkUnder?.line ?? 'N/A'}`);

      // Sanity: over+under implied should sum > 1 (vig) or ~1 (no-vig)
      const rO = 1 / americanToDecimal(mdlOver.american_odds);
      const rU = 1 / americanToDecimal(mdlUnder.american_odds);
      const totalSum = rO + rU;
      console.log(`  [STATE]  MODEL implied: over=${impliedProb(mdlOver.american_odds)}  under=${impliedProb(mdlUnder.american_odds)}  sum=${(totalSum*100).toFixed(4)}%`);

      // Model total should be near 50/50 after no-vig (fair range: 40-60%)
      const fairO = rO / totalSum;
      const fairU = rU / totalSum;
      if (fairO < 0.25 || fairO > 0.75) {
        console.log(`  [WARN]   MODEL total fairOver=${(fairO*100).toFixed(2)}% is extreme (outside 25-75% range)`);
      } else {
        console.log(`  [VERIFY] MODEL total fairOver=${(fairO*100).toFixed(2)}% fairUnder=${(fairU*100).toFixed(2)}%: PASS ✓`);
      }

      // Line sanity
      const line = mdlOver.line ?? mdlUnder.line;
      if (line == null || line < 1.5 || line > 5.5) {
        console.log(`  [WARN]   MODEL total line=${line} is outside expected soccer range (1.5-5.5)`);
      } else {
        console.log(`  [VERIFY] MODEL total line=${line} in expected range [1.5, 5.5]: PASS ✓`);
      }

      // Edge vs DK
      if (dkOver && dkUnder) {
        const overEdge  = edgePP(dkOver.american_odds, mdlOver.american_odds);
        const underEdge = edgePP(dkUnder.american_odds, mdlUnder.american_odds);
        console.log(`  [STATE]  Edge pp: over=${overEdge}  under=${underEdge}`);
      }
    } else {
      console.log(`  [WARN]   MODEL TOTAL incomplete: over=${mdlOver?.american_odds ?? 'MISSING'}  under=${mdlUnder?.american_odds ?? 'MISSING'}`);
      if (!mdlOver) totalIssues++;
      if (!mdlUnder) totalIssues++;
    }
    console.log('');

    // ── DRAW (from 1X2 draw selection — same as ML) ────────────────────────────
    console.log('  ── DRAW (from 1X2 draw selection) ──────────────────────────');
    if (mdlDraw != null) {
      console.log(`  [INPUT]  MDL draw=${mdlDraw}  DK draw=${dkDraw}  GT draw=${gt.draw}`);
      console.log(`  [STATE]  MDL implied=${impliedProb(mdlDraw)}  DK implied=${impliedProb(dkDraw)}`);
      const drawEdge = edgePP(dkDraw, mdlDraw);
      console.log(`  [STATE]  Edge pp: ${drawEdge}`);
      // DK draw vs GT
      if (dkDraw !== gt.draw) {
        console.log(`  [FAIL ✗] DK draw mismatch: got ${dkDraw}, expected ${gt.draw}`); totalIssues++;
      } else {
        console.log(`  [VERIFY] DK draw vs GT: PASS ✓`);
      }
    } else {
      console.log(`  [WARN]   MODEL draw odds missing`); totalIssues++;
    }
    console.log('');

    // ── ASIAN_HANDICAP (if present) ────────────────────────────────────────────
    const ahMarkets = Object.keys(mdl).filter(m => m === 'ASIAN_HANDICAP');
    if (ahMarkets.length > 0) {
      console.log('  ── ASIAN HANDICAP ───────────────────────────────────────────');
      for (const mkt of ahMarkets) {
        for (const [sel, row] of Object.entries(mdl[mkt])) {
          console.log(`  [INPUT]  MDL ${mkt} ${sel}: odds=${row.american_odds}  line=${row.line}`);
        }
      }
      console.log('');
    }

    // ── Snapshot timestamps ────────────────────────────────────────────────────
    console.log('  ── SNAPSHOT TIMESTAMPS ──────────────────────────────────────');
    for (const [mkt, sels] of Object.entries(mdl)) {
      for (const [sel, row] of Object.entries(sels)) {
        console.log(`  [STATE]  ${fid} | ${mkt} | ${sel} | odds=${row.american_odds} | ts=${row.snapshot_ts}`);
      }
    }
    console.log('');
    console.log('');
  }

  // ── Step 6: Summary ──────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('STEP 4: SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  if (totalIssues === 0) {
    console.log('[OUTPUT] ALL CHECKS PASS ✓ — Zero issues detected across all 4 fixtures');
  } else {
    console.log(`[OUTPUT] ISSUES DETECTED: ${totalIssues} check(s) failed ✗`);
  }
  console.log('');

  // ── Step 7: What the feed shows (final render simulation) ────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('STEP 5: FEED RENDER SIMULATION (what user sees)');
  console.log('Convention: HOME=top row, AWAY=bottom row (matches DK)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  for (const fid of fixtureIds) {
    const f = fixtureMap[fid];
    const mdl = modelMap[fid] || {};
    const dk  = dkMap[fid] || {};

    const dkHome  = dk['1X2']?.['home']?.american_odds;
    const dkDraw  = dk['1X2']?.['draw']?.american_odds;
    const dkAway  = dk['1X2']?.['away']?.american_odds;
    const mdlHome = mdl['1X2']?.['home']?.american_odds;
    const mdlDraw = mdl['1X2']?.['draw']?.american_odds;
    const mdlAway = mdl['1X2']?.['away']?.american_odds;
    const mdlOver  = mdl['TOTAL']?.['over']?.american_odds;
    const mdlUnder = mdl['TOTAL']?.['under']?.american_odds;
    const dkOver   = dk['TOTAL']?.['over']?.american_odds;
    const dkUnder  = dk['TOTAL']?.['under']?.american_odds;
    const totalLine = mdl['TOTAL']?.['over']?.line ?? dk['TOTAL']?.['over']?.line ?? '?';

    console.log(`${fid}: ${f.home_name} vs ${f.away_name}`);
    console.log(`  TOP ROW    (${f.home_code}): ML BOOK=${dkHome != null ? (dkHome > 0 ? '+'+dkHome : dkHome) : 'N/A'}  MODEL=${mdlHome != null ? (mdlHome > 0 ? '+'+mdlHome : mdlHome) : 'N/A'}`);
    console.log(`  BOT ROW    (${f.away_code}): ML BOOK=${dkAway != null ? (dkAway > 0 ? '+'+dkAway : dkAway) : 'N/A'}  MODEL=${mdlAway != null ? (mdlAway > 0 ? '+'+mdlAway : mdlAway) : 'N/A'}`);
    console.log(`  DRAW ROW:              BOOK=${dkDraw != null ? '+'+dkDraw : 'N/A'}  MODEL=${mdlDraw != null ? '+'+mdlDraw : 'N/A'}`);
    console.log(`  TOTAL TOP  (O${totalLine}): BOOK=${dkOver != null ? (dkOver > 0 ? '+'+dkOver : dkOver) : 'N/A'}  MODEL=${mdlOver != null ? (mdlOver > 0 ? '+'+mdlOver : mdlOver) : 'N/A'}`);
    console.log(`  TOTAL BOT  (U${totalLine}): BOOK=${dkUnder != null ? (dkUnder > 0 ? '+'+dkUnder : dkUnder) : 'N/A'}  MODEL=${mdlUnder != null ? (mdlUnder > 0 ? '+'+mdlUnder : mdlUnder) : 'N/A'}`);
    console.log('');
  }

  await conn.end();
  console.log('[OUTPUT] Audit complete.');
}

main().catch(err => { console.error('[FAIL]', err.message, err.stack); process.exit(1); });
