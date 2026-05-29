/**
 * audit_may29.mjs
 * Full DB audit for May 29, 2026 MLB games.
 * Prints every relevant field with structured [INPUT]/[STATE]/[VERIFY] tags.
 */
import { createConnection } from '/home/ubuntu/ai-sports-betting/node_modules/mysql2/promise.js';

const conn = await createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`
  SELECT
    g.id, g.awayTeam, g.homeTeam, g.startTimeEst,
    g.awayML, g.homeML,
    g.awayRunLine, g.homeRunLine, g.awayRunLineOdds, g.homeRunLineOdds,
    g.bookTotal, g.overOdds, g.underOdds,
    g.awayStartingPitcher, g.homeStartingPitcher,
    g.awayPitcherConfirmed, g.homePitcherConfirmed,
    g.modelRunAt, g.publishedToFeed, g.publishedModel,
    g.modelAwayScore, g.modelHomeScore,
    g.modelAwayML, g.modelHomeML,
    g.modelAwayWinPct, g.modelHomeWinPct,
    g.awayModelSpread, g.homeModelSpread,
    g.modelAwaySpreadOdds, g.modelHomeSpreadOdds,
    g.modelTotal, g.modelOverOdds, g.modelUnderOdds,
    g.modelOverRate, g.modelUnderRate,
    g.spreadDiff, g.spreadEdge,
    g.totalDiff, g.totalEdge,
    g.nrfiCombinedSignal, g.nrfiFilterPass,
    g.modelF5PushPct,
    l.awayPitcherName  AS lAwayPitcher,
    l.homePitcherName  AS lHomePitcher,
    l.awayLineupConfirmed, l.homeLineupConfirmed,
    l.weatherTemp, l.weatherWind, l.weatherDome
  FROM games g
  LEFT JOIN mlb_lineups l ON l.gameId = g.id
  WHERE g.gameDate = '2026-05-29' AND g.sport = 'MLB'
  ORDER BY g.startTimeEst
`);

console.log('[INPUT]  date=2026-05-29 sport=MLB');
console.log(`[STATE]  ${rows.length} games found in DB\n`);

let modeled = 0, published = 0, noOdds = 0, noPitchers = 0;

for (const g of rows) {
  const ranAt   = g.modelRunAt ? new Date(Number(g.modelRunAt)).toISOString() : 'NEVER';
  const awayP   = g.awayStartingPitcher || g.lAwayPitcher || 'NULL';
  const homeP   = g.homeStartingPitcher || g.lHomePitcher || 'NULL';
  const hasOdds = g.awayML && g.homeML && g.bookTotal;
  const hasPit  = awayP !== 'NULL' && homeP !== 'NULL';

  if (g.modelRunAt) modeled++;
  if (g.publishedToFeed) published++;
  if (!hasOdds) noOdds++;
  if (!hasPit)  noPitchers++;

  const oddsFlag    = hasOdds  ? '✓' : '✗ NO ODDS';
  const pitFlag     = hasPit   ? '✓' : '✗ NO PITCHERS';
  const modelFlag   = g.modelRunAt ? '✓ MODELED' : '✗ NOT MODELED';
  const pubFlag     = g.publishedToFeed ? '✓ PUBLISHED' : '✗ UNPUBLISHED';

  console.log(`[GAME ${g.id}] ${g.awayTeam} @ ${g.homeTeam} — ${g.startTimeEst}`);
  console.log(`  [ODDS]    ML: ${g.awayML ?? 'NULL'}/${g.homeML ?? 'NULL'} | RL: ${g.awayRunLine}(${g.awayRunLineOdds}) / ${g.homeRunLine}(${g.homeRunLineOdds}) | Total: ${g.bookTotal ?? 'NULL'} (${g.overOdds}/${g.underOdds}) — ${oddsFlag}`);
  console.log(`  [PITCHER] away="${awayP}" conf=${g.awayPitcherConfirmed} | home="${homeP}" conf=${g.homePitcherConfirmed} — ${pitFlag}`);
  console.log(`  [LINEUP]  away=${g.awayLineupConfirmed ?? 'NULL'} home=${g.homeLineupConfirmed ?? 'NULL'} | weather: ${g.weatherTemp ?? 'NULL'} "${g.weatherWind ?? 'NULL'}" dome=${g.weatherDome ?? 'NULL'}`);
  console.log(`  [STATUS]  modelRunAt=${ranAt} | ${modelFlag} | ${pubFlag}`);

  if (g.modelAwayScore != null) {
    console.log(`  [OUTPUT]  Score: ${g.modelAwayScore}-${g.modelHomeScore} | ML: ${g.modelAwayML}/${g.modelHomeML} | Win%: ${g.modelAwayWinPct}/${g.modelHomeWinPct}`);
    console.log(`  [OUTPUT]  RL: ${g.awayModelSpread}(${g.modelAwaySpreadOdds}) / ${g.homeModelSpread}(${g.modelHomeSpreadOdds})`);
    console.log(`  [OUTPUT]  Total: ${g.modelTotal} Over:${g.modelOverOdds}(${g.modelOverRate}%) Under:${g.modelUnderOdds}(${g.modelUnderRate}%)`);
    console.log(`  [OUTPUT]  RL Edge: diff=${g.spreadDiff} edge="${g.spreadEdge}" | Total Edge: diff=${g.totalDiff} edge="${g.totalEdge}"`);
    console.log(`  [OUTPUT]  NRFI: signal=${g.nrfiCombinedSignal} pass=${g.nrfiFilterPass} | F5Push: ${g.modelF5PushPct}`);
  }
  console.log('');
}

console.log('════════════════════════════════════════');
console.log(`[SUMMARY] total=${rows.length} modeled=${modeled} published=${published}`);
console.log(`[SUMMARY] noOdds=${noOdds} noPitchers=${noPitchers}`);
console.log('════════════════════════════════════════');

await conn.end();
