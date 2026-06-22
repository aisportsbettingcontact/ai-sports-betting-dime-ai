/**
 * pullAnApiHistoricalWCOdds.mjs
 *
 * Pull ALL historical World Cup Group Stage odds from AN API v2.
 * Covers: 2018 WC (Jun 14–Jun 28) and 2022 WC (Nov 20–Dec 2)
 *
 * Working endpoint: https://api.actionnetwork.com/web/v2/scoreboard/soccer?date=YYYYMMDD
 * league_id=20, league_name="worldcup"
 *
 * Per game, pulls:
 *   - 1X2 moneyline (home/draw/away)
 *   - Totals (O/U 0.5, 1.5, 2.5, 3.5)
 *   - Double Chance (1X, X2, 12)
 *   - Final score (home_score, away_score)
 *   - Team IDs and names
 *
 * Output: JSON file at /tmp/wc_historical_odds.json
 *
 * LOGGING: [AN_HIST]
 */
import { config } from 'dotenv';
config();
import { writeFileSync } from 'fs';

const TAG = '[AN_HIST]';
const AN_BASE = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer';

// ── Date ranges for WC group stages ────────────────────────────────────────
function dateRange(start, end) {
  const dates = [];
  const cur = new Date(start);
  const fin = new Date(end);
  while (cur <= fin) {
    dates.push(cur.toISOString().split('T')[0].replace(/-/g, ''));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

const WC2018_DATES = dateRange('2018-06-14', '2018-06-28'); // 15 days
const WC2022_DATES = dateRange('2022-11-20', '2022-12-02'); // 13 days

async function anFetch(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.actionnetwork.com/',
    'Origin': 'https://www.actionnetwork.com',
  };
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Pull game details including odds for a specific game ID ────────────────
async function pullGameOdds(gameId) {
  try {
    const url = `https://api.actionnetwork.com/web/v2/game/${gameId}?include=odds&period=full`;
    const data = await anFetch(url);
    return data;
  } catch (e) {
    // Try v1
    try {
      const url = `https://api.actionnetwork.com/web/v1/game/${gameId}?include=odds&period=full`;
      const data = await anFetch(url);
      return data;
    } catch (e2) {
      return null;
    }
  }
}

// ── Extract odds from game data ────────────────────────────────────────────
function extractOdds(gameData) {
  const result = {
    moneyline: { home: null, draw: null, away: null },
    totals: { ou05: null, ou15: null, ou25: null, ou35: null },
    doubleChance: { homeOrDraw: null, awayOrDraw: null, homeOrAway: null },
  };

  if (!gameData) return result;

  // Try game.odds array
  const oddsArr = gameData.odds || gameData.game?.odds || [];
  if (!Array.isArray(oddsArr) || oddsArr.length === 0) return result;

  for (const o of oddsArr) {
    const type = (o.type || o.market_type || '').toLowerCase();
    const side = (o.side || o.selection || '').toLowerCase();
    const line = o.value || o.spread || o.total || null;
    const price = o.ml || o.price || o.odds || null;

    // Moneyline
    if (type === 'moneyline' || type === 'ml' || type === '1x2') {
      if (side === 'home' || side === '1') result.moneyline.home = price;
      else if (side === 'away' || side === '2') result.moneyline.away = price;
      else if (side === 'draw' || side === 'x' || side === 'tie') result.moneyline.draw = price;
    }

    // Totals
    if (type === 'total' || type === 'ou' || type === 'over_under') {
      const totalLine = parseFloat(line);
      const isOver = side === 'over' || side === 'o';
      const isUnder = side === 'under' || side === 'u';
      if (!isNaN(totalLine) && (isOver || isUnder)) {
        const key = `ou${String(totalLine).replace('.', '')}`;
        if (!result.totals[key]) result.totals[key] = {};
        if (isOver) result.totals[key].over = price;
        else result.totals[key].under = price;
      }
    }
  }

  return result;
}

// ── Main pull loop ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} AN API Historical WC Odds Pull`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const allGames = [];
  let totalFound = 0;
  let totalWithOdds = 0;

  const tournaments = [
    { year: 2018, dates: WC2018_DATES, label: 'WC2018' },
    { year: 2022, dates: WC2022_DATES, label: 'WC2022' },
  ];

  for (const { year, dates, label } of tournaments) {
    console.log(`\n${TAG} [STEP] Pulling ${label} — ${dates.length} dates to scan...`);
    const tournamentGames = [];

    for (const date of dates) {
      try {
        const url = `${AN_BASE}?date=${date}`;
        const data = await anFetch(url);
        const games = (data.games || []).filter(g => g.league_id === 20 && g.season === year);

        if (games.length > 0) {
          console.log(`${TAG} [STATE] ${label} ${date}: ${games.length} WC game(s) found`);
          for (const g of games) {
            console.log(`${TAG}   Game ${g.id}: home_team_id=${g.home_team_id} away_team_id=${g.away_team_id} status=${g.status} score=${g.home_score}-${g.away_score}`);

            // Build game record
            const record = {
              an_game_id: g.id,
              tournament_year: year,
              date: date,
              kickoff_utc: g.start_time,
              home_team_id: g.home_team_id,
              away_team_id: g.away_team_id,
              home_score: g.home_score,
              away_score: g.away_score,
              status: g.status,
              winning_team_id: g.winning_team_id,
              // Teams from the teams array if present
              home_team_name: null,
              away_team_name: null,
              odds: null,
            };

            // Extract team names from teams array
            if (data.teams) {
              const homeTeam = data.teams.find(t => t.id === g.home_team_id);
              const awayTeam = data.teams.find(t => t.id === g.away_team_id);
              record.home_team_name = homeTeam?.full_name || homeTeam?.short_name || null;
              record.away_team_name = awayTeam?.full_name || awayTeam?.short_name || null;
              console.log(`${TAG}   Teams: home="${record.home_team_name}" away="${record.away_team_name}"`);
            }

            // Check if odds are embedded in the game object
            if (g.odds && Object.keys(g.odds).length > 0) {
              console.log(`${TAG}   Embedded odds keys: ${Object.keys(g.odds).join(', ')}`);
              record.odds_raw = g.odds;
              totalWithOdds++;
            } else {
              console.log(`${TAG}   No embedded odds — will try game-specific endpoint`);
            }

            tournamentGames.push(record);
            totalFound++;
          }
        }

        await sleep(150); // Rate limit: ~6 req/sec
      } catch (e) {
        console.warn(`${TAG} [WARN] ${label} ${date}: ${e.message.slice(0, 100)}`);
      }
    }

    console.log(`\n${TAG} [STATE] ${label}: ${tournamentGames.length} games found`);

    // Now pull odds for each game via game-specific endpoint
    console.log(`${TAG} [STEP] Pulling per-game odds for ${label}...`);
    for (const rec of tournamentGames) {
      try {
        const gameData = await pullGameOdds(rec.an_game_id);
        if (gameData) {
          const gameObj = gameData.game || gameData;
          // Extract odds
          const oddsArr = gameObj.odds || gameData.odds || [];
          rec.odds_detail = oddsArr;
          if (oddsArr.length > 0) {
            console.log(`${TAG}   Game ${rec.an_game_id} (${rec.home_team_name} vs ${rec.away_team_name}): ${oddsArr.length} odds entries`);
            // Show first few
            oddsArr.slice(0, 3).forEach(o => console.log(`${TAG}     Odds entry: ${JSON.stringify(o).slice(0, 150)}`));
            totalWithOdds++;
          } else {
            console.log(`${TAG}   Game ${rec.an_game_id}: no odds in game endpoint`);
          }
        }
        await sleep(150);
      } catch (e) {
        console.warn(`${TAG}   [WARN] Game ${rec.an_game_id} odds: ${e.message.slice(0, 80)}`);
      }
    }

    allGames.push(...tournamentGames);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} [OUTPUT] Total games found: ${totalFound}`);
  console.log(`${TAG} [OUTPUT] Games with odds data: ${totalWithOdds}`);
  console.log(`${TAG} [OUTPUT] WC2018: ${allGames.filter(g => g.tournament_year === 2018).length} games`);
  console.log(`${TAG} [OUTPUT] WC2022: ${allGames.filter(g => g.tournament_year === 2022).length} games`);

  // Show sample of what we got
  const sample2018 = allGames.filter(g => g.tournament_year === 2018).slice(0, 3);
  console.log(`\n${TAG} [OUTPUT] Sample 2018 games:`);
  sample2018.forEach(g => {
    console.log(`${TAG}   ${g.home_team_name} vs ${g.away_team_name}: ${g.home_score}-${g.away_score} | odds_entries=${g.odds_detail?.length || 0}`);
  });

  const sample2022 = allGames.filter(g => g.tournament_year === 2022).slice(0, 3);
  console.log(`\n${TAG} [OUTPUT] Sample 2022 games:`);
  sample2022.forEach(g => {
    console.log(`${TAG}   ${g.home_team_name} vs ${g.away_team_name}: ${g.home_score}-${g.away_score} | odds_entries=${g.odds_detail?.length || 0}`);
  });

  // Save to file
  const outputPath = '/tmp/wc_historical_odds.json';
  writeFileSync(outputPath, JSON.stringify(allGames, null, 2));
  console.log(`\n${TAG} [OUTPUT] Saved to ${outputPath}`);

  // ── Verify expected counts ────────────────────────────────────────────────
  const wc2018Count = allGames.filter(g => g.tournament_year === 2018).length;
  const wc2022Count = allGames.filter(g => g.tournament_year === 2022).length;
  console.log(`\n${TAG} [VERIFY] WC2018 games: ${wc2018Count}/48 ${wc2018Count === 48 ? 'PASS ✅' : 'PARTIAL ⚠️'}`);
  console.log(`${TAG} [VERIFY] WC2022 games: ${wc2022Count}/48 ${wc2022Count === 48 ? 'PASS ✅' : 'PARTIAL ⚠️'}`);
  console.log(`${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
