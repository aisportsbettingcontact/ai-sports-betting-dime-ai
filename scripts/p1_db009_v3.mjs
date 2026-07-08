import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// wc2026MatchOdds columns (book_ prefix):
// book_home_ml, book_away_ml, book_draw, book_home_wd, book_away_wd, book_no_draw
// book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds
// book_total, book_over_odds, book_under_odds
// book_btts_yes, book_btts_no
// book_home_to_advance, book_away_to_advance
// odds_source, odds_updated_at

// odds_snapshots: market (1X2, TOTAL, ASIAN_HANDICAP), selection (home/away/draw/over/under)

const [noBookRows] = await conn.query(
  `SELECT match_id FROM wc2026MatchOdds WHERE odds_source = 'no_book_odds' ORDER BY match_id`
);
console.log(`[INPUT] no_book_odds matches: ${noBookRows.length}`);

let updated = 0;
let noSnapshot = [];
let spotChecks = [];

for (const row of noBookRows) {
  const matchId = row.match_id;
  
  const [snaps] = await conn.query(
    `SELECT market, selection, line, american_odds, snapshot_ts
     FROM wc2026_odds_snapshots 
     WHERE match_id = ?
     ORDER BY snapshot_ts DESC`,
    [matchId]
  );
  
  if (snaps.length === 0) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: no snapshots`);
    continue;
  }
  
  // Extract closing (latest per market+selection)
  const closing = {};
  for (const s of snaps) {
    const key = `${s.market.toUpperCase()}|${s.selection.toUpperCase()}`;
    if (!closing[key]) closing[key] = s;
  }
  
  // Map to wc2026MatchOdds book_ columns
  let bookHomeML = null, bookAwayML = null, bookDraw = null;
  let bookSpread = null, bookHomeSpreadOdds = null, bookAwaySpreadOdds = null;
  let bookTotal = null, bookOverOdds = null, bookUnderOdds = null;
  
  for (const [key, snap] of Object.entries(closing)) {
    const [market, selection] = key.split('|');
    const odds = snap.american_odds;
    const line = snap.line;
    
    if (market === '1X2' || market === 'MONEYLINE') {
      if (selection === 'HOME' || selection === '1') bookHomeML = odds;
      else if (selection === 'DRAW' || selection === 'X') bookDraw = odds;
      else if (selection === 'AWAY' || selection === '2') bookAwayML = odds;
    } else if (market === 'ASIAN_HANDICAP' || market === 'SPREAD') {
      if (selection === 'HOME' || selection === '1') { bookSpread = line; bookHomeSpreadOdds = odds; }
      else if (selection === 'AWAY' || selection === '2') { bookAwaySpreadOdds = odds; }
    } else if (market === 'TOTAL' || market === 'OVER_UNDER') {
      if (selection === 'OVER') { bookTotal = line; bookOverOdds = odds; }
      else if (selection === 'UNDER') { bookUnderOdds = odds; }
    }
  }
  
  // Validity gate: at least 1X2 must exist
  if (bookHomeML === null && bookAwayML === null) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: no 1X2 market (markets: ${[...new Set(Object.keys(closing).map(k => k.split('|')[0]))].join(',')})`);
    continue;
  }
  
  // Plausibility: odds in [-5000, +5000]
  const allOdds = [bookHomeML, bookAwayML, bookDraw, bookHomeSpreadOdds, bookAwaySpreadOdds, bookOverOdds, bookUnderOdds].filter(v => v !== null);
  if (allOdds.some(o => Math.abs(o) > 5000)) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: implausible odds`);
    continue;
  }
  
  // Idempotent UPDATE keyed on match_id
  const [result] = await conn.query(
    `UPDATE wc2026MatchOdds SET 
      book_home_ml = COALESCE(?, book_home_ml),
      book_away_ml = COALESCE(?, book_away_ml),
      book_draw = COALESCE(?, book_draw),
      book_primary_spread = COALESCE(?, book_primary_spread),
      book_home_primary_spread_odds = COALESCE(?, book_home_primary_spread_odds),
      book_away_primary_spread_odds = COALESCE(?, book_away_primary_spread_odds),
      book_total = COALESCE(?, book_total),
      book_over_odds = COALESCE(?, book_over_odds),
      book_under_odds = COALESCE(?, book_under_odds),
      odds_source = 'odds_snapshots_closing',
      odds_updated_at = NOW()
    WHERE match_id = ? AND odds_source = 'no_book_odds'`,
    [bookHomeML, bookAwayML, bookDraw, bookSpread, bookHomeSpreadOdds, bookAwaySpreadOdds, bookTotal, bookOverOdds, bookUnderOdds, matchId]
  );
  
  if (result.affectedRows > 0) {
    updated++;
    if (spotChecks.length < 3) {
      spotChecks.push({ matchId, bookHomeML, bookDraw, bookAwayML, bookTotal, bookOverOdds, bookUnderOdds });
    }
  }
}

console.log(`\n[OUTPUT] Updated: ${updated}, No snapshot/skipped: ${noSnapshot.length}`);
console.log(`[OUTPUT] Skipped: ${JSON.stringify(noSnapshot)}`);

// Spot checks
console.log(`\n[SPOT-CHECKS]`);
for (const sc of spotChecks) {
  const [snapRows] = await conn.query(
    `SELECT market, selection, american_odds, snapshot_ts 
     FROM wc2026_odds_snapshots 
     WHERE match_id = ? AND UPPER(market) = '1X2'
     ORDER BY snapshot_ts DESC LIMIT 6`,
    [sc.matchId]
  );
  console.log(`  ${sc.matchId}: written book_home_ml=${sc.bookHomeML} book_draw=${sc.bookDraw} book_away_ml=${sc.bookAwayML}`);
  console.log(`    source: ${snapRows.map(r => `${r.selection}=${r.american_odds}@${new Date(r.snapshot_ts).toISOString().slice(0,16)}`).join(' | ')}`);
}

// Final count
const [finalCount] = await conn.query(
  `SELECT COUNT(*) as cnt FROM wc2026MatchOdds WHERE odds_source = 'no_book_odds'`
);
const [closingCount] = await conn.query(
  `SELECT COUNT(*) as cnt FROM wc2026MatchOdds WHERE odds_source = 'odds_snapshots_closing'`
);
console.log(`\n[VERIFY] Remaining no_book_odds: ${finalCount[0].cnt}`);
console.log(`[VERIFY] New odds_snapshots_closing: ${closingCount[0].cnt}`);
console.log(`[VERIFY] Expected remaining: ${noSnapshot.length}`);

await conn.end();
