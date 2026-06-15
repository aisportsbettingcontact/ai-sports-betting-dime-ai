/**
 * debug_an_june15.mjs
 * ===================
 * Fetches raw AN API response for June 15 and dumps full team/odds structure
 * to determine correct home/away mapping for each fixture.
 */
import { config } from 'dotenv';
config();

const AN_URL = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer?bookIds=68&date=20260615&periods=event';
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/soccer/odds',
  'Origin': 'https://www.actionnetwork.com',
};

console.log('[INPUT] Fetching raw AN API for June 15 WC games');
const res = await fetch(AN_URL, { headers: AN_HEADERS });
if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
const data = await res.json();

for (const game of data.games ?? []) {
  console.log('');
  console.log('=== GAME', game.id, '===');
  console.log('start_time:', game.start_time);
  console.log('teams array:');
  for (let i = 0; i < game.teams.length; i++) {
    const t = game.teams[i];
    console.log(`  [${i}] id=${t.id} full_name="${t.full_name}" abbr="${t.abbr}" display_name="${t.display_name ?? ''}" is_home=${t.is_home ?? 'N/A'}`);
  }
  
  const dk = game.markets?.['68']?.event;
  if (dk) {
    console.log('DK moneyline:');
    for (const o of dk.moneyline ?? []) {
      console.log(`  side=${o.side} odds=${o.odds} team_id=${o.team_id ?? 'N/A'}`);
    }
    console.log('DK total:');
    for (const o of dk.total ?? []) {
      console.log(`  side=${o.side} odds=${o.odds} value=${o.value ?? 'N/A'}`);
    }
    console.log('DK spread:');
    for (const o of dk.spread ?? []) {
      console.log(`  side=${o.side} odds=${o.odds} value=${o.value ?? 'N/A'} team_id=${o.team_id ?? 'N/A'}`);
    }
  } else {
    console.log('NO DK MARKETS');
  }
}
