/**
 * scripts/query_may28.mjs
 * Query all May 28 MLB games from DB with full field audit.
 */
import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[query_may28]';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error(`${TAG} [ERROR] DATABASE_URL not set`); process.exit(1); }

  const conn = await createConnection(url);
  console.log(`${TAG} [INPUT] Querying games WHERE gameDate='2026-05-28' AND sport='MLB'`);

  const [rows] = await conn.execute(`
    SELECT id, awayTeam, homeTeam, gameDate, startTimeEst,
           awayML, homeML,
           awayBookSpread, homeBookSpread, awaySpreadOdds, homeSpreadOdds,
           awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
           bookTotal, overOdds, underOdds,
           modelAwayML, modelHomeML, modelSpreadClamped, modelTotalClamped,
           modelAwayScore, modelHomeScore, modelAwayWinPct, modelHomeWinPct,
           modelOverRate, modelUnderRate, modelCoverDirection,
           publishedToFeed, publishedModel, sport, gameType,
           awayStartingPitcher, homeStartingPitcher,
           awayPitcherConfirmed, homePitcherConfirmed,
           mlbGamePk, venue
    FROM games
    WHERE gameDate = '2026-05-28' AND sport = 'MLB'
    ORDER BY startTimeEst ASC
  `);

  console.log(`${TAG} [OUTPUT] May 28 MLB games found: ${rows.length}`);
  rows.forEach((r, i) => {
    console.log(`\n${TAG} [GAME ${i+1}/${rows.length}] id=${r.id} | ${r.awayTeam} @ ${r.homeTeam}`);
    console.log(`  time=${r.startTimeEst} | type=${r.gameType} | pk=${r.mlbGamePk} | venue=${r.venue}`);
    console.log(`  PITCHERS: away=${r.awayStartingPitcher}(conf=${r.awayPitcherConfirmed}) home=${r.homeStartingPitcher}(conf=${r.homePitcherConfirmed})`);
    console.log(`  BOOK ML:  away=${r.awayML}  home=${r.homeML}`);
    console.log(`  BOOK RL:  away=${r.awayRunLine}(${r.awayRunLineOdds})  home=${r.homeRunLine}(${r.homeRunLineOdds})`);
    console.log(`  BOOK O/U: ${r.bookTotal}  over=${r.overOdds}  under=${r.underOdds}`);
    console.log(`  BOOK SPREAD: away=${r.awayBookSpread}(${r.awaySpreadOdds})  home=${r.homeBookSpread}(${r.homeSpreadOdds})`);
    console.log(`  MODEL SCORES: away=${r.modelAwayScore}  home=${r.modelHomeScore}`);
    console.log(`  MODEL ML: away=${r.modelAwayML}  home=${r.modelHomeML}`);
    console.log(`  MODEL:    spread=${r.modelSpreadClamped}  total=${r.modelTotalClamped}  coverDir=${r.modelCoverDirection}`);
    console.log(`  MODEL RATES: awayWin=${r.modelAwayWinPct}  homeWin=${r.modelHomeWinPct}  over=${r.modelOverRate}  under=${r.modelUnderRate}`);
    console.log(`  STATUS:   publishedToFeed=${r.publishedToFeed}  publishedModel=${r.publishedModel}`);
  });

  await conn.end();
  console.log(`\n${TAG} [VERIFY] Query complete.`);
}

main().catch(e => { console.error(`${TAG} [ERROR]`, e.message); process.exit(1); });
