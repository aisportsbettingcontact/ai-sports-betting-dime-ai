/**
 * discoverGroupStageIds.mjs
 * Discovers all WC2026 Group Stage ESPN gameIds (June 11-27, 2026)
 * by querying ESPN's soccer schedule API for the FIFA World Cup 2026 tournament.
 * 
 * ESPN Soccer API endpoint:
 * https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611
 * 
 * Strategy: Query each date from June 11-27 (17 days) and collect all gameIds.
 */

import https from 'https';
import fs from 'fs';

const LOG_FILE = '/home/ubuntu/ai-sports-betting/.manus-logs/discoverGroupStageIds.txt';
const OUTPUT_FILE = '/home/ubuntu/ai-sports-betting/server/wc2026/groupStageGameIds.json';

const log = (level, tag, msg) => {
  const line = `[${new Date().toISOString()}] [${level}] [${tag}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
};

// Clear log file
fs.writeFileSync(LOG_FILE, `=== WC2026 Group Stage GameId Discovery ===\nStarted: ${new Date().toISOString()}\n\n`);

const fetchJson = (url) => new Promise((resolve, reject) => {
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error(`JSON parse error: ${e.message} | url=${url}`)); }
    });
  }).on('error', reject);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Generate all dates June 11-27, 2026
const dates = [];
for (let d = 11; d <= 27; d++) {
  dates.push(`202606${String(d).padStart(2, '0')}`);
}

log('INFO', 'INIT', `Discovering Group Stage gameIds for ${dates.length} dates: June 11-27, 2026`);
log('INFO', 'INIT', `ESPN API: site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD`);

const allMatches = [];
let totalFound = 0;

for (const dateStr of dates) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`;
  log('INFO', `DATE_${dateStr}`, `Fetching: ${url}`);
  
  try {
    const data = await fetchJson(url);
    const events = data.events || [];
    
    if (events.length === 0) {
      log('INFO', `DATE_${dateStr}`, `No events found`);
      continue;
    }
    
    for (const event of events) {
      const gameId = event.id;
      const name = event.name || event.shortName || 'Unknown';
      const status = event.status?.type?.name || 'unknown';
      const dateTime = event.date || '';
      
      // Extract home/away teams
      const competitors = event.competitions?.[0]?.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      const homeTeam = home?.team?.abbreviation || home?.team?.displayName || '?';
      const awayTeam = away?.team?.abbreviation || away?.team?.displayName || '?';
      const homeScore = home?.score ?? '?';
      const awayScore = away?.score ?? '?';
      
      const matchInfo = {
        gameId,
        date: dateStr,
        dateTime,
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        status,
        name,
      };
      
      allMatches.push(matchInfo);
      totalFound++;
      
      log('PASS', `MATCH_${gameId}`, `[${dateStr}] ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} | status=${status} | gameId=${gameId}`);
    }
    
    log('INFO', `DATE_${dateStr}`, `Found ${events.length} match(es)`);
    
  } catch (err) {
    log('FAIL', `DATE_${dateStr}`, `Error: ${err.message}`);
  }
  
  // Polite delay between requests
  await sleep(300);
}

log('INFO', 'SUMMARY', `Total matches found: ${totalFound} across ${dates.length} dates`);

// Sort by date then gameId
allMatches.sort((a, b) => {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return parseInt(a.gameId) - parseInt(b.gameId);
});

// Extract just the gameIds in order
const gameIds = allMatches.map(m => m.gameId);
const uniqueGameIds = [...new Set(gameIds)];

log('INFO', 'SUMMARY', `Unique gameIds: ${uniqueGameIds.length}`);
log('INFO', 'SUMMARY', `GameId range: ${uniqueGameIds[0]} - ${uniqueGameIds[uniqueGameIds.length - 1]}`);
log('INFO', 'SUMMARY', `All gameIds: ${uniqueGameIds.join(', ')}`);

// Save output
const output = {
  discoveredAt: new Date().toISOString(),
  totalMatches: uniqueGameIds.length,
  dateRange: 'June 11-27, 2026',
  gameIds: uniqueGameIds,
  matches: allMatches,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
log('INFO', 'OUTPUT', `Saved to: ${OUTPUT_FILE}`);

// Print summary table
console.log('\n=== DISCOVERED MATCHES ===');
for (const m of allMatches) {
  console.log(`  ${m.date} | ${m.gameId} | ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} | ${m.status}`);
}
console.log(`\nTotal: ${uniqueGameIds.length} matches`);
console.log(`GameIds: [${uniqueGameIds.join(', ')}]`);
