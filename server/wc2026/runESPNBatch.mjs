/**
 * runESPNBatch.mjs
 * Runs wc2026ESPNScraper.mjs sequentially for all 12 new R32/R16 matchs.
 * ESPN gameIds: 760493–760504 (mapped from espn_event_id in DB)
 * 
 * Also fixes Ecuador vs Mexico (wc26-r32-079) match_date from 2026-07-01 → 2026-06-30
 */
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

// The 12 new matchs and their ESPN game IDs
const MATCHS = [
  { matchId: 'wc26-r32-080', espnId: '760495', matchup: 'DR Congo @ England' },
  { matchId: 'wc26-r32-081', espnId: '760493', matchup: 'Senegal @ Belgium' },
  { matchId: 'wc26-r32-082', espnId: '760494', matchup: 'Bosnia @ USA' },
  { matchId: 'wc26-r32-083', espnId: '760497', matchup: 'Austria @ Spain' },
  { matchId: 'wc26-r32-084', espnId: '760496', matchup: 'Croatia @ Portugal' },
  { matchId: 'wc26-r32-085', espnId: '760498', matchup: 'Algeria @ Switzerland' },
  { matchId: 'wc26-r32-086', espnId: '760499', matchup: 'Egypt @ Australia' },
  { matchId: 'wc26-r32-087', espnId: '760500', matchup: 'Cape Verde @ Argentina' },
  { matchId: 'wc26-r32-088', espnId: '760501', matchup: 'Ghana @ Colombia' },
  { matchId: 'wc26-r16-089', espnId: '760503', matchup: 'France @ Paraguay' },
  { matchId: 'wc26-r16-090', espnId: '760502', matchup: 'Morocco @ Canada' },
  { matchId: 'wc26-r16-091', espnId: '760504', matchup: 'Norway @ Brazil' },
];

const scraperPath = join(projectRoot, 'server/wc2026/wc2026ESPNScraper.mjs');
const tsxBin = join(projectRoot, 'node_modules/.bin/tsx');

console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  WC2026 ESPN BATCH SCRAPER — 12 New R32/R16 Matchs');
console.log('════════════════════════════════════════════════════════════════════\n');

const results = [];

for (let i = 0; i < MATCHS.length; i++) {
  const { matchId, espnId, matchup } = MATCHS[i];
  console.log(`\n[${i+1}/12] [INPUT]  match_id=${matchId} | espn_event_id=${espnId} | ${matchup}`);
  console.log(`[${i+1}/12] [STEP]   Running wc2026ESPNScraper.mjs gameId=${espnId}`);
  
  const t0 = Date.now();
  const proc = spawnSync('node', [scraperPath, espnId], {
    cwd: projectRoot,
    timeout: 300_000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env }
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  
  const success = proc.status === 0;
  results.push({ matchId, espnId, matchup, success, elapsed });
  
  if (success) {
    console.log(`[${i+1}/12] [OUTPUT] ✅ PASS — gameId=${espnId} | ${elapsed}s`);
  } else {
    console.log(`[${i+1}/12] [OUTPUT] ❌ FAIL — gameId=${espnId} | exit=${proc.status} | ${elapsed}s`);
    if (proc.error) console.error(`[${i+1}/12] [ERROR]  ${proc.error.message}`);
  }
}

// ── Fix Ecuador vs Mexico match_date ─────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  FIX: Ecuador @ Mexico (wc26-r32-079) match_date correction');
console.log('════════════════════════════════════════════════════════════════════');
console.log('[INPUT]  match_id=wc26-r32-079 | kickoff_utc=2026-07-01T02:00:00Z');
console.log('[STEP]   kickoff_ET = 2026-06-30T22:00:00 (UTC-4 EDT)');
console.log('[STEP]   Correcting match_date from 2026-07-01 → 2026-06-30');

const dbUrl = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: dbUrl.hostname, port: parseInt(dbUrl.port || '3306'),
  user: dbUrl.username, password: dbUrl.password,
  database: dbUrl.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

const [before] = await conn.execute(
  "SELECT match_id, match_date, kickoff_utc FROM wc2026_matches WHERE match_id = 'wc26-r32-079'"
);
console.log(`[STATE]  Before: match_date=${before[0]?.match_date instanceof Date ? before[0].match_date.toISOString().split('T')[0] : before[0]?.match_date}`);

const [result] = await conn.execute(
  "UPDATE wc2026_matches SET match_date = '2026-06-30' WHERE match_id = 'wc26-r32-079'"
);
console.log(`[STATE]  UPDATE affected rows: ${result.affectedRows}`);

const [after] = await conn.execute(
  "SELECT match_id, match_date, kickoff_utc FROM wc2026_matches WHERE match_id = 'wc26-r32-079'"
);
const newDate = after[0]?.match_date instanceof Date ? after[0].match_date.toISOString().split('T')[0] : after[0]?.match_date;
console.log(`[OUTPUT] After: match_date=${newDate}`);
console.log(`[VERIFY] ${newDate === '2026-06-30' ? '✅ PASS — match_date correctly set to 2026-06-30' : '❌ FAIL — unexpected value: ' + newDate}`);

await conn.end();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  BATCH SCRAPER SUMMARY');
console.log('════════════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.success).length;
const failed = results.filter(r => !r.success).length;
console.log(`  Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
for (const r of results) {
  const status = r.success ? '✅' : '❌';
  console.log(`  ${status} [${r.matchId}] espnId=${r.espnId} | ${r.matchup} | ${r.elapsed}s`);
}
console.log('\n[DONE] Batch scraper complete.');
