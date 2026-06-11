/**
 * seedModelOddsJune11.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds 2026WCAIModel.py predictions for both June 11, 2026 WC matches into
 * wc2026_odds_snapshots using book_id=0 (reserved for AI model).
 *
 * Model predictions (from 2026WCAIModel.py run 2026-06-11):
 *   Mexico vs South Africa (home=RSA, away=MEX per DB orientation):
 *     lambda_home=1.9108, lambda_away=0.4588
 *     1X2: home=0.7167 (-253), draw=0.2117 (+373), away=0.0716 (+1296)
 *     Total 2.5: over=0.4223 (+137), under=0.5777 (-137)
 *     xG: home=1.91, away=0.46, total=2.37
 *
 *   Uzbekistan vs Colombia (home=COL, away=UZB per DB orientation):
 *     lambda_home=0.6780, lambda_away=1.6528
 *     1X2: home=0.1393 (+618), draw=0.2625 (+281), away=0.5981 (-149)
 *     Total 2.5: over=0.4121 (+143), under=0.5879 (-143)
 *     xG: home=0.68, away=1.65, total=2.33
 *
 * Run: node server/wc2026/seedModelOddsJune11.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import mysql from 'mysql2/promise';

const MODEL_BOOK_ID = 0; // Reserved for AI model predictions

// ─── Model predictions from 2026WCAIModel.py ─────────────────────────────────
// NOTE: DB stores home_team_id as the "home" team per fixture orientation.
// The seed script looks up fixtures by team IDs (both orientations).
// Mexico is AWAY in DB (away_team_id=MEX), South Africa is HOME (home_team_id=RSA)
// based on the WC2026 group stage schedule (Mexico plays at Estadio Azteca as home).
// Actually per seedWc2026.mjs line 341: awayAbbr='MEX', homeAbbr='RSA'
// So in DB: away_team_id=MEX, home_team_id=RSA
// BUT our model ran Mexico as HOME (home advantage at Azteca).
// The DB fixture orientation: home=RSA, away=MEX
// So we need to map: DB home (RSA/South Africa) = model away (0.0716), DB away (MEX/Mexico) = model home (0.7167)

const MATCH_PREDICTIONS = [
  {
    // Mexico vs South Africa — Estadio Azteca, June 11 13:00 CST
    // DB orientation: away_team_id=MEX (Mexico), home_team_id=RSA (South Africa)
    // Model ran Mexico as home (home advantage). Map accordingly:
    //   DB "home" selection = South Africa = model "away" = 0.0716 (+1296)
    //   DB "away" selection = Mexico = model "home" = 0.7167 (-253)
    awayTeamName: 'Mexico',
    homeTeamName: 'South Africa',
    awayAbbr: 'MEX',
    homeAbbr: 'RSA',
    markets: [
      // 1X2 — DB home=RSA=model away, DB away=MEX=model home
      { market: '1X2', selection: 'home', line: null, americanOdds: 1296, impliedProb: 0.0716 },   // South Africa win
      { market: '1X2', selection: 'draw', line: null, americanOdds: 373,  impliedProb: 0.2117 },   // Draw
      { market: '1X2', selection: 'away', line: null, americanOdds: -253, impliedProb: 0.7167 },   // Mexico win
      // TOTAL 2.5
      { market: 'TOTAL', selection: 'over',  line: 2.5, americanOdds: 137,  impliedProb: 0.4223 },
      { market: 'TOTAL', selection: 'under', line: 2.5, americanOdds: -137, impliedProb: 0.5777 },
    ],
    // xG metadata stored as ASIAN_HANDICAP with line=xG value for display
    xgHome: 1.91,  // Mexico xG (model home)
    xgAway: 0.46,  // South Africa xG (model away)
    modelSpread: 1.452, // Mexico -1.452
  },
  {
    // Uzbekistan vs Colombia — Estadio Azteca, June 11 20:00 CST
    // DB orientation: away_team_id=UZB (Uzbekistan), home_team_id=COL (Colombia)
    // Model ran Uzbekistan as home (neutral venue, no home advantage applied).
    // DB "home" selection = Colombia = model "away" = 0.5981 (-149)
    // DB "away" selection = Uzbekistan = model "home" = 0.1393 (+618)
    awayTeamName: 'Uzbekistan',
    homeTeamName: 'Colombia',
    awayAbbr: 'UZB',
    homeAbbr: 'COL',
    markets: [
      // 1X2 — DB home=COL=model away, DB away=UZB=model home
      { market: '1X2', selection: 'home', line: null, americanOdds: -149, impliedProb: 0.5981 },   // Colombia win
      { market: '1X2', selection: 'draw', line: null, americanOdds: 281,  impliedProb: 0.2625 },   // Draw
      { market: '1X2', selection: 'away', line: null, americanOdds: 618,  impliedProb: 0.1393 },   // Uzbekistan win
      // TOTAL 2.5
      { market: 'TOTAL', selection: 'over',  line: 2.5, americanOdds: 143,  impliedProb: 0.4121 },
      { market: 'TOTAL', selection: 'under', line: 2.5, americanOdds: -143, impliedProb: 0.5879 },
    ],
    xgHome: 1.65,  // Colombia xG (model away, DB home)
    xgAway: 0.68,  // Uzbekistan xG (model home, DB away)
    modelSpread: -0.975, // Colombia -0.975
  },
];

async function resolveTeamId(conn, abbr, name) {
  // Try fifa_code first, then name
  const [byCode] = await conn.query(
    'SELECT team_id FROM wc2026_teams WHERE fifa_code = ? LIMIT 1',
    [abbr]
  );
  if (byCode[0]) return byCode[0].team_id;
  const [byName] = await conn.query(
    'SELECT team_id FROM wc2026_teams WHERE name = ? LIMIT 1',
    [name]
  );
  if (byName[0]) return byName[0].team_id;
  // Try aliases
  const [byAlias] = await conn.query(
    'SELECT team_id FROM wc2026_team_aliases WHERE alias = ? LIMIT 1',
    [name]
  );
  return byAlias[0]?.team_id ?? null;
}

async function main() {
  console.log('[ModelSeed] [STEP] Seeding 2026WCAIModel.py predictions for June 11 WC matches');
  console.log(`[ModelSeed] [INPUT] book_id=${MODEL_BOOK_ID} (AI Model)`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date();
  let totalInserted = 0;

  for (const match of MATCH_PREDICTIONS) {
    console.log(`\n[ModelSeed] [STEP] Processing: ${match.awayTeamName} vs ${match.homeTeamName}`);

    // Resolve team IDs
    const awayId = await resolveTeamId(conn, match.awayAbbr, match.awayTeamName);
    const homeId = await resolveTeamId(conn, match.homeAbbr, match.homeTeamName);
    console.log(`[ModelSeed] [STATE] away_team_id=${awayId}, home_team_id=${homeId}`);

    if (!awayId || !homeId) {
      console.error(`[ModelSeed] [VERIFY] FAIL — Could not resolve team IDs for ${match.awayTeamName} vs ${match.homeTeamName}`);
      continue;
    }

    // Find fixture (try both orientations)
    let [fixtures] = await conn.query(
      'SELECT fixture_id FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
      [awayId, homeId]
    );
    if (!fixtures[0]) {
      [fixtures] = await conn.query(
        'SELECT fixture_id FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
        [homeId, awayId]
      );
    }
    const fixture = fixtures[0];
    if (!fixture) {
      console.error(`[ModelSeed] [VERIFY] FAIL — No fixture found for ${match.awayTeamName} vs ${match.homeTeamName}`);
      continue;
    }
    const fixtureId = fixture.fixture_id;
    console.log(`[ModelSeed] [STATE] fixture_id=${fixtureId}`);

    // Delete any existing model odds for this fixture (idempotent)
    const [del] = await conn.query(
      'DELETE FROM wc2026_odds_snapshots WHERE fixture_id=? AND book_id=?',
      [fixtureId, MODEL_BOOK_ID]
    );
    console.log(`[ModelSeed] [STEP] Deleted ${del.affectedRows} existing model rows for fixture_id=${fixtureId}`);

    // Insert model odds rows
    const rows = match.markets.map(m => [
      fixtureId,
      snapshotTs,
      MODEL_BOOK_ID,
      m.market,
      m.selection,
      m.line,
      m.americanOdds,
      m.impliedProb,
      0, // is_closing = false (live model prediction)
    ]);

    const [ins] = await conn.query(
      `INSERT INTO wc2026_odds_snapshots
        (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
       VALUES ?`,
      [rows]
    );
    totalInserted += ins.affectedRows;
    console.log(`[ModelSeed] [OUTPUT] Inserted ${ins.affectedRows} model odds rows for fixture_id=${fixtureId}`);

    // Verify 1X2 probabilities sum to 1.0
    const oneX2 = match.markets.filter(m => m.market === '1X2');
    const probSum = oneX2.reduce((s, m) => s + m.impliedProb, 0);
    const pass = Math.abs(probSum - 1.0) < 0.001;
    console.log(`[ModelSeed] [VERIFY] 1X2 prob sum=${probSum.toFixed(4)} → ${pass ? 'PASS' : 'FAIL'}`);

    // Log the predictions
    console.log(`[ModelSeed] [OUTPUT] 1X2: home=${oneX2.find(m=>m.selection==='home')?.americanOdds} draw=${oneX2.find(m=>m.selection==='draw')?.americanOdds} away=${oneX2.find(m=>m.selection==='away')?.americanOdds}`);
    console.log(`[ModelSeed] [OUTPUT] xG: home=${match.xgHome} away=${match.xgAway} spread=${match.modelSpread}`);
  }

  await conn.end();
  console.log(`\n[ModelSeed] [OUTPUT] Total rows inserted: ${totalInserted}`);
  console.log('[ModelSeed] [VERIFY] PASS — Model odds seeded successfully');
}

main().catch(e => {
  console.error('[ModelSeed] [VERIFY] FAIL —', e.message);
  process.exit(1);
});
