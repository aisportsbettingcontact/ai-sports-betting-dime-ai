/**
 * seedModelOddsJune17v4.mjs
 * =========================
 * Seeds MODEL v4.1 recalibrated odds (book_id=0) for 4 WC2026 June 17 fixtures.
 *
 * Model: Dixon-Coles Poisson + Elo + Form | 250,000 Monte Carlo Simulations
 * Version: v4.1 — Neutral Site, Recalibrated on 116-game corpus
 *
 * Backtest Corpus: 2018 + 2022 + 2026 WC Group Stage (116 games)
 *   Direction accuracy:  54.3% (63/116) vs 33.3% random baseline (+21.0pp)
 *   Total accuracy:      69.8% (81/116) vs 50.0% random baseline (+19.8pp)
 *   Combined accuracy:   62.1% vs 41.7% random baseline (+20.4pp)
 *   Brier score:         0.187862
 *
 * Recalibrated Parameters (grid search over 4,500 combinations):
 *   w_xg=0.65, w_elo=0.15, w_form=0.20
 *   rho=-0.15 (Dixon-Coles), xg_sot=0.42, xg_reg=0.20
 *   home_advantage=0.00, draw_bias=0.00, alt_coeff=0.030
 *
 * DB Schema: wc2026_odds_snapshots
 *   (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
 *   market: '1X2' | 'TOTAL'
 *   selection: 'home'|'draw'|'away' for 1X2; 'over'|'under' for TOTAL
 *
 * DB Orientation (home/away as stored in wc2026_fixtures):
 *   wc26-g-021: DB home=cod (DR Congo), DB away=por (Portugal)
 *   wc26-g-023: DB home=eng, DB away=cro
 *   wc26-g-024: DB home=gha, DB away=pan
 *   wc26-g-022: DB home=uzb, DB away=col
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const MODEL_BOOK_ID = 0;

/**
 * Model v4.1 outputs — 250k sims each
 *
 * wc26-g-021: DB home=cod, DB away=por
 *   λ_cod=0.2511, λ_por=1.0516
 *   cod_win=0.0775, draw=0.3512, por_win=0.5713
 *   Expected: cod 0.27 – por 1.13 | Total 1.40
 *   DK: cod +1000 / Draw +662 / por -330 | Total 2.5 (O-115/U-105)
 *
 * wc26-g-023: DB home=eng, DB away=cro
 *   λ_eng=0.9883, λ_cro=0.4116
 *   eng_win=0.4764, draw=0.3871, cro_win=0.1365
 *   Expected: eng 0.99 – cro 0.41 | Total 1.40
 *   DK: eng -135 / Draw +343 / cro +400 | Total 2.5 (O+115/U-140)
 *
 * wc26-g-024: DB home=gha, DB away=pan
 *   λ_gha=0.8258, λ_pan=0.5150
 *   gha_win=0.3844, draw=0.4190, pan_win=0.1965
 *   Expected: gha 0.82 – pan 0.51 | Total 1.34
 *   DK: gha +135 / Draw +268 / pan +230 | Total 2.5 (O-110/U-165)
 *
 * wc26-g-022: DB home=uzb, DB away=col (altitude 2240m → AF=0.9328)
 *   λ_uzb=0.3309, λ_col=0.9590
 *   uzb_win=0.1123, draw=0.3964, col_win=0.4913
 *   Expected: uzb 0.33 – col 0.96 | Total 1.29
 *   DK: uzb +850 / Draw +520 / col -275 | Total 2.5 (O+115/U-115)
 */

const MODEL_DATA = [
  {
    matchId: 'wc26-g-021',
    // DB home=cod, DB away=por
    homeWin:  0.0775,  // cod wins
    draw:     0.3512,
    awayWin:  0.5713,  // por wins
    homeML:   1000,    // cod DK ML
    drawML:   662,
    awayML:  -330,     // por DK ML
    total:    2.5,
    overProb: 0.0947,
    underProb:0.9053,
    overOdds: -115,
    underOdds:-105,
    xgHome:   0.27,    // cod expected goals
    xgAway:   1.13,    // por expected goals
  },
  {
    matchId: 'wc26-g-023',
    homeWin:  0.4764,
    draw:     0.3871,
    awayWin:  0.1365,
    homeML:  -135,
    drawML:   343,
    awayML:   400,
    total:    2.5,
    overProb: 0.1220,
    underProb:0.8780,
    overOdds:  115,
    underOdds:-140,
    xgHome:   0.99,
    xgAway:   0.41,
  },
  {
    matchId: 'wc26-g-024',
    homeWin:  0.3844,
    draw:     0.4190,
    awayWin:  0.1965,
    homeML:   135,
    drawML:   268,
    awayML:   230,
    total:    2.5,
    overProb: 0.0967,
    underProb:0.9033,
    overOdds: -110,
    underOdds:-165,
    xgHome:   0.82,
    xgAway:   0.51,
  },
  {
    matchId: 'wc26-g-022',
    homeWin:  0.1123,
    draw:     0.3964,
    awayWin:  0.4913,
    homeML:   850,
    drawML:   520,
    awayML:  -275,
    total:    2.5,
    overProb: 0.0737,
    underProb:0.9263,
    overOdds:  115,
    underOdds:-115,
    xgHome:   0.33,
    xgAway:   0.96,
  },
];

async function seedModelOdds() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[ModelSeed v4.1] [DB] Connected');

  // snapshot_ts is a MySQL TIMESTAMP column — must use datetime string, not Unix ms
  const now = new Date();
  const snapshotTs = now.toISOString().slice(0, 19).replace('T', ' ');
  let totalInserted = 0;
  let totalErrors   = 0;

  for (const m of MODEL_DATA) {
    console.log(`\n[ModelSeed v4.1] [FIXTURE] ${m.matchId}`);
    console.log(`[ModelSeed v4.1] [INPUT] home_win=${m.homeWin} draw=${m.draw} away_win=${m.awayWin}`);
    console.log(`[ModelSeed v4.1] [INPUT] homeML=${m.homeML} drawML=${m.drawML} awayML=${m.awayML}`);
    console.log(`[ModelSeed v4.1] [INPUT] total=${m.total} over=${m.overOdds} under=${m.underOdds}`);
    console.log(`[ModelSeed v4.1] [INPUT] xG: home=${m.xgHome} away=${m.xgAway}`);

    // Validate probability sum
    const pSum = m.homeWin + m.draw + m.awayWin;
    if (Math.abs(pSum - 1.0) > 0.01) {
      console.error(`[ModelSeed v4.1] [ERROR] Probability sum=${pSum} — FAIL`);
      totalErrors++;
      continue;
    }
    console.log(`[ModelSeed v4.1] [VERIFY] Probability sum=${pSum.toFixed(6)} ✓ PASS`);

    // Delete existing model rows for this fixture
    const [del] = await conn.query(
      'DELETE FROM wc2026_odds_snapshots WHERE match_id=? AND book_id=?',
      [m.matchId, MODEL_BOOK_ID]
    );
    console.log(`[ModelSeed v4.1] [STEP] Deleted ${del.affectedRows} existing model rows`);

    // Build rows — schema: (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
    const rows = [
      [m.matchId, snapshotTs, MODEL_BOOK_ID, '1X2',  'home',  null,    m.homeML,   m.homeWin,  0],
      [m.matchId, snapshotTs, MODEL_BOOK_ID, '1X2',  'draw',  null,    m.drawML,   m.draw,     0],
      [m.matchId, snapshotTs, MODEL_BOOK_ID, '1X2',  'away',  null,    m.awayML,   m.awayWin,  0],
      [m.matchId, snapshotTs, MODEL_BOOK_ID, 'TOTAL','over',  m.total, m.overOdds, m.overProb, 0],
      [m.matchId, snapshotTs, MODEL_BOOK_ID, 'TOTAL','under', m.total, m.underOdds,m.underProb,0],
    ];

    try {
      const [ins] = await conn.query(
        'INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES ?',
        [rows]
      );
      totalInserted += ins.affectedRows;
      console.log(`[ModelSeed v4.1] [OUTPUT] Inserted ${ins.affectedRows} model odds rows`);
      console.log(`[ModelSeed v4.1] [OUTPUT] home=${m.homeML} draw=${m.drawML} away=${m.awayML} | O${m.total} ${m.overOdds}/${m.underOdds}`);
      console.log(`[ModelSeed v4.1] [OUTPUT] xG: home=${m.xgHome} away=${m.xgAway}`);
    } catch (e) {
      console.error(`[ModelSeed v4.1] [ERROR] Insert failed: ${e.message}`);
      totalErrors++;
    }
  }

  // ── Final verification ───────────────────────────────────────────────────
  console.log('\n[ModelSeed v4.1] [STEP] Running final verification...');
  let verifyErrors = 0;
  for (const m of MODEL_DATA) {
    const [rows] = await conn.query(
      'SELECT COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id=? AND book_id=?',
      [m.matchId, MODEL_BOOK_ID]
    );
    const cnt = rows[0].cnt;
    const pass = cnt === 5;
    console.log(`[ModelSeed v4.1] [VERIFY] ${m.matchId}: ${cnt}/5 rows — ${pass ? '✓ PASS' : '✗ FAIL'}`);
    if (!pass) verifyErrors++;
  }

  await conn.end();

  console.log(`\n[ModelSeed v4.1] [SUMMARY] inserted=${totalInserted} errors=${totalErrors} verifyErrors=${verifyErrors}`);
  console.log(`[ModelSeed v4.1] [VERIFY] Expected 20 rows (4 fixtures × 5 markets). Got ${totalInserted}.`);

  if (totalErrors > 0 || verifyErrors > 0) {
    console.error('[ModelSeed v4.1] [VERIFY] FAIL — errors detected');
    process.exit(1);
  }
  console.log('[ModelSeed v4.1] [VERIFY] ALL PASS — 4/4 fixtures, 20/20 rows seeded correctly');
}

seedModelOdds().catch(e => { console.error('[ModelSeed v4.1] [FATAL]', e); process.exit(1); });
