/**
 * espn_fullpull_7matches.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * Pull ALL ESPN data from all 9 tables for the 7 modeled Jun 28-30 matches
 * Tables: matches, team_stats, player_stats, shot_map, expected_goals,
 *         match_odds, bracket + model_projections + frozen_book_odds
 * ══════════════════════════════════════════════════════════════════════════════
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

const logLines = [];
function ts() { return new Date().toISOString(); }
function log(tag, msg) {
  const line = `[${ts()}] [${String(tag).padEnd(8)}] ${msg}`;
  console.log(line); logLines.push(line);
}

const FIXTURE_IDS = [
  'wc26-r32-073','wc26-r32-074','wc26-r32-075',
  'wc26-r32-076','wc26-r32-077','wc26-r32-078','wc26-r32-079'
];

async function main() {
  log('INIT', 'Connecting to DB...');
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  log('INIT', 'Connected.');

  // ── Step 1: Get fixture metadata + ESPN IDs ──────────────────────────────
  log('STEP1', 'Fetching fixture metadata...');
  const [fixtures] = await conn.query(`
    SELECT f.match_id, f.espn_event_id, f.match_date, f.kickoff_utc,
           f.home_score, f.away_score, f.status, f.attendance,
           th.name as home_name, th.fifa_code as home_code,
           ta.name as away_name, ta.fifa_code as away_code
    FROM wc2026_fixtures f
    JOIN wc2026_teams th ON f.home_team_id = th.team_id
    JOIN wc2026_teams ta ON f.away_team_id = ta.team_id
    WHERE f.match_id IN (?)
    ORDER BY f.match_date, f.kickoff_utc
  `, [FIXTURE_IDS]);

  log('STATE', `Found ${fixtures.length} fixtures`);
  fixtures.forEach(f => {
    log('INPUT', `${f.match_id} | ${f.home_name} ${f.home_score ?? '?'}-${f.away_score ?? '?'} ${f.away_name} | ESPN: ${f.espn_event_id} | Status: ${f.status}`);
  });

  const espnIds = fixtures.map(f => f.espn_event_id).filter(Boolean);
  const fidToEspn = {};
  const espnToFid = {};
  fixtures.forEach(f => {
    if (f.espn_event_id) {
      fidToEspn[f.match_id] = f.espn_event_id;
      espnToFid[f.espn_event_id] = f.match_id;
    }
  });
  log('STATE', `ESPN IDs: ${espnIds.join(', ')}`);

  // ── Step 2: Pull model projections ──────────────────────────────────────
  log('STEP2', 'Fetching model projections...');
  const [modelRows] = await conn.query(`
    SELECT * FROM wc2026_model_projections
    WHERE match_id IN (?)
    ORDER BY match_id, model_version
  `, [FIXTURE_IDS]);
  log('STATE', `Model projection rows: ${modelRows.length}`);

  // ── Step 3: Pull frozen book odds ────────────────────────────────────────
  log('STEP3', 'Fetching frozen book odds...');
  const [bookRows] = await conn.query(`
    SELECT * FROM wc2026_frozen_book_odds
    WHERE match_id IN (?)
  `, [FIXTURE_IDS]);
  log('STATE', `Book odds rows: ${bookRows.length}`);

  // ── Step 4: Pull ESPN match data ─────────────────────────────────────────
  log('STEP4', 'Fetching ESPN match data...');
  let espnMatches = [];
  if (espnIds.length > 0) {
    const [rows] = await conn.query(`SELECT * FROM wc2026_espn_matches WHERE matchId IN (?)`, [espnIds]);
    espnMatches = rows;
    log('STATE', `ESPN match rows: ${rows.length}`);
    rows.forEach(r => log('OUTPUT', `ESPN Match ${r.matchId}: ${r.homeTeam} ${r.homeScore}-${r.awayScore} ${r.awayTeam} | Status: ${r.status} | Venue: ${r.venue} | Attendance: ${r.attendance}`));
  }

  // ── Step 5: Pull ESPN team stats ─────────────────────────────────────────
  log('STEP5', 'Fetching ESPN team stats...');
  let espnTeamStats = [];
  if (espnIds.length > 0) {
    const [rows] = await conn.query(`SELECT * FROM wc2026_espn_team_stats WHERE matchId IN (?)`, [espnIds]);
    espnTeamStats = rows;
    log('STATE', `ESPN team stat rows: ${rows.length}`);
  }

  // ── Step 6: Pull ESPN expected goals ────────────────────────────────────
  log('STEP6', 'Fetching ESPN expected goals...');
  let espnXG = [];
  if (espnIds.length > 0) {
    const [rows] = await conn.query(`SELECT * FROM wc2026_espn_expected_goals WHERE matchId IN (?)`, [espnIds]);
    espnXG = rows;
    log('STATE', `ESPN xG rows: ${rows.length}`);
    rows.forEach(r => log('OUTPUT', `xG ${r.matchId}: ${r.homeTeam} xG=${r.homeXG} | ${r.awayTeam} xG=${r.awayXG}`));
  }

  // ── Step 7: Pull ESPN shot map ────────────────────────────────────────────
  log('STEP7', 'Fetching ESPN shot map...');
  let espnShots = [];
  if (espnIds.length > 0) {
    const [rows] = await conn.query(`SELECT * FROM wc2026_espn_shot_map WHERE matchId IN (?)`, [espnIds]);
    espnShots = rows;
    log('STATE', `ESPN shot map rows: ${rows.length}`);
  }

  // ── Step 8: Pull ESPN match odds ─────────────────────────────────────────
  log('STEP8', 'Fetching ESPN match odds...');
  let espnOdds = [];
  if (espnIds.length > 0) {
    const [rows] = await conn.query(`SELECT * FROM wc2026_espn_match_odds WHERE matchId IN (?)`, [espnIds]);
    espnOdds = rows;
    log('STATE', `ESPN odds rows: ${rows.length}`);
  }

  // ── Step 9: Pull ESPN player stats ───────────────────────────────────────
  log('STEP9', 'Fetching ESPN player stats...');
  let espnPlayers = [];
  if (espnIds.length > 0) {
    const [rows] = await conn.query(`SELECT * FROM wc2026_espn_player_stats WHERE matchId IN (?)`, [espnIds]);
    espnPlayers = rows;
    log('STATE', `ESPN player stat rows: ${rows.length}`);
  }

  await conn.end();
  log('INIT', 'DB connection closed.');

  // ── Step 10: Build per-fixture composite data ────────────────────────────
  log('STEP10', 'Building per-fixture composite data...');
  const output = {};

  for (const f of fixtures) {
    const fid = f.match_id;
    const eid = f.espn_event_id;

    const model = modelRows.filter(r => r.match_id === fid);
    const book = bookRows.find(r => r.match_id === fid);
    const espnMatch = espnMatches.find(r => r.matchId == eid);
    const teamStats = espnTeamStats.filter(r => r.matchId == eid);
    const xg = espnXG.find(r => r.matchId == eid);
    const shots = espnShots.filter(r => r.matchId == eid);
    const odds = espnOdds.filter(r => r.matchId == eid);
    const players = espnPlayers.filter(r => r.matchId == eid);

    output[fid] = {
      fixture: f,
      model,
      book,
      espnMatch,
      teamStats,
      xg,
      shots,
      odds,
      players,
    };

    // Per-fixture summary log
    log('OUTPUT', `\n${'─'.repeat(80)}`);
    log('OUTPUT', `FIXTURE: ${fid} | ${f.home_name} ${f.home_score ?? '?'}-${f.away_score ?? '?'} ${f.away_name}`);
    log('OUTPUT', `ESPN ID: ${eid} | Date: ${f.match_date} | Kickoff: ${f.kickoff_utc}`);

    // Model projections
    if (model.length > 0) {
      model.forEach(m => {
        log('MODEL', `  v${m.model_version}: ${f.home_name} ${m.proj_home_score}-${m.proj_away_score} ${f.away_name}`);
        log('MODEL', `    ML: H=${m.model_home_ml} D=${m.model_draw_ml} A=${m.model_away_ml}`);
        log('MODEL', `    Spread: ${m.model_spread} | Total: ${m.model_total}`);
        log('MODEL', `    Win%: H=${m.home_win_pct} D=${m.draw_pct} A=${m.away_win_pct}`);
        log('MODEL', `    BTTS: ${m.btts_yes_pct} | O/U: O=${m.over_pct} U=${m.under_pct}`);
        log('MODEL', `    AdvH: ${m.home_adv_pct} AdvA: ${m.away_adv_pct}`);
      });
    } else {
      log('MODEL', '  NO MODEL DATA');
    }

    // Book odds
    if (book) {
      log('BOOK', `  ML: H=${book.book_home_ml} D=${book.book_draw_ml} A=${book.book_away_ml}`);
      log('BOOK', `  Spread: ${book.book_spread} | Total: ${book.book_total}`);
      log('BOOK', `  BTTS Y=${book.book_btts_yes} N=${book.book_btts_no}`);
      log('BOOK', `  AdvH=${book.book_home_adv} AdvA=${book.book_away_adv}`);
    } else {
      log('BOOK', '  NO BOOK DATA');
    }

    // ESPN match
    if (espnMatch) {
      log('ESPN', `  Score: ${espnMatch.homeTeam} ${espnMatch.homeScore}-${espnMatch.awayScore} ${espnMatch.awayTeam}`);
      log('ESPN', `  Possession: H=${espnMatch.homePossession}% A=${espnMatch.awayPossession}%`);
      log('ESPN', `  Shots: H=${espnMatch.homeShots} A=${espnMatch.awayShots} | On Target: H=${espnMatch.homeShotsOnTarget} A=${espnMatch.awayShotsOnTarget}`);
      log('ESPN', `  Fouls: H=${espnMatch.homeFouls} A=${espnMatch.awayFouls} | Corners: H=${espnMatch.homeCorners} A=${espnMatch.awayCorners}`);
      log('ESPN', `  Yellow: H=${espnMatch.homeYellowCards} A=${espnMatch.awayYellowCards} | Red: H=${espnMatch.homeRedCards} A=${espnMatch.awayRedCards}`);
      log('ESPN', `  Passes: H=${espnMatch.homePasses} A=${espnMatch.awayPasses} | Acc%: H=${espnMatch.homePassAccuracy} A=${espnMatch.awayPassAccuracy}`);
    } else {
      log('ESPN', '  NO ESPN MATCH DATA');
    }

    // xG
    if (xg) {
      log('XG', `  ${f.home_name} xG=${xg.homeXG} | ${f.away_name} xG=${xg.awayXG}`);
      log('XG', `  Home xG/Shot=${xg.homeXGPerShot} | Away xG/Shot=${xg.awayXGPerShot}`);
    } else {
      log('XG', '  NO XG DATA');
    }

    // Team stats
    if (teamStats.length > 0) {
      teamStats.forEach(ts => {
        log('STATS', `  [${ts.teamSide}] ${ts.teamName}: ${ts.statName}=${ts.statValue}`);
      });
    }

    // Shot map summary
    if (shots.length > 0) {
      const goals = shots.filter(s => s.shotResult === 'goal');
      const onTarget = shots.filter(s => ['goal','saved'].includes(s.shotResult));
      log('SHOTS', `  Total shots: ${shots.length} | Goals: ${goals.length} | On target: ${onTarget.length}`);
      shots.forEach(s => {
        log('SHOTS', `  ${s.teamSide} ${s.playerName}: ${s.shotResult} | xG=${s.xg} | min=${s.minute} | zone=${s.zone}`);
      });
    }

    // Odds
    if (odds.length > 0) {
      odds.forEach(o => {
        log('ODDS', `  ${o.provider}: H=${o.homeOdds} D=${o.drawOdds} A=${o.awayOdds}`);
      });
    }
  }

  // Save
  fs.writeFileSync('/home/ubuntu/wc2026_espn_7matches.json', JSON.stringify(output, null, 2));
  log('OUTPUT', 'Saved: /home/ubuntu/wc2026_espn_7matches.json');
  fs.writeFileSync('/home/ubuntu/wc2026_espn_7matches.log', logLines.join('\n') + '\n');
  log('OUTPUT', 'Saved: /home/ubuntu/wc2026_espn_7matches.log');
  console.log('\n[DONE]');
}

main().catch(e => { console.error('[FATAL]', e.message, e.stack); process.exit(1); });
