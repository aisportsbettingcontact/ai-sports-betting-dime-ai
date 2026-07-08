/**
 * Phase 2: DATA-016 — Populate player_name in wc2026_match_events from ESPN event-detail endpoints.
 * 
 * Strategy:
 * 1. Get all match_ids from wc2026_match_events + their ESPN IDs from wc2026_matches
 * 2. For each match, fetch ESPN summary endpoint to get keyEvents/commentary
 * 3. Match events by minute + type + team to populate player_name
 * 4. Idempotent UPDATEs keyed on event row id
 * 5. NO fabrication — events ESPN doesn't provide stay NULL with discrepancy line
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

dotenv.config({ quiet: true });

const u = process.env.DATABASE_URL || '';
const m = u.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('PARSE FAIL'); process.exit(1); }
const [, user, password, host, port, database] = m;

const RAW_DIR = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/raw';
mkdirSync(RAW_DIR, { recursive: true });

console.log('[PHASE 2] DATA-016: player_name POPULATION from ESPN');

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60000,
});

// Step 1: Get all distinct match_ids in match_events + their ESPN IDs
const [matchMapping] = await conn.query(`
  SELECT DISTINCT me.match_id, wm.espn_match_id
  FROM wc2026_match_events me
  JOIN wc2026_matches wm ON wm.match_id = me.match_id
  WHERE wm.espn_match_id IS NOT NULL
  ORDER BY me.match_id
`);

console.log(`[STATE] ${matchMapping.length} matches with ESPN IDs to process`);

// Step 2: For each match, fetch ESPN summary
let totalPopulated = 0;
let totalStillNull = 0;
let totalEvents = 0;
const perMatchStats = [];

async function fetchEspnSummary(espnId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`ESPN API ${resp.status} for ${espnId}`);
  return resp.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Map ESPN event types to our event_type values
function mapEspnType(espnType) {
  const typeMap = {
    'goal': 'GOAL',
    'ownGoal': 'GOAL',
    'penaltyGoal': 'GOAL',
    'yellowCard': 'YELLOW',
    'redCard': 'RED',
    'secondYellowCard': 'RED',
    'substitution': 'SUB',
    'var': 'VAR',
    'penaltyMissed': 'PENALTY_MISS',
  };
  return typeMap[espnType] || null;
}

for (const { match_id, espn_match_id } of matchMapping) {
  try {
    console.log(`\n[STEP] Processing ${match_id} (ESPN: ${espn_match_id})...`);
    
    const summary = await fetchEspnSummary(espn_match_id);
    
    // Save raw payload
    writeFileSync(join(RAW_DIR, `espn_summary_${espn_match_id}.json`), JSON.stringify(summary, null, 2));
    
    // Extract key events from the summary
    const keyEvents = summary?.keyEvents || [];
    const commentary = summary?.commentary || [];
    const roster = summary?.rosters || [];
    
    // Also check header.competitions[0].details for event details
    const details = summary?.header?.competitions?.[0]?.details || [];
    
    // Build a lookup of ESPN events by minute + type
    const espnEvents = [];
    
    // From keyEvents
    for (const ke of keyEvents) {
      const clock = ke.clock?.displayValue || '';
      const minuteMatch = clock.match(/(\d+)/);
      const minute = minuteMatch ? parseInt(minuteMatch[1]) : null;
      const type = ke.type?.text || ke.type?.id || '';
      const team = ke.team?.abbreviation || ke.team?.displayName || '';
      const teamId = ke.team?.id || '';
      const athletes = ke.athletes || [];
      const playerName = athletes[0]?.displayName || athletes[0]?.athlete?.displayName || null;
      const assistName = athletes[1]?.displayName || athletes[1]?.athlete?.displayName || null;
      
      espnEvents.push({ minute, type, team, teamId, playerName, assistName, raw: ke });
    }
    
    // From details (more structured)
    for (const detail of details) {
      const clock = detail.clock?.displayValue || '';
      const minuteMatch = clock.match(/(\d+)/);
      const minute = minuteMatch ? parseInt(minuteMatch[1]) : null;
      const type = detail.type?.text || detail.type?.id || '';
      const team = detail.team?.abbreviation || detail.team?.displayName || '';
      const teamId = detail.team?.id || '';
      const athletes = detail.athletesInvolved || [];
      const playerName = athletes[0]?.displayName || null;
      const assistName = athletes[1]?.displayName || null;
      
      espnEvents.push({ minute, type, team, teamId, playerName, assistName, raw: detail });
    }
    
    console.log(`  ESPN events found: ${espnEvents.length} (keyEvents: ${keyEvents.length}, details: ${details.length})`);
    
    // Get our events for this match
    const [ourEvents] = await conn.query(
      `SELECT id, event_type, minute_num, team_id, player_name, assist_player_name FROM wc2026_match_events WHERE match_id = ?`,
      [match_id]
    );
    
    let matchPopulated = 0;
    let matchStillNull = 0;
    
    for (const ourEvent of ourEvents) {
      totalEvents++;
      
      // Try to find matching ESPN event
      let bestMatch = null;
      
      for (const espnEv of espnEvents) {
        // Match by minute + mapped type
        const mappedType = mapEspnType(espnEv.type?.toLowerCase?.() || espnEv.type);
        
        if (espnEv.minute === ourEvent.minute_num && mappedType === ourEvent.event_type) {
          // If we have a team_id match too, prefer it
          if (espnEv.teamId === ourEvent.team_id || !bestMatch) {
            bestMatch = espnEv;
          }
        }
        
        // Also try matching by minute alone if types are close
        if (espnEv.minute === ourEvent.minute_num && !bestMatch && espnEv.playerName) {
          // Looser match - same minute, has a player
          if (ourEvent.event_type === 'GOAL' && (espnEv.type?.toLowerCase?.()?.includes('goal') || espnEv.type === 'goal')) {
            bestMatch = espnEv;
          }
          if (ourEvent.event_type === 'YELLOW' && espnEv.type?.toLowerCase?.()?.includes('yellow')) {
            bestMatch = espnEv;
          }
          if (ourEvent.event_type === 'RED' && (espnEv.type?.toLowerCase?.()?.includes('red') || espnEv.type?.toLowerCase?.()?.includes('secondyellow'))) {
            bestMatch = espnEv;
          }
          if (ourEvent.event_type === 'SUB' && espnEv.type?.toLowerCase?.()?.includes('sub')) {
            bestMatch = espnEv;
          }
        }
      }
      
      if (bestMatch && bestMatch.playerName) {
        // Idempotent UPDATE keyed on id
        const updates = [];
        const params = [];
        
        if (!ourEvent.player_name || ourEvent.player_name === 'null' || ourEvent.player_name === '') {
          updates.push('player_name = ?');
          params.push(bestMatch.playerName);
        }
        if (bestMatch.assistName && (!ourEvent.assist_player_name || ourEvent.assist_player_name === 'null' || ourEvent.assist_player_name === '')) {
          updates.push('assist_player_name = ?');
          params.push(bestMatch.assistName);
        }
        
        if (updates.length > 0) {
          params.push(ourEvent.id);
          await conn.query(`UPDATE wc2026_match_events SET ${updates.join(', ')} WHERE id = ?`, params);
          matchPopulated++;
        } else {
          matchPopulated++; // Already had data
        }
      } else {
        matchStillNull++;
      }
    }
    
    totalPopulated += matchPopulated;
    totalStillNull += matchStillNull;
    perMatchStats.push({ match_id, espn_match_id, total: ourEvents.length, populated: matchPopulated, stillNull: matchStillNull });
    
    console.log(`  Result: populated=${matchPopulated}, stillNull=${matchStillNull}, total=${ourEvents.length}`);
    
    // Rate limit
    await sleep(500);
    
  } catch (e) {
    console.error(`  ❌ ERROR: ${match_id}: ${e.message}`);
    perMatchStats.push({ match_id, espn_match_id, total: 0, populated: 0, stillNull: 0, error: e.message });
  }
}

// Step 3: Final verification
console.log('\n[STEP] Final verification...');
const [nullCount] = await conn.query(`SELECT COUNT(*) as cnt FROM wc2026_match_events WHERE player_name IS NULL OR player_name = '' OR player_name = 'null'`);
const [totalCount] = await conn.query(`SELECT COUNT(*) as cnt FROM wc2026_match_events`);
const [byType] = await conn.query(`
  SELECT event_type, 
    SUM(CASE WHEN player_name IS NOT NULL AND player_name != '' AND player_name != 'null' THEN 1 ELSE 0 END) as populated,
    SUM(CASE WHEN player_name IS NULL OR player_name = '' OR player_name = 'null' THEN 1 ELSE 0 END) as still_null,
    COUNT(*) as total
  FROM wc2026_match_events 
  GROUP BY event_type
`);

console.log('\n[OUTPUT] === POPULATION RESULTS ===');
console.log(`Total events: ${totalCount[0].cnt}`);
console.log(`Still NULL: ${nullCount[0].cnt}`);
console.log(`Populated: ${totalCount[0].cnt - nullCount[0].cnt}`);
console.log(`\nBy event_type:`);
for (const row of byType) {
  console.log(`  ${row.event_type}: populated=${row.populated}, stillNull=${row.still_null}, total=${row.total}`);
}

await conn.end();

// Write detailed results
const resultsPath = join(RAW_DIR, '../phase2_data016_results.json');
writeFileSync(resultsPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  totalEvents,
  totalPopulated,
  totalStillNull,
  finalNullCount: nullCount[0].cnt,
  finalTotal: totalCount[0].cnt,
  byType,
  perMatch: perMatchStats
}, null, 2));

console.log(`\n[OUTPUT] Detailed results: ${resultsPath}`);
console.log('[PHASE 2] COMPLETE');
