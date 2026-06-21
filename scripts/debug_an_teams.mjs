/**
 * debug_an_teams.mjs
 * Deep inspection of AN API teams[] objects to find per-team odds
 * and understand the exact home/away mapping for all 4 June 21 fixtures.
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
  const data = await fetchAN(url);
  const games = data.games ?? [];
  
  // DB fixture orientations (ground truth)
  const dbFixtures = {
    284377: { id: 'wc26-g-039', home: 'esp', away: 'ksa', label: 'Spain vs Saudi Arabia' },
    284378: { id: 'wc26-g-037', home: 'irn', away: 'bel', label: 'Iran vs Belgium' },
    284379: { id: 'wc26-g-040', home: 'cpv', away: 'uru', label: 'Cape Verde vs Uruguay' },
    284380: { id: 'wc26-g-038', home: 'nzl', away: 'egy', label: 'New Zealand vs Egypt' },
  };
  
  for (const game of games) {
    const db = dbFixtures[game.id];
    if (!db) continue;
    
    const t0 = game.teams?.[0];
    const t1 = game.teams?.[1];
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[GAME] ${db.label} (${db.id})`);
    console.log(`  DB: home=${db.home}, away=${db.away}`);
    console.log(`  AN teams[0]: id=${t0?.id} name="${t0?.full_name}" abbr="${t0?.abbr}"`);
    console.log(`  AN teams[1]: id=${t1?.id} name="${t1?.full_name}" abbr="${t1?.abbr}"`);
    
    // Show ALL fields in teams[0] and teams[1]
    console.log(`  teams[0] keys: ${Object.keys(t0 ?? {}).join(', ')}`);
    console.log(`  teams[1] keys: ${Object.keys(t1 ?? {}).join(', ')}`);
    
    // Check for per-team odds in teams objects
    if (t0?.ml !== undefined || t0?.moneyline !== undefined || t0?.odds !== undefined) {
      console.log(`  [TEAM ODDS] teams[0] has odds: ${JSON.stringify(t0.ml ?? t0.moneyline ?? t0.odds)}`);
    }
    if (t1?.ml !== undefined || t1?.moneyline !== undefined || t1?.odds !== undefined) {
      console.log(`  [TEAM ODDS] teams[1] has odds: ${JSON.stringify(t1.ml ?? t1.moneyline ?? t1.odds)}`);
    }
    
    // Get DK market data
    const dkMarket = game.markets?.['68']?.event;
    const ml = dkMarket?.moneyline ?? [];
    const mlHome = ml.find(o => o.side === 'home');
    const mlAway = ml.find(o => o.side === 'away');
    const mlDraw = ml.find(o => o.side === 'draw');
    
    console.log(`  DK ML: side='home'=${mlHome?.odds ?? 'N/A'} side='away'=${mlAway?.odds ?? 'N/A'} side='draw'=${mlDraw?.odds ?? 'N/A'}`);
    
    // Show full moneyline objects to find any team_id references
    if (mlHome) console.log(`  mlHome full: ${JSON.stringify(mlHome)}`);
    if (mlAway) console.log(`  mlAway full: ${JSON.stringify(mlAway)}`);
    
    // Determine correct mapping
    // DB home team should have the "home" odds
    // If side='home' odds match the DB home team's expected position, no swap needed
    // We can infer by checking if the favorite (more negative odds) matches the DB home or away team
    const homeIsFavorite = (mlHome?.odds ?? 0) < (mlAway?.odds ?? 0);
    console.log(`  side='home' is favorite: ${homeIsFavorite}`);
    console.log(`  DB home=${db.home} is ${homeIsFavorite ? 'FAVORITE' : 'UNDERDOG'} per AN`);
  }
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
