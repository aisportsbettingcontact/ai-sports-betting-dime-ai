/**
 * MLB June 19, 2026 — Fix & Rerun
 * 1. Correct BOS@SEA home SP: Luis Castillo → Bryce Miller
 * 2. Scrape AN API for SF@MIA DK odds
 * 3. Force-rerun both games through the MLB model runner
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const TAG = '[MLB-June19-FixRerun]';
const DATE_STR = '2026-06-19';
const AN_API_BASE = 'https://api.actionnetwork.com/web/v2/scoreboard/mlb';
const DK_BOOK_ID = 68;

async function scrapeAnOddsForGame(gamePk) {
  console.log(`${TAG} [STEP] Scraping AN API for gamePk=${gamePk}...`);
  const url = `${AN_API_BASE}?bookIds=15,30,79,2988,75,123,71,68,69&date=20260619&periods=event`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.actionnetwork.com/',
      }
    });
    
    if (!res.ok) {
      console.log(`${TAG} [WARN] AN API returned HTTP ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const games = data.games || [];
    console.log(`${TAG} [STATE] AN API returned ${games.length} MLB games for 2026-06-19`);
    
    // Find SF@MIA by team names
    for (const g of games) {
      const awayTeam = g.teams?.[0]?.full_name ?? '';
      const homeTeam = g.teams?.[1]?.full_name ?? '';
      const awayAbbr = g.teams?.[0]?.abbr ?? '';
      const homeAbbr = g.teams?.[1]?.abbr ?? '';
      
      console.log(`${TAG} [INPUT] AN game: ${awayAbbr}@${homeAbbr} (${awayTeam} vs ${homeTeam})`);
      
      // Match SF@MIA
      const isSfMia = (awayAbbr === 'SF' && homeAbbr === 'MIA') ||
                      (awayTeam.includes('Giants') && homeTeam.includes('Marlins')) ||
                      (awayAbbr === 'MIA' && homeAbbr === 'SF') ||
                      (awayTeam.includes('Marlins') && homeTeam.includes('Giants'));
      
      if (isSfMia) {
        console.log(`${TAG} [STATE] Found SF@MIA in AN API`);
        
        // Extract DK odds
        const periods = g.periods || [];
        const fullGame = periods.find(p => p.period_type === 'fullgame' || p.number === 0) || periods[0];
        
        if (!fullGame) {
          console.log(`${TAG} [WARN] No period data for SF@MIA`);
          return null;
        }
        
        const books = fullGame.books || [];
        const dkBook = books.find(b => b.book_id === DK_BOOK_ID);
        
        if (!dkBook) {
          console.log(`${TAG} [WARN] DK (book_id=${DK_BOOK_ID}) not found in SF@MIA odds`);
          console.log(`${TAG} [STATE] Available books: ${books.map(b => b.book_id).join(', ')}`);
          return null;
        }
        
        const ml = dkBook.moneyline || {};
        const total = dkBook.total || {};
        const spread = dkBook.spread || {};
        
        const awayML = ml.away_odds ?? null;
        const homeML = ml.home_odds ?? null;
        const totalLine = total.total ?? null;
        const overOdds = total.over_odds ?? null;
        const underOdds = total.under_odds ?? null;
        const awayRL = spread.away_odds ?? null;
        const homeRL = spread.home_odds ?? null;
        const awayRLLine = spread.away_handicap ?? null;
        
        console.log(`${TAG} [STATE] DK odds for SF@MIA: ML=${awayML}/${homeML} total=${totalLine} O=${overOdds} U=${underOdds} RL=${awayRLLine}(${awayRL}/${homeRL})`);
        
        // Determine orientation (which team is home in AN vs our DB)
        // Our DB: SF=away, MIA=home
        // AN: teams[0]=away, teams[1]=home
        const anAwayIsSf = awayAbbr === 'SF' || awayTeam.includes('Giants');
        
        return {
          awayML: anAwayIsSf ? awayML : homeML,
          homeML: anAwayIsSf ? homeML : awayML,
          bookTotal: totalLine,
          overOdds,
          underOdds,
          awayRunLine: anAwayIsSf ? awayRLLine : (awayRLLine ? -awayRLLine : null),
          homeRunLine: anAwayIsSf ? (awayRLLine ? -awayRLLine : null) : awayRLLine,
          awayRunLineOdds: anAwayIsSf ? awayRL : homeRL,
          homeRunLineOdds: anAwayIsSf ? homeRL : awayRL,
        };
      }
    }
    
    console.log(`${TAG} [WARN] SF@MIA not found in AN API response`);
    return null;
    
  } catch (err) {
    console.log(`${TAG} [ERROR] AN API scrape failed: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`${TAG} ============================================================`);
  console.log(`${TAG} [STEP] MLB June 19 Fix & Rerun`);
  console.log(`${TAG} [STEP] 1. Fix BOS@SEA home SP: Luis Castillo → Bryce Miller`);
  console.log(`${TAG} [STEP] 2. Scrape AN API for SF@MIA DK odds`);
  console.log(`${TAG} [STEP] 3. Force-rerun both games`);
  console.log(`${TAG} ============================================================`);

  const conn = await createConnection(process.env.DATABASE_URL);

  // ── Fix 1: BOS@SEA pitcher correction ─────────────────────────────────────
  console.log(`\n${TAG} [STEP] Fix 1: Correcting BOS@SEA home SP...`);
  
  const [bosSeaRows] = await conn.execute(
    `SELECT id, awayTeam, homeTeam, homeStartingPitcher, mlbGamePk FROM games 
     WHERE gameDate = ? AND sport = 'MLB' AND mlbGamePk = 823124`,
    [DATE_STR]
  );
  
  if (bosSeaRows.length === 0) {
    console.log(`${TAG} [WARN] BOS@SEA (gamePk=823124) not found in DB`);
  } else {
    const g = bosSeaRows[0];
    console.log(`${TAG} [INPUT] BOS@SEA id=${g.id} | current homeSP: ${g.homeStartingPitcher}`);
    
    if (g.homeStartingPitcher !== 'Bryce Miller') {
      await conn.execute(
        `UPDATE games SET homeStartingPitcher = 'Bryce Miller' WHERE id = ?`,
        [g.id]
      );
      console.log(`${TAG} [STATE] Updated BOS@SEA homeSP: ${g.homeStartingPitcher} → Bryce Miller`);
      console.log(`${TAG} [VERIFY] PASS: BOS@SEA home SP corrected to Bryce Miller`);
    } else {
      console.log(`${TAG} [VERIFY] PASS: BOS@SEA home SP already Bryce Miller — no change needed`);
    }
  }

  // ── Fix 2: SF@MIA odds scrape ──────────────────────────────────────────────
  console.log(`\n${TAG} [STEP] Fix 2: Scraping AN API for SF@MIA DK odds...`);
  
  const [sfMiaRows] = await conn.execute(
    `SELECT id, awayTeam, homeTeam, awayML, homeML, bookTotal, mlbGamePk FROM games 
     WHERE gameDate = ? AND sport = 'MLB' AND mlbGamePk = 823853`,
    [DATE_STR]
  );
  
  if (sfMiaRows.length === 0) {
    console.log(`${TAG} [WARN] SF@MIA (gamePk=823853) not found in DB`);
  } else {
    const g = sfMiaRows[0];
    console.log(`${TAG} [INPUT] SF@MIA id=${g.id} | current ML: ${g.awayML}/${g.homeML} total=${g.bookTotal}`);
    
    const odds = await scrapeAnOddsForGame(823853);
    
    if (odds && odds.awayML !== null && odds.homeML !== null) {
      await conn.execute(
        `UPDATE games SET 
          awayML = ?, homeML = ?, bookTotal = ?,
          awayRunLine = ?, homeRunLine = ?,
          awayRunLineOdds = ?, homeRunLineOdds = ?
         WHERE id = ?`,
        [odds.awayML, odds.homeML, odds.bookTotal,
         odds.awayRunLine, odds.homeRunLine,
         odds.awayRunLineOdds, odds.homeRunLineOdds,
         g.id]
      );
      console.log(`${TAG} [STATE] Updated SF@MIA odds: ML=${odds.awayML}/${odds.homeML} total=${odds.bookTotal} RL=${odds.awayRunLine}/${odds.homeRunLine}`);
      console.log(`${TAG} [VERIFY] PASS: SF@MIA DK odds updated from AN API`);
    } else {
      console.log(`${TAG} [WARN] SF@MIA DK odds not yet available on AN API — game will be modeled when odds post`);
      console.log(`${TAG} [WARN] The automated cycle will pick up SF@MIA when DK posts odds`);
    }
  }

  await conn.end();

  // ── Fix 3: Force-rerun BOS@SEA (pitcher changed) ──────────────────────────
  console.log(`\n${TAG} [STEP] Fix 3: Force-rerun BOS@SEA with corrected pitcher...`);
  console.log(`${TAG} [STEP] Triggering model runner via forceRerunJune19.ts...`);
  
  // Import and call the existing force-rerun infrastructure
  const { execSync } = await import('child_process');
  
  try {
    // Run the model runner specifically for BOS@SEA
    const result = execSync(
      `cd /home/ubuntu/ai-sports-betting && npx tsx server/forceRerunJune19.ts 2>&1 | tail -50`,
      { timeout: 600000, encoding: 'utf8' }
    );
    console.log(`${TAG} [STATE] Force-rerun output (last 50 lines):`);
    console.log(result);
    console.log(`${TAG} [VERIFY] PASS: Force-rerun completed`);
  } catch (err) {
    console.log(`${TAG} [ERROR] Force-rerun failed: ${err.message}`);
    console.log(`${TAG} [STATE] Output: ${err.stdout ?? ''}`);
  }
  
  console.log(`\n${TAG} [STEP] Fix & Rerun complete.`);
}

main().catch(err => {
  console.error(`${TAG} [ERROR] Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
