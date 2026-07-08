/**
 * Phase 2: DATA-016 — Populate player_name in wc2026_match_events from ESPN (v2 - fixed)
 * 
 * Root cause of v1 failure:
 * 1. Used athletes[] instead of participants[].athlete.displayName
 * 2. Type mapping used espnEv.type (object) instead of type.type (string)
 * 3. Team comparison: DB has lowercase abbrev (jpn), ESPN has uppercase (JPN)
 * 
 * ESPN keyEvents structure:
 * - type.type: 'goal', 'yellowCard', 'redCard', 'substitution', 'penaltyGoal', 'ownGoal'
 * - clock.displayValue: "4'", "90'+1'"
 * - team.abbreviation: "JPN"
 * - participants[0].athlete.displayName: "Daichi Kamada" (scorer/player)
 * - participants[1].athlete.displayName: "Keito Nakamura" (assist)
 * 
 * Our DB:
 * - event_type: 'GOAL', 'YELLOW', 'RED', 'SUB', 'VAR', 'PENALTY', 'OWN_GOAL'
 * - minute_num: integer (4, 31, 90)
 * - team_id: lowercase abbreviation ('jpn', 'tun')
 * 
 * Raw payloads already saved from v1 run — reuse them.
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

dotenv.config({ quiet: true });

const u = process.env.DATABASE_URL || '';
const m = u.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('PARSE FAIL'); process.exit(1); }
const [, user, password, host, port, database] = m;

const RAW_DIR = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/raw';
mkdirSync(RAW_DIR, { recursive: true });

console.log('[PHASE 2 v2] DATA-016: player_name POPULATION from ESPN');

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60000,
});

// ESPN type → our event_type
const TYPE_MAP = {
  'goal': 'GOAL',
  'penaltyGoal': 'GOAL',
  'ownGoal': 'OWN_GOAL',
  'yellowCard': 'YELLOW',
  'redCard': 'RED',
  'secondYellowCard': 'RED',
  'substitution': 'SUB',
  'penaltyMissed': 'PENALTY',
};

function parseMinute(displayValue) {
  if (!displayValue) return null;
  const match = displayValue.match(/^(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Get all match mappings
const [matchMapping] = await conn.query(`
  SELECT DISTINCT me.match_id, wm.espn_match_id
  FROM wc2026_match_events me
  JOIN wc2026_matches wm ON wm.match_id = me.match_id
  WHERE wm.espn_match_id IS NOT NULL
  ORDER BY me.match_id
`);

console.log(`[STATE] ${matchMapping.length} matches to process`);

let totalPopulated = 0;
let totalStillNull = 0;
let totalEvents = 0;
const perMatchStats = [];

for (const { match_id, espn_match_id } of matchMapping) {
  try {
    // Load raw payload (already saved from v1)
    const rawPath = join(RAW_DIR, `espn_summary_${espn_match_id}.json`);
    let summary;
    
    if (existsSync(rawPath)) {
      summary = JSON.parse(readFileSync(rawPath, 'utf8'));
    } else {
      // Fetch if not cached
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espn_match_id}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`ESPN API ${resp.status}`);
      summary = await resp.json();
      writeFileSync(rawPath, JSON.stringify(summary, null, 2));
      await sleep(500);
    }
    
    // Extract events from keyEvents (richest source)
    const keyEvents = summary?.keyEvents || [];
    
    // Build structured ESPN events
    const espnEvents = [];
    for (const ke of keyEvents) {
      const typeStr = ke.type?.type || '';
      const mappedType = TYPE_MAP[typeStr];
      if (!mappedType) continue; // Skip kickoff, corner, etc.
      
      const minute = parseMinute(ke.clock?.displayValue);
      const teamAbbrev = (ke.team?.abbreviation || '').toLowerCase();
      const participants = ke.participants || [];
      const playerName = participants[0]?.athlete?.displayName || null;
      const assistName = participants[1]?.athlete?.displayName || null;
      
      espnEvents.push({ minute, mappedType, teamAbbrev, playerName, assistName });
    }
    
    // Also extract from header.competitions[0].details (goals with assists)
    const details = summary?.header?.competitions?.[0]?.details || [];
    for (const d of details) {
      const minute = parseMinute(d.clock?.displayValue);
      const teamAbbrev = (d.team?.abbreviation || '').toLowerCase();
      const participants = d.participants || [];
      const playerName = participants[0]?.athlete?.displayName || null;
      const assistName = participants[1]?.athlete?.displayName || null;
      const isGoal = d.scoringPlay === true;
      const isOwnGoal = d.ownGoal === true;
      const isRed = d.redCard === true;
      const isPenalty = d.penaltyKick === true;
      
      let mappedType = 'GOAL';
      if (isOwnGoal) mappedType = 'OWN_GOAL';
      if (isRed) mappedType = 'RED';
      
      if (playerName) {
        espnEvents.push({ minute, mappedType, teamAbbrev, playerName, assistName });
      }
    }
    
    // Get our events for this match
    const [ourEvents] = await conn.query(
      `SELECT id, event_type, minute_num, team_id, player_name, assist_player_name FROM wc2026_match_events WHERE match_id = ?`,
      [match_id]
    );
    
    let matchPopulated = 0;
    let matchStillNull = 0;
    
    // For each of our events, find the best ESPN match
    // Strategy: match by (minute_num, event_type, team_id)
    // For multiple matches at same minute (e.g., two subs), use consumption tracking
    const usedEspnIndices = new Set();
    
    for (const ourEvent of ourEvents) {
      totalEvents++;
      
      let bestIdx = -1;
      
      for (let i = 0; i < espnEvents.length; i++) {
        if (usedEspnIndices.has(i)) continue;
        const espnEv = espnEvents[i];
        
        if (espnEv.minute === ourEvent.minute_num &&
            espnEv.mappedType === ourEvent.event_type &&
            espnEv.teamAbbrev === ourEvent.team_id &&
            espnEv.playerName) {
          bestIdx = i;
          break;
        }
      }
      
      // Fallback: match by minute + type only (ignore team for VAR which may not have team)
      if (bestIdx === -1 && ourEvent.event_type === 'VAR') {
        for (let i = 0; i < espnEvents.length; i++) {
          if (usedEspnIndices.has(i)) continue;
          const espnEv = espnEvents[i];
          if (espnEv.minute === ourEvent.minute_num && espnEv.mappedType === 'VAR' && espnEv.playerName) {
            bestIdx = i;
            break;
          }
        }
      }
      
      if (bestIdx >= 0) {
        usedEspnIndices.add(bestIdx);
        const espnEv = espnEvents[bestIdx];
        
        // Idempotent UPDATE
        const updates = [];
        const params = [];
        
        if (!ourEvent.player_name || ourEvent.player_name === 'null' || ourEvent.player_name === '') {
          updates.push('player_name = ?');
          params.push(espnEv.playerName);
        }
        if (espnEv.assistName && (!ourEvent.assist_player_name || ourEvent.assist_player_name === 'null' || ourEvent.assist_player_name === '')) {
          updates.push('assist_player_name = ?');
          params.push(espnEv.assistName);
        }
        
        if (updates.length > 0) {
          params.push(ourEvent.id);
          await conn.query(`UPDATE wc2026_match_events SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        matchPopulated++;
      } else {
        matchStillNull++;
      }
    }
    
    totalPopulated += matchPopulated;
    totalStillNull += matchStillNull;
    perMatchStats.push({ match_id, espn_match_id, total: ourEvents.length, populated: matchPopulated, stillNull: matchStillNull });
    
    console.log(`  ${match_id}: populated=${matchPopulated}, stillNull=${matchStillNull}/${ourEvents.length}`);
    
  } catch (e) {
    console.error(`  ❌ ${match_id}: ${e.message}`);
    perMatchStats.push({ match_id, espn_match_id, total: 0, populated: 0, stillNull: 0, error: e.message });
  }
}

// Final verification
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

// Write results
const resultsPath = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/phase2_data016_results_v2.json';
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

console.log(`\n[OUTPUT] Results: ${resultsPath}`);
console.log('[PHASE 2 v2] COMPLETE');
