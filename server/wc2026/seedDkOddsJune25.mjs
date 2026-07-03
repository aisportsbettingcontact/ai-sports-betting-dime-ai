/**
 * seedDkOddsJune25.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 25 — DraftKings Book Odds (user-provided ground truth)
 *
 * ORIENTATION ANALYSIS (DB vs User-provided):
 *   wc26-g-057: CUW(home) vs CIV(away)  ← DB matches user ✓
 *   wc26-g-058: ECU(home) vs GER(away)  ← DB matches user ✓
 *   wc26-g-059: SWE(home) vs JPN(away)  ← DB INVERTED vs user (user: JPN=home, SWE=away) → SWAP REQUIRED
 *   wc26-g-060: NED(home) vs TUN(away)  ← DB INVERTED vs user (user: TUN=home, NED=away) → SWAP REQUIRED
 *   wc26-g-055: TUR(home) vs USA(away)  ← DB matches user ✓
 *   wc26-g-056: PAR(home) vs AUS(away)  ← DB matches user ✓
 *
 * STEP 0: Fix orientation for wc26-g-059 and wc26-g-060 by swapping home_team_id ↔ away_team_id
 * STEP 1: Clear existing DK odds for all 6 fixtures
 * STEP 2: Insert all DK odds rows for all 6 fixtures
 * STEP 3: Full audit — verify every row stored correctly
 *
 * MARKETS STORED (per fixture):
 *   1X2: home / draw / away
 *   TOTAL: over / under (with line)
 *   ASIAN_HANDICAP: home_spread / away_spread (with line)
 *   DOUBLE_CHANCE: home_draw (1X) / away_draw (X2)
 *   BTTS: yes / no
 *   1X2 no_draw: no_draw
 *
 * LOGGING: [WC_DK_JUNE25] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_DK_JUNE25]';
const DK_BOOK_ID = 68;

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '3306'),
    user: u.username,
    password: u.password,
    database: u.pathname.slice(1).split('?')[0],
    ssl: { rejectUnauthorized: false },
  };
}

function impliedProb(americanOdds) {
  if (americanOdds == null) return null;
  return americanOdds < 0
    ? (-americanOdds) / (-americanOdds + 100)
    : 100 / (americanOdds + 100);
}

// ─── June 25 Fixtures — USER-PROVIDED GROUND TRUTH ───────────────────────────
// All home/away labels are from the user. These are the authoritative orientations.
// DB orientation is corrected to match before odds insertion.
//
// FIELD NAMING CONVENTION (maps to DB wc2026_odds_snapshots):
//   market='1X2'            selection='home'|'draw'|'away'|'no_draw'   line=null
//   market='TOTAL'          selection='over'|'under'                   line=totalLine
//   market='ASIAN_HANDICAP' selection='home'|'away'                    line=spreadLine (home perspective)
//   market='DOUBLE_CHANCE'  selection='home_draw'|'away_draw'          line=null
//   market='BTTS'           selection='yes'|'no'                       line=null

const FIXTURES = [
  // ── wc26-g-057: Ivory Coast (away=CIV) vs Curacao (home=CUW) ─────────────
  // DB orientation: home=cuw, away=civ ← MATCHES USER ✓
  {
    matchId: 'wc26-g-057',
    homeName: 'Curacao', homeId: 'cuw', homeFifa: 'CUW',
    awayName: 'Ivory Coast', awayId: 'civ', awayFifa: 'CIV',
    dbNeedsSwap: false,
    // 1X2
    dkHomeML: 1700,   // Curacao ML +1700
    dkDrawML: 700,    // DRAW +700
    dkAwayML: -650,   // Ivory Coast ML -650
    // TOTAL
    dkTotalLine: 3.5,
    dkOverOdds: 125,  // Over 3.5 +125
    dkUnderOdds: -155, // Under 3.5 -155
    // ASIAN_HANDICAP (home perspective: home spread / away spread)
    // User: "Ivory Coast -2.5: +120" → away team -2.5 → home team +2.5
    dkHomeSpreadLine: 2.5,   // Curacao +2.5
    dkHomeSpreadOdds: -150,  // Curacao +2.5: -150
    dkAwaySpreadLine: -2.5,  // Ivory Coast -2.5
    dkAwaySpreadOdds: 120,   // Ivory Coast -2.5: +120
    // DOUBLE_CHANCE
    // "Ivory Coast Or Draw" = away_draw (X2) = -5000
    // "Curacao Or Draw" = home_draw (1X) = +400
    dkHomeDraw: 400,   // Curacao Or Draw: +400
    dkAwayDraw: -5000, // Ivory Coast Or Draw: -5000
    // BTTS
    dkBttsYes: 145,   // BTTS YES: +145
    dkBttsNo: -185,   // BTTS NO: -185
    // NO_DRAW
    dkNoDraw: -1400,  // Ivory Coast or Curacao (No Draw): -1400
  },

  // ── wc26-g-058: Germany (away=GER) vs Ecuador (home=ECU) ─────────────────
  // DB orientation: home=ecu, away=ger ← MATCHES USER ✓
  {
    matchId: 'wc26-g-058',
    homeName: 'Ecuador', homeId: 'ecu', homeFifa: 'ECU',
    awayName: 'Germany', awayId: 'ger', awayFifa: 'GER',
    dbNeedsSwap: false,
    // 1X2
    dkHomeML: 425,   // Ecuador ML +425
    dkDrawML: 400,   // DRAW +400
    dkAwayML: -190,  // Germany ML -190
    // TOTAL
    dkTotalLine: 2.5,
    dkOverOdds: -160,  // Over 2.5 -160
    dkUnderOdds: 130,  // Under 2.5 +130
    // ASIAN_HANDICAP
    // User: "Germany -1.5: +140" → away team -1.5 → home team +1.5
    dkHomeSpreadLine: 1.5,   // Ecuador +1.5
    dkHomeSpreadOdds: -180,  // Ecuador +1.5: -180
    dkAwaySpreadLine: -1.5,  // Germany -1.5
    dkAwaySpreadOdds: 140,   // Germany -1.5: +140
    // DOUBLE_CHANCE
    // "Germany Or Draw" = away_draw (X2) = -600
    // "Ecuador Or Draw" = home_draw (1X) = +145
    dkHomeDraw: 145,   // Ecuador Or Draw: +145
    dkAwayDraw: -600,  // Germany Or Draw: -600
    // BTTS
    dkBttsYes: -135,  // BTTS YES: -135
    dkBttsNo: 105,    // BTTS NO: +105
    // NO_DRAW
    dkNoDraw: -550,   // Germany or Ecuador (No Draw): -550
  },

  // ── wc26-g-059: Sweden (away=SWE) vs Japan (home=JPN) ────────────────────
  // DB orientation: home=swe, away=jpn ← INVERTED vs user → dbNeedsSwap=true
  // After swap: DB home=jpn, DB away=swe ← matches user
  {
    matchId: 'wc26-g-059',
    homeName: 'Japan', homeId: 'jpn', homeFifa: 'JPN',
    awayName: 'Sweden', awayId: 'swe', awayFifa: 'SWE',
    dbNeedsSwap: true,
    // 1X2
    dkHomeML: -115,  // Japan ML -115
    dkDrawML: 255,   // DRAW +255
    dkAwayML: 350,   // Sweden ML +350
    // TOTAL
    dkTotalLine: 2.5,
    dkOverOdds: -120,  // Over 2.5 -120
    dkUnderOdds: -105, // Under 2.5 -105
    // ASIAN_HANDICAP
    // User: "Japan -1.5: +245" → home team -1.5 → away team +1.5
    dkHomeSpreadLine: -1.5,  // Japan -1.5
    dkHomeSpreadOdds: 245,   // Japan -1.5: +245
    dkAwaySpreadLine: 1.5,   // Sweden +1.5
    dkAwaySpreadOdds: -320,  // Sweden +1.5: -320
    // DOUBLE_CHANCE
    // "Japan Or Draw" = home_draw (1X) = -475
    // "Sweden Or Draw" = away_draw (X2) = -110
    dkHomeDraw: -475,  // Japan Or Draw: -475
    dkAwayDraw: -110,  // Sweden Or Draw: -110
    // BTTS
    dkBttsYes: -155,  // BTTS YES: -155
    dkBttsNo: 125,    // BTTS NO: +125
    // NO_DRAW
    dkNoDraw: -330,   // Sweden or Japan (No Draw): -330
  },

  // ── wc26-g-060: Netherlands (away=NED) vs Tunisia (home=TUN) ─────────────
  // DB orientation: home=ned, away=tun ← INVERTED vs user → dbNeedsSwap=true
  // After swap: DB home=tun, DB away=ned ← matches user
  {
    matchId: 'wc26-g-060',
    homeName: 'Tunisia', homeId: 'tun', homeFifa: 'TUN',
    awayName: 'Netherlands', awayId: 'ned', awayFifa: 'NED',
    dbNeedsSwap: true,
    // 1X2
    dkHomeML: 2500,   // Tunisia ML +2500
    dkDrawML: 1000,   // DRAW +1000
    dkAwayML: -1100,  // Netherlands ML -1100
    // TOTAL
    dkTotalLine: 3.5,
    dkOverOdds: 100,   // Over 3.5 +100
    dkUnderOdds: -125, // Under 3.5 -125
    // ASIAN_HANDICAP
    // User: "Netherlands -2.5: -115" → away team -2.5 → home team +2.5
    dkHomeSpreadLine: 2.5,   // Tunisia +2.5
    dkHomeSpreadOdds: -110,  // Tunisia +2.5: -110
    dkAwaySpreadLine: -2.5,  // Netherlands -2.5
    dkAwaySpreadOdds: -115,  // Netherlands -2.5: -115
    // DOUBLE_CHANCE
    // "Netherlands Or Draw" = away_draw (X2) = -20000
    // "Tunisia Or Draw" = home_draw (1X) = +550
    dkHomeDraw: 550,    // Tunisia Or Draw: +550
    dkAwayDraw: -20000, // Netherlands Or Draw: -20000
    // BTTS
    dkBttsYes: 160,   // BTTS YES: +160
    dkBttsNo: -205,   // BTTS NO: -205
    // NO_DRAW
    dkNoDraw: -2500,  // Netherlands or Tunisia (No Draw): -2500
  },

  // ── wc26-g-055: USA (away=USA) vs Turkey (home=TUR) ──────────────────────
  // DB orientation: home=tur, away=usa ← MATCHES USER ✓
  {
    matchId: 'wc26-g-055',
    homeName: 'Turkey', homeId: 'tur', homeFifa: 'TUR',
    awayName: 'United States', awayId: 'usa', awayFifa: 'USA',
    dbNeedsSwap: false,
    // 1X2
    dkHomeML: 275,   // Turkey ML +275
    dkDrawML: 310,   // DRAW +310
    dkAwayML: -115,  // USA ML -115
    // TOTAL
    dkTotalLine: 2.5,
    dkOverOdds: -145,  // Over 2.5 -145
    dkUnderOdds: 120,  // Under 2.5 +120
    // ASIAN_HANDICAP
    // User: "USA -1.5: +225" → away team -1.5 → home team +1.5
    dkHomeSpreadLine: 1.5,   // Turkey +1.5
    dkHomeSpreadOdds: -300,  // Turkey +1.5: -300
    dkAwaySpreadLine: -1.5,  // USA -1.5
    dkAwaySpreadOdds: 225,   // USA -1.5: +225
    // DOUBLE_CHANCE
    // "USA Or Draw" = away_draw (X2) = -360
    // "Turkey Or Draw" = home_draw (1X) = -110
    dkHomeDraw: -110,  // Turkey Or Draw: -110
    dkAwayDraw: -360,  // USA Or Draw: -360
    // BTTS
    dkBttsYes: -155,  // BTTS YES: -155
    dkBttsNo: 120,    // BTTS NO: +120
    // NO_DRAW
    dkNoDraw: -400,   // USA or Turkey (No Draw): -400
  },

  // ── wc26-g-056: Australia (away=AUS) vs Paraguay (home=PAR) ──────────────
  // DB orientation: home=par, away=aus ← MATCHES USER ✓
  {
    matchId: 'wc26-g-056',
    homeName: 'Paraguay', homeId: 'par', homeFifa: 'PAR',
    awayName: 'Australia', awayId: 'aus', awayFifa: 'AUS',
    dbNeedsSwap: false,
    // 1X2
    dkHomeML: 180,   // Paraguay ML +180
    dkDrawML: 125,   // DRAW +125
    dkAwayML: 310,   // Australia ML +310
    // TOTAL
    dkTotalLine: 1.5,
    dkOverOdds: -155,  // Over 1.5 -155
    dkUnderOdds: 125,  // Under 1.5 +125
    // ASIAN_HANDICAP
    // User: "Paraguay -1.5: +650" → home team -1.5 → away team +1.5
    dkHomeSpreadLine: -1.5,  // Paraguay -1.5
    dkHomeSpreadOdds: 650,   // Paraguay -1.5: +650
    dkAwaySpreadLine: 1.5,   // Australia +1.5
    dkAwaySpreadOdds: -1200, // Australia +1.5: -1200
    // DOUBLE_CHANCE
    // "Paraguay Or Draw" = home_draw (1X) = -425
    // "Australia Or Draw" = away_draw (X2) = -230
    dkHomeDraw: -425,  // Paraguay Or Draw: -425
    dkAwayDraw: -230,  // Australia Or Draw: -230
    // BTTS
    dkBttsYes: 130,   // BTTS YES: +130
    dkBttsNo: -165,   // BTTS NO: -165
    // NO_DRAW
    dkNoDraw: -155,   // Australia or Paraguay (No Draw): -155
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} WC 2026 JUNE 25 — DK ODDS SEED + ORIENTATION FIX`);
  console.log(`${TAG} Fixtures: ${FIXTURES.length} | DK book_id: ${DK_BOOK_ID}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  const conn = await mysql.createConnection(parseDbUrl(process.env.DATABASE_URL));
  const snapshotTs = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  let totalSwaps = 0;
  let totalDeleted = 0;
  let totalInserted = 0;
  const errors = [];

  for (const f of FIXTURES) {
    console.log(`\n${TAG} ─── Fixture: ${f.matchId} | ${f.homeName}(home) vs ${f.awayName}(away) ───`);

    // ── STEP 0: Fix orientation if DB is inverted ─────────────────────────────
    if (f.dbNeedsSwap) {
      console.log(`${TAG} [STEP 0] ORIENTATION SWAP REQUIRED for ${f.matchId}`);
      console.log(`${TAG} [STATE] DB was: home=${f.awayId}(wrong) away=${f.homeId}(wrong)`);
      console.log(`${TAG} [STATE] Swapping to: home=${f.homeId} away=${f.awayId}`);

      // Verify current DB state before swap
      const [pre] = await conn.query(
        `SELECT home_team_id, away_team_id FROM wc2026_fixtures WHERE match_id = ?`,
        [f.matchId]
      );
      if (!pre.length) {
        const msg = `FATAL: match_id=${f.matchId} not found in DB`;
        console.error(`${TAG} [ERROR] ${msg}`);
        errors.push(msg);
        continue;
      }
      console.log(`${TAG} [STATE] Pre-swap DB: home_team_id=${pre[0].home_team_id} away_team_id=${pre[0].away_team_id}`);

      // Perform swap using temp to avoid unique constraint issues
      await conn.query(
        `UPDATE wc2026_fixtures SET home_team_id = ?, away_team_id = ? WHERE match_id = ?`,
        [f.homeId, f.awayId, f.matchId]
      );

      // Verify post-swap
      const [post] = await conn.query(
        `SELECT home_team_id, away_team_id FROM wc2026_fixtures WHERE match_id = ?`,
        [f.matchId]
      );
      const swapOk = post[0].home_team_id === f.homeId && post[0].away_team_id === f.awayId;
      console.log(`${TAG} [OUTPUT] Post-swap DB: home_team_id=${post[0].home_team_id} away_team_id=${post[0].away_team_id}`);
      console.log(`${TAG} [VERIFY] Orientation swap: ${swapOk ? 'PASS ✓' : 'FAIL ✗ — MISMATCH'}`);
      if (!swapOk) {
        errors.push(`Orientation swap FAILED for ${f.matchId}`);
        continue;
      }
      totalSwaps++;
    } else {
      // Verify existing orientation is correct
      const [row] = await conn.query(
        `SELECT home_team_id, away_team_id FROM wc2026_fixtures WHERE match_id = ?`,
        [f.matchId]
      );
      if (!row.length) {
        const msg = `FATAL: match_id=${f.matchId} not found in DB`;
        console.error(`${TAG} [ERROR] ${msg}`);
        errors.push(msg);
        continue;
      }
      const orientOk = row[0].home_team_id === f.homeId && row[0].away_team_id === f.awayId;
      console.log(`${TAG} [STEP 0] Orientation check: home_team_id=${row[0].home_team_id} away_team_id=${row[0].away_team_id}`);
      console.log(`${TAG} [VERIFY] Orientation: ${orientOk ? 'PASS ✓' : 'FAIL ✗ — EXPECTED home=' + f.homeId + ' away=' + f.awayId}`);
      if (!orientOk) {
        errors.push(`Orientation mismatch for ${f.matchId}: DB home=${row[0].home_team_id} expected=${f.homeId}`);
      }
    }

    // ── STEP 1: Clear existing DK odds ────────────────────────────────────────
    const [del] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?`,
      [f.matchId, DK_BOOK_ID]
    );
    totalDeleted += del.affectedRows;
    console.log(`${TAG} [STEP 1] Cleared ${del.affectedRows} existing DK rows for ${f.matchId}`);

    // ── STEP 2: Build DK odds rows ────────────────────────────────────────────
    // Every row: { market, selection, line, odds }
    // Null odds = skip (market not offered)
    const dkRows = [
      // 1X2 moneylines
      { market: '1X2', selection: 'home',    line: null,            odds: f.dkHomeML },
      { market: '1X2', selection: 'draw',    line: null,            odds: f.dkDrawML },
      { market: '1X2', selection: 'away',    line: null,            odds: f.dkAwayML },
      // Total (over/under)
      { market: 'TOTAL', selection: 'over',  line: f.dkTotalLine,   odds: f.dkOverOdds },
      { market: 'TOTAL', selection: 'under', line: f.dkTotalLine,   odds: f.dkUnderOdds },
      // Asian handicap (spread)
      { market: 'ASIAN_HANDICAP', selection: 'home', line: f.dkHomeSpreadLine, odds: f.dkHomeSpreadOdds },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: f.dkAwaySpreadLine, odds: f.dkAwaySpreadOdds },
      // Double chance
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: f.dkHomeDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: f.dkAwayDraw },
      // BTTS
      { market: 'BTTS', selection: 'yes', line: null, odds: f.dkBttsYes },
      { market: 'BTTS', selection: 'no',  line: null, odds: f.dkBttsNo },
      // No draw (1X2 without draw)
      { market: '1X2', selection: 'no_draw', line: null, odds: f.dkNoDraw },
    ];

    // ── STEP 3: Insert DK odds rows ───────────────────────────────────────────
    let insertedForFixture = 0;
    for (const row of dkRows) {
      if (row.odds == null) {
        console.log(`${TAG} [STEP 3] SKIP null odds: market=${row.market} selection=${row.selection}`);
        continue;
      }
      const prob = impliedProb(row.odds);
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots
           (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.matchId, snapshotTs, DK_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, prob]
      );
      insertedForFixture++;
      console.log(`${TAG} [STEP 3] INSERT: fixture=${f.matchId} market=${row.market} sel=${row.selection} line=${row.line ?? 'null'} odds=${row.odds > 0 ? '+' + row.odds : row.odds} prob=${prob?.toFixed(4)}`);
    }
    totalInserted += insertedForFixture;
    console.log(`${TAG} [OUTPUT] Inserted ${insertedForFixture} DK rows for ${f.matchId}`);

    // ── STEP 4: Verify inserted rows ──────────────────────────────────────────
    const [verify] = await conn.query(
      `SELECT market, selection, line, american_odds, implied_prob
       FROM wc2026_odds_snapshots
       WHERE match_id = ? AND book_id = ?
       ORDER BY market, selection`,
      [f.matchId, DK_BOOK_ID]
    );
    console.log(`${TAG} [VERIFY] DB rows for ${f.matchId}: ${verify.length} (expected ${insertedForFixture})`);
    const verifyOk = verify.length === insertedForFixture;
    if (!verifyOk) {
      errors.push(`Row count mismatch for ${f.matchId}: inserted=${insertedForFixture} DB=${verify.length}`);
    }
    for (const v of verify) {
      console.log(`${TAG} [VERIFY]   ${v.market}/${v.selection} line=${v.line ?? 'null'} odds=${v.american_odds > 0 ? '+' + v.american_odds : v.american_odds} prob=${parseFloat(v.implied_prob).toFixed(4)}`);
    }
    console.log(`${TAG} [VERIFY] ${f.matchId}: ${verifyOk ? 'PASS ✓' : 'FAIL ✗'}`);
  }

  // ── FINAL SUMMARY ─────────────────────────────────────────────────────────
  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} FINAL SUMMARY`);
  console.log(`${TAG}   Fixtures processed: ${FIXTURES.length}`);
  console.log(`${TAG}   Orientation swaps:  ${totalSwaps}`);
  console.log(`${TAG}   DK rows deleted:    ${totalDeleted}`);
  console.log(`${TAG}   DK rows inserted:   ${totalInserted}`);
  console.log(`${TAG}   Errors:             ${errors.length}`);
  if (errors.length > 0) {
    errors.forEach(e => console.error(`${TAG}   [ERROR] ${e}`));
  } else {
    console.log(`${TAG}   [VERIFY] ALL FIXTURES SEEDED SUCCESSFULLY ✓`);
  }
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  await conn.end();
  process.exit(errors.length > 0 ? 1 : 0);
})().catch(e => {
  console.error(`${TAG} [FATAL]`, e.message);
  process.exit(1);
});
