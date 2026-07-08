/**
 * Phase 3: UNIQUE pre-check
 * 
 * Question: After player_name population, does the proposed UNIQUE key
 * (match_id, minute_num, team_id, event_type) have any LEGITIMATE multi-row cases?
 * 
 * Strategy:
 * 1. GROUP BY match_id, minute_num, team_id, event_type HAVING COUNT(*) > 1
 * 2. For each collision group, check if player_names DIFFER (= legitimate distinct events)
 *    vs. are IDENTICAL (= genuine dupes, safe to dedup)
 * 3. If legitimate cases exist → key needs 5th dimension (player_name or sequence_num)
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

dotenv.config({ quiet: true });

const u = process.env.DATABASE_URL || '';
const m = u.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('PARSE FAIL'); process.exit(1); }
const [, user, password, host, port, database] = m;

console.log('[PHASE 3] UNIQUE pre-check: legitimate multi-row analysis');

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60000,
});

// Step 1: Find all collision groups
const [collisions] = await conn.query(`
  SELECT match_id, minute_num, team_id, event_type, COUNT(*) as cnt,
    GROUP_CONCAT(DISTINCT COALESCE(player_name, 'NULL') ORDER BY player_name SEPARATOR ' | ') as distinct_players,
    COUNT(DISTINCT COALESCE(player_name, 'NULL')) as distinct_player_count
  FROM wc2026_match_events
  GROUP BY match_id, minute_num, team_id, event_type
  HAVING COUNT(*) > 1
  ORDER BY match_id, minute_num
`);

console.log(`[STATE] Total collision groups: ${collisions.length}`);

// Step 2: Classify each group
let genuineDupes = 0;
let legitimateMultiRow = 0;
let ambiguousNull = 0;

const legitimateCases = [];
const genuineDupeCases = [];
const ambiguousCases = [];

for (const group of collisions) {
  if (group.distinct_player_count > 1) {
    // Different players → LEGITIMATE multi-row (e.g., two subs same minute)
    legitimateMultiRow++;
    legitimateCases.push(group);
  } else if (group.distinct_players === 'NULL' || group.distinct_players === '' || group.distinct_players === 'null') {
    // All NULL → can't distinguish, but likely dupes (pre-population state)
    ambiguousNull++;
    ambiguousCases.push(group);
  } else {
    // Same player → GENUINE DUPE
    genuineDupes++;
    genuineDupeCases.push(group);
  }
}

console.log(`\n[OUTPUT] === CLASSIFICATION ===`);
console.log(`Genuine dupes (same player): ${genuineDupes}`);
console.log(`Legitimate multi-row (different players): ${legitimateMultiRow}`);
console.log(`Ambiguous (all NULL player): ${ambiguousNull}`);

// Step 3: Detail the legitimate cases
if (legitimateCases.length > 0) {
  console.log(`\n[FINDING] LEGITIMATE MULTI-ROW CASES (${legitimateCases.length}):`);
  console.log('  These would VIOLATE a UNIQUE(match_id, minute_num, team_id, event_type) constraint!');
  for (const c of legitimateCases.slice(0, 20)) {
    console.log(`  ${c.match_id} | min=${c.minute_num} | team=${c.team_id} | type=${c.event_type} | cnt=${c.cnt} | players: ${c.distinct_players}`);
  }
  if (legitimateCases.length > 20) console.log(`  ... and ${legitimateCases.length - 20} more`);
}

if (genuineDupeCases.length > 0) {
  console.log(`\n[FINDING] GENUINE DUPES (same player, ${genuineDupeCases.length} groups):`);
  for (const c of genuineDupeCases.slice(0, 10)) {
    console.log(`  ${c.match_id} | min=${c.minute_num} | team=${c.team_id} | type=${c.event_type} | cnt=${c.cnt} | player: ${c.distinct_players}`);
  }
}

if (ambiguousCases.length > 0) {
  console.log(`\n[FINDING] AMBIGUOUS (all NULL player, ${ambiguousCases.length} groups):`);
  for (const c of ambiguousCases.slice(0, 10)) {
    console.log(`  ${c.match_id} | min=${c.minute_num} | team=${c.team_id} | type=${c.event_type} | cnt=${c.cnt}`);
  }
}

// Step 4: Verdict
console.log('\n[VERDICT]');
if (legitimateMultiRow > 0) {
  console.log('⚠️  LEGITIMATE MULTI-ROW EXISTS — UNIQUE constraint on 4-column key would REJECT valid data.');
  console.log('   Key needs 5th dimension: player_name (for populated events) or sequence_num.');
  console.log(`   Affected: ${legitimateMultiRow} groups`);
  
  // Break down by event_type
  const byType = {};
  for (const c of legitimateCases) {
    byType[c.event_type] = (byType[c.event_type] || 0) + 1;
  }
  console.log('   By type:', JSON.stringify(byType));
} else {
  console.log('✅ No legitimate multi-row cases. UNIQUE(match_id, minute_num, team_id, event_type) is safe.');
}

await conn.end();

// Save results
const resultsPath = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/phase3_unique_precheck.json';
writeFileSync(resultsPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  totalCollisionGroups: collisions.length,
  genuineDupes,
  legitimateMultiRow,
  ambiguousNull,
  legitimateCases: legitimateCases.slice(0, 50),
  genuineDupeSample: genuineDupeCases.slice(0, 20),
  ambiguousSample: ambiguousCases.slice(0, 20),
  verdict: legitimateMultiRow > 0 ? 'CONSTRAINT_UNSAFE' : 'CONSTRAINT_SAFE'
}, null, 2));

console.log(`\n[OUTPUT] Results: ${resultsPath}`);
console.log('[PHASE 3] COMPLETE');
