/**
 * AUDIT: MLB Model Status for June 19, 2026
 * Checks which games have model output and which are missing it.
 * Run: npx tsx scripts/audit-mlb-model-status.ts
 */
import { getDb } from '../server/db';
import { games } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  console.log('[AUDIT] ============================================================');
  console.log('[AUDIT] MLB Model Status — June 19, 2026');
  console.log('[AUDIT] ============================================================');

  const db = await getDb();

  // Use db.execute for raw SQL to avoid schema field mapping issues
  const [rawRows] = await (db as any).execute(`
    SELECT
      id, awayTeam, homeTeam, gameDate, startTimeEst, gameStatus,
      awayML, homeML, awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
      bookTotal, overOdds, underOdds,
      awayStartingPitcher, homeStartingPitcher,
      modelRunAt, modelAwayML, modelHomeML,
      awayModelSpread, homeModelSpread, modelTotal,
      modelAwaySpreadOdds, modelHomeSpreadOdds,
      modelOverOdds, modelUnderOdds,
      modelAwayWinPct, modelHomeWinPct,
      publishedToFeed, publishedModel
    FROM games
    WHERE sport = 'MLB' AND gameDate = '2026-06-19'
    ORDER BY sortOrder, startTimeEst
  `);

  const rows = rawRows as any[];
  console.log(`[AUDIT] Total games found: ${rows.length}`);
  console.log('');

  let missingModel = 0;
  let hasModel = 0;

  for (const r of rows) {
    const modelComplete = r.modelAwayML != null && r.modelHomeML != null;
    const dkComplete = r.awayML != null && r.homeML != null;
    const hasRunLine = r.awayRunLine != null;
    const hasTotal = r.bookTotal != null;
    const hasPitchers = r.awayStartingPitcher != null && r.homeStartingPitcher != null;
    const hasLines = dkComplete && hasRunLine && hasTotal;
    const modelAge = r.modelRunAt
      ? `${Math.round((Date.now() - Number(r.modelRunAt)) / 60000)}m ago`
      : 'NEVER RUN';

    if (!modelComplete) missingModel++;
    else hasModel++;

    const flag = modelComplete ? '✓' : '✗ MISSING MODEL';
    console.log(`[GAME] ${flag} | ${r.awayTeam} @ ${r.homeTeam} | ${r.startTimeEst} | status=${r.gameStatus}`);
    console.log(`  [INPUT] SP: away=${r.awayStartingPitcher ?? 'NULL'} | home=${r.homeStartingPitcher ?? 'NULL'} | hasPitchers=${hasPitchers}`);
    console.log(`  [INPUT] DK ML: away=${r.awayML ?? 'NULL'} | home=${r.homeML ?? 'NULL'} | dkComplete=${dkComplete}`);
    console.log(`  [INPUT] RunLine: away=${r.awayRunLine ?? 'NULL'} (${r.awayRunLineOdds ?? 'NULL'}) | home=${r.homeRunLine ?? 'NULL'} (${r.homeRunLineOdds ?? 'NULL'}) | hasRunLine=${hasRunLine}`);
    console.log(`  [INPUT] Total: ${r.bookTotal ?? 'NULL'} | over=${r.overOdds ?? 'NULL'} | under=${r.underOdds ?? 'NULL'} | hasTotal=${hasTotal}`);
    console.log(`  [GATE] hasLines=${hasLines} | hasPitchers=${hasPitchers} | modelable=${hasLines && hasPitchers}`);
    console.log(`  [OUTPUT] Model ML: away=${r.modelAwayML ?? 'NULL'} | home=${r.modelHomeML ?? 'NULL'}`);
    console.log(`  [OUTPUT] Model Spread: away=${r.awayModelSpread ?? 'NULL'} | home=${r.homeModelSpread ?? 'NULL'}`);
    console.log(`  [OUTPUT] Model Total: ${r.modelTotal ?? 'NULL'} | over=${r.modelOverOdds ?? 'NULL'} | under=${r.modelUnderOdds ?? 'NULL'}`);
    console.log(`  [OUTPUT] WinPct: away=${r.modelAwayWinPct ?? 'NULL'} | home=${r.modelHomeWinPct ?? 'NULL'}`);
    console.log(`  [STATE] modelRunAt=${modelAge} | publishedToFeed=${r.publishedToFeed} | publishedModel=${r.publishedModel}`);
    console.log('');
  }

  console.log('[AUDIT] ============================================================');
  console.log(`[AUDIT] SUMMARY: ${hasModel} games WITH model | ${missingModel} games MISSING model`);
  console.log('[AUDIT] ============================================================');

  process.exit(0);
}

main().catch(e => {
  console.error('[AUDIT] FATAL ERROR:', e);
  process.exit(1);
});
