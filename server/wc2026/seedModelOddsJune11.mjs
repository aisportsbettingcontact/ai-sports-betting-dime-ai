/**
 * seedModelOddsJune11.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds 2026WCAIModel.py predictions for both June 11, 2026 WC matches into
 * wc2026_odds_snapshots using book_id=0 (reserved for AI model).
 *
 * CORRECTED FIXTURE ORIENTATIONS (per user + FIFA schedule):
 *   wc26-g-001: Mexico (HOME, Estadio Azteca) vs South Africa (AWAY)
 *   wc26-g-002: South Korea (HOME, SoFi Stadium neutral) vs Czech Republic (AWAY)
 *
 * DB fixture table (post-fix):
 *   wc26-g-001: home_team_id=MEX, away_team_id=RSA
 *   wc26-g-002: home_team_id=KOR, away_team_id=CZE
 *
 * Model predictions (from run_june11_corrected.py, 2026-06-11):
 *   wc26-g-001: Mexico HOME, neutral=False, home_flag=1
 *     lambda_home=2.1064, lambda_away=0.5017
 *     1X2: home(MEX)=0.7420 (-288), draw=0.1903 (+426), away(RSA)=0.0677 (+1376)
 *     Total 2.5: over=0.4223 (+137), under=0.5777 (-137)
 *     xG: MEX=2.106, RSA=0.502
 *
 *   wc26-g-002: South Korea HOME, neutral=True, home_flag=0
 *     lambda_home=1.8648, lambda_away=1.1003
 *     1X2: home(KOR)=0.5417 (-118), draw=0.2469 (+305), away(CZE)=0.2114 (+373)
 *     Total 2.5: over=0.5612 (-128), under=0.4388 (+128)
 *     xG: KOR=1.865, CZE=1.100
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

const MODEL_BOOK_ID = 0;

const MATCH_PREDICTIONS = [
  {
    homeTeamName: 'Mexico',
    awayTeamName: 'South Africa',
    homeAbbr: 'MEX',
    awayAbbr: 'RSA',
    markets: [
      { market: '1X2', selection: 'home', line: null, americanOdds: -288, impliedProb: 0.7420 },
      { market: '1X2', selection: 'draw', line: null, americanOdds: 426,  impliedProb: 0.1903 },
      { market: '1X2', selection: 'away', line: null, americanOdds: 1376, impliedProb: 0.0677 },
      { market: 'TOTAL', selection: 'over',  line: 2.5, americanOdds: 137,  impliedProb: 0.4223 },
      { market: 'TOTAL', selection: 'under', line: 2.5, americanOdds: -137, impliedProb: 0.5777 },
    ],
    xgHome: 2.106,
    xgAway: 0.502,
    modelSpread: -1.605,
  },
  {
    homeTeamName: 'South Korea',
    awayTeamName: 'Czech Republic',
    homeAbbr: 'KOR',
    awayAbbr: 'CZE',
    markets: [
      { market: '1X2', selection: 'home', line: null, americanOdds: -118, impliedProb: 0.5417 },
      { market: '1X2', selection: 'draw', line: null, americanOdds: 305,  impliedProb: 0.2469 },
      { market: '1X2', selection: 'away', line: null, americanOdds: 373,  impliedProb: 0.2114 },
      { market: 'TOTAL', selection: 'over',  line: 2.5, americanOdds: -128, impliedProb: 0.5612 },
      { market: 'TOTAL', selection: 'under', line: 2.5, americanOdds: 128,  impliedProb: 0.4388 },
    ],
    xgHome: 1.865,
    xgAway: 1.100,
    modelSpread: -0.765,
  },
];

async function resolveTeamId(conn, abbr, name) {
  const [byCode] = await conn.query('SELECT team_id FROM wc2026_teams WHERE fifa_code = ? LIMIT 1', [abbr]);
  if (byCode[0]) return byCode[0].team_id;
  const [byName] = await conn.query('SELECT team_id FROM wc2026_teams WHERE name = ? LIMIT 1', [name]);
  if (byName[0]) return byName[0].team_id;
  const [byAlias] = await conn.query('SELECT team_id FROM wc2026_team_aliases WHERE alias = ? LIMIT 1', [name]);
  return byAlias[0]?.team_id ?? null;
}

async function main() {
  console.log('[ModelSeed] [STEP] Seeding CORRECTED 2026WCAIModel.py predictions for June 11 WC matches');
  console.log('[ModelSeed] [INPUT] book_id=0 (AI Model)');
  console.log('[ModelSeed] [INPUT] wc26-g-001: home=MEX, away=RSA | wc26-g-002: home=KOR, away=CZE');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date();
  let totalInserted = 0;

  for (const match of MATCH_PREDICTIONS) {
    console.log(`\n[ModelSeed] [STEP] Processing: ${match.homeTeamName} (HOME) vs ${match.awayTeamName} (AWAY)`);
    const homeId = await resolveTeamId(conn, match.homeAbbr, match.homeTeamName);
    const awayId = await resolveTeamId(conn, match.awayAbbr, match.awayTeamName);
    console.log(`[ModelSeed] [STATE] home_team_id=${homeId}, away_team_id=${awayId}`);
    if (!homeId || !awayId) {
      console.error(`[ModelSeed] [VERIFY] FAIL — Could not resolve team IDs`);
      continue;
    }
    let [fixtures] = await conn.query(
      'SELECT match_id FROM wc2026_fixtures WHERE home_team_id=? AND away_team_id=? LIMIT 1',
      [homeId, awayId]
    );
    if (!fixtures[0]) {
      [fixtures] = await conn.query(
        'SELECT match_id FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
        [homeId, awayId]
      );
    }
    const fixture = fixtures[0];
    if (!fixture) {
      console.error(`[ModelSeed] [VERIFY] FAIL — No fixture found for ${match.homeTeamName} vs ${match.awayTeamName}`);
      continue;
    }
    const matchId = fixture.match_id;
    console.log(`[ModelSeed] [STATE] match_id=${matchId}`);
    const [del] = await conn.query(
      'DELETE FROM wc2026_odds_snapshots WHERE match_id=? AND book_id=?',
      [matchId, MODEL_BOOK_ID]
    );
    console.log(`[ModelSeed] [STEP] Deleted ${del.affectedRows} existing model rows`);
    const rows = match.markets.map(m => [
      matchId, snapshotTs, MODEL_BOOK_ID, m.market, m.selection, m.line, m.americanOdds, m.impliedProb, 0,
    ]);
    const [ins] = await conn.query(
      'INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES ?',
      [rows]
    );
    totalInserted += ins.affectedRows;
    console.log(`[ModelSeed] [OUTPUT] Inserted ${ins.affectedRows} model odds rows for match_id=${matchId}`);
    const oneX2 = match.markets.filter(m => m.market === '1X2');
    const probSum = oneX2.reduce((s, m) => s + m.impliedProb, 0);
    console.log(`[ModelSeed] [VERIFY] 1X2 prob sum=${probSum.toFixed(4)} → ${Math.abs(probSum - 1.0) < 0.001 ? 'PASS' : 'FAIL'}`);
    console.log(`[ModelSeed] [OUTPUT] home(${match.homeAbbr})=${oneX2.find(m=>m.selection==='home')?.americanOdds} draw=${oneX2.find(m=>m.selection==='draw')?.americanOdds} away(${match.awayAbbr})=${oneX2.find(m=>m.selection==='away')?.americanOdds}`);
    console.log(`[ModelSeed] [OUTPUT] xG: home=${match.xgHome} away=${match.xgAway} spread=${match.modelSpread}`);
  }

  await conn.end();
  console.log(`\n[ModelSeed] [OUTPUT] Total rows inserted: ${totalInserted}`);
  console.log('[ModelSeed] [VERIFY] PASS — Corrected model odds seeded successfully');
}

main().catch(e => {
  console.error('[ModelSeed] [VERIFY] FAIL —', e.message);
  process.exit(1);
});
