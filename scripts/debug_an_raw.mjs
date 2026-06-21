/**
 * debug_an_raw.mjs
 * Fetch the raw AN API response for June 21 WC soccer and show:
 * 1. teams[0] and teams[1] for each game
 * 2. The moneyline side='home' and side='away' odds
 * 3. Whether side='home' corresponds to teams[0] or teams[1]
 * This definitively answers: does AN side='home' = teams[0] or the actual home team?
 */
import https from 'https';

const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.actionnetwork.com/',
  'Origin': 'https://www.actionnetwork.com',
};

function fetchAN(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: AN_HEADERS }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const url = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer?bookIds=68&date=20260621&periods=event';
  console.log(`[INPUT] Fetching: ${url}`);
  
  const data = await fetchAN(url);
  const games = data.games ?? [];
  
  console.log(`\n[STATE] Total games returned: ${games.length}`);
  console.log('='.repeat(80));
  
  for (const game of games) {
    const t0 = game.teams?.[0];
    const t1 = game.teams?.[1];
    const t0Name = t0?.full_name ?? t0?.abbr ?? 'unknown';
    const t1Name = t1?.full_name ?? t1?.abbr ?? 'unknown';
    const t0HomeAway = t0?.home_away ?? 'N/A';
    const t1HomeAway = t1?.home_away ?? 'N/A';
    
    console.log(`\n[GAME] id=${game.id} | teams[0]="${t0Name}" (home_away=${t0HomeAway}) | teams[1]="${t1Name}" (home_away=${t1HomeAway})`);
    
    // Get DK (book_id=68) market data
    const dkMarket = game.markets?.['68']?.event;
    if (!dkMarket) {
      console.log(`  [WARN] No DK market data`);
      continue;
    }
    
    const ml = dkMarket.moneyline ?? [];
    for (const o of ml) {
      console.log(`  [ML] side='${o.side}' odds=${o.odds > 0 ? '+' : ''}${o.odds}`);
    }
    
    // Cross-reference: which team does side='home' correspond to?
    const mlHome = ml.find(o => o.side === 'home');
    const mlAway = ml.find(o => o.side === 'away');
    
    if (mlHome && mlAway) {
      // The favorite (more negative or smaller positive) is the stronger team
      const homeIsFavorite = mlHome.odds < mlAway.odds;
      console.log(`  [ANALYSIS] side='home' odds=${mlHome.odds > 0 ? '+' : ''}${mlHome.odds} | side='away' odds=${mlAway.odds > 0 ? '+' : ''}${mlAway.odds}`);
      console.log(`  [ANALYSIS] teams[0]="${t0Name}" home_away=${t0HomeAway} | teams[1]="${t1Name}" home_away=${t1HomeAway}`);
      
      // If teams[0] has home_away='home', then side='home' should correspond to teams[0]
      if (t0HomeAway === 'home') {
        console.log(`  [VERIFY] teams[0] IS the home team → side='home' should = teams[0]="${t0Name}" odds=${mlHome.odds > 0 ? '+' : ''}${mlHome.odds}`);
      } else if (t1HomeAway === 'home') {
        console.log(`  [VERIFY] teams[1] IS the home team → side='home' should = teams[1]="${t1Name}" odds=${mlHome.odds > 0 ? '+' : ''}${mlHome.odds}`);
      } else {
        console.log(`  [WARN] Neither team has home_away='home' — checking by team_id`);
        // Try to infer from odds: the team with the lower (more negative) odds is likely the favorite
        console.log(`  [INFER] side='home' favorite=${homeIsFavorite} | teams[0] is ${homeIsFavorite ? 'likely home' : 'likely away'}`);
      }
    }
  }
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
