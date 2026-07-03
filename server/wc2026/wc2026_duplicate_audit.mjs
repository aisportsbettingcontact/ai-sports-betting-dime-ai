/**
 * wc2026_duplicate_audit.mjs
 * Comprehensive duplicate detection and cleanup for all WC2026 tables.
 *
 * Checks:
 *   1. wc2026_matches — duplicate match_id entries (PK, should be impossible)
 *   2. wc2026_matches — duplicate home_team_id + away_team_id combinations
 *   3. wc2026_match_stats — duplicate match_id entries (PK, should be impossible)
 *   4. wc2026_match_events — duplicate events (same match_id + event_type + player_name + minute_num)
 *   5. wc2026_lineups — duplicate player entries (same match_id + team_id + player_name)
 *   6. wc2026_odds_snapshots — duplicate model odds (book_id=0, same match+market+selection)
 *
 * For each duplicate found: logs the full detail and removes the duplicate (keeps most recent).
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('[WC2026_AUDIT] ============================================================');
console.log('[WC2026_AUDIT] Starting comprehensive duplicate audit for all WC2026 tables');
console.log('[WC2026_AUDIT] ============================================================\n');

let totalDuplicatesFound = 0;
let totalDuplicatesRemoved = 0;

// ─── 1. wc2026_matches: duplicate match_id (PK — impossible, but verify) ──
console.log('[WC2026_AUDIT] [STEP 1] Checking wc2026_matches for duplicate match_id...');
const [matchPkDups] = await conn.query(`
  SELECT match_id, COUNT(*) as cnt
  FROM wc2026_matches
  GROUP BY match_id
  HAVING cnt > 1
`);
if (matchPkDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate match_id in wc2026_matches ✅');
} else {
  console.error('[WC2026_AUDIT] [VERIFY] FAIL — Duplicate match_id found:', matchPkDups);
  totalDuplicatesFound += matchPkDups.length;
}

// ─── 2. wc2026_matches: duplicate home+away team combinations ────────────────
console.log('\n[WC2026_AUDIT] [STEP 2] Checking wc2026_matches for duplicate home+away team combos...');
const [teamComboDups] = await conn.query(`
  SELECT home_team_id, away_team_id, COUNT(*) as cnt, GROUP_CONCAT(match_id ORDER BY match_id) as match_ids
  FROM wc2026_matches
  GROUP BY home_team_id, away_team_id
  HAVING cnt > 1
`);
if (teamComboDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate home+away team combinations ✅');
} else {
  console.error('[WC2026_AUDIT] [VERIFY] FAIL — Duplicate team combinations:');
  teamComboDups.forEach(r => {
    console.error(`  home=${r.home_team_id} away=${r.away_team_id} count=${r.cnt} matchs=[${r.match_ids}]`);
  });
  totalDuplicatesFound += teamComboDups.length;
}

// ─── 3. wc2026_match_stats: duplicate match_id (PK) ────────────────────────
console.log('\n[WC2026_AUDIT] [STEP 3] Checking wc2026_match_stats for duplicates...');
const [statsDups] = await conn.query(`
  SELECT match_id, COUNT(*) as cnt
  FROM wc2026_match_stats
  GROUP BY match_id
  HAVING cnt > 1
`);
if (statsDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate match_id in wc2026_match_stats ✅');
} else {
  console.error('[WC2026_AUDIT] [VERIFY] FAIL — Duplicate match_id in match_stats:', statsDups);
  totalDuplicatesFound += statsDups.length;
}

// ─── 4. wc2026_match_events: duplicate events ────────────────────────────────
console.log('\n[WC2026_AUDIT] [STEP 4] Checking wc2026_match_events for duplicate events...');
const [eventDups] = await conn.query(`
  SELECT match_id, event_type, player_name, minute_num, COUNT(*) as cnt,
         GROUP_CONCAT(id ORDER BY id) as ids
  FROM wc2026_match_events
  GROUP BY match_id, event_type, player_name, minute_num
  HAVING cnt > 1
`);
if (eventDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate match events ✅');
} else {
  console.warn(`[WC2026_AUDIT] [VERIFY] WARNING — ${eventDups.length} duplicate event groups found:`);
  for (const dup of eventDups) {
    console.warn(`  match=${dup.match_id} type=${dup.event_type} player="${dup.player_name}" min=${dup.minute_num} count=${dup.cnt} ids=[${dup.ids}]`);
    totalDuplicatesFound++;
    // Keep the lowest ID, delete the rest
    const ids = dup.ids.split(',').map(Number);
    const keepId = Math.min(...ids);
    const deleteIds = ids.filter(id => id !== keepId);
    console.warn(`  → Keeping id=${keepId}, deleting ids=[${deleteIds.join(',')}]`);
    await conn.query(`DELETE FROM wc2026_match_events WHERE id IN (?)`, [deleteIds]);
    totalDuplicatesRemoved += deleteIds.length;
    console.warn(`  → Deleted ${deleteIds.length} duplicate event(s) ✅`);
  }
}

// ─── 5. wc2026_lineups: duplicate player entries ─────────────────────────────
console.log('\n[WC2026_AUDIT] [STEP 5] Checking wc2026_lineups for duplicate player entries...');
const [lineupDups] = await conn.query(`
  SELECT match_id, team_id, player_name, COUNT(*) as cnt,
         GROUP_CONCAT(id ORDER BY id) as ids
  FROM wc2026_lineups
  GROUP BY match_id, team_id, player_name
  HAVING cnt > 1
`);
if (lineupDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate lineup entries ✅');
} else {
  console.warn(`[WC2026_AUDIT] [VERIFY] WARNING — ${lineupDups.length} duplicate lineup groups found:`);
  for (const dup of lineupDups) {
    console.warn(`  match=${dup.match_id} team=${dup.team_id} player="${dup.player_name}" count=${dup.cnt} ids=[${dup.ids}]`);
    totalDuplicatesFound++;
    const ids = dup.ids.split(',').map(Number);
    const keepId = Math.max(...ids); // keep most recent (highest id = confirmed ESPN data)
    const deleteIds = ids.filter(id => id !== keepId);
    console.warn(`  → Keeping id=${keepId} (most recent), deleting ids=[${deleteIds.join(',')}]`);
    await conn.query(`DELETE FROM wc2026_lineups WHERE id IN (?)`, [deleteIds]);
    totalDuplicatesRemoved += deleteIds.length;
    console.warn(`  → Deleted ${deleteIds.length} duplicate lineup row(s) ✅`);
  }
}

// ─── 6. wc2026_odds_snapshots: duplicate model odds (book_id=0) ───────────────
console.log('\n[WC2026_AUDIT] [STEP 6] Checking wc2026_odds_snapshots for duplicate model odds (book_id=0)...');
const [modelOddsDups] = await conn.query(`
  SELECT match_id, market, selection, COUNT(*) as cnt,
         GROUP_CONCAT(id ORDER BY id) as ids
  FROM wc2026_odds_snapshots
  WHERE book_id = 0
  GROUP BY match_id, market, selection
  HAVING cnt > 1
`);
if (modelOddsDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate model odds snapshots ✅');
} else {
  console.warn(`[WC2026_AUDIT] [VERIFY] WARNING — ${modelOddsDups.length} duplicate model odds groups:`);
  for (const dup of modelOddsDups) {
    console.warn(`  match=${dup.match_id} market=${dup.market} sel=${dup.selection} count=${dup.cnt} ids=[${dup.ids}]`);
    totalDuplicatesFound++;
    const ids = dup.ids.split(',').map(Number);
    const keepId = Math.max(...ids); // keep most recent
    const deleteIds = ids.filter(id => id !== keepId);
    console.warn(`  → Keeping id=${keepId}, deleting ids=[${deleteIds.join(',')}]`);
    await conn.query(`DELETE FROM wc2026_odds_snapshots WHERE id IN (?)`, [deleteIds]);
    totalDuplicatesRemoved += deleteIds.length;
    console.warn(`  → Deleted ${deleteIds.length} duplicate model odds row(s) ✅`);
  }
}

// ─── 7. wc2026_odds_snapshots: duplicate DK closing odds ─────────────────────
console.log('\n[WC2026_AUDIT] [STEP 7] Checking wc2026_odds_snapshots for duplicate DK closing odds (book_id=68, is_closing=1)...');
const [dkClosingDups] = await conn.query(`
  SELECT match_id, market, selection, COUNT(*) as cnt,
         GROUP_CONCAT(id ORDER BY id) as ids
  FROM wc2026_odds_snapshots
  WHERE book_id = 68 AND is_closing = 1
  GROUP BY match_id, market, selection
  HAVING cnt > 1
`);
if (dkClosingDups.length === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — No duplicate DK closing odds ✅');
} else {
  console.warn(`[WC2026_AUDIT] [VERIFY] WARNING — ${dkClosingDups.length} duplicate DK closing odds groups:`);
  for (const dup of dkClosingDups) {
    console.warn(`  match=${dup.match_id} market=${dup.market} sel=${dup.selection} count=${dup.cnt} ids=[${dup.ids}]`);
    totalDuplicatesFound++;
    const ids = dup.ids.split(',').map(Number);
    const keepId = Math.max(...ids);
    const deleteIds = ids.filter(id => id !== keepId);
    await conn.query(`DELETE FROM wc2026_odds_snapshots WHERE id IN (?)`, [deleteIds]);
    totalDuplicatesRemoved += deleteIds.length;
    console.warn(`  → Deleted ${deleteIds.length} duplicate DK closing odds row(s) ✅`);
  }
}

// ─── 8. Full match count audit ─────────────────────────────────────────────
console.log('\n[WC2026_AUDIT] [STEP 8] Full match inventory audit...');
const [matchCounts] = await conn.query(`
  SELECT 
    COUNT(*) as total_matchs,
    SUM(CASE WHEN status = 'FT' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'SCHEDULED' THEN 1 ELSE 0 END) as scheduled,
    SUM(CASE WHEN status = 'LIVE' THEN 1 ELSE 0 END) as live,
    SUM(CASE WHEN espn_event_id IS NOT NULL THEN 1 ELSE 0 END) as has_espn_id
  FROM wc2026_matches
`);
const fc = matchCounts[0];
console.log(`[WC2026_AUDIT] [STATE] Matchs: total=${fc.total_matchs} completed=${fc.completed} scheduled=${fc.scheduled} live=${fc.live} has_espn_id=${fc.has_espn_id}`);

// Check June 17 specifically
const [june17] = await conn.query(`
  SELECT f.match_id, ht.name as home, at2.name as away,
         f.home_score, f.away_score, f.status, f.match_date,
         f.espn_event_id, f.attendance,
         (SELECT COUNT(*) FROM wc2026_match_stats ms WHERE ms.match_id = f.match_id) as has_stats,
         (SELECT COUNT(*) FROM wc2026_match_events me WHERE me.match_id = f.match_id) as event_count,
         (SELECT COUNT(*) FROM wc2026_lineups l WHERE l.match_id = f.match_id AND l.is_confirmed = 1) as confirmed_lineup_count
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
  WHERE f.match_date = '2026-06-17'
  ORDER BY f.match_id
`);
console.log(`\n[WC2026_AUDIT] [STATE] June 17 matchs (${june17.length} total):`);
june17.forEach(r => {
  console.log(`  ${r.match_id}: ${r.away} ${r.away_score ?? '?'}-${r.home_score ?? '?'} ${r.home} | status=${r.status} | espnId=${r.espn_event_id} | att=${r.attendance} | stats=${r.has_stats} | events=${r.event_count} | confirmed_lineups=${r.confirmed_lineup_count}`);
});

// ─── Final summary ────────────────────────────────────────────────────────────
console.log('\n[WC2026_AUDIT] ============================================================');
console.log(`[WC2026_AUDIT] AUDIT COMPLETE`);
console.log(`[WC2026_AUDIT] Total duplicate groups found: ${totalDuplicatesFound}`);
console.log(`[WC2026_AUDIT] Total duplicate rows removed: ${totalDuplicatesRemoved}`);
if (totalDuplicatesFound === 0) {
  console.log('[WC2026_AUDIT] [VERIFY] PASS — Database is clean, no duplicates ✅');
} else {
  console.log(`[WC2026_AUDIT] [VERIFY] ${totalDuplicatesRemoved > 0 ? 'CLEANED' : 'NEEDS ATTENTION'} — ${totalDuplicatesRemoved} rows removed`);
}
console.log('[WC2026_AUDIT] ============================================================');

await conn.end();
