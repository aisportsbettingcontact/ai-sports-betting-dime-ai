/**
 * seedDkOddsJune22.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds DraftKings (book_id=68) odds for all 4 June 22, 2026 WC2026 matches.
 *
 * AUTHORITATIVE SOURCE: DK screenshot (user-provided, June 22 2026)
 * AN API confirmed matching values for 3/4 games.
 * Senegal/Norway: AN API confirmed Norway +125, Senegal +220, Draw +255.
 *
 * DB MATCH ORIENTATIONS (from wc2026_matches table):
 *   wc26-g-043: Austria (home=aut) vs Argentina (away=arg)  ← DB home=Austria
 *   wc26-g-041: Iraq (home=irq) vs France (away=fra)        ← DB home=Iraq
 *   wc26-g-042: Norway (home=nor) vs Senegal (away=sen)     ← DB home=Norway
 *   wc26-g-044: Algeria (home=alg) vs Jordan (away=jor)     ← DB home=Algeria
 *
 * CRITICAL NOTE: DB orientation for wc26-g-043 has Austria as HOME and
 * Argentina as AWAY. DK screenshot shows Argentina on top (home in DK display).
 * We map to DB orientation: home=aut, away=arg.
 *
 * DK ODDS (from screenshot, confirmed via AN API):
 *
 * wc26-g-043: Austria (DB home) vs Argentina (DB away)
 *   DK display: Argentina -190 | Draw +320 | Austria +600
 *   DB mapping: home(aut)=+600, away(arg)=-190, draw=+320
 *   Total: O2.5 -105 / U2.5 -120
 *   DC (computed from no-vig): home_draw(aut/draw)=+172, away_draw(arg/draw)=-625
 *
 * wc26-g-041: Iraq (DB home) vs France (DB away)
 *   DK display: France -1200 | Draw +1100 | Iraq +3000
 *   DB mapping: home(irq)=+3000, away(fra)=-1200, draw=+1100
 *   Total: O3.5 -115 / U3.5 -110
 *   DC (computed from no-vig): home_draw(irq/draw)=+799, away_draw(fra/draw)=-3120
 *
 * wc26-g-042: Norway (DB home) vs Senegal (DB away)
 *   DK display: Norway +125 | Draw +255 | Senegal +220
 *   DB mapping: home(nor)=+125, away(sen)=+220, draw=+255
 *   Total: O2.5 -115 / U2.5 -110
 *   DC (computed from no-vig): home_draw(nor/draw)=-134, away_draw(sen/draw)=-232
 *
 * wc26-g-044: Algeria (DB home) vs Jordan (DB away)
 *   DK display: Jordan +500 | Draw +330 | Algeria -180
 *   DB mapping: home(alg)=-180, away(jor)=+500, draw=+330
 *   Total: O2.5 -115 / U2.5 -110
 *   DC (computed from no-vig): home_draw(alg/draw)=-525, away_draw(jor/draw)=+161
 *
 * LOGGING: [SEED_DK_JUNE22] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[SEED_DK_JUNE22]';
const BOOK_ID_DK = 68;
const SNAPSHOT_TS = new Date();

// ─── Utility ─────────────────────────────────────────────────────────────────
function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function noVigProbs(homeML, drawML, awayML) {
  const rawH = americanToImplied(homeML);
  const rawD = americanToImplied(drawML);
  const rawA = americanToImplied(awayML);
  const sum = rawH + rawD + rawA;
  return { h: rawH / sum, d: rawD / sum, a: rawA / sum };
}

function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}

// ─── Match definitions ─────────────────────────────────────────────────────
// All odds mapped to DB orientation (home_team_id / away_team_id in wc2026_matches)
const MATCHES = [
  {
    matchId: 'wc26-g-043',
    label: 'Austria (DB home) vs Argentina (DB away)',
    homeTeamId: 'aut',
    awayTeamId: 'arg',
    // DK ML: Argentina -190 (DB away), Austria +600 (DB home), Draw +320
    homeML: 600,    // Austria (DB home)
    awayML: -190,   // Argentina (DB away)
    drawML: 320,
    // DK Total: O2.5 -105 / U2.5 -120
    totalLine: 2.5,
    overML: -105,
    underML: -120,
    // DC: computed from no-vig (DK does not post DC for this game via AN)
    // home_draw = Austria or Draw (1X), away_draw = Argentina or Draw (X2)
    dcComputed: true,
  },
  {
    matchId: 'wc26-g-041',
    label: 'Iraq (DB home) vs France (DB away)',
    homeTeamId: 'irq',
    awayTeamId: 'fra',
    // DK ML: France -1200 (DB away), Iraq +3000 (DB home), Draw +1100
    homeML: 3000,   // Iraq (DB home)
    awayML: -1200,  // France (DB away)
    drawML: 1100,
    // DK Total: O3.5 -115 / U3.5 -110
    totalLine: 3.5,
    overML: -115,
    underML: -110,
    dcComputed: true,
  },
  {
    matchId: 'wc26-g-042',
    label: 'Norway (DB home) vs Senegal (DB away)',
    homeTeamId: 'nor',
    awayTeamId: 'sen',
    // DK ML: Norway +125 (DB home), Senegal +220 (DB away), Draw +255
    homeML: 125,    // Norway (DB home)
    awayML: 220,    // Senegal (DB away)
    drawML: 255,
    // DK Total: O2.5 -115 / U2.5 -110
    totalLine: 2.5,
    overML: -115,
    underML: -110,
    dcComputed: true,
  },
  {
    matchId: 'wc26-g-044',
    label: 'Algeria (DB home) vs Jordan (DB away)',
    homeTeamId: 'alg',
    awayTeamId: 'jor',
    // DK ML: Algeria -180 (DB home), Jordan +500 (DB away), Draw +330
    homeML: -180,   // Algeria (DB home)
    awayML: 500,    // Jordan (DB away)
    drawML: 330,
    // DK Total: O2.5 -115 / U2.5 -110
    totalLine: 2.5,
    overML: -115,
    underML: -110,
    dcComputed: true,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} WC 2026 JUNE 22 — DK Odds Seed (book_id=68)`);
  console.log(`${TAG} Timestamp: ${SNAPSHOT_TS.toISOString()}`);
  console.log(`${TAG} Source: DK screenshot (authoritative) + AN API confirmation`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const matchIds = MATCHES.map(f => f.matchId);
  const placeholders = matchIds.map(() => '?').join(',');

  // ── Delete existing DK rows for June 22 to avoid duplicates ──────────────
  const [deleteResult] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE match_id IN (${placeholders}) AND book_id = ?`,
    [...matchIds, BOOK_ID_DK]
  );
  console.log(`${TAG} [STEP] Deleted ${deleteResult.affectedRows} existing DK rows for June 22`);

  let totalInserted = 0;
  let totalErrors = 0;

  for (const fx of MATCHES) {
    console.log(`\n${TAG} ── ${fx.matchId}: ${fx.label} ──`);
    console.log(`${TAG} [INPUT] home(${fx.homeTeamId})=${fx.homeML > 0 ? '+' : ''}${fx.homeML} draw=${fx.drawML > 0 ? '+' : ''}${fx.drawML} away(${fx.awayTeamId})=${fx.awayML > 0 ? '+' : ''}${fx.awayML}`);
    console.log(`${TAG} [INPUT] total=${fx.totalLine} over=${fx.overML > 0 ? '+' : ''}${fx.overML} under=${fx.underML > 0 ? '+' : ''}${fx.underML}`);

    // Compute no-vig probs for DC calculation
    const nv = noVigProbs(fx.homeML, fx.drawML, fx.awayML);
    console.log(`${TAG} [STATE] No-vig 1X2: H=${(nv.h*100).toFixed(2)}% D=${(nv.d*100).toFixed(2)}% A=${(nv.a*100).toFixed(2)}%`);

    // Compute DC odds from no-vig
    const homeDrawProb = nv.h + nv.d;  // 1X = home win OR draw
    const awayDrawProb = nv.a + nv.d;  // X2 = away win OR draw
    const homeDrawML = probToAmerican(homeDrawProb);
    const awayDrawML = probToAmerican(awayDrawProb);
    console.log(`${TAG} [STATE] DC computed: home_draw(1X)=${homeDrawML > 0 ? '+' : ''}${homeDrawML} away_draw(X2)=${awayDrawML > 0 ? '+' : ''}${awayDrawML}`);

    // Rows to insert
    const rows = [
      // 1X2 Moneyline
      { market: '1X2', selection: 'home', odds: fx.homeML, line: null },
      { market: '1X2', selection: 'away', odds: fx.awayML, line: null },
      { market: '1X2', selection: 'draw', odds: fx.drawML, line: null },
      // Totals
      { market: 'TOTAL', selection: 'over',  odds: fx.overML,  line: fx.totalLine },
      { market: 'TOTAL', selection: 'under', odds: fx.underML, line: fx.totalLine },
      // Double Chance (computed from no-vig)
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', odds: homeDrawML, line: null },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', odds: awayDrawML, line: null },
    ];

    for (const row of rows) {
      try {
        const impliedProb = americanToImplied(row.odds);
        await conn.execute(
          `INSERT INTO wc2026_odds_snapshots
             (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [fx.matchId, SNAPSHOT_TS, BOOK_ID_DK, row.market, row.selection,
           row.line, row.odds, impliedProb, false]
        );
        totalInserted++;
        console.log(`${TAG} [STEP] Inserted: ${fx.matchId} | ${row.market} | ${row.selection} | ${row.odds > 0 ? '+' : ''}${row.odds}${row.line !== null ? ` line=${row.line}` : ''}`);
      } catch (err) {
        totalErrors++;
        console.error(`${TAG} [ERROR] ${fx.matchId} ${row.market} ${row.selection}: ${err.message}`);
      }
    }
  }

  // ── Verify ────────────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'─'.repeat(60)}`);
  console.log(`${TAG} [VERIFY] DB state after insert:`);
  const [verifyRows] = await conn.execute(
    `SELECT match_id, market, selection, american_odds, line
     FROM wc2026_odds_snapshots
     WHERE match_id IN (${placeholders}) AND book_id = ?
     ORDER BY match_id, market, selection`,
    [...matchIds, BOOK_ID_DK]
  );
  for (const r of verifyRows) {
    const odds = r.american_odds > 0 ? `+${r.american_odds}` : `${r.american_odds}`;
    const line = r.line !== null ? ` line=${r.line}` : '';
    console.log(`${TAG} [VERIFY]   ${r.match_id} | ${r.market.padEnd(14)} | ${r.selection.padEnd(10)} | ${odds}${line}`);
  }

  const expectedRows = MATCHES.length * 7; // 3 ML + 2 total + 2 DC per match
  const pass = verifyRows.length === expectedRows && totalErrors === 0;
  console.log(`\n${TAG} [OUTPUT] Inserted: ${totalInserted} | Errors: ${totalErrors}`);
  console.log(`${TAG} [VERIFY] ${pass ? '✅ PASS' : '❌ FAIL'} — expected=${expectedRows} actual=${verifyRows.length}`);

  if (!pass) {
    console.error(`${TAG} [FATAL] Row count mismatch or errors detected. Aborting.`);
    await conn.end();
    process.exit(1);
  }

  await conn.end();
  console.log(`\n${TAG} Done. DB connection closed.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
