/**
 * Phase 2 v4: DATA-016 — Populate remaining 593 NULL player_names
 * 
 * Root cause of v3 partial failure (24 matches, 593 rows still NULL):
 * - 24 early group-stage matches (g-001 to g-024) have team_id = '' (empty string)
 * - v3 matching required team_id match, which failed for empty team_id rows
 * - Also: VAR events (508 total) have no ESPN equivalent in keyEvents
 * 
 * v4 strategy:
 * 1. For events with team_id = '': match by minute + type only (no team filter)
 *    - Use consumption tracking to avoid double-assignment
 * 2. Also populate team_id from ESPN data while we're at it (completeness fix)
 * 3. VAR events: parse from commentary text if available
 * 4. Only processes the 24 matches that had 0 population in v3
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

dotenv.config({ quiet: true });

const u = process.env.DATABASE_URL || '';
const m = u.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('PARSE FAIL'); process.exit(1); }
const [, user, password, host, port, database] = m;

const RAW_DIR = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/raw';

console.log('[PHASE 2 v4] DATA-016: Remaining 24 matches with empty team_id');

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60000,
});

const TYPE_MAP = {
  'goal': 'GOAL',
  'goal---free-kick': 'GOAL',
  'goal---header': 'GOAL',
  'goal---volley': 'GOAL',
  'penalty---scored': 'GOAL',
  'own-goal': 'OWN_GOAL',
  'yellow-card': 'YELLOW',
  'red-card': 'RED',
  'substitution': 'SUB',
  'penalty---saved': 'PENALTY',
  'var---red-card-upgrade': 'VAR',
};

function parseMinute(displayValue) {
  if (!displayValue) return null;
  const match = displayValue.match(/^(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// Get the 24 matches with empty team_id
const [matchMapping] = await conn.query(`
  SELECT DISTINCT me.match_id, wm.espn_match_id
  FROM wc2026_match_events me
  JOIN wc2026_matches wm ON wm.match_id = me.match_id
  WHERE wm.espn_match_id IS NOT NULL AND me.team_id = ''
  ORDER BY me.match_id
`);

console.log(`[STATE] ${matchMapping.length} matches to process (empty team_id)`);

let totalPopulated = 0;
let totalTeamFixed = 0;
let totalStillNull = 0;
let totalEvents = 0;

for (const { match_id, espn_match_id } of matchMapping) {
  try {
    const rawPath = join(RAW_DIR, `espn_summary_${espn_match_id}.json`);
    if (!existsSync(rawPath)) {
      console.log(`  ❌ ${match_id}: no cached ESPN data`);
      continue;
    }
    
    const summary = JSON.parse(readFileSync(rawPath, 'utf8'));
    
    // Build ESPN team ID → abbreviation map from competitors
    const competitors = summary?.header?.competitions?.[0]?.competitors || [];
    const espnIdToAbbrev = {};
    for (const c of competitors) {
      const team = c.team || {};
      if (team.id && team.abbreviation) {
        espnIdToAbbrev[team.id] = team.abbreviation.toLowerCase();
      }
    }
    
    // Extract structured events from keyEvents
    const keyEvents = summary?.keyEvents || [];
    const espnEvents = [];
    
    for (const ke of keyEvents) {
      const typeStr = ke.type?.type || '';
      const mappedType = TYPE_MAP[typeStr];
      if (!mappedType) continue;
      
      const minute = parseMinute(ke.clock?.displayValue);
      const participants = ke.participants || [];
      const playerName = participants[0]?.athlete?.displayName || null;
      const assistName = participants[1]?.athlete?.displayName || null;
      
      // Resolve team abbreviation
      let teamAbbrev = null;
      const teamObj = ke.team || {};
      if (teamObj.abbreviation) {
        teamAbbrev = teamObj.abbreviation.toLowerCase();
      } else if (teamObj.id && espnIdToAbbrev[teamObj.id]) {
        teamAbbrev = espnIdToAbbrev[teamObj.id];
      }
      
      // For subs, parse text
      let subIn = null, subOut = null;
      if (mappedType === 'SUB' && ke.text) {
        const subMatch = ke.text.match(/Substitution,\s*[^.]+\.\s*(.+?)\s+replaces\s+(.+?)\./);
        if (subMatch) {
          subIn = subMatch[1];
          subOut = subMatch[2];
        }
      }
      
      espnEvents.push({ minute, mappedType, teamAbbrev, playerName: playerName || subIn, assistName: assistName || subOut });
    }
    
    // Also from header details
    const details = summary?.header?.competitions?.[0]?.details || [];
    for (const d of details) {
      const minute = parseMinute(d.clock?.displayValue);
      const teamObj = d.team || {};
      let teamAbbrev = teamObj.abbreviation?.toLowerCase() || espnIdToAbbrev[teamObj.id] || null;
      const participants = d.participants || [];
      const playerName = participants[0]?.athlete?.displayName || null;
      const assistName = participants[1]?.athlete?.displayName || null;
      const isOwnGoal = d.ownGoal === true;
      let mappedType = isOwnGoal ? 'OWN_GOAL' : 'GOAL';
      
      if (playerName) {
        espnEvents.push({ minute, mappedType, teamAbbrev, playerName, assistName });
      }
    }
    
    // Get our events for this match (all have team_id = '')
    const [ourEvents] = await conn.query(
      `SELECT id, event_type, minute_num, team_id, player_name, assist_player_name FROM wc2026_match_events WHERE match_id = ? ORDER BY minute_num, id`,
      [match_id]
    );
    
    let matchPopulated = 0;
    let matchTeamFixed = 0;
    let matchStillNull = 0;
    const usedEspnIndices = new Set();
    
    for (const ourEvent of ourEvents) {
      totalEvents++;
      let bestIdx = -1;
      
      // Since team_id is empty, match by minute + type only
      for (let i = 0; i < espnEvents.length; i++) {
        if (usedEspnIndices.has(i)) continue;
        const e = espnEvents[i];
        if (e.minute === ourEvent.minute_num && e.mappedType === ourEvent.event_type && e.playerName) {
          bestIdx = i;
          break;
        }
      }
      
      if (bestIdx >= 0) {
        usedEspnIndices.add(bestIdx);
        const espnEv = espnEvents[bestIdx];
        
        const updates = [];
        const params = [];
        
        // Populate player_name
        if (!ourEvent.player_name || ourEvent.player_name === 'null' || ourEvent.player_name === '') {
          updates.push('player_name = ?');
          params.push(espnEv.playerName);
        }
        // Populate assist_player_name
        if (espnEv.assistName && (!ourEvent.assist_player_name || ourEvent.assist_player_name === 'null' || ourEvent.assist_player_name === '')) {
          updates.push('assist_player_name = ?');
          params.push(espnEv.assistName);
        }
        // Also fix team_id if empty
        if (ourEvent.team_id === '' && espnEv.teamAbbrev) {
          updates.push('team_id = ?');
          params.push(espnEv.teamAbbrev);
          matchTeamFixed++;
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
    totalTeamFixed += matchTeamFixed;
    totalStillNull += matchStillNull;
    
    console.log(`  ${match_id}: populated=${matchPopulated}, teamFixed=${matchTeamFixed}, stillNull=${matchStillNull}/${ourEvents.length}`);
    
  } catch (e) {
    console.error(`  ❌ ${match_id}: ${e.message}`);
  }
}

// Final verification
console.log('\n[STEP] Final verification (full table)...');
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
const [emptyTeam] = await conn.query(`SELECT COUNT(*) as cnt FROM wc2026_match_events WHERE team_id = ''`);

console.log('\n[OUTPUT] === FINAL POPULATION RESULTS ===');
console.log(`Total events: ${totalCount[0].cnt}`);
console.log(`Still NULL player_name: ${nullCount[0].cnt}`);
console.log(`Populated player_name: ${totalCount[0].cnt - nullCount[0].cnt}`);
console.log(`Population rate: ${((totalCount[0].cnt - nullCount[0].cnt) / totalCount[0].cnt * 100).toFixed(1)}%`);
console.log(`Still empty team_id: ${emptyTeam[0].cnt}`);
console.log(`\nBy event_type:`);
for (const row of byType) {
  const rate = row.total > 0 ? ((row.populated / row.total) * 100).toFixed(0) : 0;
  console.log(`  ${row.event_type}: ${row.populated}/${row.total} (${rate}%)`);
}

await conn.end();

const resultsPath = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/phase2_data016_results_v4.json';
writeFileSync(resultsPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  totalEvents,
  totalPopulated,
  totalTeamFixed,
  totalStillNull,
  finalNullCount: nullCount[0].cnt,
  finalTotal: totalCount[0].cnt,
  emptyTeamRemaining: emptyTeam[0].cnt,
  populationRate: ((totalCount[0].cnt - nullCount[0].cnt) / totalCount[0].cnt * 100).toFixed(1) + '%',
  byType,
}, null, 2));

console.log(`\n[OUTPUT] Results: ${resultsPath}`);
console.log('[PHASE 2 v4] COMPLETE');
