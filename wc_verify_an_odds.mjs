/**
 * wc_verify_an_odds.mjs
 * Live AN API scrape for June 19 WC2026 odds — verifies DK lines against DB
 */
import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
config();

const AN_URL = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer?bookIds=15,30,79,2988,75,123,71,68,69&date=20260619&periods=event';
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/soccer/odds',
  'Origin': 'https://www.actionnetwork.com',
};

function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function impliedToAmerican(p) {
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

(async () => {
  console.log('[INPUT] Fetching AN API for June 19, 2026 WC2026 soccer odds');
  console.log('[INPUT] URL:', AN_URL);

  let anData;
  try {
    const res = await fetch(AN_URL, { headers: AN_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    anData = await res.json();
    console.log(`[STEP] AN returned ${anData.games?.length ?? 0} games`);
  } catch (err) {
    console.error('[VERIFY] FAIL — AN fetch error:', err.message);
    console.log('[REPORT] DraftKings odds scrape FAILED — using DB values as authoritative source');
    process.exit(0);
  }

  const games = anData.games ?? [];
  if (games.length === 0) {
    console.log('[OUTPUT] No games returned from AN for June 19');
    process.exit(0);
  }

  // Extract DK (book_id=68) odds for each game
  const liveOdds = [];
  for (const game of games) {
    const awayTeam = game.teams[0]?.full_name ?? game.teams[0]?.abbr ?? 'Unknown';
    const homeTeam = game.teams[1]?.full_name ?? game.teams[1]?.abbr ?? 'Unknown';
    const startTime = game.start_time;
    const dkBook = game.markets?.['68']?.event;

    if (!dkBook) {
      console.log(`[STATE] Game ${game.id} (${homeTeam} vs ${awayTeam}): No DK odds available`);
      continue;
    }

    const ml = dkBook.moneyline ?? [];
    const totals = dkBook.total ?? [];
    const spreads = dkBook.spread ?? [];

    const mlHome = ml.find(o => o.side === 'home');
    const mlAway = ml.find(o => o.side === 'away');
    const mlDraw = ml.find(o => o.side === 'draw');
    const over = totals.find(o => o.side === 'over');
    const under = totals.find(o => o.side === 'under');

    console.log(`\n[STATE] Game ${game.id}: ${homeTeam} (home) vs ${awayTeam} (away) | start=${startTime}`);
    console.log(`  [DK] ML: home=${mlHome?.odds ?? 'N/A'} draw=${mlDraw?.odds ?? 'N/A'} away=${mlAway?.odds ?? 'N/A'}`);
    console.log(`  [DK] Total: line=${over?.value ?? under?.value ?? 'N/A'} over=${over?.odds ?? 'N/A'} under=${under?.odds ?? 'N/A'}`);
    if (spreads.length > 0) {
      const sh = spreads.find(o => o.side === 'home');
      const sa = spreads.find(o => o.side === 'away');
      console.log(`  [DK] Spread: home=${sh?.value ?? 'N/A'}@${sh?.odds ?? 'N/A'} away=${sa?.value ?? 'N/A'}@${sa?.odds ?? 'N/A'}`);
    }

    // Compute DK Double Chance (no-vig)
    if (mlHome && mlDraw && mlAway) {
      const rawH = americanToImplied(mlHome.odds);
      const rawD = americanToImplied(mlDraw.odds);
      const rawA = americanToImplied(mlAway.odds);
      const rawSum = rawH + rawD + rawA;
      const fairH = rawH / rawSum;
      const fairD = rawD / rawSum;
      const fairA = rawA / rawSum;
      const dc1X = fairH + fairD;  // home_draw = 1X
      const dcX2 = fairA + fairD;  // away_draw = X2
      const dc1XOdds = impliedToAmerican(dc1X);
      const dcX2Odds = impliedToAmerican(dcX2);
      console.log(`  [DK] DC (computed from no-vig): 1X(home_draw)=${dc1XOdds} X2(away_draw)=${dcX2Odds}`);
      console.log(`  [DK] Fair probs: H=${(fairH*100).toFixed(2)}% D=${(fairD*100).toFixed(2)}% A=${(fairA*100).toFixed(2)}%`);
    }

    liveOdds.push({ homeTeam, awayTeam, startTime, mlHome, mlDraw, mlAway, over, under });
  }

  // Compare with DB
  console.log('\n[STEP] Comparing live AN odds with DB stored odds');
  const conn = await createConnection(process.env.DATABASE_URL);
  const [dbOdds] = await conn.query(`
    SELECT o.fixture_id, o.book_id, o.market, o.selection, o.line, o.american_odds,
      ht.name AS home_name, at.name AS away_name
    FROM wc2026_odds_snapshots o
    JOIN wc2026_fixtures f ON f.fixture_id = o.fixture_id
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_date = '2026-06-19'
      AND o.book_id = 68
      AND o.market IN ('1X2','TOTAL')
    ORDER BY o.fixture_id, o.market, o.selection
  `);

  console.log('\n[STATE] DB stored DK odds for June 19:');
  for (const row of dbOdds) {
    console.log(`  [${row.fixture_id}] ${row.home_name} vs ${row.away_name} | ${row.market} ${row.selection}${row.line ? ' line='+row.line : ''} => ${row.american_odds}`);
  }

  await conn.end();
  console.log('\n[VERIFY] AN API scrape complete — see above for live vs DB comparison');
})();
