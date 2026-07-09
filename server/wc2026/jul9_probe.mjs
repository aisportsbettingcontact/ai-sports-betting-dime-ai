/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WC2026 JUL 9 PROBE — READ-ONLY DB RECON FOR v23 ENGINE (QF-097)         ║
 * ║  Date: 2026-07-09                                                        ║
 * ║  Purpose:                                                                ║
 * ║    1. Verify wc26-qf-097 fixture (FRA vs MAR) orientation + espn id      ║
 * ║    2. Pull Jul 7 R16 final scores (095, 096) for v23 backtest extension  ║
 * ║    3. Dump existing wc2026MatchOdds book_* columns for wc26-qf-097       ║
 * ║    4. Data completeness: xG row counts for projection + new BT teams     ║
 * ║  ZERO WRITES — SELECT only. Same recon step as the v22 Jul 7 run.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';

function out(section, msg) {
  console.log(`[JUL9-PROBE] [${section}] ${msg}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  out('CONN', 'Database connection established (read-only probe)');

  // 1. Fixtures: Jul 7 R16 results + all QF rows
  const ids = ['wc26-r16-095', 'wc26-r16-096', 'wc26-qf-097', 'wc26-qf-098', 'wc26-qf-099', 'wc26-qf-100'];
  const [matches] = await conn.query(
    `SELECT match_id, match_date, kickoff_utc, stage, home_team_id, away_team_id,
            home_score, away_score, status, espn_match_id
     FROM wc2026_matches WHERE match_id IN (${ids.map(() => '?').join(',')})
     ORDER BY match_id`, ids);
  out('MATCHES', `rows=${matches.length}`);
  for (const m of matches) {
    out('MATCHES', JSON.stringify(m));
  }

  // 2. Existing odds row for the projection fixture — every column, flag NULLs
  const [oddsRows] = await conn.query(`SELECT * FROM wc2026MatchOdds WHERE match_id = ?`, ['wc26-qf-097']);
  out('ODDS', `wc26-qf-097 rows=${oddsRows.length}`);
  if (oddsRows.length > 0) {
    const row = oddsRows[0];
    const nulls = [];
    for (const [k, v] of Object.entries(row)) {
      if (v === null) nulls.push(k);
      else out('ODDS', `  ${k} = ${v instanceof Date ? v.toISOString() : v}`);
    }
    out('ODDS', `NULL columns (${nulls.length}): ${nulls.join(', ') || '(none)'}`);
  }

  // 3. xG data completeness for the v23 team set
  const teams = ['FRA', 'MAR', 'ARG', 'EGY', 'SUI', 'COL'];
  for (const t of teams) {
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM wc2026_espn_expected_goals
       WHERE (homeTeamAbbrev = ? OR awayTeamAbbrev = ?) AND homeXG IS NOT NULL`, [t, t]);
    out('XG', `${t}: ${n} xG rows`);
  }

  // 4. Confirm Jul 7 ESPN ingest landed (needed so 095/096 stats feed the backtest averages)
  for (const eid of ['760508', '760509', '760510']) {
    const [[{ n: xg }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM wc2026_espn_expected_goals WHERE espn_match_id = ?`, [eid]);
    const [[{ n: ms }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM wc2026_espn_match_stats WHERE espn_match_id = ?`, [eid]);
    out('ESPN', `espn_match_id=${eid}: xg_rows=${xg} match_stat_rows=${ms}`);
  }

  await conn.end();
  out('DONE', 'Probe complete — zero writes performed');
}

main().catch(e => { console.error(`[JUL9-PROBE] FATAL: ${e.message}`); process.exit(1); });
