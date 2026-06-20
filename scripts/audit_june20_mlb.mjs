/**
 * audit_june20_mlb.mjs
 * Full DB audit of June 20, 2026 MLB games:
 * - Game records in games table
 * - DK odds presence
 * - SP assignments
 * - modelRunAt status
 * - publishedToFeed status
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const TAG = '[MLB_JUNE20_AUDIT]';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log(`${TAG} Connected to DB`);

  // 1. Check games table for June 20
  const [games] = await conn.query(`
    SELECT 
      id, mlbGamePk, awayTeam, homeTeam, gameDate, startTimeEst,
      awayML, homeML, awayRunLine, homeRunLine, bookTotal,
      awayStartingPitcher, homeStartingPitcher,
      awayPitcherConfirmed, homePitcherConfirmed,
      modelRunAt, publishedToFeed, publishedModel,
      gameStatus
    FROM games
    WHERE gameDate = '2026-06-20' AND sport = 'MLB'
    ORDER BY startTimeEst ASC
  `);

  console.log(`\n${TAG} [STATE] June 20 MLB games in DB: ${games.length}`);
  console.log(`${TAG} Expected: 14`);
  console.log();

  let missingOdds = 0, missingModel = 0, missingAwaySP = 0, missingHomeSP = 0, notPublished = 0;

  for (const g of games) {
    const hasOdds = g.awayML != null && g.homeML != null;
    const hasModel = g.modelRunAt != null;
    const hasAwaySP = g.awayStartingPitcher && g.awayStartingPitcher !== 'TBD';
    const hasHomeSP = g.homeStartingPitcher && g.homeStartingPitcher !== 'TBD';
    const isPublished = g.publishedToFeed === 1;

    if (!hasOdds) missingOdds++;
    if (!hasModel) missingModel++;
    if (!hasAwaySP) missingAwaySP++;
    if (!hasHomeSP) missingHomeSP++;
    if (!isPublished) notPublished++;

    const oddsStr = hasOdds ? `ML=${g.awayML}/${g.homeML} RL=${g.awayRunLine}/${g.homeRunLine} Total=${g.bookTotal}` : 'NO ODDS';
    const modelStr = hasModel ? `modelRunAt=${g.modelRunAt}` : 'NOT MODELED';
    const awaySPConf = g.awayPitcherConfirmed ? '(CONFIRMED)' : '(expected)';
    const homeSPConf = g.homePitcherConfirmed ? '(CONFIRMED)' : '(expected)';
    const spStr = `SP: ${g.awayStartingPitcher||'TBD'}${awaySPConf}(away) vs ${g.homeStartingPitcher||'TBD'}${homeSPConf}(home)`;
    const pubStr = isPublished ? 'PUBLISHED' : 'NOT_PUBLISHED';

    console.log(`${TAG} [GAME] id=${g.id} gamePk=${g.mlbGamePk} | ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst}`);
    console.log(`         Odds: ${oddsStr}`);
    console.log(`         ${spStr}`);
    console.log(`         Model: ${modelStr} | ${pubStr}`);
    console.log();
  }

  console.log(`${TAG} ─── SUMMARY ───────────────────────────────────────`);
  console.log(`${TAG} Total games in DB:    ${games.length}/14`);
  console.log(`${TAG} Missing DK odds:      ${missingOdds}`);
  console.log(`${TAG} Missing model:        ${missingModel}`);
  console.log(`${TAG} Missing away SP:      ${missingAwaySP}`);
  console.log(`${TAG} Missing home SP:      ${missingHomeSP}`);
  console.log(`${TAG} Not published:        ${notPublished}`);

  if (games.length < 14) {
    console.log(`${TAG} [WARN] Only ${games.length} games in DB — ${14 - games.length} missing. MLB schedule sync needed.`);
  }
  if (missingOdds > 0) {
    console.log(`${TAG} [WARN] ${missingOdds} games missing DK odds — AN API scrape needed.`);
  }
  if (missingModel > 0) {
    console.log(`${TAG} [WARN] ${missingModel} games not yet modeled.`);
  }

  await conn.end();
  console.log(`\n${TAG} [VERIFY] Audit complete.`);
}

main().catch(e => { console.error(`${TAG} [ERROR]`, e.message); process.exit(1); });
