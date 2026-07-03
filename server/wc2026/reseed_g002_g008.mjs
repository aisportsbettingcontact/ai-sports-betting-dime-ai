/**
 * reseed_g002_g008.mjs
 * Re-seeds model odds (book_id=0) for:
 *   wc26-g-002: KOR (home) vs CZE (away) — June 11
 *   wc26-g-008: AUS (home) vs TUR (away) — June 13
 *
 * These were the 2 remaining orientation mismatches after the bulk fix.
 * Fixture orientations are now corrected in DB. Model odds deleted. Re-seeding fresh.
 *
 * Run: node server/wc2026/reseed_g002_g008.mjs
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

function poissonPmf(lambda, k) {
  let r = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) r *= lambda / i;
  return r;
}

function dixonColes(x, y, lH, lA, rho = -0.13) {
  if (x === 0 && y === 0) return 1 - lH * lA * rho;
  if (x === 0 && y === 1) return 1 + lH * rho;
  if (x === 1 && y === 0) return 1 + lA * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function matchProbs(lH, lA, maxG = 8) {
  let hw = 0, d = 0, aw = 0, over = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = dixonColes(h, a, lH, lA) * poissonPmf(lH, h) * poissonPmf(lA, a);
      if (h > a) hw += p; else if (h === a) d += p; else aw += p;
      if (h + a > 2.5) over += p;
    }
  }
  const tot = hw + d + aw;
  return { home: hw / tot, draw: d / tot, away: aw / tot, over25: over, under25: 1 - over };
}

function toAmerican(prob) {
  if (prob >= 0.5) return Math.round(-(prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

// Team attack/defense parameters (FIFA ranking based)
const PARAMS = {
  kor: [1.55, 0.75],  // South Korea
  cze: [1.50, 0.80],  // Czech Republic
  aus: [1.40, 0.85],  // Australia
  tur: [1.50, 0.80],  // Turkey/Turkiye
};

const FIXTURES = [
  {
    matchId: 'wc26-g-002',
    homeId: 'kor',
    awayId: 'cze',
    neutral: true,
  },
  {
    matchId: 'wc26-g-008',
    homeId: 'aus',
    awayId: 'tur',
    neutral: true,
  },
];

async function main() {
  const conn = await mysql.createConnection({
    user, password, host, port: parseInt(port), database,
    ssl: { rejectUnauthorized: false }
  });

  console.log('[INPUT] Re-seeding model odds for wc26-g-002 and wc26-g-008');
  console.log('');

  const rows = [];
  const snapshotTs = new Date();

  for (const fix of FIXTURES) {
    const { matchId, homeId, awayId, neutral } = fix;
    const hp = PARAMS[homeId];
    const ap = PARAMS[awayId];

    // Base expected goals: home_attack × away_defense, away_attack × home_defense
    let lH = hp[0] * ap[1];
    let lA = ap[0] * hp[1];

    // No home advantage for neutral venues
    // (all WC2026 matches are at neutral US/Canada/Mexico venues)

    const probs = matchProbs(lH, lA);
    const homeML = toAmerican(probs.home);
    const drawML = toAmerican(probs.draw);
    const awayML = toAmerican(probs.away);
    const overOdds = toAmerican(probs.over25);
    const underOdds = toAmerican(probs.under25);
    const probSum = probs.home + probs.draw + probs.away;

    console.log(`[STEP] ${matchId}: ${awayId} @ ${homeId}`);
    console.log(`  [STATE] λH=${lH.toFixed(3)} λA=${lA.toFixed(3)}`);
    console.log(`  [STATE] xG: ${homeId}=${lH.toFixed(3)} ${awayId}=${lA.toFixed(3)}`);
    console.log(`  [STATE] 1X2: home(${homeId})=${homeML > 0 ? '+' : ''}${homeML} draw=${drawML > 0 ? '+' : ''}${drawML} away(${awayId})=${awayML > 0 ? '+' : ''}${awayML}`);
    console.log(`  [STATE] Total 2.5: over=${overOdds > 0 ? '+' : ''}${overOdds} under=${underOdds > 0 ? '+' : ''}${underOdds}`);
    console.log(`  [VERIFY] prob sum=${probSum.toFixed(6)} ${Math.abs(probSum - 1) < 0.001 ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log('');

    rows.push(
      [matchId, snapshotTs, MODEL_BOOK_ID, '1X2', 'home', null, homeML, probs.home, 0],
      [matchId, snapshotTs, MODEL_BOOK_ID, '1X2', 'draw', null, drawML, probs.draw, 0],
      [matchId, snapshotTs, MODEL_BOOK_ID, '1X2', 'away', null, awayML, probs.away, 0],
      [matchId, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'over',  2.5, overOdds,  probs.over25, 0],
      [matchId, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'under', 2.5, underOdds, probs.under25, 0],
    );
  }

  await conn.query(
    `INSERT INTO wc2026_odds_snapshots 
     (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
     VALUES ?`,
    [rows]
  );
  console.log(`[OUTPUT] Inserted ${rows.length} model odds rows`);

  // Verify
  const [verify] = await conn.execute(`
    SELECT f.match_id, f.home_team_id, f.away_team_id,
           MAX(CASE WHEN o.market='1X2' AND o.selection='home' THEN o.american_odds END) as home_ml,
           MAX(CASE WHEN o.market='1X2' AND o.selection='draw' THEN o.american_odds END) as draw_ml,
           MAX(CASE WHEN o.market='1X2' AND o.selection='away' THEN o.american_odds END) as away_ml,
           MAX(CASE WHEN o.market='TOTAL' AND o.selection='over' THEN o.american_odds END) as over_odds,
           MAX(CASE WHEN o.market='TOTAL' AND o.selection='under' THEN o.american_odds END) as under_odds
    FROM wc2026_fixtures f
    JOIN wc2026_odds_snapshots o ON f.match_id = o.match_id AND o.book_id = 0
    WHERE f.match_id IN ('wc26-g-002', 'wc26-g-008')
    GROUP BY f.match_id, f.home_team_id, f.away_team_id
  `);

  console.log('');
  console.log('[VERIFY] Post-seed check:');
  for (const v of verify) {
    const fmt = (x) => x == null ? 'N/A' : (x > 0 ? `+${x}` : `${x}`);
    const allPresent = v.home_ml != null && v.draw_ml != null && v.away_ml != null && v.over_odds != null && v.under_odds != null;
    console.log(`  [${allPresent ? 'PASS' : 'FAIL'}] ${v.match_id}: ${v.away_team_id} @ ${v.home_team_id}`);
    console.log(`    home=${fmt(v.home_ml)} draw=${fmt(v.draw_ml)} away=${fmt(v.away_ml)} | O=${fmt(v.over_odds)} U=${fmt(v.under_odds)}`);
  }

  await conn.end();
  console.log('');
  console.log('[OUTPUT] Done ✓');
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
