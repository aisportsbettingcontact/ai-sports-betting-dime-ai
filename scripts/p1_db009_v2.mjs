import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Step 1: Get all 59 no_book_odds match_ids
const [noBookRows] = await conn.query(
  `SELECT match_id FROM wc2026MatchOdds WHERE odds_source = 'no_book_odds' ORDER BY match_id`
);
console.log(`[INPUT] no_book_odds matches: ${noBookRows.length}`);

// Check actual market/selection values
const [sampleSnap] = await conn.query(
  `SELECT market, selection, american_odds, line, snapshot_ts 
   FROM wc2026_odds_snapshots WHERE match_id = 'wc26-g-002' 
   ORDER BY snapshot_ts DESC LIMIT 10`
);
console.log(`[DEBUG] Sample snapshot values:`);
sampleSnap.forEach(r => console.log(`  market=${r.market} selection=${r.selection} odds=${r.american_odds} line=${r.line}`));

let updated = 0;
let noSnapshot = [];
let spotChecks = [];

for (const row of noBookRows) {
  const matchId = row.match_id;
  
  // Get latest snapshot per market+selection (case-insensitive matching)
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
    const key = `${s.market.toUpperCase()}|${s.selection.toUpperCase()}`;
    if (!closing[key]) closing[key] = s;
  }
  
  // Map to wc2026MatchOdds columns - handle UPPERCASE market names
  let homeML = null, drawML = null, awayML = null;
  let homeSpread = null, homeSpreadOdds = null, awaySpreadOdds = null;
  let ouLine = null, overOdds = null, underOdds = null;
  
  for (const [key, snap] of Object.entries(closing)) {
    const [market, selection] = key.split('|');
    const odds = snap.american_odds;
    const line = snap.line;
    
    if (market === '1X2' || market === 'MONEYLINE') {
      if (selection === 'HOME' || selection === '1') homeML = odds;
      else if (selection === 'DRAW' || selection === 'X') drawML = odds;
      else if (selection === 'AWAY' || selection === '2') awayML = odds;
    } else if (market === 'ASIAN_HANDICAP' || market === 'SPREAD') {
      if (selection === 'HOME' || selection === '1') { homeSpread = line; homeSpreadOdds = odds; }
      else if (selection === 'AWAY' || selection === '2') { awaySpreadOdds = odds; }
    } else if (market === 'TOTAL' || market === 'OVER_UNDER') {
      if (selection === 'OVER') { ouLine = line; overOdds = odds; }
      else if (selection === 'UNDER') { underOdds = odds; }
    }
  }
  
  // Validity gate: at least moneyline must exist
  if (homeML === null && awayML === null) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: no moneyline found (markets: ${Object.keys(closing).join(', ')})`);
    continue;
  }
  
  // Plausibility check
  const allOdds = [homeML, drawML, awayML, homeSpreadOdds, awaySpreadOdds, overOdds, underOdds].filter(v => v !== null);
  const implausible = allOdds.some(o => Math.abs(o) > 5000);
  if (implausible) {
    noSnapshot.push(matchId);
    console.log(`[SKIP] ${matchId}: implausible odds`);
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
    if (spotChecks.length < 3) {
      spotChecks.push({ matchId, homeML, drawML, awayML, homeSpread, homeSpreadOdds, ouLine, overOdds });
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
  console.log(`  ${sc.matchId}: written homeML=${sc.homeML} drawML=${sc.drawML} awayML=${sc.awayML}`);
  console.log(`    source: ${snapRows.map(r => `${r.selection}=${r.american_odds}@${r.snapshot_ts}`).join(' | ')}`);
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

await conn.end();
