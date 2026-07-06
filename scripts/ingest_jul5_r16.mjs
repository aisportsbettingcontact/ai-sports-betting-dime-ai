/**
 * 500X JULY 5 R16 INGESTION — ESPN API + Page Scraper
 * ══════════════════════════════════════════════════════════════════════════════
 * Ingest final data for:
 *   760504 (BRA 1-2 NOR) — Norway advances
 *   760505 (MEX 2-3 ENG) — England advances
 * 
 * Flow:
 * 1. Update wc2026_matches with final scores + status + advancing team
 * 2. Run scrapeAndIngest(760504) for full ESPN page data
 * 3. Run scrapeAndIngest(760505) for full ESPN page data
 * 4. Verify all tables populated
 * ══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const TAG = '[500X-INGEST-JUL5]';
const START = Date.now();

function log(tag, msg) {
  const elapsed = ((Date.now() - START) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] [${String(tag).padEnd(8)}] [+${elapsed}s] ${msg}`);
}

const MATCHES = [
  { matchId: 'wc26-r16-091', espnId: '760504', home: 'bra', away: 'nor', homeScore: 1, awayScore: 2, advancing: 'nor' },
  { matchId: 'wc26-r16-092', espnId: '760505', home: 'mex', away: 'eng', homeScore: 2, awayScore: 3, advancing: 'eng' },
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' 500X JULY 5 R16 INGESTION — 760504 (BRA 1-2 NOR) + 760505 (MEX 2-3 ENG)');
  console.log(' Started:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');

  // ── STEP 1: Update wc2026_matches ──────────────────────────────────────
  log('STEP1', 'Updating wc2026_matches with Jul 5 R16 results...');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  for (const m of MATCHES) {
    const [result] = await conn.execute(
      `UPDATE wc2026_matches 
       SET home_score = ?, away_score = ?, status = 'FT', advancing_team_id = ?
       WHERE match_id = ?`,
      [m.homeScore, m.awayScore, m.advancing, m.matchId]
    );
    log('DB', `${m.matchId}: ${m.home.toUpperCase()} ${m.homeScore}-${m.awayScore} ${m.away.toUpperCase()} | advancing=${m.advancing} | affected=${result.affectedRows}`);
  }

  // Verify updates
  const [verify] = await conn.query(
    `SELECT match_id, home_team_id, away_team_id, home_score, away_score, status, advancing_team_id 
     FROM wc2026_matches WHERE match_id IN ('wc26-r16-091','wc26-r16-092')`
  );
  for (const v of verify) {
    const pass = v.status === 'FT' && v.home_score !== null && v.advancing_team_id;
    log(pass ? 'PASS' : 'FAIL', `${v.match_id}: ${v.home_team_id.toUpperCase()} ${v.home_score}-${v.away_score} ${v.away_team_id.toUpperCase()} | Status: ${v.status} | Adv: ${v.advancing_team_id}`);
  }
  await conn.end();

  // ── STEP 2: Run ESPN page scraper for 760504 ──────────────────────────
  log('STEP2', 'Running scrapeAndIngest(760504) — BRA vs NOR...');
  try {
    const { scrapeAndIngest } = await import('../server/wc2026/espnDbIngester.ts');
    const result504 = await scrapeAndIngest('760504');
    log('PASS', `ESPN 760504 scraped:`);
    log('STATE', `  teamStats: ${result504.teamStatsCount || '?'} | playerStats: ${result504.playerStatsCount || '?'} | matchStats: ${result504.matchStatsCount || '?'}`);
  } catch (err) {
    log('FAIL', `Scrape 760504 failed: ${err.message}`);
    log('TRACE', err.stack?.split('\n').slice(0, 3).join(' | '));
  }

  // ── STEP 3: Run ESPN page scraper for 760505 ──────────────────────────
  log('STEP3', 'Running scrapeAndIngest(760505) — MEX vs ENG...');
  try {
    const { scrapeAndIngest } = await import('../server/wc2026/espnDbIngester.ts');
    const result505 = await scrapeAndIngest('760505');
    log('PASS', `ESPN 760505 scraped:`);
    log('STATE', `  teamStats: ${result505.teamStatsCount || '?'} | playerStats: ${result505.playerStatsCount || '?'} | matchStats: ${result505.matchStatsCount || '?'}`);
  } catch (err) {
    log('FAIL', `Scrape 760505 failed: ${err.message}`);
    log('TRACE', err.stack?.split('\n').slice(0, 3).join(' | '));
  }

  // ── STEP 4: Verify all ESPN tables populated ──────────────────────────
  log('STEP4', 'Verifying ESPN data integrity post-ingestion...');
  const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
  const espnIds = ['760504', '760505'];
  
  for (const eid of espnIds) {
    const [xg] = await conn2.query('SELECT COUNT(*) as c FROM wc2026_espn_expected_goals WHERE espn_match_id=?', [eid]);
    const [ts] = await conn2.query('SELECT COUNT(*) as c FROM wc2026_espn_team_stats WHERE espn_match_id=?', [eid]);
    const [ps] = await conn2.query('SELECT COUNT(*) as c FROM wc2026_espn_player_stats WHERE espn_match_id=?', [eid]);
    const [sm] = await conn2.query('SELECT COUNT(*) as c FROM wc2026_espn_shot_map WHERE espn_match_id=?', [eid]);
    const [ms] = await conn2.query('SELECT COUNT(*) as c FROM wc2026_espn_match_stats WHERE espn_match_id=?', [eid]);
    
    const allGood = xg[0].c > 0 && ts[0].c > 0 && ps[0].c > 0;
    log(allGood ? 'PASS' : 'FAIL', `ESPN ${eid}: xG=${xg[0].c} | TS=${ts[0].c} | PS=${ps[0].c} | SM=${sm[0].c} | MS=${ms[0].c}`);
  }

  // Final counts
  const [totalXG] = await conn2.query('SELECT COUNT(DISTINCT espn_match_id) as c FROM wc2026_espn_expected_goals');
  const [totalTS] = await conn2.query('SELECT COUNT(DISTINCT espn_match_id) as c FROM wc2026_espn_team_stats');
  const [totalPS] = await conn2.query('SELECT COUNT(DISTINCT espn_match_id) as c FROM wc2026_espn_player_stats');
  log('STATE', `POST-INGEST TOTALS: xG=${totalXG[0].c} matches | TS=${totalTS[0].c} | PS=${totalPS[0].c}`);

  await conn2.end();
  log('PASS', `Ingestion complete. Duration: ${((Date.now()-START)/1000).toFixed(1)}s`);
}

main().catch(e => { log('FATAL', e.message); log('TRACE', e.stack); process.exit(1); });
