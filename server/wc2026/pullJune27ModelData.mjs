/**
 * Pull all data needed for WC2026 v7.0 model — June 27, 2026
 * - All completed fixtures with scores (for team stats building)
 * - Match stats (SOT, shots, saves) for all completed matches
 * - June 27 fixtures (6 matches to model)
 */
import mysql2 from 'mysql2/promise';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
dotenv.config();

const db = await mysql2.createConnection(process.env.DATABASE_URL);
console.log('[DB] Connected');

// Pull all completed fixtures (all of WC2026 so far through June 26)
const [completedFixtures] = await db.execute(`
  SELECT match_id, home_team_id, away_team_id, home_score, away_score,
         match_date, kickoff_utc, group_letter, matchday, status
  FROM wc2026_fixtures
  WHERE home_score IS NOT NULL AND away_score IS NOT NULL
  ORDER BY kickoff_utc
`);
console.log(`[COMPLETED] ${completedFixtures.length} completed fixtures`);

// Pull match stats for all completed fixtures
const [matchStats] = await db.execute(`
  SELECT ms.match_id, f.home_team_id, f.away_team_id, f.home_score, f.away_score,
         ms.home_shots_on_target, ms.away_shots_on_target,
         ms.home_total_shots, ms.away_total_shots,
         ms.home_saves, ms.away_saves,
         ms.home_xg, ms.away_xg
  FROM wc2026_match_stats ms
  JOIN wc2026_fixtures f ON ms.match_id = f.match_id
  WHERE f.home_score IS NOT NULL AND f.away_score IS NOT NULL
  ORDER BY f.kickoff_utc
`);
console.log(`[STATS] ${matchStats.length} match stats rows`);

// Pull June 27 fixtures
const [fixtures27] = await db.execute(`
  SELECT match_id, home_team_id, away_team_id, match_date, kickoff_utc,
         group_letter, matchday, status
  FROM wc2026_fixtures
  WHERE match_date = '2026-06-27'
  ORDER BY kickoff_utc
`);
console.log(`[JUNE27] ${fixtures27.length} June 27 fixtures`);

// Pull team names
const [teams] = await db.execute(`
  SELECT team_id, fifa_code, name FROM wc2026_teams ORDER BY team_id
`);
console.log(`[TEAMS] ${teams.length} teams`);

// Check for NULL SOT values in stats
const nullSotRows = matchStats.filter(r => r.home_shots_on_target === null || r.away_shots_on_target === null);
if (nullSotRows.length > 0) {
  console.log(`[WARN] ${nullSotRows.length} rows with NULL SOT values:`);
  nullSotRows.forEach(r => console.log(`  ${r.match_id}: home_sot=${r.home_shots_on_target} away_sot=${r.away_shots_on_target}`));
}

const output = {
  stats: matchStats,
  fixtures27,
  teams,
  completedFixtures,
  pulledAt: new Date().toISOString()
};

writeFileSync('/home/ubuntu/june27_model_data.json', JSON.stringify(output, null, 2));
console.log('[OUTPUT] Written: /home/ubuntu/june27_model_data.json');
console.log(`[SUMMARY] ${matchStats.length} stat rows | ${fixtures27.length} June 27 fixtures | ${teams.length} teams`);

await db.end();
console.log('[DB] Disconnected');
