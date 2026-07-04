/**
 * 500X JULY 3 INGESTION — ESPN API + Page Scraper
 * Ingest final data for 760500 (ARG vs CPV) and 760501 (COL vs GHA)
 * 
 * Flow:
 * 1. Run ingestWc2026EspnResults() to update wc2026_matches from ESPN API
 * 2. Run scrapeAndIngest(760500) for full ESPN page data
 * 3. Run scrapeAndIngest(760501) for full ESPN page data
 * 4. Verify all tables populated
 */

import 'dotenv/config';

const TAG = '[500X-INGEST-JUL3]';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' 500X JULY 3 FINAL INGESTION — 760500 + 760501');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${TAG} Started: ${new Date().toISOString()}`);

  // Step 1: Run API-based ingester to update wc2026_matches
  console.log(`\n${TAG} [STEP 1] Running ingestWc2026EspnResults (API-based) for Jul 3 date range...`);
  try {
    const { ingestWc2026EspnResults } = await import('../server/wc2026/wc2026Ingester.ts');
    const apiResult = await ingestWc2026EspnResults({ 
      dateFrom: '2026-07-03', 
      dateTo: '2026-07-03' 
    });
    console.log(`${TAG} [STEP 1] ✅ API ingestion complete:`, JSON.stringify(apiResult, null, 2));
  } catch (err) {
    console.error(`${TAG} [STEP 1] ❌ API ingestion failed:`, err.message);
    console.log(`${TAG} [STEP 1] Falling back to manual DB update...`);
    
    // Manual fallback: update wc2026_matches for ARG vs CPV
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    
    // ARG vs CPV: 3-2 AET, Argentina advances
    await conn.execute(
      "UPDATE wc2026_matches SET home_score = 3, away_score = 2, status = 'FT', advancing_team_id = 'arg' WHERE match_id = 'wc26-r32-087'",
    );
    console.log(`${TAG} [STEP 1-FALLBACK] Updated wc26-r32-087: ARG 3-2 CPV (AET), arg advances`);
    
    await conn.end();
  }

  // Step 2: Run ESPN page scraper for 760500
  console.log(`\n${TAG} [STEP 2] Running scrapeAndIngest(760500) — ARG vs CPV...`);
  try {
    const { scrapeAndIngest } = await import('../server/wc2026/espnDbIngester.ts');
    const result500 = await scrapeAndIngest('760500');
    console.log(`${TAG} [STEP 2] ✅ ESPN page scrape 760500 complete:`);
    console.log(`  espnMatchId: ${result500.espnMatchId}`);
    console.log(`  teamStats: ${result500.teamStatsCount} rows`);
    console.log(`  playerStats: ${result500.playerStatsCount} rows`);
    console.log(`  lineups: ${result500.lineupsCount} rows`);
    console.log(`  matchStats: ${result500.matchStatsCount} rows`);
  } catch (err) {
    console.error(`${TAG} [STEP 2] ❌ Scrape 760500 failed:`, err.message);
    console.error(err.stack);
  }

  // Step 3: Run ESPN page scraper for 760501
  console.log(`\n${TAG} [STEP 3] Running scrapeAndIngest(760501) — COL vs GHA...`);
  try {
    const { scrapeAndIngest } = await import('../server/wc2026/espnDbIngester.ts');
    const result501 = await scrapeAndIngest('760501');
    console.log(`${TAG} [STEP 3] ✅ ESPN page scrape 760501 complete:`);
    console.log(`  espnMatchId: ${result501.espnMatchId}`);
    console.log(`  teamStats: ${result501.teamStatsCount} rows`);
    console.log(`  playerStats: ${result501.playerStatsCount} rows`);
    console.log(`  lineups: ${result501.lineupsCount} rows`);
    console.log(`  matchStats: ${result501.matchStatsCount} rows`);
  } catch (err) {
    console.error(`${TAG} [STEP 3] ❌ Scrape 760501 failed:`, err.message);
    console.error(err.stack);
  }

  // Step 4: Verify
  console.log(`\n${TAG} [STEP 4] Verifying data integrity post-ingestion...`);
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const espnIds = ['760499', '760500', '760501'];
  
  // Check wc2026_matches
  const [matches] = await conn.execute(
    "SELECT match_id, home_team_id, away_team_id, home_score, away_score, status, advancing_team_id FROM wc2026_matches WHERE match_date = '2026-07-03' ORDER BY kickoff_utc"
  );
  console.log(`\n  [VERIFY] wc2026_matches — Jul 3:`);
  for (const m of matches) {
    const pass = m.status === 'FT' && m.home_score !== null && m.advancing_team_id;
    console.log(`    ${pass ? '✅' : '❌'} ${m.match_id} | ${m.home_team_id.toUpperCase()} ${m.home_score}-${m.away_score} ${m.away_team_id.toUpperCase()} | Status: ${m.status} | Advancing: ${m.advancing_team_id || 'NULL'}`);
  }
  
  // Check ESPN matches
  const [espnM] = await conn.execute(
    `SELECT espn_match_id, statusState, homeTeamName, awayTeamName, homeScore, awayScore FROM wc2026_espn_matches WHERE espn_match_id IN ('760499','760500','760501')`
  );
  console.log(`\n  [VERIFY] wc2026_espn_matches:`);
  for (const e of espnM) {
    const pass = e.statusState === 'post' && e.homeScore !== null;
    console.log(`    ${pass ? '✅' : '❌'} ESPN ${e.espn_match_id} | ${e.homeTeamName} ${e.homeScore}-${e.awayScore} ${e.awayTeamName} | State: ${e.statusState}`);
  }
  
  // Check team stats count
  const [ts] = await conn.execute(
    `SELECT espn_match_id, COUNT(*) as cnt FROM wc2026_espn_team_stats WHERE espn_match_id IN ('760499','760500','760501') GROUP BY espn_match_id`
  );
  console.log(`\n  [VERIFY] wc2026_espn_team_stats:`);
  for (const t of ts) {
    console.log(`    ${t.cnt >= 2 ? '✅' : '❌'} ESPN ${t.espn_match_id} | ${t.cnt} rows`);
  }
  
  // Check player stats count
  const [ps] = await conn.execute(
    `SELECT espn_match_id, COUNT(*) as cnt FROM wc2026_espn_player_stats WHERE espn_match_id IN ('760499','760500','760501') GROUP BY espn_match_id`
  );
  console.log(`\n  [VERIFY] wc2026_espn_player_stats:`);
  for (const p of ps) {
    console.log(`    ${p.cnt >= 10 ? '✅' : '❌'} ESPN ${p.espn_match_id} | ${p.cnt} rows`);
  }
  
  // Check lineups count
  const [lu] = await conn.execute(
    `SELECT espn_match_id, COUNT(*) as cnt FROM wc2026_espn_lineups WHERE espn_match_id IN ('760499','760500','760501') GROUP BY espn_match_id`
  );
  console.log(`\n  [VERIFY] wc2026_espn_lineups:`);
  for (const l of lu) {
    console.log(`    ${l.cnt >= 10 ? '✅' : '❌'} ESPN ${l.espn_match_id} | ${l.cnt} rows`);
  }

  await conn.end();
  console.log(`\n${TAG} Completed: ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch(err => {
  console.error(`${TAG} FATAL:`, err);
  process.exit(1);
});
