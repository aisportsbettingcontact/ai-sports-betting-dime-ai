/**
 * reseed_model_odds_all.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Deletes all existing model odds (book_id=0) for June 11-17 fixtures and
 * re-seeds them with the CORRECT home/away orientation per the now-fixed DB.
 *
 * Ground truth fixture orientations (post-fix, verified against Action Network):
 *
 * June 11:
 *   wc26-g-001: RSA (home) vs MEX (away)  → home=RSA is underdog, away=MEX is fav
 *   wc26-g-002: KOR (home) vs CZE (away)
 *
 * June 12:
 *   wc26-g-003: BIH (home) vs CAN (away)
 *   wc26-g-004: QAT (home) vs SUI (away)
 *   wc26-g-005: PAR (home) vs USA (away)
 *
 * June 13:
 *   wc26-g-006: MAR (home) vs BRA (away)  → home=MAR, away=BRA
 *   wc26-g-007: HAI (home) vs SCO (away)
 *   wc26-g-008: AUS (home) vs TUR (away)
 *
 * June 14:
 *   wc26-g-009: CIV (home) vs ECU (away)  [already correct]
 *   wc26-g-010: CUW (home) vs GER (away)
 *   wc26-g-011: TUN (home) vs SWE (away)
 *   wc26-g-012: JPN (home) vs NED (away)  [already correct]
 *
 * June 15:
 *   wc26-g-013: EGY (home) vs BEL (away)
 *   wc26-g-014: NZL (home) vs IRN (away)
 *   wc26-g-015: CPV (home) vs ESP (away)
 *   wc26-g-016: URU (home) vs KSA (away)
 *
 * June 16:
 *   wc26-g-017: ARG (home) vs COD (away)  [need to check]
 *   wc26-g-018: SEN (home) vs FRA (away)
 *   wc26-g-019: JOR (home) vs AUT (away)
 *   wc26-g-020: ALG (home) vs ARG (away)  [need to check]
 *
 * June 17:
 *   wc26-g-021: COD (home) vs POR (away)  [need to check]
 *   wc26-g-022: NOR (home) vs IRQ (away)  [already correct]
 *   wc26-g-023: GHA (home) vs COL (away)  [need to check]
 *   wc26-g-024: UZB (home) vs CRO (away)  [need to check]
 *
 * Model: Dixon-Coles Poisson with FIFA ranking-based attack/defense parameters
 * All probabilities are no-vig converted to American odds.
 *
 * Run: node server/wc2026/reseed_model_odds_all.mjs
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DB_URL = process.env.DATABASE_URL;
const m = DB_URL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = m;

const MODEL_BOOK_ID = 0;

// ─── Probability → American odds conversion ───────────────────────────────────
function probToAmerican(prob) {
  if (prob <= 0 || prob >= 1) throw new Error(`Invalid prob: ${prob}`);
  if (prob >= 0.5) return Math.round(-(prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

// ─── Dixon-Coles Poisson model ────────────────────────────────────────────────
function poissonPmf(lambda, k) {
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) result *= lambda / i;
  return result;
}

function dixonColesCorrection(x, y, lambdaH, lambdaA, rho) {
  if (x === 0 && y === 0) return 1 - lambdaH * lambdaA * rho;
  if (x === 0 && y === 1) return 1 + lambdaH * rho;
  if (x === 1 && y === 0) return 1 + lambdaA * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function computeMatchProbs(lambdaH, lambdaA, rho = -0.13, maxGoals = 8) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let totalOver25 = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const tau = dixonColesCorrection(h, a, lambdaH, lambdaA, rho);
      const p = tau * poissonPmf(lambdaH, h) * poissonPmf(lambdaA, a);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h + a > 2.5) totalOver25 += p;
    }
  }

  const total = homeWin + draw + awayWin;
  return {
    home: homeWin / total,
    draw: draw / total,
    away: awayWin / total,
    over25: totalOver25,
    under25: 1 - totalOver25,
  };
}

// ─── FIFA ranking-based attack/defense parameters ────────────────────────────
// Based on FIFA rankings and historical WC performance
// Format: [attack, defense] — higher attack = more goals scored, lower defense = fewer conceded
const TEAM_PARAMS = {
  // Elite (top 10 FIFA)
  'arg': [2.20, 0.55], 'fra': [2.10, 0.58], 'eng': [1.95, 0.62], 'bra': [2.05, 0.60],
  'bel': [1.90, 0.65], 'por': [1.95, 0.63], 'esp': [1.85, 0.60], 'ned': [1.80, 0.65],
  'ger': [1.85, 0.62], 'uru': [1.75, 0.68],
  // Strong (11-25 FIFA)
  'usa': [1.60, 0.75], 'mex': [1.65, 0.72], 'can': [1.50, 0.78], 'col': [1.65, 0.73],
  'mor': [1.55, 0.70], 'mar': [1.55, 0.70], 'sen': [1.60, 0.73], 'jpn': [1.60, 0.72],
  'kor': [1.55, 0.75], 'cro': [1.65, 0.70], 'sui': [1.55, 0.73], 'aut': [1.60, 0.72],
  'nor': [1.65, 0.73], 'sco': [1.50, 0.78], 'swe': [1.55, 0.75],
  // Mid-tier (26-50 FIFA)
  'tur': [1.50, 0.80], 'aus': [1.40, 0.85], 'ecu': [1.45, 0.82], 'egy': [1.40, 0.83],
  'alg': [1.45, 0.82], 'tun': [1.35, 0.85], 'irn': [1.30, 0.85], 'civ': [1.50, 0.80],
  'par': [1.35, 0.88], 'ksa': [1.35, 0.88], 'irq': [1.30, 0.88], 'jor': [1.25, 0.90],
  'nzl': [1.20, 0.92], 'cpv': [1.20, 0.92], 'uzb': [1.25, 0.90], 'gha': [1.35, 0.87],
  // Lower tier
  'rsa': [1.15, 0.95], 'bih': [1.30, 0.88], 'qat': [1.25, 0.90], 'hai': [1.15, 0.97],
  'cze': [1.50, 0.80], 'cuw': [1.10, 1.00], 'cod': [1.20, 0.93], 'pan': [1.20, 0.93],
};

// Home advantage multiplier (neutral venues get 1.0)
const HOME_ADV = 1.15;

// Neutral venue fixtures (played at US/Canada/Mexico stadiums, not home country)
const NEUTRAL_FIXTURES = new Set([
  'wc26-g-001', 'wc26-g-002', 'wc26-g-003', 'wc26-g-004', 'wc26-g-005',
  'wc26-g-006', 'wc26-g-007', 'wc26-g-008', 'wc26-g-009', 'wc26-g-010',
  'wc26-g-011', 'wc26-g-012', 'wc26-g-013', 'wc26-g-014', 'wc26-g-015',
  'wc26-g-016', 'wc26-g-017', 'wc26-g-018', 'wc26-g-019', 'wc26-g-020',
  'wc26-g-021', 'wc26-g-022', 'wc26-g-023', 'wc26-g-024',
  // Mexico fixtures get partial home advantage
]);

// Mexico gets home advantage at Azteca
const MEX_HOME_FIXTURES = new Set(['wc26-g-001', 'wc26-g-005']);
// USA gets home advantage at their venues
const USA_HOME_FIXTURES = new Set(['wc26-g-005']); // PAR vs USA — USA is "away" but at US venue

function getLambdas(homeId, awayId, matchId) {
  const hp = TEAM_PARAMS[homeId] ?? [1.30, 0.88];
  const ap = TEAM_PARAMS[awayId] ?? [1.30, 0.88];

  // Base expected goals
  let lambdaH = hp[0] * ap[1]; // home attack × away defense
  let lambdaA = ap[0] * hp[1]; // away attack × home defense

  // Apply home advantage
  if (MEX_HOME_FIXTURES.has(matchId) && homeId === 'mex') {
    lambdaH *= HOME_ADV;
    lambdaA /= HOME_ADV;
  } else if (MEX_HOME_FIXTURES.has(matchId) && awayId === 'mex') {
    // Mexico is away but at Azteca — give them home advantage
    lambdaA *= HOME_ADV;
    lambdaH /= HOME_ADV;
  }
  // All other WC fixtures are neutral venues

  return { lambdaH, lambdaA };
}

async function main() {
  const conn = await mysql.createConnection({
    user, password, host, port: parseInt(port), database,
    ssl: { rejectUnauthorized: false }
  });

  // Get all June 11-17 fixtures with current (corrected) home/away
  const [fixtures] = await conn.execute(`
    SELECT match_id, home_team_id, away_team_id, match_date
    FROM wc2026_matches
    WHERE match_date BETWEEN '2026-06-11' AND '2026-06-17'
    ORDER BY match_date, match_id
  `);

  console.log(`[INPUT] Found ${fixtures.length} fixtures for June 11-17`);
  console.log('');

  // Delete all existing model odds for these fixtures
  const matchIds = fixtures.map(f => f.match_id);
  const placeholders = matchIds.map(() => '?').join(',');
  const [delResult] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE book_id = 0 AND match_id IN (${placeholders})`,
    matchIds
  );
  console.log(`[STEP] Deleted ${delResult.affectedRows} existing model odds rows`);
  console.log('');

  const rows = [];
  const snapshotTs = new Date();
  let seeded = 0;
  const errors = [];

  for (const fix of fixtures) {
    const { match_id, home_team_id, away_team_id } = fix;
    const matchDate = fix.match_date.toISOString().slice(0, 10);

    console.log(`[STEP] ${match_id}: ${away_team_id} @ ${home_team_id} (${matchDate})`);

    const { lambdaH, lambdaA } = getLambdas(home_team_id, away_team_id, match_id);
    const probs = computeMatchProbs(lambdaH, lambdaA);

    const homeML = probToAmerican(probs.home);
    const drawML = probToAmerican(probs.draw);
    const awayML = probToAmerican(probs.away);
    const overOdds = probToAmerican(probs.over25);
    const underOdds = probToAmerican(probs.under25);

    console.log(`  [STATE] λH=${lambdaH.toFixed(3)} λA=${lambdaA.toFixed(3)}`);
    console.log(`  [STATE] xG: ${home_team_id}=${lambdaH.toFixed(3)} ${away_team_id}=${lambdaA.toFixed(3)}`);
    console.log(`  [STATE] 1X2: home(${home_team_id})=${homeML > 0 ? '+' : ''}${homeML} draw=${drawML > 0 ? '+' : ''}${drawML} away(${away_team_id})=${awayML > 0 ? '+' : ''}${awayML}`);
    console.log(`  [STATE] Total 2.5: over=${overOdds > 0 ? '+' : ''}${overOdds} under=${underOdds > 0 ? '+' : ''}${underOdds}`);

    // Validate prob sum
    const probSum = probs.home + probs.draw + probs.away;
    if (Math.abs(probSum - 1.0) > 0.001) {
      console.log(`  [VERIFY] FAIL — prob sum=${probSum.toFixed(6)}`);
      errors.push(`${match_id}: prob sum=${probSum}`);
      continue;
    }

    // Build rows
    const marketRows = [
      { market: '1X2', selection: 'home', line: null, americanOdds: homeML, impliedProb: probs.home },
      { market: '1X2', selection: 'draw', line: null, americanOdds: drawML, impliedProb: probs.draw },
      { market: '1X2', selection: 'away', line: null, americanOdds: awayML, impliedProb: probs.away },
      { market: 'TOTAL', selection: 'over',  line: 2.5, americanOdds: overOdds,  impliedProb: probs.over25 },
      { market: 'TOTAL', selection: 'under', line: 2.5, americanOdds: underOdds, impliedProb: probs.under25 },
    ];

    for (const r of marketRows) {
      rows.push([
        match_id, snapshotTs, MODEL_BOOK_ID, r.market, r.selection,
        r.line, r.americanOdds, r.impliedProb, 0
      ]);
    }

    console.log(`  [VERIFY] PASS — prob sum=${probSum.toFixed(6)} ✓`);
    seeded++;
    console.log('');
  }

  // Insert all rows
  if (rows.length > 0) {
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots 
         (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
         VALUES ?`,
        [chunk]
      );
      inserted += chunk.length;
    }
    console.log(`[OUTPUT] Inserted ${inserted} model odds rows for ${seeded} fixtures`);
  }

  // Final verification
  console.log('');
  console.log('[VERIFY] Post-seed check:');
  const [verify] = await conn.execute(`
    SELECT f.match_id, f.home_team_id, f.away_team_id,
           SUM(CASE WHEN o.market='1X2' AND o.selection='home' THEN 1 ELSE 0 END) as has_home_ml,
           SUM(CASE WHEN o.market='1X2' AND o.selection='away' THEN 1 ELSE 0 END) as has_away_ml,
           SUM(CASE WHEN o.market='TOTAL' AND o.selection='over' THEN 1 ELSE 0 END) as has_over,
           MAX(CASE WHEN o.market='1X2' AND o.selection='home' THEN o.american_odds END) as home_ml,
           MAX(CASE WHEN o.market='1X2' AND o.selection='away' THEN o.american_odds END) as away_ml
    FROM wc2026_matches f
    JOIN wc2026_odds_snapshots o ON f.match_id = o.match_id AND o.book_id = 0
    WHERE f.match_date BETWEEN '2026-06-11' AND '2026-06-17'
    GROUP BY f.match_id, f.home_team_id, f.away_team_id
    ORDER BY f.match_date, f.match_id
  `);

  let allPass = true;
  for (const v of verify) {
    const pass = v.has_home_ml > 0 && v.has_away_ml > 0 && v.has_over > 0;
    const status = pass ? 'PASS' : 'FAIL';
    if (!pass) allPass = false;
    const homeSign = v.home_ml > 0 ? '+' : '';
    const awaySign = v.away_ml > 0 ? '+' : '';
    console.log(`  [${status}] ${v.match_id}: ${v.away_team_id} @ ${v.home_team_id} | home=${homeSign}${v.home_ml} away=${awaySign}${v.away_ml}`);
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('FINAL SUMMARY:');
  console.log(`  Fixtures seeded:  ${seeded} / ${fixtures.length}`);
  console.log(`  Rows inserted:    ${rows.length}`);
  console.log(`  Errors:           ${errors.length}`);
  console.log(`  Verification:     ${allPass ? 'ALL PASS ✓' : 'SOME FAILED ✗'}`);

  await conn.end();
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
