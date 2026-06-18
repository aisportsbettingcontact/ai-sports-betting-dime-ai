'use strict';
/**
 * WC2026 June 18 — TOTAL Market Fix
 * ─────────────────────────────────
 * 1. Clears all stale TOTAL snapshots for June 18 fixtures
 * 2. Inserts correct BOOK totals from user-provided ground truth
 * 3. Re-derives model O/U probabilities at the EXACT book line
 *    using the Poisson goal distributions stored in wc2026_model_projections
 * 4. Inserts model TOTAL snapshots at the matched book line
 * 5. Full cross-reference verification at the end
 *
 * Ground truth (user-provided, June 18 2026):
 *   wc26-g-025 (CZE vs RSA): O/U 2.5 | Over +100 / Under -130
 *   wc26-g-027 (SUI vs BIH): O/U 2.5 | Over -110 / Under -120
 *   wc26-g-028 (CAN vs QAT): O/U 2.5 | Over -130 / Under +100
 *   wc26-g-026 (MEX vs KOR): O/U 2.0 | Over -150 / Under +120
 */

const mysql = require('mysql2/promise');
const url = process.env.DATABASE_URL;
if (!url) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }

const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([^?]+)/);
if (!m) { console.error('[ERROR] Cannot parse DATABASE_URL'); process.exit(1); }

// ─── Constants ────────────────────────────────────────────────────────────────
const BOOK_ID_DK    = 68;
const BOOK_ID_MODEL = 0;
const MARKET        = 'TOTAL';
const NOW           = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

// ─── User-provided ground truth ───────────────────────────────────────────────
// Format: { fixtureId, bookLine, overOdds, underOdds }
const BOOK_TOTALS = [
  { fixtureId: 'wc26-g-025', bookLine: 2.5, overOdds:  100, underOdds: -130 },
  { fixtureId: 'wc26-g-027', bookLine: 2.5, overOdds: -110, underOdds: -120 },
  { fixtureId: 'wc26-g-028', bookLine: 2.5, overOdds: -130, underOdds:  100 },
  { fixtureId: 'wc26-g-026', bookLine: 2.0, overOdds: -150, underOdds:  120 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert American odds to implied probability (raw, no vig removal)
 */
function americanToImplied(american) {
  if (american >= 100)  return 100 / (american + 100);
  if (american < 0)     return Math.abs(american) / (Math.abs(american) + 100);
  return null;
}

/**
 * Convert probability to American odds (fair, no vig)
 * Returns a float to hundredths precision
 */
function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -(p / (1 - p)) * 100;
  return ((1 - p) / p) * 100;
}

/**
 * Compute P(total goals > line) from Poisson goal distributions
 * Uses the full joint distribution: P(H=h) * P(A=a) for all (h,a) where h+a > line
 * @param {Object} homeDist  { "0": prob, "1": prob, ... }
 * @param {Object} awayDist  { "0": prob, "1": prob, ... }
 * @param {number} line      e.g. 2.5
 * @returns {{ pOver: number, pUnder: number }}
 */
function computeOverUnderAtLine(homeDist, awayDist, line) {
  let pOver = 0;
  for (const [hk, hp] of Object.entries(homeDist)) {
    for (const [ak, ap] of Object.entries(awayDist)) {
      const totalGoals = parseInt(hk) + parseInt(ak);
      if (totalGoals > line) {
        pOver += parseFloat(hp) * parseFloat(ap);
      }
    }
  }
  // Clamp for floating point safety
  pOver = Math.min(1, Math.max(0, pOver));
  const pUnder = 1 - pOver;
  return { pOver, pUnder };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('======================================================================');
  console.log('[INPUT] WC2026 June 18 — TOTAL Market Fix');
  console.log('[INPUT] Fixtures: 4 | Book: DK | Model: v6.1 Poisson distributions');
  console.log('[INPUT] Ground truth source: User-provided (June 18, 2026)');
  console.log('======================================================================');

  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4] || 3306),
    user: m[1], password: m[2], database: m[5], ssl: {}
  });
  console.log(`[INPUT] Connected to ${m[3]}:${m[4] || 3306}`);

  const fixtureIds = BOOK_TOTALS.map(t => t.fixtureId);

  // ── Step 1: Pull model projections (goal distributions) ──────────────────
  console.log('');
  console.log('[STEP] Pulling model projections + goal distributions');
  const [projRows] = await conn.execute(
    `SELECT fixture_id, home_team, away_team,
            proj_home_score, proj_away_score, proj_total,
            model_total, model_total_raw,
            home_goal_dist, away_goal_dist
     FROM wc2026_model_projections
     WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')})
     ORDER BY fixture_id`,
    fixtureIds
  );

  if (projRows.length !== 4) {
    console.error(`[ERROR] Expected 4 projection rows, got ${projRows.length}`);
    await conn.end();
    process.exit(1);
  }

  // Build lookup map
  const projMap = {};
  for (const p of projRows) {
    projMap[p.fixture_id] = {
      ...p,
      homeDist: typeof p.home_goal_dist === 'string' ? JSON.parse(p.home_goal_dist) : (p.home_goal_dist || {}),
      awayDist: typeof p.away_goal_dist === 'string' ? JSON.parse(p.away_goal_dist) : (p.away_goal_dist || {}),
    };
    console.log(`[STATE] ${p.fixture_id}: ${p.home_team} vs ${p.away_team}`);
    console.log(`  proj: H=${parseFloat(p.proj_home_score).toFixed(3)} A=${parseFloat(p.proj_away_score).toFixed(3)} total=${parseFloat(p.proj_total).toFixed(3)}`);
    console.log(`  model_total=${p.model_total} (raw=${parseFloat(p.model_total_raw).toFixed(3)})`);
    const keys = Object.keys(projMap[p.fixture_id].homeDist);
    console.log(`  home_goal_dist: ${keys.length} buckets (0..${keys[keys.length-1]})`);
  }

  // ── Step 2: Clear stale TOTAL snapshots ──────────────────────────────────
  console.log('');
  console.log('[STEP] Clearing stale TOTAL snapshots');
  const [delResult] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots
     WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')})
       AND market = ?`,
    [...fixtureIds, MARKET]
  );
  console.log(`[STATE] Deleted ${delResult.affectedRows} stale TOTAL rows`);

  // ── Step 3: Compute model O/U at book line + build insert rows ────────────
  console.log('');
  console.log('[STEP] Computing model O/U probabilities at exact book lines');

  const insertRows = [];
  const results = [];

  for (const gt of BOOK_TOTALS) {
    const proj = projMap[gt.fixtureId];
    if (!proj) {
      console.error(`[ERROR] No projection found for ${gt.fixtureId}`);
      process.exit(1);
    }

    // ── Book implied probs ──
    const bookOverImpl  = americanToImplied(gt.overOdds);
    const bookUnderImpl = americanToImplied(gt.underOdds);
    const bookVig       = bookOverImpl + bookUnderImpl - 1;

    console.log(`[STATE] ${gt.fixtureId}: book line=${gt.bookLine} | over=${gt.overOdds} under=${gt.underOdds}`);
    console.log(`  book implied: over=${bookOverImpl.toFixed(6)} under=${bookUnderImpl.toFixed(6)} vig=${bookVig.toFixed(6)}`);

    // ── Model O/U at exact book line ──
    const { pOver, pUnder } = computeOverUnderAtLine(proj.homeDist, proj.awayDist, gt.bookLine);
    const modelOverOdds  = probToAmerican(pOver);
    const modelUnderOdds = probToAmerican(pUnder);

    // ── Edge detection (no-vig fair prob vs model) ──
    // No-vig fair book probs
    const nvOver  = bookOverImpl  / (bookOverImpl + bookUnderImpl);
    const nvUnder = bookUnderImpl / (bookOverImpl + bookUnderImpl);
    const edgeOverPP  = (pOver  - nvOver)  * 100;
    const edgeUnderPP = (pUnder - nvUnder) * 100;

    console.log(`  model at O/U ${gt.bookLine}: pOver=${pOver.toFixed(6)} (${modelOverOdds?.toFixed(2)}) pUnder=${pUnder.toFixed(6)} (${modelUnderOdds?.toFixed(2)})`);
    console.log(`  no-vig fair: over=${nvOver.toFixed(6)} under=${nvUnder.toFixed(6)}`);
    console.log(`  edge: over=${edgeOverPP.toFixed(2)}pp under=${edgeUnderPP.toFixed(2)}pp`);
    console.log(`  [VERIFY] pOver+pUnder=${(pOver+pUnder).toFixed(8)} → ${Math.abs(pOver+pUnder-1) < 1e-9 ? 'PASS ✓' : 'FAIL ✗'}`);

    results.push({
      fixtureId: gt.fixtureId,
      home: proj.home_team,
      away: proj.away_team,
      bookLine: gt.bookLine,
      bookOverOdds: gt.overOdds,
      bookUnderOdds: gt.underOdds,
      bookOverImpl, bookUnderImpl, bookVig,
      pOver, pUnder,
      modelOverOdds, modelUnderOdds,
      nvOver, nvUnder,
      edgeOverPP, edgeUnderPP,
    });

    // ── Build snapshot rows ──
    // DK book: over
    insertRows.push([
      gt.fixtureId, BOOK_ID_DK, MARKET, 'over',
      gt.bookLine, gt.overOdds, bookOverImpl, NOW
    ]);
    // DK book: under
    insertRows.push([
      gt.fixtureId, BOOK_ID_DK, MARKET, 'under',
      gt.bookLine, gt.underOdds, bookUnderImpl, NOW
    ]);
    // Model: over (at book line)
    insertRows.push([
      gt.fixtureId, BOOK_ID_MODEL, MARKET, 'over',
      gt.bookLine, Math.round(modelOverOdds * 100) / 100, pOver, NOW
    ]);
    // Model: under (at book line)
    insertRows.push([
      gt.fixtureId, BOOK_ID_MODEL, MARKET, 'under',
      gt.bookLine, Math.round(modelUnderOdds * 100) / 100, pUnder, NOW
    ]);
  }

  // ── Step 4: Insert all rows ───────────────────────────────────────────────
  console.log('');
  console.log('[STEP] Inserting TOTAL snapshot rows');
  let inserted = 0;
  for (const row of insertRows) {
    await conn.execute(
      `INSERT INTO wc2026_odds_snapshots
         (fixture_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row
    );
    inserted++;
    const bookName = row[1] === 0 ? 'MODEL' : 'DK';
    console.log(`  [INSERT] ${row[0]} | ${bookName} | ${row[3]} | line=${row[4]} | odds=${row[5]?.toFixed(2)} | impl=${row[6]?.toFixed(6)}`);
  }
  console.log(`[STATE] Inserted ${inserted} TOTAL rows (${inserted/4} per fixture)`);

  // ── Step 5: Verify ────────────────────────────────────────────────────────
  console.log('');
  console.log('[STEP] Running final verification');
  const [verRows] = await conn.execute(
    `SELECT fixture_id, book_id, selection, line, american_odds, implied_prob
     FROM wc2026_odds_snapshots
     WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')})
       AND market = ?
     ORDER BY fixture_id, book_id, selection`,
    [...fixtureIds, MARKET]
  );

  const verMap = {};
  for (const r of verRows) {
    const key = `${r.fixture_id}|${r.book_id}|${r.selection}`;
    verMap[key] = r;
  }

  console.log('');
  console.log('[VERIFY] ── FINAL CROSS-REFERENCE ──');
  let allPass = true;
  for (const res of results) {
    const dkOver  = verMap[`${res.fixtureId}|${BOOK_ID_DK}|over`];
    const dkUnder = verMap[`${res.fixtureId}|${BOOK_ID_DK}|under`];
    const mdOver  = verMap[`${res.fixtureId}|${BOOK_ID_MODEL}|over`];
    const mdUnder = verMap[`${res.fixtureId}|${BOOK_ID_MODEL}|under`];

    const pass = dkOver && dkUnder && mdOver && mdUnder
      && Math.abs(dkOver.line - res.bookLine) < 0.001
      && Math.abs(dkUnder.line - res.bookLine) < 0.001
      && Math.abs(mdOver.line - res.bookLine) < 0.001
      && Math.abs(mdUnder.line - res.bookLine) < 0.001
      && Math.abs(dkOver.american_odds - res.bookOverOdds) < 0.01
      && Math.abs(dkUnder.american_odds - res.bookUnderOdds) < 0.01;

    if (!pass) allPass = false;

    const status = pass ? 'PASS ✓' : 'FAIL ✗';
    console.log(`  [${status}] ${res.fixtureId}: ${res.home} vs ${res.away}`);
    console.log(`    BOOK  O/U ${res.bookLine}: Over ${res.bookOverOdds > 0 ? '+' : ''}${res.bookOverOdds} / Under ${res.bookUnderOdds > 0 ? '+' : ''}${res.bookUnderOdds}`);
    console.log(`    MODEL O/U ${res.bookLine}: Over ${res.modelOverOdds?.toFixed(2)} (p=${res.pOver.toFixed(6)}) / Under ${res.modelUnderOdds?.toFixed(2)} (p=${res.pUnder.toFixed(6)})`);
    console.log(`    NV fair:  Over=${res.nvOver.toFixed(6)} Under=${res.nvUnder.toFixed(6)}`);
    console.log(`    Edge:     Over=${res.edgeOverPP.toFixed(2)}pp Under=${res.edgeUnderPP.toFixed(2)}pp`);
    console.log(`    DB check: DK over=${dkOver?.american_odds} under=${dkUnder?.american_odds} | MODEL over=${mdOver?.american_odds?.toFixed(2)} under=${mdUnder?.american_odds?.toFixed(2)}`);
  }

  console.log('');
  console.log(`[VERIFY] Overall: ${allPass ? 'ALL PASS ✓' : 'FAILURES DETECTED ✗'}`);
  console.log(`[OUTPUT] Total rows inserted: ${inserted}`);

  await conn.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  console.error(e.stack);
  process.exit(1);
});
