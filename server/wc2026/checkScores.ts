/**
 * checkScores.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 * FORENSIC DB QUERY — Verify homeScore/awayScore for R32 fixtures 073-076
 * Run: npx tsx server/wc2026/checkScores.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { wc2026Fixtures } from '../../drizzle/wc2026.schema';
import { inArray } from 'drizzle-orm';

const LOG = (tag: string, msg: string) =>
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);

const BANNER = (title: string) => {
  const line = '═'.repeat(70);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
};

async function main() {
  BANNER('FORENSIC DB QUERY — R32 Fixture Scores');

  LOG('INIT', 'Connecting to MySQL via DATABASE_URL...');
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);
  LOG('INIT', 'Connection established ✓');

  LOG('QUERY', 'Fetching wc2026_fixtures for IDs: wc26-r32-073, 074, 075, 076...');
  const rows = await db
    .select()
    .from(wc2026Fixtures)
    .where(
      inArray(wc2026Fixtures.matchId, [
        'wc26-r32-073',
        'wc26-r32-074',
        'wc26-r32-075',
        'wc26-r32-076',
      ])
    );

  LOG('RESULT', `Fetched ${rows.length} rows`);

  for (const r of rows) {
    const homeScore = (r as any).homeScore;
    const awayScore = (r as any).awayScore;
    const matchMinute = (r as any).matchMinute;
    const advancingTeamId = (r as any).advancingTeamId;
    const fifaMatchId = (r as any).fifaMatchId;

    const scoreStr = homeScore != null && awayScore != null
      ? `${homeScore}-${awayScore}`
      : 'NULL-NULL';

    const scoreVerify = homeScore != null && awayScore != null ? '✅ SCORES POPULATED' : '❌ SCORES NULL';

    LOG('ROW', [
      `fixture=${r.matchId}`,
      `teams=${r.homeTeamId} vs ${r.awayTeamId}`,
      `status=${r.status}`,
      `score=${scoreStr} ${scoreVerify}`,
      `minute=${matchMinute ?? 'NULL'}`,
      `advancing=${advancingTeamId ?? 'NULL'}`,
      `fifaMatchId=${fifaMatchId ?? 'NULL'}`,
    ].join(' | '));
  }

  // Summary
  const withScores = rows.filter(r => (r as any).homeScore != null && (r as any).awayScore != null);
  const withoutScores = rows.filter(r => (r as any).homeScore == null || (r as any).awayScore == null);

  console.log('');
  LOG('SUMMARY', `Total rows: ${rows.length} | With scores: ${withScores.length} | Missing scores: ${withoutScores.length}`);

  if (withoutScores.length > 0) {
    LOG('WARN', `Fixtures missing scores: ${withoutScores.map(r => r.matchId).join(', ')}`);
    LOG('ACTION', 'These fixtures need homeScore/awayScore seeded from FIFA HTML data');
  } else {
    LOG('VERIFY', 'PASS — All queried fixtures have homeScore and awayScore populated');
  }

  await conn.end();
  LOG('DONE', 'Query complete. Connection closed.');
}

main().catch(e => {
  console.error(`[${new Date().toISOString()}] [FATAL]`, e);
  process.exit(1);
});
