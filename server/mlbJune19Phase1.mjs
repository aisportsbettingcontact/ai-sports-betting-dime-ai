/**
 * MLB June 19, 2026 — Phase 1: Game Count Confirmation via MLB Stats API
 * Cross-references MLB API schedule with our DB to confirm exact game count
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const TAG = '[MLB-June19-Phase1]';
const DATE_STR = '2026-06-19';
const MLB_API_DATE = '06/19/2026';

async function main() {
  console.log(`${TAG} ============================================================`);
  console.log(`${TAG} [STEP] Phase 1: Confirming June 19, 2026 MLB game count`);
  console.log(`${TAG} [STEP] Source: MLB Stats API https://statsapi.mlb.com/api/v1/schedule`);
  console.log(`${TAG} ============================================================`);

  // ── Step 1: MLB Stats API ──────────────────────────────────────────────────
  console.log(`${TAG} [STEP] Fetching MLB Stats API schedule for ${DATE_STR}...`);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${MLB_API_DATE}&hydrate=probablePitcher(note),venue,weather,broadcasts(all)`;
  
  let apiGames = [];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    
    const dates = data.dates || [];
    if (dates.length === 0) {
      console.log(`${TAG} [WARN] MLB API returned 0 dates for ${DATE_STR}`);
    } else {
      apiGames = dates[0].games || [];
    }
    
    console.log(`${TAG} [STATE] MLB API total games on ${DATE_STR}: ${apiGames.length}`);
    console.log(`${TAG} [STATE] MLB API totalGames field: ${dates[0]?.totalGames ?? 'N/A'}`);
    
    // Print each game from MLB API
    console.log(`${TAG} [STATE] ── MLB API Game List ──────────────────────────────`);
    for (let i = 0; i < apiGames.length; i++) {
      const g = apiGames[i];
      const away = g.teams?.away?.team?.name ?? 'Unknown';
      const home = g.teams?.home?.team?.name ?? 'Unknown';
      const awayAbbr = g.teams?.away?.team?.abbreviation ?? '???';
      const homeAbbr = g.teams?.home?.team?.abbreviation ?? '???';
      const gamePk = g.gamePk;
      const gameTime = g.gameDate ? new Date(g.gameDate).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) : 'TBD';
      const venue = g.venue?.name ?? 'Unknown';
      const status = g.status?.detailedState ?? 'Unknown';
      const awayPitcher = g.teams?.away?.probablePitcher?.fullName ?? 'TBD';
      const homePitcher = g.teams?.home?.probablePitcher?.fullName ?? 'TBD';
      const gameType = g.gameType ?? 'R'; // R=Regular, D=Doubleheader
      const doubleHeader = g.doubleHeader ?? 'N';
      const gameNumber = g.gameNumber ?? 1;
      
      console.log(`${TAG} [INPUT] Game ${i+1}: gamePk=${gamePk} | ${awayAbbr}@${homeAbbr} | ${gameTime} ET | ${venue} | status=${status} | type=${gameType} DH=${doubleHeader} #${gameNumber}`);
      console.log(`${TAG} [INPUT]   Away: ${away} | SP: ${awayPitcher}`);
      console.log(`${TAG} [INPUT]   Home: ${home} | SP: ${homePitcher}`);
    }
    
  } catch (err) {
    console.error(`${TAG} [ERROR] MLB API fetch failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 2: DB Cross-Reference ─────────────────────────────────────────────
  console.log(`${TAG} [STEP] Cross-referencing with DB games for ${DATE_STR}...`);
  const conn = await createConnection(process.env.DATABASE_URL);
  
  const [dbGames] = await conn.execute(
    `SELECT id, awayTeam, homeTeam, awayTeamAbbr, homeTeamAbbr, startTimeEst, 
            awayStartingPitcher, homeStartingPitcher, venue, gamePk,
            awayML, homeML, bookTotal, awayRunLine, homeRunLine,
            modelRunAt, publishedToFeed, publishedModel
     FROM games 
     WHERE gameDate = ? AND sport = 'MLB' 
     ORDER BY startTimeEst`,
    [DATE_STR]
  );
  
  console.log(`${TAG} [STATE] DB games for ${DATE_STR}: ${dbGames.length}`);
  console.log(`${TAG} [STATE] ── DB Game List ──────────────────────────────────`);
  
  for (let i = 0; i < dbGames.length; i++) {
    const g = dbGames[i];
    const hasOdds = g.awayML !== null;
    const hasModel = g.modelRunAt !== null;
    const isPublished = g.publishedToFeed === 1;
    console.log(`${TAG} [INPUT] DB Game ${i+1}: id=${g.id} gamePk=${g.gamePk} | ${g.awayTeamAbbr}@${g.homeTeamAbbr} | ${g.startTimeEst} | venue=${g.venue}`);
    console.log(`${TAG} [INPUT]   SP: ${g.awayStartingPitcher ?? 'TBD'} vs ${g.homeStartingPitcher ?? 'TBD'}`);
    console.log(`${TAG} [INPUT]   Odds: ML=${g.awayML}/${g.homeML} total=${g.bookTotal} RL=${g.awayRunLine}/${g.homeRunLine}`);
    console.log(`${TAG} [INPUT]   Status: hasOdds=${hasOdds} hasModel=${hasModel} published=${isPublished}`);
  }
  
  // ── Step 3: Reconciliation ─────────────────────────────────────────────────
  console.log(`${TAG} [STEP] Reconciliation: MLB API=${apiGames.length} vs DB=${dbGames.length}`);
  
  // Map API games by gamePk for cross-reference
  const apiByPk = new Map(apiGames.map(g => [String(g.gamePk), g]));
  const dbByPk = new Map(dbGames.map(g => [String(g.gamePk), g]));
  
  const missingFromDb = [];
  const extraInDb = [];
  
  for (const ag of apiGames) {
    const pk = String(ag.gamePk);
    if (!dbByPk.has(pk)) {
      missingFromDb.push(ag);
      const away = ag.teams?.away?.team?.abbreviation ?? '???';
      const home = ag.teams?.home?.team?.abbreviation ?? '???';
      console.log(`${TAG} [WARN] MISSING FROM DB: gamePk=${pk} ${away}@${home}`);
    }
  }
  
  for (const dg of dbGames) {
    const pk = String(dg.gamePk);
    if (!apiByPk.has(pk)) {
      extraInDb.push(dg);
      console.log(`${TAG} [WARN] IN DB BUT NOT IN API: gamePk=${pk} ${dg.awayTeamAbbr}@${dg.homeTeamAbbr} id=${dg.id}`);
    }
  }
  
  // ── Step 4: Summary ────────────────────────────────────────────────────────
  console.log(`${TAG} [VERIFY] ══════════════════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] MLB API confirmed game count: ${apiGames.length}`);
  console.log(`${TAG} [VERIFY] DB game count: ${dbGames.length}`);
  console.log(`${TAG} [VERIFY] Missing from DB: ${missingFromDb.length}`);
  console.log(`${TAG} [VERIFY] Extra in DB (not in API): ${extraInDb.length}`);
  
  const gamesWithOdds = dbGames.filter(g => g.awayML !== null).length;
  const gamesWithModel = dbGames.filter(g => g.modelRunAt !== null).length;
  const gamesPublished = dbGames.filter(g => g.publishedToFeed === 1).length;
  
  console.log(`${TAG} [VERIFY] DB games with DK odds: ${gamesWithOdds}/${dbGames.length}`);
  console.log(`${TAG} [VERIFY] DB games with model run: ${gamesWithModel}/${dbGames.length}`);
  console.log(`${TAG} [VERIFY] DB games published: ${gamesPublished}/${dbGames.length}`);
  
  if (missingFromDb.length > 0) {
    console.log(`${TAG} [WARN] ACTION NEEDED: ${missingFromDb.length} games in MLB API not in DB — must be inserted before modeling`);
  } else {
    console.log(`${TAG} [VERIFY] PASS: All MLB API games are present in DB`);
  }
  
  if (apiGames.length === dbGames.length) {
    console.log(`${TAG} [VERIFY] PASS: Game counts match (${apiGames.length})`);
  } else {
    console.log(`${TAG} [VERIFY] MISMATCH: API=${apiGames.length} DB=${dbGames.length} — investigation required`);
  }
  
  await conn.end();
  console.log(`${TAG} [STEP] Phase 1 complete.`);
  
  // Return summary for next phase
  return {
    apiCount: apiGames.length,
    dbCount: dbGames.length,
    missingFromDb,
    apiGames,
    dbGames
  };
}

main().catch(err => {
  console.error(`${TAG} [ERROR] Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
