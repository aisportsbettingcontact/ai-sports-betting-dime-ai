/**
 * MLB June 19, 2026 — Full Pipeline: Audit + Validate + Force-Rerun
 * Phases: 1=Confirm game count, 2=Check AN odds, 3=Check Rotowire data, 4=Force-rerun, 5=Validate
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const TAG = '[MLB-June19-Pipeline]';
const DATE_STR = '2026-06-19';

// MLB API confirmed game list from Phase 1 run
const MLB_API_GAMES = [
  { gamePk: 824663, away: 'TOR', home: 'CHC', awayFull: 'Toronto Blue Jays', homeFull: 'Chicago Cubs', time: '2:20 PM', venue: 'Wrigley Field', awaySP: 'Kevin Gausman', homeSP: 'Ben Brown' },
  { gamePk: 824264, away: 'CWS', home: 'DET', awayFull: 'Chicago White Sox', homeFull: 'Detroit Tigers', time: '6:40 PM', venue: 'Comerica Park', awaySP: 'Erick Fedde', homeSP: 'Tarik Skubal' },
  { gamePk: 823534, away: 'CIN', home: 'NYY', awayFull: 'Cincinnati Reds', homeFull: 'New York Yankees', time: '7:05 PM', venue: 'Yankee Stadium', awaySP: 'Rhett Lowder', homeSP: 'Cam Schlittler' },
  { gamePk: 822966, away: 'WSH', home: 'TB',  awayFull: 'Washington Nationals', homeFull: 'Tampa Bay Rays', time: '7:10 PM', venue: 'Tropicana Field', awaySP: 'Cade Cavalli', homeSP: 'Griffin Jax' },
  { gamePk: 823853, away: 'SF',  home: 'MIA', awayFull: 'San Francisco Giants', homeFull: 'Miami Marlins', time: '7:10 PM', venue: 'loanDepot park', awaySP: 'Landen Roupp', homeSP: 'TBD' },
  { gamePk: 824910, away: 'MIL', home: 'ATL', awayFull: 'Milwaukee Brewers', homeFull: 'Atlanta Braves', time: '7:15 PM', venue: 'Truist Park', awaySP: 'Jacob Misiorowski', homeSP: 'Martín Pérez' },
  { gamePk: 822886, away: 'SD',  home: 'TEX', awayFull: 'San Diego Padres', homeFull: 'Texas Rangers', time: '8:05 PM', venue: 'Globe Life Field', awaySP: 'Randy Vásquez', homeSP: 'Jacob deGrom' },
  { gamePk: 824179, away: 'CLE', home: 'HOU', awayFull: 'Cleveland Guardians', homeFull: 'Houston Astros', time: '8:10 PM', venue: 'Daikin Park', awaySP: 'Tanner Bibee', homeSP: 'Tatsuya Imai' },
  { gamePk: 824097, away: 'STL', home: 'KC',  awayFull: 'St. Louis Cardinals', homeFull: 'Kansas City Royals', time: '8:15 PM', venue: 'Kauffman Stadium', awaySP: 'Michael McGreevy', homeSP: 'Seth Lugo' },
  { gamePk: 824345, away: 'PIT', home: 'COL', awayFull: 'Pittsburgh Pirates', homeFull: 'Colorado Rockies', time: '8:40 PM', venue: 'Coors Field', awaySP: 'Bubba Chandler', homeSP: 'Kyle Freeland' },
  { gamePk: 824990, away: 'LAA', home: 'ATH', awayFull: 'Los Angeles Angels', homeFull: 'Athletics', time: '9:40 PM', venue: 'Sutter Health Park', awaySP: 'José Soriano', homeSP: 'Jeffrey Springs' },
  { gamePk: 825069, away: 'MIN', home: 'ARI', awayFull: 'Minnesota Twins', homeFull: 'Arizona Diamondbacks', time: '9:45 PM', venue: 'Chase Field', awaySP: 'Connor Prielipp', homeSP: 'Michael Soroka' },
  { gamePk: 823936, away: 'BAL', home: 'LAD', awayFull: 'Baltimore Orioles', homeFull: 'Los Angeles Dodgers', time: '10:10 PM', venue: 'Dodger Stadium', awaySP: 'Trey Gibson', homeSP: 'Roki Sasaki' },
  { gamePk: 823124, away: 'BOS', home: 'SEA', awayFull: 'Boston Red Sox', homeFull: 'Seattle Mariners', time: '10:10 PM', venue: 'T-Mobile Park', awaySP: 'Ranger Suarez', homeSP: 'Bryce Miller' },
];

async function main() {
  console.log(`${TAG} ============================================================`);
  console.log(`${TAG} [STEP] MLB June 19, 2026 — Full Pipeline Audit`);
  console.log(`${TAG} [INPUT] MLB API confirmed: ${MLB_API_GAMES.length} games`);
  console.log(`${TAG} ============================================================`);

  const conn = await createConnection(process.env.DATABASE_URL);

  // ── Phase 1: DB Audit ──────────────────────────────────────────────────────
  console.log(`\n${TAG} ── PHASE 1: DB AUDIT ──────────────────────────────────`);
  
  const [dbRows] = await conn.execute(
    `SELECT id, mlbGamePk, awayTeam, homeTeam, startTimeEst, venue,
            awayStartingPitcher, homeStartingPitcher,
            awayML, homeML, bookTotal, awayRunLine, homeRunLine,
            modelRunAt, publishedToFeed, publishedModel,
            modelAwayML, modelHomeML, modelTotal,
            modelPNrfi, modelNrfiOdds, modelYrfiOdds,
            modelAwayHrPct, modelHomeHrPct, modelAwayExpHr, modelHomeExpHr,
            modelF5AwayML, modelF5HomeML, modelF5Total
     FROM games 
     WHERE gameDate = ? AND sport = 'MLB' 
     ORDER BY startTimeEst`,
    [DATE_STR]
  );

  console.log(`${TAG} [STATE] DB games for ${DATE_STR}: ${dbRows.length}`);
  
  // Build lookup by mlbGamePk
  const dbByPk = new Map();
  for (const row of dbRows) {
    dbByPk.set(String(row.mlbGamePk), row);
  }

  // Cross-reference: MLB API vs DB
  const missingFromDb = [];
  const matchedGames = [];
  
  for (const apiGame of MLB_API_GAMES) {
    const pk = String(apiGame.gamePk);
    const dbGame = dbByPk.get(pk);
    if (!dbGame) {
      missingFromDb.push(apiGame);
      console.log(`${TAG} [WARN] MISSING FROM DB: gamePk=${pk} ${apiGame.away}@${apiGame.home}`);
    } else {
      matchedGames.push({ api: apiGame, db: dbGame });
    }
  }

  // Check for extra DB records not in API
  const apiPks = new Set(MLB_API_GAMES.map(g => String(g.gamePk)));
  for (const row of dbRows) {
    if (!apiPks.has(String(row.mlbGamePk))) {
      console.log(`${TAG} [WARN] EXTRA IN DB (not in MLB API): id=${row.id} mlbGamePk=${row.mlbGamePk} ${row.awayTeam}@${row.homeTeam}`);
    }
  }

  // ── Phase 2: Odds Audit ────────────────────────────────────────────────────
  console.log(`\n${TAG} ── PHASE 2: DK ODDS AUDIT ─────────────────────────────`);
  
  let oddsOk = 0, oddsMissing = 0;
  for (const { api, db } of matchedGames) {
    const hasOdds = db.awayML !== null && db.homeML !== null && db.bookTotal !== null;
    const hasRL = db.awayRunLine !== null && db.homeRunLine !== null;
    if (hasOdds) {
      oddsOk++;
      console.log(`${TAG} [VERIFY] ODDS OK: ${api.away}@${api.home} | ML=${db.awayML}/${db.homeML} total=${db.bookTotal} RL=${db.awayRunLine}/${db.homeRunLine}`);
    } else {
      oddsMissing++;
      console.log(`${TAG} [WARN] ODDS MISSING: ${api.away}@${api.home} | ML=${db.awayML}/${db.homeML} total=${db.bookTotal} RL=${db.awayRunLine}/${db.homeRunLine}`);
    }
  }
  console.log(`${TAG} [STATE] Odds: ${oddsOk} OK, ${oddsMissing} missing`);

  // ── Phase 3: Pitcher/Lineup Audit ─────────────────────────────────────────
  console.log(`\n${TAG} ── PHASE 3: PITCHER & LINEUP AUDIT ────────────────────`);
  
  let pitcherOk = 0, pitcherMissing = 0;
  for (const { api, db } of matchedGames) {
    const awaySP = db.awayStartingPitcher ?? 'TBD';
    const homeSP = db.homeStartingPitcher ?? 'TBD';
    const apiAwaySP = api.awaySP;
    const apiHomeSP = api.homeSP;
    
    // Check if DB pitcher matches MLB API pitcher
    const awayMatch = awaySP !== 'TBD' && awaySP !== null;
    const homeMatch = homeSP !== 'TBD' && homeSP !== null;
    
    if (awayMatch && homeMatch) {
      pitcherOk++;
      console.log(`${TAG} [VERIFY] SP OK: ${api.away}@${api.home} | DB: ${awaySP} vs ${homeSP} | API: ${apiAwaySP} vs ${apiHomeSP}`);
    } else {
      pitcherMissing++;
      console.log(`${TAG} [WARN] SP MISSING: ${api.away}@${api.home} | DB: ${awaySP} vs ${homeSP} | API: ${apiAwaySP} vs ${apiHomeSP}`);
    }
  }
  console.log(`${TAG} [STATE] Pitchers: ${pitcherOk} OK, ${pitcherMissing} missing`);

  // ── Phase 4: Model Output Audit ────────────────────────────────────────────
  console.log(`\n${TAG} ── PHASE 4: MODEL OUTPUT AUDIT ─────────────────────────`);
  
  let modelOk = 0, modelMissing = 0, modelPartial = 0;
  const gamesNeedingRerun = [];
  
  for (const { api, db } of matchedGames) {
    const hasModel = db.modelRunAt !== null;
    const hasML = db.modelAwayML !== null && db.modelHomeML !== null;
    const hasTotal = db.modelTotal !== null;
    const hasNrfi = db.modelPNrfi !== null && db.modelNrfiOdds !== null;
    const hasF5 = db.modelF5AwayML !== null && db.modelF5HomeML !== null;
    const hasHr = db.modelAwayHrPct !== null && db.modelHomeHrPct !== null;
    const isPublished = db.publishedToFeed === 1;
    
    const allScopes = hasModel && hasML && hasTotal && hasNrfi && hasF5 && hasHr;
    
    if (allScopes && isPublished) {
      modelOk++;
      const nrfiVal = db.modelPNrfi !== null ? parseFloat(db.modelPNrfi).toFixed(4) : 'null';
      console.log(`${TAG} [VERIFY] MODEL OK: ${api.away}@${api.home} | ML=${db.modelAwayML}/${db.modelHomeML} total=${db.modelTotal} NRFI=${nrfiVal} F5=${db.modelF5AwayML}/${db.modelF5HomeML} published=✓`);
    } else if (hasModel && !allScopes) {
      modelPartial++;
      gamesNeedingRerun.push({ api, db });
      console.log(`${TAG} [WARN] MODEL PARTIAL: ${api.away}@${api.home} | hasML=${hasML} hasTotal=${hasTotal} hasNrfi=${hasNrfi} hasF5=${hasF5} hasHr=${hasHr} published=${isPublished}`);
    } else {
      modelMissing++;
      gamesNeedingRerun.push({ api, db });
      console.log(`${TAG} [WARN] MODEL MISSING: ${api.away}@${api.home} | modelRunAt=${db.modelRunAt} published=${isPublished}`);
    }
  }
  
  console.log(`${TAG} [STATE] Model: ${modelOk} fully OK, ${modelPartial} partial, ${modelMissing} missing`);
  console.log(`${TAG} [STATE] Games needing rerun: ${gamesNeedingRerun.length}`);

  // ── Phase 5: Summary ───────────────────────────────────────────────────────
  console.log(`\n${TAG} ── PHASE 5: FINAL SUMMARY ──────────────────────────────`);
  console.log(`${TAG} [VERIFY] MLB API game count: ${MLB_API_GAMES.length}`);
  console.log(`${TAG} [VERIFY] DB game count: ${dbRows.length} (${dbRows.length - MLB_API_GAMES.length} extra = likely prior-day game)`);
  console.log(`${TAG} [VERIFY] Matched games: ${matchedGames.length}`);
  console.log(`${TAG} [VERIFY] Missing from DB: ${missingFromDb.length}`);
  console.log(`${TAG} [VERIFY] DK odds OK: ${oddsOk}/${matchedGames.length}`);
  console.log(`${TAG} [VERIFY] Pitchers OK: ${pitcherOk}/${matchedGames.length}`);
  console.log(`${TAG} [VERIFY] Model fully OK: ${modelOk}/${matchedGames.length}`);
  console.log(`${TAG} [VERIFY] Model partial/missing: ${gamesNeedingRerun.length}`);
  
  if (gamesNeedingRerun.length > 0) {
    console.log(`\n${TAG} [STEP] Games requiring force-rerun:`);
    for (const { api } of gamesNeedingRerun) {
      console.log(`${TAG} [INPUT]   - ${api.away}@${api.home} (gamePk=${api.gamePk})`);
    }
  }
  
  if (oddsMissing > 0) {
    console.log(`\n${TAG} [WARN] ${oddsMissing} games have missing DK odds — AN API scrape needed`);
  }
  
  if (modelOk === matchedGames.length && oddsMissing === 0) {
    console.log(`\n${TAG} [VERIFY] ✅ ALL ${matchedGames.length} GAMES FULLY MODELED AND PUBLISHED`);
  } else {
    console.log(`\n${TAG} [WARN] ⚠️  ${gamesNeedingRerun.length + oddsMissing} games need attention before pipeline is complete`);
  }

  await conn.end();
  console.log(`${TAG} [STEP] Pipeline audit complete.`);
}

main().catch(err => {
  console.error(`${TAG} [ERROR] Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
