/**
 * Phase 2 v3: DATA-016 — Populate player_name from ESPN (FIXED)
 * 
 * v1 bugs: wrong field paths (athletes vs participants)
 * v2 bugs: wrong type strings (camelCase vs kebab-case), team matching failed when abbreviation=null
 * v3 fixes:
 *   1. TYPE_MAP uses kebab-case: 'yellow-card', 'red-card', 'goal---free-kick', etc.
 *   2. Team resolution: build ESPN_ID → abbreviation map from header.competitors
 *   3. For events with team.abbreviation=null, resolve via team.id → abbreviation lookup
 *   4. For SUBs: also parse text "Substitution, TeamName. PlayerIn replaces PlayerOut."
 *   5. Reuses cached raw payloads from v1/v2
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

console.log('[PHASE 2 v3] DATA-016: player_name POPULATION from ESPN');

const conn = await mysql.createConnection({
  host, port: parseInt(port), user, password, database,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 60000,
});

// ESPN type.type → our event_type (KEBAB-CASE!)
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
    const rawPath = join(RAW_DIR, `espn_summary_${espn_match_id}.json`);
    let summary;
    
    if (existsSync(rawPath)) {
      summary = JSON.parse(readFileSync(rawPath, 'utf8'));
    } else {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espn_match_id}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`ESPN API ${resp.status}`);
      summary = await resp.json();
      writeFileSync(rawPath, JSON.stringify(summary, null, 2));
      await sleep(500);
    }
    
    // Build ESPN team ID → abbreviation map from header competitors
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
      
      // For substitutions, also try to parse text for sub-in/sub-out
      let subIn = null, subOut = null;
      if (mappedType === 'SUB' && ke.text) {
        // Format: "Substitution, TeamName. PlayerIn replaces PlayerOut."
        const subMatch = ke.text.match(/Substitution,\s*[^.]+\.\s*(.+?)\s+replaces\s+(.+?)\./);
        if (subMatch) {
          subIn = subMatch[1];
          subOut = subMatch[2];
        }
      }
      
      espnEvents.push({ minute, mappedType, teamAbbrev, playerName: playerName || subIn, assistName: assistName || subOut });
    }
    
    // Also from header details (goals)
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
    
    // Get our events for this match
    const [ourEvents] = await conn.query(
      `SELECT id, event_type, minute_num, team_id, player_name, assist_player_name FROM wc2026_match_events WHERE match_id = ?`,
      [match_id]
    );
    
    let matchPopulated = 0;
    let matchStillNull = 0;
    const usedEspnIndices = new Set();
    
    for (const ourEvent of ourEvents) {
      totalEvents++;
      let bestIdx = -1;
      
      // Primary match: minute + type + team
      for (let i = 0; i < espnEvents.length; i++) {
        if (usedEspnIndices.has(i)) continue;
        const e = espnEvents[i];
        if (e.minute === ourEvent.minute_num &&
            e.mappedType === ourEvent.event_type &&
            e.teamAbbrev === ourEvent.team_id &&
            e.playerName) {
          bestIdx = i;
          break;
        }
      }
      
      // Fallback 1: minute + type only (team might be null in ESPN for some events)
      if (bestIdx === -1) {
        for (let i = 0; i < espnEvents.length; i++) {
          if (usedEspnIndices.has(i)) continue;
          const e = espnEvents[i];
          if (e.minute === ourEvent.minute_num &&
              e.mappedType === ourEvent.event_type &&
              e.playerName &&
              (e.teamAbbrev === null || e.teamAbbrev === ourEvent.team_id)) {
            bestIdx = i;
            break;
          }
        }
      }
      
      if (bestIdx >= 0) {
        usedEspnIndices.add(bestIdx);
        const espnEv = espnEvents[bestIdx];
        
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

console.log('\n[OUTPUT] === POPULATION RESULTS v3 ===');
console.log(`Total events: ${totalCount[0].cnt}`);
console.log(`Still NULL: ${nullCount[0].cnt}`);
console.log(`Populated: ${totalCount[0].cnt - nullCount[0].cnt}`);
console.log(`Population rate: ${((totalCount[0].cnt - nullCount[0].cnt) / totalCount[0].cnt * 100).toFixed(1)}%`);
console.log(`\nBy event_type:`);
for (const row of byType) {
  const rate = row.total > 0 ? ((row.populated / row.total) * 100).toFixed(0) : 0;
  console.log(`  ${row.event_type}: ${row.populated}/${row.total} (${rate}%)`);
}

await conn.end();

const resultsPath = '/home/ubuntu/ai-sports-betting/audit-notes/run-logs/phase2_data016_results_v3.json';
writeFileSync(resultsPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  totalEvents,
  totalPopulated,
  totalStillNull,
  finalNullCount: nullCount[0].cnt,
  finalTotal: totalCount[0].cnt,
  populationRate: ((totalCount[0].cnt - nullCount[0].cnt) / totalCount[0].cnt * 100).toFixed(1) + '%',
  byType,
  perMatch: perMatchStats
}, null, 2));

console.log(`\n[OUTPUT] Results: ${resultsPath}`);
console.log('[PHASE 2 v3] COMPLETE');
