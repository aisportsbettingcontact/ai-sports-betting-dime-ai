/**
 * seedBttsSpreadJune23.mjs
 * Seeds BTTS + ASIAN_HANDICAP (spread) markets for June 23 WC2026 fixtures.
 * These markets were missing from the original June 23 seed.
 *
 * Fixtures:
 *   wc26-g-045: UZB (home) vs POR (away)  — UZB +2.5
 *   wc26-g-046: COD (home) vs COL (away)  — COD +1.5  [FT: COL 1-0]
 *   wc26-g-047: GHA (home) vs ENG (away)  — GHA +1.5
 *   wc26-g-048: PAN (home) vs CRO (away)  — PAN +1.5
 *
 * book_id=68 = DraftKings, book_id=0 = AI Model
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const BOOK_DK = 68;
const BOOK_MODEL = 0;
const NOW = new Date().toISOString().replace("T", " ").slice(0, 19);

const FIXTURES = [
  {
    fixtureId: "wc26-g-045",
    homeSpread: 2.5, awaySpread: -2.5,
    dkBttsYes: 155, dkBttsNo: -195,
    dkHomeSpreadOdds: -110, dkAwaySpreadOdds: -110,
    modelBttsYes: 148, modelBttsNo: -182,
    modelHomeSpreadOdds: -108, modelAwaySpreadOdds: -112,
  },
  {
    fixtureId: "wc26-g-046",
    homeSpread: 1.5, awaySpread: -1.5,
    dkBttsYes: -115, dkBttsNo: -115,
    dkHomeSpreadOdds: -110, dkAwaySpreadOdds: -110,
    modelBttsYes: -108, modelBttsNo: -112,
    modelHomeSpreadOdds: -105, modelAwaySpreadOdds: -115,
  },
  {
    fixtureId: "wc26-g-047",
    homeSpread: 1.5, awaySpread: -1.5,
    dkBttsYes: -120, dkBttsNo: -110,
    dkHomeSpreadOdds: -110, dkAwaySpreadOdds: -110,
    modelBttsYes: -115, modelBttsNo: -105,
    modelHomeSpreadOdds: -112, modelAwaySpreadOdds: -108,
  },
  {
    fixtureId: "wc26-g-048",
    homeSpread: 1.5, awaySpread: -1.5,
    dkBttsYes: -110, dkBttsNo: -120,
    dkHomeSpreadOdds: -110, dkAwaySpreadOdds: -110,
    modelBttsYes: -105, modelBttsNo: -115,
    modelHomeSpreadOdds: -108, modelAwaySpreadOdds: -112,
  },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("[INPUT] Connected to DB. Seeding BTTS + SPREAD for June 23 fixtures.");

  let inserted = 0;
  let errors = 0;

  for (const f of FIXTURES) {
    console.log(`\n[STEP] Processing fixture ${f.fixtureId}`);

    const rows = [
      { bookId: BOOK_DK,    market: "BTTS",           selection: "yes",  line: null,        americanOdds: f.dkBttsYes },
      { bookId: BOOK_DK,    market: "BTTS",           selection: "no",   line: null,        americanOdds: f.dkBttsNo },
      { bookId: BOOK_DK,    market: "ASIAN_HANDICAP", selection: "home", line: f.homeSpread, americanOdds: f.dkHomeSpreadOdds },
      { bookId: BOOK_DK,    market: "ASIAN_HANDICAP", selection: "away", line: f.awaySpread, americanOdds: f.dkAwaySpreadOdds },
      { bookId: BOOK_MODEL, market: "BTTS",           selection: "yes",  line: null,        americanOdds: f.modelBttsYes },
      { bookId: BOOK_MODEL, market: "BTTS",           selection: "no",   line: null,        americanOdds: f.modelBttsNo },
      { bookId: BOOK_MODEL, market: "ASIAN_HANDICAP", selection: "home", line: f.homeSpread, americanOdds: f.modelHomeSpreadOdds },
      { bookId: BOOK_MODEL, market: "ASIAN_HANDICAP", selection: "away", line: f.awaySpread, americanOdds: f.modelAwaySpreadOdds },
    ];

    for (const r of rows) {
      try {
        await conn.execute(
          `INSERT INTO wc2026_odds_snapshots
             (fixture_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1)
           ON DUPLICATE KEY UPDATE
             american_odds = VALUES(american_odds),
             line = VALUES(line),
             snapshot_ts = VALUES(snapshot_ts)`,
          [f.fixtureId, r.bookId, r.market, r.selection, r.line, r.americanOdds, NOW]
        );
        console.log(`  [STATE] OK book=${r.bookId} ${r.market}/${r.selection} odds=${r.americanOdds} line=${r.line}`);
        inserted++;
      } catch (e) {
        console.error(`  [ERROR] FAIL ${r.market}/${r.selection}: ${e.message}`);
        errors++;
      }
    }
  }

  await conn.end();
  console.log(`\n[OUTPUT] Seed complete: inserted/updated=${inserted} errors=${errors}`);
  console.log(`[VERIFY] ${errors === 0 ? "PASS" : "FAIL"} — ${errors} errors`);
}

main().catch((e) => {
  console.error("[ERROR] Fatal:", e.message);
  process.exit(1);
});
