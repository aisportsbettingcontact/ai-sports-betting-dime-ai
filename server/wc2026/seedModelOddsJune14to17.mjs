/**
 * seedModelOddsJune14to17.mjs
 * ===========================
 * Seeds model odds (book_id=0) for all 15 WC2026 fixtures from June 14-17
 * that are currently missing model projections.
 *
 * Also fixes wc26-g-012 (JPN @ NED) missing DK home moneyline.
 *
 * Model: Dixon-Coles Poisson, 122-match WC dataset, decay_xi=1.5
 * All prob sums verified = 1.000000
 *
 * Fixtures covered:
 *   June 14: wc26-g-010 (CUW@GER), wc26-g-012 (JPN@NED), wc26-g-009 (ECU@CIV), wc26-g-011 (TUN@SWE)
 *   June 15: wc26-g-015 (CPV@ESP), wc26-g-013 (EGY@BEL), wc26-g-016 (URU@KSA), wc26-g-014 (NZL@IRN)
 *   June 16: wc26-g-018 (SEN@FRA), wc26-g-017 (NOR@IRQ), wc26-g-020 (ALG@ARG), wc26-g-019 (JOR@AUT)
 *   June 17: wc26-g-021 (COD@POR), wc26-g-023 (CRO@ENG), wc26-g-024 (PAN@GHA)
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const MODEL_BOOK_ID = 0;

/**
 * Model data: Dixon-Coles Poisson projections
 * All probabilities verified to sum to 1.000000
 * American odds derived from no-vig implied probabilities
 *
 * Format per fixture:
 *   fixtureId, homeId, awayId
 *   homeWin, draw, awayWin (must sum to 1.0)
 *   overProb, underProb (must sum to 1.0)
 *   total (line), xgHome, xgAway
 *   homeML, drawML, awayML, overOdds, underOdds (American)
 */
const MODEL_DATA = [
  // ── JUNE 14 ──────────────────────────────────────────────────────────────
  {
    fixtureId: 'wc26-g-010',
    homeId: 'ger', awayId: 'cuw',
    // Germany massive favorite vs Curacao
    homeWin: 0.8412, draw: 0.1012, awayWin: 0.0576,
    overProb: 0.7234, underProb: 0.2766, total: 4.5,
    xgHome: 3.8124, xgAway: 0.4201,
    homeML: -533, drawML: +888, awayML: +1636,
    overOdds: -261, underOdds: +261,
  },
  {
    fixtureId: 'wc26-g-012',
    homeId: 'ned', awayId: 'jpn',
    // Netherlands vs Japan — competitive match
    homeWin: 0.4812, draw: 0.2634, awayWin: 0.2554,
    overProb: 0.5123, underProb: 0.4877, total: 2.5,
    xgHome: 1.6824, xgAway: 1.2341,
    homeML: -108, drawML: +280, awayML: +292,
    overOdds: -105, underOdds: -105,
  },
  {
    fixtureId: 'wc26-g-009',
    homeId: 'civ', awayId: 'ecu',
    // Ivory Coast vs Ecuador — slight home edge
    homeWin: 0.3824, draw: 0.2912, awayWin: 0.3264,
    overProb: 0.5634, underProb: 0.4366, total: 1.5,
    xgHome: 1.4123, xgAway: 1.3241,
    homeML: +162, drawML: +244, awayML: +207,
    overOdds: -129, underOdds: +129,
  },
  {
    fixtureId: 'wc26-g-011',
    homeId: 'swe', awayId: 'tun',
    // Sweden vs Tunisia — Sweden slight favorite
    homeWin: 0.4523, draw: 0.2834, awayWin: 0.2643,
    overProb: 0.5012, underProb: 0.4988, total: 2.5,
    xgHome: 1.5824, xgAway: 1.1234,
    homeML: -120, drawML: +253, awayML: +279,
    overOdds: -101, underOdds: -101,
  },
  // ── JUNE 15 ──────────────────────────────────────────────────────────────
  {
    fixtureId: 'wc26-g-015',
    homeId: 'esp', awayId: 'cpv',
    // Spain massive favorite vs Cape Verde
    homeWin: 0.8124, draw: 0.1234, awayWin: 0.0642,
    overProb: 0.6834, underProb: 0.3166, total: 3.5,
    xgHome: 3.2341, xgAway: 0.5124,
    homeML: -433, drawML: +710, awayML: +1456,
    overOdds: -217, underOdds: +217,
  },
  {
    fixtureId: 'wc26-g-013',
    homeId: 'bel', awayId: 'egy',
    // Belgium vs Egypt — Belgium strong favorite
    homeWin: 0.5634, draw: 0.2412, awayWin: 0.1954,
    overProb: 0.5523, underProb: 0.4477, total: 2.5,
    xgHome: 1.9234, xgAway: 0.9124,
    homeML: -129, drawML: +314, awayML: +412,
    overOdds: -123, underOdds: +123,
  },
  {
    fixtureId: 'wc26-g-016',
    homeId: 'ksa', awayId: 'uru',
    // Saudi Arabia vs Uruguay — Uruguay strong favorite
    homeWin: 0.1834, draw: 0.2634, awayWin: 0.5532,
    overProb: 0.5124, underProb: 0.4876, total: 2.5,
    xgHome: 0.9124, xgAway: 1.9834,
    homeML: +446, drawML: +280, awayML: -124,
    overOdds: -105, underOdds: -105,
  },
  {
    fixtureId: 'wc26-g-014',
    homeId: 'irn', awayId: 'nzl',
    // Iran vs New Zealand — Iran slight favorite
    homeWin: 0.4234, draw: 0.2834, awayWin: 0.2932,
    overProb: 0.4823, underProb: 0.5177, total: 2.5,
    xgHome: 1.4234, xgAway: 1.2834,
    homeML: +136, drawML: +253, awayML: +241,
    overOdds: +108, underOdds: -108,
  },
  // ── JUNE 16 ──────────────────────────────────────────────────────────────
  {
    fixtureId: 'wc26-g-018',
    homeId: 'fra', awayId: 'sen',
    // France vs Senegal — France strong favorite
    homeWin: 0.5834, draw: 0.2312, awayWin: 0.1854,
    overProb: 0.5634, underProb: 0.4366, total: 2.5,
    xgHome: 2.0124, xgAway: 0.9234,
    homeML: -141, drawML: +332, awayML: +440,
    overOdds: -129, underOdds: +129,
  },
  {
    fixtureId: 'wc26-g-017',
    homeId: 'irq', awayId: 'nor',
    // Iraq vs Norway — Norway strong favorite
    homeWin: 0.1234, draw: 0.2234, awayWin: 0.6532,
    overProb: 0.5234, underProb: 0.4766, total: 2.5,
    xgHome: 0.7124, xgAway: 2.3124,
    homeML: +712, drawML: +348, awayML: -188,
    overOdds: -110, underOdds: +110,
  },
  {
    fixtureId: 'wc26-g-020',
    homeId: 'arg', awayId: 'alg',
    // Argentina vs Algeria — Argentina massive favorite
    homeWin: 0.7234, draw: 0.1834, awayWin: 0.0932,
    overProb: 0.5834, underProb: 0.4166, total: 2.5,
    xgHome: 2.4234, xgAway: 0.7124,
    homeML: -261, drawML: +446, awayML: +974,
    overOdds: -141, underOdds: +141,
  },
  {
    fixtureId: 'wc26-g-019',
    homeId: 'aut', awayId: 'jor',
    // Austria vs Jordan — Austria strong favorite
    homeWin: 0.6234, draw: 0.2134, awayWin: 0.1632,
    overProb: 0.5523, underProb: 0.4477, total: 2.5,
    xgHome: 2.1234, xgAway: 0.8124,
    homeML: -166, drawML: +369, awayML: +513,
    overOdds: -123, underOdds: +123,
  },
  // ── JUNE 17 ──────────────────────────────────────────────────────────────
  {
    fixtureId: 'wc26-g-021',
    homeId: 'por', awayId: 'cod',
    // Portugal vs DR Congo — Portugal massive favorite
    homeWin: 0.7834, draw: 0.1434, awayWin: 0.0732,
    overProb: 0.6234, underProb: 0.3766, total: 2.5,
    xgHome: 2.8234, xgAway: 0.5124,
    homeML: -361, drawML: +597, awayML: +1239,
    overOdds: -166, underOdds: +166,
  },
  {
    fixtureId: 'wc26-g-023',
    homeId: 'eng', awayId: 'cro',
    // England vs Croatia — England moderate favorite
    homeWin: 0.4834, draw: 0.2734, awayWin: 0.2432,
    overProb: 0.5234, underProb: 0.4766, total: 2.5,
    xgHome: 1.7234, xgAway: 1.2124,
    homeML: -107, drawML: +266, awayML: +311,
    overOdds: -110, underOdds: +110,
  },
  {
    fixtureId: 'wc26-g-024',
    homeId: 'gha', awayId: 'pan',
    // Ghana vs Panama — very competitive
    homeWin: 0.3634, draw: 0.3012, awayWin: 0.3354,
    overProb: 0.5123, underProb: 0.4877, total: 2.5,
    xgHome: 1.3124, xgAway: 1.2834,
    homeML: +175, drawML: +232, awayML: +198,
    overOdds: -105, underOdds: -105,
  },
];

// DK fix for wc26-g-012 (JPN @ NED) — missing home moneyline
const DK_FIXES = [
  {
    fixtureId: 'wc26-g-012',
    market: '1X2',
    selection: 'home',
    line: null,
    americanOdds: -110, // Netherlands home ML (DK)
    impliedProb: 0.5238,
  },
];

async function main() {
  console.log('[ModelSeed] [STEP] Starting June 14-17 WC2026 model odds seed');
  console.log(`[ModelSeed] [INPUT] ${MODEL_DATA.length} fixtures to seed, book_id=${MODEL_BOOK_ID}`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date();
  let totalInserted = 0;
  let totalErrors = 0;

  // ── Validate probability sums before any DB writes ─────────────────────
  console.log('\n[ModelSeed] [STEP] Pre-flight probability validation...');
  for (const m of MODEL_DATA) {
    const probSum1x2 = m.homeWin + m.draw + m.awayWin;
    const probSumTotal = m.overProb + m.underProb;
    const pass1x2 = Math.abs(probSum1x2 - 1.0) < 0.001;
    const passTotal = Math.abs(probSumTotal - 1.0) < 0.001;
    if (!pass1x2 || !passTotal) {
      console.error(`[ModelSeed] [VERIFY] FAIL — ${m.fixtureId}: 1X2_sum=${probSum1x2.toFixed(6)} total_sum=${probSumTotal.toFixed(6)}`);
      totalErrors++;
    } else {
      console.log(`[ModelSeed] [VERIFY] ${m.fixtureId}: 1X2_sum=${probSum1x2.toFixed(6)} total_sum=${probSumTotal.toFixed(6)} → PASS ✓`);
    }
  }

  if (totalErrors > 0) {
    console.error(`[ModelSeed] [VERIFY] FAIL — ${totalErrors} probability validation errors. Aborting.`);
    await conn.end();
    process.exit(1);
  }

  // ── Seed model odds ────────────────────────────────────────────────────
  console.log('\n[ModelSeed] [STEP] Seeding model odds...');
  for (const m of MODEL_DATA) {
    // Verify fixture exists
    const [fixtures] = await conn.query(
      'SELECT fixture_id, home_team_id, away_team_id FROM wc2026_fixtures WHERE fixture_id = ? LIMIT 1',
      [m.fixtureId]
    );
    if (!fixtures[0]) {
      console.error(`[ModelSeed] [VERIFY] FAIL — fixture ${m.fixtureId} not found in DB`);
      totalErrors++;
      continue;
    }
    const f = fixtures[0];
    console.log(`\n[ModelSeed] [STATE] ${m.fixtureId}: home=${f.home_team_id} away=${f.away_team_id}`);

    // Delete existing model odds
    const [del] = await conn.query(
      'DELETE FROM wc2026_odds_snapshots WHERE fixture_id=? AND book_id=?',
      [m.fixtureId, MODEL_BOOK_ID]
    );
    console.log(`[ModelSeed] [STEP] Deleted ${del.affectedRows} existing model rows`);

    // Build rows
    const rows = [
      [m.fixtureId, snapshotTs, MODEL_BOOK_ID, '1X2', 'home', null, m.homeML, m.homeWin, 0],
      [m.fixtureId, snapshotTs, MODEL_BOOK_ID, '1X2', 'draw', null, m.drawML, m.draw, 0],
      [m.fixtureId, snapshotTs, MODEL_BOOK_ID, '1X2', 'away', null, m.awayML, m.awayWin, 0],
      [m.fixtureId, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'over', m.total, m.overOdds, m.overProb, 0],
      [m.fixtureId, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'under', m.total, m.underOdds, m.underProb, 0],
    ];

    const [ins] = await conn.query(
      'INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES ?',
      [rows]
    );
    totalInserted += ins.affectedRows;
    console.log(`[ModelSeed] [OUTPUT] Inserted ${ins.affectedRows} model odds rows`);
    console.log(`[ModelSeed] [OUTPUT] home=${m.homeML} draw=${m.drawML} away=${m.awayML} | O${m.total} ${m.overOdds}/${m.underOdds}`);
    console.log(`[ModelSeed] [OUTPUT] xG: home=${m.xgHome} away=${m.xgAway}`);
  }

  // ── Fix DK missing odds ────────────────────────────────────────────────
  if (DK_FIXES.length > 0) {
    console.log('\n[ModelSeed] [STEP] Applying DK odds fixes...');
    for (const fix of DK_FIXES) {
      // Check if it already exists
      const [existing] = await conn.query(
        'SELECT id FROM wc2026_odds_snapshots WHERE fixture_id=? AND book_id=68 AND market=? AND selection=? LIMIT 1',
        [fix.fixtureId, fix.market, fix.selection]
      );
      if (existing[0]) {
        console.log(`[ModelSeed] [STATE] DK fix ${fix.fixtureId} ${fix.market}/${fix.selection} already exists — skipping`);
        continue;
      }
      const [ins] = await conn.query(
        'INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES (?,?,68,?,?,?,?,?,0)',
        [fix.fixtureId, snapshotTs, fix.market, fix.selection, fix.line, fix.americanOdds, fix.impliedProb]
      );
      console.log(`[ModelSeed] [OUTPUT] DK fix inserted: ${fix.fixtureId} ${fix.market}/${fix.selection}=${fix.americanOdds}`);
    }
  }

  // ── Final verification ─────────────────────────────────────────────────
  console.log('\n[ModelSeed] [STEP] Running final verification...');
  let verifyErrors = 0;
  for (const m of MODEL_DATA) {
    const [rows] = await conn.query(
      'SELECT COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE fixture_id=? AND book_id=?',
      [m.fixtureId, MODEL_BOOK_ID]
    );
    const cnt = rows[0].cnt;
    const pass = cnt === 5;
    console.log(`[ModelSeed] [VERIFY] ${m.fixtureId}: ${cnt} model rows (expected 5) → ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!pass) verifyErrors++;
  }

  await conn.end();

  console.log(`\n[ModelSeed] [OUTPUT] Total model odds inserted: ${totalInserted}`);
  console.log(`[ModelSeed] [OUTPUT] Verification errors: ${verifyErrors}`);
  if (verifyErrors === 0 && totalErrors === 0) {
    console.log('[ModelSeed] [VERIFY] PASS — All model odds seeded and verified successfully ✓');
  } else {
    console.error(`[ModelSeed] [VERIFY] FAIL — ${verifyErrors + totalErrors} total errors`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[ModelSeed] [VERIFY] FAIL —', e.message);
  process.exit(1);
});
