/**
 * inspectAnApiGameStructure.mjs
 *
 * Full raw inspection of the AN API game object for WC2018 and WC2022.
 * Focus: boxscore, markets, meta, teams fields — find where odds live.
 *
 * LOGGING: [AN_INSPECT]
 */
import { config } from 'dotenv';
config();
import { writeFileSync } from 'fs';

const TAG = '[AN_INSPECT]';
const BASE = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer';

async function anFetch(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.actionnetwork.com/',
    'Origin': 'https://www.actionnetwork.com',
  };
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function deepLog(obj, prefix, depth = 0) {
  if (depth > 4) return;
  if (Array.isArray(obj)) {
    console.log(`${TAG}   ${prefix}: Array[${obj.length}]`);
    if (obj.length > 0) deepLog(obj[0], `${prefix}[0]`, depth + 1);
  } else if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj);
    console.log(`${TAG}   ${prefix}: {${keys.join(', ')}}`);
    for (const k of keys) {
      deepLog(obj[k], `${prefix}.${k}`, depth + 1);
    }
  } else {
    console.log(`${TAG}   ${prefix}: ${JSON.stringify(obj)}`);
  }
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} AN API Game Structure Full Inspection`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  // ── Fetch WC2018 day 1 with all params ────────────────────────────────
  const testDates = [
    { date: '20180614', label: 'WC2018 Day1', year: 2018 },
    { date: '20221120', label: 'WC2022 Day1', year: 2022 },
    { date: '20260611', label: 'WC2026 Day1', year: 2026 }, // known working
  ];

  for (const { date, label, year } of testDates) {
    console.log(`\n${TAG} [STEP] Fetching ${label} (${date})...`);
    try {
      const url = `${BASE}?date=${date}&period=full&bookIds=68`;
      const data = await anFetch(url);
      const games = data.games || [];
      const wcGames = games.filter(g => g.league_id === 20 || g.league_name === 'worldcup');
      console.log(`${TAG} [STATE] Total games: ${games.length} | WC games: ${wcGames.length}`);

      if (wcGames.length === 0 && games.length > 0) {
        console.log(`${TAG} [STATE] First game league_id=${games[0].league_id} league_name=${games[0].league_name}`);
        // Maybe all games are WC for this date
        const g = games[0];
        console.log(`${TAG} [STATE] Using first game: id=${g.id}`);
        wcGames.push(g);
      }

      for (const g of wcGames.slice(0, 2)) {
        console.log(`\n${TAG} [STATE] Game ${g.id} full structure:`);
        const allKeys = Object.keys(g);
        console.log(`${TAG}   Top-level keys: ${allKeys.join(', ')}`);

        // Inspect each key fully
        for (const k of allKeys) {
          const v = g[k];
          if (v === null || v === undefined) {
            console.log(`${TAG}   [${k}]: null/undefined`);
          } else if (Array.isArray(v)) {
            console.log(`${TAG}   [${k}]: Array[${v.length}]`);
            if (v.length > 0) {
              console.log(`${TAG}     [0]: ${JSON.stringify(v[0]).slice(0, 200)}`);
            }
          } else if (typeof v === 'object') {
            const subKeys = Object.keys(v);
            console.log(`${TAG}   [${k}]: Object{${subKeys.join(', ')}} = ${JSON.stringify(v).slice(0, 300)}`);
          } else {
            console.log(`${TAG}   [${k}]: ${JSON.stringify(v)}`);
          }
        }

        // Save full game object to file for inspection
        const outPath = `/tmp/an_game_${g.id}_${label.replace(/\s/g, '_')}.json`;
        writeFileSync(outPath, JSON.stringify(g, null, 2));
        console.log(`${TAG}   Full game object saved to ${outPath}`);
      }

      // Also check top-level response keys for odds
      const topKeys = Object.keys(data);
      console.log(`\n${TAG} [STATE] ${label} top-level response keys: ${topKeys.join(', ')}`);
      for (const k of topKeys) {
        if (k !== 'games') {
          console.log(`${TAG}   [${k}]: ${JSON.stringify(data[k]).slice(0, 200)}`);
        }
      }

    } catch (e) {
      console.warn(`${TAG} [WARN] ${label}: ${e.message}`);
    }
  }

  // ── Try fetching with different bookIds to see if odds appear ─────────
  console.log(`\n${TAG} [STEP] Testing different bookIds for WC2018...`);
  const bookIdTests = [
    '68', '15', '30', '1', '2', '3', '4', '5', '10', '20', '25', '35', '40', '50', '60', '70', '80', '100'
  ];

  for (const bookId of bookIdTests) {
    try {
      const url = `${BASE}?date=20180614&bookIds=${bookId}`;
      const data = await anFetch(url);
      const games = (data.games || []).filter(g => g.league_id === 20);
      if (games.length > 0) {
        const g = games[0];
        const markets = g.markets || {};
        const marketKeys = Object.keys(markets);
        const hasData = marketKeys.length > 0 && JSON.stringify(markets) !== '{}';
        if (hasData) {
          console.log(`${TAG} [STATE] bookId=${bookId}: markets FOUND! keys=${marketKeys.join(',')} | ${JSON.stringify(markets).slice(0, 300)}`);
        }
        // Also check boxscore
        if (g.boxscore && Object.keys(g.boxscore).length > 0) {
          console.log(`${TAG} [STATE] bookId=${bookId}: boxscore=${JSON.stringify(g.boxscore).slice(0, 200)}`);
        }
      }
    } catch (e) {}
  }

  // ── Try the WC2026 current game to see what markets look like ─────────
  console.log(`\n${TAG} [STEP] Comparing WC2026 current game markets structure...`);
  try {
    // Use a known WC2026 game date (June 11, 2026 = first WC2026 game)
    const url = `${BASE}?date=20260611&bookIds=68`;
    const data = await anFetch(url);
    const games = (data.games || []).filter(g => g.league_id === 20);
    console.log(`${TAG} [STATE] WC2026 Jun11 games: ${games.length}`);
    if (games.length > 0) {
      const g = games[0];
      console.log(`${TAG} [STATE] WC2026 game keys: ${Object.keys(g).join(', ')}`);
      const markets = g.markets || {};
      const marketKeys = Object.keys(markets);
      console.log(`${TAG} [STATE] WC2026 markets keys: ${marketKeys.join(', ')}`);
      if (marketKeys.length > 0) {
        console.log(`${TAG} [STATE] WC2026 markets content: ${JSON.stringify(markets).slice(0, 500)}`);
      }
      // Check boxscore
      console.log(`${TAG} [STATE] WC2026 boxscore: ${JSON.stringify(g.boxscore).slice(0, 200)}`);
    }
  } catch (e) {
    console.warn(`${TAG} [WARN] WC2026 compare: ${e.message}`);
  }

  console.log(`\n${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
