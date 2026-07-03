/**
 * wc-seed-dc-book.mjs
 * Seed missing DOUBLE_CHANCE book odds (book_id=68) for all 6 June 24 matches.
 * Ground truth values from user-provided data.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Ground truth: { espn_match_id, awayDc, homeDc }
// awayDc = AWAY OR DRAW (away team + draw), homeDc = HOME OR DRAW
const GT_DC = [
  { espn_match_id: 'wc26-g-049', awayDc: -170, homeDc: -310 },  // CAN or Draw, SUI or Draw
  { espn_match_id: 'wc26-g-050', awayDc: +185, homeDc: -1000 }, // QAT or Draw, BIH or Draw
  { espn_match_id: 'wc26-g-051', awayDc: -1100, homeDc: +200 }, // BRA or Draw, SCO or Draw
  { espn_match_id: 'wc26-g-052', awayDc: +340, homeDc: -3500 }, // HAI or Draw, MAR or Draw
  { espn_match_id: 'wc26-g-053', awayDc: -350, homeDc: -120 },  // MEX or Draw, CZE or Draw
  { espn_match_id: 'wc26-g-054', awayDc: -600, homeDc: +115 },  // KOR or Draw, RSA or Draw
];

const BOOK_ID = 68;
const now = new Date();

let inserted = 0;
let errors = 0;

for (const { espn_match_id, awayDc, homeDc } of GT_DC) {
  const rows = [
    { selection: 'away', americanOdds: awayDc },
    { selection: 'home', americanOdds: homeDc },
  ];

  for (const { selection, americanOdds } of rows) {
    // implied_prob = 1 / (1 + |americanOdds/100|) for favorites, etc.
    const impliedProb = americanOdds > 0
      ? 100 / (americanOdds + 100)
      : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);

    try {
      await db.execute(`
        INSERT INTO wc2026_odds_snapshots
          (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
        VALUES (?, ?, 'DOUBLE_CHANCE', ?, 0.00, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          american_odds = VALUES(american_odds),
          implied_prob = VALUES(implied_prob),
          snapshot_ts = VALUES(snapshot_ts)
      `, [espn_match_id, BOOK_ID, selection, americanOdds, impliedProb.toFixed(5), now]);

      console.log(`[OUTPUT] ✅ ${espn_match_id} | DOUBLE_CHANCE:${selection} | ${americanOdds > 0 ? '+' : ''}${americanOdds} | impliedProb=${impliedProb.toFixed(4)}`);
      inserted++;
    } catch (err) {
      console.log(`[OUTPUT] ❌ ${espn_match_id} | DOUBLE_CHANCE:${selection} | ERROR: ${err.message}`);
      errors++;
    }
  }
}

console.log(`\n[VERIFY] Inserted=${inserted} Errors=${errors}`);
console.log(`[VERIFY] ${errors === 0 ? 'PASS: All DOUBLE_CHANCE book odds seeded' : 'FAIL: Check errors above'}`);

await db.end();
