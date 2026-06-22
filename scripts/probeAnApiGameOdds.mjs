/**
 * probeAnApiGameOdds.mjs
 *
 * Deep probe of AN API odds endpoints for a known WC 2018 game.
 * Game 46984: Russia vs Saudi Arabia, 2018-06-14 (WC2018 opener)
 * Game 46985: Egypt vs Uruguay, 2018-06-15
 * Game 173352: Qatar vs Ecuador, 2022-11-20 (WC2022 opener)
 *
 * Strategy: Exhaustively try every known AN API odds endpoint pattern.
 * Log the FULL raw response for every endpoint that returns data.
 *
 * LOGGING: [AN_ODDS_PROBE]
 */
import { config } from 'dotenv';
config();

const TAG = '[AN_ODDS_PROBE]';
const METABET_KEY = process.env.METABET_API_KEY;

// Known WC game IDs from the scoreboard probe
const TEST_GAMES = [
  { id: 46984, label: 'WC2018 Russia vs Saudi Arabia', year: 2018 },
  { id: 46985, label: 'WC2018 Egypt vs Uruguay', year: 2018 },
  { id: 46983, label: 'WC2018 game3', year: 2018 },
  { id: 173352, label: 'WC2022 Qatar vs Ecuador', year: 2022 },
  { id: 173353, label: 'WC2022 game2', year: 2022 },
];

async function anFetch(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.actionnetwork.com/',
    'Origin': 'https://www.actionnetwork.com',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
  if (METABET_KEY) headers['x-api-key'] = METABET_KEY;
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text, data: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} AN API Game Odds Deep Probe`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const game = TEST_GAMES[0]; // Start with Russia vs Saudi Arabia
  console.log(`${TAG} [INPUT] Primary test game: id=${game.id} label="${game.label}"`);

  // ── Step 1: Probe all known AN API game/odds endpoint patterns ────────
  console.log(`\n${TAG} [STEP 1] Probing all game/odds endpoint patterns for game ${game.id}...`);

  const BASE = 'https://api.actionnetwork.com/web';

  const endpoints = [
    // v1 game endpoints
    `${BASE}/v1/game/${game.id}`,
    `${BASE}/v1/game/${game.id}?include=odds`,
    `${BASE}/v1/game/${game.id}?include=odds,teams`,
    `${BASE}/v1/game/${game.id}/odds`,
    `${BASE}/v1/game/${game.id}/odds?period=full`,
    `${BASE}/v1/game/${game.id}/odds?period=full&bookIds=68,15,30`,
    `${BASE}/v1/game/${game.id}/markets`,
    `${BASE}/v1/game/${game.id}/markets?period=full`,
    // v2 game endpoints
    `${BASE}/v2/game/${game.id}`,
    `${BASE}/v2/game/${game.id}?include=odds`,
    `${BASE}/v2/game/${game.id}?include=odds,teams`,
    `${BASE}/v2/game/${game.id}/odds`,
    `${BASE}/v2/game/${game.id}/odds?period=full`,
    `${BASE}/v2/game/${game.id}/odds?period=full&bookIds=68`,
    `${BASE}/v2/game/${game.id}/markets`,
    `${BASE}/v2/game/${game.id}/markets?period=full`,
    // v3
    `${BASE}/v3/game/${game.id}`,
    `${BASE}/v3/game/${game.id}?include=odds`,
    `${BASE}/v3/game/${game.id}/odds`,
    // games (plural)
    `${BASE}/v1/games/${game.id}`,
    `${BASE}/v1/games/${game.id}?include=odds`,
    `${BASE}/v2/games/${game.id}`,
    `${BASE}/v2/games/${game.id}?include=odds`,
    // odds endpoints
    `${BASE}/v1/odds/${game.id}`,
    `${BASE}/v2/odds/${game.id}`,
    `${BASE}/v1/odds?game_id=${game.id}`,
    `${BASE}/v2/odds?game_id=${game.id}`,
    `${BASE}/v1/odds?game_id=${game.id}&period=full`,
    `${BASE}/v2/odds?game_id=${game.id}&period=full`,
    // soccer-specific
    `${BASE}/v1/soccer/game/${game.id}`,
    `${BASE}/v2/soccer/game/${game.id}`,
    `${BASE}/v1/soccer/odds/${game.id}`,
    `${BASE}/v2/soccer/odds/${game.id}`,
    // scoreboard with game filter
    `${BASE}/v1/scoreboard/soccer?game_id=${game.id}`,
    `${BASE}/v2/scoreboard/soccer?game_id=${game.id}`,
    `${BASE}/v1/scoreboard/soccer?gameIds=${game.id}&include=odds`,
    `${BASE}/v2/scoreboard/soccer?gameIds=${game.id}&include=odds`,
    // markets
    `${BASE}/v1/markets?game_id=${game.id}`,
    `${BASE}/v2/markets?game_id=${game.id}`,
    `${BASE}/v2/scoreboard/soccer/markets?gameIds=${game.id}`,
    `${BASE}/v1/scoreboard/soccer/markets?gameIds=${game.id}`,
  ];

  let foundEndpoints = [];

  for (const url of endpoints) {
    try {
      const { status, ok, text, data } = await anFetch(url);
      const shortUrl = url.replace(`${BASE}/`, '');

      if (ok && data) {
        const keys = Object.keys(data);
        const hasOdds = JSON.stringify(data).toLowerCase().includes('odds') ||
                        JSON.stringify(data).toLowerCase().includes('moneyline') ||
                        JSON.stringify(data).toLowerCase().includes('spread');
        console.log(`${TAG} [STATE] ✅ ${shortUrl}: HTTP ${status} | keys=${keys.join(',')} | hasOdds=${hasOdds}`);
        if (hasOdds) {
          console.log(`${TAG}   *** ODDS FOUND *** Full response: ${JSON.stringify(data).slice(0, 600)}`);
          foundEndpoints.push({ url, data });
        } else {
          // Show structure even without odds
          console.log(`${TAG}   Data: ${JSON.stringify(data).slice(0, 300)}`);
        }
      } else if (status !== 404) {
        console.log(`${TAG} [STATE] ⚠️  ${shortUrl}: HTTP ${status} | ${text.slice(0, 100)}`);
      }
      // 404s are silent
      await sleep(80);
    } catch (e) {
      console.warn(`${TAG} [WARN] ${url.split('/').slice(-2).join('/')}: ${e.message.slice(0, 60)}`);
    }
  }

  // ── Step 2: If v2/game/{id} returns data, inspect it fully ────────────
  console.log(`\n${TAG} [STEP 2] Full inspection of v2/game/${game.id}...`);
  try {
    const { status, data } = await anFetch(`${BASE}/v2/game/${game.id}?include=odds,teams,books`);
    if (data) {
      console.log(`${TAG} [STATE] v2/game full response keys: ${Object.keys(data).join(', ')}`);
      // Drill into every key
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) {
          console.log(`${TAG}   key="${k}" array length=${v.length}`);
          if (v.length > 0) console.log(`${TAG}     [0]: ${JSON.stringify(v[0]).slice(0, 200)}`);
        } else if (typeof v === 'object' && v !== null) {
          console.log(`${TAG}   key="${k}" object keys=${Object.keys(v).join(',')}`);
          console.log(`${TAG}     value: ${JSON.stringify(v).slice(0, 200)}`);
        } else {
          console.log(`${TAG}   key="${k}" = ${JSON.stringify(v)}`);
        }
      }
    }
  } catch (e) {
    console.warn(`${TAG} [WARN] v2/game full inspect: ${e.message}`);
  }

  // ── Step 3: Try the scoreboard endpoint WITH include=odds param ────────
  console.log(`\n${TAG} [STEP 3] Scoreboard with include=odds for WC2018 date...`);
  const scoreboardTests = [
    `${BASE}/v2/scoreboard/soccer?date=20180614&include=odds`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&include=odds,teams`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&period=full&include=odds`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&bookIds=68`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&bookIds=15`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&bookIds=30`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&bookIds=68,15,30`,
    `${BASE}/v2/scoreboard/soccer?date=20180614&period=full&bookIds=68`,
  ];

  for (const url of scoreboardTests) {
    try {
      const { status, data } = await anFetch(url);
      const shortUrl = url.replace(`${BASE}/v2/scoreboard/soccer?`, '');
      if (data) {
        const games = data.games || [];
        const firstGame = games[0] || {};
        const gameKeys = Object.keys(firstGame);
        const hasOdds = gameKeys.includes('odds') || gameKeys.includes('markets') || gameKeys.includes('books');
        console.log(`${TAG} [STATE] ${shortUrl}: games=${games.length} | game keys=${gameKeys.join(',')} | hasOdds=${hasOdds}`);
        if (hasOdds && games.length > 0) {
          const oddsData = firstGame.odds || firstGame.markets || firstGame.books;
          console.log(`${TAG}   *** ODDS IN SCOREBOARD *** ${JSON.stringify(oddsData).slice(0, 400)}`);
        }
        // Also check top-level keys
        const topKeys = Object.keys(data);
        if (topKeys.some(k => k.includes('odds') || k.includes('market'))) {
          console.log(`${TAG}   Top-level odds keys: ${topKeys.filter(k => k.includes('odds') || k.includes('market')).join(',')}`);
        }
      }
      await sleep(80);
    } catch (e) {
      console.warn(`${TAG} [WARN] ${url.split('?')[1]?.slice(0,40)}: ${e.message.slice(0, 60)}`);
    }
  }

  // ── Step 4: Try the /markets endpoint pattern (used for MLB) ──────────
  console.log(`\n${TAG} [STEP 4] Testing /markets endpoint pattern (used for MLB k-props)...`);
  const marketTests = [
    `${BASE}/v2/scoreboard/soccer/markets?gameIds=${game.id}`,
    `${BASE}/v2/scoreboard/soccer/markets?gameIds=${game.id}&period=full`,
    `${BASE}/v2/scoreboard/soccer/markets?gameIds=${game.id}&bookIds=68`,
    `${BASE}/v2/scoreboard/mlb/markets?gameIds=${game.id}`, // wrong sport but test pattern
    `${BASE}/v2/markets/soccer?gameIds=${game.id}`,
    `${BASE}/v2/markets?sport=soccer&gameIds=${game.id}`,
    `${BASE}/v2/markets?gameIds=${game.id}`,
    `${BASE}/v1/markets?gameIds=${game.id}`,
  ];

  for (const url of marketTests) {
    try {
      const { status, data } = await anFetch(url);
      const shortUrl = url.replace(`${BASE}/`, '');
      if (data && status !== 404) {
        const keys = Object.keys(data);
        console.log(`${TAG} [STATE] ${shortUrl}: HTTP ${status} | keys=${keys.join(',')} | ${JSON.stringify(data).slice(0, 300)}`);
      }
      await sleep(80);
    } catch (e) {}
  }

  // ── Step 5: Try the exact working MLB markets URL pattern ─────────────
  console.log(`\n${TAG} [STEP 5] Checking exact MLB markets URL pattern from anKPropsService.ts...`);
  // From the probe: https://api.actionnetwork.com/web/v2/scoreboard/mlb/markets
  // Try soccer equivalent
  const mlbPattern = `${BASE}/v2/scoreboard/mlb/markets`;
  const soccerPattern = `${BASE}/v2/scoreboard/soccer/markets`;
  for (const url of [mlbPattern, soccerPattern]) {
    try {
      const { status, data } = await anFetch(url);
      if (data && status !== 404) {
        console.log(`${TAG} [STATE] ${url.split('/').slice(-3).join('/')}: HTTP ${status} | keys=${Object.keys(data).join(',')} | ${JSON.stringify(data).slice(0, 400)}`);
      } else {
        console.log(`${TAG} [STATE] ${url.split('/').slice(-3).join('/')}: HTTP ${status}`);
      }
    } catch (e) {
      console.warn(`${TAG} [WARN] ${url.split('/').slice(-2).join('/')}: ${e.message.slice(0, 60)}`);
    }
  }

  // ── Step 6: Try with Authorization header as Bearer token ─────────────
  console.log(`\n${TAG} [STEP 6] Testing with Authorization: Bearer header...`);
  if (METABET_KEY) {
    const authUrl = `${BASE}/v2/game/${game.id}?include=odds`;
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Referer': 'https://www.actionnetwork.com/',
      'Authorization': `Bearer ${METABET_KEY}`,
    };
    try {
      const res = await fetch(authUrl, { headers });
      const text = await res.text();
      const data = (() => { try { return JSON.parse(text); } catch { return null; } })();
      console.log(`${TAG} [STATE] Bearer auth game/${game.id}: HTTP ${res.status} | ${text.slice(0, 300)}`);
    } catch (e) {
      console.warn(`${TAG} [WARN] Bearer auth: ${e.message}`);
    }
  } else {
    console.log(`${TAG} [STATE] METABET_API_KEY not set — skipping auth test`);
  }

  // ── Step 7: Check what the current WC2026 pull script uses exactly ─────
  console.log(`\n${TAG} [STEP 7] Checking exact URL pattern from current WC2026 pull script...`);
  try {
    const { readFileSync, readdirSync } = await import('fs');
    const scriptsDir = '/home/ubuntu/ai-sports-betting/scripts';
    const files = readdirSync(scriptsDir).filter(f => f.includes('pull') && f.includes('june'));
    for (const f of files) {
      const content = readFileSync(`${scriptsDir}/${f}`, 'utf8');
      // Find all fetch/URL calls
      const fetchCalls = content.match(/fetch\([^)]+\)/g) || [];
      const urlConsts = content.match(/const\s+\w+\s*=\s*`[^`]*actionnetwork[^`]*`/g) || [];
      const urlStrings = content.match(/['"][^'"]*actionnetwork[^'"]*['"]/g) || [];
      if (fetchCalls.length || urlConsts.length || urlStrings.length) {
        console.log(`${TAG}   File: ${f}`);
        [...fetchCalls, ...urlConsts, ...urlStrings].slice(0, 10).forEach(u => console.log(`${TAG}     ${u.slice(0, 150)}`));
      }
    }
  } catch (e) {
    console.warn(`${TAG} [WARN] Script scan: ${e.message}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} [OUTPUT] Endpoints with odds data: ${foundEndpoints.length}`);
  foundEndpoints.forEach(ep => console.log(`${TAG}   ${ep.url}`));
  console.log(`${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
