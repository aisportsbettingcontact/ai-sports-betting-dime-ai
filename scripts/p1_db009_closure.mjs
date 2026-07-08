import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Step 1: Get all 59 no_book_odds match_ids
const [noBookRows] = await conn.query(
  `SELECT match_id FROM wc2026MatchOdds WHERE odds_source = 'no_book_odds' ORDER BY match_id`
);
console.log(`[INPUT] no_book_odds matches: ${noBookRows.length}`);

// Step 2: For each match, find the LATEST odds_snapshot per market/selection
// wc2026MatchOdds columns: home_ml, draw_ml, away_ml, home_spread, home_spread_odds, away_spread_odds, over_under_line, over_odds, under_odds
// odds_snapshots columns: match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing

let updated = 0;
let noSnapshot = [];
let spotChecks = [];

for (const row of noBookRows) {
  const matchId = row.match_id;
  
  // Get latest snapshot per market+selection for this match (closing = latest timestamp)
  const [snaps] = await conn.query(
    `SELECT market, selection, line, american_odds, snapshot_ts
     FROM wc2026_odds_snapshots 
     WHERE match_id = ?
     ORDER BY snapshot_ts DESC`,
    [matchId]
  );
  
  if (snaps.length === 0) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: no snapshots exist`);
    continue;
  }
  
  // Extract closing values (latest per market+selection)
  const closing = {};
  for (const s of snaps) {
    const key = `${s.market}|${s.selection}`;
    if (!closing[key]) closing[key] = s; // first = latest (ORDER BY DESC)
  }
  
  // Map to wc2026MatchOdds columns
  let homeML = null, drawML = null, awayML = null;
  let homeSpread = null, homeSpreadOdds = null, awaySpreadOdds = null;
  let ouLine = null, overOdds = null, underOdds = null;
  
  for (const [key, snap] of Object.entries(closing)) {
    const [market, selection] = key.split('|');
    const odds = snap.american_odds;
    const line = snap.line;
    
    if (market === 'moneyline' || market === '1x2') {
      if (selection === 'home' || selection === '1') homeML = odds;
      else if (selection === 'draw' || selection === 'x') drawML = odds;
      else if (selection === 'away' || selection === '2') awayML = odds;
    } else if (market === 'spread' || market === 'asian_handicap') {
      if (selection === 'home') { homeSpread = line; homeSpreadOdds = odds; }
      else if (selection === 'away') { awaySpreadOdds = odds; }
    } else if (market === 'total' || market === 'over_under') {
      if (selection === 'over') { ouLine = line; overOdds = odds; }
      else if (selection === 'under') { underOdds = odds; }
    }
  }
  
  // Validity gate: at least moneyline must exist and be plausible
  if (homeML === null && awayML === null) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: snapshots exist but no moneyline market found`);
    continue;
  }
  
  // Plausibility check: odds should be in range [-5000, +5000]
  const allOdds = [homeML, drawML, awayML, homeSpreadOdds, awaySpreadOdds, overOdds, underOdds].filter(v => v !== null);
  const implausible = allOdds.some(o => Math.abs(o) > 5000);
  if (implausible) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: implausible odds detected`);
    continue;
  }
  
  // UPDATE with provenance
  const [result] = await conn.query(
    `UPDATE wc2026MatchOdds SET 
      home_ml = COALESCE(?, home_ml),
      draw_ml = COALESCE(?, draw_ml),
      away_ml = COALESCE(?, away_ml),
      home_spread = COALESCE(?, home_spread),
      home_spread_odds = COALESCE(?, home_spread_odds),
      away_spread_odds = COALESCE(?, away_spread_odds),
      over_under_line = COALESCE(?, over_under_line),
      over_odds = COALESCE(?, over_odds),
      under_odds = COALESCE(?, under_odds),
      odds_source = 'odds_snapshots_closing',
      updated_at = NOW()
    WHERE match_id = ? AND odds_source = 'no_book_odds'`,
    [homeML, drawML, awayML, homeSpread, homeSpreadOdds, awaySpreadOdds, ouLine, overOdds, underOdds, matchId]
  );
  
  if (result.affectedRows > 0) {
    updated++;
    // Collect first 3 for spot-check
    if (spotChecks.length < 3) {
      spotChecks.push({ matchId, homeML, drawML, awayML, snapshotTs: closing[Object.keys(closing)[0]]?.snapshot_ts });
    }
  }
}

console.log(`\n[OUTPUT] Updated: ${updated}, No snapshot/skipped: ${noSnapshot.length}`);
console.log(`[OUTPUT] Skipped matches: ${JSON.stringify(noSnapshot)}`);

// Step 3: Spot checks - verify 3 matches against raw snapshot
console.log(`\n[SPOT-CHECKS]`);
for (const sc of spotChecks) {
  const [snapRows] = await conn.query(
    `SELECT market, selection, american_odds, snapshot_ts 
     FROM wc2026_odds_snapshots 
     WHERE match_id = ? AND (market IN ('moneyline','1x2'))
     ORDER BY snapshot_ts DESC LIMIT 6`,
    [sc.matchId]
  );
  console.log(`  ${sc.matchId}: written homeML=${sc.homeML} drawML=${sc.drawML} awayML=${sc.awayML}`);
  console.log(`    source snapshots: ${JSON.stringify(snapRows.slice(0, 3).map(r => ({m: r.market, s: r.selection, o: r.american_odds, ts: r.snapshot_ts})))}`);
}

// Step 4: Final count
const [finalCount] = await conn.query(
  `SELECT COUNT(*) as cnt FROM wc2026MatchOdds WHERE odds_source = 'no_book_odds'`
);
console.log(`\n[VERIFY] Remaining no_book_odds: ${finalCount[0].cnt}`);
console.log(`[VERIFY] Expected: ${noSnapshot.length} (matches with no usable snapshots)`);

await conn.end();
