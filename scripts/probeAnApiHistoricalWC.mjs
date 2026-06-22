/**
 * probeAnApiHistoricalWC.mjs
 *
 * Probe the Action Network (AN) API for historical 2018 and 2022
 * World Cup Group Stage odds.
 *
 * Strategy:
 *   1. Search AN API for WC 2018 and 2022 league/event IDs
 *   2. Pull all group stage game IDs for each tournament
 *   3. For each game, pull odds for all available markets:
 *      - Moneyline (home/draw/away)
 *      - Total (O/U 0.5, 1.5, 2.5, 3.5)
 *      - Double Chance (1X, X2, 12)
 *   4. Log all raw API responses with full structure
 *   5. Report what is and isn't available
 *
 * LOGGING: [AN_PROBE] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import { config } from 'dotenv';
config();

const TAG = '[AN_PROBE]';
const AN_BASE = 'https://api.actionnetwork.com/web/v1';
const METABET_KEY = process.env.METABET_API_KEY;

async function anGet(path, params = {}) {
  const url = new URL(`${AN_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  if (METABET_KEY) headers['Authorization'] = `Bearer ${METABET_KEY}`;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AN API ${res.status} for ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} AN API Historical WC Odds Probe`);
  console.log(`${TAG} Target: 2018 WC (48 games) + 2022 WC (48 games)`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  // ── Step 1: Search for WC leagues ──────────────────────────────────────
  console.log(`${TAG} [STEP 1] Searching AN API for World Cup leagues...`);

  // Try known soccer sport ID and search for WC
  let soccerLeagues;
  try {
    soccerLeagues = await anGet('/leagues', { sport_id: 3 }); // 3 = soccer
    console.log(`${TAG} [STATE] Soccer leagues response keys: ${Object.keys(soccerLeagues).join(', ')}`);
    const leagues = soccerLeagues.leagues || soccerLeagues.data || [];
    const wcLeagues = leagues.filter(l =>
      (l.name || '').toLowerCase().includes('world cup') ||
      (l.alias || '').toLowerCase().includes('world') ||
      (l.slug || '').toLowerCase().includes('world')
    );
    console.log(`${TAG} [STATE] WC-related leagues found: ${wcLeagues.length}`);
    wcLeagues.forEach(l => console.log(`${TAG}   League: id=${l.id} name="${l.name}" alias="${l.alias}" slug="${l.slug}"`));
  } catch (e) {
    console.warn(`${TAG} [WARN] /leagues failed: ${e.message}`);
  }

  // ── Step 2: Try direct game search by date ranges ──────────────────────
  console.log(`\n${TAG} [STEP 2] Searching for WC 2018 games by date range...`);

  // WC 2018 group stage: June 14 – June 28, 2018
  // WC 2022 group stage: Nov 20 – Dec 2, 2022
  const searches = [
    { label: 'WC2018 day 1', date: '2018-06-14', sport: 'soccer' },
    { label: 'WC2018 day 2', date: '2018-06-15', sport: 'soccer' },
    { label: 'WC2022 day 1', date: '2022-11-20', sport: 'soccer' },
    { label: 'WC2022 day 2', date: '2022-11-21', sport: 'soccer' },
  ];

  for (const s of searches) {
    console.log(`\n${TAG} [STEP] Searching ${s.label} (${s.date})...`);
    try {
      // Try /games endpoint with date
      const data = await anGet('/games', {
        sport: s.sport,
        date: s.date,
        include: 'odds',
      });
      const games = data.games || data.data || [];
      console.log(`${TAG} [STATE] ${s.label}: ${games.length} games found`);
      if (games.length > 0) {
        const sample = games[0];
        console.log(`${TAG}   Sample game keys: ${Object.keys(sample).join(', ')}`);
        console.log(`${TAG}   Sample: id=${sample.id} home="${sample.home_team?.full_name || sample.teams?.[0]?.full_name}" away="${sample.away_team?.full_name || sample.teams?.[1]?.full_name}"`);
        if (sample.odds) {
          console.log(`${TAG}   Odds keys: ${Object.keys(sample.odds).join(', ')}`);
          console.log(`${TAG}   Odds sample: ${JSON.stringify(sample.odds).slice(0, 300)}`);
        }
      }
    } catch (e) {
      console.warn(`${TAG} [WARN] /games failed for ${s.label}: ${e.message}`);
    }

    // Also try /scoreboard
    try {
      const data2 = await anGet('/scoreboard', {
        sport: s.sport,
        date: s.date,
      });
      const games2 = data2.games || data2.data || data2.scoreboard || [];
      console.log(`${TAG} [STATE] /scoreboard ${s.label}: ${Array.isArray(games2) ? games2.length : 'non-array'} games`);
    } catch (e) {
      console.warn(`${TAG} [WARN] /scoreboard failed for ${s.label}: ${e.message}`);
    }
  }

  // ── Step 3: Try soccer-specific endpoints ──────────────────────────────
  console.log(`\n${TAG} [STEP 3] Trying soccer-specific AN endpoints...`);

  const endpoints = [
    '/sports',
    '/sports/soccer',
    '/leagues?sport=soccer',
    '/leagues?sport_id=3',
    '/games?sport=soccer&date=2018-06-14',
    '/games?sport=soccer&league_id=5&date=2018-06-14',
    '/games?sport=soccer&league_id=1&date=2018-06-14',
  ];

  for (const ep of endpoints) {
    try {
      const path = ep.includes('?') ? ep.split('?')[0] : ep;
      const paramStr = ep.includes('?') ? ep.split('?')[1] : '';
      const params = {};
      if (paramStr) {
        for (const p of paramStr.split('&')) {
          const [k, v] = p.split('=');
          params[k] = v;
        }
      }
      const data = await anGet(path, params);
      const keys = Object.keys(data);
      console.log(`${TAG} [STATE] ${ep}: keys=${keys.join(',')} | top-level counts: ${keys.map(k => `${k}=${Array.isArray(data[k]) ? data[k].length : typeof data[k]}`).join(' ')}`);
      // If sports, show all
      if (data.sports) {
        data.sports.forEach(s => console.log(`${TAG}   Sport: id=${s.id} name="${s.name}" alias="${s.alias}"`));
      }
      // If leagues, show soccer/WC ones
      if (data.leagues) {
        const wc = data.leagues.filter(l => (l.name||'').toLowerCase().includes('world') || (l.alias||'').toLowerCase().includes('world'));
        if (wc.length > 0) wc.forEach(l => console.log(`${TAG}   WC League: ${JSON.stringify(l)}`));
        else console.log(`${TAG}   No WC leagues in ${data.leagues.length} total`);
      }
    } catch (e) {
      console.warn(`${TAG} [WARN] ${ep}: ${e.message.slice(0, 120)}`);
    }
  }

  // ── Step 4: Try the exact AN API pattern used for current WC2026 ────────
  console.log(`\n${TAG} [STEP 4] Testing AN API pattern used for current WC2026 odds pull...`);

  // The working pattern for WC2026 uses sport=soccer and a specific league
  // Try to find what league_id WC2026 uses, then try same for 2018/2022
  try {
    const today = new Date().toISOString().split('T')[0];
    const wcCurrent = await anGet('/games', {
      sport: 'soccer',
      date: today,
      include: 'odds',
    });
    const games = wcCurrent.games || wcCurrent.data || [];
    console.log(`${TAG} [STATE] Today's soccer games: ${games.length}`);
    if (games.length > 0) {
      const wcGames = games.filter(g =>
        (g.league?.name || '').toLowerCase().includes('world') ||
        (g.league?.alias || '').toLowerCase().includes('world') ||
        (g.competition?.name || '').toLowerCase().includes('world')
      );
      console.log(`${TAG} [STATE] WC games today: ${wcGames.length}`);
      if (wcGames.length > 0) {
        const g = wcGames[0];
        console.log(`${TAG}   WC game structure: ${JSON.stringify(g).slice(0, 500)}`);
        const leagueId = g.league?.id || g.competition?.id;
        console.log(`${TAG}   WC league_id: ${leagueId}`);

        // Now try same league_id for 2018 and 2022
        if (leagueId) {
          for (const testDate of ['2018-06-14', '2022-11-20']) {
            try {
              const hist = await anGet('/games', {
                sport: 'soccer',
                league_id: leagueId,
                date: testDate,
                include: 'odds',
              });
              const hGames = hist.games || hist.data || [];
              console.log(`${TAG}   league_id=${leagueId} date=${testDate}: ${hGames.length} games`);
              if (hGames.length > 0) {
                console.log(`${TAG}   Sample: ${JSON.stringify(hGames[0]).slice(0, 400)}`);
              }
            } catch (e) {
              console.warn(`${TAG}   [WARN] league_id=${leagueId} date=${testDate}: ${e.message.slice(0, 100)}`);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn(`${TAG} [WARN] Today's games fetch failed: ${e.message}`);
  }

  // ── Step 5: Try AN API game lookup by ESPN event ID ────────────────────
  console.log(`\n${TAG} [STEP 5] Testing AN API game lookup by ESPN event ID...`);
  // WC 2018 Russia vs Saudi Arabia ESPN event ID = 488900 (known)
  const testEventIds = ['488900', '488901', '488902', '488903'];
  for (const eid of testEventIds) {
    try {
      const data = await anGet(`/games/${eid}`, { include: 'odds' });
      console.log(`${TAG} [STATE] Game ${eid}: ${JSON.stringify(data).slice(0, 300)}`);
    } catch (e) {
      console.warn(`${TAG} [WARN] Game ${eid}: ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`\n${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
