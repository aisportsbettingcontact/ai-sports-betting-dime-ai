/**
 * forensic500x_datapull.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * 500x FORENSIC AUDIT — Full data pull for all 7 Jun 28-30 R32 knockout matches
 * ESPN tables join via f.espn_event_id = espn.matchId
 * ══════════════════════════════════════════════════════════════════════════════
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import 'dotenv/config';

const TARGET_MATCHS = [
  'wc26-r32-073', // Canada @ South Africa — Jun 28
  'wc26-r32-074', // Japan @ Brazil        — Jun 29
  'wc26-r32-075', // Paraguay @ Germany    — Jun 29
  'wc26-r32-076', // Morocco @ Netherlands — Jun 29
  'wc26-r32-077', // Norway @ Ivory Coast  — Jun 30
  'wc26-r32-078', // Sweden @ France       — Jun 30
  'wc26-r32-079', // Ecuador @ Mexico      — Jun 30
];

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname, port: parseInt(url.port || '3306'),
  user: url.username, password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

const ph = TARGET_MATCHS.map(() => '?').join(',');
console.log('\n[INPUT]  Pulling 500x forensic data for 7 matchs');

// ── 1. Matchs ───────────────────────────────────────────────────────────────
const [matchs] = await conn.execute(`
  SELECT f.match_id, f.match_date, f.kickoff_utc, f.stage,
         f.home_score, f.away_score, f.status, f.espn_event_id,
         f.attendance, f.advancing_team_id,
         ht.name AS home_name, ht.team_id AS home_id, ht.fifa_code AS home_code,
         at.name AS away_name, at.team_id AS away_id, at.fifa_code AS away_code,
         v.stadium, v.city
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
  WHERE f.match_id IN (${ph})
  ORDER BY f.kickoff_utc
`, TARGET_MATCHS);
console.log(`[STATE]  Matchs: ${matchs.length} rows`);

// ── 2. Model Projections ──────────────────────────────────────────────────────
const [models] = await conn.execute(`
  SELECT match_id, model_version, n_simulations,
         home_lambda, away_lambda,
         home_win_prob, draw_prob, away_win_prob,
         proj_home_score, proj_away_score, proj_total, proj_spread,
         model_home_ml, model_draw_ml, model_away_ml,
         model_spread, model_spread_raw, model_total, model_total_raw,
         over_odds, under_odds, home_spread_odds, away_spread_odds,
         btts_prob, btts_yes_odds, btts_no_odds,
         nv_home_prob, nv_draw_prob, nv_away_prob,
         home_edge, draw_edge, away_edge,
         model_lean, lean_prob,
         to_advance_home_prob, to_advance_away_prob,
         to_advance_home_odds, to_advance_away_odds,
         fav_fragility_score, draw_quality_score, underdog_viability,
         xg_balance_ratio, top_scorelines,
         home_win_by_1, home_win_by_2, home_win_by_3plus,
         away_win_by_1, away_win_by_2, away_win_by_3plus,
         over_0_5, over_1_5, over_2_5, under_2_5, over_3_5, over_4_5,
         dc_1x_odds, dc_x2_odds, no_draw_home_odds, no_draw_away_odds,
         modeled_at
  FROM wc2026_model_projections
  WHERE match_id IN (${ph})
`, TARGET_MATCHS);
console.log(`[STATE]  Model projections: ${models.length} rows`);

// ── 3. Frozen Book Odds ───────────────────────────────────────────────────────
const [bookOdds] = await conn.execute(`
  SELECT match_id,
         book_home_ml, book_draw_ml, book_away_ml,
         book_spread_line, book_home_spread_odds, book_away_spread_odds,
         book_total_line, book_over_odds, book_under_odds,
         book_btts_yes_odds, book_btts_no_odds,
         book_dc_1x_odds, book_dc_x2_odds,
         book_no_draw_home_odds, book_no_draw_away_odds,
         to_advance_home_odds, to_advance_away_odds
  FROM wc2026_frozen_book_odds
  WHERE match_id IN (${ph})
`, TARGET_MATCHS);
console.log(`[STATE]  Book odds: ${bookOdds.length} rows`);

// ── 4. ESPN data via espn_event_id ────────────────────────────────────────────
const espnIds = matchs.map(f => f.espn_event_id).filter(Boolean);
const espnPh = espnIds.map(() => '?').join(',');
console.log(`[STATE]  ESPN event IDs: ${espnIds.join(', ')}`);

let espnMatches = [], espnMatchStats = [], espnXG = [], espnTeamStats = [];

if (espnIds.length > 0) {
  try {
    const [em] = await conn.execute(
      `SELECT * FROM wc2026_espn_matches WHERE matchId IN (${espnPh})`, espnIds);
    espnMatches = em;
    console.log(`[STATE]  ESPN matches: ${em.length} rows`);
  } catch(e) { console.log(`[WARN]   ESPN matches: ${e.message}`); }

  try {
    const [ems] = await conn.execute(
      `SELECT matchId, matchRound, homeTeamAbbrev, awayTeamAbbrev,
              homeShotsOnGoal, awayShotsOnGoal, homeShots, awayShots,
              homeBigChancesCreated, awayBigChancesCreated,
              homeBigChancesMissed, awayBigChancesMissed,
              homeCornersWon, awayCornersWon,
              homeXG, awayXG, homeXGOT, awayXGOT,
              homeGkSaves, awayGkSaves,
              homePasses, awayPasses, homePassAccuracyPct, awayPassAccuracyPct,
              homeTackles, awayTackles, homeInterceptions, awayInterceptions,
              homeFoulsCommitted, awayFoulsCommitted,
              homeOffsides, awayOffsides,
              homeFoulYellowCards, awayFoulYellowCards,
              homeFoulRedCards, awayFoulRedCards
       FROM wc2026_espn_match_stats WHERE matchId IN (${espnPh})`, espnIds);
    espnMatchStats = ems;
    console.log(`[STATE]  ESPN match stats: ${ems.length} rows`);
  } catch(e) { console.log(`[WARN]   ESPN match stats: ${e.message}`); }

  try {
    const [exg] = await conn.execute(
      `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
              homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay,
              homeXGSetPlay, awayXGSetPlay, homeXGOT, awayXGOT,
              homeXA, awayXA
       FROM wc2026_espn_expected_goals WHERE matchId IN (${espnPh})`, espnIds);
    espnXG = exg;
    console.log(`[STATE]  ESPN xG: ${exg.length} rows`);
  } catch(e) { console.log(`[WARN]   ESPN xG: ${e.message}`); }

  try {
    const [ets] = await conn.execute(
      `SELECT matchId, homeTeamAbbrev, awayTeamAbbrev,
              possession, possessionAway,
              shotsOnGoal, shotsOnGoalAway,
              shotAttempts, shotAttemptsAway,
              cornerKicks, cornerKicksAway,
              fouls, foulsAway,
              yellowCards, yellowCardsAway,
              redCards, redCardsAway,
              saves, savesAway
       FROM wc2026_espn_team_stats WHERE matchId IN (${espnPh})`, espnIds);
    espnTeamStats = ets;
    console.log(`[STATE]  ESPN team stats: ${ets.length} rows`);
  } catch(e) { console.log(`[WARN]   ESPN team stats: ${e.message}`); }
}

// ── 5. Assemble master dataset ────────────────────────────────────────────────
const masterData = TARGET_MATCHS.map(fid => {
  const fix = matchs.find(r => r.match_id === fid);
  const mod = models.find(r => r.match_id === fid);
  const book = bookOdds.find(r => r.match_id === fid);
  const eid = fix?.espn_event_id;
  const em = espnMatches.find(r => String(r.matchId) === String(eid));
  const ems = espnMatchStats.find(r => String(r.matchId) === String(eid));
  const exg = espnXG.find(r => String(r.matchId) === String(eid));
  const ets = espnTeamStats.find(r => String(r.matchId) === String(eid));
  return { fid, espnId: eid, match: fix, model: mod, book, espnMatch: em, espnMatchStats: ems, espnXG: exg, espnTeamStats: ets };
});

// ── 6. Console 500x summary ───────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  500x FORENSIC AUDIT — 7 Matches | Jun 28-30 R32 Knockout');
console.log('════════════════════════════════════════════════════════════════════\n');

for (const d of masterData) {
  const f = d.match;
  const m = d.model;
  const b = d.book;
  const ems = d.espnMatchStats;
  const exg = d.espnXG;
  const ets = d.espnTeamStats;
  const em = d.espnMatch;
  if (!f) { console.log(`[${d.fid}] ❌ NO MATCH DATA\n`); continue; }

  const md = f.match_date instanceof Date ? f.match_date.toISOString().split('T')[0] : String(f.match_date).split('T')[0];
  const ku = f.kickoff_utc instanceof Date ? f.kickoff_utc : new Date(f.kickoff_utc);
  const etStr = new Date(ku.getTime() - 4*60*60*1000).toISOString().replace('T',' ').substring(11,16) + ' ET';

  const aS = f.away_score, hS = f.home_score;
  const actualTotal = (aS !== null && hS !== null) ? aS + hS : null;
  const actualResult = aS !== null ? `${aS}-${hS}` : 'TBD';
  const actualWinner = aS !== null ? (aS > hS ? 'AWAY' : aS < hS ? 'HOME' : 'DRAW') : 'TBD';

  console.log(`┌─────────────────────────────────────────────────────────────────`);
  console.log(`│ [${d.fid}] ${md} ${etStr} | ${f.stage} | ESPN: ${d.espnId}`);
  console.log(`│ ${f.away_name} (${f.away_code}) AWAY  @  ${f.home_name} (${f.home_code}) HOME`);
  console.log(`│ Venue: ${f.stadium}, ${f.city} | Attendance: ${f.attendance ?? 'N/A'}`);
  console.log(`│`);
  console.log(`│ ── ACTUAL RESULT ──────────────────────────────────────────────`);
  console.log(`│ Score: ${actualResult} (${actualWinner}) | Status: ${f.status}`);
  console.log(`│ Advancing: ${f.advancing_team_id ?? 'N/A'}`);

  if (m) {
    const pH = m.proj_home_score, pA = m.proj_away_score;
    const projTotal = m.proj_total;
    const projWinner = pH !== null ? (pA > pH ? 'AWAY' : pA < pH ? 'HOME' : 'DRAW') : 'N/A';
    const dirOK = actualWinner !== 'TBD' && projWinner !== 'N/A' ? (actualWinner === projWinner ? '✅ CORRECT' : '❌ WRONG') : '?';
    const homeErr = hS !== null && pH !== null ? Math.abs(hS - pH).toFixed(2) : 'N/A';
    const awayErr = aS !== null && pA !== null ? Math.abs(aS - pA).toFixed(2) : 'N/A';
    const totalErr = actualTotal !== null && projTotal !== null ? Math.abs(actualTotal - projTotal).toFixed(2) : 'N/A';
    // Book vs actual
    const bookImpliedWinner = b ? (b.book_away_ml < b.book_home_ml ? 'AWAY' : 'HOME') : 'N/A';
    const bookDirOK = actualWinner !== 'TBD' ? (actualWinner === bookImpliedWinner ? '✅ CORRECT' : '❌ WRONG') : '?';
    // Total hit
    const totalHit = actualTotal !== null && b?.book_total_line !== null ? (actualTotal > b.book_total_line ? 'OVER' : actualTotal < b.book_total_line ? 'UNDER' : 'PUSH') : 'N/A';
    const modelTotalHit = actualTotal !== null && m.model_total !== null ? (actualTotal > m.model_total ? 'OVER' : actualTotal < m.model_total ? 'UNDER' : 'PUSH') : 'N/A';
    // Spread
    const actualSpread = hS !== null ? hS - aS : null;
    const spreadCover = actualSpread !== null && b?.book_spread_line !== null ? (actualSpread > b.book_spread_line ? 'HOME COVERED' : actualSpread < b.book_spread_line ? 'AWAY COVERED' : 'PUSH') : 'N/A';

    console.log(`│`);
    console.log(`│ ── MODEL (${m.model_version}) ─────────────────────────────────────`);
    console.log(`│ Proj: ${pA ?? 'N/A'}-${pH ?? 'N/A'} (${projWinner}) | λH=${m.home_lambda} λA=${m.away_lambda}`);
    console.log(`│ Direction: ${dirOK} | Book Dir: ${bookDirOK}`);
    console.log(`│ Score Err: Home=${homeErr} Away=${awayErr} Total=${totalErr}`);
    console.log(`│ Total: proj=${projTotal} book=${b?.book_total_line} actual=${actualTotal} → ${totalHit} (book) / ${modelTotalHit} (model)`);
    console.log(`│ Spread: book_line=${b?.book_spread_line} actual_diff=${actualSpread} → ${spreadCover}`);
    console.log(`│ Probs: H=${(m.home_win_prob*100).toFixed(1)}% D=${(m.draw_prob*100).toFixed(1)}% A=${(m.away_win_prob*100).toFixed(1)}%`);
    console.log(`│ NV:    H=${(m.nv_home_prob*100).toFixed(1)}% D=${(m.nv_draw_prob*100).toFixed(1)}% A=${(m.nv_away_prob*100).toFixed(1)}%`);
    console.log(`│ ML:    H=${m.model_home_ml} D=${m.model_draw_ml} A=${m.model_away_ml}`);
    console.log(`│ Spread: ${m.model_spread} | Total: ${m.model_total} | BTTS: prob=${(m.btts_prob*100).toFixed(1)}% odds=${m.btts_yes_odds}`);
    console.log(`│ ToAdv: H=${m.to_advance_home_odds} A=${m.to_advance_away_odds}`);
    console.log(`│ Lean: ${m.model_lean} (${(m.lean_prob*100).toFixed(1)}%) | Edges: H=${m.home_edge} D=${m.draw_edge} A=${m.away_edge}`);
    console.log(`│ Frag=${m.fav_fragility_score} DrawQ=${m.draw_quality_score} UndVia=${m.underdog_viability} xGBal=${m.xg_balance_ratio}`);
    if (m.top_scorelines) {
      try {
        const sl = typeof m.top_scorelines === 'string' ? JSON.parse(m.top_scorelines) : m.top_scorelines;
        console.log(`│ Top Scorelines: ${JSON.stringify(sl).substring(0,120)}`);
      } catch(e) {}
    }
  } else {
    console.log(`│ MODEL: ❌ NO DATA`);
  }

  if (b) {
    console.log(`│`);
    console.log(`│ ── BOOK ODDS ──────────────────────────────────────────────────`);
    console.log(`│ ML: H=${b.book_home_ml} D=${b.book_draw_ml} A=${b.book_away_ml}`);
    console.log(`│ Spread: ${b.book_spread_line} (H=${b.book_home_spread_odds} A=${b.book_away_spread_odds})`);
    console.log(`│ Total: ${b.book_total_line} (O=${b.book_over_odds} U=${b.book_under_odds})`);
    console.log(`│ BTTS: Y=${b.book_btts_yes_odds} N=${b.book_btts_no_odds}`);
    console.log(`│ DC: 1X=${b.book_dc_1x_odds} X2=${b.book_dc_x2_odds} | NoDraw: H=${b.book_no_draw_home_odds} A=${b.book_no_draw_away_odds}`);
    console.log(`│ ToAdv: H=${b.to_advance_home_odds} A=${b.to_advance_away_odds}`);
  }

  if (ems || exg || ets) {
    console.log(`│`);
    console.log(`│ ── ESPN MATCH STATS ───────────────────────────────────────────`);
    if (exg) {
      console.log(`│ xG:    H=${exg.homeXG} A=${exg.awayXG} | xGOT: H=${exg.homeXGOT} A=${exg.awayXGOT}`);
      console.log(`│ xGOP:  H=${exg.homeXGOpenPlay} A=${exg.awayXGOpenPlay} | xGSP: H=${exg.homeXGSetPlay} A=${exg.awayXGSetPlay}`);
      console.log(`│ xA:    H=${exg.homeXA} A=${exg.awayXA}`);
    }
    if (ets) {
      console.log(`│ Poss:  H=${ets.possession}% A=${ets.possessionAway}%`);
      console.log(`│ Shots: H=${ets.shotsOnGoal}(SOG) ${ets.shotAttempts}(att) A=${ets.shotsOnGoalAway}(SOG) ${ets.shotAttemptsAway}(att)`);
      console.log(`│ Corners: H=${ets.cornerKicks} A=${ets.cornerKicksAway} | Fouls: H=${ets.fouls} A=${ets.foulsAway}`);
      console.log(`│ YC: H=${ets.yellowCards} A=${ets.yellowCardsAway} | RC: H=${ets.redCards} A=${ets.redCardsAway}`);
      console.log(`│ Saves: H=${ets.saves} A=${ets.savesAway}`);
    }
    if (ems) {
      console.log(`│ BigChances: H=${ems.homeBigChancesCreated}(cre) ${ems.homeBigChancesMissed}(miss) A=${ems.awayBigChancesCreated}(cre) ${ems.awayBigChancesMissed}(miss)`);
      console.log(`│ Passes: H=${ems.homePasses}(${ems.homePassAccuracyPct}%) A=${ems.awayPasses}(${ems.awayPassAccuracyPct}%)`);
      console.log(`│ Tackles: H=${ems.homeTackles} A=${ems.awayTackles} | Intercept: H=${ems.homeInterceptions} A=${ems.awayInterceptions}`);
      console.log(`│ Offsides: H=${ems.homeOffsides} A=${ems.awayOffsides}`);
    }
    if (em) {
      console.log(`│ Formation: H=${em.homeFormation} A=${em.awayFormation}`);
      if (em.homeGoalScorers) console.log(`│ Home Goals: ${em.homeGoalScorers}`);
      if (em.awayGoalScorers) console.log(`│ Away Goals: ${em.awayGoalScorers}`);
    }
  } else {
    console.log(`│ ESPN STATS: ❌ NO DATA`);
  }
  console.log(`└─────────────────────────────────────────────────────────────────\n`);
}

// ── 7. Save JSON ──────────────────────────────────────────────────────────────
const OUTPUT_PATH = '/home/ubuntu/wc2026_forensic500x_data.json';
const serialized = JSON.parse(JSON.stringify(masterData, (k, v) => v instanceof Date ? v.toISOString() : v));
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(serialized, null, 2));
console.log(`[OUTPUT] Saved → ${OUTPUT_PATH}`);
await conn.end();
console.log('[DONE]');
