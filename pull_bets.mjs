/**
 * PULL FULL BET DETAILS — Bets from screenshot
 * Bet IDs: 150247, 150250, 150100, 150097, 150102, 150098, 150099, 150020
 * Also pull associated bet_edit_requests for context
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const BET_IDS = [150020, 150097, 150098, 150099, 150100, 150102, 150247, 150250];

console.log('═══════════════════════════════════════════════════════════════');
console.log('[INPUT] Pulling full details for bet IDs:', BET_IDS.join(', '));
console.log('═══════════════════════════════════════════════════════════════\n');

// ─── STEP 1: Full tracked_bets rows ──────────────────────────────────────────
console.log('[STEP 1] Querying tracked_bets for all 8 bet IDs...');
const [bets] = await conn.execute(
  `SELECT 
     tb.id,
     au.username,
     tb.sport,
     tb.gameDate,
     tb.awayTeam,
     tb.homeTeam,
     tb.betType,
     tb.pick,
     tb.odds,
     tb.riskUnits,
     tb.toWinUnits,
     tb.risk,
     tb.toWin,
     tb.line,
     tb.market,
     tb.pickSide,
     tb.timeframe,
     tb.wagerType,
     tb.result,
     tb.awayScore,
     tb.homeScore,
     tb.notes,
     tb.book,
     tb.gameNumber,
     tb.createdAt,
     tb.updatedAt
   FROM tracked_bets tb
   LEFT JOIN app_users au ON tb.userId = au.id
   WHERE tb.id IN (${BET_IDS.join(',')})
   ORDER BY tb.id ASC`,
);

console.log(`[STATE] Rows returned: ${bets.length} / ${BET_IDS.length} expected\n`);

for (const b of bets) {
  console.log(`─── BET #${b.id} ───────────────────────────────────────────────`);
  console.log(`  [FIELD] user         : @${b.username}`);
  console.log(`  [FIELD] sport        : ${b.sport}`);
  console.log(`  [FIELD] gameDate     : ${b.gameDate}`);
  console.log(`  [FIELD] matchup      : ${b.awayTeam} @ ${b.homeTeam}  (Game #${b.gameNumber ?? 'N/A'})`);
  console.log(`  [FIELD] betType      : ${b.betType}`);
  console.log(`  [FIELD] market       : ${b.market}`);
  console.log(`  [FIELD] pick         : ${b.pick}`);
  console.log(`  [FIELD] pickSide     : ${b.pickSide}`);
  console.log(`  [FIELD] line         : ${b.line ?? 'N/A'}`);
  console.log(`  [FIELD] odds         : ${b.odds > 0 ? '+' : ''}${b.odds}`);
  console.log(`  [FIELD] riskUnits    : ${b.riskUnits}U`);
  console.log(`  [FIELD] toWinUnits   : ${b.toWinUnits}U`);
  console.log(`  [FIELD] risk$        : $${b.risk}`);
  console.log(`  [FIELD] toWin$       : $${b.toWin}`);
  console.log(`  [FIELD] timeframe    : ${b.timeframe}`);
  console.log(`  [FIELD] wagerType    : ${b.wagerType}`);
  console.log(`  [FIELD] result       : ${b.result}`);
  console.log(`  [FIELD] score        : ${b.awayTeam} ${b.awayScore ?? '?'} - ${b.homeTeam} ${b.homeScore ?? '?'}`);
  console.log(`  [FIELD] book         : ${b.book ?? 'N/A'}`);
  console.log(`  [FIELD] notes        : ${b.notes ?? 'N/A'}`);
  console.log(`  [FIELD] createdAt    : ${b.createdAt}`);
  console.log(`  [FIELD] updatedAt    : ${b.updatedAt}`);
  console.log('');
}

// ─── STEP 2: Check bet_edit_requests for these bets ──────────────────────────
console.log('\n[STEP 2] Querying bet_edit_requests for all 8 bet IDs...');
const [editReqs] = await conn.execute(
  `SELECT 
     ber.id as requestId,
     ber.betId,
     ber.requestType,
     ber.status,
     ber.reason,
     ber.requestedBy,
     ber.reviewedBy,
     ber.createdAt,
     ber.updatedAt,
     au_req.username as requesterUsername,
     au_rev.username as reviewerUsername
   FROM bet_edit_requests ber
   LEFT JOIN app_users au_req ON ber.requestedBy = au_req.id
   LEFT JOIN app_users au_rev ON ber.reviewedBy  = au_rev.id
   WHERE ber.betId IN (${BET_IDS.join(',')})
   ORDER BY ber.betId ASC, ber.createdAt ASC`,
);

console.log(`[STATE] Edit request rows returned: ${editReqs.length}\n`);

for (const r of editReqs) {
  console.log(`─── EDIT REQUEST #${r.requestId} → BET #${r.betId} ────────────────────`);
  console.log(`  [FIELD] requestType  : ${r.requestType}`);
  console.log(`  [FIELD] status       : ${r.status}`);
  console.log(`  [FIELD] reason       : "${r.reason}"`);
  console.log(`  [FIELD] requestedBy  : @${r.requesterUsername} (userId=${r.requestedBy})`);
  console.log(`  [FIELD] reviewedBy   : ${r.reviewerUsername ? '@' + r.reviewerUsername : 'NOT YET REVIEWED'} (userId=${r.reviewedBy ?? 'null'})`);
  console.log(`  [FIELD] createdAt    : ${r.createdAt}`);
  console.log(`  [FIELD] updatedAt    : ${r.updatedAt}`);
  console.log('');
}

// ─── STEP 3: Check bet_edit_requests schema for full column list ──────────────
console.log('\n[STEP 3] bet_edit_requests schema...');
const [berCols] = await conn.execute(
  `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bet_edit_requests'
   ORDER BY ORDINAL_POSITION`
);
console.log('[STATE] Columns:', berCols.map(c => `${c.COLUMN_NAME}(${c.COLUMN_TYPE})`).join(', '));

// ─── STEP 4: Check if bet #150020 is missing ─────────────────────────────────
const missing = BET_IDS.filter(id => !bets.find(b => b.id === id));
if (missing.length > 0) {
  console.log(`\n[VERIFY] WARN — ${missing.length} bet ID(s) NOT FOUND in tracked_bets: ${missing.join(', ')}`);
  // Check if they were deleted
  for (const id of missing) {
    const [delCheck] = await conn.execute(
      `SELECT id, result, updatedAt FROM tracked_bets WHERE id = ?`, [id]
    );
    console.log(`  Bet #${id}: ${delCheck.length === 0 ? 'DOES NOT EXIST (deleted or never created)' : JSON.stringify(delCheck[0])}`);
  }
} else {
  console.log('\n[VERIFY] PASS — all 8 bet IDs found in tracked_bets');
}

await conn.end();
console.log('\n[VERIFY] PASS — full bet audit complete');
