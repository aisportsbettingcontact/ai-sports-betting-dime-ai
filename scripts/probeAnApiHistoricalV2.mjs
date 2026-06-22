/**
 * probeAnApiHistoricalV2.mjs
 *
 * Probe AN API using the exact working endpoint pattern for WC2026.
 * First discover the working soccer endpoint, then try historical dates.
 *
 * LOGGING: [AN_PROBE_V2]
 */
import { config } from 'dotenv';
config();

const TAG = '[AN_PROBE_V2]';
const METABET_KEY = process.env.METABET_API_KEY;

// Read the existing AN API pull scripts to find the exact working endpoint
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

async function anFetch(url, extraHeaders = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.actionnetwork.com/',
    'Origin': 'https://www.actionnetwork.com',
    ...extraHeaders
  };
  if (METABET_KEY) headers['Authorization'] = `Bearer ${METABET_KEY}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} AN API Historical WC Odds Probe v2`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  // ── Step 1: Find the working AN API endpoint from existing scripts ────
  console.log(`${TAG} [STEP 1] Reading existing AN API pull scripts for working endpoint...`);
  const scriptsDir = '/home/ubuntu/ai-sports-betting/scripts';
  const serverDir = '/home/ubuntu/ai-sports-betting/server';
  const allFiles = [];
  try {
    readdirSync(scriptsDir).filter(f => f.includes('pull') || f.includes('dk') || f.includes('an') || f.includes('odds')).forEach(f => allFiles.push(join(scriptsDir, f)));
    readdirSync(serverDir).filter(f => f.includes('wc') || f.includes('odds') || f.includes('an')).forEach(f => allFiles.push(join(serverDir, f)));
  } catch (e) {}

  let workingEndpoint = null;
  for (const f of allFiles) {
    try {
      const content = readFileSync(f, 'utf8');
      const urlMatches = content.match(/https?:\/\/[^\s'"]+actionnetwork[^\s'"]+/g) || [];
      const baseMatches = content.match(/api\.actionnetwork\.com[^\s'"]+/g) || [];
      if (urlMatches.length > 0 || baseMatches.length > 0) {
        console.log(`${TAG} [STATE] Found AN URLs in ${f.split('/').pop()}:`);
        [...urlMatches, ...baseMatches].slice(0, 5).forEach(u => console.log(`${TAG}   ${u}`));
        workingEndpoint = urlMatches[0] || `https://${baseMatches[0]}`;
      }
    } catch (e) {}
  }

  // ── Step 2: Try the exact AN soccer endpoint pattern ──────────────────
  console.log(`\n${TAG} [STEP 2] Testing exact AN soccer endpoint patterns...`);

  const baseUrls = [
    'https://api.actionnetwork.com/web/v1/scoreboard/soccer',
    'https://api.actionnetwork.com/web/v1/scoreboard/soccer?period=full&bookIds=68',
    'https://api.actionnetwork.com/web/v2/scoreboard/soccer',
    'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league=world-cup',
    'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league=world_cup',
    'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league=fifa-world-cup',
    'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league=fifa_world_cup',
  ];

  for (const url of baseUrls) {
    try {
      const data = await anFetch(url);
      const keys = typeof data === 'object' ? Object.keys(data) : ['string'];
      console.log(`${TAG} [STATE] ${url.replace('https://api.actionnetwork.com/web/v1/', '')}: keys=${keys.join(',')} | ${typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : data.slice(0, 100)}`);
    } catch (e) {
      console.warn(`${TAG} [WARN] ${url.split('/').slice(-2).join('/')}: ${e.message.slice(0, 80)}`);
    }
  }

  // ── Step 3: Try with date parameter for historical dates ──────────────
  console.log(`\n${TAG} [STEP 3] Testing with historical WC dates...`);

  const historicalTests = [
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?date=20180614', label: 'WC2018 day1' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?date=20221120', label: 'WC2022 day1' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?date=2018-06-14', label: 'WC2018 day1 dash' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?date=2022-11-20', label: 'WC2022 day1 dash' },
    // Try with league IDs that might correspond to WC
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=1&date=20180614', label: 'WC2018 league1' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=2&date=20180614', label: 'WC2018 league2' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=3&date=20180614', label: 'WC2018 league3' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=4&date=20180614', label: 'WC2018 league4' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=5&date=20180614', label: 'WC2018 league5' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=10&date=20180614', label: 'WC2018 league10' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=20&date=20180614', label: 'WC2018 league20' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=100&date=20180614', label: 'WC2018 league100' },
    { url: 'https://api.actionnetwork.com/web/v1/scoreboard/soccer?league_id=200&date=20180614', label: 'WC2018 league200' },
  ];

  for (const t of historicalTests) {
    try {
      const data = await anFetch(t.url);
      if (typeof data === 'object') {
        const keys = Object.keys(data);
        const gameCount = (data.games || data.data || data.scoreboard || []).length;
        console.log(`${TAG} [STATE] ${t.label}: keys=${keys.join(',')} games=${gameCount}`);
        if (gameCount > 0) {
          const games = data.games || data.data || data.scoreboard || [];
          console.log(`${TAG}   FOUND GAMES! Sample: ${JSON.stringify(games[0]).slice(0, 300)}`);
        }
      } else {
        console.log(`${TAG} [STATE] ${t.label}: ${String(data).slice(0, 100)}`);
      }
    } catch (e) {
      console.warn(`${TAG} [WARN] ${t.label}: ${e.message.slice(0, 80)}`);
    }
  }

  // ── Step 4: Try AN API v2 and v3 patterns ─────────────────────────────
  console.log(`\n${TAG} [STEP 4] Testing AN API v2/v3 patterns...`);
  const v2Tests = [
    'https://api.actionnetwork.com/web/v2/scoreboard/soccer?date=20180614',
    'https://api.actionnetwork.com/web/v2/scoreboard/soccer?date=20221120',
    'https://api.actionnetwork.com/web/v3/scoreboard/soccer?date=20180614',
    'https://api.actionnetwork.com/web/v1/games?sport=soccer&date=20180614',
    'https://api.actionnetwork.com/web/v1/games?sport=soccer&date=20221120',
  ];
  for (const url of v2Tests) {
    try {
      const data = await anFetch(url);
      const keys = typeof data === 'object' ? Object.keys(data) : ['string'];
      const gameCount = typeof data === 'object' ? (data.games || data.data || []).length : 0;
      console.log(`${TAG} [STATE] ${url.replace('https://api.actionnetwork.com/web/', '')}: keys=${keys.join(',')} games=${gameCount}`);
      if (gameCount > 0) console.log(`${TAG}   FOUND! ${JSON.stringify((data.games||data.data||[])[0]).slice(0,300)}`);
    } catch (e) {
      console.warn(`${TAG} [WARN] ${url.split('/').slice(-2).join('/')}: ${e.message.slice(0, 80)}`);
    }
  }

  // ── Step 5: Check what the existing pull script actually uses ─────────
  console.log(`\n${TAG} [STEP 5] Reading the VSiNAutoRefresh server script for exact AN URL...`);
  try {
    const serverFiles = readdirSync(serverDir);
    const wcFiles = serverFiles.filter(f => f.includes('wc') || f.includes('vsin') || f.includes('odds'));
    console.log(`${TAG} [STATE] Server WC files: ${wcFiles.join(', ')}`);
    for (const f of wcFiles.slice(0, 5)) {
      const content = readFileSync(join(serverDir, f), 'utf8');
      const anUrls = content.match(/https?:\/\/[^\s'"`,)]+actionnetwork[^\s'"`,)]+/g) || [];
      const anBases = content.match(/actionnetwork\.com\/[^\s'"`,)]+/g) || [];
      if (anUrls.length || anBases.length) {
        console.log(`${TAG}   ${f}: AN URLs found:`);
        [...anUrls, ...anBases.map(u => `https://${u}`)].forEach(u => console.log(`${TAG}     ${u}`));
      }
    }
  } catch (e) {
    console.warn(`${TAG} [WARN] Server scan failed: ${e.message}`);
  }

  console.log(`\n${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
